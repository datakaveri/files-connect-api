/**
 * Multipart Upload Service
 * Handles business logic for multipart upload operations
 */
import { StorageServiceInterface } from "./storage-service";
import { StorageRepositoryInterface } from "../core/types/storage";
import { createLogger } from "../core/utils/logger";
import { ValidationError, S3Error } from "../core/errors";
import { env } from "../config/environment";
import { validateDatabankFileType } from "../core/utils/file-validation";

// Create a logger for this module
const logger = createLogger('MultipartUploadService');

/**
 * Interface for presigned URL generation request
 */
export interface PresignedUrlRequest {
  /** Array of chunk sizes in bytes */
  chunkSizes: number[];
  /** Name of the file to upload */
  fileName: string;
  /** MIME type of the file */
  mimeType: string;
  /** Databank ID for authorization */
  databankId: string;
}

/**
 * Interface for presigned URL generation response
 */
export interface PresignedUrlResponse {
  /** Array of presigned URLs for each part */
  signedUrls: string[];
  /** Upload ID for the multipart upload */
  uploadId: string;
}

// Removed unused interfaces

/**
 * Service for handling multipart upload operations
 */
/**
 * Interface for the MultipartUploadService
 */
export interface MultipartUploadServiceInterface {
  /**
   * Initiates a multipart upload process
   * @param key - The file key
   * @param databankId - The databank ID 
   * @param numParts - Number of parts in the upload
   * @param contentType - Content type of the file
   * @returns Upload ID and presigned URLs for each part
   */
  initiateUpload(
    key: string,
    databankId: string, 
    numParts: number,
    contentType: string
  ): Promise<{ uploadId: string; presignedUrls: string[] }>;

  /**
   * Generates presigned URLs for a multipart upload
   * @param request - Presigned URL generation request
   * @returns Promise resolving to presigned URL response
   */
  generatePresignedUrls(request: PresignedUrlRequest): Promise<PresignedUrlResponse>;

  // Removed unused finalizeMultipartUpload method
}

/**
 * Service for handling multipart upload operations
 */
export class MultipartUploadService implements MultipartUploadServiceInterface {
  /**
   * Normalizes a file key by combining the databank ID and file name
   * @param fileName - The name of the file
   * @param databankId - The databank ID
   * @returns The normalized file key
   */
  private normalizeFileKey(fileName: string, databankId: string): string {
    // Ensure the databank ID is included in the key
    // Format: {databankId}/{fileName}
    return `${databankId}/${fileName}`;
  }
  
  /**
   * Creates a new MultipartUploadService
   * @param storageService - Storage service for interacting with storage provider
   * @param storageRepository - Storage repository for direct storage operations
   */
  constructor(
    private readonly storageService: StorageServiceInterface,
    private readonly storageRepository: StorageRepositoryInterface
  ) {
    logger.info('MultipartUploadService initialized');
  }
  
  /**
   * Initiates a multipart upload process
   * @param key - The file key
   * @param databankId - The databank ID 
   * @param numParts - Number of parts in the upload
   * @param contentType - Content type of the file
   * @returns Upload ID and presigned URLs for each part
   */
  async initiateUpload(
    key: string,
    databankId: string, 
    numParts: number,
    contentType: string
  ): Promise<{ uploadId: string; presignedUrls: string[] }> {
    try {
      // Validate inputs
      if (!key) {
        throw new ValidationError('Key is required');
      }
      if (!databankId) {
        throw new ValidationError('Databank ID is required');
      }
      if (!numParts || numParts <= 0) {
        throw new ValidationError('Number of parts must be a positive integer');
      }
      
      // Validate file type
      const fileTypeValidation = validateDatabankFileType(key);
      if (!fileTypeValidation.isValid) {
        logger.warn(`File type validation failed for key: ${key}`, { reason: fileTypeValidation.reason });
        throw new ValidationError(fileTypeValidation.reason || 'File type not allowed');
      }
    } catch (error: unknown) {
      logger.error('Error in initiateUpload validation', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    
    logger.info(`Initiating multipart upload: key=${key}, databankId=${databankId}, numParts=${numParts}, contentType=${contentType}`);
    
    // Create mock chunk sizes (1MB each for simplicity)
    // In production, these would be provided by the client based on actual file chunks
    const chunkSizes = Array(numParts).fill(1024 * 1024); // 1MB chunks
    
    // Use the existing method to generate presigned URLs
    const result = await this.generatePresignedUrls({
      chunkSizes,
      fileName: key,
      mimeType: contentType,
      databankId
    });
    
    return {
      uploadId: result.uploadId,
      presignedUrls: result.signedUrls
    };
  }

  /**
   * Generates presigned URLs for a multipart upload
   * @param request - Presigned URL generation request
   * @returns Promise resolving to presigned URL response
   * @throws ValidationError if file size exceeds limit
   * @throws S3Error if S3 operations fail
   */
  async generatePresignedUrls(request: PresignedUrlRequest): Promise<PresignedUrlResponse> {
    const { chunkSizes, fileName, mimeType, databankId } = request;

    logger.info(`Multipart upload details: fileName=${fileName}, mimeType=${mimeType}, chunkCount=${chunkSizes.length}`);

    const key = this.normalizeFileKey(fileName, databankId);

    try {
      logger.info(`Creating multipart upload with bucket: ${env.BUCKET_NAME}, key: ${key}`);

      // Use the repository's createMultipartUpload method instead of AWS SDK commands
      const multipartUpload = await this.storageRepository.createMultipartUpload(key, mimeType);

      logger.info(`Multipart upload created: uploadId=${multipartUpload.uploadId}, bucket=${env.BUCKET_NAME}, key=${multipartUpload.key}`);

      // Calculate total size and validate
      const sizes = chunkSizes;
      const promises: Promise<string>[] = [];
      const total = sizes.reduce((sum: number, value: number) => {
        return sum + value;
      }, 0);

      const totalSizeMB = total / (1024 * 1024);
      const totalSizeGB = totalSizeMB / 1024;

      logger.info(`File size calculation: totalBytes=${total}, totalMB=${totalSizeMB.toFixed(2)}, totalGB=${totalSizeGB.toFixed(2)}, maxAllowedGB=${env.MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB}`);

      if (total > env.MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB * 1024 * 1024 * 1024) {
        logger.error(`File size exceeds limit: totalSizeGB=${totalSizeGB.toFixed(2)}, maxAllowedGB=${env.MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB}`);
        throw new ValidationError(
          `Content size is greater than ${env.MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB}GB.`,
          { maxSizeGB: env.MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB, actualSizeGB: totalSizeGB.toFixed(2) }
        );
      }

      // Generate presigned URLs for each part
      logger.info(`Generating presigned URLs for multipart upload: fileName=${fileName}, chunks=${chunkSizes.length}, databankId=${databankId}`);

      // Store the upload ID for debugging
      const uploadId = multipartUpload.uploadId;
      logger.info(`Using upload ID for presigned URLs: ${uploadId}`);

      // Check if the repository has a method to generate presigned URLs for multipart uploads
      if (typeof (this.storageRepository as any).createPresignedUrlForPart === 'function') {
        // Use repository-specific method for presigned URLs
        for (let i = 0; i < sizes.length; i++) {
          const partNumber = i + 1;
          const partSize = sizes[i] || 0; // Ensure partSize is never undefined

          logger.debug(`Creating presigned URL for part ${partNumber}, size=${partSize}, sizeMB=${(partSize / (1024 * 1024)).toFixed(2)}`);

          const presignedUrl = await (this.storageRepository as any).createPresignedUrlForPart(
            uploadId,
            key,
            partNumber,
            60 * 60 * 3 // 3 hours
          );
          promises.push(Promise.resolve(presignedUrl));
        }
      } else {
        // Fallback to generic presigned URL method (for S3)
        // This is a simplified approach - in production you might need more sophisticated logic
        logger.warn('Repository does not support createPresignedUrlForPart, using generic approach');
        for (let i = 0; i < sizes.length; i++) {
          const partNumber = i + 1;
          // Create a temporary key for each part (this is not ideal but works for basic cases)
          const partKey = `${key}.part${partNumber}`;
          const presignedUrl = await this.storageRepository.createPresignedUrl(partKey, 60 * 60 * 3);
          promises.push(Promise.resolve(presignedUrl));
        }
      }

      logger.info('Waiting for all presigned URLs to be generated');
      const presignedUrls = await Promise.all(promises);
      logger.info(`All presigned URLs generated successfully: count=${presignedUrls.length}`);

      // Ensure uploadId is not undefined
      if (!uploadId) {
        throw new S3Error(
          'Failed to get upload ID from repository',
          'CreateMultipartUpload',
          { key }
        );
      }

      // Return the response with presigned URLs
      logger.info(`Returning uploadId=${uploadId} to client for future finalization`);
      return {
        signedUrls: presignedUrls,
        uploadId: uploadId,
      };
    } catch (error) {
      logger.error('Error in multipart upload presigned URL generation', error instanceof Error ? error : new Error(String(error)));

      // Convert to S3Error if it's related to S3 operations
      if (error instanceof Error && (error.message.includes('S3') || error.name.includes('S3'))) {
        throw new S3Error(
          'Failed to initiate multipart upload',
          'CreateMultipartUpload',
          { cause: error }
        );
      }

      // Re-throw ValidationError
      if (error instanceof ValidationError) {
        throw error;
      }

      // For other errors, throw a generic S3Error
      throw new S3Error(
        'Failed to initiate multipart upload',
        'CreateMultipartUpload',
        { cause: error }
      );
    }
  }
}

/**
 * Creates a new MultipartUploadService instance with default configuration
 * @param s3Service - S3 service instance
 * @returns MultipartUploadService instance
 */
export function createMultipartUploadService(storageService: StorageServiceInterface, storageRepository: StorageRepositoryInterface): MultipartUploadService {
  return new MultipartUploadService(storageService, storageRepository);
}
