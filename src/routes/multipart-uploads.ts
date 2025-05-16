import { Hono, Context, Next } from "hono";
import { z } from "zod";
import { createS3Service } from "../services/s3-service";
import { HTTPException } from "hono/http-exception";
import { ValidationError, S3Error } from "../core/errors";
import { createLogger } from "../core/utils/logger";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { UserRole } from "../core/types/auth";
import { 
  createMultipartUploadService, 
  PresignedUrlRequest, 
  FinalizeMultipartUploadRequest 
} from "../services/multipart-upload-service";

// We'll use the built-in Context type from Hono
// The auth middleware adds properties to the context that we can access with c.get()

// Create a logger for this module
const logger = createLogger('MultipartUploadRoutes');

// Create service instances
const s3Service = createS3Service();
const multipartUploadService = createMultipartUploadService(s3Service);

// Define schemas for multipart upload requests
const presignedListBodySchema = z.object({
  chunkSizes: z.array(z.number()),
  fileName: z.string().min(1, 'File name is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  databankId: z.string().min(1, 'Databank ID is required')
});

const multipartUploadBodySchema = z.object({
  uploadId: z.string().min(1, 'Upload ID is required'),
  // Allow either fileKey or fileName to be provided
  fileKey: z.string().optional(),
  fileName: z.string().optional(),
  parts: z.array(z.object({ 
    ETag: z.string().min(1, 'ETag is required'), 
    PartNumber: z.number().int().positive() 
  })),
  databankId: z.string().min(1, 'Databank ID is required')
}).refine(data => data.fileKey || data.fileName, {
  message: "Either fileKey or fileName must be provided",
  path: ["fileKey"],
});

// Type definitions for request bodies
export type PresignedListRequest = z.infer<typeof presignedListBodySchema>;
export type CompleteMultipartUploadRequest = z.infer<typeof multipartUploadBodySchema>;

/**
 * Create a new Hono router for multipart upload operations
 */
export const multipartUploadRoutes = new Hono();

// Apply common middleware to all routes
multipartUploadRoutes.use('*', (c, next) => next());

/**
 * Route to generate presigned URLs for multipart upload
 */
multipartUploadRoutes.post(
  '/presigned-url',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can initiate multipart uploads
  async (c: Context, next: Next) => {
    try {
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      // Get the request body
      const body = await c.req.json();
      
      // Add the databankId to the request body if not present
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      // Set the validated body in the context
      c.set('validatedBody', body);
      
      // Continue to the next middleware
      await next();
    } catch (error) {
      logger.error(`Error processing presigned URL request: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(presignedListBodySchema),
  async (c) => {
    try {
      logger.info('Initiating multipart upload request');
      
      // Get the validated request body from the context using the symbol
      const body = (c as any)[VALIDATED_BODY] as PresignedListRequest;
      // Validation middleware has already validated this body
      
      // Get the databank ID from the request body (added by our middleware)
      const databankId = body.databankId;
      
      // Prepare request for the service
      const request: PresignedUrlRequest = {
        chunkSizes: body.chunkSizes,
        fileName: body.fileName,
        mimeType: body.mimeType,
        databankId
      };
      
      // Call the service to handle business logic
      const result = await multipartUploadService.generatePresignedUrls(request);
      
      // Return the response
      return c.json(result);
    } catch (error) {
      logger.error('Error in multipart upload presigned URL generation', error instanceof Error ? error : new Error(String(error)));
      
      // Re-throw ApplicationErrors and HTTPExceptions
      if (error instanceof ValidationError || error instanceof S3Error || error instanceof HTTPException) {
        throw error;
      }
      
      // For other errors, throw a generic S3Error
      throw new S3Error(
        'Failed to initiate multipart upload',
        'CreateMultipartUpload',
        { cause: error }
      );
    }
  }
);
/**
 * Route to finalize a multipart upload
 */
multipartUploadRoutes.post(
  '/finalize',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can finalize multipart uploads
  async (c: Context, next: Next) => {
    try {
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      // Get the request body
      const body = await c.req.json();
      
      // Add the databankId to the request body if not present
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      // Set the validated body in the context
      c.set('validatedBody', body);
      
      // Continue to the next middleware
      await next();
    } catch (error) {
      logger.error(`Error processing finalize request: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(multipartUploadBodySchema),
  async (c) => {
    try {
      logger.info('Finalizing multipart upload');
      
      // Get the validated request body from the context using the symbol
      const body = (c as any)[VALIDATED_BODY] as CompleteMultipartUploadRequest;
      // Validation middleware has already validated this body
      
      // Get the databank ID from the request body (added by our middleware)
      const databankId = body.databankId;
      
      // Prepare request for the service
      const request: FinalizeMultipartUploadRequest = {
        uploadId: body.uploadId,
        fileKey: body.fileKey,
        fileName: body.fileName,
        parts: body.parts,
        databankId
      };
      
      // Call the service to handle business logic
      const result = await multipartUploadService.finalizeMultipartUpload(request);
      
      // Return the response
      return c.json(result);
    } catch (error) {
      logger.error('Error in finalizing multipart upload', error instanceof Error ? error : new Error(String(error)));
      
      // Re-throw ApplicationErrors and HTTPExceptions
      if (error instanceof ValidationError || error instanceof S3Error || error instanceof HTTPException) {
        throw error;
      }
      
      // For other errors, throw a generic S3Error
      throw new S3Error(
        'Failed to complete multipart upload',
        'CompleteMultipartUpload',
        { cause: error }
      );
    }
  }
);
