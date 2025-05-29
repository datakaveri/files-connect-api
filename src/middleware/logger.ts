/**
 * Logger Middleware
 * Provides request logging and request ID generation
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('RequestLogger');

/**
 * Request context middleware
 * Generates a unique request ID and adds it to the response locals
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  // Generate or use existing request ID
  const requestId = req.header('X-Request-ID') || uuidv4();
  
  // Store request ID in response locals for access in other middleware/routes
  res.locals.requestId = requestId;
  
  // Set request ID in response header
  res.setHeader('X-Request-ID', requestId);
  
  // Create a request-scoped logger with the request ID
  const requestLogger = createLogger('Request').setRequestId(requestId);
  res.locals.logger = requestLogger;
  
  // Log the start of the request
  requestLogger.info('Request received', {
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      ...req.headers,
      authorization: req.header('authorization') ? '[REDACTED]' : undefined,
    },
  });
  
  // Continue to next middleware or route handler
  next();
}

/**
 * Response logger middleware
 * Logs response after it's sent
 * This uses Express's on-finish event to log the response
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns void
 */
export function responseLogger(req: Request, res: Response, next: NextFunction) {
  // Get request ID and logger from locals
  const requestId = res.locals.requestId || 'unknown';
  const reqLogger = res.locals.logger || createLogger('ResponseLogger').setRequestId(requestId);
  
  // Start timer
  const start = performance.now();
  
  // Handle response finish event
  res.on('finish', () => {
    // Calculate request duration
    const duration = performance.now() - start;
    
    // Log response
    reqLogger.info('Response sent', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration.toFixed(2)}ms`,
    });
  });
  
  // Continue to next middleware
  next();
}
