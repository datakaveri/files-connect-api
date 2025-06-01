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
  
  /** Maximum number of keys to return */
  maxKeys: z.number().int().positive().optional(),
  
  /** Delimiter for grouping objects */
  delimiter: z.string().optional(),
  
  /** Whether to get files recursively (including nested directories) */
  recursive: z.boolean().optional().default(false),
});

/**
 * Schema for S3 get object request
 */
export const getObjectSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Expiration time in seconds */
  expiresIn: z.number().int().positive().optional(),
  
  /** Whether to return a presigned URL instead of the file content */
  presigned: z.boolean().optional(),
});

/**
 * Schema for S3 create folder request
 */
export const createFolderSchema = z.object({
  /** Folder path (must end with slash) */
  folderPath: z.string().min(1, 'Folder path is required').endsWith('/', 'Folder path must end with a slash')
});

/**
 * Schema for S3 delete object request
 */
export const deleteObjectSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Whether to delete recursively (for folders) */
  recursive: z.boolean().optional().default(false),
});

/**
 * Schema for folder deletion request
 */
export const folderDeleteSchema = z.object({
  /** Folder key */
  key: z.string().min(1, 'Key is required'),
});

/**
 * Schema for file preview request
 */
export const filePreviewSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
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
export const initiateUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** Number of parts to upload */
  numParts: z.number().int().positive('Number of parts must be a positive integer'),
  
  /** Content type of the file */
  contentType: z.string().optional(),
});

/**
 * Schema for processing job creation request
 */
export const createProcessingJobSchema = z.object({
  /** Type of processing job (e.g. 'zip', 'report') */
  type: z.string().min(1, 'Job type is required'),
  
  /** Optional prefix to filter files in the databank */
  prefix: z.string().optional(),
  
  /** Optional processing options */
  options: z.record(z.any()).optional(),
});

/**
 * Schema for processing job status update request
 */
export const updateProcessingJobStatusSchema = z.object({
  /** New status for the job */
  status: z.string().min(1, 'Status is required'),
  
  /** Optional progress value (0-100) */
  progress: z.number().min(0).max(100).optional(),
  
  /** Optional error message if job failed */
  error: z.string().optional(),
  
  /** Optional result data if job completed */
  result: z.record(z.any()).optional(),
});

/**
 * Schema for multipart upload completion request
 */
export const completeUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
  /** List of uploaded parts */
  parts: z.array(
    z.object({
      // Accept both camelCase and PascalCase property names
      PartNumber: z.number().int().positive().optional(),
      partNumber: z.number().int().positive().optional(),
      ETag: z.string().min(1).optional(),
      eTag: z.string().min(1).optional(),
    })
    // Ensure at least one of each property exists
    .refine(data => data.PartNumber !== undefined || data.partNumber !== undefined, {
      message: 'PartNumber is required',
      path: ['PartNumber']
    })
    .refine(data => data.ETag !== undefined || data.eTag !== undefined, {
      message: 'ETag is required',
      path: ['ETag']
    })
  ).min(1, 'At least one part is required'),
});

/**
 * Schema for multipart upload abort request
 * Note: uploadId and databankId are provided as route parameters
 */
export const abortMultipartUploadSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
});

/**
 * Schema for presigned URL generation request
 */
export const presignedUrlSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required'),
  
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

/**
 * Schema for file metadata request
 */
export const fileMetadataSchema = z.object({
  /** S3 object key */
  key: z.string().min(1, 'Key is required')
});

// Export type definitions derived from schemas
// Note: S3 route types have been moved to core/types/s3-routes.ts
export type FilePreviewRequest = z.infer<typeof filePreviewSchema>;
export type FileMetadataRequest = z.infer<typeof fileMetadataSchema>;
export type InitiateUploadRequest = z.infer<typeof initiateUploadSchema>;
export type CompleteMultipartUploadRequest = z.infer<typeof completeUploadSchema>;
export type AbortMultipartUploadRequest = z.infer<typeof abortMultipartUploadSchema>;
export type PresignedUrlRequest = z.infer<typeof presignedUrlSchema>;
export type LambdaTriggerRequest = z.infer<typeof lambdaTriggerSchema>;
export type CreateProcessingJobRequest = z.infer<typeof createProcessingJobSchema>;
export type UpdateProcessingJobStatusRequest = z.infer<typeof updateProcessingJobStatusSchema>;

// Re-export these for backward compatibility
export type { 
  ListObjectsRequest,
  GetObjectRequest,
  CreateFolderRequest,
  DeleteObjectRequest
} from '../types/s3-routes';
