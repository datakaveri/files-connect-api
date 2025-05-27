/**
 * Files Routes
 * Handles REST operations for file resources
 */
import { Hono, Context } from "hono";
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
  authorize
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { errorBoundary } from "../middleware/error-handler";
import { requestLogger, requestContext } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { 
  ApplicationError, 
  NotFoundError, 
  ValidationError
} from "../core/errors/application-errors";
import { FileType } from "../core/types/file";
import { withErrorHandling, buildResponse } from "../core/utils/route-utils";
import { FileListingResponse, FileMetadataResponse, FilePreviewResponse } from "../core/types/api-response";

// Create a logger for this module
const logger = createLogger('FilesRoutes');

// Create services
const s3Service = createS3Service();
const fileService = createFileService(s3Service);

/**
 * Create a new Hono router for file operations
 */
export const filesRoutes = new Hono();

// Apply common middleware to all routes
filesRoutes.use('*', errorBoundary, requestContext, requestLogger);

/**
 * GET /files
 * List files in a directory
 */
filesRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(listObjectsSchema),
  withErrorHandling(async (c: Context) => {
    const body = (c as any)[VALIDATED_BODY];
    const databankId = c.get('databankId') as string;
    
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
    
    return c.json(response);
  }, 'list-files')
);

/**
 * GET /files/:key
 * Get a file by key
 */
filesRoutes.post(
  '/:key',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(getObjectSchema),
  withErrorHandling(async (c: Context) => {
    const body = (c as any)[VALIDATED_BODY];
    const key = c.req.param('key');
    const databankId = c.get('databankId') as string;
    
    logger.info(`Getting file: key=${key}, databankId=${databankId}`);
    
    // Get the file stream from S3
    const stream = await s3Service.getObject(key, databankId);
    
    // Set content type based on file extension or default to octet-stream
    const contentType = body.contentType || 'application/octet-stream';
    
    // Convert Node.js Readable stream to Web-compatible ReadableStream
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      }
    });
    
    // Return the file
    return new Response(readableStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`
      }
    });
  }, 'get-file')
);

/**
 * GET /files/:key/metadata
 * Get file metadata
 */
filesRoutes.get(
  '/:key/metadata',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  withErrorHandling(async (c: Context) => {
    const key = c.req.param('key');
    const databankId = c.get('databankId') as string;
    
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
    
    return c.json(buildResponse(response));
  }, 'get-file-metadata')
);

/**
 * GET /files/:key/preview
 * Preview file contents
 */
filesRoutes.post(
  '/:key/preview',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(filePreviewSchema),
  withErrorHandling(async (c: Context) => {
    const key = c.req.param('key');
    const body = (c as any)[VALIDATED_BODY];
    const databankId = c.get('databankId') as string;
    
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
    
    return c.json(buildResponse(response));
  }, 'preview-file')
);

/**
 * Creates a new files routes instance
 * @returns Files routes instance
 */
export function createFilesRoutes() {
  return filesRoutes;
}
