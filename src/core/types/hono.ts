/**
 * Type definitions for Hono context extensions
 */
import { Context } from 'hono';

/**
 * Extended Hono context with custom variables
 */
declare module 'hono' {
  interface ContextVariableMap {
    // Authentication related
    userId: string;
    userRole: string;
    databankId: string;
    
    // Validation related
    validatedBody: any;
    
    // Request tracing
    requestId: string;
  }
}
