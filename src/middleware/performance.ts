/**
 * Performance Monitoring Middleware
 * Tracks request execution time and reports performance metrics
 */
import { Context, Next } from 'hono';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('PerformanceMonitor');

// Define thresholds for performance monitoring (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
  ACCEPTABLE: 500,    // Requests under 500ms are considered fast
  WARNING: 1000,      // Requests between 500ms and 1000ms trigger a warning
  CRITICAL: 3000      // Requests over 3000ms trigger a critical warning
};

/**
 * Performance monitoring middleware
 * Tracks request execution time and logs performance metrics
 * 
 * @param c - Hono context
 * @param next - Next function
 * @returns Response from the next middleware or route handler
 */
export async function performanceMonitor(c: Context, next: Next) {
  // Get request ID and logger from context
  const requestId = c.get('requestId') || 'unknown';
  const reqLogger = c.get('logger') || createLogger('PerformanceMonitor').setRequestId(requestId);
  
  // Start performance measurement
  const startTime = performance.now();
  
  try {
    // Continue to next middleware or route handler
    await next();
  } finally {
    // Calculate execution time
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    
    // Add execution time to response headers
    c.header('X-Execution-Time', `${executionTime.toFixed(2)}ms`);
    
    // Log performance metrics based on thresholds
    const method = c.req.method;
    const path = c.req.path;
    const status = c.res.status;
    
    const performanceData = {
      method,
      path,
      status,
      executionTime: `${executionTime.toFixed(2)}ms`,
      executionTimeRaw: executionTime
    };
    
    if (executionTime > PERFORMANCE_THRESHOLDS.CRITICAL) {
      reqLogger.warn(`CRITICAL PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
    } else if (executionTime > PERFORMANCE_THRESHOLDS.WARNING) {
      reqLogger.warn(`SLOW PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
    } else if (executionTime > PERFORMANCE_THRESHOLDS.ACCEPTABLE) {
      reqLogger.info(`MODERATE PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
    } else {
      reqLogger.debug(`GOOD PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
    }
  }
}

/**
 * Creates a performance monitor middleware with custom thresholds
 * 
 * @param options - Custom threshold options
 * @returns Performance monitor middleware function
 */
export function createPerformanceMonitor(options?: {
  acceptable?: number;
  warning?: number;
  critical?: number;
}) {
  // Override default thresholds with custom options
  const thresholds = {
    ACCEPTABLE: options?.acceptable || PERFORMANCE_THRESHOLDS.ACCEPTABLE,
    WARNING: options?.warning || PERFORMANCE_THRESHOLDS.WARNING,
    CRITICAL: options?.critical || PERFORMANCE_THRESHOLDS.CRITICAL
  };
  
  return async (c: Context, next: Next) => {
    // Get request ID and logger from context
    const requestId = c.get('requestId') || 'unknown';
    const reqLogger = c.get('logger') || createLogger('PerformanceMonitor').setRequestId(requestId);
    
    // Start performance measurement
    const startTime = performance.now();
    
    try {
      // Continue to next middleware or route handler
      await next();
    } finally {
      // Calculate execution time
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      // Add execution time to response headers
      c.header('X-Execution-Time', `${executionTime.toFixed(2)}ms`);
      
      // Log performance metrics based on thresholds
      const method = c.req.method;
      const path = c.req.path;
      const status = c.res.status;
      
      const performanceData = {
        method,
        path,
        status,
        executionTime: `${executionTime.toFixed(2)}ms`,
        executionTimeRaw: executionTime
      };
      
      if (executionTime > thresholds.CRITICAL) {
        reqLogger.warn(`CRITICAL PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
      } else if (executionTime > thresholds.WARNING) {
        reqLogger.warn(`SLOW PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
      } else if (executionTime > thresholds.ACCEPTABLE) {
        reqLogger.info(`MODERATE PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
      } else {
        reqLogger.debug(`GOOD PERFORMANCE: Request took ${executionTime.toFixed(2)}ms to complete`, performanceData);
      }
    }
  };
}
