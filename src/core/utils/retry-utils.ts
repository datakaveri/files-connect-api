/**
 * Retry Utilities
 * Provides utility functions for handling retries on transient errors
 */
import { createLogger } from './logger';

// Create a logger for this module
const logger = createLogger('RetryUtils');

/**
 * Configuration options for retry operations
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  
  /** Base delay in milliseconds between retries */
  baseDelayMs: number;
  
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  
  /** Whether to use exponential backoff for retry delays */
  useExponentialBackoff: boolean;
  
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  useExponentialBackoff: true,
  isRetryable: (error: unknown) => {
    // Default implementation for determining if an error is retryable
    if (error instanceof Error) {
      const errorName = error.name;
      const errorMessage = error.message.toLowerCase();
      
      // Common transient AWS S3 errors
      const retryableErrors = [
        'SlowDown',
        'ThrottlingException',
        'RequestTimeout',
        'RequestTimeTooSkewed',
        'InternalError',
        'ServiceUnavailable',
        'ConnectionError',
        'NetworkError',
        'ECONNRESET',
        'ETIMEDOUT',
        'EPIPE',
        'ENOTFOUND',
        'ECONNREFUSED'
      ];
      
      // Check if error name or message contains any of the retryable error patterns
      return retryableErrors.some(errPattern => 
        errorName.includes(errPattern) || errorMessage.includes(errPattern.toLowerCase())
      );
    }
    
    return false;
  }
};

/**
 * Calculates the delay for the next retry attempt
 * 
 * @param attempt - Current attempt number (0-based)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
function calculateRetryDelay(attempt: number, options: RetryOptions): number {
  const { baseDelayMs, maxDelayMs, useExponentialBackoff } = options;
  
  if (useExponentialBackoff) {
    // Exponential backoff with jitter
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.2 * exponentialDelay; // Add up to 20% jitter
    return Math.min(exponentialDelay + jitter, maxDelayMs);
  } else {
    // Linear backoff with jitter
    const linearDelay = baseDelayMs * (attempt + 1);
    const jitter = Math.random() * 0.2 * linearDelay; // Add up to 20% jitter
    return Math.min(linearDelay + jitter, maxDelayMs);
  }
}

/**
 * Executes a function with retry logic for transient errors
 * 
 * @param operation - Function to execute with retry logic
 * @param options - Retry options
 * @param context - Additional context for logging
 * @returns Promise resolving to the result of the operation
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context: Record<string, any> = {}
): Promise<T> {
  // Merge provided options with defaults
  const retryOptions: RetryOptions = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };
  
  const { maxRetries, isRetryable } = retryOptions;
  let attempt = 0;
  
  while (true) {
    try {
      // Attempt the operation
      return await operation();
    } catch (error) {
      // Check if we've exceeded max retries or if the error is not retryable
      if (
        attempt >= maxRetries || 
        (isRetryable && !isRetryable(error))
      ) {
        // Log the final failure and rethrow
        logger.error(
          `Operation failed after ${attempt + 1} attempts`,
          error instanceof Error ? error : new Error(String(error)),
          { ...context, maxRetries, finalAttempt: attempt + 1 }
        );
        throw error;
      }
      
      // Calculate delay for next retry
      const delayMs = calculateRetryDelay(attempt, retryOptions);
      
      // Log retry attempt
      logger.warn(
        `Operation failed, retrying in ${delayMs.toFixed(0)}ms (attempt ${attempt + 1}/${maxRetries})`,
        { 
          ...context, 
          attempt: attempt + 1, 
          maxRetries,
          delayMs,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : 'UnknownError'
        }
      );
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Increment attempt counter
      attempt++;
    }
  }
}

/**
 * Creates a retryable version of a function
 * 
 * @param fn - Function to make retryable
 * @param options - Retry options
 * @returns A new function that wraps the original with retry logic
 */
export function makeRetryable<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: Partial<RetryOptions> = {}
): T {
  // Use unknown as an intermediate type to satisfy TypeScript
  return ((...args: Parameters<T>): ReturnType<T> => {
    return withRetry(
      () => fn(...args),
      options,
      { functionName: fn.name }
    ) as ReturnType<T>;
  }) as unknown as T;
}
