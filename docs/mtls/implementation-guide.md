# mTLS File Server Implementation Guide

This guide explains how to implement the [proposed architecture](./mtls-based-architecture.md)
in this repository. Follow the numbered steps in order. Code, environment variables, and
manifests marked **new** are proposed additions; this guide does not implement them itself.

For a simpler explanation of the certificates, gateway settings, and request examples, read
[how mTLS works here](./mtls-explained.md) first.

The target behavior is:

| Request | Expected result |
| --- | --- |
| Public, private, or restricted dataset through the normal file server instance | Apply the dataset's existing permissions |
| Sandbox-only dataset through the normal file server instance | Reject, even if the user has dataset permission |
| Any request to the sandbox file server endpoint without an accepted client certificate | Reject at the gateway; do not forward to the file server |
| Sandbox-only dataset through the sandbox file server instance with an accepted client certificate | Also check the caller's dataset permissions before returning file content |

There are two different identities: the client certificate identifies the **sandbox application
backend**, while the bearer token identifies the **user or service requesting the dataset**.
One does not replace the other.

Implementation order:

1. [Identify affected files and routes](#step-1-identify-the-files-and-routes-that-need-changes).
2. [Confirm the Catalogue contract](#step-2-confirm-the-catalogue-contract).
3. [Add instance settings](#step-3-add-settings-that-identify-each-file-server-instance).
4. [Load the dataset type](#step-4-load-the-dataset-type-in-one-shared-middleware).
5. [Enforce endpoint and permission checks](#step-5-enforce-the-endpoint-restriction-then-check-dataset-permission).
6. [Update every dataset read path](#step-6-apply-the-same-ordered-checks-to-every-dataset-read-path).
7. [Stream protected content](#step-7-return-sandbox-only-bytes-through-the-protected-endpoint).
8. [Create lab certificates](#step-8-create-development-certificates-outside-the-repository).
9. [Configure the gateways](#step-9-configure-separate-https-and-mtls-gateways).
10. [Prepare application Deployments and Services](#step-10-create-separate-application-deployments-and-services).
11. [Prepare gateway Deployments and certificate mounts](#step-11-prepare-gateway-manifests-and-certificate-mounts).
12. [Restrict direct application access](#step-12-prevent-direct-access-to-either-application-instance).
13. [Configure the sandbox client](#step-13-configure-the-sandbox-application-backend-as-the-mtls-client).
14. [Test the behavior](#step-14-verify-behavior-with-automated-tests-and-real-connections).
15. [Roll out the deployment](#step-15-roll-out-in-an-order-that-keeps-sandbox-only-data-protected).
16. [Operate and troubleshoot](#step-16-operate-rotate-and-troubleshoot-the-deployment).

## Step 1: Identify the files and routes that need changes

Start with these existing files:

| File | Work needed |
| --- | --- |
| [environment.ts](../../src/config/environment.ts) | Add validated instance settings |
| [.env.example](../../.env.example) | Document the new settings |
| [server.ts](../../src/server.ts) | Validate security settings before starting the listener |
| [auth.ts](../../src/middleware/auth.ts) | Reuse JWT, role, delegation, and dataset permission checks; review existing fallback behavior |
| [databanks-routes.ts](../../src/routes/databanks-routes.ts) | Apply the new checks to every dataset read path and prevent sandbox-only storage links |
| [assets-routes.ts](../../src/routes/assets-routes.ts) | Check that assets cannot expose copies of protected dataset content |
| [storage-service.ts](../../src/services/storage-service.ts) | Support streaming archives and other protected outputs |
| [openapi.ts](../../src/config/openapi.ts) | Document changed responses and denied operations |
| [manifest.yaml](../../infra/manifest.yaml) | Use as the starting point for separate application Deployments and Services |

Add these files during implementation:

```text
src/middleware/dataset-read-access.ts
src/__tests__/middleware/dataset-read-access.test.ts
infra/mtls/                     # Reviewed, credential-free deployment examples
```

The current `checkItemAccess` function does not call the ACL check for ordinary non-delegated
requests in its non-public branches. Do not treat its name or comments as proof that a route
checks dataset permission. The current `checkItemAccessWithDatabankAccess` does perform that
check for non-public datasets. The new read pipeline below makes the order explicit.

## Step 2: Confirm the Catalogue contract

The application currently reads `result[0].accessPolicy` from the Catalogue. Public datasets
are represented by `OPEN` in the existing code. Confirm the actual values used for every type
before writing the adapter.

The examples in this guide assume this mapping:

| User-facing dataset type | Example Catalogue `accessPolicy` |
| --- | --- |
| Public | `OPEN` |
| Private | `PRIVATE` |
| Restricted | `RESTRICTED` |
| Sandbox-only | `SANDBOX_ONLY` |

**`RESTRICTED` and `SANDBOX_ONLY` are example contract values, not verified Catalogue values.**
If the Catalogue uses another field or spelling, change the adapter and fixtures to match it.
Do not accept several guessed values or treat an unknown value as public.

For example, a response for the dataset `sandbox-demo` could be:

```json
{
  "result": [
    {
      "id": "sandbox-demo",
      "accessPolicy": "SANDBOX_ONLY"
    }
  ]
}
```

The code below also assumes the Catalogue returns the dataset identifier as `id`. If it does
not, adapt that field to the real response contract while still verifying that the returned item
matches the requested dataset. The example dataset IDs in this guide are synthetic placeholders.

Define these outcomes before proceeding:

- Missing dataset: `404`.
- Catalogue rejects the caller: preserve the authentication/access denial.
- Unavailable Catalogue, malformed response, or unknown dataset type: return an error without
  fetching the file, usually `503`.
- Sandbox-only data requested through the normal file server instance: `403`.

For the first implementation, fetch policy for each request. If caching is added later, define
how a change to sandbox-only takes effect on both instances before relying on cached results.

## Step 3: Add settings that identify each file server instance

Add these **new** fields inside the Zod environment schema in `src/config/environment.ts`:

```typescript
FILE_SERVER_MODE: z.enum(['normal', 'sandbox']).default('normal'),
SANDBOX_ALLOWED_CLIENT_SUBJECTS: z
  .string()
  .default('')
  .transform((value) => value.split(';').map((dn) => dn.trim()).filter(Boolean)),
```

Here `DN` means certificate subject distinguished name. For example, a certificate whose only
subject field is `CN=sandbox-client` has that subject DN. The semicolon separator allows a DN
itself to contain commas.

Add the following to `.env.example`:

```dotenv
# New settings: implemented by the steps in this guide.
# normal: rejects sandbox-only reads; sandbox: requires verified gateway identity.
FILE_SERVER_MODE=normal
# Exact allowed client certificate subject DNs, separated with semicolons.
# Required for the sandbox file server instance.
SANDBOX_ALLOWED_CLIENT_SUBJECTS=
```

The normal file server instance uses:

```dotenv
FILE_SERVER_MODE=normal
AUTH_ENABLED=true
AUTHZ_ENABLED=true
```

The sandbox file server instance uses:

```dotenv
FILE_SERVER_MODE=sandbox
SANDBOX_ALLOWED_CLIENT_SUBJECTS=CN=sandbox-client
AUTH_ENABLED=true
AUTHZ_ENABLED=true
```

In `src/server.ts`, check these settings **before** `app.listen(...)`:

```typescript
if (env.NODE_ENV === 'production' && (!env.AUTH_ENABLED || !env.AUTHZ_ENABLED)) {
  throw new Error('Deployed file server instances require authentication and authorization');
}

if (env.FILE_SERVER_MODE === 'sandbox') {
  if (!env.AUTH_ENABLED || !env.AUTHZ_ENABLED) {
    throw new Error('The sandbox file server instance requires authentication and authorization');
  }
  if (env.SANDBOX_ALLOWED_CLIENT_SUBJECTS.length === 0) {
    throw new Error('The sandbox file server instance requires allowed client certificate DNs');
  }
}
```

The deployment setting comes from server configuration. Never choose the instance mode from
an HTTP header, request body, hostname supplied by the client, or query parameter.

## Step 4: Load the dataset type in one shared middleware

Create **new** `src/middleware/dataset-read-access.ts`. Start with this example, adapting the
Catalogue schema according to Step 2:

```typescript
import axios from 'axios';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/environment';
import {
  ApplicationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../core/errors/application-errors';
import { databankAccess } from './auth';

const policySchema = z.enum(['OPEN', 'PRIVATE', 'RESTRICTED', 'SANDBOX_ONLY']);
type DatasetPolicy = z.infer<typeof policySchema>;

const catalogueSchema = z.object({
  result: z.array(z.object({ id: z.string(), accessPolicy: policySchema })).length(1),
});

interface DatasetReadContext {
  databankId: string;
  policy: DatasetPolicy;
}

function getContext(req: Request, res: Response): DatasetReadContext {
  const context = res.locals.datasetRead as DatasetReadContext | undefined;
  if (!context || context.databankId !== req.params.databankId) {
    throw new ServiceUnavailableError('Dataset policy check');
  }
  return context;
}

export async function loadDatasetReadPolicy(
  req: Request, res: Response, next: NextFunction,
) {
  try {
    const databankId = req.params.databankId;
    if (typeof databankId !== 'string' || !databankId.trim()) {
      throw new ValidationError('Databank ID is required');
    }

    const headers: Record<string, string> = {};
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    // Only forward delegation identity after authentication has resolved it.
    if (res.locals.isDelegated) headers.DID = res.locals.userId;

    const response = await axios.get(`${env.CAT_API_URL.replace(/\/$/, '')}/item`, {
      params: { id: databankId, auditEnabled: 'false' },
      headers,
      timeout: 5000,
      validateStatus: () => true,
    });

    if (response.status === 404) throw new NotFoundError('Databank', databankId);
    if (response.status === 401) throw new AuthenticationError();
    if (response.status === 403) throw new AuthorizationError();

    const contentType = String(response.headers['content-type'] ?? '');
    if (response.status !== 200 || !contentType.includes('application/json')) {
      throw new ServiceUnavailableError('Catalogue API');
    }

    const parsed = catalogueSchema.safeParse(response.data);
    const item = parsed.success ? parsed.data.result[0] : undefined;
    if (!item || item.id !== databankId) {
      throw new ServiceUnavailableError('Catalogue API', {
        reason: 'Missing, unknown, or mismatched dataset policy',
      });
    }

    res.locals.datasetRead = { databankId, policy: item.accessPolicy };
    res.locals.accessPolicy = item.accessPolicy;
    return next();
  } catch (error) {
    return next(error instanceof ApplicationError
      ? error
      : new ServiceUnavailableError('Catalogue API'));
  }
}
```

This middleware runs even if a development authorization flag is disabled. Otherwise, the
normal file server instance could lose its sandbox-only restriction when authorization is off.
Avoid a second Catalogue fetch in the same read pipeline: use the verified request context
rather than invoking an older policy middleware again.

## Step 5: Enforce the endpoint restriction, then check dataset permission

Append these functions to the same new middleware file:

```typescript
export function enforceDatasetReadTransport(
  req: Request, res: Response, next: NextFunction,
) {
  try {
    const { policy } = getContext(req, res);

    if (env.FILE_SERVER_MODE === 'sandbox') {
      const verified = req.get('X-Sandbox-Client-Verify') === 'SUCCESS';
      const clientDN = req.get('X-Sandbox-Client-DN') ?? '';
      if (!verified || !env.SANDBOX_ALLOWED_CLIENT_SUBJECTS.includes(clientDN)) {
        throw new AuthorizationError('A verified sandbox client is required');
      }
    }

    if (policy === 'SANDBOX_ONLY' && env.FILE_SERVER_MODE !== 'sandbox') {
      throw new AuthorizationError('Sandbox-only datasets require the sandbox file server instance');
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export function enforceDatasetReadPermission(
  req: Request, res: Response, next: NextFunction,
) {
  try {
    const { policy } = getContext(req, res);
    if (policy === 'OPEN') return next();
    if (!env.AUTH_ENABLED || !env.AUTHZ_ENABLED) {
      throw new AuthorizationError('Protected dataset reads require authorization');
    }
    return databankAccess(req, res, next);
  } catch (error) {
    return next(error);
  }
}
```

**The headers above are trusted gateway assertions, not proof by themselves.** This example is
valid only after the gateway overwrites them and network rules prevent callers from reaching
the application directly. Implement Steps 9–12 before exposing the sandbox file server instance. Setting
Express `trust proxy` does not make arbitrary identity headers trustworthy.

`databankAccess` currently includes an owner fallback when the ACL lookup denies access or fails.
Review that behavior against your required private/restricted/sandbox-only policy. If owner
access is an intentional permission, preserve it only after independently verifying ownership.
If the policy requires an explicit ACL grant, remove that fallback for those reads. A failed
permission lookup must never turn into unconditional access.

## Step 6: Apply the same ordered checks to every dataset read path

For existing authenticated read routes in `src/routes/databanks-routes.ts`, the intended order is:

```text
authenticate JWT and resolve delegation
→ check role / delegated scope
→ load dataset type
→ enforce normal-versus-sandbox restriction
→ check dataset permission
→ validate operation input
→ read storage or return an allowed result
```

For example, replace the existing `checkItemAccessWithDatabankAccess` in the file download route
with the three new middlewares. Import them from `../middleware/dataset-read-access`:

```typescript
databanksRoutes.post(
  '/:databankId/files/download',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER], [DelegationScope.DATA_ACCESS]),
  loadDatasetReadPolicy,
  enforceDatasetReadTransport,
  enforceDatasetReadPermission,
  validateBody(getObjectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    // Existing handler, revised in Step 7.
  }),
);
```

This is a route-wiring example, not a complete replacement handler. Keep the existing role and
delegation imports and the real response handling.

An `OPEN` dataset does not automatically make every endpoint anonymous. The current file
download route still requires a JWT and an allowed role. Preserve that behavior unless you
explicitly decide to change its API contract.

Review at least these current routes under `/v1`:

| Route | Required work |
| --- | --- |
| `POST /databanks/:databankId/files` | Protect listing; file names can reveal dataset information |
| `POST /databanks/:databankId/files/download` | Add the ordered checks and protect both stream/link branches |
| `POST /databanks/:databankId/files/preview` | Add the same checks; preview content is dataset content |
| `POST /databanks/:databankId/files/metadata` | Currently public; apply dataset-aware rules before returning protected metadata |
| `GET /databanks/:databankId/download` | Protect archive content and stop issuing sandbox-only storage links |
| `GET /databanks/:databankId/report/download` | Currently public; apply dataset-aware rules if the report is covered by the dataset policy |
| `GET /databanks/:databankId/query-access` | Reject sandbox-only requests instead of issuing direct storage credentials |
| `POST /assets/download` | Ensure protected dataset copies cannot be retrieved as ordinary assets |

For the currently public metadata/report routes, preserve anonymous access only when the
Catalogue confirms `OPEN` and the operation is intended to be public. Use a policy-aware wrapper:

```text
Authorization or DID header present?
  Yes → authenticate and resolve delegation before Catalogue/ACL calls
  No  → obtain policy using the Catalogue's supported public/service lookup

Load policy and enforce endpoint restriction
  OPEN and operation is public → return the public result
  Any protected type           → require JWT, role/scope, and dataset permission
```

If the Catalogue does not support a suitable public lookup, make requiring authentication an
explicit API decision and update callers and OpenAPI accordingly. Do not silently make protected
metadata public to avoid introducing authentication. Never forward a raw `DID` without resolving it.

Validate that the requested storage key belongs to the checked dataset. A caller must not be
able to authorize dataset A and then supply an absolute key, archive key, or asset key for dataset B.
Generate archive/report paths on the server from the checked ID. Preserve provider-specific
object-key behavior; do not rely on filesystem path normalization as storage authorization.

## Step 7: Return sandbox-only bytes through the protected endpoint

The file download route already supports streaming when `presigned` is false or omitted.
Keep ordinary dataset behavior, but reject requests to create sandbox-only links before calling
any presigning method:

```typescript
// Inside the handler, after the middleware chain and validateBody(getObjectSchema).
const { key, presigned } = req[VALIDATED_BODY];
const sandboxOnly = res.locals.datasetRead.policy === 'SANDBOX_ONLY';

if (sandboxOnly && presigned) {
  throw new AuthorizationError('Sandbox-only files must be downloaded through this endpoint');
}

// Only non-sandbox-only datasets may enter the existing presigned URL branch.
// Otherwise continue into the streaming branch.
```

Add `AuthorizationError` to the route's imports. A sandbox-only request with
`{"key":"sample.csv","presigned":false}` should receive file content, not a link or redirect.
Do not silently change a requested JSON/link response into binary content.

For the streaming branch, use a stream pipeline rather than buffering the whole file. A minimal
pattern inside the existing async handler is:

```typescript
// New import: import { pipeline } from 'node:stream/promises';
const databankId = req.params.databankId;
if (typeof databankId !== 'string') throw new ValidationError('Databank ID is required');
const stream = await s3Service.getObject(key, databankId);

res.type('application/octet-stream');
res.attachment(key.split('/').pop() || 'download');
res.set('Cache-Control', 'private, no-store');

try {
  await pipeline(stream, res);
} catch (error) {
  // pipeline may already have closed the response socket. Do not send a JSON error afterward.
  logger.warn('File download stream failed', { databankId });
  if (!res.destroyed) res.destroy();
}
```

Handle storage-open failures before writing response headers. Verify that disconnecting the
client closes the storage stream. Review the audit middleware so a failed or partial stream is
not logged as a completed download. Node documents pipeline cleanup and HTTP socket behavior
in its [stream documentation](https://nodejs.org/docs/latest-v24.x/api/stream.html#streampipelinesource-transforms-destination-callback).

The ZIP route currently returns a presigned link. For sandbox-only archives, add a storage
service method such as `getDatabankArchive(databankId): Promise<Readable>` that:

1. Accepts the checked dataset ID, not an arbitrary user-supplied archive key.
2. Builds `zips/${databankId}.zip` on the server.
3. Uses the repository/bucket where the ZIP worker actually writes the archive.
4. Returns a readable stream and maps missing archives to `404`.

`getObject(key, databankId)` currently prefixes databank keys, so passing `zips/...` to that
method would fetch the wrong path. Add an explicit archive method to `StorageServiceInterface`
and `StorageService`, using the existing repository stream conversion. Do the same for protected
reports at `reports/...` after checking their real worker output path.

Document the ZIP endpoint's conditional binary response in OpenAPI, or introduce a separate
documented content endpoint and update the sandbox client. For the first release, reject a
sandbox-only archive request until its streaming branch is implemented; never fall back to a link.

Also reject `/query-access` for sandbox-only datasets **on both instances**. Direct storage
credentials can bypass mTLS just as a download link can. If the product later needs sandbox-side
querying, design a separately restricted access mechanism rather than reusing unrestricted STS.

For example, add this before any credential-issuance call in that route, after the shared checks:

```typescript
if (res.locals.datasetRead.policy === 'SANDBOX_ONLY') {
  throw new AuthorizationError('Direct storage credentials are not available for sandbox-only datasets');
}
```

## Step 8: Create development certificates outside the repository

Steps 8–13 prepare certificates, configuration, manifests, and client changes. Apply the
Deployments and expose the endpoints only in the rollout order in Step 15.

The following commands create short-lived lab certificates. Production certificates should come
from your managed PKI, with protected CA keys and a defined rotation/revocation process.

Use two CAs in this example:

- Server CA: the sandbox client uses it to trust the gateway's server certificate.
- Client CA: the sandbox gateway uses it to verify sandbox client certificates.

Run these commands in one Bash session. Keep `MTLS_WORKDIR` set for later examples:

```bash
umask 077
MTLS_WORKDIR="$(mktemp -d /tmp/files-mtls-lab.XXXXXX)"
export MTLS_WORKDIR

openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
  -keyout "$MTLS_WORKDIR/server-ca.key" -out "$MTLS_WORKDIR/server-ca.crt" \
  -subj '/CN=Files Lab Server CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'

openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
  -keyout "$MTLS_WORKDIR/client-ca.key" -out "$MTLS_WORKDIR/client-ca.crt" \
  -subj '/CN=Files Lab Client CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'

openssl req -new -newkey rsa:3072 -sha256 -nodes \
  -keyout "$MTLS_WORKDIR/server.key" -out "$MTLS_WORKDIR/server.csr" \
  -subj '/CN=files.example.com'

cat > "$MTLS_WORKDIR/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:files.example.com,DNS:sandbox-files.example.com
EOF

openssl x509 -req -sha256 -days 7 \
  -in "$MTLS_WORKDIR/server.csr" \
  -CA "$MTLS_WORKDIR/server-ca.crt" -CAkey "$MTLS_WORKDIR/server-ca.key" \
  -CAcreateserial -extfile "$MTLS_WORKDIR/server.ext" \
  -out "$MTLS_WORKDIR/server.crt"

openssl req -new -newkey rsa:3072 -sha256 -nodes \
  -keyout "$MTLS_WORKDIR/sandbox-client.key" \
  -out "$MTLS_WORKDIR/sandbox-client.csr" -subj '/CN=sandbox-client'

cat > "$MTLS_WORKDIR/client.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
EOF

openssl x509 -req -sha256 -days 7 \
  -in "$MTLS_WORKDIR/sandbox-client.csr" \
  -CA "$MTLS_WORKDIR/client-ca.crt" -CAkey "$MTLS_WORKDIR/client-ca.key" \
  -CAcreateserial -extfile "$MTLS_WORKDIR/client.ext" \
  -out "$MTLS_WORKDIR/sandbox-client.crt"

openssl verify -purpose sslserver -verify_hostname sandbox-files.example.com \
  -CAfile "$MTLS_WORKDIR/server-ca.crt" "$MTLS_WORKDIR/server.crt"
openssl verify -purpose sslclient \
  -CAfile "$MTLS_WORKDIR/client-ca.crt" "$MTLS_WORKDIR/sandbox-client.crt"
openssl x509 -in "$MTLS_WORKDIR/sandbox-client.crt" -noout -subject -nameopt RFC2253
```

Both verification commands should print `OK`. The last command should report subject
`CN=sandbox-client`, which must match the gateway and application allow-lists.
The example uses a certificate with both server hostnames for convenience; separate server
certificates can be used in production. OpenSSL documents the command options in
[req](https://docs.openssl.org/3.0/man1/openssl-req/) and
[x509](https://docs.openssl.org/3.0/man1/openssl-x509/).

Distribute only what each component needs:

| Component | Files needed |
| --- | --- |
| Normal gateway | `server.crt`, `server.key` |
| Sandbox gateway | `server.crt`, `server.key`, `client-ca.crt` |
| Sandbox application backend | `sandbox-client.crt`, `sandbox-client.key`, `server-ca.crt` |
| Certificate issuer only | `server-ca.key`, `client-ca.key` |

Do not mount either CA private key into the gateway or file server. Do not distribute the
sandbox client private key to users, browsers, the normal file server, or ordinary Postman setups.

## Step 9: Configure separate HTTPS and mTLS gateways

The repository's existing ingress example uses community `ingress-nginx` annotations. That
controller's maintenance ended in March 2026. The examples below use **standalone NGINX reverse
proxy pods**, not the retired controller. Your maintained gateway or cloud load balancer can
provide the same checks instead. See the [Kubernetes retirement announcement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/).

Create two separate NGINX configuration files in `MTLS_WORKDIR`. These are `conf.d` files
included inside NGINX's `http` context, not complete `nginx.conf` files.

Save this as `$MTLS_WORKDIR/normal.conf`:

```nginx
server {
    listen 8443 ssl;
    server_name files.example.com;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_certificate /etc/nginx/tls/tls.crt;
    ssl_certificate_key /etc/nginx/tls/tls.key;

    location / {
        proxy_pass http://files-connect-api-normal:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Sandbox-Client-Verify "";
        proxy_set_header X-Sandbox-Client-DN "";
    }
}
```

Save this as `$MTLS_WORKDIR/sandbox.conf`:

```nginx
map "$ssl_client_verify|$ssl_client_s_dn" $sandbox_client_allowed {
    default 0;
    "SUCCESS|CN=sandbox-client" 1;
}

server {
    listen 8443 ssl;
    server_name sandbox-files.example.com;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_certificate /etc/nginx/tls/tls.crt;
    ssl_certificate_key /etc/nginx/tls/tls.key;
    ssl_client_certificate /etc/nginx/client-ca/ca.crt;
    ssl_verify_client on;
    ssl_verify_depth 2;

    # A valid certificate from the CA must also have an allowed client identity.
    if ($sandbox_client_allowed = 0) { return 403; }

    location / {
        proxy_pass http://files-connect-api-sandbox:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Sandbox-Client-Verify $ssl_client_verify;
        proxy_set_header X-Sandbox-Client-DN $ssl_client_s_dn;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        add_header Cache-Control "private, no-store" always;
    }
}
```

The client CA checks who issued the certificate; the explicit subject allow-list selects which
clients may connect. For a larger PKI, replace the example's CN-only subject with your organization's
unique certificate identity policy and keep both gateway and application settings aligned.
Client-supplied identity headers are replaced, never passed through unchanged. `proxy_pass` has
no trailing URI here, so paths such as `/v1/databanks/...` are preserved.

Tune body-size limits for the operations actually exposed through each gateway. The snippets
above focus on reads. Retain your required rate limits, CORS policy, and other gateway settings
when integrating them. NGINX documents certificate directives and verification variables in its
[SSL module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html), and forwarding and buffering
in its [proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Step 10: Create separate application Deployments and Services

Use the same application image for both file server instances. Build it only after implementing
Steps 3–7. Pin a reviewed tag or digest instead of using a mutable `latest` image.

Save the following as a private working manifest, for example
`$MTLS_WORKDIR/api-normal.yaml`. Replace the image placeholder. The referenced ConfigMap and
Secrets are the same existing dependencies described in the [infrastructure guide](../../infra/README.md).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: files-connect-api-normal
  namespace: sandbox
spec:
  replicas: 2
  selector:
    matchLabels:
      app: files-connect-api
      file-server-mode: normal
  template:
    metadata:
      labels:
        app: files-connect-api
        file-server-mode: normal
    spec:
      containers:
        - name: api
          image: your-registry/files-connect-api:REPLACE_WITH_REVIEWED_VERSION
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: files-connect-config
            - secretRef:
                name: files-connect-secret
            - secretRef:
                name: rabbitmq-secrets
          env:
            - name: FILE_SERVER_MODE
              value: "normal"
            - name: SANDBOX_ALLOWED_CLIENT_SUBJECTS
              value: "CN=sandbox-client"
            - name: AUTH_ENABLED
              value: "true"
            - name: AUTHZ_ENABLED
              value: "true"
          readinessProbe:
            httpGet:
              path: /v1/health
              port: 3000
          livenessProbe:
            httpGet:
              path: /v1/health
              port: 3000
            initialDelaySeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: files-connect-api-normal
  namespace: sandbox
spec:
  type: ClusterIP
  selector:
    app: files-connect-api
    file-server-mode: normal
  ports:
    - port: 80
      targetPort: 3000
```

Create `$MTLS_WORKDIR/api-sandbox.yaml` from that template with these exact changes:

| Field | Normal manifest | Sandbox manifest |
| --- | --- | --- |
| Deployment and Service name | `files-connect-api-normal` | `files-connect-api-sandbox` |
| Every `file-server-mode` label/selector | `normal` | `sandbox` |
| `FILE_SERVER_MODE` environment value | `normal` | `sandbox` |

Keep the same namespace, image, dependencies, and application port. Explicit `env` entries override
matching entries in `envFrom`. Add the resource settings, image-pull settings, service accounts,
and startup probes appropriate to your deployment.

Do not reuse a Service whose selector is only `app: files-connect-api`: it would select both
instances. Both API Services stay `ClusterIP`; expose only the gateways. The sandbox application
instance continues to use the existing HTTP listener in `server.ts` because its gateway performs
client mTLS verification. Use authenticated internal TLS or your service mesh when cluster-network
encryption is required; the network policy in Step 12 restricts reachability but does not encrypt it.

## Step 11: Prepare gateway manifests and certificate mounts

Prepare the namespace and dependency configuration before these commands. This example assumes
the existing `sandbox` namespace; the namespace name itself does not prove sandbox identity.

```bash
kubectl -n sandbox create secret tls files-server-tls \
  --cert="$MTLS_WORKDIR/server.crt" --key="$MTLS_WORKDIR/server.key"
kubectl -n sandbox create secret generic files-sandbox-client-ca \
  --from-file=ca.crt="$MTLS_WORKDIR/client-ca.crt"
kubectl -n sandbox create configmap files-normal-gateway-config \
  --from-file=default.conf="$MTLS_WORKDIR/normal.conf"
kubectl -n sandbox create configmap files-sandbox-gateway-config \
  --from-file=default.conf="$MTLS_WORKDIR/sandbox.conf"
```

These are initial-create commands. For updates, use your secret manager or review controlled
replacement manifests. Do not print populated Secret YAML into shared logs.

Save this gateway template as `$MTLS_WORKDIR/gateway-sandbox.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: files-sandbox-gateway
  namespace: sandbox
spec:
  replicas: 2
  selector:
    matchLabels:
      app: files-sandbox-gateway
  template:
    metadata:
      labels:
        app: files-sandbox-gateway
    spec:
      containers:
        - name: nginx
          image: nginx:REPLACE_WITH_REVIEWED_VERSION
          ports:
            - name: https
              containerPort: 8443
          readinessProbe:
            tcpSocket:
              port: https
          volumeMounts:
            - name: config
              mountPath: /etc/nginx/conf.d
              readOnly: true
            - name: server-tls
              mountPath: /etc/nginx/tls
              readOnly: true
            - name: client-ca
              mountPath: /etc/nginx/client-ca
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: files-sandbox-gateway-config
        - name: server-tls
          secret:
            secretName: files-server-tls
        - name: client-ca
          secret:
            secretName: files-sandbox-client-ca
---
apiVersion: v1
kind: Service
metadata:
  name: files-sandbox-gateway
  namespace: sandbox
spec:
  type: LoadBalancer
  selector:
    app: files-sandbox-gateway
  ports:
    - name: https
      port: 443
      targetPort: https
```

Create `$MTLS_WORKDIR/gateway-normal.yaml` from this template:

1. Replace every `files-sandbox-gateway` with `files-normal-gateway`, including the ConfigMap name.
2. Remove the `client-ca` volume and its corresponding volume mount. The normal gateway does
   not need the client CA.
3. Replace the NGINX image placeholder in both manifests with your reviewed version or digest.

Use TCP forwarding on port 443 from the cloud load balancer to the NGINX gateway. If another
component terminates TLS first, NGINX will not receive the sandbox client's certificate. Configure
mTLS there instead and redesign the trusted identity handoff; do not disable client verification
to make an extra TLS terminator work. A bare local Kubernetes cluster may need a load-balancer
implementation or port forwarding for lab access.

Point `files.example.com` at the normal gateway and `sandbox-files.example.com` at the sandbox
gateway. Both names must match the server certificate. For lab tests without DNS, use curl's
`--resolve hostname:443:gateway-ip` option while retaining the correct hostname in the URL.

## Step 12: Prevent direct access to either application instance

Save the following as `$MTLS_WORKDIR/network-policy.yaml`. A pod selector inside an ingress
`from` entry selects pods in the policy's namespace in this example.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: files-normal-api-ingress
  namespace: sandbox
spec:
  podSelector:
    matchLabels:
      app: files-connect-api
      file-server-mode: normal
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: files-normal-gateway
      ports:
        - protocol: TCP
          port: 3000
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: files-sandbox-api-ingress
  namespace: sandbox
spec:
  podSelector:
    matchLabels:
      app: files-connect-api
      file-server-mode: sandbox
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: files-sandbox-gateway
      ports:
        - protocol: TCP
          port: 3000
```

Your cluster network plugin must enforce NetworkPolicy. Policies are additive: another policy
allowing all pods to reach the API would reopen access. Review existing policies and verify denial
from an unrelated pod. The [Kubernetes NetworkPolicy documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
explains enforcement and combined-policy behavior.

Restrict who may create/relabel gateway pods, read Secrets, exec into gateway pods, or port-forward
to the sandbox API. Those administrative permissions can cross the proxy trust boundary. Do not
publish a second ingress, NodePort, or load balancer for the sandbox API Service.

For cloud VMs instead of Kubernetes, use the same separation: private application listeners,
gateway-only firewall/security-group rules, and no public route to the application's HTTP port.

## Step 13: Configure the sandbox application backend as the mTLS client

Mount the client certificate, matching private key, and server CA only in the sandbox application
backend. These are client credentials; the file server application's container does not need them.
The example below belongs in the sandbox application backend, not this repository's file server:

```typescript
import axios from 'axios';
import https from 'node:https';
import { readFileSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const agent = new https.Agent({
  cert: readFileSync('/run/sandbox-mtls/sandbox-client.crt'),
  key: readFileSync('/run/sandbox-mtls/sandbox-client.key'),
  ca: readFileSync('/run/sandbox-mtls/server-ca.crt'),
  rejectUnauthorized: true,
});

async function downloadIntoSandbox(accessToken: string) {
  const response = await axios.post(
    'https://sandbox-files.example.com/v1/databanks/sandbox-demo/files/download',
    { key: 'sample.csv', presigned: false },
    {
      httpsAgent: agent,
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'stream',
      maxRedirects: 0,
      timeout: 30000,
    },
  );
  await pipeline(response.data, createWriteStream('/workspace/sample.csv'));
}
```

Use an existing writable sandbox path in place of `/workspace/sample.csv`, and tune timeouts for
the expected file sizes. Do not allow redirects to turn a protected request into a download from
another origin. Keep server hostname and certificate validation enabled; Node's HTTPS client
supports these TLS options through its [HTTPS request API](https://nodejs.org/docs/latest-v24.x/api/https.html#httpsrequestoptions-callback).

If the server certificate uses a public CA, use the platform trust store rather than replacing
it with the lab CA. Never place the client private key in browser JavaScript. The sandbox
application must also keep downloaded files inside the permitted environment; an unrestricted
HTTP endpoint that forwards their contents outside the sandbox would defeat the intended policy.

## Step 14: Verify behavior with automated tests and real connections

Add focused middleware tests in the new
`src/__tests__/middleware/dataset-read-access.test.ts`. Mock the Catalogue, ACL, and storage calls,
and verify their call counts as well as the HTTP result. An error response after fetching the
protected object is too late.

| Test case | Expected result |
| --- | --- |
| `OPEN`, normal file server instance | Existing public-route policy is preserved |
| `PRIVATE` / `RESTRICTED`, allowed user | Continue after permission check |
| `PRIVATE` / `RESTRICTED`, denied user | No storage call |
| `SANDBOX_ONLY`, normal file server instance | `403`, no storage or presigning call |
| Same request with forged sandbox headers on normal file server instance | Still `403` |
| `SANDBOX_ONLY`, sandbox file server instance, missing gateway assertion | `403`, no storage call |
| Sandbox file server instance, verified header but unapproved DN | `403`, no storage call |
| Accepted sandbox identity but missing/invalid JWT | Authentication failure, no storage call |
| Accepted sandbox identity but denied dataset permission | `403`, no storage call |
| Accepted sandbox identity and allowed user | Stream content |
| Sandbox-only request with `presigned: true` | `403`, no presigning call |
| Sandbox-only `/query-access` | `403`, no credential issuance |
| Missing/unknown policy or Catalogue timeout | No storage call |
| Catalogue response for a different dataset | No storage call |
| Dataset A checked, dataset B key supplied | No access to dataset B |
| Delegated request | Preserve effective user, resolved DID, roles, and delegated scopes |
| Development authorization flags disabled | Normal file server instance still blocks sandbox-only reads |
| Production auth disabled / sandbox allow-list empty | Startup fails |
| Storage stream fails / client disconnects | Stream closes; no successful-completion audit |

Run the repository's relevant checks after implementing code:

```bash
pnpm build
pnpm test -- --runInBand src/__tests__/middleware
pnpm lint
```

Regenerate OpenAPI after updating its source using `pnpm openapi`. Also run the applicable
storage and route tests after changing archive or report streaming.

Mocked header tests do not prove mTLS works. Verify the actual gateways separately. Set the
base URLs and read a valid test-user token without echoing it:

```bash
NORMAL_BASE='https://files.example.com'
SANDBOX_BASE='https://sandbox-files.example.com'
read -r -s -p 'Test access token: ' ACCESS_TOKEN
```

Normal endpoint, sandbox-only dataset, valid user token:

```bash
curl --cacert "$MTLS_WORKDIR/server-ca.crt" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"sample.csv","presigned":false}' \
  "$NORMAL_BASE/v1/databanks/sandbox-demo/files/download"
```

Expected: `403`. Supplying `Origin: https://sandbox-files.example.com` or forged
`X-Sandbox-Client-*` headers must not change it.

Sandbox endpoint, no client certificate:

```bash
curl --cacert "$MTLS_WORKDIR/server-ca.crt" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"sample.csv","presigned":false}' \
  "$SANDBOX_BASE/v1/databanks/sandbox-demo/files/download"
```

Expected: rejection at the gateway, with no application or storage request. Depending on the
TLS version and gateway, the client may see a TLS error or a gateway HTTP error. Do not require
one universal status code for a failed client-certificate check.

Sandbox endpoint, accepted client certificate and allowed user:

```bash
curl --fail-with-body --cacert "$MTLS_WORKDIR/server-ca.crt" \
  --cert "$MTLS_WORKDIR/sandbox-client.crt" --key "$MTLS_WORKDIR/sandbox-client.key" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"sample.csv","presigned":false}' \
  -o "$MTLS_WORKDIR/downloaded-sample.csv" \
  "$SANDBOX_BASE/v1/databanks/sandbox-demo/files/download"
```

Expected: file bytes with no presigned URL and no storage redirect. Repeat with a denied user,
`presigned: true`, a preview request, and the ZIP/report routes. Also test an expired certificate,
an unrelated CA, and a certificate signed by the trusted client CA whose subject is not allowed.
Only an accepted certificate **and** the required dataset permission may produce a download.

From an unrelated pod, attempt a direct request to
`http://files-connect-api-sandbox.sandbox.svc.cluster.local` with forged identity headers.
Expected: network denial. Verify that the normal gateway cannot reach this Service either.
Do not use `kubectl port-forward` as that negative test: it is an administrative access path.

Use a synthetic file larger than your usual response buffers to check streaming behavior.
Disconnect the client mid-download and confirm the storage read stops. Observe memory use to
ensure the implementation does not load the entire dataset into memory.

## Step 15: Roll out in an order that keeps sandbox-only data protected

The commands below refer to the private manifests prepared above. Replace every image placeholder
and verify the cluster context before applying them. Prepare the existing integration dependencies
first; these examples do not provision Catalogue, ACL, Redis, object storage, or RabbitMQ.

1. Implement and test the application changes, including all alternate content routes.
2. Build and publish the reviewed image to your registry. Update both application manifests.
3. Apply the network policies before exposing the new gateways.
4. Deploy the normal file server instance and verify that sandbox-only reads fail there.
5. Deploy the sandbox file server instance and the gateway configuration/certificate mounts.
6. Test accepted and rejected client certificates against the new gateway addresses.
7. Move normal and sandbox DNS/routing to their respective gateways. Remove the old public
   ingress/backend route once the normal replacement is ready.
8. Confirm no old application replica, alternate hostname, Service, or storage credential path
   can still serve sandbox-only content.
9. Enable the sandbox client and monitor real requests.

Example application order:

```bash
kubectl config current-context
kubectl apply -f "$MTLS_WORKDIR/network-policy.yaml"
kubectl apply -f "$MTLS_WORKDIR/api-normal.yaml"
kubectl apply -f "$MTLS_WORKDIR/api-sandbox.yaml"
kubectl -n sandbox rollout status deploy/files-connect-api-normal
kubectl -n sandbox rollout status deploy/files-connect-api-sandbox
kubectl apply -f "$MTLS_WORKDIR/gateway-normal.yaml"
kubectl apply -f "$MTLS_WORKDIR/gateway-sandbox.yaml"
kubectl -n sandbox rollout status deploy/files-normal-gateway
kubectl -n sandbox rollout status deploy/files-sandbox-gateway
kubectl -n sandbox get services
```

Do not classify new datasets as sandbox-only while an old public-serving path can still read them.
If sandbox-only datasets already exist, close the old access path during the migration rather
than leaving them exposed until the final routing change.

Previously issued presigned links or STS credentials may remain usable after an application
policy change. Before reclassifying a dataset as sandbox-only, invalidate/restrict those paths
using your storage provider's controls, or wait for them to expire while access remains blocked.
Check caches, existing archive copies, and derived outputs as well.

## Step 16: Operate, rotate, and troubleshoot the deployment

Log the instance mode, dataset ID, decision, and a request correlation ID. Record the verified
sandbox certificate identity only where needed for auditing. Do not log bearer tokens, private
keys, complete client certificates, storage credentials, or download links. Review the existing
request/response logging and audit behavior before enabling the new fields.

For certificate rotation:

1. Issue the replacement client certificate for an approved identity.
2. If the identity or CA changes, update gateway and application allow-lists/trust first, with
   a bounded overlap for the old and new credentials.
3. Reload or restart the gateway after updating certificate/configuration mounts; merely updating
   a Kubernetes Secret does not guarantee that NGINX has reloaded it.
4. Update the sandbox application backend's mounted credentials and recreate its HTTPS agent.
5. Verify a successful download, then retire the old credential and remove temporary trust.
6. Test that the retired credential is rejected, including the effect of TLS session resumption
   and already-open connections. Define a maximum connection/session lifetime for your policy.

If using a CA revocation list, configure and maintain it at the gateway; issuing a new certificate
alone does not revoke the old one. Define an emergency procedure for a leaked client key before
deploying production credentials.

| Symptom | Check first |
| --- | --- |
| Sandbox client cannot verify the server | Server hostname/SAN, server CA trust, certificate expiry |
| Gateway rejects the sandbox client | Client CA, client certificate expiry and client-auth purpose, exact allowed DN |
| Gateway accepts the client but the application returns `403` | Gateway headers, application mode, application DN allow-list, JWT and dataset permission |
| Catalogue lookup returns `503` | API URL, JSON response shape, actual policy values, matching dataset ID |
| Sandbox-only request returns a storage link | Missed presigning branch or alternate download route |
| Request reaches the wrong application instance | Service selectors, gateway upstreams, DNS, old ingress configuration |
| Forged headers work when connecting directly | Missing/ineffective NetworkPolicy or another permissive policy |
| Large downloads stall | Gateway/load-balancer timeouts, buffering, stream errors, client disconnect handling |

If a rollout fails, disable the sandbox download route or restore a previously verified secure
version. Do not roll back to a version that exposes sandbox-only data through the normal file
server instance or disable client-certificate verification as a recovery shortcut.
