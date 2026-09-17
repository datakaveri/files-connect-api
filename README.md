# Files Connect API

A TypeScript/Express service for databank file uploads, downloads, previews, and background
processing. The API supports AWS S3, MinIO, and native Google Cloud Storage (GCS), with Python
workers for ZIP archives and data-readiness reports.

This README documents the current stable release branch, `stable/v2.3`.

## Features

- Direct-to-storage multipart uploads with presigned part URLs, completion, and cancellation.
- Databank and asset file operations, metadata, and previews for supported formats.
- JWT verification through Keycloak-compatible static RS256 keys or multiple JWKS issuers,
  role-based authorization, and Catalogue/ACL-APD access checks.
- Redis-backed asynchronous jobs: `zip`, `report`, or `all` (one job of each type).
- Time-limited AWS/MinIO STS credentials; GCS clients use presigned URLs instead.
- Optional Cloud KMS public-key delivery for client-side envelope encryption.
- OpenAPI documentation rendered with ReDoc.

File-extension validation is an allow-list, not malware scanning. See the
[endpoint reference](docs/api/endpoints.md) for actual per-route access checks and limitations.

## Architecture

The API reads and writes object storage, checks access through the identity, Catalogue, and
ACL-APD services, and publishes audit events to RabbitMQ. It enqueues long-running work in Redis;
the ZIP and report workers consume those queues and write outputs to the same storage bucket.
Report writeback to Elasticsearch is optional.

One `BUCKET_NAME` holds databank files (`{databankId}/`), assets (`assets/`), archives (`zips/`),
and reports (`reports/`). The API and workers must use the same bucket, Redis database, and
queue names. See the [configuration overview](docs/config/README.md) for the full wiring.

## Prerequisites

- Node.js 24 (matching [the API container image](infra/Dockerfile)).
- pnpm 10.20.0 (the version declared in `package.json`); TypeScript is installed as a dependency.
- Docker with the Compose plugin for local MinIO, Redis, and workers.
- Python 3.11 if running workers outside Docker.
- Your identity provider, Catalogue, ACL-APD, and RabbitMQ services when testing their integrations.
  They are not provisioned by the default Compose file.

## Local quick start

```bash
git clone --branch stable/v2.3 https://github.com/datakaveri/files-connect-api.git
cd files-connect-api
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit the private `.env` for your environment. It defaults to local MinIO, with authentication
and authorization disabled **only for isolated development**. Its public `minioadmin` and
`guest` credentials must never be reused for deployed services.

Start storage, Redis, and the ZIP worker:

```bash
docker compose up -d minio redis zip-worker
```

The MinIO console is at `http://localhost:9001` and its API is at `http://localhost:9000`.
The local MinIO username and password are both `minioadmin`. Redis is at `localhost:6379`;
the development Redis instance has no authentication. Ports are bound to localhost only.
Create the bucket named in `.env` (`files-connect-local` by default) using the MinIO console
before uploading files; the default Compose setup does not initialize buckets.

Run the API on the host in a separate terminal:

```bash
pnpm dev
```

The default Compose file does **not** start the API: its API service is commented out. The
environment schema still requires valid integration settings even with auth disabled; operations
that depend on Catalogue, ACL-APD, or audit delivery need those services to be reachable.

For report jobs, configure the Catalogue endpoint and any optional Elasticsearch writeback,
then start the report worker:

```bash
docker compose up -d report-worker
docker compose logs -f report-worker
```

In this branch, structured column-role inference is disabled; unstructured metadata inference
still calls OpenAI and needs a private `OPENAI_API_KEY`. Confirm that your data-sharing policy
permits metadata to leave your environment before enabling that path.

After worker code changes, rebuild the affected service with
`docker compose up -d --build zip-worker` or `docker compose up -d --build report-worker`.
For private overrides, copy `docker-compose.override.example.yml` to the ignored
`docker-compose.override.yml` and customize it there.

## Storage and configuration

- `STORAGE_PROVIDER=minio`: local or S3-compatible MinIO, using the `STORAGE_*` credentials.
- `STORAGE_PROVIDER=s3`: AWS S3, with the appropriate endpoint, region, and credentials.
- `STORAGE_PROVIDER=gcs`: native GCS clients in the API and workers. Prefer Application Default
  Credentials/workload identity; key-file or inline service-account credentials are also supported.
  `/query-access` is not available for GCS.

Keep `STORAGE_*` (API) and `S3_*` (workers) aligned in local configuration. Kubernetes worker
manifests remap these names. GCS multipart uploads stage temporary objects and compose them
on completion; see [multipart uploads](docs/api/multipart-uploads.md) for provider differences
and current size-validation limits.

Use [.env.example](.env.example) as a template and the
[configuration reference](docs/config/README.md) for required fields, privileges, and failure modes.
Never commit `.env` variants, private keys, service-account files, populated Kubernetes Secrets,
or exported Postman credentials.

## Development and tests

```bash
pnpm build       # compile TypeScript to build/
pnpm start       # start the compiled API (includes the Elastic APM agent)
pnpm lint
pnpm test
pnpm openapi     # rebuild and regenerate openapi.json
```

Disable APM with `ELASTIC_APM_ACTIVE=false` unless you have configured an APM server.
Authenticated end-to-end tests require a private `.env.test`, including test-user credentials
and a `KEYCLOAK_AUTH_URL` pointing to the complete token endpoint, plus reachable integrations.
Run isolated tests with `pnpm test -- --runInBand src/__tests__/core src/__tests__/middleware`.

Worker tests can be run from `workers/report-worker` after installing its requirements and pytest:

```bash
python -m pytest tests
```

Only a [synthetic example dataset](workers/report-worker/data/example/README.md) is committed.
Additional local datasets and generated `outputReports/` content are ignored.

## Documentation

- [Documentation index](docs/README.md)
- [API endpoints and access checks](docs/api/endpoints.md)
- [Multipart upload lifecycle](docs/api/multipart-uploads.md)
- [Configuration reference](docs/config/README.md)
- [Container builds and Kubernetes setup](infra/README.md)
- [AWS STS setup](infra/STS_SETUP.md)
- [Worker overview](workers/README.md)
- [Postman examples](postman/README.md)

On a running API, browse `http://localhost:3000/apis`; the machine-readable specification is
at `http://localhost:3000/openapi.json`. API routes are under `/v1`, including `/v1/health`.

## Deployment and security

The Kubernetes manifests are **examples**, not ready-to-apply production configuration. Copy
and customize them as described in [the infrastructure guide](infra/README.md). Set unique
credentials, enable `AUTH_ENABLED=true` and `AUTHZ_ENABLED=true`, configure trusted issuers
and token audiences, enforce TLS and an explicit CORS allow-list, and keep Redis/MinIO private.
Do not disable token-expiry or certificate validation in deployed environments.

Some routes, including file metadata and report PDF download, are public in the current
implementation. Review [the endpoint reference](docs/api/endpoints.md) against your access policy
before exposing the service. Do not post passwords, JWTs, presigned URLs, or private datasets in
issues, logs, or screenshots; contact organization maintainers privately for sensitive findings.

## Contributing

Base changes on `stable/v2.3` for this release line. Submit a pull request describing the change
and its validation, keep configuration/API docs synchronized, and regenerate `openapi.json` when
the API documentation changes. Use synthetic fixtures and never include live credentials in tests.

## License

[View License](./LICENSE)

The root license is GNU AGPL v3, following
[dx-controlplane](https://github.com/datakaveri/dx-controlplane/blob/main/LICENSE).
OpenAPI metadata retains its Apache 2.0 declaration, matching the reference repository.
See [dependency licenses](./dep-licenses) for the direct-dependency inventory and its scope.
