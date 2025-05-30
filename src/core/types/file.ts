/**
 * File and S3 related type definitions
 */
import { FileTypes } from '../../config/constants';

/**
 * Type representing supported file types for preview
 */
export type SupportedFileType = keyof typeof FileTypes;

/**
 * Type representing file types for file operations
 */
export type FileType = string;

/**
 * Interface representing file metadata
 */
export interface FileMetadata {
  /** S3 object key */
  key: string;
  
  /** File size in bytes */
  size: number;
  
  /** Last modified date */
  lastModified: Date;
  
  /** Content type */
  contentType: string;
  
  /** Whether the object is a file (not a folder) */
  isFile: true;
  
  /** Whether the object is a folder (convenience property) */
  isFolder?: false;
}

/**
 * Interface representing folder metadata
 */
export interface FolderMetadata {
  /** S3 object key */
  key: string;
  
  /** Last modified date */
  lastModified: Date;
  
  /** Number of child objects */
  childCount: number;
  
  /** Whether the object is a folder (not a file) */
  isFile: false;
  
  /** Whether the object is a folder (convenience property) */
  isFolder?: true;
  
  /** Optional size property for type compatibility */
  size?: never;
  
  /** Optional contentType property for type compatibility */
  contentType?: never;
}

/**
 * Interface for generic S3 object properties that both files and folders have
 */
export interface S3ObjectBase {
  /** S3 object key */
  key: string;
  
  /** Last modified date */
  lastModified: Date;
  
  /** Whether the object is a file */
  isFile: boolean;
  
  /** Whether the object is a folder */
  isFolder?: boolean;
  
  /** Size in bytes (for files) */
  size?: number;
  
  /** Content type (for files) */
  contentType?: string;
  
  /** Number of child objects (for folders) */
  childCount?: number;
}

/**
 * Type representing an S3 object (file or folder)
 */
export type S3Object = FileMetadata | FolderMetadata | S3ObjectBase;

/**
 * Interface for file preview options
 */
export interface FilePreviewOptions {
  /** Maximum number of lines to return */
  maxLines?: number;
  
  /** File type for preview */
  fileType?: SupportedFileType;
}

/**
 * Interface for CSV preview result
 */
export interface CSVPreviewResult {
  /** CSV data rows */
  data: Record<string, any>[];
  
  /** CSV headers */
  headers: string[];
  
  /** Total number of rows */
  totalRows: number;
}

/**
 * Interface for XLSX preview result
 */
export interface XLSXPreviewResult {
  /** Sheet data */
  data: Record<string, any>[];
  
  /** Column headers */
  headers: string[];
  
  /** Available sheet names */
  sheets: string[];
  
  /** Total number of rows */
  totalRows: number;
}

/**
 * Interface for Parquet preview result
 */
export interface ParquetPreviewResult {
  /** Parquet data rows */
  data: Record<string, any>[];
  
  /** Column headers */
  headers: string[];
  
  /** Schema information */
  schema: Record<string, any>;
  
  /** Total number of rows */
  totalRows: number;
}

/**
 * Interface for multipart upload initialization
 */
export interface MultipartUploadInit {
  /** Upload ID */
  uploadId: string;
  
  /** S3 object key */
  key: string;
}

/**
 * Interface for multipart upload part
 */
export interface MultipartUploadPart {
  /** Part number */
  PartNumber: number;
  
  /** ETag of the uploaded part */
  ETag: string;
}
