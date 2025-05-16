/**
 * Logger utility for structured logging
 */
import pino from 'pino';

// Define log levels
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Create a pino logger instance
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Redact sensitive information
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.token',
  ],
  // Use standard serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Format timestamp as ISO string
  timestamp: pino.stdTimeFunctions.isoTime,
  // Add base properties to all logs
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'multipart-upload-middleware',
  },
});

/**
 * Logger interface for consistent logging throughout the application
 */
export interface Logger {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, error?: Error, context?: Record<string, any>): void;
  fatal(message: string, error?: Error, context?: Record<string, any>): void;
  
  /**
   * Sets the request ID for this logger instance
   * @param requestId - The request ID to set
   * @returns The same logger instance with request ID set
   */
  setRequestId(requestId: string): Logger;
}

/**
 * Creates a logger instance with a specific context
 * @param context - Context name for the logger
 * @returns Logger instance
 */
export function createLogger(context: string): Logger {
  let contextLogger = logger.child({ context });
  let requestId: string | undefined;
  
  const loggerInstance = {
    debug(message: string, additionalContext?: Record<string, any>) {
      contextLogger.debug(additionalContext || {}, message);
    },
    
    info(message: string, additionalContext?: Record<string, any>) {
      contextLogger.info(additionalContext || {}, message);
    },
    
    warn(message: string, additionalContext?: Record<string, any>) {
      contextLogger.warn(additionalContext || {}, message);
    },
    
    error(message: string, error?: Error, additionalContext?: Record<string, any>) {
      contextLogger.error(
        {
          ...(additionalContext || {}),
          ...(error ? { error: { message: error.message, stack: error.stack } } : {}),
        },
        message
      );
    },
    
    fatal(message: string, error?: Error, additionalContext?: Record<string, any>) {
      contextLogger.fatal(
        {
          ...(additionalContext || {}),
          ...(error ? { error: { message: error.message, stack: error.stack } } : {}),
        },
        message
      );
    },
    
    /**
     * Sets the request ID for this logger instance
     * @param id - The request ID to set
     * @returns The same logger instance with request ID set
     */
    setRequestId(id: string): Logger {
      requestId = id;
      contextLogger = contextLogger.child({ requestId });
      return loggerInstance;
    }
  };
  
  return loggerInstance;
}
