/**
 * Development Configuration
 * 
 * This module provides configuration settings for development mode.
 * It includes settings to accept mock JWT tokens for authentication.
 * 
 * WARNING: This should NEVER be used in production environments!
 */

import { createLogger } from '../core/utils/logger';

// Create a logger for this module
const logger = createLogger('DevConfig');

// Secret key for verifying mock tokens (must match the one in mock-auth.ts)
export const DEV_SECRET_KEY = 'development-secret-key-do-not-use-in-production';

// Flag to enable/disable development mode
export const isDevelopmentMode = process.env.NODE_ENV === 'development';

// Log a warning if development mode is enabled
if (isDevelopmentMode) {
  logger.warn('⚠️ DEVELOPMENT MODE ENABLED - Mock authentication is active ⚠️');
  logger.warn('⚠️ DO NOT USE THIS CONFIGURATION IN PRODUCTION ⚠️');
}

/**
 * Development configuration settings
 */
export const devConfig = {
  // JWT verification options for development
  jwt: {
    secretKey: DEV_SECRET_KEY,
    algorithms: ['HS256'],
    ignoreExpiration: false  // Set to true to ignore token expiration
  },
  
  // Mock user settings
  mockUsers: {
    enabled: isDevelopmentMode,
    defaultDatabankId: 'mock-databank-456'
  },
  
  // CORS settings for development
  cors: {
    enabled: true,
    origins: ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Databank-ID']
  }
};

/**
 * Helper function to check if we're in development mode
 * and should use mock authentication
 */
export function shouldUseMockAuth(): boolean {
  return isDevelopmentMode && devConfig.mockUsers.enabled;
}
