import { Hono } from "hono";
import { z } from "zod";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Service } from "../services/s3-service";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { HTTPException } from "hono/http-exception";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validation";
import { UserRole } from "../core/types/auth";

// Create a logger for this module
const logger = createLogger('ZipDownloadRoutes');

// Create S3 service instance
const s3Service = createS3Service();

// Define schema for ZIP download request
const zipDownloadSchema = z.object({
  databankId: z.string().min(1, 'Databank ID is required')
});

// Type for ZIP download request
type ZipDownloadRequest = z.infer<typeof zipDownloadSchema>;

/**
 * Create a new Hono router for ZIP download operations
 */
export const zipDownloadRoutes = new Hono();

// Apply common middleware to all routes
zipDownloadRoutes.use('*', (c, next) => next());

/**
 * ZIP download route
 * Generates a presigned URL for downloading a ZIP file
 */
zipDownloadRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(zipDownloadSchema),
  async (c) => {
    try {
      // Get the validated request body directly from the request
      const body = await c.req.json() as ZipDownloadRequest;
      // Validation middleware has already validated this body
      const databankId = body.databankId;
      
      logger.info(`ZIP download request received for databankId: ${databankId}`);
      
      // Construct the ZIP file key
      const zipKey = `zips/${databankId}.zip`;
      
      // Check if the ZIP file exists
      try {
        const command = new GetObjectCommand({
          Bucket: env.BUCKET_NAME,
          Key: zipKey
        });
        
        // Get the S3 repository client directly for presigned URL generation
        // This is a temporary solution until we add getClient() to the S3Service interface
        const s3Client = (s3Service as any).s3Repository.client;
        
        // Generate a presigned URL for downloading the ZIP file
        const presignedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 3600 // URL expires in 1 hour
        });
        
        logger.info(`Successfully generated ZIP download URL for key: ${zipKey}`);
        
        return c.json({
          message: "Download URL generated successfully",
          downloadUrl: presignedUrl,
          expiresIn: 3600
        });
      } catch (error) {
        // If the ZIP file doesn't exist
        logger.error(`ZIP file not found: ${zipKey}, error: ${error instanceof Error ? error.message : String(error)}`);
        
        throw new HTTPException(404, { message: `ZIP file for databank ${databankId} not found` });
      }
    } catch (error) {
      // Handle errors
      if (error instanceof HTTPException) {
        throw error;
      }
      
      logger.error(`Error generating ZIP download URL: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new HTTPException(500, { message: "Failed to generate ZIP download URL" });
    }
  }
);
