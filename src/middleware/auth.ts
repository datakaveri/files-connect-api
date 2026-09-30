/**
 * Authentication Middleware
 * Provides authentication and authorization for routes
 */
import { Request, Response, NextFunction } from 'express';
import { createAuthService } from '../services/auth-service';
import { AuthenticationError, AuthorizationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';
import { UserRole } from '../core/types/auth';
import axios from 'axios';
import { env } from '../config/environment';
import {
  checkDatabankAccess,
  extractUserInfo
} from '../core/utils/auth-utils';
import { ServiceUnavailableError, ValidationError, NotFoundError } from '../core/errors/application-errors';

// Create a logger for this module
const logger = createLogger('AuthMiddleware');

// Create auth service instance
const authService = createAuthService();

// Auth feature toggles from environment
const isAuthEnabled = env.AUTH_ENABLED;
const isAuthzEnabled = env.AUTHZ_ENABLED;
const ACL_SUCCESS_TYPES = new Set([
  'urn:dx:apdServerPanel:success',
  'dx:aclApd:success',
]);
const FILE_ACCESS_TYPE = 'file';
const ACL_LEGACY_SUCCESS_DETAIL_PATTERN = /^user has access to the given (asset|item|databank)!?$/i;

function buildCatalogueItemUrl(databankId: string): string {
  const queryParams = new URLSearchParams({
    id: databankId,
    auditEnabled: 'false',
  });

  return `${env.CAT_API_URL}/item?${queryParams.toString()}`;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' ? property : undefined;
}

function isAclAccessGranted(responseData: unknown): boolean {
  const responseType = getStringProperty(responseData, 'type');
  if (responseType && ACL_SUCCESS_TYPES.has(responseType)) {
    return true;
  }

  const detail = getStringProperty(responseData, 'detail');
  if (detail && ACL_LEGACY_SUCCESS_DETAIL_PATTERN.test(detail.trim())) {
    return true;
  }

  const result = responseData && typeof responseData === 'object'
    ? (responseData as { result?: unknown }).result
    : undefined;

  if (result && typeof result === 'object') {
    const hasAccess = (result as { hasAccess?: unknown }).hasAccess;
    return hasAccess === true;
  }

  return false;
}

function hasOwnConstraints(policy: unknown): boolean {
  if (!policy || typeof policy !== 'object' || !('constraints' in policy)) {
    return false;
  }

  const constraints = (policy as { constraints?: unknown }).constraints;
  return !!constraints && typeof constraints === 'object' && Object.keys(constraints).length > 0;
}

function hasFileAccessConstraint(policy: unknown): boolean {
  if (!hasOwnConstraints(policy)) {
    return false;
  }

  const constraints = (policy as { constraints: { access?: unknown } }).constraints;
  if (!Array.isArray(constraints.access)) {
    return false;
  }

  return constraints.access.some((accessConstraint) => {
    if (!accessConstraint || typeof accessConstraint !== 'object') {
      return false;
    }

    const accessType = (accessConstraint as { accessType?: unknown }).accessType;
    return typeof accessType === 'string' && accessType.toLowerCase() === FILE_ACCESS_TYPE;
  });
}

function hasFileAccessFromHasAccessResponse(responseData: unknown): boolean {
  const policies = (responseData as { result?: { policies?: unknown } })?.result?.policies;

  if (!Array.isArray(policies)) {
    return true;
  }

  const constrainedPolicies = policies.filter(hasOwnConstraints);
  if (constrainedPolicies.length === 0) {
    return true;
  }

  return constrainedPolicies.some(hasFileAccessConstraint);
}

/**
 * Authentication middleware
 * Verifies JWT token and extracts user information
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    // If authentication is disabled via environment, skip this middleware
    if (!isAuthEnabled) {
      logger.debug('Authentication disabled via AUTH_ENABLED env flag; skipping authenticate middleware');
      return next();
    }

    // Use extractUserInfo to get user information from the request
    const userInfo = await extractUserInfo(req, res);

    // Set user role based on provider status
    const userRole = userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER;

    // Store user information in response locals for access in route handlers
    res.locals.userId = userInfo.userId;
    res.locals.userRole = userRole;
    res.locals.databankId = userInfo.databankId;
    res.locals.userRoles = userInfo.roles;
    res.locals.isProvider = userInfo.isProvider;
    res.locals.isConsumer = userInfo.isConsumer;
    res.locals.isAdmin = userInfo.isAdmin;
    res.locals.orgId = userInfo.orgId;
    res.locals.orgName = userInfo.orgName;
    res.locals.user = {
      id: userInfo.userId,
      role: userRole
    };

    // Log successful authentication
    logger.info(`Authentication successful: userId=${userInfo.userId}, databankId=${userInfo.databankId}, roles=${userInfo.roles.join(',')}, isProvider=${userInfo.isProvider}, isConsumer=${userInfo.isConsumer}, isAdmin=${userInfo.isAdmin}`);

    // Continue to next middleware or route handler
    next();
  } catch (err) {
    // If error is already an AuthenticationError, pass it to error handler
    if (err instanceof AuthenticationError) {
      return next(err);
    }

    // Log and create a new AuthenticationError
    logger.warn('Authentication failed', {
      path: req.path,
      method: req.method,
      error: (err as Error).message
    });

    return next(new AuthenticationError((err as Error).message));
  }
}

/**
 * Authorization middleware factory
 * Creates middleware that checks if user has required roles
 * 
 * @param allowedRoles - Roles that are allowed to access the route
 * @returns Middleware function that checks user roles
 */
export function authorize(allowedRoles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // If authorization is disabled via environment, skip this middleware
      if (!isAuthEnabled || !isAuthzEnabled) {
        logger.debug('Authorization disabled via AUTH_ENABLED/AUTHZ_ENABLED env flags; skipping authorize middleware');
        return next();
      }

      // Check if user is already authenticated
      const userId = res.locals.userId;
      const isProvider = res.locals.isProvider;
      const isConsumer = res.locals.isConsumer;
      const isAdmin = res.locals.isAdmin;

      // Determine if this is a route with no databank scope (assets, encryption)
      // by checking the originalUrl. This is more reliable than req.path which
      // might be '/' in some middleware contexts
      const originalUrl = req.originalUrl || '';
      const isAssetRoute = originalUrl.includes('/assets');
      const isDatabanklessRoute = isAssetRoute || originalUrl.includes('/encryption');

      // If not authenticated, try to authenticate
      if (!userId) {
        try {
          // Extract user information from request
          const userInfo = await extractUserInfo(req, res);

          // Store user information in response locals
          res.locals.userId = userInfo.userId;
          res.locals.userRoles = userInfo.roles;
          res.locals.isProvider = userInfo.isProvider;
          res.locals.isConsumer = userInfo.isConsumer;
          res.locals.isAdmin = userInfo.isAdmin;
          res.locals.orgId = userInfo.orgId;
          res.locals.orgName = userInfo.orgName;
          res.locals.user = {
            id: userInfo.userId,
            role: userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER
          };

          // For databank-less routes (assets, encryption), we don't need a databank ID
          if (isDatabanklessRoute) {
            res.locals.databankId = isAssetRoute ? 'assets' : 'platform'; // Use a placeholder value
            logger.debug('Databank-less route detected, skipping databank ID validation', { path: originalUrl });
          } else {
            // For non-asset routes, get the databank ID from params or query
            const databankId = req.params.databankId || req.query.databankId?.toString();

            if (!databankId) {
              logger.warn('Databank ID required but not provided', { path: originalUrl });
              return res.status(400).json({ error: 'Databank ID is required in the URL path' });
            }

            res.locals.databankId = databankId;
          }
        } catch (authErr) {
          return next(new AuthenticationError('Authentication required'));
        }
      }

      // Check if user has any of the allowed roles
      let hasAllowedRole = false;
      let roleForAccess: UserRole | null = null;

      if (allowedRoles.includes(UserRole.PROVIDER) && isProvider) {
        hasAllowedRole = true;
        roleForAccess = UserRole.PROVIDER;
      } else if (allowedRoles.includes(UserRole.CONSUMER) && isConsumer) {
        hasAllowedRole = true;
        roleForAccess = UserRole.CONSUMER;
      } else if (allowedRoles.includes(UserRole.ADMIN)) {
        hasAllowedRole = true;
        roleForAccess = UserRole.ADMIN;
      }

      if (!hasAllowedRole || !roleForAccess) {
        return next(new AuthorizationError('Required role not found'));
      }

      // Get the databank ID from locals
      const currentDatabankId = res.locals.databankId;

      // Check if user has access to the databank
      // Skip databank access check for databank-less routes (assets, encryption)
      // We already determined this above, but check again here
      // in case the route path has changed during middleware execution
      const skipDatabankCheck = (req.originalUrl || '').includes('/assets')
        || (req.originalUrl || '').includes('/encryption');

      if (!skipDatabankCheck) {
        const accessResult = await checkDatabankAccess(
          userId as string,
          currentDatabankId as string,
          roleForAccess
        );

        if (!accessResult.hasAccess) {
          return next(new AuthorizationError(
            accessResult.error || 'No access to databank'
          ));
        }
      }

      // Set role for access in locals
      res.locals.roleForAccess = roleForAccess;

      // Log successful authorization
      logger.info(`Authorization successful: userId=${userId}, role=${roleForAccess}, isAdmin=${isAdmin}`);

      // Continue to next middleware or route handler
      next();
    } catch (err) {
      // Log error and pass to error handler
      logger.warn('Authorization failed', {
        path: req.path,
        method: req.method,
        error: (err as Error).message
      });

      next(new AuthorizationError((err as Error).message));
    }
  };
}

/**
 * Provider-only authorization middleware
 * Shorthand for authorize([UserRole.PROVIDER])
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export function authorizeProvider(req: Request, res: Response, next: NextFunction) {
  return authorize([UserRole.PROVIDER])(req, res, next);
}

/**
 * Consumer-only authorization middleware
 * Shorthand for authorize([UserRole.CONSUMER])
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export function authorizeConsumer(req: Request, res: Response, next: NextFunction) {
  return authorize([UserRole.CONSUMER])(req, res, next);
}

/**
 * Databank access middleware
 * Checks if the user has access to the specified databank
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 */
export async function databankAccess(req: Request, res: Response, next: NextFunction) {
  try {
    // If authorization is disabled via environment, skip this middleware
    if (!isAuthzEnabled) {
      logger.debug('Authorization disabled via AUTHZ_ENABLED env flag; skipping databankAccess middleware');
      return next();
    }

    // Get databank ID from request (can be in params, query, or body)
    const requestedDatabankId =
      req.params.databankId ||
      (req.query.databankId as string) ||
      (req.body && req.body.databankId);

    // If no databank ID is requested, skip this check
    if (!requestedDatabankId) {
      return next();
    }

    // Get user's databank ID from authentication
    const userDatabankId = res.locals.databankId;

    // Admin users (providers) can access any databank
    // if (res.locals.isProvider) {
    //   return next();
    // }

    // Get the authorization token from the request
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      logger.warn('Missing authorization header for databank access check');
      return next(new AuthenticationError('Authorization token required'));
    }

    // Check access using the ACL API
    try {
      const aclApiUrl = `${env.ACL_APD_API_URL}/access_request/has_access`;

      logger.debug('Checking databank access with ACL API', {
        url: aclApiUrl,
        databankId: requestedDatabankId
      });

      const response = await axios.post(
        aclApiUrl,
        { itemId: requestedDatabankId },
        { headers: { Authorization: authHeader } }
      );

      // Validate that the response is JSON — if ACL_APD_API_URL is misconfigured,
      // it may return HTML or other non-JSON content with a 200 status.
      const contentType = (response.headers['content-type'] || '') as string;
      if (!contentType.includes('application/json')) {
        logger.error(`[databankAccess] ACL API returned non-JSON response (Content-Type: ${contentType}). This may indicate a misconfigured ACL_APD_API_URL (currently: ${env.ACL_APD_API_URL}).`);
        return checkIsOwner(req, res, next);
      }

      const responseData = response.data;

      logger.debug('ACL API response', { responseData });

      // Check response type to determine access
      if (isAclAccessGranted(responseData)) {
        if (!hasFileAccessFromHasAccessResponse(responseData)) {
          logger.warn('Databank access denied by ACL API constraints', {
            userId: res.locals.userId,
            databankId: requestedDatabankId,
            responseType: responseData.type,
          });

          return next(new AuthorizationError('File access is not permitted for this databank', {
            reason: 'FILE_ACCESS_CONSTRAINT_MISSING',
            databankId: requestedDatabankId,
          }));
        }

        // User has access, continue to next middleware
        logger.info('Databank access granted via ACL API', {
          userId: res.locals.userId,
          databankId: requestedDatabankId
        });
        return next();
      } else {
        // User does not have access
        logger.warn('Databank access denied by ACL API', {
          userId: res.locals.userId,
          databankId: requestedDatabankId,
          responseType: responseData.type,
          responseDetail: responseData.detail
        });

        res.locals.aclDenied = true;
        res.locals.aclDenialReason = responseData.detail || 'No ACL grant found for this user';
        return checkIsOwner(req, res, next);
      }
    } catch (error) {
      // Handle API call errors — log the configured URL for easier debugging
      logger.error(`Error calling ACL API (ACL_APD_API_URL: ${env.ACL_APD_API_URL})`, error as Error, {
        userId: res.locals.userId,
        databankId: requestedDatabankId
      });

      res.locals.aclDenied = true;
      res.locals.aclDenialReason = 'ACL API call failed';

      // Fallback to the original check if ACL API fails
      if (userDatabankId !== requestedDatabankId) {
        logger.warn('Databank access denied (fallback check)', {
          userId: res.locals.userId,
          userDatabankId,
          requestedDatabankId
        });

        return checkIsOwner(req, res, next);
      }
      return checkIsOwner(req, res, next);
    }
  } catch (err) {
    // Handle any unexpected errors
    logger.error('Unexpected error in databankAccess middleware', err as Error);
    return next(new AuthorizationError('Error checking databank access'));
  }
}

/**
 * Flexible auth middleware that can be used for both provider and consumer routes
 * @param allowedRoles - Array of roles that are allowed to access the route
 * @returns Middleware function that checks if user has any of the allowed roles
 */
/**
 * Middleware to check if a databank is public or if the user has owner access.
 * It first queries an external catalog API to check the `accessPolicy`.
 * If the policy is 'OPEN', it allows access.
 * Otherwise, it delegates to the `databankAccess` middleware to check specific user permissions.
 *
 * @param req Express request object, expected to have `databankId` in `req.params`.
 * @param res Express response object.
 * @param next Express next function.
 */
export async function checkItemAccess(req: Request, res: Response, next: NextFunction) {
  const { databankId } = req.params;
  // If authorization is disabled via environment, skip this middleware
  if (!isAuthzEnabled) {
    logger.debug('Authorization disabled via AUTHZ_ENABLED env flag; skipping checkItemAccess middleware');
    return next();
  }
  logger.debug(`[checkItemAccess] Checking access for databankId: ${databankId}`);

  if (!databankId || databankId === 'undefined' || databankId === 'null') {
    logger.warn(`[checkItemAccess] Invalid databank ID: ${databankId}`);
    return next(new ValidationError('Valid databank ID is required in path parameters.'));
  }

  try {
    // // In development mode, skip Catalogue API check if it's not configured or unavailable
    // if (process.env.NODE_ENV === 'development' && (!env.CAT_API_URL || env.CAT_API_URL.includes('localhost'))) {
    //   logger.warn(`[checkItemAccess] Skipping Catalogue API check in development mode for databankId: ${databankId}`);
    //   return next();
    // }

    const catalogApiUrl = buildCatalogueItemUrl(databankId);
    logger.info(`[checkItemAccess] Calling Catalogue API: ${catalogApiUrl}`);

    // Forward the authorization token from the original request
    const authHeader = req.headers.authorization;
    const headers = authHeader ? { Authorization: authHeader } : {};
    logger.debug(`[checkItemAccess] Forwarding authorization token to Catalogue API`);

    const response = await axios.get(catalogApiUrl, { headers });

    // Validate that the response is JSON — if the Catalogue API's reverse proxy is misconfigured,
    // it may return the frontend HTML page with a 200 status, leading to misleading errors.
    const contentType = (response.headers['content-type'] || '') as string;
    if (!contentType.includes('application/json')) {
      logger.error(`[checkItemAccess] Catalogue API returned non-JSON response (Content-Type: ${contentType}) for databankId: ${databankId}. This usually indicates a reverse proxy or ingress misconfiguration.`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Catalogue API returned unexpected content type: ${contentType}. Expected application/json.`,
        databankId,
      }));
    }

    if (response.status === 404) {
      return next(new NotFoundError('Databank', databankId));
    }

    if (response.status !== 200) {
      logger.warn(`[checkItemAccess] Catalogue API returned status ${response.status} for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }

    const catalogData = response.data;
    if (catalogData && catalogData.result && catalogData.result.length > 0) {
      const accessPolicy = catalogData.result[0].accessPolicy;
      res.locals.accessPolicy = accessPolicy;
      logger.info(`[checkItemAccess] Databank ${databankId} has accessPolicy: ${accessPolicy}`);
      if (accessPolicy === 'OPEN') {
        logger.info(`[checkItemAccess] Databank ${databankId} is public. Granting access.`);
        return next();
      } else if (accessPolicy === 'PRIVATE') {
        return next();
      } else {
        logger.info(`[checkItemAccess] Databank ${databankId} is not public. Proceeding to owner/ACL check.`);
        // Not public, delegate to existing databankAccess middleware
        return next();
      }
    } else {
      logger.warn(`[checkItemAccess] Unexpected response structure or no results from Catalogue API for databankId: ${databankId}`, { responseData: catalogData });
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`[checkItemAccess] Axios error calling Catalogue API for databankId: ${databankId}`, error);

      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;

        // A missing Catalogue item is a missing databank, not a service outage.
        if (status === 404) {
          logger.warn(`Catalogue API returned 404 for databankId: ${databankId}`);
          return next(new NotFoundError('Databank', databankId));
        }

        // Handle other 4xx errors - client errors
        if (status >= 400 && status < 500) {
          logger.warn(`[checkItemAccess] Catalogue API returned client error ${status} for databankId: ${databankId}`);
          return next(new ValidationError(
            `Invalid databank request: ${statusText}`,
            {
              databankId,
              catalogueStatus: status,
              detail: `Catalogue API responded with status ${status} (${statusText}).`
            }
          ));
        }

        // Handle 5xx errors - server errors
        logger.error(`[checkItemAccess] Catalogue API service error ${status} for databankId: ${databankId}`);
        return next(new ServiceUnavailableError('Catalogue API', {
          detail: `Catalogue API responded with status ${status} (${statusText}).`,
          databankId
        }));
      }

      // Network error - no response from server
      logger.error(`[checkItemAccess] Failed to connect to Catalogue API for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: 'Failed to connect to Catalogue API.',
        databankId
      }));
    }

    // Unexpected non-Axios error
    logger.error(`[checkItemAccess] Unexpected error while checking public access for databankId: ${databankId}`, error as Error);
    return next(new ServiceUnavailableError('Catalogue API', {
      detail: 'An unexpected error occurred while verifying databank public access.',
      originalError: (error as Error).message,
      databankId
    }));
  }
}

export async function checkItemAccessWithDatabankAccess(req: Request, res: Response, next: NextFunction) {
  const { databankId } = req.params;
  // If authorization is disabled via environment, skip this middleware
  if (!isAuthzEnabled) {
    logger.debug('Authorization disabled via AUTHZ_ENABLED env flag; skipping checkItemAccessWithDatabankAccess middleware');
    return next();
  }
  logger.debug(`[checkItemAccess] Checking access for databankId: ${databankId}`);

  if (!databankId) {
    logger.warn('[checkItemAccess] Databank ID not found in request parameters.');
    return next(new ValidationError('Databank ID is required in path parameters.'));
  }

  try {
    const catalogApiUrl = buildCatalogueItemUrl(databankId);
    logger.info(`[checkItemAccess] Calling Catalogue API: ${catalogApiUrl}`);

    // Forward the authorization token from the original request
    const authHeader = req.headers.authorization;
    const headers = authHeader ? { Authorization: authHeader } : {};
    logger.debug(`[checkItemAccess] Forwarding authorization token to Catalogue API`);

    const response = await axios.get(catalogApiUrl, { headers });

    // Validate that the response is JSON — if the Catalogue API's reverse proxy is misconfigured,
    // it may return the frontend HTML page with a 200 status, leading to misleading errors.
    const contentType = (response.headers['content-type'] || '') as string;
    if (!contentType.includes('application/json')) {
      logger.error(`[checkItemAccessWithDatabankAccess] Catalogue API returned non-JSON response (Content-Type: ${contentType}) for databankId: ${databankId}. This usually indicates a reverse proxy or ingress misconfiguration.`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Catalogue API returned unexpected content type: ${contentType}. Expected application/json.`,
        databankId,
      }));
    }

    if (response.status === 404) {
      return next(new NotFoundError('Databank', databankId));
    }

    if (response.status !== 200) {
      logger.warn(`[checkItemAccess] Catalogue API returned status ${response.status} for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }

    const catalogData = response.data;
    if (catalogData && catalogData.result && catalogData.result.length > 0) {
      const accessPolicy = catalogData.result[0].accessPolicy;
      res.locals.accessPolicy = accessPolicy;
      logger.info(`[checkItemAccess] Databank ${databankId} has accessPolicy: ${accessPolicy}`);
      if (accessPolicy === 'OPEN') {
        logger.info(`[checkItemAccess] Databank ${databankId} is public. Granting access.`);
        return next();
      } else {
        logger.info(`[checkItemAccess] Databank ${databankId} is not public. Proceeding to owner/ACL check.`);
        // Not public, delegate to existing databankAccess middleware
        return databankAccess(req, res, next);
      }
    } else {
      logger.warn(`[checkItemAccess] Unexpected response structure or no results from Catalogue API for databankId: ${databankId}`, { responseData: catalogData });
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`[checkItemAccess] Axios error calling Catalogue API for databankId: ${databankId}`, error);

      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;

        // A missing Catalogue item is a missing databank, not a service outage.
        if (status === 404) {
          logger.warn(`Catalogue API returned 404 for databankId: ${databankId}`);
          return next(new NotFoundError('Databank', databankId));
        }

        // Handle other 4xx errors - client errors
        if (status >= 400 && status < 500) {
          logger.warn(`[checkItemAccess] Catalogue API returned client error ${status} for databankId: ${databankId}`);
          return next(new ValidationError(
            `Invalid databank request: ${statusText}`,
            {
              databankId,
              catalogueStatus: status,
              detail: `Catalogue API responded with status ${status} (${statusText}).`
            }
          ));
        }

        // Handle 5xx errors - server errors
        logger.error(`[checkItemAccess] Catalogue API service error ${status} for databankId: ${databankId}`);
        return next(new ServiceUnavailableError('Catalogue API', {
          detail: `Catalogue API responded with status ${status} (${statusText}).`,
          databankId
        }));
      }

      // Network error - no response from server
      logger.error(`[checkItemAccess] Failed to connect to Catalogue API for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: 'Failed to connect to Catalogue API.',
        databankId
      }));
    }

    // Unexpected non-Axios error
    logger.error(`[checkItemAccess] Unexpected error while checking public access for databankId: ${databankId}`, error as Error);
    return next(new ServiceUnavailableError('Catalogue API', {
      detail: 'An unexpected error occurred while verifying databank public access.',
      originalError: (error as Error).message,
      databankId
    }));
  }
}

export function flexibleAuthMiddleware(allowedRoles: UserRole[]) {
  // If authorization is disabled via environment, skip this middleware entirely
  if (!isAuthEnabled || !isAuthzEnabled) {
    logger.debug('Authorization disabled via AUTH_ENABLED/AUTHZ_ENABLED env flags; returning no-op flexibleAuthMiddleware');
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return authorize(allowedRoles);
}

/**
 * Middleware to check if the user is the owner of a databank.
 * It queries the catalog API to get the databank's owner and compares it with the user's ID.
 * 
 * @param req Express request object, with `databankId` in `req.params`.
 * @param res Express response object, with `userId` in `res.locals`.
 * @param next Express next function.
 */
export async function checkIsOwner(req: Request, res: Response, next: NextFunction) {
  const { databankId } = req.params;
  const userId = res.locals.userId;

  // If authorization is disabled via environment, skip this middleware
  if (!isAuthzEnabled) {
    logger.debug('Authorization disabled via AUTHZ_ENABLED env flag; skipping checkIsOwner middleware');
    return next();
  }

  logger.debug(`[checkIsOwner] Checking ownership for databankId: ${databankId} by userId: ${userId}`);

  if (!databankId) {
    logger.warn('[checkIsOwner] Databank ID not found in request parameters.');
    return next(new ValidationError('Databank ID is required in path parameters.'));
  }

  if (!userId) {
    logger.warn('[checkIsOwner] User ID not found in request context. Authentication might be missing.');
    return next(new AuthenticationError('User not authenticated.'));
  }

  try {
    const catalogApiUrl = buildCatalogueItemUrl(databankId);
    logger.info(`[checkIsOwner] Calling Catalogue API: ${catalogApiUrl}`);

    // Forward the authorization token from the original request
    const authHeader = req.headers.authorization;
    const headers = authHeader ? { Authorization: authHeader } : {};
    logger.debug(`[checkIsOwner] Forwarding authorization token to Catalogue API`);

    const response = await axios.get(catalogApiUrl, { headers });

    // Validate that the response is JSON — if the Catalogue API's reverse proxy is misconfigured,
    // it may return the frontend HTML page with a 200 status, leading to misleading errors.
    const contentType = (response.headers['content-type'] || '') as string;
    if (!contentType.includes('application/json')) {
      logger.error(`[checkIsOwner] Catalogue API returned non-JSON response (Content-Type: ${contentType}) for databankId: ${databankId}. This usually indicates a reverse proxy or ingress misconfiguration.`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Catalogue API returned unexpected content type: ${contentType}. Expected application/json.`,
        databankId,
      }));
    }

    if (response.status === 404) {
      return next(new NotFoundError('Databank', databankId));
    }

    if (response.status !== 200) {
      logger.warn(`[checkIsOwner] Catalogue API returned status ${response.status} for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }

    const catalogData = response.data;
    if (catalogData && catalogData.result && catalogData.result.length > 0) {
      const ownerId = catalogData.result[0].ownerUserId;
      logger.info(`[checkIsOwner] Databank ${databankId} owner is: ${ownerId}`);

      if (ownerId === userId) {
        logger.info(`[checkIsOwner] User ${userId} is the owner of databank ${databankId}. Granting access.`);
        return next();
      } else {
        logger.warn(`[checkIsOwner] User ${userId} is not the owner of databank ${databankId}. Denying access.`);
        const accessPolicy = res.locals.accessPolicy || 'UNKNOWN';
        const aclDenied = res.locals.aclDenied || false;
        const aclDenialReason = res.locals.aclDenialReason || null;

        // Build actionable hint based on what checks failed
        const hints: string[] = [];
        if (accessPolicy !== 'OPEN') {
          hints.push(`This databank has a ${accessPolicy} access policy.`);
        }
        hints.push('You are not the owner of this databank.');
        if (aclDenied) {
          hints.push(`ACL check also failed: ${aclDenialReason}.`);
        }
        hints.push('Request access from the databank owner or use an account that owns this databank.');

        return next(new AuthorizationError('You do not have permission to access this databank', {
          reason: 'NOT_OWNER',
          databankId,
          accessPolicy,
          aclChecked: aclDenied,
          hint: hints.join(' '),
        }));
      }
    } else {
      logger.warn(`[checkIsOwner] Unexpected response structure or no results from Catalogue API for databankId: ${databankId}`, { responseData: catalogData });
      return next(new AuthorizationError('You do not have permission to access this databank', {
        reason: 'DATABANK_NOT_FOUND_IN_CATALOGUE',
        databankId,
        hint: 'The databank could not be found in the catalogue. Verify the databank ID is correct and the databank is registered.',
      }));
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`[checkIsOwner] Axios error calling Catalogue API for databankId: ${databankId}`, error);

      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;

        // A missing Catalogue item is a missing databank, not a service outage.
        if (status === 404) {
          logger.warn(`Catalogue API returned 404 for databankId: ${databankId}`);
          return next(new NotFoundError('Databank', databankId));
        }

        // Handle other 4xx errors - client errors
        if (status >= 400 && status < 500) {
          logger.warn(`[checkIsOwner] Catalogue API returned client error ${status} for databankId: ${databankId}`);
          return next(new ValidationError(
            `Invalid databank request: ${statusText}`,
            {
              databankId,
              catalogueStatus: status,
              detail: `Catalogue API responded with status ${status} (${statusText}).`
            }
          ));
        }

        // Handle 5xx errors - server errors
        logger.error(`[checkIsOwner] Catalogue API service error ${status} for databankId: ${databankId}`);
        return next(new ServiceUnavailableError('Catalogue API', {
          detail: `Catalogue API responded with status ${status} (${statusText}).`,
          databankId
        }));
      }

      // Network error - no response from server
      logger.error(`[checkIsOwner] Failed to connect to Catalogue API for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: 'Failed to connect to Catalogue API.',
        databankId
      }));
    }

    // Unexpected non-Axios error
    logger.error(`[checkIsOwner] Unexpected error while checking ownership for databankId: ${databankId}`, error as Error);
    return next(new ServiceUnavailableError('Catalogue API', {
      detail: 'An unexpected error occurred while verifying databank ownership.',
      originalError: (error as Error).message,
      databankId
    }));
  }
}


