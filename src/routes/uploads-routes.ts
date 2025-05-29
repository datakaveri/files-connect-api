/**
 * Uploads Routes
 * Handles REST operations for file uploads
 */
import express, { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import { createS3Service } from "../services/s3-service";
import { createLogger } from "../core/utils/logger";
import { 
  authenticate, 
  authorize 
} from "../middleware/auth";
import { validateBody } from "../middleware/validation";
import { errorHandler } from "../middleware/error-handler";
import { requestContext, responseLogger } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { successResponse, errorResponse } from "../core/utils/response";
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
 * Create a new Express router for upload operations
 */
export const uploadsRoutes = Router();

// Apply common middleware to all routes
uploadsRoutes.use(requestContext);

/**
 * POST /uploads
 * Initiate a multipart upload and get presigned URLs
 */
uploadsRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can initiate uploads
  validateBody(presignedUrlSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info('Initiating multipart upload');
      
      const body = req.body as PresignedUrlRequest;
      const databankId = res.locals.databankId as string;
      
      // Ensure databankId is set
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      // Generate presigned URLs for each part
      const result = await multipartUploadService.generatePresignedUrls(body);
      
      res.status(200).json({
        uploadId: result.uploadId,
        // Use signedUrls property which is in the interface
        signedUrls: result.signedUrls
      });
    } catch (error) {
      logger.error(`Error initiating upload: ${error instanceof Error ? error.message : String(error)}`);
      next(error);
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uploadId = req.params.uploadId;
      const body = req.body as FinalizeMultipartUploadRequest;
      const databankId = res.locals.databankId as string;
      
      // Ensure uploadId from URL matches body
      if (body.uploadId !== uploadId) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Upload ID in URL does not match body',
            code: 'VALIDATION_ERROR'
          }
        });
      }
      
      // Ensure databankId is set
      if (!body.databankId) {
        body.databankId = databankId;
      }
      
      logger.info(`Finalizing multipart upload: uploadId=${uploadId}, databankId=${databankId}`);
      
      // Finalize the multipart upload
      const result = await multipartUploadService.finalizeMultipartUpload(body);
      
      res.status(200).json({
        message: result.message,
        location: result.location,
        etag: result.etag
      });
    } catch (error) {
      logger.error(`Error finalizing upload: ${error instanceof Error ? error.message : String(error)}`);
      next(error);
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
