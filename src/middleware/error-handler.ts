/**
 * Error Handler Middleware
 * Provides consistent error handling for all routes
 */
import { Request, Response, NextFunction } from 'express';
import { ApplicationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';
import { ErrorCode } from '../core/types/response';
import { HttpStatusCode } from '../core/types/response';
import { toApplicationError, createErrorContext } from '../core/utils/error-utils';

// Create a logger for this module
const logger = createLogger('ErrorHandler');

/**
 * Error handler middleware
 * Catches errors and transforms them into standardized API responses
 * 
 * @param err - Error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 * @returns Response with standardized error format
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // Get request ID from locals or generate a new one
  const requestId = res.locals.requestId || 'unknown';
  
  // Get request-scoped logger if available
  const reqLogger = res.locals.logger || createLogger('ErrorHandler').setRequestId(requestId);
  
  // Create error context with request information
  const errorContext = {
    path: req.path,
    method: req.method,
    requestId: requestId,
    userId: res.locals.userId || 'anonymous'
  };
  
  // Convert to ApplicationError if it's not already one
  const applicationError = toApplicationError(err, 'An unexpected error occurred', errorContext);
  
  // Extract error details
  const statusCode = applicationError.statusCode || 500;
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
  
  // Return standardized error response
  res.status(statusCode).json({
    error: {
      message: message,
      code: apiErrorCode,
      details: details,
      requestId: requestId
    }
  });
}

// Note: In Express, we don't need a separate error boundary middleware
// because Express automatically catches errors in async route handlers
// when using express-async-errors package and passes them to error handlers

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
