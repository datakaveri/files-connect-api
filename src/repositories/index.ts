/**
 * Repositories exports
 * This file exports all repositories from the repositories directory
 */

import { StorageRepositoryInterface, StorageConfig, StorageProvider } from '../core/types/storage';
import { AWSS3Repository, createAWSS3Repository } from './aws-s3-repository';
import { MinIORepository } from './minio-repository';

export * from './aws-s3-repository';
export * from './minio-repository';

/**
 * Creates a storage repository based on the provided configuration
 *
 * This factory function instantiates the appropriate repository implementation
 * (AWS S3 or MinIO) based on the storage provider specified in the configuration.
 *
 * @param config - Storage configuration
 * @returns StorageRepositoryInterface implementation
 * @throws Error if the provider is not supported
 */
export function createStorageRepository(config: StorageConfig): StorageRepositoryInterface {
  switch (config.provider) {
    case StorageProvider.S3:
      return createAWSS3Repository(config);
    case StorageProvider.MINIO:
      return new MinIORepository(config);
    default:
      throw new Error(`Unsupported storage provider: ${config.provider}`);
  }
}
