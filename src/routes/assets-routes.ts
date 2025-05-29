/**
 * Asset Routes
 * Defines routes for asset operations
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { S3ServiceInterface } from '../services/s3-service';
import { createLogger } from '../core/utils/logger';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { authenticate, authorize } from '../middleware/auth';
import { successResponse, notFoundResponse } from '../core/utils/response';
import { NotFoundError } from '../core/errors';
import { S3Constants } from '../config/constants';
import { UserRole } from '../core/types/auth';

// Create a logger for this module
const logger = createLogger('AssetRoutes');

// Create a router
export const assetsRoutes = Router();

/**
 * Initialize asset routes with the S3 service
 * @param s3Service - The S3 service to use for asset operations
 */
export function initAssetRoutes(s3Service: S3ServiceInterface) {
  logger.info('Initializing asset routes');

  // Apply authentication middleware to all routes
  assetsRoutes.use(authenticate);
  
  // Allow both providers and consumers to access assets
  assetsRoutes.use(authorize([UserRole.PROVIDER, UserRole.CONSUMER]));

  /**
   * Upload an asset
   * POST /assets
   */
  assetsRoutes.post(
    '/',
    validateBody(z.object({
      // Only require content (base64 encoded) and filename
      content: z.string().describe('Base64 encoded file content'),
      filename: z.string().describe('Filename to use for the asset'),
      contentType: z.string().optional().describe('Content type of the file')
    })),
    async (req, res, next) => {
      try {
        const { content, filename, contentType } = req.body;
        
        logger.debug('Uploading asset', { filename });
        
        // Decode base64 content
        const buffer = Buffer.from(content, 'base64');
        
        // Generate a unique key for the asset using UUID
        const key = `${Date.now()}-${filename}`;
        
        // Use S3 service to upload the file directly (without multipart)
        // We'll store assets in a separate folder 'assets/' to keep them distinct from databank files
        const fullKey = `assets/${key}`;
        
        // Upload the file directly to S3
        await s3Service.uploadAsset(fullKey, buffer, contentType);
        
        logger.debug('Asset uploaded successfully', { key: fullKey });
        
        // Return the key to the client
        return successResponse({
          key
        }, res, 201);
      } catch (error) {
        logger.error('Error uploading asset', error as Error);
        next(error);
      }
    }
  );

  /**
   * Get a presigned URL for an asset
   * GET /assets/:key
   */
  assetsRoutes.get(
    '/:key',
    validateParams(z.object({
      key: z.string().describe('Asset key')
    })),
    validateQuery(z.object({
      expiresIn: z.string().optional().transform(Number).describe('Expiration time in seconds')
    })),
    async (req, res, next) => {
      try {
        const { key } = req.params;
        // Parse expiresIn from query params, defaulting to the constant if not provided
        const expiresInParam = req.query.expiresIn;
        const expiresIn = typeof expiresInParam === 'string' ? parseInt(expiresInParam, 10) : S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION;
        
        logger.debug('Getting presigned URL for asset', { key, expiresIn });
        
        // The key provided by the client doesn't include the 'assets/' prefix, so add it
        const fullKey = `assets/${key}`;
        
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
