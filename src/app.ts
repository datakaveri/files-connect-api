/**
 * Express Application Configuration
 * Main application setup and middleware configuration
 */
import express, { Express, Request, Response, NextFunction } from 'express';
// Import directly without type checking to avoid TypeScript errors
// since we already have the packages installed in package.json
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
// Note: We're using a custom async error handler middleware instead of express-async-errors
// because express-async-errors is not compatible with Express 5
const swaggerUi = require('swagger-ui-express');
const pino = require('pino');
const pinoHttp = require('pino-http');

// Import middlewares
import { errorHandler } from './middleware/error-handler';
import { requestContext, responseLogger } from './middleware/logger';
import { performanceMonitor } from './middleware/performance';

// Import routes
import router from './routes';

// Import config
import { env } from './config/environment';

// Import OpenAPI document
import { openApiDocument } from './config/openapi';

// Create the Express application
const app: Express = express();

// Create a logger for this module
const logger = pino({ name: 'App' });
const httpLogger = pinoHttp({ logger });

// Ensure middleware hooks complete properly
// This addresses past issues with middleware hooks not completing properly
// causing curl requests to hang indefinitely

// Apply global middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// CORS configuration
app.use(cors({
  origin: env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-Execution-Time'],
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later',
}));

// Add request context and logging middleware
app.use(requestContext);
app.use(httpLogger);
app.use(responseLogger);
app.use(performanceMonitor);

// Simple health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'files-connect-api',
    version: '1.0.0'
  });
});

// No need to import again, already imported above

// API Documentation
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

// Mount API routes with versioning
app.use('/v1', router);

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// Handle 404 errors for any unmatched routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
      status: 404
    }
  });
});

export default app;
