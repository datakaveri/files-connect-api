/**
 * MinIO Repository Module
 *
 * This module provides a repository layer for interacting with MinIO service.
 * It implements the StorageRepositoryInterface to provide a unified interface
 * for MinIO operations, compatible with the generic storage abstraction.
 *
 * @module repositories/minio-repository
 */
import * as Minio from "minio";
import { Readable } from "stream";
import { StorageRepositoryInterface, StorageConfig, MultipartUploadResult } from "../core/types/storage";
import { createLogger } from "../core/utils/logger";
import { withRetry, RetryOptions, DEFAULT_RETRY_OPTIONS } from "../core/utils/retry-utils";

// Create a logger for this module
const logger = createLogger("MinIORepository");

/**
 * Configuration options for the MinIO repository
 */
export interface MinIORepositoryConfig extends StorageConfig {
  retryOptions?: Partial<RetryOptions>;
}

/**
 * MinIO repository implementation
 *
 * This class provides a concrete implementation of the StorageRepositoryInterface
 * using the MinIO client library. It handles direct interactions with MinIO servers
 * and includes retry logic for handling transient errors.
 *
 * @class MinIORepository
 * @implements {StorageRepositoryInterface}
 */
export class MinIORepository implements StorageRepositoryInterface {
  private minioClient: Minio.Client;
  private bucketName: string;
  private config: MinIORepositoryConfig;

  constructor(config: MinIORepositoryConfig) {
    this.config = config;
    this.bucketName = config.bucketName;

    // Parse endpoint to extract hostname and port
    // Handle cases: "minio.iudx.io", "http://minio.iudx.io", "https://minio.iudx.io:443"
    let endpointUrl: URL;
    if (config.endpoint.startsWith("http://") || config.endpoint.startsWith("https://")) {
      endpointUrl = new URL(config.endpoint);
    } else {
      // If no protocol, infer from useSSL setting
      const protocol = config.useSSL !== false ? "https" : "http";
      endpointUrl = new URL(`${protocol}://${config.endpoint}`);
    }

    const hostname = endpointUrl.hostname;

    // Determine port: explicit config > URL port > default based on SSL
    let port: number;
    if (config.port) {
      port = config.port;
    } else if (endpointUrl.port) {
      port = parseInt(endpointUrl.port, 10);
    } else {
      // Default ports: 443 for HTTPS, 80 for HTTP
      port = config.useSSL !== false ? 443 : 80;
    }

    // Initialize MinIO client
    this.minioClient = new Minio.Client({
      endPoint: hostname,
      port: port,
      useSSL: config.useSSL !== false, // Default to true
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region || "us-east-1",
    });

    logger.info("MinIO repository initialized", {
      endpoint: config.endpoint,
      hostname: hostname,
      port: port,
      bucketName: this.bucketName,
      useSSL: config.useSSL !== false,
    });
  }

  /**
   * Lists objects in the MinIO bucket with the given prefix
   */
  async listObjects(prefix: string, maxKeys: number = 1000, delimiter: string = "/"): Promise<any> {
    return withRetry(async () => {
      const stream = this.minioClient.listObjectsV2(this.bucketName, prefix, true);
      const objects: any[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (obj: any) => {
          objects.push(obj);
          if (objects.length >= maxKeys) {
            stream.destroy(); // Stop reading if we have enough objects
          }
        });

        stream.on("end", () => {
          // Convert MinIO format to S3-compatible format
          const contents = objects.map((obj) => ({
            Key: obj.name,
            Size: obj.size,
            LastModified: obj.lastModified,
            ETag: obj.etag,
            StorageClass: "STANDARD",
          }));

          resolve({
            Contents: contents,
            IsTruncated: objects.length >= maxKeys,
            KeyCount: contents.length,
            MaxKeys: maxKeys,
            Prefix: prefix,
            Delimiter: delimiter,
          });
        });

        stream.on("error", reject);
      });
    }, this.config.retryOptions);
  }

  /**
   * Lists objects with continuation token support
   */
  async listObjectsWithToken(prefix: string, maxKeys: number = 1000, delimiter: string = "/", continuationToken?: string): Promise<any> {
    return withRetry(async () => {
      // MinIO doesn't have continuation tokens like S3, so we use startAfter
      const stream = this.minioClient.listObjectsV2(this.bucketName, prefix, true);
      const objects: any[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (obj: any) => {
          objects.push(obj);
          if (objects.length >= maxKeys) {
            stream.destroy(); // Stop reading if we have enough objects
          }
        });

        stream.on("end", () => {
          // Convert MinIO format to S3-compatible format
          const contents = objects.map((obj) => ({
            Key: obj.name,
            Size: obj.size,
            LastModified: obj.lastModified,
            ETag: obj.etag,
            StorageClass: "STANDARD",
          }));

          resolve({
            Contents: contents,
            IsTruncated: objects.length >= maxKeys,
            KeyCount: contents.length,
            MaxKeys: maxKeys,
            Prefix: prefix,
            Delimiter: delimiter,
            NextContinuationToken: undefined,
          });
        });

        stream.on("error", reject);
      });
    }, this.config.retryOptions);
  }

  /**
   * Gets an object from the MinIO bucket
   */
  async getObject(key: string): Promise<any> {
    return withRetry(async () => {
      const stream = await this.minioClient.getObject(this.bucketName, key);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            Body: buffer,
            ContentLength: buffer.length,
            ContentType: undefined, // Would need to be determined from metadata
            LastModified: undefined,
            ETag: undefined,
            Metadata: {},
          });
        });
        stream.on("error", reject);
      });
    }, this.config.retryOptions);
  }

  async headObject(key: string): Promise<{ ContentLength?: number; ContentType?: string; LastModified?: Date } | null> {
    return withRetry(async () => {
      try {
        const stat = await this.minioClient.statObject(this.bucketName, key);
        return {
          ContentLength: stat.size,
          ContentType: stat.metaData?.['content-type'],
          LastModified: stat.lastModified,
        };
      } catch (error: any) {
        if (error?.code === 'NotFound' || error?.code === 'NoSuchKey' || error?.message === 'Not Found') {
          return null;
        }
        throw error;
      }
    }, this.config.retryOptions);
  }

  /**
   * Gets a partial object from the MinIO bucket (first N bytes)
   */
  async getPartialObject(key: string, maxBytes: number): Promise<any> {
    return withRetry(async () => {
      const stream = await this.minioClient.getPartialObject(this.bucketName, key, 0, maxBytes);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            Body: buffer,
            ContentLength: buffer.length,
            ContentType: undefined,
            LastModified: undefined,
            ETag: undefined,
            Metadata: {},
          });
        });
        stream.on("error", reject);
      });
    }, this.config.retryOptions);
  }

  /**
   * Puts an object in the MinIO bucket
   */
  async putObject(key: string, body: Buffer | Uint8Array | string | Readable, contentType?: string): Promise<any> {
    return withRetry(async () => {
      let buffer: Buffer;
      let size: number;

      if (Buffer.isBuffer(body)) {
        buffer = body;
        size = body.length;
      } else if (body instanceof Uint8Array) {
        buffer = Buffer.from(body);
        size = buffer.length;
      } else if (typeof body === "string") {
        buffer = Buffer.from(body, "utf8");
        size = buffer.length;
      } else if (body instanceof Readable) {
        // Handle streams
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
        size = buffer.length;
      } else {
        throw new Error("Unsupported body type");
      }

      await this.minioClient.putObject(this.bucketName, key, buffer, size, {
        "Content-Type": contentType || "application/octet-stream",
      });

      return {
        ETag: `"${this.generateETag(buffer)}"`,
        VersionId: undefined,
      };
    }, this.config.retryOptions);
  }

  /**
   * Deletes an object from the MinIO bucket
   */
  async deleteObject(key: string): Promise<any> {
    return withRetry(async () => {
      await this.minioClient.removeObject(this.bucketName, key);
      return {
        DeleteMarker: false,
        VersionId: undefined,
      };
    }, this.config.retryOptions);
  }

  /**
   * Creates a multipart upload
   */
  async createMultipartUpload(key: string, contentType?: string): Promise<MultipartUploadResult> {
    return withRetry(async () => {
      const uploadId = await this.minioClient.initiateNewMultipartUpload(this.bucketName, key, {
        "Content-Type": contentType || "application/octet-stream",
      });

      return {
        uploadId,
        key,
      };
    }, this.config.retryOptions);
  }

  /**
   * Uploads a part in a multipart upload
   */
  async uploadPart(uploadId: string, key: string, partNumber: number, body: Buffer | Uint8Array | string | Readable): Promise<string> {
    return withRetry(async () => {
      let buffer: Buffer;

      if (Buffer.isBuffer(body)) {
        buffer = body;
      } else if (body instanceof Uint8Array) {
        buffer = Buffer.from(body);
      } else if (typeof body === "string") {
        buffer = Buffer.from(body, "utf8");
      } else if (body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      } else {
        throw new Error("Unsupported body type for multipart upload");
      }

      const result = await (this.minioClient as any).uploadPart(this.bucketName, key, uploadId, partNumber, buffer);

      return result.etag;
    }, this.config.retryOptions);
  }

  /**
   * Completes a multipart upload
   */
  async completeMultipartUpload(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<any> {
    return withRetry(async () => {
      const etags = parts.map((part) => ({ etag: part.ETag, part: part.PartNumber }));
      await this.minioClient.completeMultipartUpload(this.bucketName, key, uploadId, etags);

      return {
        Location: `${this.config.endpoint}/${this.bucketName}/${key}`,
        Bucket: this.bucketName,
        Key: key,
        ETag: `"${this.generateETag(Buffer.from(""))}"`, // Simplified ETag
      };
    }, this.config.retryOptions);
  }

  /**
   * Aborts a multipart upload
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<any> {
    return withRetry(async () => {
      await this.minioClient.abortMultipartUpload(this.bucketName, key, uploadId);
      return {};
    }, this.config.retryOptions);
  }

  /**
   * Creates a presigned URL for an object
   */
  async createPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    return withRetry(async () => {
      const url = await this.minioClient.presignedGetObject(this.bucketName, key, expiresIn);
      return url;
    }, this.config.retryOptions);
  }

  /**
   * Creates a presigned URL for uploading a part in a multipart upload
   */
  async createPresignedUrlForPart(uploadId: string, key: string, partNumber: number, expiresIn: number = 3600): Promise<string> {
    return withRetry(async () => {
      // For multipart uploads, we need to include uploadId and partNumber in the signature
      const reqParams = {
        'uploadId': uploadId,
        'partNumber': partNumber.toString()
      };
      const url = await this.minioClient.presignedUrl('PUT', this.bucketName, key, expiresIn, reqParams);
      return url;
    }, this.config.retryOptions);
  }

  /**
   * Gets the underlying MinIO client
   */
  getClient(): Minio.Client {
    return this.minioClient;
  }

  /**
   * Generates a simple ETag for MinIO objects (simplified implementation)
   */
  private generateETag(buffer: Buffer): string {
    const crypto = require("crypto");
    return crypto.createHash("md5").update(buffer).digest("hex");
  }
}
