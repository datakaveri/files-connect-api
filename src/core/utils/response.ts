/**
 * Response utility functions
 * Provides consistent response formatting across the API
 */
import { Request, Response } from "express";
import { ResponseLocals } from "../types/hono";
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
  res: Response,
  statusCode: number = HttpStatusCode.OK,
  processingTimeMs?: number
): void {
  // Create a request ID if not already present
  const requestId = res.locals.requestId || uuidv4();
  
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
  
  res.status(statusCode).json(response);
}

/**
 * Generate an error response with standard envelope format
 * @param error The error details
 * @param statusCode HTTP status code
 */
export function errorResponse(
  res: Response,
  message: string,
  code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
  statusCode: number = HttpStatusCode.INTERNAL_SERVER_ERROR,
  details?: unknown
): void {
  // Create a request ID if not already present
  const requestId = res.locals.requestId || uuidv4();
  
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
  
  res.status(statusCode).json(response);
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
  res: Response,
  statusCode: number = HttpStatusCode.OK,
  processingTimeMs?: number
): void {
  // Create a request ID if not already present
  const requestId = res.locals.requestId || uuidv4();
  
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
  
  res.status(statusCode).json(response);
}

/**
 * Create a 404 Not Found response
 * @param res Express response object
 * @param message Custom error message
 */
export function notFoundResponse(res: Response, message: string = "Resource not found"): void {
  errorResponse(
    res,
    message,
    ErrorCode.RESOURCE_NOT_FOUND,
    HttpStatusCode.NOT_FOUND
  );
}

/**
 * Create a 400 Bad Request response
 * @param res Express response object
 * @param message Custom error message
 * @param details Additional error details
 */
export function badRequestResponse(
  res: Response,
  message: string = "Invalid request",
  details?: unknown
): void {
  errorResponse(
    res,
    message,
    ErrorCode.VALIDATION_ERROR,
    HttpStatusCode.BAD_REQUEST,
    details
  );
}

/**
 * Create a 401 Unauthorized response
 * @param res Express response object
 * @param message Custom error message
 */
export function unauthorizedResponse(
  res: Response,
  message: string = "Authentication required"
): void {
  errorResponse(
    res,
    message,
    ErrorCode.UNAUTHORIZED,
    HttpStatusCode.UNAUTHORIZED
  );
}

/**
 * Create a 403 Forbidden response
 * @param res Express response object
 * @param message Custom error message
 */
export function forbiddenResponse(
  res: Response,
  message: string = "Permission denied"
): void {
  errorResponse(
    res,
    message,
    ErrorCode.FORBIDDEN,
    HttpStatusCode.FORBIDDEN
  );
}

/**
 * Create a 409 Conflict response
 * @param res Express response object
 * @param message Custom error message
 */
export function conflictResponse(
  res: Response,
  message: string = "Resource conflict",
  details?: unknown
): void {
  errorResponse(
    res,
    message,
    ErrorCode.CONFLICT,
    HttpStatusCode.CONFLICT,
    details
  );
}
