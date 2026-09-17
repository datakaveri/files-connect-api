# File Server (`files-connect-api`) — Configuration Field Reference

## 0. Document header

| | |
|---|---|
| **Service** | file server (`files-connect-api`) |
| **Code repo / branch** | `datakaveri/files-connect-api` @ `stable/v2.3` |
| **Config path** | Private `.env` (local, template at [.env.example](../../.env.example)); private copies of `infra/configmap.yaml` + `infra/secret.example.yaml` (Kubernetes). Populated `infra/secret.yaml` is ignored. |
| **Config schema version** | No `version` field. Schema is the Zod object in [src/config/environment.ts](../../src/config/environment.ts) |
| **Maintainer / point of contact** | Repository maintainers |
| **Last updated** | 2026-09-16 |

## 1. Top-level structure

There is no nested config object; configuration is a flat set of environment variables. The
equivalent of "top-level keys" is the grouping below. Each group names the module that consumes it.

| Group | Consumed by | Purpose |
|---|---|---|
| Server | [src/server.ts](../../src/server.ts), [src/app.ts](../../src/app.ts) | Listen port, runtime mode, CORS, API version string |
| Storage | [src/config/storage.ts](../../src/config/storage.ts), `src/repositories/*` | Which object store, endpoint, credentials, bucket |
| Encryption | [src/services/kms-service.ts](../../src/services/kms-service.ts), [src/routes/index.ts](../../src/routes/index.ts) | TANUH-only client-side envelope encryption |
| Auth | [src/middleware/auth.ts](../../src/middleware/auth.ts), [src/core/utils/auth-utils.ts](../../src/core/utils/auth-utils.ts) | JWT verification (static key or multi-IDP JWKS), feature toggles |
| Downstream APIs | [src/middleware/auth.ts](../../src/middleware/auth.ts) | ACL-APD and Catalogue base URLs |
| Audit / RabbitMQ | [src/services/rabbitmq-service.ts](../../src/services/rabbitmq-service.ts), [src/services/audit-service.ts](../../src/services/audit-service.ts) | Where audit events are published |
| Redis / job queues | [src/core/utils/redis-client.ts](../../src/core/utils/redis-client.ts), [src/core/utils/job-queue.ts](../../src/core/utils/job-queue.ts) | Queue endpoint and queue names shared with the workers |
| STS | [src/services/temporary-access-service.ts](../../src/services/temporary-access-service.ts) | Temporary scoped credentials for direct bucket access |
| Observability | `elastic-apm-node` agent (preloaded by `node -r elastic-apm-node/start.js`), [src/core/utils/logger.ts](../../src/core/utils/logger.ts) | Log level and APM |
| Test-only | [src/__tests__/utils/auth.ts](../../src/__tests__/utils/auth.ts) | Credentials used by the authenticated e2e tests |

**Validation behaviour (read this first).** `loadEnv()` parses `process.env` with the Zod schema at
startup. On any failure it logs `Environment variable validation failed` with a JSON `issues` array
naming each bad field, then calls `exit(1)` — the process never binds a port, so in Kubernetes the
pod goes `CrashLoopBackOff` with the issues array in the first lines of the log. A second pass,
`validateStorageConfiguration()`, applies provider-conditional rules and exits the same way.

---

## 2. Field blocks

### `PORT`

- **Type / format:** int (given as string), parsed with `parseInt`.
- **Required:** no.
- **Purpose:** TCP port the Express server binds in `src/server.ts`.
- **Expected value:** unprivileged port; must equal `containerPort` and the `livenessProbe`/`readinessProbe` port in [infra/manifest.yaml](../../infra/manifest.yaml) and the `targetPort` of the Service.
- **Example value:** `3000`
- **Default if omitted:** `3000`
- **How to obtain:** operator decision; keep `3000` unless it collides.
- **Failure mode:** a non-numeric value yields `NaN` and `listen` throws `ERR_SOCKET_BAD_PORT`. If it disagrees with the manifest, the probes fail and the Deployment never becomes ready.
- **Change impact:** requires editing the Deployment, Service `targetPort`, and any Compose port mapping together.

### `NODE_ENV`

- **Type / format:** enum — `development` \| `production` \| `test`.
- **Required:** no.
- **Purpose:** selects the dotenv file (`production` → `.env.production`, otherwise `.env`), and suppresses RabbitMQ/audit middleware initialisation when `test` (see [src/app.ts:161](../../src/app.ts#L161)).
- **Expected value:** `production` in every cluster deployment.
- **Example value:** `production`
- **Default if omitted:** `development`
- **How to obtain:** operator decision. The image already sets `ENV NODE_ENV=production`.
- **Failure mode:** any other string fails Zod validation → exit 1. With `production` set but no `.env.production` present, dotenv silently loads nothing — fine when the environment is injected by Kubernetes, fatal in a bare VM (every required field then reports "Required").
- **Notes:** `test` disables the audit pipeline; never use it in a real deployment.

### `STORAGE_PROVIDER`

- **Type / format:** enum — `s3` \| `minio` \| `gcs`.
- **Required:** no (defaults), but effectively mandatory because it selects which credential set is validated.
- **Purpose:** picks the repository implementation and the auth mode in `createStorageConfig()`. `minio` additionally forces path-style addressing.
- **Expected value:** `s3` for AWS **and** for S3-compatible providers behind a custom endpoint (e.g. Cyfuture); `minio` only for local/self-hosted MinIO; `gcs` for Google Cloud Storage.
- **Example value:** `s3`
- **Default if omitted:** `s3`
- **How to obtain:** operator decision, matching the platform the deployment runs on.
- **Failure mode:** unknown value → Zod enum error → exit 1. Correct value with the wrong credential family → `Storage configuration error: <field> is required`, or `S3 storage provider requires either legacy S3_* variables or new STORAGE_* variables` followed by exit 1.
- **Notes / gotchas:** **must equal the workers' `STORAGE_PROVIDER`.** The workers read the same variable name but their credentials come from `S3_*`, not `STORAGE_*`.

### `STORAGE_ENDPOINT`

- **Type / format:** string, URL **with scheme**, no trailing slash.
- **Required:** conditional — required for `s3`/`minio` unless the legacy `S3_ENDPOINT` is set.
- **Purpose:** endpoint passed to the AWS SDK S3 client; also used as the STS endpoint when the provider is `minio`.
- **Expected value:** full origin, e.g. `https://s3.ap-south-1.amazonaws.com`, `https://storage.example.com`, `http://minio:9000`. No bucket, no path.
- **Example value:** `https://s3.ap-south-1.amazonaws.com`
- **Default if omitted:** falls back to `S3_ENDPOINT`, then `''`.
- **How to obtain:** cloud provider's regional endpoint, or the in-cluster Service DNS name for MinIO.
- **Failure mode:** empty → `Storage configuration error: endpoint is required` thrown from `validateStorageConfig()`. Wrong host → every object operation fails with `ENOTFOUND`/`ECONNREFUSED` and uploads return HTTP 500.
- **Notes / gotchas:** the workers must receive the same value as `S3_ENDPOINT`; the k8s manifests already remap `STORAGE_ENDPOINT` → `S3_ENDPOINT`.

### `STORAGE_REGION`

- **Type / format:** string, AWS region id.
- **Required:** no (SDK requires *some* region; falls back to `S3_REGION`, then the STS client defaults to `us-east-1`).
- **Purpose:** SDK region for S3 and STS request signing (SigV4).
- **Expected value:** the bucket's region, lowercase.
- **Example value:** `ap-south-1`
- **Default if omitted:** `S3_REGION`; the STS client falls back to `us-east-1`.
- **How to obtain:** where the bucket was created.
- **Failure mode:** mismatch with the bucket's real region → `PermanentRedirect` / `AuthorizationHeaderMalformed` on S3 calls.
- **Notes:** for MinIO any consistent value works (`us-east-1` by convention).

### `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` *(credential pair)*

- **Type / format:** string.
- **Required:** conditional — required for `s3`/`minio` unless `S3_ACCESS_KEY`/`S3_SECRET_KEY` are set. Ignored for `gcs`.
- **Purpose:** static credentials for the S3 client **and** the identity that calls `sts:AssumeRole` for temporary access.
- **Which system the account lives in:** AWS IAM (or MinIO's user database / the S3-compatible provider's console).
- **Privileges required:**
  - On the bucket named by `BUCKET_NAME`: `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` (multipart upload is the primary upload path).
  - `sts:AssumeRole` on `STS_ROLE_ARN` — and `STS_ROLE_ARN`'s trust policy must name this principal. See [infra/STS_SETUP.md](../../infra/STS_SETUP.md).
  - No bucket-creation or account-level permissions are needed.
- **Example value:** `AKIA…` / a 40-char secret.
- **Default if omitted:** falls back to `S3_ACCESS_KEY`/`S3_SECRET_KEY`; if both are missing the service exits 1.
- **How to obtain:** DevOps creates a dedicated IAM user (or MinIO service account) per environment and stores the pair in the `files-connect-secret` Secret. Never reuse a personal key.
- **Failure mode:** missing → `MinIO storage provider requires either STORAGE_* variables or legacy S3_* variables` / `Storage configuration error: accessKey is required`, exit 1. Wrong → HTTP 403 `SignatureDoesNotMatch` or `InvalidAccessKeyId` on the first upload; temporary-access requests fail with `AccessDenied` on `AssumeRole`.
- **Change impact:** rotate in `secret.yaml`, then restart the file server **and both workers** — the workers receive the same key pair through `S3_ACCESS_KEY`/`S3_SECRET_KEY`.
- **Notes:** the workers' variables carry the same value; keep them rotated together.

### `STORAGE_FORCE_PATH_STYLE`

- **Type / format:** bool as string; **only the exact string `"true"` is true**.
- **Required:** no.
- **Purpose:** sets `forcePathStyle` on the S3 client — `endpoint/bucket/key` instead of `bucket.endpoint/key`.
- **Expected value:** `true` for MinIO and most S3-compatible providers; `false` for AWS S3.
- **Example value:** `false`
- **Default if omitted:** `false`, but `createStorageConfig()` forces it on for `minio`.
- **Failure mode:** `false` against MinIO → DNS resolution failures for `bucket.minio` (`ENOTFOUND`); `true` against AWS works but is deprecated for new buckets.

### `STORAGE_USE_SSL`

- **Type / format:** bool as string (`"true"` ⇒ true).
- **Required:** no.
- **Purpose:** advertises whether the endpoint is TLS; used to build client options and, for MinIO, to pick the default port.
- **Expected value:** must agree with the scheme in `STORAGE_ENDPOINT`.
- **Default if omitted:** `true` (and forced true for `minio` unless explicitly `"false"`).
- **Failure mode:** `true` with an `http://` endpoint → `EPROTO` / TLS handshake errors on every object call.
- **Notes:** remapped to the workers' `USE_SSL`, whose default is the **opposite** (`false`). Set both explicitly.

### `STORAGE_PORT`

- **Type / format:** int as string.
- **Required:** no.
- **Purpose:** explicit port for the storage client when it is not implied by the endpoint URL.
- **Expected value:** normally omit and put the port in `STORAGE_ENDPOINT`.
- **Default if omitted:** unset; MinIO logs `MinIO configuration: port not specified, will use default based on SSL setting`.
- **Failure mode:** wrong port → `ECONNREFUSED` on every storage call.

### `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` *(legacy fallbacks)*

- **Type / format:** as their `STORAGE_*` equivalents.
- **Required:** no, if the `STORAGE_*` variables are set. Kept for backward compatibility with pre-`STORAGE_*` deployments.
- **Purpose:** fallback values in `createStorageConfig()` — `STORAGE_*` always wins.
- **Expected value:** identical to the `STORAGE_*` pair. Do not set both to different values.
- **How to obtain:** same as `STORAGE_*`.
- **Failure mode:** setting only these is supported; setting *neither* family exits 1 with the message quoted under `STORAGE_ACCESS_KEY`.
- **Notes / gotchas:** these are the **canonical names in both Python workers**. In a single `.env` shared with Compose, `S3_*` are what the workers actually consume; the file server prefers `STORAGE_*`. Divergence here is the most common cause of "the API can read the bucket but the worker cannot".

### `BUCKET_NAME`

- **Type / format:** string, valid bucket name (lowercase, no underscores for AWS).
- **Required:** **yes** — no default, for every provider.
- **Purpose:** the single bucket holding databank uploads (`<databankId>/…`), zip output (`zips/<databankId>.zip`) and readiness reports (`reports/<databankId>/`).
- **Expected value:** bucket name only — no `s3://`, no region, no path.
- **Example value:** `your-files-connect-bucket`
- **Default if omitted:** none — Zod reports `BUCKET_NAME: Required` and the process exits 1.
- **How to obtain:** created by DevOps per environment; the same bucket must be referenced by both workers.
- **Failure mode:** wrong/nonexistent → `NoSuchBucket` (HTTP 404 from the store) surfaced as 500 on upload; workers log `Folder not found or empty: <databankId>` and mark the job failed.
- **Change impact:** changing it strands all existing objects — requires a data migration and a simultaneous change in the file server, zip worker and report worker.

### `GCS_PROJECT_ID`

- **Type / format:** string (GCP project id, not project number).
- **Required:** no; recommended when `STORAGE_PROVIDER=gcs`.
- **Purpose:** project passed to `@google-cloud/storage`; required for billing attribution when the credential does not carry a project.
- **Example value:** `tanuh-prod-1234`
- **Default if omitted:** inferred from the credential / ADC metadata.
- **Failure mode:** missing with a credential that has no default project → `Unable to detect a Project Id in the current environment`.

### `GCS_KEY_FILE`

- **Type / format:** absolute filesystem path to a service-account JSON key.
- **Required:** conditional — one of `GCS_KEY_FILE`, the `GCS_CLIENT_EMAIL`+`GCS_PRIVATE_KEY` pair, or ADC.
- **Purpose:** highest-precedence GCS credential source.
- **Expected value:** a path that exists **inside the container** — mount the key as a Secret volume.
- **Example value:** `/var/secrets/gcs/key.json`
- **Default if omitted:** falls through to inline credentials, then ADC (with a startup warning).
- **How to obtain:** GCP console → IAM → Service Accounts → Keys. Prefer Workload Identity (ADC) over key files where the cluster supports it.
- **Privileges required:** `roles/storage.objectAdmin` on the bucket (read, write, delete, list). When encryption is enabled, the same service account also needs `roles/cloudkms.publicKeyViewer` on the KMS key (see `KMS_KEY_VERSION_NAME`).
- **Failure mode:** path not mounted → `ENOENT: no such file or directory` at first storage call.
- **Notes:** the config map key is only meaningful if the corresponding volume is also declared in the Deployment; it is **not** wired in the current manifests.

### `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY` *(credential pair)*

- **Type / format:** email address; PEM private key. Literal `\n` escapes are converted to real newlines by both the API and the workers.
- **Required:** conditional — see `GCS_KEY_FILE`.
- **Purpose:** inline service-account credentials, so no key file has to be mounted.
- **Which system the account lives in:** Google Cloud IAM.
- **Privileges required:** `roles/storage.objectAdmin` on `BUCKET_NAME` (plus `roles/cloudkms.publicKeyViewer` if encryption is on).
- **How to obtain:** fields `client_email` and `private_key` of the service-account JSON key; store both in the `files-connect-secret` Secret.
- **Failure mode:** malformed key → `error:1E08010C:DECODER routines::unsupported`; wrong account → `403 does not have storage.objects.create access`.
- **Notes / gotchas:** in YAML, use a block scalar or keep the `\n` escapes — a raw multi-line PEM inside double quotes will not round-trip.

### `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB`

- **Type / format:** int as string.
- **Required:** **yes** — the schema has a transform but no default.
- **Purpose:** intended upper bound on total databank upload size, checked in [src/services/multipart-upload-service.ts:192](../../src/services/multipart-upload-service.ts#L192).
- **Expected value:** whole gigabytes. Size it against the bucket quota and largest permitted databank upload.
- **Example value:** `1000`
- **Default if omitted:** none — `NaN` if unset; Zod reports `Required` and the process exits 1.
- **Failure mode:** when the value calculated during initiation exceeds the setting, initiation is rejected with `Content size is greater than <N>GB.`
- **Notes / gotchas:** the current initiation request contains `numParts`, but no real file size or part sizes. The service substitutes 1 MiB per requested part for this check, while the presigned URLs do not enforce that size. The check therefore evaluates approximately `numParts * 1 MiB`, **not the bytes actually uploaded**. Clients must enforce the intended total-size policy until the API contract carries trustworthy size information. Databank part PUTs go directly to object storage and bypass the file-server nginx ingress; `proxy-body-size` is not a databank part-size control. See [Databank Multipart Uploads](../api/multipart-uploads.md#current-size-validation-limitation).

### `ENCRYPTION_ENABLED` *(feature flag)*

- **Type / format:** bool as string (`"true"` ⇒ true).
- **Required:** no.
- **Purpose:** master switch mounting the `/v1/encryption` routes ([src/routes/index.ts:35](../../src/routes/index.ts#L35)). Off by default; only TANUH deployments enable it.
- **Fields that become required when true:** `KMS_KEY_VERSION_NAME` (production) or `DEV_ENCRYPTION_PUBLIC_KEY_PEM` (local).
- **Default if omitted:** `false`
- **Failure mode:** off → `GET /v1/encryption/public-key` returns 404. On but unconfigured → HTTP 503 `Encryption is not configured: set KMS_KEY_VERSION_NAME (or DEV_ENCRYPTION_PUBLIC_KEY_PEM for local development)`.

### `KMS_KEY_VERSION_NAME`

- **Type / format:** full Cloud KMS crypto key **version** resource name.
- **Required:** conditional on `ENCRYPTION_ENABLED=true` (unless `DEV_ENCRYPTION_PUBLIC_KEY_PEM` is set).
- **Purpose:** the asymmetric key whose public half is served to clients so they can wrap per-file AES-256 DEKs; the TEE unwraps via `asymmetricDecrypt`.
- **Expected value:** `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>/cryptoKeyVersions/<n>` — the version suffix is mandatory. Purpose must be `ASYMMETRIC_DECRYPT`, algorithm `RSA_DECRYPT_OAEP_3072_SHA256`.
- **Example value:** `projects/tanuh-prod/locations/asia-south1/keyRings/tanuh/cryptoKeys/dataset-dek-wrap/cryptoKeyVersions/1`
- **Default if omitted:** none — 503 on the encryption routes.
- **How to obtain:** created by DevOps in Cloud KMS; copy the version resource name from the console or `gcloud kms keys versions list`.
- **Privileges required:** the API's Google identity needs `roles/cloudkms.publicKeyViewer` on the key. Decryption privileges belong to the TEE, **not** to this service.
- **Failure mode:** wrong name → `NOT_FOUND` from KMS surfaced as a 5xx on the public-key endpoint; missing IAM role → `PERMISSION_DENIED`.
- **Change impact:** rotating to a new key version invalidates client-side wrapped DEKs produced against the old one; coordinate with the client and the TEE.
- **Notes:** the public key is cached in-process, so a change needs a restart to take effect quickly.

### `DEV_ENCRYPTION_PUBLIC_KEY_PEM`

- **Type / format:** PEM public key; `\n` escapes are unescaped.
- **Required:** no — **local development only**.
- **Purpose:** serves a locally generated RSA-3072 public key when no KMS emulator is available. Logs `Serving DEV_ENCRYPTION_PUBLIC_KEY_PEM instead of Cloud KMS public key` at WARN.
- **How to obtain:** `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 …` (command in `.env.example`).
- **Failure mode:** if accidentally set in production it silently shadows KMS — clients wrap DEKs the TEE cannot unwrap, and decryption fails later, far from the cause.
- **Notes:** must never appear in `configmap.yaml` or `secret.yaml`.

### `KEYCLOAK_AUTH_URL`

- **Type / format:** string, **must parse as a URL** (`z.string().url()`).
- **Required:** **yes** — no default, even when `AUTH_ENABLED=false`.
- **Purpose:** base URL of the Keycloak realm. At runtime it is used by the authenticated e2e test helper ([src/__tests__/utils/auth.ts](../../src/__tests__/utils/auth.ts)) to fetch tokens; request-path verification uses `ISSUER_CONFIG`/`KEYCLOAK_PUBLIC_KEY` instead. It is nevertheless a **startup-required** field.
- **Expected value:** realm base URL including scheme, no trailing slash, e.g. `https://idp.<domain>/auth/realms/<realm>`.
- **Example value:** `https://idp.example.com/realms/example`
- **Default if omitted:** none — `KEYCLOAK_AUTH_URL: Invalid url` / `Required`, exit 1.
- **How to obtain:** DevOps / the Keycloak administrator for the environment.
- **Failure mode:** value without a scheme (`idp.example.com`) fails URL validation → exit 1 at boot.
- **Notes / gotchas:** the value is used **two different ways** in this repo. The ConfigMap carries the
  *realm base* URL, but the test helper POSTs form data straight to it as if it were the **token
  endpoint**; configure the complete `…/protocol/openid-connect/token` URL in the private `.env.test`.
  Nothing on the request
  path reads it, so the realm-base value in the ConfigMap is correct for deployment; just do not expect
  the same value to work for the authenticated e2e tests.

### `KEYCLOAK_CLIENT_ID`

- **Type / format:** string.
- **Required:** **yes**.
- **Purpose:** the Keycloak client used when the test helper requests tokens; documents which client's tokens this deployment expects.
- **Client documentation:**
  - **No client is created by this repository.** The file server is a pure token *consumer*: it never
    calls Keycloak's admin API, has no service account, no client secret, and no realm import. It
    reuses the platform's existing front-end client (`files-connect-client` for TG-DEX), which is
    owned by the portal/DevOps team. Nothing here needs `realm-management` roles.
  - Naming convention: `<app>-<project>-client`, e.g. `files-connect-client`.
  - Type: **public** client (browser SPA), standard flow + direct grant enabled (direct grant is what the e2e tests use). No confidential client, no client secret is configured anywhere in this service.
  - The audience presented in its tokens must appear in the matching `audience` array of `ISSUER_CONFIG` when audience checking is enabled.
  - **Required token claims:** `sub` (user id), `iss`, `exp`, and **`realm_access.roles`** containing at least one of `provider`, `consumer`, `cos_admin` ([src/core/types/auth.ts](../../src/core/types/auth.ts)). Per-endpoint role requirements are in [docs/api/endpoints.md](../api/endpoints.md). A token whose roles live only in `resource_access.<client>.roles` will authenticate but fail authorisation.
  - Fine-grained per-databank access is **not** a Keycloak concern — it is resolved at request time against ACL-APD (`ACL_APD_API_URL`) and the catalogue (`CAT_API_URL`).
- **Example value:** `files-connect-client`
- **Default if omitted:** none — exit 1.
- **How to obtain:** Keycloak admin console → Clients. Coordinate with DevOps; the same client id is configured in the front-end.
- **Failure mode:** wrong id → the e2e auth helper gets `invalid_client` from the token endpoint; runtime request verification is unaffected.

### `KEYCLOAK_PUBLIC_KEY`

- **Type / format:** base64 RSA public key, with or without the `-----BEGIN PUBLIC KEY-----` wrapper (the wrapper is added if absent).
- **Required:** conditional — required **only when `ISSUER_CONFIG` is not set**.
- **Purpose:** static verification key for the legacy single-IDP path in [src/core/utils/auth-utils.ts:100](../../src/core/utils/auth-utils.ts#L100), algorithm RS256.
- **Expected value:** the realm's RS256 signing key, one line, no surrounding quotes.
- **How to obtain:** Keycloak admin console → Realm settings → Keys → RS256 → *Public key*; or `GET {KEYCLOAK_AUTH_URL}` and read `public_key`.
- **Failure mode:** absent with no `ISSUER_CONFIG` → every authenticated request fails with `Invalid token: KEYCLOAK_PUBLIC_KEY or ISSUER_CONFIG must be configured` (HTTP 401). Stale key after a realm key rotation → `Invalid token: invalid signature` on all requests at once.
- **Change impact:** rotating realm keys requires updating this Secret; migrating to `ISSUER_CONFIG` (JWKS) removes the manual rotation entirely and is the recommended path.
- **Notes:** ignored whenever `ISSUER_CONFIG` is present.

### `ISSUER_CONFIG`

- **Type / format:** string containing a **JSON object**; parsed at startup, throwing `ISSUER_CONFIG must be a valid JSON string` on failure.
- **Required:** no, but strongly preferred over `KEYCLOAK_PUBLIC_KEY`.
- **Purpose:** multi-IDP JWT verification. Keys are issuer strings (`iss` claim, matched verbatim); each maps to a JWKS URL from which the key with the token's `kid` is resolved and cached ([src/core/utils/auth-utils.ts:75](../../src/core/utils/auth-utils.ts#L75)).
- **Expected value / shape:**
  ```json
  {
    "jwtIgnoreExpiry": false,
    "leeway": 30,
    "jwksRefreshIntervalMs": 21600000,
    "<iss value>": { "type": "internal|remote", "jwksUrl": "https://…/certs", "audience": [] }
  }
  ```
  Each issuer key must match the token's `iss` **exactly**, including scheme and trailing path.
- **Example value:** see the commented `.env.example` template. Copy each issuer key from the token's `iss` claim verbatim rather than constructing it; use only your trusted identity provider's JWKS endpoint.
- **Default if omitted:** `null` → the legacy static path is used.
- **How to obtain:** decode a token issued by each IDP that must be accepted, take its `iss`; take `jwksUrl` from that IDP's discovery document (`/.well-known/openid-configuration` → `jwks_uri`).
- **Failure mode:** invalid JSON → startup throws and the process exits. Issuer not listed → 401 `Invalid token: …` for that IDP's users only (a partial outage that looks like a user problem). Unreachable `jwksUrl` → 401s once the cached key expires.
- **Notes / gotchas:** `jwtIgnoreExpiry: true` disables expiry enforcement — acceptable in dev, never in production. Because a missing issuer only breaks *some* users, always test one token per configured issuer after a change.

### `AUTH_ENABLED` *(feature flag)*

- **Type / format:** bool as string with **inverted parsing** — `val !== "false"`, i.e. anything except the exact string `false` (including typos and empty-ish values) means **enabled**.
- **Required:** no.
- **Purpose:** master switch for JWT authentication in [src/middleware/auth.ts:25](../../src/middleware/auth.ts#L25).
- **Expected value:** `true` in every deployed environment.
- **Default if omitted:** `true` (fail-safe).
- **Failure mode:** set to `false` in a cluster → **every endpoint is unauthenticated**. Treat this as a production incident, not a config nit.
- **Notes:** absent from the current ConfigMap, which is safe (defaults on) but implicit; it is now set explicitly.

### `AUTHZ_ENABLED` *(feature flag)*

- **Type / format:** bool as string, same inverted parsing as `AUTH_ENABLED`.
- **Required:** no.
- **Purpose:** switches off role/ACL authorisation while leaving authentication on.
- **Fields that become relevant when true:** `ACL_APD_API_URL`, `CAT_API_URL`.
- **Default if omitted:** `true`
- **Failure mode:** `false` → authenticated users bypass ACL checks and can reach other providers' databanks.

### `LOG_LEVEL`

- **Type / format:** enum — `debug` \| `info` \| `warn` \| `error`.
- **Required:** no.
- **Purpose:** minimum level for the application logger.
- **Expected value:** `info` in production; `debug` only while diagnosing.
- **Default if omitted:** `info`
- **Failure mode:** invalid value → Zod enum error → exit 1. `debug` in production logs request context on every call — high volume and potentially sensitive.
- **Notes:** the example ConfigMap uses `info`; use `debug` only for private, temporary diagnostics.

### `CORS_ORIGIN`

- **Type / format:** `*` **or** a comma-separated list of origins; transformed to `true` or an array.
- **Required:** no.
- **Purpose:** `origin` option of the `cors` middleware ([src/app.ts:136](../../src/app.ts#L136)).
- **Expected value:** in production, an explicit list of scheme+host (+port) origins, no trailing slash, no paths.
- **Example value:** `https://app.example.com,https://catalogue.example.com`
- **Default if omitted:** `*`
- **Failure mode:** origin missing from the list → the browser blocks the response with a CORS error while `curl` succeeds — the classic "works in Postman, fails in the app".
- **Notes / gotchas:** the nginx ingress **also** sets CORS headers (`cors-allow-origin` in [infra/ingress.yaml](../../infra/ingress.yaml)). Both layers must allow an origin; duplicated `Access-Control-Allow-Origin` headers from app *and* ingress cause browsers to reject the response, which is why `CORS_ORIGIN: "*"` is currently used at the app layer with the real list at the ingress.

### `VERSION`

- **Type / format:** string.
- **Required:** no.
- **Purpose:** version reported in the generated OpenAPI document ([src/config/openapi.ts:19](../../src/config/openapi.ts#L19)). Cosmetic.
- **Default if omitted:** `1.0.0`
- **Failure mode:** none beyond a misleading `/openapi.json`.

### `ACL_APD_API_URL`

- **Type / format:** string, **must parse as a URL**.
- **Required:** **yes**.
- **Purpose:** base URL of the ACL-APD service; the middleware calls `${ACL_APD_API_URL}/access_request/has_access` for databank access checks ([src/middleware/auth.ts:381](../../src/middleware/auth.ts#L381)).
- **Expected value:** full base URL including the API path prefix. The code concatenates `/access_request/...` directly, so a **trailing slash produces a double slash** — some gateways 404 on that.
- **Example value:** `https://acl-apd.<domain>/dx/apd/acl/v1`
- **Default if omitted:** none — exit 1.
- **How to obtain:** the ACL-APD deployment's public URL; must match the value the ACL-APD team publishes for that environment.
- **Failure mode:** wrong host or path → the service logs `ACL API returned non-JSON response (Content-Type: text/html). This may indicate a misconfigured ACL_APD_API_URL` and access checks fail closed (403/500).
- **Notes:** cross-referenced with the ACL-APD service's own config.

### `CAT_API_URL`

- **Type / format:** string, **must parse as a URL**.
- **Required:** **yes**.
- **Purpose:** Catalogue REST API base. Used to resolve item metadata for authorisation: `${CAT_API_URL}/item?id=<databankId>&…` ([src/middleware/auth.ts:40](../../src/middleware/auth.ts#L40)).
- **Expected value:** base ending at the catalogue API root, no trailing slash, e.g. `…/iudx/v2/cat`.
- **Example value:** `https://catalogue.example.com/iudx/v2/cat`
- **Default if omitted:** none — exit 1.
- **How to obtain:** the catalogue deployment for that environment.
- **Failure mode:** the item lookup 404s and the request is rejected with `Databank <id> not found in Catalogue API. Please verify the catalogue configuration (CAT_API_URL) is correct.` — logged with the configured value, so check the log line before blaming the data.
- **Notes / gotchas:** the **report worker uses the same value** for dataset-name resolution. It is **not** the same thing as the zip worker's `CAT_URL`, which must point at Elasticsearch — see [zip-worker.md](./zip-worker.md).

### `RABBITMQ_HOST`

- **Type / format:** string, **hostname only** — no scheme, no port, no path.
- **Required:** **yes**.
- **Purpose:** broker host for audit events. The connection URL is built in [src/services/rabbitmq-service.ts:74](../../src/services/rabbitmq-service.ts#L74).
- **Expected value:** FQDN or in-cluster Service name.
- **Failure mode:** unreachable → `Failed to connect to RabbitMQ` at WARN and audit events are dropped; **API requests still succeed** (audit is best-effort, initialised inside a try/catch in `app.ts`). Silent audit loss is the real risk, so alert on that log line.
- **Notes / gotchas:** the protocol is chosen by a **hostname heuristic** — `amqps` if the host contains `iudx.io`, otherwise `amqp`. A TLS broker on any other domain will be dialled as plaintext and fail; this is a code-level assumption to be aware of when moving brokers.

### `RABBITMQ_PORT`

- **Type / format:** int as string.
- **Required:** **yes**.
- **Expected value:** `5672` for AMQP, `5671` for AMQPS.
- **Failure mode:** mismatch with the protocol heuristic above → connection timeout after 10 s, logged, audit disabled.

### `RABBITMQ_VHOST`

- **Type / format:** string; URL-encoded by the client, so `/` is fine as-is.
- **Required:** **yes**.
- **Expected value:** the vhost the audit exchange lives in.
- **Example value:** `/` or `dx-audit`
- **Failure mode:** wrong vhost → `ACCESS_REFUSED` / `NOT_ALLOWED - vhost … not found` in the connection error log.

### `RABBITMQ_USERNAME` / `RABBITMQ_PASSWORD` *(credential pair)*

- **Required:** **yes** (both).
- **Which system the account lives in:** RabbitMQ's internal user database (or its auth backend), on the vhost named by `RABBITMQ_VHOST`.
- **Privileges required:** publish-only on the audit exchange. Minimum grant:
  ```bash
  rabbitmqctl add_user files-connect '<password>'
  rabbitmqctl set_permissions -p '<vhost>' files-connect '^$' '^files-exchange$' '^$'
  #                                        configure ────┘   write ──┘        read ──┘
  ```
  The service does **not** declare the exchange (the `assertExchange` call is commented out), so no `configure` permission is needed — but the exchange must already exist.
- **How to obtain:** created by the RabbitMQ/DevOps owner; delivered in the `rabbitmq-secrets` Secret.
- **Failure mode:** bad credentials → `ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN`, logged once at startup; audit silently disabled thereafter.
- **Notes:** special characters are URL-encoded by the client, so they are safe in the password.

### `RABBITMQ_EXCHANGE`

- **Required:** **yes**.
- **Purpose:** exchange audit messages are published to ([src/services/rabbitmq-service.ts:154](../../src/services/rabbitmq-service.ts#L154)), `persistent: true`.
- **Expected value:** an **existing** direct exchange; the service does not create it.
- **Failure mode:** non-existent exchange → the channel is closed by the broker with `NOT_FOUND - no exchange '<name>'`, `isConnected` flips false, and subsequent audit publishes are skipped.
- **Notes:** must match the exchange the audit consumer binds to — coordinate with the auditing service's config.

### `RABBITMQ_ROUTING_KEY`

- **Required:** **yes**.
- **Purpose:** routing key for every published audit message.
- **Expected value:** must match the binding key used by the audit consumer's queue, verbatim.
- **Failure mode:** wrong key → messages are accepted by the exchange and **silently discarded** (no queue matches). Nothing is logged. Verify with the broker's unroutable-message metric after any change.

### `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB`

- **Type / format:** hostname (no scheme); int; int.
- **Required:** no (defaults `localhost` / `6379` / `0`).
- **Purpose:** connection to the queue store used for job enqueue and job-status hashes ([src/core/utils/redis-client.ts](../../src/core/utils/redis-client.ts)).
- **Expected value:** in-cluster Service name of Redis. **Must resolve in the same namespace** as the pod, or be fully qualified (`redis.<ns>.svc.cluster.local`).
- **Example value:** `redis` / `6379` / `0`
- **Failure mode:** unreachable → `Redis client error … ECONNREFUSED` with reconnect attempts; job submission endpoints return 5xx.
- **Notes / gotchas:** **all three services must use the same host, port and DB.** A mismatched `REDIS_DB` is the quiet failure: the API enqueues into db 0, the worker blocks on db 1, jobs stay `queued` forever with no error anywhere. `REDIS_DB` is ignored in cluster mode.

### `REDIS_PASSWORD`

- **Type / format:** string.
- **Required:** no — omit entirely when the server has no `requirepass`.
- **Purpose:** AUTH credential; injected into the connection URL and client options.
- **Which system the account lives in:** Redis `requirepass` / ACL user.
- **Privileges required:** with Redis ACLs, the user needs `+brpop +lpush +hset +hgetall +expire +exists` on the `jobs:*` and `job:*` key patterns; the default `allkeys` user is what most deployments use.
- **Failure mode:** required but missing → `NOAUTH Authentication required`; wrong → `WRONGPASS invalid username-password pair`.
- **Notes:** must be given to **both workers** as well; currently commented out in the worker manifests.

### `REDIS_CLUSTER_MODE` *(feature flag)*

- **Type / format:** bool as string (`"true"` ⇒ true).
- **Required:** no.
- **Purpose:** selects an ioredis Cluster client instead of a standalone client.
- **Expected value:** `true` only against a real Redis Cluster; `false` for a single instance or Sentinel-fronted primary.
- **Default if omitted:** `false`
- **Failure mode:** `true` against a standalone server → `ERR This instance has cluster support disabled`; `false` against a cluster → `MOVED` errors on every keyed command.
- **Notes:** the workers accept the same flag, plus a legacy alias `REDIS_CLUSTER` and a cluster-only knob `REDIS_CLUSTER_DYNAMIC_STARTUP_NODES` that the **file server does not read**.

### `ZIP_QUEUE_NAME`

- **Type / format:** string (a Redis list key).
- **Required:** no.
- **Purpose:** list the file server `LPUSH`es zip jobs onto; the zip worker `BRPOP`s the same key.
- **Expected value:** identical string in the file server and the zip worker.
- **Default if omitted:** `jobs:zip`
- **Failure mode:** mismatch → jobs accumulate, the API returns `202` with a job id, the job stays `queued`, and the worker logs only `Listening on queue: <other name>`. Nothing errors.
- **Change impact:** change both sides in the same rollout, ideally with the queue drained.

### `REPORT_QUEUE_NAME`

- **Type / format:** string.
- **Required:** no.
- **Purpose:** queue key for data-readiness jobs consumed by the report worker.
- **Default if omitted:** `READINESS_QUEUE_NAME` if set, else `jobs:report` (resolved in the schema transform at [src/config/environment.ts:163](../../src/config/environment.ts#L163)).
- **Failure mode:** as `ZIP_QUEUE_NAME` — silent.

### `READINESS_QUEUE_NAME` *(legacy alias — deprecated)*

- **Required:** no. Kept only so older deployments keep working.
- **Purpose:** previous name of `REPORT_QUEUE_NAME`; used as a fallback by both the file server and the report worker.
- **Notes:** do not set it in new deployments; if both are set, `REPORT_QUEUE_NAME` wins.

### `STS_ROLE_ARN`

- **Type / format:** string, IAM role ARN.
- **Required:** **yes** — unconditionally, including MinIO and GCS deployments.
- **Purpose:** role assumed by [src/services/temporary-access-service.ts](../../src/services/temporary-access-service.ts) to mint short-lived, databank-scoped credentials for direct bucket access.
- **Expected value:** `arn:aws:iam::<account-id>:role/<role-name>`. For MinIO any syntactically valid ARN works (MinIO ignores it), e.g. `arn:aws:iam::minio:role/custom-role`.
- **Example value:** `arn:aws:iam::123456789012:role/DatabanksTemporaryAccessRole`
- **Default if omitted:** none — `STS_ROLE_ARN: Required`, exit 1.
- **How to obtain:** created by DevOps following [infra/STS_SETUP.md](../../infra/STS_SETUP.md).
- **Privileges required:** the role's **permission** policy grants `s3:GetObject`/`s3:ListBucket` on the bucket (the service narrows it further per request with a session policy); its **trust** policy must allow the principal behind `STORAGE_ACCESS_KEY` to `sts:AssumeRole`.
- **Failure mode:** placeholder/wrong ARN → `AccessDenied: User … is not authorized to perform: sts:AssumeRole on resource …` and the temporary-access endpoint returns 5xx. Note the ConfigMap currently ships the placeholder account `123456789012` — that is a real misconfiguration in any AWS environment.
- **Change impact:** issued credentials outlive the change by up to `STS_SESSION_DURATION_IN_SECONDS`.

### `STS_SESSION_DURATION_IN_SECONDS`

- **Type / format:** int as string, seconds.
- **Required:** no.
- **Purpose:** `DurationSeconds` of the `AssumeRole` call.
- **Expected value / safe range:** 900 (AWS minimum) to the role's `MaxSessionDuration` (3600 by default, up to 43200 if raised). Size it against how long a client needs to finish a download.
- **Default if omitted:** `900`
- **Failure mode:** above the role's `MaxSessionDuration` → `ValidationError: The requested DurationSeconds exceeds the MaxSessionDuration set for this role`. Too low → long downloads fail mid-transfer with 403.

### `ELASTIC_APM_ACTIVE` / `ELASTIC_APM_SERVICE_NAME` / `ELASTIC_APM_ENVIRONMENT` / `ELASTIC_APM_SERVER_URL` / `ELASTIC_APM_VERIFY_SERVER_CERT` / `ELASTIC_APM_API_KEY`

- **Type / format:** bool-ish string / string / string / URL / bool-ish string / secret string.
- **Required:** no — but see the failure mode.
- **Purpose:** consumed **directly by the `elastic-apm-node` agent**, which is preloaded before application code (`node -r elastic-apm-node/start.js ./build/server.js`, see the image `CMD`). They are *not* part of the Zod schema, so nothing validates them.
- **Expected value:** `ELASTIC_APM_ACTIVE=false` wherever no APM Server exists; otherwise the APM Server URL plus an API key with the `apm` privilege.
- **Default if omitted:** the agent is **active by default** and targets `http://127.0.0.1:8200`.
- **How to obtain:** the Elastic/observability owner issues the APM API key.
- **Failure mode:** left unset in a cluster with no APM Server → periodic `APM Server transport error … ECONNREFUSED 127.0.0.1:8200` in the logs. Harmless but noisy, and it hides real errors; set `ELASTIC_APM_ACTIVE=false` explicitly.
- **Notes:** `ELASTIC_APM_API_KEY` belongs in the Secret, never the ConfigMap.

### `DEBUG` *(test-only)*

- **Type / format:** bool-ish string, read as `process.env.DEBUG` in test helpers.
- **Required:** no.
- **Purpose:** extra diagnostics in the Jest helpers.
- **Notes:** belongs in `.env.test`; do not set in a deployment.

### `KEYCLOAK_TEST_USER_USERNAME` / `KEYCLOAK_TEST_USER_PASSWORD` *(test-only credential pair)*

- **Required:** no — required only to run the authenticated e2e tests.
- **Purpose:** direct-grant login in [src/__tests__/utils/auth.ts](../../src/__tests__/utils/auth.ts) to obtain a real token.
- **Which system the account lives in:** the Keycloak realm behind `KEYCLOAK_AUTH_URL`.
- **Privileges required:** a normal realm user holding whichever roles the tested endpoints require (see [docs/api/endpoints.md](../api/endpoints.md)); the `KEYCLOAK_CLIENT_ID` client must have **Direct Access Grants** enabled.
- **Failure mode:** absent → authenticated e2e tests skip or fail with `invalid_grant`.
- **Notes:** keep in `.env.test` only. Never ship to a cluster.

---

## 3. Extra requirements by field category — summary

### Credentials

| Pair | System | Privileges |
|---|---|---|
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | AWS IAM / MinIO / S3-compatible | object CRUD + multipart on `BUCKET_NAME`; `sts:AssumeRole` on `STS_ROLE_ARN` |
| `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY` (or `GCS_KEY_FILE`) | Google Cloud IAM | `roles/storage.objectAdmin` on the bucket; `roles/cloudkms.publicKeyViewer` if encryption is on |
| `RABBITMQ_USERNAME` / `RABBITMQ_PASSWORD` | RabbitMQ, on `RABBITMQ_VHOST` | write on `RABBITMQ_EXCHANGE` only |
| `REDIS_PASSWORD` | Redis `requirepass` / ACL | list + hash ops on `jobs:*`, `job:*` |
| `KEYCLOAK_TEST_USER_*` | Keycloak realm | ordinary user with test-relevant roles |
| `ELASTIC_APM_API_KEY` | Elastic APM | `apm` privilege |

### Feature flags

| Flag | Turns on | Then also required |
|---|---|---|
| `AUTH_ENABLED` (default on) | JWT authentication | `ISSUER_CONFIG` or `KEYCLOAK_PUBLIC_KEY` |
| `AUTHZ_ENABLED` (default on) | role + ACL authorisation | `ACL_APD_API_URL`, `CAT_API_URL` |
| `ENCRYPTION_ENABLED` (default off) | `/v1/encryption` routes | `KMS_KEY_VERSION_NAME` (or `DEV_ENCRYPTION_PUBLIC_KEY_PEM` locally) |
| `REDIS_CLUSTER_MODE` (default off) | cluster client | cluster-capable `REDIS_HOST`; `REDIS_DB` becomes meaningless |

### Domains / URLs

| Field | Scheme | Trailing slash | Must match |
|---|---|---|---|
| `KEYCLOAK_AUTH_URL` | required | no | Keycloak realm URL; the `iss` keys in `ISSUER_CONFIG` |
| `ACL_APD_API_URL` | required | **no** (paths are concatenated) | ACL-APD deployment |
| `CAT_API_URL` | required | no | catalogue deployment; the report worker's `CAT_API_URL` |
| `STORAGE_ENDPOINT` | required | no | the workers' `S3_ENDPOINT` |
| `ELASTIC_APM_SERVER_URL` | required | no | APM Server |
| `RABBITMQ_HOST` | **no scheme** | — | broker host |
| `REDIS_HOST` | **no scheme** | — | the workers' `REDIS_HOST` |

### Tuning knobs

| Field | Safe range | Size against | Symptom if wrong |
|---|---|---|---|
| `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB` | 1–1000 | bucket quota, largest expected databank | current check uses `numParts * 1 MiB`, not actual uploaded bytes; clients must also enforce the limit |
| `STS_SESSION_DURATION_IN_SECONDS` | 900 – role `MaxSessionDuration` | slowest expected client download | too low → 403 mid-download; too high → `ValidationError` at issue time |
| replicas (`infra/manifest.yaml`) | 2–6 | request volume; each replica holds its own Redis + RabbitMQ connections | see [deployments.md](./deployments.md) |
