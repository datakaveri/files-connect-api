/**
 * Databanks Routes
 * Handles operations specific to databanks, including zip downloads
 */
import { Hono, Context } from "hono";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Service } from "../services/s3-service";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { HTTPException } from "hono/http-exception";
import { 
  authenticate, 
  authorize 
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { errorBoundary } from "../middleware/error-handler";
import { requestLogger, requestContext } from "../middleware/logger";
import { UserRole } from "../core/types/auth";

// Create a logger for this module
const logger = createLogger('DatabanksRoutes');

// Create services
const s3Service = createS3Service();

// Define schema for download request
const downloadZipSchema = z.object({
  databankId: z.string().min(1, 'Databank ID is required')
});

// Type for download request
type DownloadZipRequest = z.infer<typeof downloadZipSchema>;

/**
 * Create a new Hono router for databank operations
 */
export const databanksRoutes = new Hono();

// Apply common middleware to all routes
databanksRoutes.use('*', errorBoundary, requestContext, requestLogger);

/**
 * GET /databanks/:databankId/download
 * Get a download URL for a databank zip file
 */
databanksRoutes.get(
  '/:databankId/download',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  async (c: Context) => {
    try {
      const databankId = c.req.param('databankId');
      
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
        
        return c.json({
          downloadUrl: presignedUrl,
          expiresIn: 3600,
          key: zipKey,
          size: null, // Size would be retrieved from S3 metadata in a full implementation
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        // If the ZIP file doesn't exist
        logger.error(`Zip file not found: ${zipKey}, error: ${error instanceof Error ? error.message : String(error)}`);
        
        throw new HTTPException(404, { message: `Zip file for databank ${databankId} not found` });
      }
    } catch (error) {
      // Handle errors
      if (error instanceof HTTPException) {
        throw error;
      }
      
      logger.error(`Error generating download URL: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new HTTPException(500, { message: "Failed to generate download URL" });
    }
  }
);

/**
 * Creates a new databanks routes instance
 * @returns Databanks routes instance
 */
export function createDatabanksRoutes() {
  return databanksRoutes;
}
