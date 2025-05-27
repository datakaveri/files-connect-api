/**
 * S3 Service type definitions
 * Standardizes the interfaces used by the S3 service
 */
import { S3Object, FileMetadata, FolderMetadata, MultipartUploadInit, MultipartUploadPart } from './file';

/**
 * Extended S3 object details that includes AWS-specific properties
 */
export interface S3ObjectDetails {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
  etag?: string;
  metadata?: Record<string, any>;
  isFile: boolean;
}

// Re-export these types for convenience
export { MultipartUploadInit, MultipartUploadPart };

/**
 * Interface for S3 service
 */
export interface S3ServiceInterface {
  /**
   * List objects in a bucket with a prefix
   * @param prefix Prefix to list objects for
   * @param databankId Databank ID to scope the operation
   * @param maxKeys Maximum number of keys to return
   * @param delimiter Delimiter to use for hierarchical listings
   * @returns Promise resolving to array of S3 objects
   */
  listObjects(
    prefix: string,
    databankId: string,
    maxKeys?: number,
    delimiter?: string
  ): Promise<S3Object[]>;

  /**
   * Get object from S3
   * @param key Key of the object to get
   * @param databankId Databank ID to scope the operation
   * @returns Promise resolving to object stream
   */
  getObject(key: string, databankId: string): Promise<NodeJS.ReadableStream>;

  /**
   * Get object details from S3
   * @param key Key of the object to get details for
   * @param databankId Databank ID to scope the operation
   * @returns Promise resolving to object details
   */
  getObjectDetails(key: string, databankId: string): Promise<S3ObjectDetails | null>;

  /**
   * Generate a presigned URL for getting an object
   * @param key Key of the object to generate URL for
   * @param databankId Databank ID to scope the operation
   * @param expiresIn Expiration time in seconds
   * @returns Promise resolving to presigned URL
   */
  getPresignedUrl(key: string, databankId: string, expiresIn?: number): Promise<string>;
}
