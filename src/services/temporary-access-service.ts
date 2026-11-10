/**
 * Temporary Access Service
 * Handles generation of temporary credentials using AWS STS AssumeRole
 * for secure, time-limited access to specific S3 objects
 */
import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import { env } from '../config/environment';
import { createStorageConfig } from '../config/storage';
import { StorageProvider } from '../core/types/storage';
import { createLogger } from '../core/utils/logger';
import { ValidationError } from '../core/errors/application-errors';

// Create a logger for this module
const logger = createLogger('TemporaryAccessService');

/**
 * Temporary credentials response interface
 */
export interface TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
  region: string;
  bucket: string;
  databankId: string;
}

/**
 * Options for generating temporary access
 */
export interface TemporaryAccessOptions {
  databankId: string;
  userId: string;
}

/**
 * Temporary Access Service Interface
 */
export interface TemporaryAccessServiceInterface {
  /**
   * Generates temporary credentials for accessing entire databank
   * @param options - Configuration options for temporary access
   * @returns Promise resolving to temporary credentials
   */
  generateTemporaryCredentials(options: TemporaryAccessOptions): Promise<TemporaryCredentials>;
}

/**
 * Implementation of the Temporary Access Service
 */
export class TemporaryAccessService implements TemporaryAccessServiceInterface {
  private stsClient: STSClient;
  private storageConfig: ReturnType<typeof createStorageConfig>;

  /**
   * Creates a new TemporaryAccessService instance
   */
  constructor() {
    this.storageConfig = createStorageConfig();
    
    // Initialize STS client with storage credentials
    this.stsClient = new STSClient({
      region: this.storageConfig.region || 'us-east-1',
      credentials: {
        accessKeyId: this.storageConfig.accessKey,
        secretAccessKey: this.storageConfig.secretKey,
      },
      ...(this.storageConfig.endpoint && this.storageConfig.provider === 'minio' 
        ? { endpoint: this.storageConfig.endpoint }
        : {}),
    });

    logger.info('TemporaryAccessService initialized', {
      provider: this.storageConfig.provider,
      region: this.storageConfig.region,
      roleArn: env.STS_ROLE_ARN,
    });
  }

  /**
   * Creates session name in format: sn-{userId}-{timestamp}
   * @param userId - User ID
   * @returns Session name
   */
  private createSessionName(userId: string): string {
    const timestamp = Date.now();
    return `sn-${userId}-${timestamp}`;
  }

  /**
   * Creates an IAM policy for limited S3 access to entire databank
   * @param databankId - The databank ID to grant access to
   * @param bucketName - The S3 bucket name
   * @returns IAM policy document
   */
  private createAccessPolicy(databankId: string, bucketName: string) {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject'],
          Resource: [
            `arn:aws:s3:::${bucketName}/${databankId}/*`
          ],
        },
      ],
    };
  }

  /**
   * Generates temporary credentials for accessing entire databank
   * Duration is configured globally via STS_SESSION_DURATION_IN_SECONDS environment variable
   * @param options - Configuration options for temporary access
   * @returns Promise resolving to temporary credentials
   */
  async generateTemporaryCredentials(
    options: TemporaryAccessOptions
  ): Promise<TemporaryCredentials> {
    const { databankId, userId } = options;

    // Validate input
    if (!databankId) {
      throw new ValidationError('Databank ID is required');
    }

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    if (this.storageConfig.provider === StorageProvider.GCS) {
      // AWS STS AssumeRole has no GCS equivalent that yields AWS-style scoped
      // credentials; GCS's nearest analogue (short-lived signed URLs) is already
      // covered by the presigned-URL endpoints, so this endpoint is unsupported here.
      throw new ValidationError(
        'Temporary access credentials are not supported when STORAGE_PROVIDER=gcs. ' +
        'Use the presigned URL endpoints for time-limited object access instead.'
      );
    }

    // Use duration from environment configuration
    const duration = env.STS_SESSION_DURATION_IN_SECONDS;
   

    // Create the IAM policy for the entire databank
    const policy = this.createAccessPolicy(databankId, this.storageConfig.bucketName);

    // Create session name in format: sn-{userId}-{timestamp}
    const sessionName = this.createSessionName(userId);

    logger.info('Generating temporary credentials', {
      databankId,
      duration,
      sessionName,
      bucket: this.storageConfig.bucketName,
    });

    try {
      const command = new AssumeRoleCommand({
        RoleArn: env.STS_ROLE_ARN,
        RoleSessionName: sessionName,
        Policy: JSON.stringify(policy),
        DurationSeconds: duration,
      });

      const response = await this.stsClient.send(command);

      if (!response.Credentials) {
        throw new Error('No credentials returned from STS');
      }

      const credentials = response.Credentials;

      logger.info('Successfully generated temporary credentials', {
        sessionName,
        expiration: credentials.Expiration,
        databankId,
      });

      // Return the temporary credentials
      return {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken!,
        expiration: new Date(credentials.Expiration!).toISOString(),
        region: this.storageConfig.region || 'us-east-1',
        bucket: this.storageConfig.bucketName,
        databankId: databankId,
      };
    } catch (error) {
      logger.error('Error generating temporary credentials', error as Error, {
        databankId,
        sessionName,
      });

      throw new Error(
        `Failed to generate temporary credentials: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * Factory function to create a new TemporaryAccessService instance
 * @returns TemporaryAccessService instance
 */
export function createTemporaryAccessService(): TemporaryAccessServiceInterface {
  return new TemporaryAccessService();
}

