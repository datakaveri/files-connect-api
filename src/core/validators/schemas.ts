/**
 * Validation schemas for API requests
 * Using Zod for runtime validation and TypeScript type generation
 */
import { z } from 'zod';
import { FileTypes } from '../../config/constants';

/**
 * Schema for S3 list objects request
 */
export const listObjectsSchema = z.object({
  /** Prefix to filter objects by */
  prefix: z.string().optional(),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Maximum number of keys to return */
  maxKeys: z.number().int().positive().optional(),
});

/**
 * Schema for S3 get object request
 */
export const getObjectSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Expiration time in seconds */
  expiresIn: z.number().int().positive().optional(),
});

/**
 * Schema for S3 create folder request
 */
export const createFolderSchema = z.object({
  /** Folder path (must end with slash) */
  folderPath: z.string().min(1, 'Folder path is required').endsWith('/', 'Folder path must end with a slash'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
});

/**
 * Schema for S3 delete object request
 */
export const deleteObjectSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Whether to delete recursively (for folders) */
  recursive: z.boolean().optional().default(false),
});

/**
 * Schema for folder deletion request
 */
export const folderDeleteSchema = z.object({
  /** Folder key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
});

/**
 * Schema for file preview request
 */
export const filePreviewSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** File type for preview */
  fileType: z.enum([
    FileTypes.CSV, 
    FileTypes.JSON, 
    FileTypes.XML, 
    FileTypes.XLSX
  ] as const).optional(),
  
  /** Maximum number of lines to return */
  maxLines: z.number().int().positive().optional(),
});

/**
 * Schema for multipart upload initialization request
 */
export const initMultipartUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Content type of the file */
  contentType: z.string().optional(),
});

/**
 * Schema for multipart upload completion request
 */
export const completeMultipartUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Upload ID */
  uploadId: z.string().min(1, 'Upload ID is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** List of uploaded parts */
  parts: z.array(
    z.object({
      PartNumber: z.number().int().positive(),
      ETag: z.string().min(1),
    })
  ).min(1, 'At least one part is required'),
});

/**
 * Schema for multipart upload abort request
 */
export const abortMultipartUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Upload ID */
  uploadId: z.string().min(1, 'Upload ID is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
});

/**
 * Schema for presigned URL generation request
 */
export const presignedUrlSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Expiration time in seconds */
  expiresIn: z.number().int().positive().optional(),
});

/**
 * Schema for lambda trigger request
 */
export const lambdaTriggerSchema = z.object({
  /** Databank ID for authorization */
  databankId: z.string().min(1, 'Databank ID is required'),
  
  /** Function name to trigger */
  functionName: z.string().min(1, 'Function name is required'),
  
  /** Payload to send to the function */
  payload: z.record(z.any()).optional(),
});

// Export type definitions derived from schemas
// Note: S3 route types have been moved to core/types/s3-routes.ts
export type FilePreviewRequest = z.infer<typeof filePreviewSchema>;
export type InitMultipartUploadRequest = z.infer<typeof initMultipartUploadSchema>;
export type CompleteMultipartUploadRequest = z.infer<typeof completeMultipartUploadSchema>;
export type AbortMultipartUploadRequest = z.infer<typeof abortMultipartUploadSchema>;
export type PresignedUrlRequest = z.infer<typeof presignedUrlSchema>;
export type LambdaTriggerRequest = z.infer<typeof lambdaTriggerSchema>;

// Re-export these for backward compatibility
export type { 
  ListObjectsRequest,
  GetObjectRequest,
  CreateFolderRequest,
  DeleteObjectRequest
} from '../types/s3-routes';
