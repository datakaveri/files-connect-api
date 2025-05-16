/**
 * S3 Repository Module
 * 
 * This module provides a repository layer for interacting with AWS S3 service.
 * It abstracts away the details of the AWS SDK and provides a clean interface
 * for performing S3 operations with built-in retry logic for handling transient errors.
 * 
 * @module repositories/s3-repository
 * @see {@link S3RepositoryInterface} for the interface definition
 * @see {@link S3Repository} for the implementation
 */
import { 
  S3Client, 
  ListObjectsV2Command, 
  GetObjectCommand,
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
import { env } from '../config/environment';
import { createLogger } from '../core/utils/logger';
import { S3Constants } from '../config/constants';
import { withRetry, RetryOptions, DEFAULT_RETRY_OPTIONS } from '../core/utils/retry-utils';

// Create a logger for this module
const logger = createLogger('S3Repository');

/**
 * Configuration options for the S3 repository
 * 
 * @interface S3RepositoryConfig
 * @property {string} region - The AWS region where the S3 bucket is located
 * @property {string} bucketName - The name of the S3 bucket to interact with
 * @property {Partial<RetryOptions>} [retryOptions] - Optional configuration for retry behavior
 */
export interface S3RepositoryConfig {
  /** AWS region */
  region: string;
  
  /** S3 bucket name */
  bucketName: string;
  
  /** Retry options for S3 operations */
  retryOptions?: Partial<RetryOptions>;
}

/**
 * Interface defining the contract for S3 repository implementations
 * 
 * This interface defines all the methods that an S3 repository implementation
 * must provide. It abstracts the underlying S3 client and provides methods
 * for common S3 operations like listing objects, getting/putting objects,
 * and handling multipart uploads.
 * 
 * @interface S3RepositoryInterface
 */
export interface S3RepositoryInterface {
  /**
   * Lists objects in the S3 bucket with the given prefix
   * @param prefix - The prefix to filter objects by
   * @param maxKeys - Maximum number of keys to return
   * @param delimiter - The delimiter for grouping objects
   * @returns Promise resolving to the list objects command output
   */
  listObjects(prefix: string, maxKeys?: number, delimiter?: string): Promise<ListObjectsV2CommandOutput>;
  
  /**
   * Gets an object from the S3 bucket
   * @param key - The key of the object to get
   * @returns Promise resolving to the get object command output
   */
  getObject(key: string): Promise<GetObjectCommandOutput>;
  
  /**
   * Gets a partial object from the S3 bucket (first N bytes)
   * @param key - The key of the object to get
   * @param maxBytes - Maximum number of bytes to retrieve
   * @returns Promise resolving to the get object command output
   */
  getPartialObject(key: string, maxBytes: number): Promise<GetObjectCommandOutput>;
  
  /**
   * Puts an object in the S3 bucket
   * @param key - The key to store the object under
   * @param body - The object data
   * @param contentType - The content type of the object
   * @returns Promise resolving to the put object command output
   */
  putObject(key: string, body: Buffer | Uint8Array | string | Readable, contentType?: string): Promise<PutObjectCommandOutput>;
  
  /**
   * Deletes an object from the S3 bucket
   * @param key - The key of the object to delete
   * @returns Promise resolving to the delete object command output
   */
  deleteObject(key: string): Promise<DeleteObjectCommandOutput>;
  
  /**
   * Creates a multipart upload
   * @param key - The key to store the object under
   * @param contentType - The content type of the object
   * @returns Promise resolving to the create multipart upload command output
   */
  createMultipartUpload(key: string, contentType?: string): Promise<CreateMultipartUploadCommandOutput>;
  
  /**
   * Uploads a part of a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param partNumber - The part number
   * @param body - The part data
   * @returns Promise resolving to the upload part command output
   */
  uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer | Uint8Array | string | Readable): Promise<UploadPartCommandOutput>;
  
  /**
   * Completes a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param parts - The parts to include in the completed object
   * @returns Promise resolving to the complete multipart upload command output
   */
  completeMultipartUpload(
    key: string, 
    uploadId: string, 
    parts: { PartNumber: number; ETag: string }[]
  ): Promise<CompleteMultipartUploadCommandOutput>;
  
  /**
   * Aborts a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @returns Promise resolving to the abort multipart upload command output
   */
  abortMultipartUpload(key: string, uploadId: string): Promise<AbortMultipartUploadCommandOutput>;
  
  /**
   * Creates a presigned URL for an object
   * @param key - The key of the object
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  createPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  
  /**
   * Gets the underlying S3 client
   * This should be used sparingly and only when the interface methods are insufficient
   * @returns The S3 client instance
   */
  get client(): S3Client;
}

/**
 * Implementation of the S3 repository interface
 * 
 * This class provides a concrete implementation of the S3RepositoryInterface
 * using the AWS SDK for JavaScript v3. It handles direct interactions with the
 * AWS S3 service and includes retry logic for handling transient errors.
 * 
 * @class S3Repository
 * @implements {S3RepositoryInterface}
 */
export class S3Repository implements S3RepositoryInterface {
  private s3Client: S3Client;
  private bucketName: string;
  private retryOptions: RetryOptions;
  
  /**
   * Creates a new S3Repository instance
   * 
   * Initializes the S3 client with the provided configuration and sets up
   * retry behavior based on the provided options or defaults.
   * 
   * @constructor
   * @param {S3RepositoryConfig} config - Configuration for the S3 repository
   */
  constructor(config: S3RepositoryConfig) {
    // Initialize S3 client with credentials from environment variables
    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY
      },
      endpoint: env.S3_ENDPOINT
    });
    
    this.bucketName = config.bucketName;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...config.retryOptions
    };
    
    logger.info('S3Repository initialized', { 
      region: config.region, 
      bucket: config.bucketName,
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
    logger.debug('Listing objects', { prefix, maxKeys, delimiter });
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
      Delimiter: delimiter,
    });
    
    return withRetry(
      async () => {
        const response = await this.s3Client.send(command);
        logger.debug('Listed objects successfully', { 
          prefix, 
          maxKeys,
          delimiter,
          contentCount: response.Contents?.length || 0,
          prefixCount: response.CommonPrefixes?.length || 0 
        });
        return response;
      },
      this.retryOptions,
      { operation: 'listObjects', prefix, maxKeys, delimiter }
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
   * Creates a multipart upload
   * @param key - The key to store the object under
   * @param contentType - The content type of the object
   * @returns Promise resolving to the create multipart upload command output
   */
  async createMultipartUpload(
    key: string, 
    contentType?: string
  ): Promise<CreateMultipartUploadCommandOutput> {
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
        return response;
      },
      this.retryOptions,
      { operation: 'createMultipartUpload', key, contentType }
    );
  }
  
  /**
   * Uploads a part of a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param partNumber - The part number
   * @param body - The part data
   * @returns Promise resolving to the upload part command output
   */
  async uploadPart(
    key: string, 
    uploadId: string, 
    partNumber: number, 
    body: Buffer | Uint8Array | string | Readable
  ): Promise<UploadPartCommandOutput> {
    logger.debug('Uploading part', { key, uploadId, partNumber });
    
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
        logger.debug('Uploaded part successfully', { key, uploadId, partNumber, etag: response.ETag });
        return response;
      },
      this.retryOptions,
      { operation: 'uploadPart', key, uploadId, partNumber }
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
}

/**
 * Factory function to create a new S3Repository instance with default configuration
 * 
 * This function creates a new S3Repository instance using environment variables
 * for configuration. It's the recommended way to create an S3Repository instance
 * in the application.
 * 
 * @function createS3Repository
 * @returns {S3Repository} A configured S3Repository instance
 */
export function createS3Repository(): S3Repository {
  return new S3Repository({
    region: env.S3_REGION,
    bucketName: env.BUCKET_NAME,
  });
}
