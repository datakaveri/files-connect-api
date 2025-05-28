/**
 * Standard API response envelope
 * Provides consistent structure for all API responses
 */

// Base response structure for all API responses
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta: ResponseMetadata;
}

// Error details structure
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// Metadata for pagination and other response information
export interface ResponseMetadata {
  // Request tracing
  requestId: string;
  timestamp: string;
  
  // Pagination (optional)
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  };
  
  // Other metadata
  processingTimeMs?: number;
  version?: string;
}

// HTTP status codes mapped to descriptive names
export enum HttpStatusCode {
  // Success codes
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,
  
  // Client error codes
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,
  TOO_MANY_REQUESTS = 429,
  
  // Server error codes
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
}

// Standard error codes for API responses
export enum ErrorCode {
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  
  // Specific domain errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  DATABANK_NOT_FOUND = 'DATABANK_NOT_FOUND',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  
  // System errors
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
}
