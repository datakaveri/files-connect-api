/**
 * AWS S3 Repository Module
 *
 * This module provides a repository layer for interacting with AWS S3 service.
 * It implements the StorageRepositoryInterface to provide a unified interface
 * for AWS S3 operations, compatible with the generic storage abstraction.
 *
 * @module repositories/aws-s3-repository
 * @see {@link StorageRepositoryInterface} for the interface definition
 * @see {@link AWSS3Repository} for the implementation
 */
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2CommandOutput,
  GetObjectCommandOutput,
  PutObjectCommandOutput,
  DeleteObjectCommandOutput,
  CreateMultipartUploadCommandOutput,
  UploadPartCommandOutput,
  CompleteMultipartUploadCommandOutput,
  AbortMultipartUploadCommandOutput
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { StorageRepositoryInterface, StorageConfig, MultipartUploadResult } from '../core/types/storage';
import { env } from '../config/environment';
import { createLogger } from '../core/utils/logger';
import { S3Constants } from '../config/constants';
import { withRetry, RetryOptions, DEFAULT_RETRY_OPTIONS } from '../core/utils/retry-utils';

// Create a logger for this module
const logger = createLogger('AWSS3Repository');

/**
 * Configuration options for the AWS S3 repository
 *
 * @interface AWSS3RepositoryConfig
 * @property {StorageConfig} config - Storage configuration
 * @property {Partial<RetryOptions>} [retryOptions] - Optional configuration for retry behavior
 */
export interface AWSS3RepositoryConfig extends StorageConfig {
  retryOptions?: Partial<RetryOptions>;
}

// Export legacy interface for backward compatibility
export interface S3RepositoryInterface extends StorageRepositoryInterface {}

/**
 * AWS S3 repository implementation
 *
 * This class provides a concrete implementation of the StorageRepositoryInterface
 * using the AWS SDK for JavaScript v3. It handles direct interactions with the
 * AWS S3 service and includes retry logic for handling transient errors.
 *
 * @class AWSS3Repository
 * @implements {StorageRepositoryInterface}
 */
export class AWSS3Repository implements StorageRepositoryInterface {
  private s3Client: S3Client;
  private bucketName: string;
  private retryOptions: RetryOptions;
  
  /**
   * Creates a new AWSS3Repository instance
   *
   * Initializes the S3 client with the provided configuration and sets up
   * retry behavior based on the provided options or defaults.
   *
   * @constructor
   * @param {AWSS3RepositoryConfig} config - Configuration for the AWS S3 repository
   */
  constructor(config: AWSS3RepositoryConfig) {
    // Initialize S3 client with configuration
    const s3Config: any = {
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey
      },
    };

    // Add endpoint if provided
    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
      // Add forcePathStyle if configured
      if (config.forcePathStyle) {
        s3Config.forcePathStyle = true;
      }
    }

    this.s3Client = new S3Client(s3Config);

    this.bucketName = config.bucketName;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...config.retryOptions
    };

    logger.info('AWSS3Repository initialized', {
      region: config.region,
      bucket: config.bucketName,
      endpoint: config.endpoint,
      retryConfig: {
        maxRetries: this.retryOptions.maxRetries,
        baseDelayMs: this.retryOptions.baseDelayMs,
        useExponentialBackoff: this.retryOptions.useExponentialBackoff
      }
    });
  }
  
  /**
   * Gets the underlying S3 client
   * 
   * This method provides access to the underlying AWS S3 client instance.
   * It should be used sparingly and only when the interface methods are insufficient
   * for a specific use case.
   * 
   * @returns {S3Client} The underlying AWS S3 client instance
   */
  get client(): S3Client {
    return this.s3Client;
  }
  
  /**
   * Lists objects in the S3 bucket with the given prefix
   * 
   * This method retrieves a list of objects from the S3 bucket that match the
   * specified prefix. It uses the ListObjectsV2 API and includes retry logic
   * for handling transient errors. The results include both objects and common
   * prefixes (folders) with the specified delimiter ('/').
   * 
   * @param {string} prefix - The prefix to filter objects by
   * @param {number} [maxKeys=S3Constants.MAX_KEYS] - Maximum number of keys to return
   * @param {string} [delimiter='/'] - The delimiter for grouping objects
   * @returns {Promise<ListObjectsV2CommandOutput>} Promise resolving to the list objects command output
   * @throws {Error} If the S3 operation fails after retries
   */
  async listObjects(prefix: string, maxKeys: number = S3Constants.MAX_KEYS, delimiter: string = '/'): Promise<ListObjectsV2CommandOutput> {
    return this.listObjectsWithToken(prefix, maxKeys, delimiter);
  }
  
  /**
   * Lists objects in the S3 bucket with the given prefix and continuation token
   * @param prefix - The prefix to filter objects by
   * @param maxKeys - Maximum number of keys to return
   * @param delimiter - The delimiter for grouping objects
   * @param continuationToken - Token for pagination
   * @returns Promise resolving to the list objects command output
   */
  async listObjectsWithToken(
    prefix: string, 
    maxKeys: number = S3Constants.MAX_KEYS, 
    delimiter: string = '/',
    continuationToken?: string
  ): Promise<ListObjectsV2CommandOutput> {
    logger.debug('Listing objects with token', { 
      prefix, 
      maxKeys, 
      delimiter,
      continuationToken: continuationToken || 'none'
    });
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
      Delimiter: delimiter,
      ContinuationToken: continuationToken
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Listed objects successfully', { 
          prefix, 
          maxKeys,
          delimiter,
          contentCount: response.Contents?.length || 0,
          prefixCount: response.CommonPrefixes?.length || 0,
          hasMoreContent: !!response.NextContinuationToken
        });
        return response;
      },
      this.retryOptions,
      { 
        operation: 'listObjectsWithToken', 
        prefix, 
        maxKeys, 
        delimiter,
        continuationToken: continuationToken || 'none'
      }
    );
  }
  
  /**
   * Gets an object from the S3 bucket
   * @param key - The key of the object to get
   * @returns Promise resolving to the get object command output
   */
  async getObject(key: string): Promise<GetObjectCommandOutput> {
    logger.debug('Getting object', { key });
    
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Got object successfully', { key, contentType: response.ContentType });
        return response;
      },
      this.retryOptions,
      { operation: 'getObject', key }
    );
  }
  
  /**
   * Gets a partial object from the S3 bucket (first N bytes)
   * @param key - The key of the object to get
   * @param maxBytes - Maximum number of bytes to retrieve
   * @returns Promise resolving to the get object command output
   */
  async getPartialObject(key: string, maxBytes: number): Promise<GetObjectCommandOutput> {
    logger.debug('Getting partial object', { key, maxBytes });
    
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Range: `bytes=0-${maxBytes - 1}` // Range is zero-based, so we subtract 1
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Got partial object successfully', { key, maxBytes });
        return response;
      },
      this.retryOptions,
      { operation: 'getPartialObject', key, maxBytes }
    );
  }
  
  /**
   * Puts an object in the S3 bucket
   * @param key - The key to store the object under
   * @param body - The object data
   * @param contentType - The content type of the object
   * @returns Promise resolving to the put object command output
   */
  async putObject(
    key: string, 
    body: Buffer | Uint8Array | string | Readable, 
    contentType?: string
  ): Promise<PutObjectCommandOutput> {
    logger.debug('Putting object', { key, contentType });
    
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Put object successfully', { key, etag: response.ETag });
        return response;
      },
      this.retryOptions,
      { operation: 'putObject', key, contentType }
    );
  }
  
  /**
   * Deletes an object from the S3 bucket
   * @param key - The key of the object to delete
   * @returns Promise resolving to the delete object command output
   */
  async headObject(key: string): Promise<{ ContentLength?: number; ContentType?: string; LastModified?: Date } | null> {
    logger.debug('Heading object', { key });
    const command = new HeadObjectCommand({ Bucket: this.bucketName, Key: key });
    return withRetry(
      async () => {
        try {
          const response = await this.s3Client.send(command);
          return {
            ContentLength: response.ContentLength,
            ContentType: response.ContentType,
            LastModified: response.LastModified,
          };
        } catch (error: any) {
          const statusCode = error?.$metadata?.httpStatusCode || error?.statusCode;
          if (statusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
            return null;
          }
          throw error;
        }
      },
      this.retryOptions,
      { operation: 'headObject', key }
    );
  }

  async deleteObject(key: string): Promise<DeleteObjectCommandOutput> {
    logger.debug('Deleting object', { key });
    
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Deleted object successfully', { key });
        return response;
      },
      this.retryOptions,
      { operation: 'deleteObject', key }
    );
  }
  
  /**
   * Completes a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param parts - The parts to include in the completed object
   * @returns Promise resolving to the complete multipart upload command output
   */
  async completeMultipartUpload(
    key: string, 
    uploadId: string, 
    parts: { PartNumber: number; ETag: string }[]
  ): Promise<CompleteMultipartUploadCommandOutput> {
    logger.debug('Completing multipart upload', { key, uploadId, partsCount: parts.length });
    
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Completed multipart upload successfully', { key, uploadId, location: response.Location });
        return response;
      },
      this.retryOptions,
      { operation: 'completeMultipartUpload', key, uploadId, partsCount: parts.length }
    );
  }
  
  /**
   * Aborts a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @returns Promise resolving to the abort multipart upload command output
   */
  async abortMultipartUpload(
    key: string, 
    uploadId: string
  ): Promise<AbortMultipartUploadCommandOutput> {
    logger.debug('Aborting multipart upload', { key, uploadId });
    
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Aborted multipart upload successfully', { key, uploadId });
        return response;
      },
      this.retryOptions,
      { operation: 'abortMultipartUpload', key, uploadId }
    );
  }
  

  /**
   * Creates a multipart upload
   */
  async createMultipartUpload(key: string, contentType?: string): Promise<MultipartUploadResult> {
    logger.debug('Creating multipart upload', { key, contentType });

    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Created multipart upload successfully', { key, uploadId: response.UploadId });
        return {
          uploadId: response.UploadId!,
          key
        };
      },
      this.retryOptions,
      { operation: 'createMultipartUpload', key, contentType }
    );
  }

  /**
   * Uploads a part in a multipart upload
   */
  async uploadPart(
    uploadId: string,
    key: string,
    partNumber: number,
    body: any
  ): Promise<string> {
    logger.debug('Uploading part', { uploadId, key, partNumber, bodySize: Buffer.isBuffer(body) ? body.length : 'unknown' });

    const command = new UploadPartCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    });

    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Uploaded part successfully', { uploadId, key, partNumber, etag: response.ETag });
        return response.ETag!;
      },
      this.retryOptions,
      { operation: 'uploadPart', uploadId, key, partNumber }
    );
  }

  /**
   * Creates a presigned URL for uploading a part in a multipart upload.
   * The client must PUT the part body to this URL. Without this method, the service
   * would fall back to createPresignedUrl (GetObject), causing SignatureDoesNotMatch
   * when the client uploads the part.
   */
  async createPresignedUrlForPart(
    uploadId: string,
    key: string,
    partNumber: number,
    expiresIn: number = 3600
  ): Promise<string> {
    logger.debug('Creating presigned URL for upload part', { uploadId, key, partNumber, expiresIn });

    // IMPORTANT:
    // Do NOT set Body or ContentLength here when creating a presigned URL.
    // If we sign the request with a specific content-length (e.g. 0 bytes),
    // but the client later uploads a real part with a different content-length,
    // S3 will calculate a different canonical request and the signature will not match,
    // causing 403 SignatureDoesNotMatch for every part upload.
    //
    // By omitting Body/ContentLength, the presigned URL is not bound to a specific
    // payload size, and the client can upload the actual part bytes safely.
    const command = new UploadPartCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return withRetry(
      async () => {
        const url = await getSignedUrl(this.s3Client, command, { expiresIn });
        logger.debug('Created presigned URL for part successfully', { key, partNumber, expiresIn });
        return url;
      },
      this.retryOptions,
      { operation: 'createPresignedUrlForPart', key, partNumber, expiresIn }
    );
  }

  /**
   * Creates a presigned URL for an object
   * @param key - The key of the object
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  async createPresignedUrl(
    key: string,
    expiresIn: number = S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION
  ): Promise<string> {
    logger.debug('Creating presigned URL', { key, expiresIn });

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return withRetry(
      async () => {
        const url = await getSignedUrl(this.s3Client, command, { expiresIn });
        logger.debug('Created presigned URL successfully', { key, expiresIn });
        return url;
      },
      this.retryOptions,
      { operation: 'createPresignedUrl', key, expiresIn }
    );
  }

  /**
   * Gets the underlying client
   */
  getClient(): S3Client {
    return this.s3Client;
  }
}

/**
 * Factory function to create a new AWSS3Repository instance with configuration
 *
 * This function creates a new AWSS3Repository instance using the provided configuration.
 * It's the recommended way to create an AWSS3Repository instance in the application.
 *
 * @function createAWSS3Repository
 * @param {AWSS3RepositoryConfig} config - Configuration for the repository
 * @returns {AWSS3Repository} A configured AWSS3Repository instance
 */
export function createAWSS3Repository(config: AWSS3RepositoryConfig): AWSS3Repository {
  return new AWSS3Repository(config);
}

// Legacy factory function for backward compatibility
export function createS3Repository(): AWSS3Repository {
  // Use new storage configuration which handles fallbacks
  const { createStorageConfig } = require('../config/storage');
  const config = createStorageConfig();
  return createAWSS3Repository(config);
}
