/**
 * API Response Types
 * Standardized response structures for the API
 */

/**
 * Standard API response structure
 * Provides consistency across all API endpoints
 */
export interface ApiResponse<T> {
  data: T;
  metadata?: Record<string, any>;
}

/**
 * File metadata response
 */
export interface FileMetadataResponse {
  key: string;
  size: number;
  lastModified: string | Date;
  contentType: string;
  etag?: string;
  metadata?: Record<string, any>;
}

/**
 * File listing response
 */
export interface FileListingResponse {
  files: Array<{
    key: string;
    size: number;
    lastModified: Date | string;
    isFile: boolean;
  }>;
  directories: Array<{
    key: string;
    isFile: boolean;
  }>;
}

/**
 * File preview response
 */
export interface FilePreviewResponse {
  data: any;
  metadata: {
    fileType: string;
    totalLines?: number;
    previewLines?: number;
    truncated?: boolean;
  };
}

/**
 * Processing job response
 */
export interface ProcessingJobResponse {
  jobId: string;
  status: 'submitted' | 'pending' | 'in-progress' | 'completed' | 'failed';
  databankId: string;
  operations?: {
    createZip: boolean;
    generateReport: boolean;
  };
  createdAt: string;
  estimatedCompletionTime?: string;
  results?: {
    zip?: {
      complete: boolean;
      zipKey?: string;
      size?: number;
      fileCount?: number;
    };
    report?: {
      complete: boolean;
      reportKey?: string;
      pageCount?: number;
      summary?: string;
    };
  };
  error?: string;
}

/**
 * Upload response
 */
export interface UploadResponse {
  key: string;
  uploadId: string;
  presignedUrls: Record<string, string>;
}
