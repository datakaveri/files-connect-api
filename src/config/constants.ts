/**
 * Application constants
 * This file contains constants used throughout the application
 */

// S3 related constants
export const S3Constants = {
  // Maximum number of keys to return in a single list operation
  MAX_KEYS: 1000,
  
  // Default expiration time for presigned URLs (in seconds)
  DEFAULT_PRESIGNED_URL_EXPIRATION: 3600,
  
  // Maximum file size for preview (in bytes)
  MAX_PREVIEW_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Default number of lines to return in a preview
  DEFAULT_PREVIEW_LINES: 100,
};

// Authentication related constants
export const AuthConstants = {
  // User roles
  ROLES: {
    PROVIDER: 'provider',
    CONSUMER: 'consumer',
  },
  
  // Token related constants
  TOKEN: {
    // Header name for the authorization token
    HEADER: 'Authorization',
    
    // Prefix for the authorization token
    PREFIX: 'Bearer',
  },
};

// File type constants
export const FileTypes = {
  CSV: 'csv',
  JSON: 'json',
  XML: 'xml',
  XLSX: 'xlsx',
} as const;

/**
 * API paths for different endpoints
 */
export const ApiPaths = {
  S3: '/s3',
  FILE_PREVIEW: '/file',
  MULTIPART_UPLOAD: '/uploads',
  LAMBDA_TRIGGER: '/lambda',
  UPLOADS: '/uploads',  // Alias for MULTIPART_UPLOAD
  ZIP: '/zip',          // Path for zip download routes
  LAMBDA: '/lambda',    // Alias for LAMBDA_TRIGGER
  HEALTH: '/health'     // Path for health check routes
} as const;
