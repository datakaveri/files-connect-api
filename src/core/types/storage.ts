/**
 * Storage abstraction types and interfaces
 *
 * This module defines the core types and interfaces for storage provider abstraction,
 * allowing the application to work with different storage backends (AWS S3, MinIO, etc.)
 * through a unified interface.
 */

export enum StorageProvider {
  S3 = 's3',
  MINIO = 'minio',
  GCS = 'gcs'
}

export interface StorageConfig {
  provider: StorageProvider;
  endpoint: string;
  region?: string;
  accessKey: string;
  secretKey: string;
  bucketName: string;
  forcePathStyle?: boolean; // Required for MinIO
  useSSL?: boolean; // SSL configuration
  port?: number; // Port for MinIO

  // GCS-specific auth (native @google-cloud/storage client).
  // If none of these are set, the client falls back to Application Default Credentials.
  gcsProjectId?: string;
  gcsKeyFilename?: string; // Path to a service account JSON key file
  gcsClientEmail?: string; // Inline service account credentials (alternative to a key file)
  gcsPrivateKey?: string;
}

export interface StorageObject {
  key: string;
  size?: number;
  lastModified?: Date;
  contentType?: string;
  isFile: boolean;
  childCount?: number;
}

export interface MultipartUploadResult {
  uploadId: string;
  key: string;
}

export interface PresignedUrlOptions {
  expiresIn?: number;
  operation?: 'GET' | 'PUT' | 'DELETE';
}

export interface StorageRepositoryInterface {
  // Core operations
  listObjects(prefix: string, maxKeys?: number, delimiter?: string): Promise<any>;
  listObjectsWithToken(prefix: string, maxKeys?: number, delimiter?: string, continuationToken?: string): Promise<any>;
  getObject(key: string): Promise<any>;
  headObject(key: string): Promise<{ ContentLength?: number; ContentType?: string; LastModified?: Date } | null>;
  getPartialObject(key: string, maxBytes: number): Promise<any>;
  putObject(key: string, body: any, contentType?: string): Promise<any>;
  deleteObject(key: string): Promise<any>;

  // Multipart upload operations
  createMultipartUpload(key: string, contentType?: string): Promise<MultipartUploadResult>;
  uploadPart(uploadId: string, key: string, partNumber: number, body: any): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<any>;
  abortMultipartUpload(key: string, uploadId: string): Promise<any>;

  // Presigned URL operations
  createPresignedUrl(key: string, expiresIn?: number): Promise<string>;

  // Utility
  getClient(): any;
}
