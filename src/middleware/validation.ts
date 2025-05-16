/**
 * Validation Middleware
 * Provides request validation using Zod schemas
 */
import { Context, Next } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../core/errors';
import { createLogger } from '../core/utils/logger';

// Define a symbol for storing validated data in the context
export const VALIDATED_BODY = Symbol('validatedBody');
export const VALIDATED_QUERY = Symbol('validatedQuery');
export const VALIDATED_PARAMS = Symbol('validatedParams');

// Create a logger for this module
const logger = createLogger('ValidationMiddleware');

/**
 * Validates request body against a Zod schema
 * 
 * @param schema - Zod schema to validate against
 * @returns Middleware function that validates request body
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (c: Context, next: Next) => {
    // Check if validation should be skipped
    if (c.get('skip-validation')) {
      return await next();
    }
    
    try {
      // Get body from context if available, otherwise parse from request
      let body;
      if (c.get('body')) {
        body = c.get('body');
      } else {
        body = await c.req.json();
      }
      
      // Validate body against schema
      const result = schema.safeParse(body);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Validation error', { 
          path: c.req.path, 
          method: c.req.method,
          errors 
        });
        
        // Throw validation error
        throw new ValidationError('Request validation failed', { errors });
      }
      
      // Set validated data in context using the symbol
      (c as any)[VALIDATED_BODY] = result.data;
      
      // Continue to next middleware or route handler
      await next();
    } catch (err) {
      // If error is already a ValidationError, rethrow it
      if (err instanceof ValidationError) {
        throw err;
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid request body', { 
        path: c.req.path, 
        method: c.req.method,
        error: (err as Error).message 
      });
      
      throw new ValidationError('Invalid request body', {
        error: (err as Error).message,
      });
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
  return async (c: Context, next: Next) => {
    try {
      // Get query parameters
      const query = c.req.query();
      
      // Validate query against schema
      const result = schema.safeParse(query);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Query validation error', { 
          path: c.req.path, 
          method: c.req.method,
          errors 
        });
        
        // Throw validation error
        throw new ValidationError('Query validation failed', { errors });
      }
      
      // Set validated data in context using the symbol
      (c as any)[VALIDATED_QUERY] = result.data;
      
      // Continue to next middleware or route handler
      await next();
    } catch (err) {
      // If error is already a ValidationError, rethrow it
      if (err instanceof ValidationError) {
        throw err;
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid query parameters', { 
        path: c.req.path, 
        method: c.req.method,
        error: (err as Error).message 
      });
      
      throw new ValidationError('Invalid query parameters', {
        error: (err as Error).message,
      });
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
  return async (c: Context, next: Next) => {
    try {
      // Get parameters
      const params = c.req.param();
      
      // Validate parameters against schema
      const result = schema.safeParse(params);
      
      if (!result.success) {
        // Extract validation errors
        const errors = result.error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        logger.warn('Parameter validation error', { 
          path: c.req.path, 
          method: c.req.method,
          errors 
        });
        
        // Throw validation error
        throw new ValidationError('Parameter validation failed', { errors });
      }
      
      // Set validated data in context using the symbol
      (c as any)[VALIDATED_PARAMS] = result.data;
      
      // Continue to next middleware or route handler
      await next();
    } catch (err) {
      // If error is already a ValidationError, rethrow it
      if (err instanceof ValidationError) {
        throw err;
      }
      
      // Otherwise, create a new ValidationError
      logger.warn('Invalid parameters', { 
        path: c.req.path, 
        method: c.req.method,
        error: (err as Error).message 
      });
      
      throw new ValidationError('Invalid parameters', {
        error: (err as Error).message,
      });
    }
  };
}
