/**
 * Swagger UI Routes
 * Provides OpenAPI documentation UI for the API
 */
import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { openApiInfo } from '../config/openapi';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('SwaggerRoutes');

/**
 * Creates Swagger UI routes for API documentation
 * @returns Hono router with Swagger UI routes
 */
export function createSwaggerRoutes() {
  const router = new Hono();
  
  // Mount Swagger UI with our OpenAPI info
  router.get('/', swaggerUI({
    url: '/v1/docs/openapi.json', // Path where OpenAPI JSON will be served
    defaultModelsExpandDepth: 4,
    defaultModelExpandDepth: 3
  }));
  
  // Serve the OpenAPI specification as JSON
  router.get('/openapi.json', (c) => c.json(openApiInfo));
  
  logger.info('Swagger UI routes initialized');
  
  return router;
}

// Export the Swagger routes
export const swaggerRoutes = createSwaggerRoutes();
