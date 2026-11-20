/**
 * Asset Routes
 * Defines routes for asset operations
 */
import { RequestHandler, Router } from 'express';
import { z } from 'zod';
import { StorageServiceInterface } from '../services/storage-service';
import { createLogger } from '../core/utils/logger';
import { validateBody } from '../middleware/validation';
import { authenticate, authorize } from '../middleware/auth';
import { successResponse } from '../core/utils/response';
import { ApplicationError, AuthorizationError, ValidationError } from '../core/errors';
import { AssetPrefixes, S3Constants } from '../config/constants';
import { UserRole } from '../core/types/auth';
import { DelegationScope } from '../core/types/delegation';
import { v4 as uuidv4 } from 'uuid';
import { fileUpload } from '../middleware/file-upload';

// Create a logger for this module
const logger = createLogger('AssetRoutes');

// Define allowed file types (as a backup validation)
const ALLOWED_ASSET_MIME_TYPES = [
  // PDF
  'application/pdf',
  // Images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
  'image/bmp'
];

/**
 * Creates the multipart/form-data upload handler shared by the private
 * (/assets) and public (/public_assets) asset routes. The only difference
 * between them is the storage prefix the file is written under.
 * @param s3Service - The storage service used to write the asset
 * @param prefix - The top-level storage prefix (e.g. 'assets' or 'public_assets')
 */
export function createAssetUploadHandler(s3Service: StorageServiceInterface, prefix: string): RequestHandler {
  return async (req, res, next) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        throw new ValidationError('No file uploaded');
      }

      const { originalname, mimetype, buffer } = req.file;

      // Double-check file type validation
      if (!ALLOWED_ASSET_MIME_TYPES.includes(mimetype)) {
        logger.warn('Invalid file type detected', { mimetype, filename: originalname });
        throw new ValidationError('File type not allowed. Only PDF and image files are accepted.');
      }

      logger.debug('Uploading asset via multipart/form-data', { prefix, filename: originalname, size: buffer.length });

      // Generate a unique key for the asset using UUID
      const key = `${Date.now()}-${uuidv4()}-${originalname}`;

      // Full storage key: {prefix}/{userId}/{key}
      const fullKey = `${prefix}/${res.locals.userId}/${key}`;

      // Upload the file directly to S3
      await s3Service.uploadAsset(fullKey, buffer, mimetype);

      logger.debug('Asset uploaded successfully via multipart/form-data', { key: fullKey });

      // Return the key (without the storage prefix) to the client
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
  };
}

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
    authorize([UserRole.PROVIDER, UserRole.CONSUMER, UserRole.ADMIN], [DelegationScope.OWN_ASSET_MANAGEMENT]),
    createAssetUploadHandler(s3Service, AssetPrefixes.PRIVATE)
  );

  /**
   * Get a presigned URL for an asset
   * POST /assets/download
   */
  assetsRoutes.post(
    '/download',
    authorize([UserRole.PROVIDER, UserRole.ADMIN], [DelegationScope.DATA_ACCESS]),
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
        const fullKey = `${AssetPrefixes.PRIVATE}/${key}`;

        if (res.locals.isDelegated || !res.locals.isAdmin) {
          if (res.locals.userId !== key.split('/')[0]) {
            throw new AuthorizationError('You are not authorized to access this asset');
          }
        }

        // Check if the asset exists first
        const assetDetails = await s3Service.getAssetDetails(fullKey);
        if (!assetDetails) {
          logger.error('Asset not found', undefined, { fullPath: fullKey });
          throw new ApplicationError(
            `Asset '${key}' not found. Please check the key name once`,
            404,
            'RESOURCE_NOT_FOUND',
            { resource: 'Asset', id: key }
          );
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
