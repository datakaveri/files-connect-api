import { delegationConfigSchema } from '../../config/delegation';

const enabled = {
  DELEGATION_ENABLED: 'true', DELEGATION_GRPC_TLS: 'false',
  DELEGATION_TOKEN_URL: 'https://idp.example.test/realms/example/protocol/openid-connect/token',
  DELEGATION_CLIENT_ID: 'svc-files', DELEGATION_CLIENT_SECRET: 'test-secret',
};

describe('delegation configuration', () => {
  it('is disabled by default and does not require service credentials', () => {
    expect(delegationConfigSchema.parse({})).toMatchObject({
      DELEGATION_ENABLED: false, DELEGATION_GRPC_ADDRESS: 'controlplane:9090',
      DELEGATION_GRPC_TIMEOUT_MS: 5000, DELEGATION_TOKEN_TIMEOUT_MS: 5000,
    });
  });
  it('accepts explicitly configured plaintext or TLS', () => {
    expect(delegationConfigSchema.parse(enabled).DELEGATION_GRPC_TLS).toBe(false);
    expect(delegationConfigSchema.parse({ ...enabled, DELEGATION_GRPC_TLS: 'true' }).DELEGATION_GRPC_TLS).toBe(true);
  });
  it.each(['DELEGATION_GRPC_TLS', 'DELEGATION_TOKEN_URL', 'DELEGATION_CLIENT_ID', 'DELEGATION_CLIENT_SECRET'])('requires %s when enabled', (field) => {
    expect(delegationConfigSchema.safeParse({ ...enabled, [field]: undefined }).success).toBe(false);
  });
  it.each(['0', '-1', '1.5', '5000ms', 'NaN', '2147483648'])('rejects invalid timeout %s', (value) => {
    expect(delegationConfigSchema.safeParse({ ...enabled, DELEGATION_GRPC_TIMEOUT_MS: value }).success).toBe(false);
    expect(delegationConfigSchema.safeParse({ ...enabled, DELEGATION_TOKEN_TIMEOUT_MS: value }).success).toBe(false);
  });
  it.each(['ftp://idp.example.test/token', 'https://user:secret@idp.example.test/token'])('rejects unsafe token URL %s', (url) => {
    expect(delegationConfigSchema.safeParse({ ...enabled, DELEGATION_TOKEN_URL: url }).success).toBe(false);
  });
});
