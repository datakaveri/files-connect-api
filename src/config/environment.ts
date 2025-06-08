/**
 * Environment variable validation and configuration
 * This module provides type-safe access to environment variables
 */
import { z } from 'zod';
import dotenv from 'dotenv';
import { createLogger } from '../core/utils/logger';
import { exit } from 'process';

// Create a logger for this module
const logger = createLogger('Environment');

// Define the schema for environment variables
const envSchema = z.object({
  // Server configuration
  PORT: z.string().transform(val => parseInt(val, 10)).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // S3 configuration
  S3_ENDPOINT: z.string(),
  S3_REGION: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  BUCKET_NAME: z.string(),
  ASSETS_BUCKET_NAME: z.string(),
  MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB: z.string().transform(val => parseInt(val, 10)),
  
  // Authentication configuration
  KEYCLOAK_AUTH_URL: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string(),
  KEYCLOAK_PUBLIC_KEY: z.string(),
  KEYCLOAK_REALM: z.string(),
  
  // Logging configuration
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // CORS configuration
  CORS_ORIGIN: z.string().trim().transform(val => 
    typeof val === 'string' ? val.split(',') : val
  ).default('*'),
  
  // API version
  VERSION: z.string().default('1.0.0'),
  
  // ACL API configuration
  ACL_APD_API_URL: z.string().url(),

  //Lambda Configs
  ZIP_LAMBDA_URL: z.string().url(),
  REPORTS_LAMBDA_URL: z.string().url(),
  LAMBDA_ACCESS_KEY: z.string(),
  LAMBDA_SECRET_KEY: z.string(),
  LAMBDA_REGION: z.string(),
});

// Export type definition
export type Env = z.infer<typeof envSchema>;

/**
 * Load and validate environment variables
 * @returns Validated environment variables
 */
function loadEnv(): Env {
  // Load environment variables from .env file based on NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    dotenv.config({ path: '.env.production' });
  } else {
    dotenv.config();
  }

  // Parse and validate environment variables
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    logger.error('Environment variable validation failed', result.error, {
      issues: result.error.issues
    });
    exit(1);
  }

  return result.data;
}

// Export validated environment variables
export const env = loadEnv();
