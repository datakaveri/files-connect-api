/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Restructured to follow REST practices with all operations under databanks resource
 */
import { Router } from 'express';
import { databanksRoutes } from './databanks-routes';
import { ApiPaths } from '../config/constants';
import { env } from '../config/environment';

// Create a main router
const router = Router();

// Apply common middleware to all routes
// Note: CORS, request context, and other global middleware are applied in app.ts

// Health check route (mounted directly at root level)
router.get(ApiPaths.HEALTH, (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'files-connect-api',
    version: env.VERSION || '1.0.0'
  });
});

// Mount databanks routes - all other operations are now nested under databanks
router.use(ApiPaths.DATABANKS, databanksRoutes);
// Note: Swagger UI routes are mounted directly in app.ts

// Export the router
export default router;
