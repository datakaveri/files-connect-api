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
import { ServiceUnavailableError, ValidationError } from '../core/errors/application-errors';

// Create a logger for this module
const logger = createLogger('AuthMiddleware');

// Create auth service instance
const authService = createAuthService();

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
    res.locals.user = {
      id: userInfo.userId,
      role: userRole
    };
    
    // Log successful authentication
    logger.info(`Authentication successful: userId=${userInfo.userId}, databankId=${userInfo.databankId}, roles=${userInfo.roles.join(',')}, isProvider=${userInfo.isProvider}, isConsumer=${userInfo.isConsumer}`);
    
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
      // Check if user is already authenticated
      const userId = res.locals.userId;
      const isProvider = res.locals.isProvider;
      const isConsumer = res.locals.isConsumer;
      const isAdmin = res.locals.isAdmin;
      
      // Determine if this is an asset route by checking the originalUrl
      // This is more reliable than req.path which might be '/' in some middleware contexts
      const originalUrl = req.originalUrl || '';
      const isAssetRoute = originalUrl.includes('/assets');
      
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
          res.locals.user = {
            id: userInfo.userId,
            role: userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER
          };
          
          // For asset routes, we don't need a databank ID
          if (isAssetRoute) {
            res.locals.databankId = 'assets'; // Use a placeholder value
            logger.debug('Asset route detected, skipping databank ID validation', { path: originalUrl });
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
      // Skip databank access check for asset routes
      // We already determined if this is an asset route above, but check again here
      // in case the route path has changed during middleware execution
      const skipDatabankCheck = (req.originalUrl || '').includes('/assets');
      
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
      logger.info(`Authorization successful: userId=${userId}, role=${roleForAccess}`);
      
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
      
      const responseData = response.data;
      
      logger.debug('ACL API response', { responseData });
      
      // Check response type to determine access
      if (responseData.type === 'urn:dx:acl:success') {
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
        
        return next(
          new AuthorizationError(responseData.detail || 'You do not have permission to access this databank')
        );
      }
    } catch (error) {
      // Handle API call errors
      logger.error('Error calling ACL API', error as Error, {
        userId: res.locals.userId,
        databankId: requestedDatabankId
      });
      
      // Fallback to the original check if ACL API fails
      if (userDatabankId !== requestedDatabankId) {
        logger.warn('Databank access denied (fallback check)', {
          userId: res.locals.userId,
          userDatabankId,
          requestedDatabankId
        });
        
        return next(
          new AuthorizationError('You do not have permission to access this databank')
        );
      }
      
      // Continue to next middleware or route handler if fallback check passes
      next();
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
export async function checkPublicOrOwnerAccess(req: Request, res: Response, next: NextFunction) {
  const { databankId } = req.params;
  logger.debug(`[checkPublicOrOwnerAccess] Checking access for databankId: ${databankId}`);

  if (!databankId) {
    logger.warn('[checkPublicOrOwnerAccess] Databank ID not found in request parameters.');
    return next(new ValidationError('Databank ID is required in path parameters.'));
  }

  try {
    const catalogApiUrl = `${env.CAT_API_URL}/item?id=${databankId}`;
    logger.info(`[checkPublicOrOwnerAccess] Calling Catalogue API: ${catalogApiUrl}`);
    const response = await axios.get(catalogApiUrl);

    if (response.status !== 200) {
      logger.warn(`[checkPublicOrOwnerAccess] Catalogue API returned status ${response.status} for databankId: ${databankId}`);
      return next(new ServiceUnavailableError('Catalogue API', {
        detail: `Received status ${response.status} while fetching databank details.`,
        databankId,
      }));
    }

    const catalogData = response.data;
    if (catalogData && catalogData.results && catalogData.results.length > 0) {
      const accessPolicy = catalogData.results[0].accessPolicy;
      logger.info(`[checkPublicOrOwnerAccess] Databank ${databankId} has accessPolicy: ${accessPolicy}`);
      if (accessPolicy === 'OPEN') {
        logger.info(`[checkPublicOrOwnerAccess] Databank ${databankId} is public. Granting access.`);
        return next();
      } else {
        logger.info(`[checkPublicOrOwnerAccess] Databank ${databankId} is not public. Proceeding to owner/ACL check.`);
        // Not public, delegate to existing databankAccess middleware
        return databankAccess(req, res, next);
      }
    } else {
      logger.warn(`[checkPublicOrOwnerAccess] Unexpected response structure or no results from Catalogue API for databankId: ${databankId}`, { responseData: catalogData });
      // Treat as non-public and proceed to owner check, or could be an error depending on desired behavior for malformed catalog entries
      // For now, let's assume if we don't get a clear 'OPEN', we must verify ownership.
      // Alternatively, if a missing/malformed entry means it *cannot* be public, this is correct.
      // If it means the catalog is down/erroring for this item, ServiceUnavailableError might be better before databankAccess.
      // Given the current databankAccess also has fallbacks, this seems reasonable.
      logger.info(`[checkPublicOrOwnerAccess] Assuming non-public due to catalog response structure for ${databankId}. Proceeding to owner/ACL check.`);
      return databankAccess(req, res, next);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`[checkPublicOrOwnerAccess] Axios error calling Catalogue API for databankId: ${databankId}`, error);
      let detail = 'Failed to connect to Catalogue API.';
      if (error.response) {
        detail = `Catalogue API responded with status ${error.response.status} (${error.response.statusText}).`;
      }
      return next(new ServiceUnavailableError('Catalogue API', { detail, databankId }));
    }
    logger.error(`[checkPublicOrOwnerAccess] Unexpected error while checking public access for databankId: ${databankId}`, error as Error);
    return next(new ServiceUnavailableError('Catalogue API', { 
      detail: 'An unexpected error occurred while verifying databank public access.',
      originalError: (error as Error).message,
      databankId 
    }));
  }
}

export function flexibleAuthMiddleware(allowedRoles: UserRole[]) {
  return authorize(allowedRoles);
}


