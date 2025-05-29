/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Restructured to follow REST practices with all operations under databanks resource
 */
import { Router } from 'express';
import { databanksRoutes } from './databanks-routes';
import { assetsRoutes, initAssetRoutes } from './assets-routes';
import { ApiPaths } from '../config/constants';
import { createS3Service } from '../services/s3-service';

// Create a main router
const router = Router();

// Apply common middleware to all routes
// Note: CORS, request context, and other global middleware are applied in app.ts

// Initialize services needed for routes
const s3Service = createS3Service();

// Initialize asset routes
const assetRoutesWithHandlers = initAssetRoutes(s3Service);

// Mount databanks routes - all other operations are now nested under databanks
router.use(ApiPaths.DATABANKS, databanksRoutes);

// Mount assets routes
router.use(ApiPaths.ASSETS, assetRoutesWithHandlers);

// Export the router
export default router;
