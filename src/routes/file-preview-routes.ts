/**
 * File Preview Routes
 * Handles file preview operations for various file types
 */
import { Hono, Context, Next } from "hono";
import { createLogger } from "../core/utils/logger";
import { createFileService } from "../services/file-service";
import { createS3Service } from "../services/s3-service";
import { filePreviewSchema } from "../core/validators/schemas";
import { 
  authenticate, 
  authorize 
} from "../middleware/auth";
import { validateBody } from "../middleware/validation";
import { errorBoundary } from "../middleware/error-handler";
import { requestLogger, requestContext } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { 
  ApplicationError, 
  NotFoundError, 
  ValidationError, 
  FileProcessingError 
} from "../core/errors/application-errors";
import { FileType } from "../core/types/file";

// Create a logger for this module
const logger = createLogger('FilePreviewRoutes');

// Create S3 service instance
const s3Service = createS3Service();

// Create file service instance
const fileService = createFileService(s3Service);

/**
 * Create a new Hono router for file preview operations
 */
export const filePreviewRoutes = new Hono();

// Apply common middleware to all routes
filePreviewRoutes.use('*', errorBoundary, requestContext, requestLogger);

/**
 * Interface for file preview request body
 */
interface FilePreviewRequestBody {
  key: string;
  fileType?: string;
  maxLines?: number;
}

/**
 * File preview handler function
 * Generates a preview of a file based on its type
 */
async function previewFileHandler(c: Context) {
  try {
    const body = c.get('validatedBody') as FilePreviewRequestBody;
    const databankId = c.get('databankId');
    
    logger.info(`Generating file preview for key: ${body.key}, databankId: ${databankId}, fileType: ${body.fileType || 'auto'}, maxLines: ${body.maxLines || 100}`);
    
    const fileType = body.fileType || fileService.detectFileType(body.key);
    
    if (!fileType) {
      throw new ValidationError('Could not determine file type. Please provide fileType parameter.');
    }
    
    const previewResult = await fileService.generatePreview({
      key: body.key,
      fileType: fileType as FileType,
      maxLines: body.maxLines || 100,
      databankId
    });
    
    logger.info(`Successfully generated file preview for key: ${body.key}`);
    
    // Create metadata object with proper typing
    interface PreviewMetadata {
      key?: string;
      fileType?: string;
      previewSize?: number;
      [key: string]: any;
    }
    
    // Create metadata object without duplicating properties
    const metadata: PreviewMetadata = {
      previewSize: body.maxLines || 100,
      ...(previewResult.metadata as any || {})
    };
    
    // Only add key and fileType if they're not already in the metadata
    if (!metadata.key) {
      metadata.key = body.key;
    }
    if (!metadata.fileType) {
      metadata.fileType = fileType;
    }
    
    return c.json({
      preview: previewResult.data,
      metadata
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    
    logger.error(`Error generating file preview: ${error instanceof Error ? error.message : String(error)}`);
    
    throw new FileProcessingError('Failed to generate file preview', { cause: error });
  }
}

/**
 * File preview route
 * Generates a preview of a file based on its type
 */
filePreviewRoutes.post('/preview', 
  // Apply middleware chain
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
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
      logger.error(`Error processing preview request: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(filePreviewSchema),
  // Main handler
  previewFileHandler
);
