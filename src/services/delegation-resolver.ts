import { credentials } from '@grpc/grpc-js';
import { env } from '../config/environment';
import { AuthorizationError, ServiceUnavailableError } from '../core/errors';
import { DelegatedIdentity, resolveDelegationResponseSchema } from '../core/types/delegation';
import { GrpcDelegationClient } from './delegation-client';
import { KeycloakServiceTokenProvider } from './keycloak-service-token-provider';

export class DelegationResolver {
  constructor(
    private readonly client: Pick<GrpcDelegationClient, 'resolveDelegation'>,
    private readonly tokenProvider: Pick<KeycloakServiceTokenProvider, 'getServiceToken'>,
  ) {}

  async resolve(delegatorSub: string, delegateeSub: string): Promise<DelegatedIdentity> {
    let response;
    try {
      const token = await this.tokenProvider.getServiceToken();
      response = resolveDelegationResponseSchema.parse(
        await this.client.resolveDelegation(delegatorSub, delegateeSub, token),
      );
    } catch {
      // Never pass raw transport errors, credentials or upstream messages into HTTP responses.
      throw new ServiceUnavailableError('Delegation');
    }

    if (!response.success) {
      if (['NO_ACTIVE_DELEGATION', 'EXPIRED', 'DELEGATOR_INACTIVE'].includes(response.error_code)) {
        throw new AuthorizationError('No active delegation');
      }
      throw new ServiceUnavailableError('Delegation');
    }
    if (response.error_code || response.sub !== delegatorSub || response.delegatee_sub !== delegateeSub) {
      throw new ServiceUnavailableError('Delegation', { reason: 'Delegation response identity mismatch' });
    }
    if (!response.account_enabled) {
      throw new AuthorizationError('Delegator account is inactive');
    }

    return {
      userId: response.sub,
      roles: [...response.roles],
      scopes: [...response.scopes],
      orgId: response.organisation_id || undefined,
      orgName: response.organisation_name || undefined,
      delegateeId: delegateeSub,
    };
  }
}

let client: GrpcDelegationClient | undefined;
let resolver: DelegationResolver | undefined;

/** Lazily create one connection and one token cache for the process. */
export async function resolveDelegation(delegatorSub: string, delegateeSub: string): Promise<DelegatedIdentity> {
  if (!env.DELEGATION_ENABLED) {
    throw new AuthorizationError('Delegation is not enabled');
  }
  if (!resolver) {
    if (!env.DELEGATION_TOKEN_URL || !env.DELEGATION_CLIENT_ID || !env.DELEGATION_CLIENT_SECRET
      || env.DELEGATION_GRPC_TLS === undefined) {
      throw new ServiceUnavailableError('Delegation', { reason: 'Delegation is not configured' });
    }
    try {
      const tokenProvider = new KeycloakServiceTokenProvider({
        tokenUrl: env.DELEGATION_TOKEN_URL,
        clientId: env.DELEGATION_CLIENT_ID,
        clientSecret: env.DELEGATION_CLIENT_SECRET,
        timeoutMs: env.DELEGATION_TOKEN_TIMEOUT_MS,
      });
      client = new GrpcDelegationClient({
        address: env.DELEGATION_GRPC_ADDRESS,
        credentials: env.DELEGATION_GRPC_TLS ? credentials.createSsl() : credentials.createInsecure(),
        timeoutMs: env.DELEGATION_GRPC_TIMEOUT_MS,
      });
      resolver = new DelegationResolver(client, tokenProvider);
    } catch {
      throw new ServiceUnavailableError('Delegation', { reason: 'Delegation is not configured' });
    }
  }
  return resolver.resolve(delegatorSub, delegateeSub);
}

export function closeDelegationClient(): void {
  client?.close();
  client = undefined;
  resolver = undefined;
}
