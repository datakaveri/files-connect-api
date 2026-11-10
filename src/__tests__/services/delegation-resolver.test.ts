import { env } from '../../config/environment';
import { resolveDelegationResponseSchema, ResolveDelegationResponse } from '../../core/types/delegation';
import { DelegationResolver, resolveDelegation, closeDelegationClient } from '../../services/delegation-resolver';
import { GrpcDelegationClient } from '../../services/delegation-client';
import { KeycloakServiceTokenProvider } from '../../services/keycloak-service-token-provider';

jest.mock('../../config/environment', () => ({ env: { DELEGATION_ENABLED: false } }));

const delegator = '19c93458-bb92-48e8-87b5-635f269373b7';
const delegatee = 'ff14ea1d-6539-4271-9e08-3e1a57b47bd6';
function response(overrides: Partial<ResolveDelegationResponse> = {}): ResolveDelegationResponse {
  return resolveDelegationResponseSchema.parse({
    success: true, error_code: '', sub: delegator, delegatee_sub: delegatee,
    roles: ['provider'], scopes: ['data-access'], organisation_id: 'owner-org',
    organisation_name: 'Owner organisation', email_verified: true, kyc_verified: true,
    name: '', preferred_username: '', given_name: '', family_name: '', email: '',
    account_enabled: true, ...overrides,
  });
}

describe('DelegationResolver', () => {
  const client = { resolveDelegation: jest.fn() };
  const tokenProvider = { getServiceToken: jest.fn() };
  const resolver = new DelegationResolver(client, tokenProvider);

  beforeEach(() => {
    client.resolveDelegation.mockReset().mockResolvedValue(response());
    tokenProvider.getServiceToken.mockReset().mockResolvedValue('service-token');
  });

  it('resolves the delegator without expanding scopes from returned roles', async () => {
    await expect(resolver.resolve(delegator, delegatee)).resolves.toEqual({
      userId: delegator, delegateeId: delegatee, roles: ['provider'], scopes: ['data-access'],
      orgId: 'owner-org', orgName: 'Owner organisation',
    });
    expect(client.resolveDelegation).toHaveBeenCalledWith(delegator, delegatee, 'service-token');
  });

  it.each(['NO_ACTIVE_DELEGATION', 'EXPIRED', 'DELEGATOR_INACTIVE'])('denies %s with 403', async (error_code) => {
    client.resolveDelegation.mockResolvedValueOnce(response({ success: false, error_code }));
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each(['INTERNAL_ERROR', 'UNKNOWN', ''])('reports service rejection %s as 503', async (error_code) => {
    client.resolveDelegation.mockResolvedValueOnce(response({ success: false, error_code }));
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each([
    { sub: delegatee }, { sub: '' }, { delegatee_sub: delegator }, { delegatee_sub: '' },
    { error_code: 'INTERNAL_ERROR' },
  ])('rejects inconsistent successful response %j', async (override) => {
    client.resolveDelegation.mockResolvedValueOnce(response(override));
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('denies an inactive account even if the service reports success', async () => {
    client.resolveDelegation.mockResolvedValueOnce(response({ account_enabled: false }));
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('preserves empty scopes and does not reuse a previous delegation decision', async () => {
    client.resolveDelegation.mockResolvedValueOnce(response({ scopes: [] }));
    expect((await resolver.resolve(delegator, delegatee)).scopes).toEqual([]);
    client.resolveDelegation.mockResolvedValueOnce(response({ success: false, error_code: 'EXPIRED' }));
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 403 });
    expect(client.resolveDelegation).toHaveBeenCalledTimes(2);
  });

  it('stops before the RPC if service login fails', async () => {
    tokenProvider.getServiceToken.mockRejectedValueOnce(new Error('secret-in-upstream-error'));
    const error = await resolver.resolve(delegator, delegatee).catch((value) => value);
    expect(error.statusCode).toBe(503);
    expect(String(error)).not.toContain('secret-in-upstream-error');
    expect(client.resolveDelegation).not.toHaveBeenCalled();
  });

  it.each([new Error('transport-secret'), undefined, { success: true }])('rejects transport or malformed responses safely (%j)', async (value) => {
    if (value instanceof Error) client.resolveDelegation.mockRejectedValueOnce(value);
    else client.resolveDelegation.mockResolvedValueOnce(value);
    await expect(resolver.resolve(delegator, delegatee)).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('process-wide delegation connection', () => {
  beforeEach(() => {
    Object.assign(env, {
      DELEGATION_ENABLED: true, DELEGATION_GRPC_ADDRESS: 'controlplane:9090',
      DELEGATION_GRPC_TLS: false, DELEGATION_TOKEN_URL: 'https://idp.example.test/token',
      DELEGATION_CLIENT_ID: 'svc-files', DELEGATION_CLIENT_SECRET: 'test-secret',
    });
  });
  afterEach(() => {
    closeDelegationClient();
    jest.restoreAllMocks();
  });

  it('rejects DID when disabled instead of using the JWT identity', async () => {
    env.DELEGATION_ENABLED = false;
    await expect(resolveDelegation(delegator, delegatee)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('reports missing configuration without exposing credentials', async () => {
    env.DELEGATION_CLIENT_SECRET = undefined;
    await expect(resolveDelegation(delegator, delegatee)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('reuses the connection and closes it during shutdown', async () => {
    jest.spyOn(KeycloakServiceTokenProvider.prototype, 'getServiceToken').mockResolvedValue('service-token');
    const rpc = jest.spyOn(GrpcDelegationClient.prototype, 'resolveDelegation').mockResolvedValue(response());
    const close = jest.spyOn(GrpcDelegationClient.prototype, 'close');
    await resolveDelegation(delegator, delegatee);
    await resolveDelegation(delegator, delegatee);
    expect(rpc.mock.instances[0]).toBe(rpc.mock.instances[1]);
    closeDelegationClient();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
