/**
 * Logger Middleware
 * Provides request logging and request ID generation
 */
import { Context, Next } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('RequestLogger');

/**
 * Request context middleware
 * Generates a unique request ID and adds it to the request context
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function requestContext(c: Context, next: Next) {
  // Generate or use existing request ID
  const requestId = c.req.header('X-Request-ID') || uuidv4();
  
  // Set request ID in context
  c.set('requestId', requestId);
  
  // Set request ID in response header
  c.header('X-Request-ID', requestId);
  
  // Create a request-scoped logger with the request ID
  const requestLogger = createLogger('Request').setRequestId(requestId);
  c.set('logger', requestLogger);
  
  // Continue to next middleware or route handler
  await next();
}

/**
 * Request logger middleware
 * Logs incoming requests and outgoing responses
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function requestLogger(c: Context, next: Next) {
  // Get request ID and logger from context
  const requestId = c.get('requestId') || 'unknown';
  const reqLogger = c.get('logger') || createLogger('RequestLogger').setRequestId(requestId);
  
  // Start timer
  const start = performance.now();
  
  // Log request
  reqLogger.info('Request received', {
    method: c.req.method,
    path: c.req.path,
    query: c.req.query(),
    headers: {
      ...c.req.header(),
      authorization: c.req.header('authorization') ? '[REDACTED]' : undefined,
    },
  });
  
  try {
    // Continue to next middleware or route handler
    await next();
  } finally {
    // Calculate request duration
    const duration = performance.now() - start;
    
    // Get response status from context
    const status = c.res.status;
    
    // Log response
    reqLogger.info('Response sent', {
      method: c.req.method,
      path: c.req.path,
      status,
      duration: `${duration.toFixed(2)}ms`,
    });
  }
}
