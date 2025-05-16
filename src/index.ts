/**
 * Application entry point
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createLogger } from './core/utils/logger';
import { env } from './config/environment';
import router from './routes';

// Create a logger for this module
const logger = createLogger('App');

// Extend Hono's ContextVariableMap interface to include our custom properties
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    databankId: string;
    userRoles: string[];
    isProvider: boolean;
    isConsumer: boolean;
  }
}

// Create a root app that will include our API router
const app = new Hono();

// Add a simple health check endpoint at the root level
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'multipart-upload-middleware',
    version: '1.0.0'
  });
});

// Mount the API router with the /v1 prefix
app.route('/v1', router);

// Log application startup
logger.info(`Starting application in ${env.NODE_ENV} environment on port ${env.PORT}`);

// Start the server
serve({
  fetch: app.fetch,
  port: Number(env.PORT),
});

// Log successful startup
logger.info(`Server started successfully on port ${env.PORT}`);
