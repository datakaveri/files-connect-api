/**
 * Services exports
 * This file exports all services from the services directory
 */

import { createStorageConfig } from '../config/storage';
import { createStorageRepository } from '../repositories';
import { StorageService } from './storage-service';
import { createMultipartUploadService as createMultipartUploadServiceInternal } from './multipart-upload-service';
import { createFileService as createFileServiceInternal } from './file-service';

export * from './auth-service';
export * from './file-service';
export * from './multipart-upload-service';
export * from './processing-service';
export * from './storage-service';
export * from './rabbitmq-service';
export * from './audit-service';

/**
 * Creates a storage service with the configured storage provider
 *
 * This factory function creates a storage service using the appropriate
 * repository based on the environment configuration.
 *
 * @returns Configured storage service instance
 */
export function createStorageService() {
  const config = createStorageConfig();
  const repository = createStorageRepository(config);
  return new StorageService(repository);
}

/**
 * Creates a multipart upload service with the configured storage provider
 *
 * This factory function creates a multipart upload service using the appropriate
 * repository based on the environment configuration.
 *
 * @returns Configured multipart upload service instance
 */
export function createMultipartUploadService() {
  const config = createStorageConfig();
  const repository = createStorageRepository(config);
  const storageService = createStorageService();
  return createMultipartUploadServiceInternal(storageService, repository);
}

/**
 * Creates a file service with the configured storage provider
 *
 * This factory function creates a file service using the appropriate
 * repository based on the environment configuration.
 *
 * @returns Configured file service instance
 */
export function createFileService() {
  const config = createStorageConfig();
  const repository = createStorageRepository(config);
  const storageService = createStorageService();
  return createFileServiceInternal(storageService, repository);
}
