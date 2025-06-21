/**
 * File Validation Utilities
 * Provides functions for validating file types and content
 */
import { createLogger } from './logger';
import path from 'path';
import { AllowedFileTypes } from '../../config/constants';

// Create a logger for this module
const logger = createLogger('FileValidation');

// Define allowed file extensions for databank uploads
export const ALLOWED_DATABANK_FILE_EXTENSIONS = AllowedFileTypes.DATABANK.map(ext => `.${ext}`);

// Define known executable extensions that should be blocked
export const BLOCKED_EXECUTABLE_EXTENSIONS = [
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.com',
  '.js', '.py', '.php', '.pl', '.rb', '.ps1', '.msi',
  '.jar', '.war', '.ear', '.class', '.vbs', '.wsf',
  '.app', '.dmg', '.deb', '.rpm', '.apk', '.xlsx', '.xls',
  '.pdf', '.doc', '.docx', '.ppt', '.pptx'
];

/**
 * Validates if a file is allowed for databank upload based on its key/filename
 * @param key - The file key or filename
 * @returns Object with validation result and reason if not allowed
 */
export function validateDatabankFileType(key: string): { isValid: boolean; reason?: string } {
  if (!key) {
    return { isValid: false, reason: 'File key is empty' };
  }

  const extension = path.extname(key).toLowerCase();
  
  // Check if the file extension is in the blocked list
  if (BLOCKED_EXECUTABLE_EXTENSIONS.includes(extension)) {
    logger.warn(`Blocked executable file upload attempt: ${key}`);
    return { 
      isValid: false, 
      reason: `File type not allowed: ${extension}. Executable files are not permitted.` 
    };
  }

  // Check if the file extension is in the allowed list
  if (!ALLOWED_DATABANK_FILE_EXTENSIONS.includes(extension)) {
    logger.warn(`Unsupported file type upload attempt: ${key}`);
    return { 
      isValid: false, 
      reason: `File type not allowed: ${extension}` 
    };
  }

  return { isValid: true };
}
