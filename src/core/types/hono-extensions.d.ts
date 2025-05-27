/**
 * Type definitions for Hono framework extensions
 */

import { Context } from 'hono';
import { UserRole } from './auth';

// Define these types here instead of importing from deprecated route files
type PresignedListRequest = {
  key: string;
  parts: number;
};

type CompleteMultipartUploadRequest = {
  key: string;
  uploadId: string;
  parts: Array<{ ETag: string; PartNumber: number }>;
};

declare module 'hono' {
  interface ContextVariableMap {
    // Authentication related
    userId: string;
    userRole: string; // Using string to match the existing implementation
    databankId: string;
    user: {
      id: string;
      role: UserRole;
      name?: string;
      email?: string;
    };
    
    // Validation related
    validatedBody: PresignedListRequest | CompleteMultipartUploadRequest | any;
    
    // Request tracing
    requestId: string;
  }
}
