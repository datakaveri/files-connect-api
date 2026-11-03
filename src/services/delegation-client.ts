import { join } from 'path';
import {
  ChannelCredentials,
  Client,
  Metadata,
  ServiceDefinition,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import {
  ResolveDelegationRequest,
  ResolveDelegationResponse,
  resolveDelegationResponseSchema,
} from '../core/types/delegation';

function loadResolveDelegationMethod() {
  const packageDefinition = loadSync(join(__dirname, '../proto/appid_verification.proto'), {
    keepCase: true,
    defaults: true,
    longs: String,
    enums: String,
  });
  const serviceDefinition = packageDefinition[
    'org.cdpg.dx.auth.appid.v1.AppIdVerificationService'
  ] as ServiceDefinition;
  const method = serviceDefinition.ResolveDelegation;

  if (!method) {
    throw new Error('ResolveDelegation is missing from the delegation proto');
  }
  return method;
}

const resolveDelegationMethod = loadResolveDelegationMethod();

export interface DelegationClientOptions {
  /** Control-plane gRPC host:port. */
  address: string;
  /** Caller must explicitly select TLS or plaintext for the deployment. */
  credentials: ChannelCredentials;
  /** Maximum time for one RPC, in milliseconds. Defaults to five seconds. */
  timeoutMs?: number;
}

/**
 * Transport only: sends the verified identities and returns the control-plane response.
 * Permission decisions and user-context replacement belong in the delegation resolver.
 */
export class GrpcDelegationClient {
  private readonly client: Client;
  private readonly timeoutMs: number;

  constructor(options: DelegationClientOptions) {
    if (!options.address.trim()) {
      throw new Error('Delegation service address is required');
    }
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Delegation timeout must be a positive integer in milliseconds');
    }
    this.client = new Client(options.address, options.credentials);
  }

  /** The service token identifies the file server, rather than the end user. */
  async resolveDelegation(
    delegatorSub: string,
    delegateeSub: string,
    serviceToken: string,
  ): Promise<ResolveDelegationResponse> {
    if (!delegatorSub.trim() || !delegateeSub.trim()) {
      throw new Error('Both delegator and delegatee IDs are required');
    }
    if (!serviceToken.trim()) {
      throw new Error('A service token is required for delegation resolution');
    }

    const metadata = new Metadata();
    metadata.set('authorization', `Bearer ${serviceToken}`);

    const response = await new Promise<unknown>((resolve, reject) => {
      this.client.makeUnaryRequest<ResolveDelegationRequest, unknown>(
        resolveDelegationMethod.path,
        resolveDelegationMethod.requestSerialize,
        resolveDelegationMethod.responseDeserialize,
        { delegator_sub: delegatorSub, delegatee_sub: delegateeSub },
        metadata,
        { deadline: Date.now() + this.timeoutMs },
        (error, value) => {
          if (error) {
            reject(error);
          } else {
            resolve(value);
          }
        },
      );
    });

    return resolveDelegationResponseSchema.parse(response);
  }

  close(): void {
    this.client.close();
  }
}
