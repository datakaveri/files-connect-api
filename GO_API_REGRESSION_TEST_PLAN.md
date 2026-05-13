# Go API Regression Test Plan

This plan validates the Go rewrite against the current Files Connect API behavior. The main contract sources in this checkout are `API.md`, `ENDPOINT_AUTH.md`, `openapi.json`, and the existing route/validator code under `src/`.

## Scope

Validate these API areas end to end against a real running Go service:

- Health and public routes
- JWT authentication and role authorization
- Databank file listing, metadata, preview, delete, and download
- Multipart databank uploads using presigned part URLs
- Asset upload and asset presigned download
- Processing jobs for `zip`, `report`, and `all`
- Databank zip/report download URLs
- Temporary query access credentials
- Error response shape and HTTP status parity

## Test Environments

Use the same collection against each environment by changing `baseUrl`.

| Environment | Example `baseUrl` |
| --- | --- |
| Local Go | `http://localhost:8080/v1` |
| Local old Node parity service | `http://localhost:3000/v1` |
| Dev | `https://v2.dev.file-s3.iudx.io/v1` |
| Staging | `https://staging.file.forestdx.iudx.io/v1` |
| Production | `https://files.forest-stack.digivan.forest.rajasthan.gov.in/v1` |

For local testing, prefer MinIO + Redis + workers so storage, presigned URLs, and jobs are exercised rather than only mocked.

## Required Test Data

Prepare the following before running the collection:

- `providerToken`: JWT with `provider` role and ownership of `databankId`.
- `consumerToken`: JWT with `consumer` role and access to `databankId`.
- `adminToken`: JWT with `cos_admin` role, mainly for asset checks.
- `databankId`: an existing databank/item ID in catalogue.
- `fileKey`: an existing file under the databank, for example `sample.csv`.
- `missingFileKey`: a file that does not exist, for example `missing-do-not-create.csv`.
- `assetFilePath`: a local PDF or image file for Postman asset upload.
- External services: object storage bucket, catalogue API, ACL/APD API, Redis, worker/lambda URLs if job execution is expected.

## Baseline API Expectations

All JSON success responses should use:

```json
{
  "success": true,
  "data": {}
}
```

All JSON error responses should use:

```json
{
  "success": false,
  "error": {
    "message": "string",
    "code": "string"
  }
}
```

Expected auth behavior:

| Route group | Provider | Consumer | No token |
| --- | --- | --- | --- |
| `GET /health` | 200 | 200 | 200 |
| `POST /databanks/:id/files/metadata` | 200/404 | 200/404 | 200/404 |
| List/download/preview files | 200/404 | 200/404 | 401 |
| Delete file | owner only | owner only | 401 |
| Multipart uploads | owner provider only | 403 | 401 |
| Process jobs | provider only | 403 | 401 |
| Query access/download zip | 200/404 | 200/404 | 401 |
| Asset upload | provider/consumer/admin | provider/consumer/admin | 401 |
| Asset download | provider self-key/admin | 403 for consumer | 401 |

Important parity note: the old TypeScript documentation says `GET /databanks/:id/report/download` requires auth, but the checked-in route implementation does not attach auth middleware. Decide whether the Go port should preserve that current behavior or enforce the documented rule, then lock it with a test.

## Walkthrough With Actual APIs

1. Import `postman/files-connect-api-golang-regression.postman_collection.json`.
2. Import `postman/files-connect-api-local.postman_environment.json`.
3. Select the imported environment and set:
   - `baseUrl`
   - `providerToken`
   - `consumerToken`
   - `adminToken`
   - `databankId`
   - `fileKey`
   - `assetFilePath`
4. Run folder `00 Smoke and Public`.
   - Health must return 200.
   - Metadata without auth should return 200 for an existing key or 404 for a missing key.
5. Run folder `01 Auth and Validation`.
   - Protected routes without a token should return 401.
   - Consumer attempts on provider-only endpoints should return 403.
   - Bad payloads should return 400.
6. Run folder `02 Databank Files`.
   - List files non-recursively and recursively.
   - Generate metadata and preview.
   - Generate a presigned download URL.
   - Test missing file behavior returns 404.
7. Run folder `03 Multipart Upload`.
   - Initiate an upload for `postman-regression.csv`.
   - Use the returned `part1PresignedUrl` to upload the part directly to storage.
   - Complete the upload with the returned `ETag`.
   - Confirm the uploaded key appears in file listing/metadata.
   - Run unsupported media type check and expect 415 for executable-style filenames.
8. Run folder `04 Processing Jobs`.
   - Create a `zip` job and capture `jobId`.
   - Poll `GET /process/:jobId`.
   - Update job status only if this callback endpoint is intentionally exposed in the Go port.
   - Create an `all` job and verify both `jobIds.zip` and `jobIds.report` are returned.
9. Run folder `05 Access and Downloads`.
   - Query temporary credentials.
   - Request databank zip URL.
   - Request report PDF URL.
10. Run folder `06 Assets`.
   - Upload a PDF/image asset.
   - Use the returned asset key to request a presigned URL.
   - Confirm consumer asset download is forbidden.

Optional Newman run:

```bash
newman run postman/files-connect-api-golang-regression.postman_collection.json \
  -e postman/files-connect-api-local.postman_environment.json \
  --env-var "baseUrl=http://localhost:8080/v1" \
  --env-var "providerToken=$PROVIDER_TOKEN" \
  --env-var "consumerToken=$CONSUMER_TOKEN" \
  --env-var "databankId=$DATABANK_ID" \
  --env-var "fileKey=$FILE_KEY"
```

## Go-Specific Checks

Run these in CI in addition to Postman/Newman:

```bash
go test ./...
go test -race ./...
go vet ./...
gofmt -w .
```

Recommended Go test layers:

- Handler unit tests using `httptest` for auth failures, validation failures, and response envelopes.
- Service tests with a fake storage implementation for list/download/metadata/preview/delete behavior.
- Integration tests against MinIO for presigned upload/download parity.
- Integration tests against Redis for processing job state.
- Contract tests that compare the Go route list and generated OpenAPI spec with this API contract.

## Regression Matrix

| Area | Happy path | Negative cases |
| --- | --- | --- |
| Health | 200 with `status: ok` | Wrong path returns 404 |
| Auth | valid provider/consumer accepted | missing token 401, invalid token 401, wrong role 403 |
| List files | files/directories envelope | invalid `maxKeys`, inaccessible databank |
| Metadata | size, lastModified, contentType, etag | missing `key` 400, missing object 404 |
| Preview | CSV/JSON/XLSX/Parquet preview | unsupported type 400, missing object 404 |
| Download | presigned URL and expiry | missing object 404, no access 403 |
| Multipart upload | initiate, upload part, complete | bad `numParts` 400, bad extension 415, missing uploadId 400 |
| Delete | owner can delete | no token 401, non-owner 403 |
| Processing | 202 job created, status read | invalid type 400, consumer 403, unknown job 404 |
| Query access | temp credentials returned | STS not configured or denied access |
| Databank zip/report | presigned URL returned | artifact not generated 404 |
| Assets | upload PDF/image, download URL | bad file type 400, consumer download 403, non-owner key 403 |

## Pass Criteria

- All Postman requests pass for local Go with real dependencies.
- For every endpoint, Go status codes and response envelopes match the accepted current behavior.
- No unexpected 500 responses appear during normal negative testing.
- Multipart upload produces an object that can be listed, inspected, previewed/downloaded, and optionally deleted.
- Processing job creation and status APIs behave consistently for `zip`, `report`, and `all`.
- Any intentional deviations from the old Node behavior are documented and have explicit tests.
