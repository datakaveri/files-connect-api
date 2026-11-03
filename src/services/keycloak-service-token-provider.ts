import axios from 'axios';
import { z } from 'zod';
import { ServiceUnavailableError } from '../core/errors';

const REFRESH_BUFFER_MS = 60_000;

const optionsSchema = z.object({
  tokenUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol)
        && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  }),
  clientId: z.string().trim().min(1),
  // Do not trim the secret: its exact value is part of the credential.
  clientSecret: z.string().refine((value) => value.trim().length > 0),
  timeoutMs: z.number().int().positive().max(2_147_483_647).default(5000),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).regex(/^\S+$/),
  // Match the Java provider's five-minute fallback when expires_in is omitted.
  expires_in: z.number().int().positive().max(2_147_483_647).default(300),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer').optional(),
});

export type ServiceTokenProviderOptions = z.input<typeof optionsSchema>;

/** Gets the file server's own Keycloak token for authenticated control-plane calls. */
export class KeycloakServiceTokenProvider {
  private readonly options: z.output<typeof optionsSchema>;
  private cachedToken?: string;
  private tokenExpiresAt = 0;
  private pendingToken?: Promise<string>;

  constructor(options: ServiceTokenProviderOptions) {
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) {
      // Report field names only; validation errors must not retain the client secret.
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
      throw new Error(`Invalid service-token provider configuration: ${fields.join(', ')}`);
    }
    this.options = parsed.data;
  }

  getServiceToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - REFRESH_BUFFER_MS) {
      return Promise.resolve(this.cachedToken);
    }

    // A burst of file requests should share one login, including during renewal.
    if (!this.pendingToken) {
      this.pendingToken = this.fetchToken().finally(() => {
        this.pendingToken = undefined;
      });
    }
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const requestStartedAt = Date.now();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });

    let response;
    try {
      response = await axios.post<unknown>(this.options.tokenUrl, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: this.options.timeoutMs,
        // Do not forward service credentials to a redirect destination.
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch {
      // Axios errors can contain the request body, including the secret. Never propagate them.
      throw new ServiceUnavailableError('Keycloak service authentication', {
        reason: 'Token request failed',
      });
    }

    if (response.status !== 200) {
      throw new ServiceUnavailableError('Keycloak service authentication', {
        reason: response.status === 401
          ? 'Service credentials rejected'
          : 'Token endpoint returned an unsuccessful status',
        upstreamStatus: response.status,
      });
    }

    const parsed = tokenResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ServiceUnavailableError('Keycloak service authentication', {
        reason: 'Invalid token response',
      });
    }

    // Count lifetime from request start so network latency cannot overstate token validity.
    const expiresAt = requestStartedAt + parsed.data.expires_in * 1000;
    if (Date.now() >= expiresAt) {
      throw new ServiceUnavailableError('Keycloak service authentication', {
        reason: 'Token expired before it was received',
      });
    }

    this.cachedToken = parsed.data.access_token;
    this.tokenExpiresAt = expiresAt;
    return this.cachedToken;
  }
}
