/**
 * Authentication Middleware
 * Provides authentication and authorization for routes
 */
import { Request, Response, NextFunction } from 'express';
import { createAuthService } from '../services/auth-service';
import { AuthenticationError, AuthorizationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';
import { UserRole } from '../core/types/auth';
import { 
  checkDatabankAccess, 
  extractUserInfo
} from '../core/utils/auth-utils';

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
      const databankId = res.locals.databankId;
      const isProvider = res.locals.isProvider;
      const isConsumer = res.locals.isConsumer;
      
      // If not authenticated, try to authenticate
      if (!userId || !databankId) {
        try {
          // Extract user information from request
          const databankId = req.query.databankId?.toString() || req.params.databankId;
          if (!databankId) {
            // No databank ID provided
            return res.status(400).json({ error: 'Databank ID is required' });
          }
          
          // Call the databankAccess service
          const userInfo = await extractUserInfo(req, res);
          
          // Store user information in response locals
          res.locals.userId = userInfo.userId;
          res.locals.databankId = userInfo.databankId;
          res.locals.userRoles = userInfo.roles;
          res.locals.isProvider = userInfo.isProvider;
          res.locals.isConsumer = userInfo.isConsumer;
          res.locals.user = {
            id: userInfo.userId,
            role: userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER
          };
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
      }
      
      if (!hasAllowedRole || !roleForAccess) {
        return next(new AuthorizationError('Required role not found'));
      }
      
      // Check if user has access to the databank
      const accessResult = await checkDatabankAccess(
        userId as string, 
        databankId as string, 
        roleForAccess
      );
      
      if (!accessResult.hasAccess) {
        return next(new AuthorizationError(
          accessResult.error || 'No access to databank'
        ));
      }
      
      // Set role for access in locals
      res.locals.roleForAccess = roleForAccess;
      
      // Log successful authorization
      logger.info(`Authorization successful: userId=${userId}, databankId=${databankId}, role=${roleForAccess}`);
      
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
export function databankAccess(req: Request, res: Response, next: NextFunction) {
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
  if (res.locals.isProvider) {
    return next();
  }
  
  // Regular users can only access their own databank
  if (userDatabankId !== requestedDatabankId) {
    logger.warn('Databank access denied', {
      userId: res.locals.userId,
      userDatabankId,
      requestedDatabankId
    });
    
    return next(
      new AuthorizationError('You do not have permission to access this databank')
    );
  }
  
  // Continue to next middleware or route handler
  next();
}

/**
 * Flexible auth middleware that can be used for both provider and consumer routes
 * @param allowedRoles - Array of roles that are allowed to access the route
 * @returns Middleware function that checks if user has any of the allowed roles
 */
export function flexibleAuthMiddleware(allowedRoles: UserRole[]) {
  return authorize(allowedRoles);
}


