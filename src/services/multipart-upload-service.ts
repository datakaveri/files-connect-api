/**
 * Multipart Upload Service
 * Handles business logic for multipart upload operations
 */
import { 
  CompleteMultipartUploadCommand, 
  CreateMultipartUploadCommand, 
  UploadPartCommand 
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3ServiceInterface } from "./s3-service";
import { createLogger } from "../core/utils/logger";
import { ValidationError, S3Error } from "../core/errors";
import { env } from "../config/environment";
import { MultipartUploadPart } from "../core/types/file";

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

/**
 * Interface for multipart upload finalization request
 */
export interface FinalizeMultipartUploadRequest {
  /** Upload ID from the initiation step */
  uploadId: string;
  /** File key (path in S3) */
  fileKey?: string;
  /** File name (if fileKey is not provided) */
  fileName?: string;
  /** Array of parts with ETags and part numbers */
  parts: MultipartUploadPart[];
  /** Databank ID for authorization */
  databankId: string;
}

/**
 * Interface for multipart upload finalization response
 */
export interface FinalizeMultipartUploadResponse {
  /** Success message */
  message: string;
  /** S3 location of the uploaded file */
  location?: string;
  /** ETag of the completed upload */
  etag?: string;
}

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

  /**
   * Finalizes a multipart upload
   * @param request - Finalize multipart upload request
   * @returns Promise resolving to finalize multipart upload response
   */
  finalizeMultipartUpload(request: FinalizeMultipartUploadRequest): Promise<FinalizeMultipartUploadResponse>;
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
   * @param s3Service - S3 service for interacting with S3
   */
  constructor(private readonly s3Service: S3ServiceInterface) {
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
      // Create multipart upload
      const bucketName = env.BUCKET_NAME;
      
      const command = new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: mimeType,
      });
      
      logger.info(`Creating multipart upload with bucket: ${bucketName}, key: ${key}`);
      
      logger.info('Creating multipart upload in S3');
      
      // Get S3 client from the service
      const s3Client = this.s3Service.getS3Client();
      const multipartUpload = await s3Client.send(command);
      
      logger.info(`Multipart upload created: uploadId=${multipartUpload.UploadId}, bucket=${env.BUCKET_NAME}, key=${multipartUpload.Key}`);
      
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
      const uploadId = multipartUpload.UploadId as string;
      logger.info(`Using upload ID for presigned URLs: ${uploadId}`);
      
      for (let i = 0; i < sizes.length; i++) {
        const partNumber = i + 1;
        const partSize = sizes[i] || 0; // Ensure partSize is never undefined
        
        logger.debug(`Creating presigned URL for part ${partNumber}, size=${partSize}, sizeMB=${(partSize / (1024 * 1024)).toFixed(2)}`);
        
        const command = new UploadPartCommand({
          Bucket: env.BUCKET_NAME,
          Key: multipartUpload.Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: partSize,
        });
        promises.push(getSignedUrl(s3Client, command, { expiresIn: 60 * 60 * 3 }));
      }
      
      logger.info('Waiting for all presigned URLs to be generated');
      const presignedUrls = await Promise.all(promises);
      logger.info(`All presigned URLs generated successfully: count=${presignedUrls.length}`);
      
      // Ensure uploadId is not undefined
      if (!multipartUpload.UploadId) {
        throw new S3Error(
          'Failed to get upload ID from S3',
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

  /**
   * Finalizes a multipart upload
   * @param request - Finalize multipart upload request
   * @returns Promise resolving to finalize multipart upload response
   * @throws S3Error if S3 operations fail
   */
  async finalizeMultipartUpload(request: FinalizeMultipartUploadRequest): Promise<FinalizeMultipartUploadResponse> {
    const { uploadId, fileKey, fileName, parts, databankId } = request;
    
    logger.info(`Finalizing multipart upload: uploadId=${uploadId}, parts=${parts.length}, databankId=${databankId}`);
    
    try {
      // Determine which field to use (fileKey or fileName)
      if (!fileKey && !fileName) {
        throw new ValidationError('Either fileKey or fileName must be provided');
      }
      
      // If fileKey is not provided, normalize the file name with the databank ID
      // If fileKey is provided, ensure it has the databank prefix
      const normalizedFileKey = fileKey ? 
        (fileKey.startsWith(`${databankId}/`) ? fileKey : `${databankId}/${fileKey}`) : 
        this.normalizeFileKey(fileName as string, databankId);
      
      logger.info(`Original fileKey: ${fileKey}, normalized key: ${normalizedFileKey}`);
      
      logger.info(`Multipart upload finalization details: uploadId=${uploadId}, fileKey=${normalizedFileKey}, providedField=${fileKey ? 'fileKey' : 'fileName'}, partsCount=${parts.length}`);
      
      // Sort parts by part number to ensure correct order
      const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
      
      // Log part details for debugging
      sortedParts.forEach((part, index) => {
        logger.debug(`Part details: index=${index}, partNumber=${part.PartNumber}, etag=${part.ETag}`);
      });
      
      // Log the complete request for debugging
      logger.info(`Complete request details: uploadId=${uploadId}, fileKey=${fileKey}, fileName=${fileName}, partsCount=${parts.length}`);
      logger.info(`Sorted parts: ${JSON.stringify(sortedParts)}`);
      
      // Verify that the upload ID is in the correct format
      if (!uploadId || typeof uploadId !== 'string' || uploadId.trim() === '') {
        logger.error(`Invalid upload ID: ${uploadId}`);
        throw new ValidationError('Invalid upload ID');
      }
      
      logger.info(`Verifying upload ID format: ${uploadId}`);
      
      // Use the exact same key format as in the initiation
      const fullKey = normalizedFileKey;
      const bucketName = env.BUCKET_NAME;
      
      logger.info(`Completing multipart upload: key=${fullKey}, bucket=${bucketName}, uploadId=${uploadId}`);
      
      const command = new CompleteMultipartUploadCommand({
        Bucket: bucketName,
        Key: fullKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts,
        },
      });
      
      // Add additional logging for the command
      logger.info(`CompleteMultipartUploadCommand details: bucket=${env.BUCKET_NAME}, key=${fullKey}, uploadId=${uploadId}, partsCount=${sortedParts.length}`);
      
      const startTime = Date.now();
      logger.info('Sending complete multipart upload command to S3');
      
      // Get S3 client from the service
      const s3Client = this.s3Service.getS3Client();
      const result = await s3Client.send(command);
      const duration = Date.now() - startTime;
      
      logger.info(`Multipart upload completed successfully: duration=${duration}ms, location=${result.Location}, etag=${result.ETag}, key=${fullKey}`);
      
      return { 
        message: "Upload completed successfully",
        location: result.Location,
        etag: result.ETag
      };
    } catch (error) {
      logger.error('Error in finalizing multipart upload', error instanceof Error ? error : new Error(String(error)));
      
      // Log more details about the error
      if (error instanceof Error) {
        logger.error(`Error type: ${error.name}, message: ${error.message}`);
        if ('$metadata' in error) {
          logger.error(`AWS error metadata: ${JSON.stringify((error as any).$metadata)}`);
        }
      }
      
      // Convert to S3Error if it's related to S3 operations
      if (error instanceof Error && (error.message.includes('S3') || error.name.includes('S3'))) {
        throw new S3Error(
          'Failed to complete multipart upload',
          'CompleteMultipartUpload',
          { cause: error }
        );
      }
      
      // Re-throw ValidationError
      if (error instanceof ValidationError) {
        throw error;
      }
      
      // For other errors, throw a generic S3Error
      throw new S3Error(
        'Failed to complete multipart upload',
        'CompleteMultipartUpload',
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
export function createMultipartUploadService(s3Service: S3ServiceInterface): MultipartUploadService {
  return new MultipartUploadService(s3Service);
}
