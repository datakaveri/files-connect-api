/**
 * Asset Routes
 * Defines routes for asset operations
 */
import { Router } from 'express';
import { z } from 'zod';
import { StorageServiceInterface } from '../services/storage-service';
import { createLogger } from '../core/utils/logger';
import { validateBody } from '../middleware/validation';
import { authenticate, authorize } from '../middleware/auth';
import { successResponse } from '../core/utils/response';
import { AuthorizationError, NotFoundError, ValidationError } from '../core/errors';
import { S3Constants } from '../config/constants';
import { UserRole } from '../core/types/auth';
import { v4 as uuidv4 } from 'uuid';
import { fileUpload } from '../middleware/file-upload';

// Create a logger for this module
const logger = createLogger('AssetRoutes');

// Create a router
export const assetsRoutes = Router();

/**
 * Initialize asset routes with the S3 service
 * @param s3Service - The S3 service to use for asset operations
 */
export function initAssetRoutes(s3Service: StorageServiceInterface) {
  logger.info('Initializing asset routes');

  // Apply authentication middleware to all routes
  assetsRoutes.use(authenticate);
  
  // Apply file upload middleware
  assetsRoutes.use(fileUpload);

  /**
   * Upload an asset (multipart/form-data)
   * POST /assets/
   */
  assetsRoutes.post(
    '/',
    authorize([UserRole.PROVIDER, UserRole.CONSUMER, UserRole.ADMIN]),
    async (req, res, next) => {
      try {
        // Check if file was uploaded
        if (!req.file) {
          throw new ValidationError('No file uploaded');
        }
        
        const { originalname, mimetype, buffer } = req.file;
        
        // Define allowed file types (as a backup validation)
        const allowedFileTypes = [
          // PDF
          'application/pdf',
          // Images
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
          'image/tiff',
          'image/bmp'
        ];
        
        // Double-check file type validation
        if (!allowedFileTypes.includes(mimetype)) {
          logger.warn('Invalid file type detected', { mimetype, filename: originalname });
          throw new ValidationError('File type not allowed. Only PDF and image files are accepted.');
        }
        
        logger.debug('Uploading asset via multipart/form-data', { filename: originalname, size: buffer.length });
        
        // Generate a unique key for the asset using UUID
        const key = `${Date.now()}-${uuidv4()}-${originalname}`;
        
        // Use S3 service to upload the file directly
        const fullKey = `assets/${res.locals.userId}/${key}`;
        
        // Upload the file directly to S3
        await s3Service.uploadAsset(fullKey, buffer, mimetype);
        
        logger.debug('Asset uploaded successfully via multipart/form-data', { key: fullKey });
        
        // Return the key to the client
        return successResponse({
          key: `${res.locals.userId}/${key}`,
          originalname,
          size: buffer.length,
          contentType: mimetype
        }, res, 201);
      } catch (error) {
        logger.error('Error uploading asset via multipart/form-data', error as Error);
        next(error);
      }
    }
  );

  /**
   * Get a presigned URL for an asset
   * POST /assets/download
   */
  assetsRoutes.post(
    '/download',
    authorize([UserRole.PROVIDER, UserRole.ADMIN]),
    validateBody(z.object({
      key: z.string().describe('Asset key'),
      expiresIn: z.number().optional().describe('Expiration time in seconds')
    })),
    async (req, res, next) => {
      try {
        const { key, expiresIn: expiresInParam } = req.body;
        // Use the provided expiresIn or default to the constant
        const expiresIn = expiresInParam || S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION;
        
        logger.debug('Getting presigned URL for asset', { key, expiresIn });
        
        // The key provided by the client doesn't include the 'assets/' prefix, so add it
        const fullKey = `assets/${key}`;

        if (!res.locals.isAdmin) {
          if (res.locals.userId !== key.split('/')[0]) {
            throw new AuthorizationError('You are not authorized to access this asset');
          }
        }
        
        // Check if the asset exists first
        try {
          await s3Service.getObjectDetails(fullKey, '');
        } catch (error) {
          logger.error('Asset not found', error as Error, { fullPath: fullKey });
          throw new NotFoundError('Asset', key);
        }
        
        // Generate a presigned URL for the asset
        const url = await s3Service.createAssetPresignedUrl(fullKey, expiresIn);
        
        logger.debug('Presigned URL generated successfully', { key: fullKey });
        
        // Return the presigned URL to the client
        return successResponse({
          url,
          expiresIn
        }, res);
      } catch (error) {
        logger.error('Error getting presigned URL for asset', error as Error);
        next(error);
      }
    }
  );

  return assetsRoutes;
}
