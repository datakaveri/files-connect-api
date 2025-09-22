/**
 * Storage configuration factory
 *
 * This module provides functions to create storage configurations
 * based on environment variables, supporting both S3 and MinIO providers.
 */
import { env } from './environment';
import { StorageProvider, StorageConfig } from '../core/types/storage';

/**
 * Creates storage configuration from environment variables
 *
 * This function builds a StorageConfig object by prioritizing the new STORAGE_*
 * prefixed environment variables, with fallback to the legacy S3_* variables
 * for backward compatibility.
 *
 * @returns StorageConfig object with provider-specific settings
 */
export function createStorageConfig(): StorageConfig {
  // Determine the storage provider
  const provider = (env.STORAGE_PROVIDER as StorageProvider) || StorageProvider.S3;

  // Build configuration with fallback logic
  const config: StorageConfig = {
    provider,
    endpoint: env.STORAGE_ENDPOINT || env.S3_ENDPOINT || '',
    region: env.STORAGE_REGION || env.S3_REGION,
    accessKey: env.STORAGE_ACCESS_KEY || env.S3_ACCESS_KEY || '',
    secretKey: env.STORAGE_SECRET_KEY || env.S3_SECRET_KEY || '',
    bucketName: env.BUCKET_NAME,
    assetsBucketName: env.ASSETS_BUCKET_NAME,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE || (provider === StorageProvider.MINIO),
    useSSL: env.STORAGE_USE_SSL,
    port: env.STORAGE_PORT
  };

  // Provider-specific defaults
  if (provider === StorageProvider.MINIO) {
    // MinIO typically requires path-style URLs and may have different SSL defaults
    config.forcePathStyle = config.forcePathStyle !== false; // Default to true for MinIO
    config.useSSL = config.useSSL !== false; // Default to true for MinIO
  }

  return config;
}

/**
 * Validates storage configuration
 *
 * Performs basic validation on the storage configuration to ensure
 * required fields are present based on the selected provider.
 *
 * @param config - StorageConfig to validate
 * @throws Error if configuration is invalid
 */
export function validateStorageConfig(config: StorageConfig): void {
  const requiredFields = ['endpoint', 'accessKey', 'secretKey', 'bucketName'];

  for (const field of requiredFields) {
    const value = (config as any)[field];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      throw new Error(`Storage configuration error: ${field} is required`);
    }
  }

  if (config.provider === StorageProvider.MINIO && config.port === undefined) {
    // For MinIO, port might be inferred from endpoint, but we'll allow it
    console.warn('MinIO configuration: port not specified, will use default based on SSL setting');
  }
}
