import { join } from 'path';
import {
  credentials,
  Server,
  ServerCredentials,
  ServerUnaryCall,
  ServiceDefinition,
  sendUnaryData,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import axios from 'axios';
import { GrpcDelegationClient } from '../../services/delegation-client';
import { KeycloakServiceTokenProvider } from '../../services/keycloak-service-token-provider';
import {
  ResolveDelegationRequest,
  ResolveDelegationResponse,
} from '../../core/types/delegation';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const delegatorSub = '19c93458-bb92-48e8-87b5-635f269373b7';
const delegateeSub = 'ff14ea1d-6539-4271-9e08-3e1a57b47bd6';
type Response = Partial<ResolveDelegationResponse>;

// Use an actual local gRPC server so these tests exercise the wire contract too.
const packageDefinition = loadSync(join(__dirname, '../../proto/appid_verification.proto'), {
  keepCase: true,
  defaults: true,
});
const serviceDefinition = packageDefinition[
  'org.cdpg.dx.auth.appid.v1.AppIdVerificationService'
] as ServiceDefinition;

describe('GrpcDelegationClient', () => {
  const server = new Server();
  const clients: GrpcDelegationClient[] = [];
  const handler = jest.fn((
    _call: ServerUnaryCall<ResolveDelegationRequest, Response>,
    callback: sendUnaryData<Response>,
  ) => {
    callback(null, {
      success: true,
      sub: delegatorSub,
      delegatee_sub: delegateeSub,
      organisation_id: 'delegator-org',
      organisation_name: 'Delegator organisation',
      roles: ['provider'],
      scopes: ['data-access'],
      account_enabled: true,
    });
  });
  let client: GrpcDelegationClient;
  let address: string;

  beforeAll(async () => {
    server.addService(serviceDefinition, { resolveDelegation: handler });
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) reject(error);
        else resolve(boundPort);
      });
    });
    address = `127.0.0.1:${port}`;
    client = new GrpcDelegationClient({ address, credentials: credentials.createInsecure() });
    clients.push(client);
  });

  beforeEach(() => {
    handler.mockClear();
    mockedAxios.post.mockReset();
  });

  afterAll(() => {
    clients.forEach((connection) => connection.close());
    server.forceShutdown();
  });

  it('sends both identities and the service bearer token using the upstream RPC', async () => {
    const response = await client.resolveDelegation(delegatorSub, delegateeSub, 'service-token');

    const call = handler.mock.calls[0]![0];
    expect(call.request).toEqual({ delegator_sub: delegatorSub, delegatee_sub: delegateeSub });
    expect(call.metadata.get('authorization')).toEqual(['Bearer service-token']);
    expect(response).toMatchObject({
      success: true,
      sub: delegatorSub,
      delegatee_sub: delegateeSub,
      organisation_id: 'delegator-org',
      roles: ['provider'],
      // The client must not expand scopes based on roles in the response.
      scopes: ['data-access'],
    });
  });

  it('returns a rejected delegation without turning it into a successful identity', async () => {
    handler.mockImplementationOnce((_call, callback) => {
      callback(null, { success: false, error_code: 'NO_ACTIVE_DELEGATION' });
    });

    await expect(client.resolveDelegation(delegatorSub, delegateeSub, 'service-token'))
      .resolves.toMatchObject({
        success: false,
        error_code: 'NO_ACTIVE_DELEGATION',
        sub: '',
        roles: [],
        scopes: [],
      });
  });

  it('uses the token obtained from Keycloak to authenticate gRPC calls', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { access_token: 'keycloak-service-token', expires_in: 300, token_type: 'Bearer' },
    });
    const tokenProvider = new KeycloakServiceTokenProvider({
      tokenUrl: 'https://idp.example.test/realms/example/protocol/openid-connect/token',
      clientId: 'svc-files-connect',
      clientSecret: 'test-service-secret',
    });

    for (let request = 0; request < 2; request++) {
      const token = await tokenProvider.getServiceToken();
      const response = await client.resolveDelegation(delegatorSub, delegateeSub, token);
      expect(response.success).toBe(true);
    }

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
    for (const [call] of handler.mock.calls) {
      expect(call.metadata.get('authorization')).toEqual(['Bearer keycloak-service-token']);
    }
  });

  it('preserves an empty scope list on a successful response', async () => {
    handler.mockImplementationOnce((_call, callback) => {
      callback(null, { success: true, sub: delegatorSub, delegatee_sub: delegateeSub });
    });

    const response = await client.resolveDelegation(delegatorSub, delegateeSub, 'service-token');
    expect(response.scopes).toEqual([]);
  });

  it('propagates service failures rather than returning an identity', async () => {
    handler.mockImplementationOnce((_call, callback) => {
      callback({ code: status.UNAVAILABLE, details: 'Control plane unavailable' });
    });

    await expect(client.resolveDelegation(delegatorSub, delegateeSub, 'service-token'))
      .rejects.toMatchObject({ code: status.UNAVAILABLE });
  });

  it('stops waiting when the RPC deadline expires', async () => {
    handler.mockImplementationOnce(() => {});
    const shortDeadlineClient = new GrpcDelegationClient({
      address,
      credentials: credentials.createInsecure(),
      timeoutMs: 100,
    });
    clients.push(shortDeadlineClient);

    await expect(shortDeadlineClient.resolveDelegation(delegatorSub, delegateeSub, 'service-token'))
      .rejects.toMatchObject({ code: status.DEADLINE_EXCEEDED });
  });

  it.each([
    ['', delegateeSub, 'service-token'],
    [delegatorSub, ' ', 'service-token'],
    [delegatorSub, delegateeSub, ''],
  ])('rejects missing identities or service credentials before sending an RPC (%s, %s)', async (
    delegator, delegatee, token,
  ) => {
    await expect(client.resolveDelegation(delegator, delegatee, token)).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => new GrpcDelegationClient({
      address,
      credentials: credentials.createInsecure(),
      timeoutMs,
    })).toThrow('Delegation timeout must be a positive integer');
  });
});
