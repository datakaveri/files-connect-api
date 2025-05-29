/**
 * Validation Middleware
 * Provides request validation using Zod schemas
 */
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';

// Extend Express interfaces to include validated data
declare global {
  namespace Express {
    interface Request {
      validatedBody?: any;
      validatedQuery?: any;
      validatedParams?: any;
    }
  }
}

// Keys for storing validated data in request object
export const VALIDATED_BODY = 'validatedBody';
export const VALIDATED_QUERY = 'validatedQuery';
export const VALIDATED_PARAMS = 'validatedParams';

// Create a logger for this module
const logger = createLogger('ValidationMiddleware');

/**
 * Validates request body against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Middleware function that validates request body
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Check if validation should be skipped
    if (res.locals.skipValidation) {
      return next();
    }
    
    try {
      // Get body from request
      const body = req.body;
      
      // Validate body against schema
      const result = schema.safeParse(body);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Validation error', { 
          path: req.path, 
          method: req.method,
          errors 
        });
        
        // Return a validation error to the error handler
        return next(new ValidationError('Request validation failed', { errors }));
      }
      
      // Store validated data in request object
      req[VALIDATED_BODY] = result.data;
      
      // Continue to next middleware or route handler
      next();
    } catch (err) {
      // If error is already a ValidationError, pass it to the error handler
      if (err instanceof ValidationError) {
        return next(err);
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid request body', { 
        path: req.path, 
        method: req.method,
        error: (err as Error).message 
      });
      
      next(new ValidationError('Invalid request body', {
        error: (err as Error).message,
      }));
    }
  };
}

/**
 * Validates request query parameters against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Middleware function that validates request query parameters
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get query parameters
      const query = req.query;
      
      // Validate query against schema
      const result = schema.safeParse(query);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Query validation error', { 
          path: req.path, 
          method: req.method,
          errors 
        });
        
        // Return a validation error to the error handler
        return next(new ValidationError('Query validation failed', { errors }));
      }
      
      // Store validated data in request object
      req[VALIDATED_QUERY] = result.data;
      
      // Continue to next middleware or route handler
      next();
    } catch (err) {
      // If error is already a ValidationError, pass it to the error handler
      if (err instanceof ValidationError) {
        return next(err);
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid query parameters', { 
        path: req.path, 
        method: req.method,
        error: (err as Error).message 
      });
      
      next(new ValidationError('Invalid query parameters', {
        error: (err as Error).message,
      }));
    }
  };
}

/**
 * Validates request parameters against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Middleware function that validates request parameters
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get parameters
      const params = req.params;
      
      // Validate parameters against schema
      const result = schema.safeParse(params);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Parameter validation error', { 
          path: req.path, 
          method: req.method,
          errors 
        });
        
        // Return a validation error to the error handler
        return next(new ValidationError('Parameter validation failed', { errors }));
      }
      
      // Store validated data in request object
      req[VALIDATED_PARAMS] = result.data;
      
      // Continue to next middleware or route handler
      next();
    } catch (err) {
      // If error is already a ValidationError, pass it to the error handler
      if (err instanceof ValidationError) {
        return next(err);
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid parameters', { 
        path: req.path, 
        method: req.method,
        error: (err as Error).message 
      });
      
      next(new ValidationError('Invalid parameters', {
        error: (err as Error).message,
      }));
    }
  };
}
