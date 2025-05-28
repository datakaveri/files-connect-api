/**
 * Response utility functions
 * Provides consistent response formatting across the API
 */
import { Context } from "hono";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse, ApiError, HttpStatusCode, ErrorCode } from "../types/response";
import { env } from "../../config/environment";

/**
 * Generate a successful response with standard envelope format
 * @param data The data to include in the response
 * @param meta Additional metadata to include
 * @param statusCode HTTP status code (defaults to 200 OK)
 */
export function successResponse<T>(
  data: T,
  context: Context,
  statusCode: number = HttpStatusCode.OK,
  processingTimeMs?: number
): Response {
  // Create a request ID if not already present
  const requestId = context.get('requestId') || uuidv4();
  
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      processingTimeMs,
      version: env.VERSION || '1.0.0'
    }
  };
  

  
  return context.json(response, statusCode as any);
}

/**
 * Generate an error response with standard envelope format
 * @param error The error details
 * @param statusCode HTTP status code
 */
export function errorResponse(
  context: Context,
  message: string,
  code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
  statusCode: number = HttpStatusCode.INTERNAL_SERVER_ERROR,
  details?: unknown
): Response {
  // Create a request ID if not already present
  const requestId = context.get('requestId') || uuidv4();
  
  const error: ApiError = {
    code,
    message,
    details
  };
  
  const response: ApiResponse = {
    success: false,
    error,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      version: env.VERSION || '1.0.0'
    }
  };
  

  
  return context.json(response, statusCode as any);
}

/**
 * Generate a paginated response with standard envelope format
 * @param data The data array to include in the response
 * @param page Current page number
 * @param pageSize Items per page
 * @param totalItems Total number of items
 * @param context Hono context
 * @param statusCode HTTP status code (defaults to 200 OK)
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  pageSize: number,
  totalItems: number,
  context: Context,
  statusCode: number = HttpStatusCode.OK,
  processingTimeMs?: number
): Response {
  // Create a request ID if not already present
  const requestId = context.get('requestId') || uuidv4();
  
  const totalPages = Math.ceil(totalItems / pageSize);
  const hasMore = page < totalPages;
  
  const response: ApiResponse<T[]> = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      processingTimeMs,
      version: env.VERSION || '1.0.0',
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore
      }
    }
  };
  

  
  return context.json(response, statusCode as any);
}

/**
 * Create a 404 Not Found response
 * @param message Custom error message
 */
export function notFoundResponse(context: Context, message: string = "Resource not found"): Response {
  return errorResponse(
    context,
    message,
    ErrorCode.RESOURCE_NOT_FOUND,
    HttpStatusCode.NOT_FOUND
  );
}

/**
 * Create a 400 Bad Request response
 * @param message Custom error message
 * @param details Additional error details
 */
export function badRequestResponse(
  context: Context,
  message: string = "Invalid request",
  details?: unknown
): Response {
  return errorResponse(
    context,
    message,
    ErrorCode.VALIDATION_ERROR,
    HttpStatusCode.BAD_REQUEST,
    details
  );
}

/**
 * Create a 401 Unauthorized response
 * @param message Custom error message
 */
export function unauthorizedResponse(
  context: Context,
  message: string = "Authentication required"
): Response {
  return errorResponse(
    context,
    message,
    ErrorCode.UNAUTHORIZED,
    HttpStatusCode.UNAUTHORIZED
  );
}

/**
 * Create a 403 Forbidden response
 * @param message Custom error message
 */
export function forbiddenResponse(
  context: Context,
  message: string = "Permission denied"
): Response {
  return errorResponse(
    context,
    message,
    ErrorCode.FORBIDDEN,
    HttpStatusCode.FORBIDDEN
  );
}

/**
 * Create a 409 Conflict response
 * @param message Custom error message
 */
export function conflictResponse(
  context: Context,
  message: string = "Resource conflict",
  details?: unknown
): Response {
  return errorResponse(
    context,
    message,
    ErrorCode.CONFLICT,
    HttpStatusCode.CONFLICT,
    details
  );
}
