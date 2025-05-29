/**
 * Type definitions for Express request with extended locals
 */
import { Request, Response } from 'express';

/**
 * Extended Express request with custom variables
 */
export interface RequestWithUser extends Request {
  user?: any; // Optional user property
  userId?: string;
  userRole?: string;
  databankId?: string;
  validatedBody?: any;
  requestId?: string;
}

/**
 * Type definitions for Express response with extended locals
 */
export interface ResponseLocals {
  user?: any; // User information
  role?: string; // User role
  requestId?: string; // Request ID for tracking
  startTime?: number; // Start time for performance tracking
  [key: string]: any; // Allow any other properties
}
