/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Simplified to follow REST practices with improved route organization
 */
import { Hono } from 'hono';
import { createFilesRoutes } from './files-routes';
import { createUploadsRoutes } from './uploads-routes';
import { createDatabanksRoutes } from './databanks-routes';
import { createProcessingRoutes } from './processing-routes';
import { healthRoutes } from './health-routes';
import { swaggerRoutes } from './swagger-routes';
import { ApiPaths } from '../config/constants';
import { errorBoundary } from '../middleware/error-handler';
import { cors } from 'hono/cors';
import { env } from '../config/environment';
import { requestContext, requestLogger } from '../middleware/logger';
import { performanceMonitor } from '../middleware/performance';

// Create a main router
const router = new Hono();

// Apply common middleware to all routes
router.use('*', 
  cors({
    origin: env.CORS_ORIGIN,
  }),
  requestContext,
  requestLogger,
  performanceMonitor,
  errorBoundary
);

// Set base path for all routes
router.basePath("/v1");

// Create route instances
const filesRoutes = createFilesRoutes();
const uploadsRoutes = createUploadsRoutes();
const databanksRoutes = createDatabanksRoutes();
const processingRoutes = createProcessingRoutes();

// Mount routes
router.route(ApiPaths.FILES, filesRoutes);           // File operations (list, preview, metadata, download)
router.route(ApiPaths.UPLOADS, uploadsRoutes);       // Upload operations
router.route(ApiPaths.DATABANKS, databanksRoutes);   // Databank operations (zip downloads)
router.route(ApiPaths.PROCESSING, processingRoutes); // Processing jobs (zip creation and report generation)
router.route(ApiPaths.HEALTH, healthRoutes);         // Health check endpoints
router.route('/docs', swaggerRoutes);                // API documentation with Swagger UI

// Export the router
export default router;
