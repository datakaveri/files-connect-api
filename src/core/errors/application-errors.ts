/**
 * Application Error Classes
 * This file contains custom error classes for the application
 */
import { ErrorCode } from '../types/error';

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class ApplicationError extends Error {
  /**
   * Creates a new ApplicationError
   * @param message - Error message
   * @param statusCode - HTTP status code
   * @param code - Error code
   * @param details - Additional error details
   */
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = ErrorCode.INTERNAL_SERVER_ERROR,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ApplicationError.prototype);
  }
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends ApplicationError {
  /**
   * Creates a new NotFoundError
   * @param resource - Resource type that was not found
   * @param id - Resource ID that was not found
   */
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with ID ${id}` : ''} not found`,
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
      { resource, id }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends ApplicationError {
  /**
   * Creates a new ValidationError
   * @param message - Error message
   * @param details - Validation error details
   */
  constructor(message: string = 'Validation failed', details?: Record<string, any>) {
    super(
      message,
      400,
      ErrorCode.VALIDATION_ERROR,
      details
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ApplicationError {
  /**
   * Creates a new AuthenticationError
   * @param message - Error message
   * @param details - Authentication error details
   */
  constructor(message: string = 'Authentication failed', details?: Record<string, any>) {
    super(
      message,
      401,
      ErrorCode.UNAUTHORIZED,
      details
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown when authorization fails
 */
export class AuthorizationError extends ApplicationError {
  /**
   * Creates a new AuthorizationError
   * @param message - Error message
   * @param details - Authorization error details
   */
  constructor(message: string = 'Unauthorized access', details?: Record<string, any>) {
    super(
      message,
      403,
      ErrorCode.FORBIDDEN,
      details
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

/**
 * Error thrown when a resource already exists
 */
export class ConflictError extends ApplicationError {
  /**
   * Creates a new ConflictError
   * @param resource - Resource type that already exists
   * @param id - Resource ID that already exists
   */
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with ID ${id}` : ''} already exists`,
      409,
      ErrorCode.RESOURCE_ALREADY_EXISTS,
      { resource, id }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

/**
 * Error thrown when an S3 operation fails
 */
export class S3Error extends ApplicationError {
  /**
   * Creates a new S3Error
   * @param message - Error message
   * @param operation - S3 operation that failed
   * @param details - Additional error details
   */
  constructor(message: string, operation: string, details?: Record<string, any>) {
    super(
      message,
      500,
      ErrorCode.S3_ERROR,
      { operation, ...details }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, S3Error.prototype);
  }
}

/**
 * Interface for Lambda error details
 */
interface LambdaErrorDetails {
  /** Additional contextual information about the error */
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Error thrown when a Lambda operation fails
 */
export class LambdaError extends ApplicationError {
  /**
   * Creates a new LambdaError
   * @param message - Error message
   * @param functionName - Lambda function name
   * @param details - Additional error details
   */
  constructor(message: string, functionName: string, details?: LambdaErrorDetails) {
    super(
      message,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
      { functionName, ...details }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, LambdaError.prototype);
  }
}

/**
 * Error thrown when a service is unavailable
 */
export class ServiceUnavailableError extends ApplicationError {
  /**
   * Creates a new ServiceUnavailableError
   * @param service - Service that is unavailable
   * @param details - Additional error details
   */
  constructor(service: string, details?: Record<string, any>) {
    super(
      `Service ${service} is currently unavailable`,
      503,
      ErrorCode.SERVICE_UNAVAILABLE,
      { service, ...details }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

/**
 * Error thrown when file processing fails
 */
export class FileProcessingError extends ApplicationError {
  /**
   * Creates a new FileProcessingError
   * @param message - Error message
   * @param options - Error options
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
      { cause: options?.cause }
    );
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, FileProcessingError.prototype);
  }
}
