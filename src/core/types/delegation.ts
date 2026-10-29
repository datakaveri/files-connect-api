import { z } from 'zod';

/** Wire response from dx-controlplane; field names match appid_verification.proto. */
export const resolveDelegationResponseSchema = z.object({
  success: z.boolean(),
  error_code: z.string(),
  sub: z.string(),
  organisation_id: z.string(),
  organisation_name: z.string(),
  roles: z.array(z.string()),
  scopes: z.array(z.string()),
  email_verified: z.boolean(),
  kyc_verified: z.boolean(),
  name: z.string(),
  preferred_username: z.string(),
  given_name: z.string(),
  family_name: z.string(),
  email: z.string(),
  account_enabled: z.boolean(),
  delegatee_sub: z.string(),
});

export type ResolveDelegationResponse = z.infer<typeof resolveDelegationResponseSchema>;

export interface ResolveDelegationRequest {
  delegator_sub: string;
  delegatee_sub: string;
}

export const DelegationScope = {
  DATA_ACCESS: 'data-access',
  OWN_ASSET_MANAGEMENT: 'own-asset-management',
} as const;

export interface DelegatedIdentity {
  userId: string;
  roles: string[];
  scopes: string[];
  orgId?: string;
  orgName?: string;
  delegateeId: string;
}
