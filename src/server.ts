/**
 * Application entry point
 * Starts the Express server
 */
import app from './app';
import { createLogger } from './core/utils/logger';
import { env } from './config/environment';

// Create a logger for this module
const logger = createLogger('Server');

// Log application startup
logger.info(`Starting application in ${env.NODE_ENV} environment on port ${env.PORT}`);

// Start the server
const server = app.listen(Number(env.PORT), () => {
  // Log successful startup
  logger.info(`Server started successfully on port ${env.PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  logger.error(`Unhandled Rejection: ${errorMessage}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  
  // Exit with error
  process.exit(1);
});

// Handle termination signals for graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after timeout
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

export default server;
