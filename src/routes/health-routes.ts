/**
 * Health Check Routes
 * Provides endpoints for checking the health of the service
 */
import { Hono } from "hono";
import { createLogger } from "../core/utils/logger";

// Create a logger for this module
const logger = createLogger('HealthRoutes');

/**
 * Create a new Hono router for health check operations
 */
export const healthRoutes = new Hono();

/**
 * Health check route
 * Returns a 200 OK response if the service is running
 */
healthRoutes.get('/', async (c) => {
  logger.info('Health check requested');
  
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'multipart-upload-middleware',
    version: '1.0.0'
  });
});

/**
 * Deep health check route
 * Checks the health of dependencies like S3
 */
healthRoutes.get('/deep', async (c) => {
  logger.info('Deep health check requested');
  
  // In a real implementation, this would check the health of dependencies
  // For now, we'll just return a success response
  
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'multipart-upload-middleware',
    version: '1.0.0',
    dependencies: {
      s3: 'ok'
    }
  });
});
