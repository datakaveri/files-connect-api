/**
 * Routes exports
 * This file exports all routes from the routes directory
 */
import { Hono } from 'hono';
import { s3Routes } from './s3-routes';
import { filePreviewRoutes } from './file-preview-routes';
import { multipartUploadRoutes } from './multipart-uploads';
import { zipDownloadRoutes } from './zip-download';
import { lambdaTriggerRoutes } from './lambda-trigger';
import { healthRoutes } from './health-routes';
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

// Mount routes
router.route(ApiPaths.S3, s3Routes);
router.route(ApiPaths.FILE_PREVIEW, filePreviewRoutes);
router.route(ApiPaths.MULTIPART_UPLOAD, multipartUploadRoutes);
router.route(ApiPaths.ZIP, zipDownloadRoutes);
router.route(ApiPaths.LAMBDA_TRIGGER, lambdaTriggerRoutes);
router.route(ApiPaths.HEALTH, healthRoutes);

// Export the router
export default router;
