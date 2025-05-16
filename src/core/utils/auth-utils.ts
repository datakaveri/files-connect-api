/**
 * Authentication Utilities
 * Provides common functions for authentication and authorization
 */
import { createLogger } from './logger';
import { env } from '../../config/environment';
import { DecodedToken, UserRole, DatabankAccessResult } from '../types/auth';
import { AuthConstants } from '../../config/constants';
import { isDecodedToken } from './type-guards';
import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as jwt from 'jsonwebtoken';

// Import development configuration if available
let devConfig: { jwt: { secretKey: string } } | undefined;
let shouldUseMockAuth: () => boolean = () => false;

// Only import development configuration in development mode
if (process.env.NODE_ENV === 'development') {
  try {
    const devModule = require('../../dev/dev-config');
    devConfig = devModule.devConfig;
    shouldUseMockAuth = devModule.shouldUseMockAuth;
    
    // Log that we're using development configuration
    const logger = createLogger('AuthUtils');
    logger.info('Development mode detected, mock authentication is available');
  } catch (error) {
    // Development configuration not available, continue with production settings
  }
}

// Create a logger for this module
const logger = createLogger('AuthUtils');

/**
 * Interface for user information extracted from a request
 */
export interface UserInfo {
  /** User ID from the token */
  userId: string;
  /** Databank ID from the request */
  databankId: string;
  /** User roles from the token */
  roles: string[];
  /** Whether the user has the Provider role */
  isProvider: boolean;
  /** Whether the user has the Consumer role */
  isConsumer: boolean;
}

/**
 * Extracts and validates a JWT token from an authorization header
 * @param authHeader - The authorization header
 * @returns The extracted token
 * @throws Error if the token is invalid or missing
 */
export function extractToken(authHeader: string | undefined): string {
  logger.debug('Extracting token from authorization header');
  
  if (!authHeader || !authHeader.startsWith(`${AuthConstants.TOKEN.PREFIX} `)) {
    logger.warn('Invalid authorization header', { authHeader });
    throw new Error('Authorization token required');
  }
  
  const token = authHeader.split(' ')[1] || '';
  
  if (!token) {
    logger.warn('Empty token');
    throw new Error('Empty authorization token');
  }
  
  return token;
}

/**
 * Decodes and verifies a JWT token
 * @param token - The JWT token to decode
 * @returns Promise resolving to the decoded token
 */
export async function decodeToken(token: string): Promise<DecodedToken> {
  try {
    let decoded: jwt.JwtPayload | string | null;
    
    // Check if we should use mock authentication
    if (shouldUseMockAuth() && devConfig) {
      // Verify with the development secret key
      decoded = jwt.verify(token, devConfig.jwt.secretKey);
      logger.debug('Using mock authentication for token verification');
    } else {
      // In production, we would verify with the real JWT secret or public key
      // For now, we'll decode without verification for development
      decoded = jwt.decode(token);
      
      // TODO: In production, replace with proper verification:
      // decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['RS256'] });
    }
    
    if (!decoded || typeof decoded !== 'object') {
      throw new Error('Invalid token format');
    }
    
    // Validate the token structure using type guard
    if (!isDecodedToken(decoded)) {
      throw new Error('Token is missing required fields');
    }
    
    // Check if token is expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      throw new Error('Token expired');
    }
    
    return decoded;
  } catch (error) {
    logger.error('Error decoding token', error as Error);
    throw new Error(`Invalid token: ${(error as Error).message}`);
  }
}

/**
 * Checks if a user has access to a databank
 * @param userId - The user ID
 * @param databankId - The databank ID
 * @param role - The role to check
 * @returns Promise resolving to the databank access result
 */
export async function checkDatabankAccess(
  userId: string, 
  databankId: string, 
  role: UserRole
): Promise<DatabankAccessResult> {
  logger.debug('Checking databank access', { userId, databankId, role });
  
  try {
    // In a real implementation, you would call an external API to check
    // if the user has access to the databank with the specified role
    
    // For now, we'll assume all users have access to all databanks
    const hasAccess = true;
    
    logger.debug('Databank access check result', { 
      userId, 
      databankId, 
      role, 
      hasAccess 
    });
    
    return { hasAccess };
  } catch (error) {
    logger.error('Error checking databank access', error as Error, { 
      userId, 
      databankId, 
      role 
    });
    
    return { 
      hasAccess: false, 
      error: (error as Error).message 
    };
  }
}

/**
 * Extracts roles from a decoded token
 * @param decodedToken - The decoded token
 * @returns Object containing roles and role flags
 */
export function extractRoles(decodedToken: DecodedToken): {
  roles: string[];
  isProvider: boolean;
  isConsumer: boolean;
} {
  const roles = decodedToken.realm_access?.roles || [];
  const isProvider = roles.includes(AuthConstants.ROLES.PROVIDER);
  const isConsumer = roles.includes(AuthConstants.ROLES.CONSUMER);
  
  return {
    roles,
    isProvider,
    isConsumer
  };
}

/**
 * Interface for Lambda function response
 */
export interface LambdaFunctionResponse {
  statusCode: number;
  body: string;
}

/**
 * Calls an AWS Lambda function with the given databank ID
 * @param databankId - ID of the databank to process
 * @returns Promise resolving to the Lambda function response
 */
export async function callLambdaFunction(databankId: string): Promise<LambdaFunctionResponse> {
  try {
    // Simulate calling an AWS Lambda function
    logger.info(`Calling Lambda function for databank ${databankId}`);
    
    // In a real implementation, this would call the actual Lambda function
    // For now, we'll just return a mock response
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Processed databank ${databankId}` })
    };
  } catch (error) {
    logger.error('Error calling Lambda function', error as Error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (error as Error).message })
    };
  }
}

/**
 * Extracts user information from a request context
 * @param c - Hono context
 * @returns Promise resolving to the user information
 */
export async function extractUserInfo(c: Context): Promise<UserInfo> {
  try {
    // 1. Get authorization token from header
    const authHeader = c.req.header('Authorization');
    
    // 2. Get databank ID from query params or header
    const databankId = c.req.query('databankId') || c.req.header('X-Databank-ID') || '';
    if (!databankId) {
      throw new HTTPException(400, { message: 'Databank ID is required' });
    }
    
    // 3. Extract and decode token
    const token = extractToken(authHeader);
    const decodedToken = await decodeToken(token);
    const userId = decodedToken.sub ?? '';
    
    // 4. Extract roles
    const { roles, isProvider, isConsumer } = extractRoles(decodedToken);
    
    return {
      userId,
      databankId,
      roles,
      isProvider,
      isConsumer
    };
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    
    logger.error('Error extracting user info', error as Error);
    throw new HTTPException(401, { message: (error as Error).message });
  }
}
