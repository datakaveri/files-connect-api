import axios from 'axios';
import { KeycloakServiceTokenProvider } from '../../services/keycloak-service-token-provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const options = {
  tokenUrl: 'https://idp.example.test/realms/example/protocol/openid-connect/token',
  clientId: 'svc-files-connect',
  clientSecret: 'test-secret+&= with spaces',
};
const start = 1_800_000_000_000;

function tokenResponse(token: string = 'service-token', expiresIn: number = 300) {
  return { status: 200, data: { access_token: token, expires_in: expiresIn, token_type: 'Bearer' } };
}

describe('KeycloakServiceTokenProvider', () => {
  let provider: KeycloakServiceTokenProvider;
  let now: jest.SpyInstance;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    now = jest.spyOn(Date, 'now').mockReturnValue(start);
    provider = new KeycloakServiceTokenProvider(options);
  });

  afterEach(() => {
    now.mockRestore();
  });

  it('logs in with form-encoded service credentials and a bounded request', async () => {
    mockedAxios.post.mockResolvedValueOnce(tokenResponse());

    await expect(provider.getServiceToken()).resolves.toBe('service-token');

    const [url, body, config] = mockedAxios.post.mock.calls[0]!;
    expect(url).toBe(options.tokenUrl);
    expect(Object.fromEntries(new URLSearchParams(body as string))).toEqual({
      grant_type: 'client_credentials',
      client_id: options.clientId,
      client_secret: options.clientSecret,
    });
    expect(config).toMatchObject({
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000,
      maxRedirects: 0,
    });
  });

  it('reuses a fresh token and renews exactly sixty seconds before expiry', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(tokenResponse('first-token'))
      .mockResolvedValueOnce(tokenResponse('second-token'));

    await provider.getServiceToken();
    now.mockReturnValue(start + 239_999);
    await expect(provider.getServiceToken()).resolves.toBe('first-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + 240_000);
    await expect(provider.getServiceToken()).resolves.toBe('second-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it.each(['initial login', 'renewal'])('shares one pending request during %s', async (phase) => {
    if (phase === 'renewal') {
      mockedAxios.post.mockResolvedValueOnce(tokenResponse());
      await provider.getServiceToken();
      now.mockReturnValue(start + 240_000);
      mockedAxios.post.mockClear();
    }
    let complete!: (value: ReturnType<typeof tokenResponse>) => void;
    mockedAxios.post.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));

    const requests = [provider.getServiceToken(), provider.getServiceToken(), provider.getServiceToken()];
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    complete(tokenResponse('shared-token'));

    await expect(Promise.all(requests)).resolves.toEqual(['shared-token', 'shared-token', 'shared-token']);
  });

  it('counts token lifetime from request start rather than response arrival', async () => {
    mockedAxios.post.mockImplementationOnce(async () => {
      now.mockReturnValue(start + 30_000);
      return tokenResponse('first-token');
    });
    mockedAxios.post.mockResolvedValueOnce(tokenResponse('second-token'));

    await provider.getServiceToken();
    now.mockReturnValue(start + 240_000);
    await expect(provider.getServiceToken()).resolves.toBe('second-token');
  });

  it('does not reuse a token whose lifetime is shorter than the renewal buffer', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(tokenResponse('short-token', 30))
      .mockResolvedValueOnce(tokenResponse('next-token', 30));

    await expect(provider.getServiceToken()).resolves.toBe('short-token');
    await expect(provider.getServiceToken()).resolves.toBe('next-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('matches the Java five-minute fallback when expires_in is missing', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { access_token: 'service-token' } });
    await provider.getServiceToken();
    now.mockReturnValue(start + 239_999);
    await expect(provider.getServiceToken()).resolves.toBe('service-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 500, 302])('reports HTTP %s as a service failure without exposing the body', async (status) => {
    mockedAxios.post.mockResolvedValueOnce({
      status,
      data: { error_description: options.clientSecret, access_token: 'sensitive-token' },
    });

    const error = await provider.getServiceToken().catch((value: Error) => value);
    expect(error).toMatchObject({ statusCode: 503, details: { upstreamStatus: status } });
    expect(JSON.stringify(error)).not.toContain(options.clientSecret);
    expect(JSON.stringify(error)).not.toContain('sensitive-token');
  });

  it('sanitizes network errors and permits another attempt after failure', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(Object.assign(new Error(`Network error: ${options.clientSecret}`), {
        config: { data: options.clientSecret },
      }))
      .mockResolvedValueOnce(tokenResponse('recovered-token'));

    const error = await provider.getServiceToken().catch((value: Error) => value);
    expect(error).toMatchObject({ statusCode: 503, details: { reason: 'Token request failed' } });
    expect(String(error)).not.toContain(options.clientSecret);
    expect(JSON.stringify(error)).not.toContain(options.clientSecret);
    await expect(provider.getServiceToken()).resolves.toBe('recovered-token');
  });

  it('does not fall back to the old token when renewal fails', async () => {
    mockedAxios.post.mockResolvedValueOnce(tokenResponse('old-token'));
    await provider.getServiceToken();
    now.mockReturnValue(start + 240_000);
    mockedAxios.post.mockRejectedValueOnce(new Error('Keycloak unavailable'));

    await expect(provider.getServiceToken()).rejects.toMatchObject({ statusCode: 503 });
  });

  it.each([
    {},
    { access_token: '' },
    { access_token: 'token with spaces' },
    { access_token: 'token', expires_in: 0 },
    { access_token: 'token', expires_in: -1 },
    { access_token: 'token', expires_in: '300' },
    { access_token: 'token', expires_in: 1.5 },
    { access_token: 'token', token_type: 'Basic' },
    '<html>wrong endpoint</html>',
  ])('rejects an invalid token response (%j)', async (data) => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data });

    await expect(provider.getServiceToken()).rejects.toMatchObject({
      statusCode: 503,
      details: { reason: 'Invalid token response' },
    });
    mockedAxios.post.mockResolvedValueOnce(tokenResponse('valid-token'));
    await expect(provider.getServiceToken()).resolves.toBe('valid-token');
  });

  it('rejects a token that has already expired during the network request', async () => {
    mockedAxios.post.mockImplementationOnce(async () => {
      now.mockReturnValue(start + 300_000);
      return tokenResponse();
    });

    await expect(provider.getServiceToken()).rejects.toMatchObject({
      statusCode: 503,
      details: { reason: 'Token expired before it was received' },
    });
  });

  it.each([
    { tokenUrl: 'not-a-url' },
    { tokenUrl: 'ftp://idp.example.test/token' },
    { tokenUrl: 'https://user:password@idp.example.test/token' },
    { clientId: ' ' },
    { clientSecret: '' },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
  ])('rejects invalid configuration without retaining credentials (%j)', (override) => {
    expect(() => new KeycloakServiceTokenProvider({ ...options, ...override }))
      .toThrow('Invalid service-token provider configuration');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
