# API Endpoint Reference

Every endpoint, the roles that may call it, the auth checks that run, and the behaviour worth
knowing. Verified against the route definitions in [src/routes/](../../src/routes/).

Consolidates what used to live in `API.md`, `API_ROLES.md` and `ENDPOINT_AUTH.md`.

- **Base path:** `/v1` — mounted in [src/routes/index.ts](../../src/routes/index.ts); path segments come from `ApiPaths` in [src/config/constants.ts](../../src/config/constants.ts).
- **Machine-readable spec:** [openapi.json](../../openapi.json); browsable at `/apis` (ReDoc) and `/openapi.json` on a running server.
- **Roles:** `provider`, `consumer`, `cos_admin` — read from the JWT's `realm_access.roles` claim. See [docs/config/file-server.md](../config/file-server.md#keycloak_client_id) for the token requirements.
- **Response envelopes:** success `{ "success": true, "data": {…} }`, error `{ "success": false, "error": { "message", "code" } }`. Invalid/expired token → 401; insufficient role or failed access check → 403.

## Auth middleware

Applied in the order listed in each table ([src/middleware/auth.ts](../../src/middleware/auth.ts)).

| Middleware | What it does |
|---|---|
| **authenticate** | Validates `Authorization: Bearer <JWT>` (multi-IDP JWKS via `ISSUER_CONFIG`, else the static `KEYCLOAK_PUBLIC_KEY`), extracts `userId` and roles into `res.locals`. |
| **authorize(roles)** | Requires at least one of the given roles. For non-asset routes it also calls `checkDatabankAccess()`, which **currently always returns `hasAccess: true`** — real enforcement is the checks below. |
| **checkItemAccess** | Reads the databank's `accessPolicy` from the Catalogue. `OPEN` → allow; otherwise continues without denying. |
| **checkItemAccessWithDatabankAccess** | Same Catalogue lookup; if the databank is not public, runs **databankAccess**. |
| **databankAccess** | Calls ACL-APD `has_access` with the user's token; on deny or failure falls back to **checkIsOwner**. |
| **checkIsOwner** | Compares the Catalogue's `ownerUserId` with `res.locals.userId`; allows only on an exact match. |

Both layers can be switched off with `AUTH_ENABLED=false` / `AUTHZ_ENABLED=false`, which makes the
affected routes effectively public — local development only.

## Endpoints

### Health

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| GET | `/v1/health` | — | none | Liveness/readiness probe target. |

### Databank files

All under `/v1/databanks/:databankId`.

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| POST | `.../files` | provider, consumer | authenticate → authorize → checkItemAccess | Lists files; supports recursive listing of subdirectories. |
| POST | `.../files/download` | provider, consumer | authenticate → authorize → checkItemAccessWithDatabankAccess | Returns a presigned download URL. |
| POST | `.../files/metadata` | — | **none (public)** | Size, lastModified, contentType, etag. |
| POST | `.../files/delete` | provider, consumer **(owner only)** | authenticate → authorize → checkIsOwner | The owner check makes this effectively owner-only regardless of role. |
| POST | `.../files/preview` | provider, consumer | authenticate → authorize → checkItemAccess | Supports CSV, JSON, GeoJSON, XML, XLSX and Parquet. |

### Databank uploads

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| POST | `.../uploads` | provider **(owner only)** | authenticate → authorize → checkIsOwner | Initiates a multipart upload and returns presigned part URLs. |
| PUT | `.../uploads/:uploadId` | provider **(owner only)** | authenticate → authorize → checkIsOwner | Completes the upload with the part ETags. |
| POST | `.../uploads/:uploadId/cancel` | provider **(owner only)** | authenticate → authorize → checkIsOwner | Aborts the multipart upload. |

Accepted upload formats include CSV, JSON, GeoJSON, TXT, Parquet, XLSX, NAV, OBS, BIN and MRK;
executables are rejected (415). The client uploads each part directly to object storage and returns
the storage-issued ETags when completing the upload. See
[Databank Multipart Uploads](./multipart-uploads.md) for the full request flow, the chunk-size rules
used by both supplied Python clients, provider differences, cancellation, and the current limitation
of the `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB` check.

### Processing jobs

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| POST | `.../process` | provider | authenticate → authorize | Creates a job; responds `202`. |
| GET | `.../process/:jobId` | provider | authenticate → authorize | Poll for job status. |
| PUT | `.../process/:jobId/status` | provider | authenticate → authorize | Worker/callback status update. |

`type` is `zip`, `report`, or `all`. For `all` the API creates **two** jobs and returns
`jobIds.zip` and `jobIds.report`; poll each separately. Jobs are pushed to Redis and consumed by the
Python workers — see [docs/config/README.md](../config/README.md) for the queue wiring.

For zip jobs, `options.include` restricts the archive to selected databank-relative paths; omit it to
zip everything:

```json
{
  "type": "zip",
  "prefix": "",
  "options": { "include": ["kvk.json", "folder/file.csv"] }
}
```

### Downloads and temporary access

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| GET | `.../download` | provider, consumer | authenticate → authorize → checkItemAccessWithDatabankAccess | Presigned URL for the databank zip (`zips/{databankId}.zip`). |
| GET | `.../report/download` | provider, consumer | authenticate → authorize → checkItemAccessWithDatabankAccess | Presigned URL for `reports/{databankId}/data_readiness_report.pdf`. |
| GET | `.../query-access` | provider, consumer | authenticate → authorize → checkItemAccessWithDatabankAccess | Temporary STS credentials scoped to the databank, for direct bucket access without proxying. Time-limited by `STS_SESSION_DURATION_IN_SECONDS` (default 15 min). **Returns 400 when `STORAGE_PROVIDER=gcs`** — GCS has no AssumeRole equivalent; use the presigned-URL endpoints instead. |

### Assets

Base path `/v1/assets`; the router applies **authenticate** to every asset route.

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| POST | `/v1/assets` | provider, consumer, cos_admin | authenticate → authorize | Upload a PDF or image (multipart/form-data). |
| POST | `/v1/assets/download` | provider **(self-key)**, cos_admin | authenticate → authorize → in-handler owner check | Non-admins may only fetch assets whose key starts with their own `userId`. |

### Encryption (TANUH deployments only)

Mounted **only when `ENCRYPTION_ENABLED=true`**; otherwise the path 404s.

| Method | Path | Roles | Auth checks | Notes |
|---|---|---|---|---|
| GET | `/v1/encryption/public-key` | provider | authenticate → authorize | Returns `{ publicKeyPem, kmsKeyVersion, algorithm }` for client-side DEK wrapping. 503 if neither `KMS_KEY_VERSION_NAME` nor `DEV_ENCRYPTION_PUBLIC_KEY_PEM` is configured. |

## Role summary

| | provider | consumer | cos_admin |
|---|---|---|---|
| List / download / preview files | ✔ | ✔ | ✔ (via token roles) |
| Delete file | owner only | owner only | owner only |
| Multipart uploads | owner only | — | owner only |
| Processing jobs | ✔ | — | ✔ |
| Databank / report download, query-access | ✔ | ✔ | ✔ |
| Asset upload | ✔ | ✔ | ✔ |
| Asset download | self-key only | — | ✔ |
| Encryption public key | ✔ | — | — |

Fine-grained, per-databank access is **not** a role question — it is resolved per request against the
Catalogue (`CAT_API_URL`) and ACL-APD (`ACL_APD_API_URL`).
