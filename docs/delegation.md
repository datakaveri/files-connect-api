# Delegation support: implementation walkthrough

Delegation means a signed-in user acts on behalf of another user with limited permissions.
The **delegatee** is the signed-in person performing the action. The **delegator** is the
person they act for, identified by the HTTP `DID` header.

## Step 1: speak to the delegation service

Implemented in `src/services/delegation-client.ts`.

The control plane already provides a gRPC method called `ResolveDelegation`. gRPC is a way
for services to call each other, much like a REST API. The `.proto` file is the shared
contract: it describes the method name and the fields both sides send and receive.
The upstream source and exact commit are recorded in `src/proto/README.md`.
Ankit confirmed the deployment service address is `controlplane:9090` (internal hostname
`controlplane`, port `9090`). Keep the address configurable for local development and
deployments with different service discovery. The hostname must resolve from the file
server's runtime network; it is not necessarily reachable from a developer's laptop.

The client sends:

- `delegator_sub`: the person named in `DID`.
- `delegatee_sub`: the subject from the verified login token.
- Authorization metadata containing a **service token**, proving the caller is the file
  server. This is separate from the signed-in user's login token.

The response says whether delegation is valid, and includes the delegator's identity,
organization, roles, exact allowed scopes, and the delegatee ID for auditing. A scope is
a named permission, such as `data-access`.

This client handles message transport only. It returns rejected delegations as
`success: false`, preserves the response's scopes, and propagates network errors.
It does not make authorization decisions or replace a request's user context.

The client requires an explicit transport credential choice (TLS or plaintext), limits
each call to five seconds by default, and exposes `close()` for shutdown. The later
application integration must call `close()` during shutdown. Tokens are never logged.
The build copies the proto into `build/proto` so it is available in the production image.

Tests use a temporary local gRPC server to verify the actual serialized messages, service
authorization metadata, empty permissions, rejected delegations, errors and timeouts.
Run them with:

```sh
pnpm test -- --runInBand src/__tests__/services/delegation-client.test.ts
pnpm build
```

## Step 2: let the file server log in

Implemented in `src/services/keycloak-service-token-provider.ts`, following the
[Java service-token provider](https://github.com/datakaveri/dx-common/blob/679bfa00419d8a8feeb839d3bed36b133d1e986e/src/main/java/org/cdpg/dx/auth/appid/client/KeycloakServiceTokenProvider.java).

The file server needs its own login before asking the control plane about delegation.
This is separate from a person's login. Keycloak checks the file server's client ID and
client secret, then returns a short-lived service token. This login uses a normal HTTP
request to Keycloak; the delegation lookup itself still uses gRPC.

The login request uses `grant_type=client_credentials`, meaning the service logs in with
its own credentials without asking a person for a username or password. Credentials are
form-encoded so special characters in the secret are sent correctly.

Construct one provider per service identity and reuse it across requests. It accepts:

| Option | Meaning |
|---|---|
| `tokenUrl` | Full Keycloak token endpoint, usually `https://<idp>/realms/<realm>/protocol/openid-connect/token` |
| `clientId` | The file server's service-account client ID, provisioned by the platform team |
| `clientSecret` | That client's secret, supplied from private runtime configuration |
| `timeoutMs` | Login request timeout; defaults to 5,000 milliseconds |

Use the provider and the gRPC client together like this:

```ts
const serviceToken = await tokenProvider.getServiceToken();
const response = await delegationClient.resolveDelegation(
  delegatorId,
  delegateeId,
  serviceToken,
);
```

The provider remembers the token in memory and requests a new one when it is within
60 seconds of expiry, matching Java. If Keycloak omits `expires_in`, it uses Java's
300-second fallback. Tokens with 60 seconds or less of lifetime are returned to the
waiting callers but are not reused for later calls. Simultaneous callers share one
pending login instead of sending several login requests.

Failed logins and invalid responses are reported as service-unavailable errors (`503`),
not as an invalid user login. A failed renewal never falls back to the old token; a later
call can try again. Credentials, tokens, upstream response bodies and raw HTTP errors
are not included in errors or logs. Redirects are refused so the login body is not
forwarded to another endpoint. Lifetime is counted from request start to allow for
network delay.

Tests cover login encoding, token reuse and renewal, simultaneous callers, invalid
responses, network failures, retries after failure and error sanitization. Run them with:

```sh
pnpm exec jest --runInBand src/__tests__/services/keycloak-service-token-provider.test.ts
pnpm build
```

## Step 3: connect login, delegation and file permissions

Implemented in `src/services/delegation-resolver.ts`, `src/core/utils/auth-utils.ts` and
`src/middleware/auth.ts`, with explicit delegated scopes at each protected route.

A protected request now follows this order:

1. Verify the person's bearer token and require a non-empty subject (user ID).
2. If `DID` is absent, use the existing JWT role checks.
3. If `DID` is present, require one delegator UUID and enabled delegation configuration.
4. Obtain the service token, then call `ResolveDelegation(DID, JWT subject)` over gRPC.
5. Check the response: the returned identities must match the requested identities, and
   the delegator's account must be active.
6. Replace the effective user ID, organization and roles with the delegator's details.
   Store the returned scopes exactly as supplied; retain the original actor separately.
7. Check the scope required by the route, then enforce resource ownership or ACL access.

The first version uses the two scopes confirmed for this implementation:

| Protected operation | Required delegated scope | Resource restriction |
|---|---|---|
| List, preview, download databank files; download ZIP; query access | `data-access` | OPEN access, or delegated ACL/owner access for non-public databanks |
| Initiate, complete or cancel uploads; delete files | `own-asset-management` | Databank belongs to the delegator |
| Create/poll/update processing jobs | `own-asset-management` | Databank belongs to the delegator |
| Upload an asset | `own-asset-management` | Stored under the delegator's asset namespace |
| Download an asset | `data-access` | Asset belongs to the delegator, including when returned roles contain `cos_admin` |
| Fetch the encryption public key | `own-asset-management` | Platform key, when the encryption feature is enabled |

These scope checks apply to delegated requests independently of roles. A `provider` or
`cos_admin` role in either the JWT or the response does not add permissions. Empty scopes
deny protected operations. A management-only delegation needs `data-access` as well to
read/download files. A new protected route without an explicit delegated scope mapping
denies delegated requests by default. Organization/platform scopes are not enabled here.

Existing public metadata and report-download endpoints remain public; they do not run the
delegation middleware. The missing-upload-ID endpoint only returns a validation error.

Malformed `DID` returns `400`, invalid login returns `401`, rejected/expired delegation or
insufficient scopes returns `403`, and service failures or inconsistent responses return
`503`. Failures never fall back to the actor's JWT permissions.

Only the service token is cached. Each delegated HTTP request resolves delegation again;
unlike Java's two-minute resolution cache, this version does not reuse permission decisions.
This keeps revocation behavior straightforward while integration is validated.

## Passing the context through

Catalogue and ACL calls keep the original verified bearer token and add the resolved
delegator ID as `DID`. Never replace that token with the file server's service token.
The deployed downstream services must support this combination before enabling delegation.

Audit records keep the effective delegator in `user_id` and `delegator_id`, and the original
actor in `context.delegateeId`, with their original roles in `context.delegateeRoles`.
The exact effective scopes are also in `context.scopes`. Missing delegator organization
details are not filled from the actor's token. The existing extensible audit context is
used, so no database schema change is introduced.

The CORS allow-list includes `DID`, so browser clients can send it. A single gRPC connection
and token provider are created lazily and reused; the connection closes during server shutdown.

## Service-account setup

The service-token flow was checked against the
[gRPC service-auth design](https://github.com/datakaveri/dx-dataplane-rs/blob/dev/docs/auth_new/grpc-service-auth-design.md)
and the [control-plane authentication interceptor](https://github.com/datakaveri/dx-controlplane/blob/8d7efe623574b6f20fd39c9e249e3632fd9a0e66/src/main/java/org/cdpg/dx/aaa/grpc/auth/ServiceAuthInterceptor.java).
The design marks implementation as pending, but the referenced control-plane source
already applies these checks. Verify that your deployed version includes them.

A successful Keycloak login gives the file server a token. For the control plane to accept
that token, the platform/Keycloak administrator must configure the following:

1. Create or use the confidential client `svc-file-server`, with client authentication
   and service accounts enabled. Configure its secret as `DELEGATION_CLIENT_SECRET`.
   This is separate from the public front-end login client.
2. Assign the client scope `grpc:controlplane` to this client as **Default** and enable its
   inclusion in the token's `scope` claim. Default means Keycloak includes it automatically
   whenever the file server logs in. The provider follows Java and sends no explicit
   `scope` parameter; assigning this scope only as Optional is insufficient.
3. Add an Audience mapper with **Included Client Audience** set to `dx-controlplane` and
   **Add to access token** enabled. This marks the token as intended for the control plane.
4. Include `svc-file-server` in the control plane's `grpcAllowedServiceClients` configuration.
   Its [reference development configuration](https://github.com/datakaveri/dx-controlplane/blob/8d7efe623574b6f20fd39c9e249e3632fd9a0e66/dev/config-dev.json)
   already lists this ID. A different client ID works when Keycloak and the deployed
   control-plane allow-list both use that same ID.

Before rollout, obtain a service token and inspect these fields locally:

| Token field | Required value | Plain meaning |
|---|---|---|
| `azp` | `svc-file-server`, or the exact configured and allow-listed client ID | Which service is calling |
| `aud` | Contains `dx-controlplane` | Which service should accept this token |
| `scope` | Contains `grpc:controlplane` | Permission to call the control-plane gRPC service |
| `exp` | A future expiry timestamp | The token is still valid |

The control plane verifies the signature and these claims on incoming gRPC calls.
Missing claims or an unrecognized client cause gRPC `UNAUTHENTICATED`; the file server
reports this dependency failure as HTTP `503`. Obtaining a token with HTTP `200` alone
does not prove a gRPC call will be accepted. Verify an actual delegation RPC as well.

The service scope `grpc:controlplane` lets the file server contact the control plane.
The delegation scopes `data-access` and `own-asset-management` determine what the person
can do with files. They are separate permissions from separate stages of the request.

The setup above changes Keycloak and control-plane configuration outside this repository.
The file server's `.env` and ConfigMap cannot add an audience mapper, default scope or
allow-list entry to those services.

## Enable and test in a deployment

Delegation defaults to disabled. On protected routes a supplied `DID` is rejected when
disabled, rather than silently ignored. To enable it, keep both `AUTH_ENABLED` and
`AUTHZ_ENABLED` true and configure:

```dotenv
DELEGATION_ENABLED=true
DELEGATION_GRPC_ADDRESS=controlplane:9090
# Explicitly confirm this matches your network: false is the Java client's plaintext setup.
DELEGATION_GRPC_TLS=false
DELEGATION_TOKEN_URL=https://<idp>/realms/<realm>/protocol/openid-connect/token
DELEGATION_CLIENT_ID=svc-file-server
DELEGATION_CLIENT_SECRET=<supply-through-private-env-or-secret>
```

Both HTTP token fetching and gRPC calls default to five-second timeouts. See
[the configuration reference](config/file-server.md#delegation-configuration) for all fields.
Missing enabled configuration, or enabling delegation while disabling authentication or
authorization, fails startup validation. The existing Kubernetes `envFrom` entries pick
up these settings from the ConfigMap and Secret examples.
Complete the [service-account setup](#service-account-setup) before enabling the feature.

Tests include signed JWTs through Express authentication, denied read-only writes, allowed
owner-only management, asset namespace isolation, response identity mismatches, empty
scopes, downstream headers, auditing and configuration. Run the focused suites with:

```sh
pnpm exec jest --runInBand --testPathPattern='delegation|keycloak-service-token-provider|middleware/auth.test'
pnpm build
```

Remaining live validation needs the token endpoint, a provisioned confidential service
client and secret, transport-security confirmation, and working downstream `DID` support.
Exercise a real read-only delegation and owner-management delegation against the deployed
control plane before rollout. No live environment has been contacted by these tests.
