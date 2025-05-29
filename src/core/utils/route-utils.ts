/**
 * Route utility functions
 * Provides common utilities for route handlers to reduce redundancy
 */
import { Request, Response, NextFunction } from 'express';
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
export function withErrorHandling(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  operationName: string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      logger.debug(`Starting operation: ${operationName}`);
      await handler(req, res, next);
      logger.debug(`Completed operation: ${operationName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in ${operationName}: ${errorMessage}`);
      
      // Pass the error to the Express error handling middleware
      next(error);
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
