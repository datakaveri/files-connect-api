/**
 * Databanks Routes
 * Handles all operations related to databanks, including:
 * - Files (listing, downloading, metadata, previewing)
 * - Uploads (multipart uploads)
 * - Processing (creating processing jobs and updating status)
 * - Downloads (downloading databank as zip)
 */
import { Router, Request, Response, NextFunction } from "express";
import { Readable } from 'stream';
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Service, S3ServiceInterface } from "../services/s3-service";
import { createFileService, FileService } from "../services/file-service";
import { createMultipartUploadService, MultipartUploadServiceInterface } from "../services/multipart-upload-service";
import { createProcessingService, ProcessingServiceInterface } from "../services/processing-service";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { ApiPaths, FileTypes } from "../config/constants";
import { 
  authenticate, 
  authorize,
  databankAccess 
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { UserRole } from "../core/types/auth";
import { FileType } from "../core/types/file";
import { buildResponse } from "../core/utils/route-utils";
import {
  ApplicationError,
  NotFoundError,
  ValidationError
} from "../core/errors/application-errors";
import {
  listObjectsSchema,
  getObjectSchema,
  filePreviewSchema,
  fileMetadataSchema,
  initiateUploadSchema,
  completeUploadSchema,
  createProcessingJobSchema,
  updateProcessingJobStatusSchema,
  lambdaTriggerSchema
} from "../core/validators/schemas";
import {
  FileListingResponse,
  FileMetadataResponse,
  FilePreviewResponse,
  UploadInitiationResponse,
  UploadCompletionResponse,
  ProcessingJobResponse
} from "../core/types/api-response";

// Create a logger for this module
const logger = createLogger('DatabanksRoutes');

// Create services
const s3Service: S3ServiceInterface = createS3Service();
const fileService: FileService = createFileService(s3Service);
const multipartUploadService: MultipartUploadServiceInterface = createMultipartUploadService(s3Service);
const processingService: ProcessingServiceInterface = createProcessingService();

/**
 * Create a new Express router for all databank operations
 */
export const databanksRoutes = Router();

// No need to apply additional common middleware since we're adding middleware to each route

//=============================================================================
// FILE OPERATIONS (Files in Databanks)
//=============================================================================

/**
 * POST /databanks/:databankId/files
 * List files in a databank directory
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_FILES}`,
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(listObjectsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Get validated data from request
    const body = req[VALIDATED_BODY];
    const databankId = req.params.databankId;
    
    logger.info(`Listing files: prefix=${body.prefix}, databankId=${databankId}`);
    
    // Get the delimiter from the request or use the default
    const delimiter = body.delimiter || '/';
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    // Ensure all parameters are valid strings or numbers
    const prefix = body.prefix || '';
    const maxKeys = body.maxKeys || 1000;
    
    // List objects using the S3 service
    const objects = await s3Service.listObjects(
      prefix,
      databankId,
      maxKeys,
      delimiter
    );
    
    // Process the objects and format the response following REST standards
    const response = buildResponse({
      files: objects.filter(obj => obj.isFile === true),
      directories: objects.filter(obj => obj.isFile === false)
    });
    
    // Send the response
    res.json(response);
  })
);

/**
 * POST /databanks/:databankId/files/download
 * Get/download a file from databank by key (key in request body)
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_FILES}/download`,
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(getObjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const { key, presigned } = req[VALIDATED_BODY];
    
    logger.info(`File download request: key=${key}, databankId=${databankId}, presigned=${presigned}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    // If presigned URL is requested, generate and return it
    if (presigned) {
      // Ensure key is a valid string
      if (!key) {
        throw new ValidationError('Key is required');
      }
      const presignedUrl = await s3Service.createPresignedUrl(key, databankId);
      
      const response = buildResponse({
        presignedUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() // URL expires in 1 hour
      });
      
      res.json(response);
      return;
    }
    
    // Otherwise, stream the file directly
    try {
      // Ensure key is a valid string
      if (!key) {
        throw new ValidationError('Key is required');
      }
      const object = await s3Service.getObject(key!, databankId);
      
      if (!object) {
        throw new NotFoundError(`File not found: ${key}`);
      }
      
      // Set appropriate headers for the file
      // Since object is a Readable stream, we need to set these manually
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop() || 'download'}"`
      });
      
      // Stream the file to the client
      if (object instanceof Readable) {
        object.pipe(res);
      } else {
        res.status(500).json({
          success: false,
          error: {
            message: 'Error streaming file content',
            code: 'STREAM_ERROR'
          }
        });
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: {
            message: error.message,
            code: 'RESOURCE_NOT_FOUND'
          }
        });
      } else {
        throw error; // Let the global error handler catch it
      }
    }
  })
);

/**
 * POST /databanks/:databankId/files/metadata
 * Get metadata for a file in the databank (key in request body)
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_FILES}/metadata`,
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(fileMetadataSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const { key } = req[VALIDATED_BODY];
    
    logger.info(`File metadata request: key=${key}, databankId=${databankId}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Ensure key is a valid string
      if (!key) {
        throw new ValidationError('Key is required');
      }
      const metadata = await s3Service.getObjectDetails(key!, databankId);
      
      // Handle null metadata
      if (!metadata) {
        throw new NotFoundError(`File not found: ${key}`);
      }
      
      const response = buildResponse({
        key,
        size: metadata.size || 0,
        lastModified: metadata.lastModified || new Date().toISOString(),
        contentType: metadata.contentType || 'application/octet-stream',
        // Use optional chaining for etag and cast to appropriate type
        etag: (metadata as any).etag?.replace(/\"/g, '') // Remove quotes from ETag
      });
      
      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: {
            message: `File not found: ${key}`,
            code: 'RESOURCE_NOT_FOUND'
          }
        });
      } else {
        throw error; // Let the global error handler catch it
      }
    }
  })
);

/**
 * POST /databanks/:databankId/files/preview
 * Generate a preview for a file in the databank (key in request body)
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_FILES}/preview`,
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(filePreviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const { key, maxLines, fileType } = req[VALIDATED_BODY];
    
    // For backward compatibility with existing code
    const lines = maxLines;
    const format = fileType;
    
    logger.info(`File preview request: key=${key}, databankId=${databankId}, lines=${lines}, format=${format}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Determine the file type from the key or the specified format
      // Provide default if detectFileType returns null
      const detectedType = key ? fileService.detectFileType(key) : null;
      const fileType = format || detectedType || FileTypes.JSON;
      
      if (!fileType) {
        throw new ValidationError('Unsupported file type or format not specified');
      }
      
      // Generate the preview
      // Generate preview with proper options object
      // Use non-null assertion for key since we've already validated it above
      const preview = await fileService.generatePreview({
        key: key!,
        databankId: databankId!,
        fileType: fileType as FileType,
        maxLines: lines || 100
      });
      
      const response = buildResponse({
        content: preview.data,
        format: fileType,
        truncated: preview.metadata.truncated,
        firstNLines: preview.metadata.previewLines,
        totalLines: preview.metadata.totalLines
      });
      
      res.json(response);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: {
            message: error.message,
            code: 'VALIDATION_ERROR'
          }
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: {
            message: `File not found: ${key}`,
            code: 'RESOURCE_NOT_FOUND'
          }
        });
      } else {
        throw error; // Let the global error handler catch it
      }
    }
  })
);

//=============================================================================
// UPLOAD OPERATIONS (Uploads to Databanks)
//=============================================================================

/**
 * POST /databanks/:databankId/uploads
 * Initiate a multipart upload to a databank
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_UPLOADS}`,
  authenticate,
  authorize([UserRole.PROVIDER]),
  validateBody(initiateUploadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const { key, numParts, contentType } = req[VALIDATED_BODY];
    
    logger.info(`Initiate upload request: key=${key}, databankId=${databankId}, numParts=${numParts}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Initiate the multipart upload
      // Ensure key is a valid string
      if (!key) {
        throw new ValidationError('Key is required');
      }
      
      const { uploadId, presignedUrls } = await multipartUploadService.initiateUpload(
        key!, 
        databankId, 
        numParts, 
        contentType || 'application/octet-stream' // Provide default content type if undefined
      );
      
      // Format the response with presigned URLs for each part
      const parts = presignedUrls.map((url, index) => ({
        partNumber: index + 1,
        presignedUrl: url
      }));
      
      const response = buildResponse({
        uploadId,
        key,
        parts
      });
      
      res.json(response);
    } catch (error) {
      // Handle validation errors specifically for file type validation
      if (error instanceof ValidationError && 
          (error.message.includes('File type not allowed') || 
           error.message.includes('Executable files'))) {
        logger.warn(`File type validation failed: ${error.message}`);
        return res.status(415).json({
          success: false,
          error: {
            message: error.message,
            code: 'UNSUPPORTED_MEDIA_TYPE'
          }
        });
      }
      throw error; // Let the global error handler catch it for other errors
    }
  })
);

/**
 * PUT /databanks/:databankId/uploads/:uploadId
 * Complete a multipart upload to a databank
 */
databanksRoutes.put(
  `/:databankId/${ApiPaths.DATABANK_UPLOADS}/:uploadId`,
  authenticate,
  authorize([UserRole.PROVIDER]),
  validateBody(completeUploadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const uploadId = req.params.uploadId;
    const { key, parts } = req[VALIDATED_BODY];
    
    logger.info(`Complete upload request: key=${key}, uploadId=${uploadId}, databankId=${databankId}, parts=${parts.length}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Complete the multipart upload
      // Validate that key and uploadId are present
      if (!key) {
        throw new ValidationError('Key is required');
      }
      if (!uploadId) {
        throw new ValidationError('Upload ID is required');
      }
      
      // Complete the multipart upload using the correct interface
      const uploadKey = await s3Service.completeMultipartUpload(
        key!, 
        uploadId!, 
        databankId, 
        parts
      );
      
      const result = {
        message: "Upload completed successfully",
        key: uploadKey,
        location: `${env.BUCKET_NAME}/${uploadKey}`
      };
      const response = buildResponse({
        etag: result.key ? result.key.split('/').pop() : undefined, // Extract etag from key if available
        key: result.key,
        location: result.location
      });
      
      res.json(response);
    } catch (error) {
      throw error; // Let the global error handler catch it
    }
  })
);

//=============================================================================
// PROCESSING OPERATIONS (Process jobs for Databanks)
//=============================================================================

/**
 * POST /databanks/:databankId/process
 * Create a processing job for a databank and trigger Lambda function
 * This endpoint creates a job and immediately triggers the appropriate Lambda function
 * TODO: Add DB logic to store job in database instead of in-memory
 */
databanksRoutes.post(
  `/:databankId/${ApiPaths.DATABANK_PROCESS}`,
  authenticate,
  authorize([UserRole.PROVIDER]),
  validateBody(createProcessingJobSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const { type, prefix, options } = req[VALIDATED_BODY];
    
    logger.info(`Create processing job request: type=${type}, databankId=${databankId}, prefix=${prefix}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Create the processing job
      // Validate the job type is provided
      if (!type) {
        throw new ValidationError('Job type is required');
      }
      
      const job = await processingService.createJob(type, databankId, prefix || undefined, options || undefined);
      
      const response = buildResponse({
        jobId: job.jobId,
        status: job.status,
        type: job.type,
        createdAt: job.createdAt.toISOString(),
        progress: job.progress
      });
      
      // Return 202 Accepted since the job is being processed asynchronously
      res.status(202).json(response);
    } catch (error) {
      throw error; // Let the global error handler catch it
    }
  })
);

/**
 * PUT /databanks/:databankId/process/:jobId/status
 * Update the status of a processing job
 * This endpoint will be called from Lambda functions to update job status
 * TODO: Implement proper authentication for Lambda function callbacks
 */
databanksRoutes.put(
  `/:databankId/${ApiPaths.DATABANK_PROCESS}/:jobId/status`,
  authenticate,
  authorize([UserRole.PROVIDER]),
  validateBody(updateProcessingJobStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    const jobId = req.params.jobId;
    const { status, progress, error, result } = req[VALIDATED_BODY];
    
    logger.info(`Update job status request: jobId=${jobId}, databankId=${databankId}, status=${status}`);
    
    // Validate the databankId parameter
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }
    
    try {
      // Validate job ID parameter
      if (!jobId) {
        throw new ValidationError('Job ID is required');
      }
      
      // Update the job status
      const updatedJob = await processingService.updateJobStatus(
        jobId,
        databankId,
        status,
        progress || undefined,
        error || undefined,
        result || undefined
      );
      
      const response = buildResponse({
        jobId: updatedJob.jobId,
        status: updatedJob.status,
        type: updatedJob.type,
        createdAt: updatedJob.createdAt.toISOString(),
        progress: updatedJob.progress,
        completedAt: updatedJob.completedAt?.toISOString(),
        error: updatedJob.error
      });
      
      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: {
            message: `Job not found: ${jobId}`,
            code: 'RESOURCE_NOT_FOUND'
          }
        });
      } else {
        throw error; // Let the global error handler catch it
      }
    }
  })
);


//=============================================================================
// DATABANK DOWNLOAD OPERATIONS
//=============================================================================

/**
 * GET /databanks/:databankId/download
 * Get a download URL for a databank zip file
 */
databanksRoutes.get(
  `/:databankId/${ApiPaths.DATABANK_DOWNLOAD}`,
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  asyncHandler(async (req: Request, res: Response) => {
    const databankId = req.params.databankId;
    
    logger.info(`Download request received for databankId: ${databankId}`);
    
    // Construct the ZIP file key
    const zipKey = `zips/${databankId}.zip`;
    
    // Check if the zip file exists
    try {
      const command = new GetObjectCommand({
        Bucket: env.BUCKET_NAME,
        Key: zipKey
      });
      
      // Get the S3 repository client directly for presigned URL generation
      const s3Client = (s3Service as any).s3Repository.client;
      
      // Generate a presigned URL for downloading the zip
      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 3600 // URL expires in 1 hour
      });
      
      logger.info(`Successfully generated download URL for key: ${zipKey}`);
      
      const response = buildResponse({
        downloadUrl: presignedUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
      });
      
      res.json(response);
    } catch (error) {
      // If the ZIP file doesn't exist
      logger.error(`Zip file not found: ${zipKey}, error: ${error instanceof Error ? error.message : String(error)}`);
      
      res.status(404).json({ 
        success: false,
        error: {
          message: `Zip file for databank ${databankId} not found`,
          code: 'RESOURCE_NOT_FOUND'
        }
      });
    }
  })
);

/**
 * Creates a new databanks routes instance
 * @returns Databanks routes instance
 */
export function createDatabanksRoutes() {
  return databanksRoutes;
}
