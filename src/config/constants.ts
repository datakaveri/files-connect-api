/**
 * Application constants
 * This file contains constants used throughout the application
 */

// S3 related constants
export const S3Constants = {
  // Maximum number of keys to return in a single list operation
  MAX_KEYS: 1000,
  
  // Default expiration time for presigned URLs (in seconds)
  DEFAULT_PRESIGNED_URL_EXPIRATION: 300, // 5 minutes
  
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
    ADMIN: 'cos_admin',
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
  TSV: 'tsv',
  XLSX: 'xlsx',
  PARQUET: 'parquet',
  TXT: 'txt',
  ZIP: 'zip'
} as const;

// Allowed file types for different upload types
export const AllowedFileTypes = {
  // For asset uploads (PDF and images)
  ASSETS: ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tiff', 'bmp'],
  
  // For databank uploads (data files only)
  DATABANK: [
    'aiconfig', 'ark', 'arrow', 'bif', 'bin', 'bpe', 'cbm', 'cfg', 'ckpt', 'conf',
    'crfsuite', 'csv', 'dict', 'elki', 'emb', 'engine', 'geojson', 'ggml', 'gguf', 'gpickle', 'h5',
    'hdf', 'hdf5', 'ini', 'jlso', 'joblib', 'json', 'md', 'mlmodel', 'model', 'mrk', 'nav', 'nc',
    'nemo', 'npy', 'npz', 'obs', 'onnx', 'parquet', 'pb', 'pbmm', 'pkl', 'pmml', 'pt',
    'pth', 'rds', 'safetensors', 'spacy', 'tflite', 'tfhub', 'toml', 'tsv', 'txt', 'xml', 'yaml',
    'yml', 'xlsx', 'xls', 'pdf', 'doc', 'docx', 'mp3', 'jpeg', 'png', 'tiff', 'dcm', 'tif', 'jpg'
  ]
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
  
  // Asset operations (separate from databanks)
  ASSETS: '/assets',

  // Encryption key distribution (client-side envelope encryption)
  ENCRYPTION: '/encryption',
  
  // Sub-resources (accessed through databanks/{databankId}/...)
  DATABANK_FILES: 'files',          // For file operations within a databank
  DATABANK_UPLOADS: 'uploads',      // For upload operations within a databank
  DATABANK_PROCESS: 'process',      // For processing jobs within a databank
  DATABANK_DOWNLOAD: 'download'     // For downloading databank as zip
} as const;
