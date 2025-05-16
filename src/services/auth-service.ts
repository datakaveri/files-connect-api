/**
 * Authentication Service
 * Handles authentication and authorization operations
 */
import { createLogger } from '../core/utils/logger';
import { AuthUser, UserRole, DatabankAccessResult } from '../core/types/auth';
import { extractToken, decodeToken, checkDatabankAccess as checkAccess, extractRoles } from '../core/utils/auth-utils';

// Create a logger for this module
const logger = createLogger('AuthService');

/**
 * Interface for authentication service
 * Defines methods for authentication and authorization
 */
export interface AuthServiceInterface {
  /**
   * Authenticates a user from an authorization header and databank ID
   * @param authHeader - The authorization header
   * @param databankId - The databank ID
   * @returns Promise resolving to the authenticated user
   * @throws Error if authentication fails
   */
  authenticateUser(authHeader: string | undefined, databankId: string): Promise<AuthUser>;
  
  /**
   * Checks if a user has access to a databank
   * @param userId - The user ID
   * @param databankId - The databank ID
   * @param role - The role to check
   * @returns Promise resolving to the databank access result
   */
  checkDatabankAccess(userId: string, databankId: string, role: UserRole): Promise<DatabankAccessResult>;
}

/**
 * Authentication Service implementation
 * Handles authentication and authorization operations
 */
export class AuthService implements AuthServiceInterface {
  /**
   * Creates a new AuthService instance
   */
  constructor() {
    logger.info('AuthService initialized');
  }
  
  /**
   * Checks if a user has access to a databank
   * @param userId - The user ID
   * @param databankId - The databank ID
   * @param role - The role to check
   * @returns Promise resolving to the databank access result
   */
  async checkDatabankAccess(
    userId: string, 
    databankId: string, 
    role: UserRole
  ): Promise<DatabankAccessResult> {
    return checkAccess(userId, databankId, role);
  }
  
  /**
   * Authenticates a user from an authorization header and databank ID
   * @param authHeader - The authorization header
   * @param databankId - The databank ID
   * @returns Promise resolving to the authenticated user
   * @throws Error if authentication fails
   */
  async authenticateUser(authHeader: string | undefined, databankId: string): Promise<AuthUser> {
    logger.debug('Authenticating user', { databankId });
    
    try {
      // 1. Extract token from authorization header
      const token = extractToken(authHeader);
      
      // 2. Decode and verify token
      const decodedToken = await decodeToken(token);
      const userId = decodedToken.sub ?? '';
      
      // 3. Extract roles
      const { roles, isProvider, isConsumer } = extractRoles(decodedToken);
      
      logger.debug('User authenticated', { 
        userId, 
        databankId, 
        roles, 
        isProvider, 
        isConsumer 
      });
      
      return {
        userId,
        databankId,
        roles,
        isProvider,
        isConsumer,
      };
    } catch (error) {
      logger.error('Authentication failed', error as Error, { databankId });
      throw error;
    }
  }
}

/**
 * Creates a new AuthService instance
 * @returns AuthService instance
 */
export function createAuthService(): AuthService {
  return new AuthService();
}
