/**
 * Custom Async Handler for Express 5
 * This middleware wraps async route handlers to properly catch and forward errors to Express error handling middleware
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler to properly catch and forward errors to Express error handling
 * This is a replacement for express-async-errors which is not compatible with Express 5
 * 
 * @param fn - Async function to wrap
 * @returns Express middleware function
 */
export const asyncHandler = (fn: RequestHandler) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/**
 * Utility to wrap all handlers in a router with asyncHandler
 * This can be applied to an entire router or specific routes
 * 
 * @param handlers - Array of route handlers to wrap
 * @returns Array of wrapped handlers
 */
export const wrapAsync = (handlers: RequestHandler[]): RequestHandler[] => {
  return handlers.map(handler => asyncHandler(handler));
};
