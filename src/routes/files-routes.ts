/**
 * Files Routes
 * Handles REST operations for file resources
 */
import { Router, Request, Response, NextFunction } from "express";
import { Readable } from 'stream';
import { createLogger } from "../core/utils/logger";
import { createS3Service, S3ServiceInterface } from "../services/s3-service";
import { createFileService } from "../services/file-service";
import { 
  listObjectsSchema, 
  getObjectSchema, 
  filePreviewSchema
} from "../core/validators/schemas";
import { 
  authenticate, 
  authorize,
  databankAccess
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { UserRole } from "../core/types/auth";
import { 
  ApplicationError, 
  NotFoundError, 
  ValidationError
} from "../core/errors/application-errors";
import { FileType } from "../core/types/file";
import { buildResponse } from "../core/utils/route-utils";
import { FileListingResponse, FileMetadataResponse, FilePreviewResponse } from "../core/types/api-response";

// Create a logger for this module
const logger = createLogger('FilesRoutes');

// Create services
const s3Service = createS3Service();
const fileService = createFileService(s3Service);

/**
 * Utility to wrap async route handlers to handle errors properly
 * This ensures that errors thrown in async handlers are caught by Express error middleware
 * 
 * @param fn - Async route handler function
 * @returns Wrapped route handler
 */
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create a new Express router for file operations
 */
export const filesRoutes = Router();

/**
 * POST /files
 * List files in a directory
 */
filesRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  databankAccess,
  validateBody(listObjectsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Get validated data from request
    const body = req[VALIDATED_BODY];
    const databankId = res.locals.databankId as string;
    
    logger.info(`Listing files: prefix=${body.prefix}, databankId=${databankId}`);
    
    // Get the delimiter from the request or use the default
    const delimiter = body.delimiter || '/';
    
    // List objects using the S3 service
    const objects = await s3Service.listObjects(
      body.prefix || '',
      databankId,
      body.maxKeys,
      delimiter
    );
    
    // Process the objects and format the response following REST standards
    const response = buildResponse({
      files: objects.filter(obj => obj.isFile === true),
      directories: objects.filter(obj => obj.isFile === false)
    }, {
      prefix: body.prefix || '',
      count: objects.length,
      timestamp: new Date().toISOString()
    });
    
    // Send the response
    res.json(response);
  })
);

/**
 * POST /files/:key
 * Get a file by key
 */
filesRoutes.post(
  '/:key',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  databankAccess,
  validateBody(getObjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Get validated data from request
    const body = req[VALIDATED_BODY];
    const key = req.params.key;
    if (!key) {
      throw new ValidationError('Key parameter is required');
    }
    const databankId = res.locals.databankId as string;
    
    logger.info(`Getting file: key=${key}, databankId=${databankId}`);
    
    // Get the file stream from S3
    const stream = await s3Service.getObject(key, databankId);
    
    // Set content type based on file extension or default to octet-stream
    const contentType = body.contentType || 'application/octet-stream';
    
    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop() || 'file'}"`);
    
    // Pipe the stream to the response
    // This is more efficient than using the Web Streams API in Express
    if (stream instanceof Readable) {
      stream.pipe(res);
    } else {
      // If it's not a Node.js Readable stream (it might be a Web API ReadableStream)
      // we need to convert it to a Node.js stream
      const nodeStream = Readable.from(stream as any);
      nodeStream.pipe(res);
    }
  })
);

/**
 * GET /files/:key/metadata
 * Get file metadata
 */
filesRoutes.get(
  '/:key/metadata',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  databankAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.key;
    if (!key) {
      throw new ValidationError('Key parameter is required');
    }
    const databankId = res.locals.databankId as string;
    
    logger.info(`Getting file metadata: key=${key}, databankId=${databankId}`);
    
    // Get object details from S3
    const details = await s3Service.getObjectDetails(key, databankId);
    
    if (!details) {
      throw new NotFoundError(`File not found: ${key}`);
    }
    
    // Create a response using our standardized type
    const response: FileMetadataResponse = {
      key,
      size: details.size || 0,
      lastModified: details.lastModified || new Date(),
      contentType: details.contentType || 'application/octet-stream',
      etag: 'etag' in details && typeof details.etag === 'string' ? details.etag : undefined,
      metadata: 'metadata' in details && details.metadata ? details.metadata as Record<string, any> : undefined
    };
    
    // Send the response
    res.json(buildResponse(response));
  })
);

/**
 * POST /files/:key/preview
 * Preview file contents
 */
filesRoutes.post(
  '/:key/preview',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  databankAccess,
  validateBody(filePreviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.key;
    if (!key) {
      throw new ValidationError('Key parameter is required');
    }
    const body = req[VALIDATED_BODY];
    const databankId = res.locals.databankId as string;
    
    logger.info(`Previewing file: key=${key}, databankId=${databankId}, fileType=${body.fileType || 'auto'}`);
    
    // Detect file type if not provided
    const fileType = body.fileType || fileService.detectFileType(key);
    
    if (!fileType) {
      throw new ValidationError('Could not determine file type. Please provide fileType parameter.');
    }
    
    // Generate file preview
    const previewResult = await fileService.generatePreview({
      key,
      fileType: fileType as FileType,
      maxLines: body.maxLines || 100,
      databankId
    });
    
    const response: FilePreviewResponse = {
      data: previewResult.data,
      metadata: previewResult.metadata
    };
    
    // Send the response
    res.json(buildResponse(response));
  })
);

/**
 * Creates a new files routes instance
 * @returns Files routes instance
 */
export function createFilesRoutes() {
  return filesRoutes;
}
