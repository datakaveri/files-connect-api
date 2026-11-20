/**
 * Public Asset Routes
 * Defines routes for publicly readable assets.
 *
 * - POST /public_assets/                     authenticated upload into public_assets/{userId}/
 * - GET  /public_assets/{userId}/{filename}  unauthenticated read, served only from public_assets/
 *
 * Files under the private assets/ prefix (and every other prefix in the bucket) are never
 * reachable through this router: the storage key is always built as
 * `public_assets/{userId}/{filename}` from two validated path segments.
 */
import { Router } from 'express';
import { pipeline } from 'stream/promises';
import { StorageServiceInterface } from '../services/storage-service';
import { createLogger } from '../core/utils/logger';
import { authenticate, authorize } from '../middleware/auth';
import { fileUpload } from '../middleware/file-upload';
import { ApplicationError, ValidationError } from '../core/errors';
import { AssetPrefixes } from '../config/constants';
import { UserRole } from '../core/types/auth';
import { DelegationScope } from '../core/types/delegation';
import { createAssetUploadHandler } from './assets-routes';

const logger = createLogger('PublicAssetRoutes');

// Browsers and CDNs may cache public assets. Keys are unique per upload
// (timestamp + UUID), so a given URL always points to the same bytes.
const PUBLIC_ASSET_CACHE_CONTROL = 'public, max-age=3600';

// Owner segment: Keycloak subjects are UUIDs; allow only UUID-safe characters.
const USER_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// Control characters (C0 range and DEL) are never valid in a filename segment.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Validates one decoded path segment of a public asset key.
 * Express decodes route params, so '%2F' and '%5C' arrive here as '/' and '\'.
 * Rejecting them (and '.'/'..') ensures the key cannot escape public_assets/{userId}/.
 */
function isSafeFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= 1024 &&
    filename !== '.' &&
    filename !== '..' &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !CONTROL_CHARACTERS.test(filename)
  );
}

/**
 * Builds the storage key for a public asset, or throws if the path segments are unsafe.
 * Exported for unit testing.
 */
export function buildPublicAssetKey(userId: string, filename: string): string {
  if (!USER_ID_PATTERN.test(userId) || !isSafeFilename(filename)) {
    throw new ValidationError('Invalid public asset key');
  }

  const key = `${AssetPrefixes.PUBLIC}/${userId}/${filename}`;

  // Defence in depth: the key must stay inside public_assets/{userId}/
  if (!key.startsWith(`${AssetPrefixes.PUBLIC}/${userId}/`)) {
    throw new ValidationError('Invalid public asset key');
  }

  return key;
}

/**
 * Initialize public asset routes with the storage service
 * @param s3Service - The storage service to use for asset operations
 */
export function initPublicAssetRoutes(s3Service: StorageServiceInterface) {
  logger.info('Initializing public asset routes');

  const publicAssetsRoutes = Router();

  /**
   * Upload a public asset (multipart/form-data)
   * POST /public_assets/
   * Same roles, delegation scope, file types and size limit as POST /assets.
   */
  publicAssetsRoutes.post(
    '/',
    authenticate,
    fileUpload,
    authorize([UserRole.PROVIDER, UserRole.CONSUMER, UserRole.ADMIN], [DelegationScope.OWN_ASSET_MANAGEMENT]),
    createAssetUploadHandler(s3Service, AssetPrefixes.PUBLIC)
  );

  /**
   * Read a public asset - no authentication required
   * GET /public_assets/{userId}/{filename}
   * Streams the file bytes so it can be used directly as <img src> or a link.
   */
  publicAssetsRoutes.get('/:userId/:filename', async (req, res, next) => {
    try {
      const { userId, filename } = req.params as { userId: string; filename: string };
      const fullKey = buildPublicAssetKey(userId, filename);

      const details = await s3Service.getAssetDetails(fullKey);
      if (!details || !details.isFile) {
        throw new ApplicationError(
          `Public asset '${userId}/${filename}' not found`,
          404,
          'RESOURCE_NOT_FOUND',
          { resource: 'PublicAsset', id: `${userId}/${filename}` }
        );
      }

      const stream = await s3Service.getAsset(fullKey);

      res.status(200);
      res.setHeader('Content-Type', details.contentType || 'application/octet-stream');
      if (details.size) {
        res.setHeader('Content-Length', String(details.size));
      }
      res.setHeader('Cache-Control', PUBLIC_ASSET_CACHE_CONTROL);
      res.setHeader('Last-Modified', details.lastModified.toUTCString());
      // Allow other origins (the CBR and TANUH UIs) to embed the file; helmet defaults to same-origin.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // SVG and PDF can carry scripts: never let the browser run them in this API's origin.
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');

      await pipeline(stream, res);
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        // Stream failed mid-response; the connection is already closed by pipeline
        logger.error('Error streaming public asset', error as Error);
        return;
      }
      next(error);
    }
  });

  return publicAssetsRoutes;
}
