/**
 * Route utility functions
 * Provides common utilities for route handlers to reduce redundancy
 */
import { Context, Next } from 'hono';
import { createLogger } from './logger';

const logger = createLogger('RouteUtils');

/**
 * Wraps a route handler with error handling and logging
 * This reduces redundant try-catch blocks across all route handlers
 * 
 * @param handler The route handler function to wrap
 * @param operationName Name of the operation for logging
 * @returns A wrapped handler with error handling
 */
export function withErrorHandling<T>(
  handler: (c: Context) => Promise<T>,
  operationName: string
) {
  return async (c: Context): Promise<T> => {
    try {
      logger.debug(`Starting operation: ${operationName}`);
      const result = await handler(c);
      logger.debug(`Completed operation: ${operationName}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in ${operationName}: ${errorMessage}`);
      
      // Rethrow the error to be handled by the error boundary middleware
      throw error;
    }
  };
}

/**
 * Type-safe response builder for consistent JSON responses
 * 
 * @param data The data to include in the response
 * @param metadata Optional metadata for the response
 * @returns A properly formatted response object
 */
export function buildResponse<T>(data: T, metadata?: Record<string, any>) {
  return {
    data,
    metadata: metadata || {
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Generate a unique job ID with a prefix
 * 
 * @param prefix Prefix to use for the job ID
 * @returns A unique job ID
 */
export function generateJobId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
