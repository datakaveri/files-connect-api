/**
 * Swagger UI Routes
 * Provides OpenAPI documentation UI for the API
 */
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '../config/openapi';
import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('SwaggerRoutes');

/**
 * Creates Swagger UI routes for API documentation
 * @returns Express router with Swagger UI routes
 */
export function createSwaggerRoutes() {
  const router = Router();
  
  // Mount Swagger UI with our OpenAPI document
  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(openApiDocument, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      defaultModelsExpandDepth: 4,
      defaultModelExpandDepth: 3
    }
  }));
  
  // Serve the OpenAPI specification as JSON
  router.get('/openapi.json', (req, res) => res.json(openApiDocument));
  
  logger.info('Swagger UI routes initialized');
  
  return router;
}

// Export the Swagger routes
export const swaggerRoutes = createSwaggerRoutes();
