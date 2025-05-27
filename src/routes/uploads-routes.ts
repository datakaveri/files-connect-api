/**
 * Uploads Routes
 * Handles REST operations for file uploads
 */
import { Hono, Context } from "hono";
import { z } from "zod";
import { createS3Service } from "../services/s3-service";
import { createLogger } from "../core/utils/logger";
import { 
  authenticate, 
  authorize 
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { errorBoundary } from "../middleware/error-handler";
import { requestLogger, requestContext } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { 
  createMultipartUploadService,
  PresignedUrlRequest, 
  FinalizeMultipartUploadRequest 
} from "../services/multipart-upload-service";

// Create a logger for this module
const logger = createLogger('UploadsRoutes');

// Create services
const s3Service = createS3Service();
const multipartUploadService = createMultipartUploadService(s3Service);

// Define schemas for multipart upload requests
const presignedUrlSchema = z.object({
  chunkSizes: z.array(z.number()),
  fileName: z.string().min(1, 'File name is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  databankId: z.string().min(1, 'Databank ID is required')
});

const finalizeUploadSchema = z.object({
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

/**
 * Create a new Hono router for upload operations
 */
export const uploadsRoutes = new Hono();

// Apply common middleware to all routes
uploadsRoutes.use('*', errorBoundary, requestContext, requestLogger);

/**
 * POST /uploads
 * Initiate a multipart upload and get presigned URLs
 */
uploadsRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can initiate uploads
  validateBody(presignedUrlSchema),
  async (c: Context) => {
    try {
      logger.info('Initiating multipart upload');
      
      const body = (c as any)[VALIDATED_BODY] as PresignedUrlRequest;
      const databankId = c.get('databankId') as string;
      
      // Ensure databankId is set
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      // Generate presigned URLs for each part
      const result = await multipartUploadService.generatePresignedUrls(body);
      
      return c.json({
        uploadId: result.uploadId,
        fileKey: result.fileKey,
        urls: result.urls,
        expiresIn: result.expiresIn
      });
    } catch (error) {
      logger.error(`Error initiating upload: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
);

/**
 * PUT /uploads/:uploadId
 * Finalize a multipart upload
 */
uploadsRoutes.put(
  '/:uploadId',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can finalize uploads
  validateBody(finalizeUploadSchema),
  async (c: Context) => {
    try {
      const uploadId = c.req.param('uploadId');
      const body = (c as any)[VALIDATED_BODY] as FinalizeMultipartUploadRequest;
      const databankId = c.get('databankId') as string;
      
      // Ensure uploadId from URL matches body
      if (body.uploadId !== uploadId) {
        throw new Error('Upload ID in URL does not match body');
      }
      
      // Ensure databankId is set
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      logger.info(`Finalizing multipart upload: uploadId=${uploadId}, databankId=${databankId}`);
      
      // Finalize the multipart upload
      const result = await multipartUploadService.finalizeMultipartUpload(body);
      
      return c.json({
        key: result.key,
        location: result.location,
        etag: result.etag
      });
    } catch (error) {
      logger.error(`Error finalizing upload: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
);

/**
 * Creates a new uploads routes instance
 * @returns Uploads routes instance
 */
export function createUploadsRoutes() {
  return uploadsRoutes;
}
