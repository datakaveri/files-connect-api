/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Simplified to follow REST practices with improved route organization
 */
import { Router } from 'express';
import { filesRoutes } from './files-routes';
import { uploadsRoutes } from './uploads-routes';
import { databanksRoutes } from './databanks-routes';
import { processingRoutes } from './processing-routes';
import { ApiPaths } from '../config/constants';
import { env } from '../config/environment';
import { requestContext, responseLogger } from '../middleware/logger';
import { performanceMonitor } from '../middleware/performance';

// Create a main router
const router = Router();

// Apply common middleware to all routes
// Note: CORS, request context, and other global middleware are applied in app.ts

// Mount routes
router.use(ApiPaths.FILES, filesRoutes);           // File operations (list, preview, metadata, download)
router.use(ApiPaths.UPLOADS, uploadsRoutes);       // Upload operations
router.use(ApiPaths.DATABANKS, databanksRoutes);   // Databank operations (zip downloads)
router.use(ApiPaths.PROCESSING, processingRoutes); // Processing jobs (zip creation and report generation)
// Note: Swagger UI routes are mounted directly in app.ts

// Export the router
export default router;
