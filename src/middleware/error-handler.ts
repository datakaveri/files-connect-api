/**
 * Error Handler Middleware
 * Provides consistent error handling for all routes
 */
import { Context, Next } from 'hono';
import { ApplicationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';
import { ErrorCode } from '../core/types/response';
import { HttpStatusCode } from '../core/types/response';
import { errorResponse } from '../core/utils/response';
import { toApplicationError, createErrorContext } from '../core/utils/error-utils';

// Create a logger for this module
const logger = createLogger('ErrorHandler');

/**
 * Error handler middleware
 * Catches errors and transforms them into standardized API responses
 * 
 * @param err - Error object
 * @param c - Hono context
 * @returns Response with standardized error format
 */
export async function errorHandler(err: unknown, c: Context) {
  // Get request ID from context
  const requestId = c.get('requestId') || 'unknown';
  
  // Get request-scoped logger if available
  const reqLogger = c.get('logger') || createLogger('ErrorHandler').setRequestId(requestId);
  
  // Create error context with request information
  const errorContext = createErrorContext(c);
  
  // Convert to ApplicationError if it's not already one
  const applicationError = toApplicationError(err, 'An unexpected error occurred', errorContext);
  
  // Extract error details
  const statusCode = applicationError.statusCode;
  const errorCode = applicationError.code as ErrorCode;
  const message = applicationError.message;
  const details = applicationError.details;
  
  // Log error with appropriate level based on status code
  if (statusCode >= 500) {
    reqLogger.error(
      `Server error: ${message}`,
      applicationError instanceof Error ? applicationError : new Error(message),
      { statusCode, errorCode, details }
    );
  } else if (statusCode >= 400) {
    reqLogger.warn(
      `Client error: ${message}`,
      { 
        errorType: applicationError.name,
        statusCode, 
        errorCode,
        details
      }
    );
  } else {
    // This shouldn't happen, but just in case
    reqLogger.info(
      `Informational response: ${message}`,
      { statusCode, errorCode, details }
    );
  }
  
  // Map internal error code to standardized API error code
  const apiErrorCode = mapErrorCode(errorCode);
  
  // Return standardized error response using our utility function
  return errorResponse(
    c,
    message,
    apiErrorCode,
    statusCode as HttpStatusCode,
    details
  );
}

/**
 * Error boundary middleware
 * Wraps route handlers in a try-catch block and passes errors to the error handler
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the route handler or error handler
 */
export async function errorBoundary(c: Context, next: Next) {
  try {
    // Execute the route handler
    return await next();
  } catch (err) {
    // Handle the error
    return errorHandler(err as Error, c);
  }
}

/**
 * Maps internal error codes to standardized API error codes
 * @param code The internal error code
 * @returns Standardized API error code
 */
function mapErrorCode(code: string): ErrorCode {
  // Map internal error codes to our standardized error codes
  switch (code) {
    case 'NOT_FOUND':
      return ErrorCode.RESOURCE_NOT_FOUND;
    case 'VALIDATION_ERROR':
      return ErrorCode.VALIDATION_ERROR;
    case 'UNAUTHORIZED':
      return ErrorCode.UNAUTHORIZED;
    case 'FORBIDDEN':
      return ErrorCode.FORBIDDEN;
    case 'CONFLICT':
      return ErrorCode.CONFLICT;
    case 'FILE_NOT_FOUND':
      return ErrorCode.FILE_NOT_FOUND;
    case 'DATABANK_NOT_FOUND':
      return ErrorCode.DATABANK_NOT_FOUND;
    case 'UPLOAD_FAILED':
      return ErrorCode.UPLOAD_FAILED;
    case 'PROCESSING_FAILED':
      return ErrorCode.PROCESSING_FAILED;
    case 'JOB_NOT_FOUND':
      return ErrorCode.JOB_NOT_FOUND;
    default:
      return ErrorCode.UNKNOWN_ERROR;
  }
}
