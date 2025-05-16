/**
 * Type guards for runtime type checking
 */
import { FileMetadata, FolderMetadata, S3Object } from '../types/file';
import { DecodedToken } from '../types/auth';

/**
 * Type guard to check if an object is a FileMetadata
 * @param obj - Object to check
 * @returns True if the object is a FileMetadata
 */
export function isFileMetadata(obj: any): obj is FileMetadata {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.key === 'string' &&
    typeof obj.size === 'number' &&
    obj.lastModified instanceof Date &&
    typeof obj.contentType === 'string' &&
    obj.isFile === true
  );
}

/**
 * Type guard to check if an object is a FolderMetadata
 * @param obj - Object to check
 * @returns True if the object is a FolderMetadata
 */
export function isFolderMetadata(obj: any): obj is FolderMetadata {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.key === 'string' &&
    obj.lastModified instanceof Date &&
    typeof obj.childCount === 'number' &&
    obj.isFile === false
  );
}

/**
 * Type guard to check if an object is an S3Object
 * @param obj - Object to check
 * @returns True if the object is an S3Object
 */
export function isS3Object(obj: any): obj is S3Object {
  return isFileMetadata(obj) || isFolderMetadata(obj);
}

/**
 * Type guard to check if an object is a DecodedToken
 * @param obj - Object to check
 * @returns True if the object is a DecodedToken
 */
export function isDecodedToken(obj: any): obj is DecodedToken {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj.sub === undefined || typeof obj.sub === 'string') &&
    (obj.exp === undefined || typeof obj.exp === 'number') &&
    (obj.iat === undefined || typeof obj.iat === 'number') &&
    (obj.realm_access === undefined || 
      (typeof obj.realm_access === 'object' && 
       Array.isArray(obj.realm_access.roles)))
  );
}

/**
 * Type guard to check if a value is a non-empty string
 * @param value - Value to check
 * @returns True if the value is a non-empty string
 */
export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard to check if a value is a valid number
 * @param value - Value to check
 * @returns True if the value is a valid number
 */
export function isValidNumber(value: any): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Type assertion function for non-empty string
 * @param value - Value to check
 * @param errorMessage - Error message to throw if assertion fails
 * @throws Error if value is not a non-empty string
 */
export function assertNonEmptyString(value: any, errorMessage: string): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new Error(errorMessage);
  }
}

/**
 * Type assertion function for valid number
 * @param value - Value to check
 * @param errorMessage - Error message to throw if assertion fails
 * @throws Error if value is not a valid number
 */
export function assertValidNumber(value: any, errorMessage: string): asserts value is number {
  if (!isValidNumber(value)) {
    throw new Error(errorMessage);
  }
}
