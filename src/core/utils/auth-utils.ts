/**
 * Authentication Utilities
 * Provides common functions for authentication and authorization
 */
import { createLogger } from './logger';
import { env } from '../../config/environment';
import { DecodedToken, UserRole, DatabankAccessResult } from '../types/auth';
import { AuthConstants } from '../../config/constants';
import { isDecodedToken } from './type-guards';
import { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';

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
    // Verify the token with Keycloak's public key/secret
    // Use proper verification for production environment
    let decoded: jwt.JwtPayload | string | null;
    
    if (!env.KEYCLOAK_PUBLIC_KEY) {
      throw new Error('KEYCLOAK_PUBLIC_KEY is not configured');
    }
    
    // Format the public key properly (add BEGIN/END lines if needed)
    const formattedPublicKey = env.KEYCLOAK_PUBLIC_KEY.includes('BEGIN PUBLIC KEY') ?
      env.KEYCLOAK_PUBLIC_KEY : 
      `-----BEGIN PUBLIC KEY-----\n${env.KEYCLOAK_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;
    
    // Verify token with Keycloak's public key
    decoded = jwt.verify(token, formattedPublicKey, { 
      algorithms: ['RS256'] // Use appropriate algorithm as configured in Keycloak
    });
    
    logger.debug('Token verified successfully');
    
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
 * Extracts user information from Express request
 * @param req - Express request
 * @param res - Express response
 * @returns Promise resolving to the user information
 */
export async function extractUserInfo(req: Request, res: Response): Promise<UserInfo> {
  try {
    // 1. Get authorization token from header
    const authHeader = req.header('Authorization');
    
    // 2. Get databank ID from path parameters or determine if it's an asset route
    const originalUrl = req.originalUrl || '';
    const isAssetRoute = originalUrl.includes('/assets');
    
    // For asset routes, we don't need a databank ID
    let databankId = req.params?.databankId?.toString() || '';
    
    // Only require databankId for non-asset routes
    if (!databankId && !isAssetRoute) {
      const error = new Error('Databank ID is required in the URL path');
      (error as any).statusCode = 400;
      throw error;
    }
    
    // Use a placeholder value for asset routes
    if (isAssetRoute && !databankId) {
      databankId = 'assets';
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
    // Check if error already has a status code
    if ((error as any).statusCode) {
      throw error;
    }
    
    logger.error('Error extracting user info', error as Error);
    const authError = new Error((error as Error).message);
    (authError as any).statusCode = 401;
    throw authError;
  }
}
