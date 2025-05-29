/**
 * S3 Service
 * Handles business logic for S3 operations
 */
import { Readable } from 'stream';
import { S3Client, HeadObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { S3Repository, S3RepositoryInterface } from '../repositories/s3-repository';
import { createLogger } from '../core/utils/logger';
import { S3Constants } from '../config/constants';
import { 
  S3Object, 
  FileMetadata, 
  FolderMetadata,
  MultipartUploadInit,
  MultipartUploadPart
} from '../core/types/file';
import { S3ObjectDetails } from '../core/types/s3-service';
import { isFolder, getFileExtension } from '../core/utils/helpers';
import { env } from '../config/environment';

// Define AWS S3 types to avoid namespace errors
namespace AWSS3Types {
  export interface Object {
    Key?: string;
    Size?: number;
    LastModified?: Date;
  }
  
  export interface CommonPrefix {
    Prefix?: string;
  }
}

// Create a logger for this module
const logger = createLogger('S3Service');

/**
 * Interface for S3 service
 * Defines methods for S3 operations
 */
export interface S3ServiceInterface {
  /**
   * Lists objects in the S3 bucket with the given prefix
   * @param prefix - The prefix to filter objects by
   * @param databankId - The databank ID for authorization
   * @param maxKeys - Maximum number of keys to return
   * @param delimiter - The delimiter for grouping objects
   * @returns Promise resolving to an array of S3 objects
   */
  listObjects(prefix: string, databankId: string, maxKeys?: number, delimiter?: string): Promise<S3Object[]>;
  
  /**
   * Uploads an asset directly to S3 (without multipart)
   * @param key - The key to store the asset under
   * @param data - The asset data as a buffer
   * @param contentType - The content type of the asset
   * @returns Promise resolving to the key of the uploaded asset
   */
  uploadAsset(key: string, data: Buffer, contentType?: string): Promise<string>;
  
  /**
   * Creates a presigned URL for an asset
   * @param key - The key of the asset
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  createAssetPresignedUrl(key: string, expiresIn?: number): Promise<string>;
  
  /**
   * Gets an object from the S3 bucket
   * @param key - The key of the object to get
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to a readable stream of the object data
   */
  getObject(key: string, databankId: string): Promise<Readable>;
  
  /**
   * Gets a partial object from the S3 bucket (first N bytes)
   * @param key - The key of the object to get
   * @param databankId - The databank ID for authorization
   * @param maxBytes - Maximum number of bytes to retrieve
   * @returns Promise resolving to a readable stream of the partial object data
   */
  getPartialObject(key: string, databankId: string, maxBytes: number): Promise<Readable>;
  
  /**
   * Gets details about an object in the S3 bucket
   * @param key - The key of the object to get details for
   * @param databankId - The databank ID for authorization (can be empty for assets)
   * @returns Promise resolving to the object details
   */
  getObjectDetails(key: string, databankId: string): Promise<S3Object | null>;
  
  /**
   * Creates a folder in the S3 bucket
   * @param folderPath - The path of the folder to create
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the created folder metadata
   */
  createFolder(folderPath: string, databankId: string): Promise<FolderMetadata>;
  
  /**
   * Deletes an object from the S3 bucket
   * @param key - The key of the object to delete
   * @param databankId - The databank ID for authorization
   * @param recursive - Whether to delete recursively (for folders)
   * @returns Promise resolving to void
   */
  deleteObject(key: string, databankId: string, recursive?: boolean): Promise<void>;
  
  /**
   * Initializes a multipart upload
   * @param key - The key to store the object under
   * @param databankId - The databank ID for authorization
   * @param contentType - The content type of the object
   * @returns Promise resolving to the multipart upload initialization data
   */
  initMultipartUpload(key: string, databankId: string, contentType?: string): Promise<MultipartUploadInit>;
  
  /**
   * Completes a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param databankId - The databank ID for authorization
   * @param parts - The parts to include in the completed object
   * @returns Promise resolving to the key of the completed object
   */
  completeMultipartUpload(
    key: string, 
    uploadId: string, 
    databankId: string, 
    parts: MultipartUploadPart[]
  ): Promise<string>;
  
  /**
   * Aborts a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to void
   */
  abortMultipartUpload(key: string, uploadId: string, databankId: string): Promise<void>;
  
  /**
   * Creates a presigned URL for an object
   * @param key - The key of the object
   * @param databankId - The databank ID for authorization
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  createPresignedUrl(key: string, databankId: string, expiresIn?: number): Promise<string>;
  
  /**
   * Gets the underlying S3 client for direct operations
   * This should be used sparingly and only when the interface methods are insufficient
   * @returns The S3 client instance
   */
  getS3Client(): S3Client;
}

/**
 * S3 Service implementation
 * Handles business logic for S3 operations
 */
export class S3Service implements S3ServiceInterface {
  private s3Repository: S3RepositoryInterface;
  
  /**
   * Creates a new S3Service instance
   * @param s3Repository - The S3 repository to use
   */
  constructor(s3Repository: S3RepositoryInterface) {
    this.s3Repository = s3Repository;
    logger.info('S3Service initialized');
  }
  
  /**
   * Uploads an asset directly to S3 (without multipart)
   * @param key - The key to store the asset under
   * @param data - The asset data as a buffer
   * @param contentType - The content type of the asset
   * @returns Promise resolving to the key of the uploaded asset
   */
  async uploadAsset(key: string, data: Buffer, contentType?: string): Promise<string> {
    logger.debug('Uploading asset', { key, contentType, size: data.length });
    
    try {
      await this.s3Repository.putObject(key, data, contentType);
      
      logger.debug('Asset uploaded successfully', { key });
      
      return key;
    } catch (error) {
      logger.error('Error uploading asset', error as Error, { key });
      throw error;
    }
  }
  
  /**
   * Creates a presigned URL for an asset
   * @param key - The key of the asset
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  async createAssetPresignedUrl(
    key: string, 
    expiresIn: number = S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION
  ): Promise<string> {
    logger.info('Creating presigned URL for asset', { key, expiresIn });
    
    try {
      const url = await this.s3Repository.createPresignedUrl(key, expiresIn);
      
      logger.debug('Created presigned URL for asset successfully', { 
        key,
        expiresIn
      });
      
      return url;
    } catch (error) {
      logger.error('Error creating presigned URL for asset', error as Error, { 
        key,
        expiresIn
      });
      throw error;
    }
  }
  
  /**
   * Normalizes a prefix with the databank ID
   * @param prefix - The prefix to normalize
   * @param databankId - The databank ID
   * @returns Normalized prefix
   */
  private normalizePrefix(prefix: string, databankId: string): string {
    // Log the incoming prefix and databank ID for debugging
    logger.debug('Normalizing prefix', { prefix, databankId });
    
    // Ensure prefix starts with databank ID
    if (!prefix.startsWith(`${databankId}/`)) {
      prefix = `${databankId}/${prefix}`;
    }
    
    // Ensure prefix ends with slash
    if (!prefix.endsWith('/')) {
      prefix = `${prefix}/`;
    }
    
    return prefix;
  }
  
  /**
   * Ensures a key starts with the databank ID
   * @param key - The key to normalize
   * @param databankId - The databank ID
   * @returns Normalized key
   */
  private normalizeKey(key: string, databankId: string): string {
    // Ensure key starts with databank ID
    if (!key.startsWith(`${databankId}/`)) {
      key = `${databankId}/${key}`;
    }
    
    return key;
  }
  
  /**
   * Converts AWS S3 objects to our S3Object model
   * @param contents - The contents from AWS S3
   * @param commonPrefixes - The common prefixes from AWS S3
   * @param prefix - The prefix used in the original request (for path normalization)
   * @returns Array of S3Object models
   */
  private convertToS3Objects(
    contents: AWSS3Types.Object[] = [], 
    commonPrefixes: AWSS3Types.CommonPrefix[] = [],
    prefix: string = ''
  ): S3Object[] {
    const objects: S3Object[] = [];
    
    // Helper function to remove the prefix from a key
    const removePrefix = (key: string): string => {
      if (prefix && key.startsWith(prefix)) {
        return key.substring(prefix.length);
      }
      return key;
    };
    
    logger.info('Converting S3 objects with details', {
      contentsCount: contents.length,
      prefixesCount: commonPrefixes.length,
      prefix,
      contentKeys: contents.map(item => item.Key),
      commonPrefixKeys: commonPrefixes.map(item => item.Prefix)
    });
    
    // Process files
    for (const item of contents) {
      if (item.Key) {
        const isDir = isFolder(item.Key);
        const normalizedKey = removePrefix(item.Key);
        
        if (isDir) {
          // It's a folder
          objects.push({
            key: normalizedKey,
            lastModified: item.LastModified || new Date(),
            childCount: 0,
            isFile: false
          });
        } else {
          // It's a file
          objects.push({
            key: normalizedKey,
            size: item.Size || 0,
            lastModified: item.LastModified || new Date(),
            contentType: `application/${getFileExtension(normalizedKey)}`,
            isFile: true
          });
        }
      }
    }
    
    // Process folders
    for (const prefixItem of commonPrefixes) {
      if (prefixItem.Prefix) {
        const normalizedKey = removePrefix(prefixItem.Prefix);
        
        objects.push({
          key: normalizedKey,
          lastModified: new Date(),
          isFile: false,
          childCount: 0
        });
      }
    }
    
    return objects;
  }
  
  /**
   * Determines the content type based on the file extension
   * @param key - The key of the file
   * @returns The content type
   */
  private getContentTypeFromKey(key: string): string {
    const extension = getFileExtension(key).toLowerCase();
    
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'pdf':
        return 'application/pdf';
      case 'txt':
        return 'text/plain';
      case 'html':
        return 'text/html';
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      case 'xml':
        return 'application/xml';
      case 'zip':
        return 'application/zip';
      default:
        return 'application/octet-stream';
    }
  }
  
  /**
   * Checks if a key represents a folder
   * @param key - The key to check
   * @returns True if the key represents a folder
   */
  private isKeyFolder(key: string): boolean {
    return key.endsWith('/');
  }
  
  /**
   * Lists objects in the S3 bucket with the given prefix
   * @param prefix - The prefix to filter objects by
   * @param databankId - The databank ID for authorization
   * @param maxKeys - Maximum number of keys to return
   * @param delimiter - The delimiter for grouping objects (default: '/')
   * @returns Promise resolving to an array of S3 objects
   */
  async listObjects(prefix: string, databankId: string, maxKeys: number = 1000, delimiter: string = '/'): Promise<S3Object[]> {
    // Normalize prefix with databank ID
    let normalizedPrefix = '';
    
    // If prefix is empty, just use the databank ID as the prefix
    if (!prefix || prefix.trim() === '') {
      normalizedPrefix = `${databankId}/`;
    } else {
      normalizedPrefix = this.normalizePrefix(prefix, databankId);
    }
    
    logger.info('Listing objects with details', { 
      originalPrefix: prefix,
      normalizedPrefix, 
      maxKeys, 
      delimiter,
      databankId 
    });
    
    try {
      // Pass the delimiter to the listObjects method
      const response = await this.s3Repository.listObjects(normalizedPrefix, maxKeys, delimiter);
      
      logger.debug('Listed objects successfully', { 
        prefix: normalizedPrefix, 
        maxKeys, 
        delimiter,
        databankId,
        contentCount: response.Contents?.length || 0,
        prefixCount: response.CommonPrefixes?.length || 0
      });
      
      const objects = this.convertToS3Objects(
        response.Contents as AWSS3Types.Object[], 
        response.CommonPrefixes as AWSS3Types.CommonPrefix[],
        normalizedPrefix
      );
      
      return objects;
    } catch (error) {
      logger.error('Error listing objects', error as Error, { 
        prefix: normalizedPrefix, 
        maxKeys, 
        delimiter,
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Gets an object from the S3 bucket
   * @param key - The key of the object to get
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to a readable stream of the object data
   */
  async getObject(key: string, databankId: string): Promise<Readable> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    logger.debug('Getting object', { 
      key: normalizedKey, 
      databankId 
    });
    
    try {
      // Get the object from the repository
      const response = await this.s3Repository.getObject(normalizedKey);
      
      if (!response.Body) {
        throw new Error(`Object not found: ${normalizedKey}`);
      }
      
      logger.debug('Got object successfully', { 
        key: normalizedKey, 
        databankId 
      });
      
      return response.Body as Readable;
    } catch (error) {
      logger.error('Error getting object', error as Error, { 
        key: normalizedKey, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Gets a partial object from the S3 bucket (first N bytes)
   * @param key - The key of the object to get
   * @param databankId - The databank ID for authorization
   * @param maxBytes - Maximum number of bytes to retrieve
   * @returns Promise resolving to a readable stream of the partial object data
   */
  async getPartialObject(key: string, databankId: string, maxBytes: number): Promise<Readable> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    logger.debug('Getting partial object', { 
      key: normalizedKey, 
      databankId,
      maxBytes 
    });
    
    try {
      // Get the partial object from the repository
      const response = await this.s3Repository.getPartialObject(normalizedKey, maxBytes);
      
      if (!response.Body) {
        throw new Error(`Object not found: ${normalizedKey}`);
      }
      
      logger.debug('Got partial object successfully', { 
        key: normalizedKey, 
        databankId,
        maxBytes,
        contentLength: response.ContentLength
      });
      
      return response.Body as Readable;
    } catch (error) {
      logger.error('Error getting partial object', error as Error, { 
        key: normalizedKey, 
        databankId,
        maxBytes 
      });
      throw error;
    }
  }
  
  /**
   * Gets details about an object in the S3 bucket
   * @param key - The key of the object to get details for
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the object details or null if not found
   */
  async getObjectDetails(key: string, databankId: string): Promise<S3Object | null> {
    try {
      // Normalize the key with the databank ID
      const normalizedKey = this.normalizeKey(key, databankId);
      
      logger.info(`Getting object details: key=${normalizedKey}`);
      
      try {
        // Get the object metadata using the repository
        const response = await this.s3Repository.getObject(normalizedKey);
        
        // Check if it's a folder
        const isDir = isFolder(normalizedKey);
        
        if (isDir) {
          // It's a folder
          const folder: FolderMetadata = {
            key,
            lastModified: response.LastModified || new Date(),
            childCount: 0,
            isFile: false
          };
          return folder;
        } else {
          // It's a file
          const file: FileMetadata = {
            key,
            size: response.ContentLength || 0,
            lastModified: response.LastModified || new Date(),
            contentType: response.ContentType || 'application/octet-stream',
            isFile: true
          };
          return file;
        }
      } catch (error) {
        // If the object doesn't exist, return null
        if (error instanceof Error && 
            (error.name === 'NotFound' || error.name === 'NoSuchKey')) {
          logger.warn(`Object not found: ${normalizedKey}`);
          return null;
        }
        
        // Re-throw other errors
        throw error;
      }
    } catch (error) {
      logger.error(`Error getting object details: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Creates a folder in the S3 bucket
   * @param folderPath - The path of the folder to create
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the created folder metadata
   */
  async createFolder(folderPath: string, databankId: string): Promise<FolderMetadata> {
    let normalizedPath = this.normalizeKey(folderPath, databankId);
    
    // Ensure path ends with slash for folders
    if (!normalizedPath.endsWith('/')) {
      normalizedPath = `${normalizedPath}/`;
    }
    
    logger.debug('Creating folder', { 
      folderPath: normalizedPath, 
      databankId 
    });
    
    try {
      await this.s3Repository.putObject(normalizedPath, Buffer.from(''), 'application/x-directory');
      
      logger.debug('Created folder successfully', { 
        folderPath: normalizedPath, 
        databankId 
      });
      
      return {
        key: normalizedPath,
        lastModified: new Date(),
        childCount: 0,
        isFile: false
      };
    } catch (error) {
      logger.error('Error creating folder', error as Error, { 
        folderPath: normalizedPath, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Deletes an object from the S3 bucket
   * @param key - The key of the object to delete
   * @param databankId - The databank ID for authorization
   * @param recursive - Whether to delete recursively (for folders)
   * @returns Promise resolving to void
   */
  async deleteObject(key: string, databankId: string, recursive: boolean = false): Promise<void> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    logger.debug('Deleting object', { 
      key: normalizedKey, 
      recursive, 
      databankId 
    });
    
    try {
      // Check if key is a folder
      const isKeyFolder = this.isKeyFolder(normalizedKey);
      
      if (isKeyFolder && recursive) {
        // List all objects in the folder
        const objects = await this.listObjects(normalizedKey, databankId);
        
        // Delete all objects in the folder
        for (const object of objects) {
          await this.s3Repository.deleteObject(object.key);
          
          logger.debug('Deleted nested object', { 
            key: object.key, 
            databankId 
          });
        }
      }
      
      // Delete the object/folder itself
      await this.s3Repository.deleteObject(normalizedKey);
      
      logger.debug('Deleted object successfully', { 
        key: normalizedKey, 
        recursive, 
        databankId 
      });
    } catch (error) {
      logger.error('Error deleting object', error as Error, { 
        key: normalizedKey, 
        recursive, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Initializes a multipart upload
   * @param key - The key to store the object under
   * @param databankId - The databank ID for authorization
   * @param contentType - The content type of the object
   * @returns Promise resolving to the multipart upload initialization data
   */
  async initMultipartUpload(key: string, databankId: string, contentType?: string): Promise<MultipartUploadInit> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    // Determine content type if not provided
    if (!contentType) {
      contentType = this.getContentTypeFromKey(key);
    }
    
    logger.debug('Initializing multipart upload', { 
      key: normalizedKey, 
      contentType, 
      databankId 
    });
    
    try {
      const response = await this.s3Repository.createMultipartUpload(normalizedKey, contentType);
      
      logger.debug('Initialized multipart upload successfully', { 
        key: normalizedKey, 
        contentType, 
        databankId 
      });
      
      if (!response.UploadId) {
        throw new Error('Failed to get upload ID');
      }
      
      return {
        key: normalizedKey,
        uploadId: response.UploadId
      };
    } catch (error) {
      logger.error('Error initializing multipart upload', error as Error, { 
        key: normalizedKey, 
        contentType, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Completes a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param databankId - The databank ID for authorization
   * @param parts - The parts to include in the completed object
   * @returns Promise resolving to the key of the completed object
   */
  async completeMultipartUpload(
    key: string, 
    uploadId: string, 
    databankId: string, 
    parts: MultipartUploadPart[]
  ): Promise<string> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    logger.debug('Completing multipart upload', { 
      key: normalizedKey, 
      uploadId, 
      partsCount: parts.length, 
      databankId 
    });
    
    try {
      await this.s3Repository.completeMultipartUpload(
        normalizedKey, 
        uploadId, 
        parts.map(part => ({ 
          PartNumber: part.PartNumber, 
          ETag: part.ETag 
        }))
      );
      
      logger.debug('Completed multipart upload successfully', { 
        key: normalizedKey, 
        uploadId, 
        databankId 
      });
      
      return normalizedKey;
    } catch (error) {
      logger.error('Error completing multipart upload', error as Error, { 
        key: normalizedKey, 
        uploadId, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Aborts a multipart upload
   * @param key - The key of the object
   * @param uploadId - The upload ID
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to void
   */
  async abortMultipartUpload(key: string, uploadId: string, databankId: string): Promise<void> {
    // Normalize key with databank ID
    const normalizedKey = this.normalizeKey(key, databankId);
    
    logger.debug('Aborting multipart upload', { 
      key: normalizedKey, 
      uploadId, 
      databankId 
    });
    
    try {
      await this.s3Repository.abortMultipartUpload(normalizedKey, uploadId);
      
      logger.debug('Aborted multipart upload successfully', { 
        key: normalizedKey, 
        uploadId, 
        databankId 
      });
    } catch (error) {
      logger.error('Error aborting multipart upload', error as Error, { 
        key: normalizedKey, 
        uploadId, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Creates a presigned URL for an object
   * @param key - The key of the object
   * @param databankId - The databank ID for authorization
   * @param expiresIn - The number of seconds until the URL expires
   * @returns Promise resolving to the presigned URL
   */
  async createPresignedUrl(
    key: string, 
    databankId: string, 
    expiresIn: number = S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION
  ): Promise<string> {
    const normalizedKey = this.normalizeKey(key, databankId);
    logger.info('Creating presigned URL', { key: normalizedKey, expiresIn, databankId });
    
    try {
      const url = await this.s3Repository.createPresignedUrl(normalizedKey, expiresIn);
      
      logger.debug('Created presigned URL successfully', { 
        key: normalizedKey, 
        expiresIn, 
        databankId 
      });
      
      return url;
    } catch (error) {
      logger.error('Error creating presigned URL', error as Error, { 
        key: normalizedKey, 
        expiresIn, 
        databankId 
      });
      throw error;
    }
  }
  
  /**
   * Gets the underlying S3 client for direct operations
   * This should be used sparingly and only when the interface methods are insufficient
   * @returns The S3 client instance
   */
  getS3Client(): S3Client {
    return this.s3Repository.client;
  }
}

/**
 * Creates a new S3Service instance with default configuration
 * @returns S3Service instance
 */
export function createS3Service(): S3ServiceInterface {
  // Create the S3 repository with retry logic
  const s3Repository = new S3Repository({
    region: env.S3_REGION,
    bucketName: env.BUCKET_NAME,
    retryOptions: {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      useExponentialBackoff: true
    }
  });
  
  // Create the base S3 service
  const s3Service: S3ServiceInterface = new S3Service(s3Repository);
  
  logger.info('S3 service created');
  
  return s3Service;
}
