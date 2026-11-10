/**
 * KMS Service
 * Serves the public half of the Cloud KMS asymmetric key used for client-side
 * envelope encryption of dataset uploads. Clients wrap a per-file AES-256 DEK
 * with this public key; only the TEE (via KMS asymmetricDecrypt) can unwrap it.
 *
 * The private key never leaves Cloud KMS. This service only ever reads the
 * public key (requires roles/cloudkms.publicKeyViewer on the key).
 */
import { env } from '../config/environment';
import { createLogger } from '../core/utils/logger';
import { ApplicationError } from '../core/errors/application-errors';

const logger = createLogger('KmsService');

/** Wrap algorithm advertised to clients; must match the KMS key's algorithm */
export const DEK_WRAP_ALGORITHM = 'RSA-OAEP-3072-SHA256';

/** How long a fetched public key is served from memory before re-fetching */
const PUBLIC_KEY_CACHE_TTL_MS = 10 * 60 * 1000;

export interface EncryptionPublicKey {
  publicKeyPem: string;
  kmsKeyVersion: string;
  algorithm: string;
}

export interface KmsServiceInterface {
  getEncryptionPublicKey(): Promise<EncryptionPublicKey>;
}

export function createKmsService(): KmsServiceInterface {
  let cached: { value: EncryptionPublicKey; fetchedAt: number } | null = null;
  let client: import('@google-cloud/kms').KeyManagementServiceClient | null = null;

  async function fetchFromKms(keyVersionName: string): Promise<EncryptionPublicKey> {
    if (!client) {
      const { KeyManagementServiceClient } = await import('@google-cloud/kms');
      // Same credential resolution as GCSRepository: key file, then inline
      // credentials, then Application Default Credentials.
      const clientOptions: ConstructorParameters<typeof KeyManagementServiceClient>[0] = {};
      if (env.GCS_PROJECT_ID) {
        clientOptions.projectId = env.GCS_PROJECT_ID;
      }
      if (env.GCS_KEY_FILE) {
        clientOptions.keyFilename = env.GCS_KEY_FILE;
      } else if (env.GCS_CLIENT_EMAIL && env.GCS_PRIVATE_KEY) {
        clientOptions.credentials = {
          client_email: env.GCS_CLIENT_EMAIL,
          private_key: env.GCS_PRIVATE_KEY
        };
      }
      client = new KeyManagementServiceClient(clientOptions);
    }
    const [publicKey] = await client.getPublicKey({ name: keyVersionName });
    if (!publicKey.pem) {
      throw new ApplicationError(`KMS returned no PEM for key version ${keyVersionName}`, 502);
    }
    return {
      publicKeyPem: publicKey.pem,
      kmsKeyVersion: keyVersionName,
      algorithm: DEK_WRAP_ALGORITHM
    };
  }

  return {
    async getEncryptionPublicKey(): Promise<EncryptionPublicKey> {
      if (cached && Date.now() - cached.fetchedAt < PUBLIC_KEY_CACHE_TTL_MS) {
        return cached.value;
      }

      let value: EncryptionPublicKey;
      if (env.DEV_ENCRYPTION_PUBLIC_KEY_PEM) {
        // Local development: no KMS emulator exists, so serve a locally
        // generated RSA public key. The paired private key stays with the
        // developer for round-trip decryption tests.
        logger.warn('Serving DEV_ENCRYPTION_PUBLIC_KEY_PEM instead of Cloud KMS public key');
        value = {
          publicKeyPem: env.DEV_ENCRYPTION_PUBLIC_KEY_PEM,
          kmsKeyVersion: env.KMS_KEY_VERSION_NAME || 'dev-local-key',
          algorithm: DEK_WRAP_ALGORITHM
        };
      } else {
        if (!env.KMS_KEY_VERSION_NAME) {
          throw new ApplicationError(
            'Encryption is not configured: set KMS_KEY_VERSION_NAME (or DEV_ENCRYPTION_PUBLIC_KEY_PEM for local development)',
            503
          );
        }
        value = await fetchFromKms(env.KMS_KEY_VERSION_NAME);
        logger.info(`Fetched encryption public key from KMS: ${env.KMS_KEY_VERSION_NAME}`);
      }

      cached = { value, fetchedAt: Date.now() };
      return value;
    }
  };
}
