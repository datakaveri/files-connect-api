/**
 * Error related type definitions
 */

/**
 * Interface for standardized error responses
 */
export interface ErrorResponse {
  /** Error code */
  code: string;
  
  /** Error message */
  message: string;
  
  /** Additional error details */
  details?: Record<string, any>;
}

/**
 * Enum for common error codes
 */
export enum ErrorCode {
  /** Authentication errors */
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  /** Authorization errors */
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  
  /** Resource errors */
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  
  /** Validation errors */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  
  /** S3 errors */
  S3_ERROR = 'S3_ERROR',
  UPLOAD_ERROR = 'UPLOAD_ERROR',
  DOWNLOAD_ERROR = 'DOWNLOAD_ERROR',
  
  /** General errors */
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

/**
 * Interface for error context
 * Contains additional information about the error
 */
export interface ErrorContext {
  /** Request path */
  path?: string;
  
  /** Request method */
  method?: string;
  
  /** Request ID */
  requestId?: string;
  
  /** User ID */
  userId?: string;
  
  /** Databank ID */
  databankId?: string;
  
  /** Additional context */
  [key: string]: any;
}
