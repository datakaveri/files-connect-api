/**
 * Google Cloud Storage Repository Module
 *
 * This module provides a repository layer for interacting with Google Cloud Storage
 * using the native `@google-cloud/storage` client. It implements the
 * StorageRepositoryInterface to provide a unified interface for GCS operations,
 * compatible with the generic storage abstraction.
 *
 * GCS has no native concept of S3-style multipart uploads (arbitrary part numbers
 * uploaded out of order and reassembled by ETag). Multipart uploads are emulated by
 * uploading each part as a temporary object under a `<key>.gcs-mpu/<uploadId>/`
 * prefix and, on completion, stitching them together in order with the GCS
 * `compose` operation (chained in batches of 32, GCS's per-call source limit).
 *
 * @module repositories/gcs-repository
 */
import { Storage, Bucket } from '@google-cloud/storage';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { StorageRepositoryInterface, StorageConfig, MultipartUploadResult } from '../core/types/storage';
import { createLogger } from '../core/utils/logger';
import { S3Constants } from '../config/constants';
import { withRetry, RetryOptions, DEFAULT_RETRY_OPTIONS } from '../core/utils/retry-utils';

const logger = createLogger('GCSRepository');

/** GCS compose() accepts at most this many source objects per call */
const GCS_COMPOSE_BATCH_LIMIT = 32;

/**
 * Configuration options for the GCS repository
 */
export interface GCSRepositoryConfig extends StorageConfig {
  retryOptions?: Partial<RetryOptions>;
}

/**
 * GCS repository implementation
 *
 * Concrete implementation of the StorageRepositoryInterface using the native
 * Google Cloud Storage client library. Handles direct interactions with GCS,
 * including retry logic for transient errors and multipart upload emulation.
 *
 * @class GCSRepository
 * @implements {StorageRepositoryInterface}
 */
export class GCSRepository implements StorageRepositoryInterface {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;
  private retryOptions: RetryOptions;

  constructor(config: GCSRepositoryConfig) {
    this.bucketName = config.bucketName;
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...config.retryOptions
    };

    const clientOptions: ConstructorParameters<typeof Storage>[0] = {};

    if (config.gcsProjectId) {
      clientOptions.projectId = config.gcsProjectId;
    }

    if (config.gcsKeyFilename) {
      // Service account JSON key file mounted on disk
      clientOptions.keyFilename = config.gcsKeyFilename;
    } else if (config.gcsClientEmail && config.gcsPrivateKey) {
      // Inline service account credentials (e.g. from a Kubernetes secret)
      clientOptions.credentials = {
        client_email: config.gcsClientEmail,
        private_key: config.gcsPrivateKey
      };
    }
    // Otherwise, the client falls back to Application Default Credentials

    this.storage = new Storage(clientOptions);
    this.bucket = this.storage.bucket(this.bucketName);

    logger.info('GCSRepository initialized', {
      bucket: this.bucketName,
      projectId: config.gcsProjectId,
      authMode: config.gcsKeyFilename
        ? 'keyFile'
        : config.gcsClientEmail && config.gcsPrivateKey
          ? 'inlineCredentials'
          : 'applicationDefaultCredentials'
    });
  }

  /**
   * Lists objects in the GCS bucket with the given prefix
   */
  async listObjects(prefix: string, maxKeys: number = S3Constants.MAX_KEYS, delimiter: string = '/'): Promise<any> {
    return this.listObjectsWithToken(prefix, maxKeys, delimiter);
  }

  /**
   * Lists objects with continuation token support
   */
  async listObjectsWithToken(
    prefix: string,
    maxKeys: number = S3Constants.MAX_KEYS,
    delimiter: string = '/',
    continuationToken?: string
  ): Promise<any> {
    return withRetry(
      async () => {
        const [files, nextQuery, apiResponse] = await this.bucket.getFiles({
          prefix,
          delimiter: delimiter || undefined,
          maxResults: maxKeys,
          pageToken: continuationToken,
          autoPaginate: false
        });

        const contents = files.map((file) => ({
          Key: file.name,
          Size: Number(file.metadata.size) || 0,
          LastModified: file.metadata.updated ? new Date(file.metadata.updated) : new Date(),
          ETag: file.metadata.etag,
          StorageClass: 'STANDARD'
        }));

        const commonPrefixes = ((apiResponse as any)?.prefixes || []).map((p: string) => ({ Prefix: p }));

        return {
          Contents: contents,
          CommonPrefixes: commonPrefixes,
          IsTruncated: !!nextQuery,
          KeyCount: contents.length,
          MaxKeys: maxKeys,
          Prefix: prefix,
          Delimiter: delimiter,
          NextContinuationToken: (nextQuery as any)?.pageToken
        };
      },
      this.retryOptions,
      { operation: 'listObjectsWithToken', prefix, maxKeys, delimiter }
    );
  }

  /**
   * Gets an object from the GCS bucket
   */
  async getObject(key: string): Promise<any> {
    return withRetry(
      async () => {
        const file = this.bucket.file(key);
        const [buffer] = await file.download();
        const [metadata] = await file.getMetadata();

        return {
          Body: buffer,
          ContentLength: Number(metadata.size) || buffer.length,
          ContentType: metadata.contentType,
          LastModified: metadata.updated ? new Date(metadata.updated) : undefined,
          ETag: metadata.etag,
          Metadata: metadata.metadata || {}
        };
      },
      this.retryOptions,
      { operation: 'getObject', key }
    );
  }

  /**
   * Gets object metadata without downloading the body
   */
  async headObject(key: string): Promise<{ ContentLength?: number; ContentType?: string; LastModified?: Date } | null> {
    return withRetry(
      async () => {
        try {
          const [metadata] = await this.bucket.file(key).getMetadata();
          return {
            ContentLength: Number(metadata.size) || 0,
            ContentType: metadata.contentType,
            LastModified: metadata.updated ? new Date(metadata.updated) : undefined
          };
        } catch (error: any) {
          if (error?.code === 404) {
            return null;
          }
          throw error;
        }
      },
      this.retryOptions,
      { operation: 'headObject', key }
    );
  }

  /**
   * Gets a partial object from the GCS bucket (first N bytes)
   */
  async getPartialObject(key: string, maxBytes: number): Promise<any> {
    return withRetry(
      async () => {
        const file = this.bucket.file(key);
        const stream = file.createReadStream({ start: 0, end: Math.max(maxBytes - 1, 0) });
        const chunks: Buffer[] = [];

        const buffer = await new Promise<Buffer>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });

        return {
          Body: buffer,
          ContentLength: buffer.length,
          ContentType: undefined,
          LastModified: undefined,
          ETag: undefined,
          Metadata: {}
        };
      },
      this.retryOptions,
      { operation: 'getPartialObject', key, maxBytes }
    );
  }

  /**
   * Puts an object in the GCS bucket
   */
  async putObject(key: string, body: Buffer | Uint8Array | string | Readable, contentType?: string): Promise<any> {
    return withRetry(
      async () => {
        const buffer = await this.toBuffer(body);
        const file = this.bucket.file(key);

        await file.save(buffer, {
          contentType: contentType || 'application/octet-stream',
          resumable: buffer.length > 5 * 1024 * 1024 // resumable uploads for larger payloads
        });

        const [metadata] = await file.getMetadata();

        return {
          ETag: metadata.etag,
          VersionId: metadata.generation
        };
      },
      this.retryOptions,
      { operation: 'putObject', key, contentType }
    );
  }

  /**
   * Deletes an object from the GCS bucket
   */
  async deleteObject(key: string): Promise<any> {
    return withRetry(
      async () => {
        await this.bucket.file(key).delete({ ignoreNotFound: true });
        return { DeleteMarker: false, VersionId: undefined };
      },
      this.retryOptions,
      { operation: 'deleteObject', key }
    );
  }

  /**
   * Builds the prefix under which multipart-upload part objects are staged
   */
  private multipartPrefix(key: string, uploadId: string): string {
    return `${key}.gcs-mpu/${uploadId}/`;
  }

  /**
   * Builds the object name for a given part number
   */
  private partKey(key: string, uploadId: string, partNumber: number): string {
    return `${this.multipartPrefix(key, uploadId)}part-${String(partNumber).padStart(6, '0')}`;
  }

  /**
   * Builds the object name for the marker that records the destination content type
   */
  private markerKey(key: string, uploadId: string): string {
    return `${this.multipartPrefix(key, uploadId)}.init`;
  }

  /**
   * Creates a multipart upload
   *
   * GCS has no session-based multipart-upload API, so this only allocates an
   * upload ID and stashes the destination content type in a marker object for
   * `completeMultipartUpload` to read back later (possibly on a different
   * server instance).
   */
  async createMultipartUpload(key: string, contentType?: string): Promise<MultipartUploadResult> {
    return withRetry(
      async () => {
        const uploadId = randomUUID();

        await this.bucket.file(this.markerKey(key, uploadId)).save(Buffer.from(''), {
          contentType: 'application/octet-stream',
          metadata: { metadata: { destinationContentType: contentType || 'application/octet-stream' } },
          resumable: false
        });

        return { uploadId, key };
      },
      this.retryOptions,
      { operation: 'createMultipartUpload', key, contentType }
    );
  }

  /**
   * Uploads a part in a multipart upload
   *
   * Not used by the current upload flow (clients upload parts directly via
   * presigned URLs from `createPresignedUrlForPart`), but implemented for
   * interface completeness and any server-side relay use case.
   */
  async uploadPart(uploadId: string, key: string, partNumber: number, body: Buffer | Uint8Array | string | Readable): Promise<string> {
    return withRetry(
      async () => {
        const buffer = await this.toBuffer(body);
        const file = this.bucket.file(this.partKey(key, uploadId, partNumber));
        await file.save(buffer, { resumable: false });
        const [metadata] = await file.getMetadata();
        return metadata.etag || '';
      },
      this.retryOptions,
      { operation: 'uploadPart', uploadId, key, partNumber }
    );
  }

  /**
   * Completes a multipart upload by composing the staged part objects, in
   * PartNumber order, into the destination key. GCS compose() accepts at most
   * 32 sources per call, so parts are folded together in batches when needed.
   */
  async completeMultipartUpload(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<any> {
    return withRetry(
      async () => {
        const markerFile = this.bucket.file(this.markerKey(key, uploadId));
        let destinationContentType = 'application/octet-stream';
        try {
          const [markerMetadata] = await markerFile.getMetadata();
          destinationContentType = (markerMetadata.metadata?.destinationContentType as string) || destinationContentType;
        } catch (error: any) {
          if (error?.code !== 404) throw error;
        }

        const orderedPartNames = [...parts]
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map((part) => this.partKey(key, uploadId, part.PartNumber));

        if (orderedPartNames.length === 0) {
          throw new Error(`No parts supplied to complete multipart upload for key=${key}, uploadId=${uploadId}`);
        }

        const destinationFile = this.bucket.file(key);
        const intermediateNames: string[] = [];

        // Fold parts together in batches of GCS_COMPOSE_BATCH_LIMIT until one object remains
        let currentLevel = orderedPartNames;
        while (currentLevel.length > 1) {
          const nextLevel: string[] = [];

          for (let i = 0; i < currentLevel.length; i += GCS_COMPOSE_BATCH_LIMIT) {
            const batch = currentLevel.slice(i, i + GCS_COMPOSE_BATCH_LIMIT);
            const isFinalBatch = batch.length === currentLevel.length;
            const targetName = isFinalBatch ? key : `${this.multipartPrefix(key, uploadId)}compose-${randomUUID()}`;
            const targetFile = this.bucket.file(targetName);

            await this.bucket.combine(
              batch.map((name) => this.bucket.file(name)),
              targetFile
            );

            if (!isFinalBatch) {
              intermediateNames.push(targetName);
            }
            nextLevel.push(targetName);
          }

          currentLevel = nextLevel;
        }

        // If only a single part existed, copy it directly to the destination key
        const soleName = currentLevel[0];
        if (soleName !== undefined && soleName !== key) {
          await this.bucket.file(soleName).copy(destinationFile);
        }

        await destinationFile.setMetadata({ contentType: destinationContentType });
        const [finalMetadata] = await destinationFile.getMetadata();

        // Clean up staged part objects, intermediate composed objects, and the marker
        await Promise.all([
          ...orderedPartNames.map((name) => this.bucket.file(name).delete({ ignoreNotFound: true })),
          ...intermediateNames.map((name) => this.bucket.file(name).delete({ ignoreNotFound: true })),
          markerFile.delete({ ignoreNotFound: true })
        ]);

        return {
          Location: `gs://${this.bucketName}/${key}`,
          Bucket: this.bucketName,
          Key: key,
          ETag: finalMetadata.etag
        };
      },
      this.retryOptions,
      { operation: 'completeMultipartUpload', key, uploadId, partsCount: parts.length }
    );
  }

  /**
   * Aborts a multipart upload, deleting all staged part objects and the marker
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<any> {
    return withRetry(
      async () => {
        const prefix = this.multipartPrefix(key, uploadId);
        const [files] = await this.bucket.getFiles({ prefix });
        await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
        return {};
      },
      this.retryOptions,
      { operation: 'abortMultipartUpload', key, uploadId }
    );
  }

  /**
   * Creates a presigned (V4 signed) URL for downloading an object
   */
  async createPresignedUrl(key: string, expiresIn: number = S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION): Promise<string> {
    return withRetry(
      async () => {
        const [url] = await this.bucket.file(key).getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + expiresIn * 1000
        });
        return url;
      },
      this.retryOptions,
      { operation: 'createPresignedUrl', key, expiresIn }
    );
  }

  /**
   * Creates a presigned (V4 signed) URL for uploading a single multipart-upload part.
   * The client PUTs the part body directly to this URL.
   */
  async createPresignedUrlForPart(uploadId: string, key: string, partNumber: number, expiresIn: number = 3600): Promise<string> {
    return withRetry(
      async () => {
        const [url] = await this.bucket.file(this.partKey(key, uploadId, partNumber)).getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + expiresIn * 1000
        });
        return url;
      },
      this.retryOptions,
      { operation: 'createPresignedUrlForPart', uploadId, key, partNumber, expiresIn }
    );
  }

  /**
   * Gets the underlying GCS client
   */
  getClient(): Storage {
    return this.storage;
  }

  /**
   * Normalizes supported body types to a Buffer
   */
  private async toBuffer(body: Buffer | Uint8Array | string | Readable): Promise<Buffer> {
    if (Buffer.isBuffer(body)) {
      return body;
    }
    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }
    if (typeof body === 'string') {
      return Buffer.from(body, 'utf8');
    }
    if (body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    throw new Error('Unsupported body type');
  }
}

/**
 * Factory function to create a new GCSRepository instance with configuration
 */
export function createGCSRepository(config: GCSRepositoryConfig): GCSRepository {
  return new GCSRepository(config);
}
