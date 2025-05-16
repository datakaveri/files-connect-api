/**
 * S3 Routes Types
 * Type definitions for S3 routes request and response objects
 */
import { S3Object } from './file';

/**
 * Interface for list objects request
 */
export interface ListObjectsRequest {
  /** Prefix to filter objects by */
  prefix?: string;
  /** Maximum number of keys to return */
  maxKeys?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Delimiter for grouping objects */
  delimiter?: string;
}

/**
 * Interface for list objects response
 */
export interface ListObjectsResponse {
  /** Array of file objects */
  files: S3Object[];
  /** Array of folder objects */
  folders: S3Object[];
  /** Token for pagination */
  nextContinuationToken?: string;
}

/**
 * Interface for get object request
 */
export interface GetObjectRequest {
  /** Key of the object to get */
  key: string;
  /** Time in seconds until the URL expires */
  expiresIn?: number;
}

/**
 * Interface for get object response
 */
export interface GetObjectResponse {
  /** Presigned URL for downloading the object */
  url: string;
  /** Key of the object */
  key: string;
  /** Time in seconds until the URL expires */
  expiresIn: number;
}

/**
 * Interface for get object details response
 */
export interface GetObjectDetailsResponse {
  /** Key of the object */
  key: string;
  /** Size of the object in bytes (for files only) */
  size?: number;
  /** Last modified date */
  lastModified?: Date;
  /** Content type of the object (for files only) */
  contentType?: string;
  /** Number of child objects (for folders only) */
  childCount?: number;
  /** Whether the object is a file */
  isFile: boolean;
}

/**
 * Interface for create folder request
 */
export interface CreateFolderRequest {
  /** Path of the folder to create */
  folderPath: string;
}

/**
 * Interface for create folder response
 */
export interface CreateFolderResponse {
  /** Success message */
  message: string;
  /** Path of the created folder */
  folderPath: string;
}

/**
 * Interface for delete object request
 */
export interface DeleteObjectRequest {
  /** Key of the object to delete */
  key: string;
  /** Whether to delete recursively (for folders) */
  recursive?: boolean;
}

/**
 * Interface for delete object response
 */
export interface DeleteObjectResponse {
  /** Success message */
  message: string;
  /** Key of the deleted object */
  key: string;
}

/**
 * Interface for delete folder response
 */
export interface DeleteFolderResponse {
  /** Success message */
  message: string;
  /** Path of the deleted folder */
  folderPath: string;
}
