import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { OutputService, segment } from './service';
import { S3OutputStore } from './s3-store';
import { outputRouter } from './router';

interface ExistingCredentialConfig {
  useExistingCredentials: boolean;
  storageAccessKey?: string;
  storageSecretKey?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
}

export function resolveExistingOutputCredentials(config: ExistingCredentialConfig) {
  if (!config.useExistingCredentials) return undefined;
  const accessKeyId = config.storageAccessKey || config.s3AccessKey;
  const secretAccessKey = config.storageSecretKey || config.s3SecretKey;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS requires STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY or S3_ACCESS_KEY/S3_SECRET_KEY',
    );
  }
  return { accessKeyId, secretAccessKey };
}

export function configuredOutputRouter() {
  const s = z.object({
    OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    OUTPUT_STORAGE_ROLE_ARN: z.string().min(1).optional(),
    OUTPUT_BUCKET: z.string().min(1),
    OUTPUT_REGION: z.string().min(1),
    OUTPUT_ENDPOINT: z.string().url().optional(),
    OUTPUT_UPLOAD_SIGNING_KEY: z.string().min(32),
    OUTPUT_PUBLISH_TOKEN: z.string().min(32),
    OUTPUT_REVIEW_DATABANK_ID: segment,
    OUTPUT_WORKSPACE_DATABANK_ID: segment,
    OUTPUT_REVIEW_BASE: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/).default('nha-review'),
    OUTPUT_WORKSPACE_BASE: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/).default('user-workspaces'),
    OUTPUT_MAX_MANIFEST_BYTES: z.coerce.number().int().positive().max(1048576).default(262144),
    OUTPUT_MAX_FILES: z.coerce.number().int().positive().max(1000).default(1000),
    OUTPUT_MAX_FILE_BYTES: z.coerce.number().int().positive().max(268435456).default(268435456),
    OUTPUT_MAX_BYTES: z.coerce.number().int().positive().max(1073741824).default(1073741824),
    STORAGE_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_SECRET_KEY: z.string().min(1).optional(),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
  }).parse(process.env);

  if (s.OUTPUT_MAX_FILE_BYTES > s.OUTPUT_MAX_BYTES) {
    throw new Error('Invalid output size limits');
  }

  const existingCredentials = resolveExistingOutputCredentials({
    useExistingCredentials: s.OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS,
    storageAccessKey: s.STORAGE_ACCESS_KEY,
    storageSecretKey: s.STORAGE_SECRET_KEY,
    s3AccessKey: s.S3_ACCESS_KEY,
    s3SecretKey: s.S3_SECRET_KEY,
  });
  if (!existingCredentials && !s.OUTPUT_STORAGE_ROLE_ARN) {
    throw new Error(
      'OUTPUT_STORAGE_ROLE_ARN is required unless OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS=true',
    );
  }

  const sts = new STSClient({ region: s.OUTPUT_REGION });
  let cached: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
  } | undefined;
  const credentials = existingCredentials
    ? async () => existingCredentials
    : async () => {
      if (cached && cached.expiration.getTime() > Date.now() + 300000) return cached;
      const prefixes = [
        `${s.OUTPUT_REVIEW_BASE}/.jobs/`,
        `${s.OUTPUT_REVIEW_DATABANK_ID}/${s.OUTPUT_REVIEW_BASE}/`,
        `${s.OUTPUT_WORKSPACE_DATABANK_ID}/${s.OUTPUT_WORKSPACE_BASE}/`,
      ];
      const policy = {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject'],
          Resource: prefixes.map((prefix) => `arn:aws:s3:::${s.OUTPUT_BUCKET}/${prefix}*`),
        }],
      };
      const result = await sts.send(new AssumeRoleCommand({
        RoleArn: s.OUTPUT_STORAGE_ROLE_ARN!,
        RoleSessionName: 'files-connect-output',
        DurationSeconds: 3600,
        Policy: JSON.stringify(policy),
      }));
      const value = result.Credentials;
      if (!value?.AccessKeyId || !value.SecretAccessKey || !value.SessionToken || !value.Expiration) {
        throw new Error('Output storage credentials unavailable');
      }
      cached = {
        accessKeyId: value.AccessKeyId,
        secretAccessKey: value.SecretAccessKey,
        sessionToken: value.SessionToken,
        expiration: value.Expiration,
      };
      return cached;
    };

  const client = new S3Client({
    region: s.OUTPUT_REGION,
    endpoint: s.OUTPUT_ENDPOINT,
    forcePathStyle: !!s.OUTPUT_ENDPOINT,
    credentials,
  });
  return outputRouter(
    new OutputService({
      reviewBase: s.OUTPUT_REVIEW_BASE,
      workspaceBase: s.OUTPUT_WORKSPACE_BASE,
      reviewDatabankId: s.OUTPUT_REVIEW_DATABANK_ID,
      workspaceDatabankId: s.OUTPUT_WORKSPACE_DATABANK_ID,
      maxManifestBytes: s.OUTPUT_MAX_MANIFEST_BYTES,
      maxFiles: s.OUTPUT_MAX_FILES,
      maxFileBytes: s.OUTPUT_MAX_FILE_BYTES,
      maxBytes: s.OUTPUT_MAX_BYTES,
    }, new S3OutputStore(client, s.OUTPUT_BUCKET)),
    s.OUTPUT_UPLOAD_SIGNING_KEY,
    s.OUTPUT_PUBLISH_TOKEN,
  );
}
