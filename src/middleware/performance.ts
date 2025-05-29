/**
 * Performance Monitoring Middleware
 * Tracks request execution time and reports performance metrics
 */
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../core/utils/logger';

// Extend Express Response interface to include our custom methods
declare global {
  namespace Express {
    interface Response {
      setExecutionTimeHeader: () => void;
    }
  }
}

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
 * @param req - Express request
 * @param res - Express response
 * @param next - Next function
 * @returns void
 */
export function performanceMonitor(req: Request, res: Response, next: NextFunction) {
  // Get request ID and logger from response locals
  const requestId = res.locals.requestId || 'unknown';
  const reqLogger = res.locals.logger || createLogger('PerformanceMonitor').setRequestId(requestId);
  
  // Start performance measurement
  const startTime = performance.now();
  
  // Store the startTime in res.locals for potential use by other middleware
  res.locals.requestStartTime = startTime;
  
  // Function to log performance after request is complete
  const logPerformance = () => {
    // Calculate execution time
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    
    // Log performance metrics based on thresholds
    const method = req.method;
    const path = req.path;
    const status = res.statusCode;
    
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
  };
  
  // Add execution time to response headers just before sending response
  res.on('finish', () => {
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    
    // Add execution time to response headers (too late to set headers, but still log it)
    logPerformance();
  });
  
  // Add a custom function to res to set execution time header
  // This can be used by route handlers if needed
  res.setExecutionTimeHeader = () => {
    const endTime = performance.now();
    const executionTime = endTime - startTime;
    res.setHeader('X-Execution-Time', `${executionTime.toFixed(2)}ms`);
  };
  
  // Set the execution time header by default
  res.setHeader('X-Execution-Time', '0.00ms');
  
  // Continue to next middleware
  next();
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
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Get request ID and logger from response locals
    const requestId = res.locals.requestId || 'unknown';
    const reqLogger = res.locals.logger || createLogger('PerformanceMonitor').setRequestId(requestId);
    
    // Start performance measurement
    const startTime = performance.now();
    
    // Store the startTime in res.locals for potential use by other middleware
    res.locals.requestStartTime = startTime;
    
    // Function to log performance after request is complete
    const logPerformance = () => {
      // Calculate execution time
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      // Log performance metrics based on thresholds
      const method = req.method;
      const path = req.path;
      const status = res.statusCode;
      
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
    };
    
    // Add execution time to response headers just before sending response
    res.on('finish', () => {
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      // Log performance data
      logPerformance();
    });
    
    // Add a custom function to res to set execution time header
    res.setExecutionTimeHeader = () => {
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      res.setHeader('X-Execution-Time', `${executionTime.toFixed(2)}ms`);
    };
    
    // Set the execution time header by default
    res.setHeader('X-Execution-Time', '0.00ms');
    
    // Continue to next middleware
    next();
  };
}
