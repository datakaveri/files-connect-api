/**
 * Routes exports
 * This file exports all routes from the routes directory
 * Restructured to follow REST practices with all operations under databanks resource
 */
import { Router } from 'express';
import { databanksRoutes } from './databanks-routes';
import { ApiPaths } from '../config/constants';

// Create a main router
const router = Router();

// Apply common middleware to all routes
// Note: CORS, request context, and other global middleware are applied in app.ts
// Mount databanks routes - all other operations are now nested under databanks
router.use(ApiPaths.DATABANKS, databanksRoutes);

// Export the router
export default router;
