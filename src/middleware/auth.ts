/**
 * Authentication Middleware
 * Provides authentication and authorization for routes
 */
import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AuthServiceInterface, createAuthService } from '../services/auth-service';
import { AuthenticationError, AuthorizationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';
import { UserRole } from '../core/types/auth';
import { 
  extractToken, 
  decodeToken, 
  checkDatabankAccess, 
  extractRoles
} from '../core/utils/auth-utils';
import { extractUserInfo } from '../core/utils/auth-utils';
import { AuthConstants } from '../config/constants';

// Create a logger for this module
const logger = createLogger('AuthMiddleware');

// Create auth service instance
const authService = createAuthService();

/**
 * Authentication middleware
 * Verifies JWT token and extracts user information
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function authenticate(c: Context, next: Next) {
  try {
    // Use extractUserInfo to get user information from the request
    const userInfo = await extractUserInfo(c);
    
    // Set user in context
    const userRole = userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER;
    
    // Set individual properties in context
    c.set('userId', userInfo.userId);
    c.set('userRole', userRole);
    c.set('databankId', userInfo.databankId);
    c.set('userRoles', userInfo.roles);
    c.set('isProvider', userInfo.isProvider);
    c.set('isConsumer', userInfo.isConsumer);
    
    // Set user object in context (matching the type definition)
    c.set('user', {
      id: userInfo.userId,
      role: userRole
    });
    
    // Log successful authentication
    logger.info(`Authentication successful: userId=${userInfo.userId}, databankId=${userInfo.databankId}, roles=${userInfo.roles.join(',')}, isProvider=${userInfo.isProvider}, isConsumer=${userInfo.isConsumer}`);
    
    // Continue to next middleware or route handler
    await next();
  } catch (err) {
    // If error is already an AuthenticationError, rethrow it
    if (err instanceof AuthenticationError) {
      throw err;
    }
    
    // If error is an HTTPException, convert it to an AuthenticationError
    if (err instanceof HTTPException) {
      throw new AuthenticationError(err.message);
    }
    
    // Otherwise, create a new AuthenticationError
    logger.warn('Authentication failed', { 
      path: c.req.path, 
      method: c.req.method,
      error: (err as Error).message 
    });
    
    throw new AuthenticationError((err as Error).message);
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
  return async (c: Context, next: Next) => {
    try {
      // Check if user is already authenticated
      const userId = c.get('userId');
      const databankId = c.get('databankId');
      const isProvider = c.get('isProvider');
      const isConsumer = c.get('isConsumer');
      
      // If not authenticated, try to authenticate
      if (!userId || !databankId) {
        // Use extractUserInfo to get user information from the request
        const userInfo = await extractUserInfo(c);
        
        // Set user in context
        c.set('userId', userInfo.userId);
        c.set('databankId', userInfo.databankId);
        c.set('userRoles', userInfo.roles);
        c.set('isProvider', userInfo.isProvider);
        c.set('isConsumer', userInfo.isConsumer);
        c.set('user', {
          id: userInfo.userId,
          role: userInfo.isProvider ? UserRole.PROVIDER : UserRole.CONSUMER
        });
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
        throw new AuthorizationError('Required role not found');
      }
      
      // Check if user has access to the databank
      const accessResult = await checkDatabankAccess(
        userId as string, 
        databankId as string, 
        roleForAccess
      );
      
      if (!accessResult.hasAccess) {
        throw new AuthorizationError(
          accessResult.error || 'No access to databank',
          { databankId }
        );
      }
      
      // Set role for access in context
      c.set('roleForAccess', roleForAccess);
      
      // Log successful authorization
      logger.info(`Authorization successful: userId=${userId}, databankId=${databankId}, role=${roleForAccess}`);
      
      // Continue to next middleware or route handler
      await next();
    } catch (err) {
      // If error is already an AuthorizationError, rethrow it
      if (err instanceof AuthorizationError) {
        throw err;
      }
      
      // If error is an HTTPException, convert it to an AuthorizationError
      if (err instanceof HTTPException) {
        throw new AuthorizationError(err.message);
      }
      
      // Otherwise, create a new AuthorizationError
      logger.warn('Authorization failed', { 
        path: c.req.path, 
        method: c.req.method,
        error: (err as Error).message 
      });
      
      throw new AuthorizationError((err as Error).message);
    }
  };
}

/**
 * Provider-only authorization middleware
 * Shorthand for authorize([UserRole.PROVIDER])
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function authorizeProvider(c: Context, next: Next) {
  return authorize([UserRole.PROVIDER])(c, next);
}

/**
 * Consumer-only authorization middleware
 * Shorthand for authorize([UserRole.CONSUMER])
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function authorizeConsumer(c: Context, next: Next) {
  return authorize([UserRole.CONSUMER])(c, next);
}

/**
 * Flexible auth middleware that can be used for both provider and consumer routes
 * @param allowedRoles - Array of roles that are allowed to access the route
 * @returns Middleware function that checks if user has any of the allowed roles
 */
export function flexibleAuthMiddleware(allowedRoles: UserRole[]) {
  return authorize(allowedRoles);
}


