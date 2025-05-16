/**
 * Common utility functions
 */

/**
 * Checks if a string is a valid URL
 * @param str - String to check
 * @returns True if the string is a valid URL, false otherwise
 */
export function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Safely parses JSON without throwing an exception
 * @param str - JSON string to parse
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed JSON object or fallback value
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch (err) {
    return fallback;
  }
}

/**
 * Extracts the file extension from a file path
 * @param filePath - File path
 * @returns File extension (lowercase, without the dot) or empty string if no extension
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
}

/**
 * Checks if a path represents a folder (ends with a slash)
 * @param path - Path to check
 * @returns True if the path represents a folder, false otherwise
 */
export function isFolder(path: string): boolean {
  return path.endsWith('/');
}

/**
 * Extracts the filename from a path
 * @param path - Path to extract filename from
 * @returns Filename without the path
 */
export function getFilename(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Formats a byte size to a human-readable string
 * @param bytes - Size in bytes
 * @param decimals - Number of decimal places
 * @returns Formatted size string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * Generates a random string of specified length
 * @param length - Length of the random string
 * @returns Random string
 */
export function generateRandomString(length: number = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}
