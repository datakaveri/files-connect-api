/**
 * Authentication and authorization related type definitions
 */

/**
 * Enum representing user roles in the system
 */
export enum UserRole {
  PROVIDER = 'provider',
  CONSUMER = 'consumer',
  ADMIN = 'cos_admin',
}

/**
 * Interface for context variables
 */
export interface ContextVariableMap {
  /** User ID */
  userId: string;
  
  /** Databank ID */
  databankId: string;
  
  /** User roles */
  userRoles: string[];
  
  /** Whether the user has provider role */
  isProvider: boolean;
  
  /** Whether the user has consumer role */
  isConsumer: boolean;
}

/**
 * Interface representing a decoded JWT token
 */
export interface DecodedToken {
  /** Subject (user ID) */
  sub?: string;
  
  /** Token expiration time (Unix timestamp) */
  exp?: number;
  
  /** Token issued at time (Unix timestamp) */
  iat?: number;
  
  /** Token issuer */
  iss?: string;
  
  /** Audience */
  aud?: string;
  
  /** Realm access information containing user roles */
  realm_access?: {
    roles: string[];
  };
  
  /** Resource access information */
  resource_access?: Record<string, {
    roles: string[];
  }>;
  
  /** Organization ID from token */
  organisation_id?: string;
  
  /** Organization name from token */
  organisation_name?: string;
  
  /** Additional claims */
  [key: string]: any;
}

/**
 * Interface representing authenticated user information
 */
export interface AuthUser {
  /** User ID */
  userId: string;
  
  /** Databank ID */
  databankId: string;
  
  /** User roles */
  roles: string[];
  
  /** Whether the user has provider role */
  isProvider: boolean;
  
  /** Whether the user has consumer role */
  isConsumer: boolean;
}

/**
 * Interface for databank access check result
 */
export interface DatabankAccessResult {
  /** Whether the user has access to the databank */
  hasAccess: boolean;
  
  /** Error message if access check failed */
  error?: string;
}
