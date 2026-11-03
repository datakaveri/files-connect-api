# Files Connect API Postman workspace

This directory contains a Postman collection generated from the current route implementations in
`src/routes`, the Zod request validators in `src/core/validators/schemas.ts`, and `openapi.json`.

## Files

- `files-connect-api.postman_collection.json` - all API requests, a Keycloak token helper, tests,
  and a one-part multipart-upload workflow.
- `development.postman_environment.json` - localhost example with empty identity and generated state.

The environment file contains only localhost/example values. It does not copy secrets from `.env`.
Keep the committed template unchanged: save private exports as
`postman/development.local.postman_environment.json` (ignored by Git and Docker).

## Import and configure

1. In Postman, select **Import** and import the collection plus the development environment.
2. Select the development environment in the environment picker.
3. Set `baseUrl` to your own API (no trailing slash) and `databankId` to a databank available to you.
4. Authenticate in either of these ways:
   - Paste a JWT into the secret `accessToken` environment variable; or
   - Set `keycloakTokenUrl`, `keycloakClientId`, `username`, and `password`, then send
     **Authentication / Obtain access token**. Its test script saves `access_token` into
     `accessToken`.
5. Adjust `fileKey`, `uploadKey`, and `assetKey` for requests that operate on existing objects.

`keycloakTokenUrl` must be the complete OpenID Connect token endpoint, normally
`https://<host>/realms/<realm>/protocol/openid-connect/token` (or the equivalent `/auth/realms/...`
path on older Keycloak installations). Direct Access Grants must be enabled for password login.

## Authentication and access

The collection inherits `Authorization: Bearer {{accessToken}}`. Public routes explicitly override
that setting with **No Auth**.

| Area | Required role/access |
|---|---|
| File list, download, preview | `provider` or `consumer`, plus applicable databank access |
| File metadata | Public |
| File delete | `provider` or `consumer`, databank owner only |
| Multipart upload | `provider`, databank owner only |
| Processing jobs | `provider` |
| Query access and databank ZIP download | `provider` or `consumer`, plus databank access |
| Report PDF download | Public in the current route implementation |
| Asset upload | `provider`, `consumer`, or `cos_admin` |
| Asset download | `provider` for its own key, or `cos_admin` |
| Encryption public key | `provider`; route exists only when encryption is enabled |

If local development uses `AUTH_ENABLED=false`, protected requests can run without a token. The
Bearer header is still harmless, but clearing `accessToken` makes that setup clearer.

## Multipart upload workflow

Run these requests in order:

1. **Databank uploads / 1. Initiate one-part upload**. The test script stores `uploadId` and the first
   presigned URL.
2. **Databank uploads / 2. Upload part 1 to presigned URL**. Select a file for the binary body if
   Postman does not resolve `uploadPartFilePath`. The test script stores the response `ETag`.
3. **Databank uploads / 3. Complete multipart upload**.

The example intentionally uses one part. For multiple parts, change `numParts`, add one PUT per
returned URL, and include every `{ partNumber, eTag }` pair in the completion request. Use
**Cancel multipart upload** instead of completing when you want to abort it.

## Files and generated variables

- `assetFilePath` is used by the multipart/form-data asset request. Postman may require selecting the
  file interactively, especially in the web client.
- `uploadPartFilePath` is used as the binary body sent to the presigned part URL.
- Successful asset upload stores the returned key in `assetKey`.
- Successful job creation stores its job ID in `jobId`. For `type: all`, it stores the ZIP job ID;
  the response also contains the report job ID.
- Presigned download URLs and temporary credentials expire; rerun their API requests when needed.

## Running with Newman

Install Newman separately, then run non-file requests with an environment:

```bash
newman run postman/files-connect-api.postman_collection.json \
  -e postman/development.local.postman_environment.json
```

Export your private environment locally first. Keep tokens in the private file, not command-line
arguments that may enter shell history/process listings. File uploads require local file paths
and Newman file access. Add `--working-dir` as needed. Avoid
putting real tokens, passwords, local paths, asset keys, upload IDs, or ETags into committed files.

## API notes

- The API base is `{{baseUrl}}/v1`; `baseUrl` must not end with `/`.
- Direct file download returns binary content when `presigned` is `false`. The supplied request uses
  `true` so its response remains inspectable in Postman.
- `query-access` is unavailable with `STORAGE_PROVIDER=gcs` because GCS has no STS AssumeRole
  equivalent.
- Asset uploads are limited to 5 MiB by the current middleware, despite its legacy error text saying
  10 MiB. The route currently accepts PDF and image MIME types.
- Preview types accepted by the current validator are `csv`, `json`, `xml`, `tsv`, `xlsx`, and
  `parquet`.
- API documentation is served at `{{baseUrl}}/apis`; the OpenAPI document is at
  `{{baseUrl}}/openapi.json`.
