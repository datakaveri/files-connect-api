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
  PARQUET: 'parquet',
} as const;

/**
 * API paths for different endpoints
 * Organized by functionality and following REST practices
 * All endpoints are now organized under databanks for better resource hierarchy
 */
export const ApiPaths = {
  // Health check routes
  HEALTH: '/health',
  
  // Databank operations (main resource)
  DATABANKS: '/databanks',
  
  // Sub-resources (accessed through databanks/{databankId}/...)
  DATABANK_FILES: 'files',          // For file operations within a databank
  DATABANK_UPLOADS: 'uploads',      // For upload operations within a databank
  DATABANK_PROCESS: 'process',      // For processing jobs within a databank
  DATABANK_DOWNLOAD: 'download'     // For downloading databank as zip
} as const;
