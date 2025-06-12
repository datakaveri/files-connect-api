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
let logger: any;
let httpLogger: any;

if (process.env.NODE_ENV === 'test') {
  // Simple console logger for tests
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.debug,
    fatal: console.error,
    trace: console.trace,
    child: () => logger
  };
  
  httpLogger = (req: any, res: any, next: any) => next();
} else {
  // Production/development logger
  const loggerConfig: any = { 
    name: 'App',
    level: 'info'
  };
  
  // Only use pino-pretty in development mode
  if (process.env.NODE_ENV === 'development') {
    loggerConfig.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    };
  }
  
  logger = pino(loggerConfig);
  
  httpLogger = pinoHttp({ 
    logger,
    serializers: {
      req: (req: any) => ({
        method: req.method,
        url: req.url,
        headers: req.headers
      }),
      res: (res: any) => ({
        statusCode: res.statusCode
      })
    }
  });
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In test environment, we want to fail fast
  if (process.env.NODE_ENV === 'test') {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // In test environment, we want to fail fast
  if (process.env.NODE_ENV === 'test') {
    process.exit(1);
  }
});

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
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400 // 24 hours
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
app.get('/v1/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'files-connect-api',
    version: '1.0.0'
  });
});

// No need to import again, already imported above

// API Documentation
app.use('/v1/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

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
