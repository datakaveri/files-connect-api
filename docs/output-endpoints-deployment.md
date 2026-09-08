# Output endpoints: build and upgrade

These changes are based on `stable/v2.3` and extend the existing Files Connect application.
There is no separate service or alternate server entrypoint. Routes are absent unless
`OUTPUTS_ENABLED=true`. Existing databank/assets routes keep their authentication behavior.

## Build on your local machine

Fetch the feature branch in your local checkout, then run:

```bash
git fetch origin
git switch --track origin/feature/output-endpoints
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm exec jest src/__tests__/outputs/output.test.ts --runInBand

docker login ghcr.io
# Replace YOUR_ORG with a registry namespace you can push to.
IMAGE=ghcr.io/YOUR_ORG/files-connect-api:output-endpoints-v1
docker build --platform linux/amd64 -f infra/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
docker buildx imagetools inspect "$IMAGE"
```

Provide the pushed image URL and preferably its `sha256` digest. Do not reuse the live tag.
The deployment uses the existing application entrypoint in `infra/Dockerfile`; do not build
or deploy worker images for this change.

## Runtime configuration

Before enabling output routes, configure:

- `OUTPUTS_ENABLED=true`
- `OUTPUT_BUCKET=fs-prod-aae` (the existing bucket), `OUTPUT_REGION=ap-south-1`, optional HTTPS `OUTPUT_ENDPOINT`
- Production/default: `OUTPUT_STORAGE_ROLE_ARN` is an assumable role with access to the output
  bucket. The SDK's standard credential chain supplies the source identity; existing S3
  environment variable names are not automatically AWS SDK credentials.
- Demo fallback: set `OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS=true` to reuse the file server's
  existing `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` or legacy
  `S3_ACCESS_KEY`/`S3_SECRET_KEY`. This skips STS only for the output module and ignores
  `OUTPUT_STORAGE_ROLE_ARN`. Keep the flag false or unset once a restricted role is available.
- `OUTPUT_UPLOAD_SIGNING_KEY`: a random secret of at least 32 characters, shared only with
  the trusted Sandbox Connect token issuer, never the notebook or uploader.
- `OUTPUT_PUBLISH_TOKEN`: a different random secret of at least 32 characters, shared with
  the Sandbox Connect controller as its Files Connect service token.
- `OUTPUT_SANDBOX_SERVICE_TOKEN`: a third random opaque secret of at least 32 characters,
  shared only with the Sandbox Connect API. It authorizes the dedicated internal review and
  workspace read routes; it is not accepted for upload or publication.
- Demo-only uploader fallback: set `OUTPUT_ALLOW_SHARED_UPLOAD_TOKEN=true` and configure a
  separate `OUTPUT_SHARED_UPLOAD_TOKEN` while per-output JWT issuance is deferred. Put that
  token in the uploader-only `FILE_SERVICE_TOKEN` Secret. The runner container must never
  receive it. Disable and remove this token after per-output JWT issuance is available.
- `OUTPUT_REVIEW_DATABANK_ID`, `OUTPUT_WORKSPACE_DATABANK_ID`: trusted databank identifiers.
- `OUTPUT_REVIEW_BASE=nha-review`, `OUTPUT_WORKSPACE_BASE=user-workspaces` by default.
- Limits: `OUTPUT_MAX_MANIFEST_BYTES=262144`, `OUTPUT_MAX_FILES=1000`,
  `OUTPUT_MAX_FILE_BYTES=268435456`, `OUTPUT_MAX_BYTES=1073741824`.

No new bucket is created or required. Outputs use separate key prefixes in the existing
`fs-prod-aae` bucket. Object storage follows the existing databank layout: physical keys prepend `<databankId>/`
to logical keys in the API contract. Job bindings are stored below `<reviewBase>/.jobs/`.
Storage sessions automatically refresh via STS and carry an inline policy allowing GetObject
and PutObject only in these configured areas, plus prefix-constrained ListBucket for workspace
listing. Server-side copy needs GetObject on the source and PutObject on the destination. The
role's own policy must also allow these operations.

Upload bearer tokens are HS256 JWTs with issuer `sandbox-connect`, audience
`files-connect-output`, scope `output:upload`, `outputId`, `ownerId`, `notebookName`, `iat`,
and `exp`; their maximum age is one hour. The server derives prefixes from these signed claims.
A publication bearer token cannot upload, and an upload token cannot publish. The first
upload request binds the inventory immutably; subsequent requests must match.

For the demo, the shared uploader token is accepted only by the upload and completion routes.
Files Connect derives the job identity from the exact review prefix and keeps the existing
immutable inventory, output-ID, path, checksum, type, size, and manifest checks. The dedicated
workspace routes expose only files referenced by a completed publication manifest, so partially
copied or unrelated objects stay hidden. Generic databank routes retain their existing behavior.

Sandbox-only internal routes (all require `OUTPUT_SANDBOX_SERVICE_TOKEN`) are:

- `GET /v1/outputs/internal/review/{outputId}/files/{fileId}/preview`
- `GET /v1/outputs/internal/workspaces/{ownerId}/files`
- `GET /v1/outputs/internal/workspaces/{ownerId}/files/{fileId}/preview`
- `GET /v1/outputs/internal/workspaces/{ownerId}/files/{fileId}/download`

## Upgrade and rollback

Upgrade the existing `sandbox/files-connect-api-server` Deployment after the image is supplied.
First refresh a Deployment snapshot and record its image/digest and rollout revision. Save
any configuration being changed separately; Deployment rollback does not revert Secret data.
Use a new dedicated Secret for output configuration so the existing Secret remains intact.
Verify health, the existing API routes, and the output contract after rollout.

The current baseline snapshot is at:
`/home/ubuntu/deployment-backups/files-connect-api/deployment-before-output-endpoints.json`.
At capture time the deployment revision was 6 and its image was
`ghcr.io/datakaveri/file-connect-api-minio:1.0.1-2ad6813`.

Immediate deployment rollback (refresh the revision before deployment):

```bash
kubectl -n sandbox rollout undo deployment/files-connect-api-server --to-revision=6
kubectl -n sandbox rollout status deployment/files-connect-api-server --timeout=180s
```

Retain any new output Secret and storage objects until rollback is validated. Rolling back
application code does not delete completed CSVs or manifests. Do not reapply unrelated Helm
values or worker manifests when updating this API deployment.
