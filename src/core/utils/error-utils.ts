/**
 * Error utility functions
 * Provides helper functions for error handling
 */
import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { 
  ApplicationError, 
  ValidationError, 
  S3Error,
  LambdaError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  ServiceUnavailableError,
  FileProcessingError
} from '../errors';
import { ErrorCode, ErrorContext } from '../types/error';

/**
 * Converts an unknown error to an ApplicationError
 * This ensures all errors are properly formatted and contain necessary information
 * 
 * @param error - The error to convert
 * @param defaultMessage - Default message to use if error doesn't have one
 * @param context - Additional context for the error
 * @returns An ApplicationError instance
 */
export function toApplicationError(
  error: unknown, 
  defaultMessage: string = 'An unexpected error occurred',
  context: Record<string, any> = {}
): ApplicationError {
  // If it's already an ApplicationError, just return it
  if (error instanceof ApplicationError) {
    return error;
  }
  
  // Handle Hono HTTPException
  if (error instanceof HTTPException) {
    return new ApplicationError(
      error.message || defaultMessage,
      error.status,
      getErrorCodeFromStatus(error.status),
      { ...context, cause: error as any }
    );
  }
  
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return new ValidationError(
      'Validation failed',
      { ...context, issues: error.issues, cause: error }
    );
  }
  
  // Handle standard Error objects
  if (error instanceof Error) {
    // Check for common error patterns in message or name to categorize better
    if (error.message.includes('not found') || error.message.toLowerCase().includes('no such')) {
      return new NotFoundError('Resource', context.resourceId || '');
    }
    
    if (error.message.includes('permission') || error.message.includes('forbidden') || 
        error.message.includes('access denied')) {
      return new AuthorizationError(error.message, { ...context, cause: error as any });
    }
    
    if (error.message.includes('unauthorized') || error.message.includes('authentication') ||
        error.message.includes('token')) {
      return new AuthenticationError(error.message, { ...context, cause: error as any });
    }
    
    if (error.message.includes('S3') || error.name.includes('S3')) {
      return new S3Error(
        error.message,
        context.operation || 'unknown',
        { ...context, cause: error as any }
      );
    }
    
    if (error.message.includes('Lambda') || error.name.includes('Lambda')) {
      return new LambdaError(
        error.message,
        context.functionName || 'unknown',
        { ...context, cause: error as any }
      );
    }
    
    // Default to generic application error
    return new ApplicationError(
      error.message || defaultMessage,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
      { ...context, cause: error as any }
    );
  }
  
  // Handle non-Error objects (like strings, numbers, etc.)
  return new ApplicationError(
    typeof error === 'string' ? error : defaultMessage,
    500,
    ErrorCode.INTERNAL_SERVER_ERROR,
    { ...context, rawError: error }
  );
}

/**
 * Maps HTTP status codes to error codes
 * 
 * @param status - HTTP status code
 * @returns Appropriate error code for the status
 */
function getErrorCodeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_ERROR;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case 409:
      return ErrorCode.RESOURCE_ALREADY_EXISTS;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 
        ? ErrorCode.INTERNAL_SERVER_ERROR 
        : ErrorCode.INVALID_REQUEST;
  }
}

/**
 * Creates a context object with request information
 * 
 * @param c - Hono context
 * @returns Context object with request information
 */
export function createErrorContext(c: Context): ErrorContext {
  return {
    path: c.req.path,
    method: c.req.method,
    requestId: c.get('requestId') || c.req.header('x-request-id'),
    userId: c.get('userId'),
    databankId: c.get('databankId'),
  };
}
