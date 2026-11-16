/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Restructured to follow REST practices with all operations under databanks resource
 */
import { Router } from 'express';
import { configuredOutputRouter } from '../outputs/config';
import { databanksRoutes } from './databanks-routes';
import { assetsRoutes, initAssetRoutes } from './assets-routes';
import { encryptionRoutes } from './encryption-routes';
import { ApiPaths } from '../config/constants';
import { env } from '../config/environment';
import { createStorageService } from '../services/storage-service';

// Create a main router
const router = Router();

// Apply common middleware to all routes
// Note: CORS, request context, and other global middleware are applied in app.ts

// Initialize services needed for routes
const s3Service = createStorageService();

// Initialize asset routes
const assetRoutesWithHandlers = initAssetRoutes(s3Service);

// Mount databanks routes - all other operations are now nested under databanks
router.use(ApiPaths.DATABANKS, databanksRoutes);

// Mount assets routes
router.use(ApiPaths.ASSETS, assetRoutesWithHandlers);

// Mount encryption routes (public key for client-side envelope encryption)
// only when explicitly enabled — TANUH deployments only. When disabled the
// path does not exist (404) and no KMS access is ever attempted.
if (env.ENCRYPTION_ENABLED) {
  router.use(ApiPaths.ENCRYPTION, encryptionRoutes);
}

if (process.env.OUTPUTS_ENABLED === 'true') {
  router.use('/outputs', configuredOutputRouter());
}

// Export the router
export default router;
