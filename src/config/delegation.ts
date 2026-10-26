import { z } from 'zod';

const timeout = z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));

/** Independently testable deployment settings; credentials are required only when enabled. */
export const delegationConfigSchema = z.object({
  DELEGATION_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DELEGATION_GRPC_ADDRESS: z.string().trim().min(1).default('controlplane:9090'),
  // Require an explicit choice when enabling delegation; deployments may terminate TLS in a mesh.
  DELEGATION_GRPC_TLS: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  DELEGATION_GRPC_TIMEOUT_MS: timeout.default('5000'),
  DELEGATION_TOKEN_URL: z.string().url().optional(),
  DELEGATION_CLIENT_ID: z.string().trim().min(1).optional(),
  DELEGATION_CLIENT_SECRET: z.string().refine((value) => value.trim().length > 0).optional(),
  DELEGATION_TOKEN_TIMEOUT_MS: timeout.default('5000'),
}).superRefine((config, ctx) => {
  if (!config.DELEGATION_ENABLED) return;
  for (const field of ['DELEGATION_GRPC_TLS', 'DELEGATION_TOKEN_URL', 'DELEGATION_CLIENT_ID', 'DELEGATION_CLIENT_SECRET'] as const) {
    if (config[field] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Required when delegation is enabled' });
    }
  }
  if (config.DELEGATION_TOKEN_URL) {
    try {
      const url = new URL(config.DELEGATION_TOKEN_URL);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error('Invalid token URL');
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DELEGATION_TOKEN_URL'], message: 'Expected an HTTP(S) token endpoint without URL credentials or fragment' });
    }
  }
});
