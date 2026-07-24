/**
 * Encryption Routes
 * Exposes the public half of the Cloud KMS key used for client-side envelope
 * encryption of dataset uploads. Providers fetch this key, wrap a per-file
 * AES-256 DEK with it, and record the returned kmsKeyVersion in the upload's
 * manifest so the TEE knows which key version to unwrap with.
 */
import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import { UserRole } from '../core/types/auth';
import { createKmsService } from '../services/kms-service';
import { buildResponse } from '../core/utils/route-utils';

const kmsService = createKmsService();

const encryptionRoutes = Router();

/**
 * GET /encryption/public-key
 * Returns { publicKeyPem, kmsKeyVersion, algorithm } for DEK wrapping.
 */
encryptionRoutes.get(
  '/public-key',
  authenticate,
  authorize([UserRole.PROVIDER]),
  asyncHandler(async (_req: Request, res: Response) => {
    const publicKey = await kmsService.getEncryptionPublicKey();
    res.json(buildResponse(publicKey));
  })
);

export { encryptionRoutes };
