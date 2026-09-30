# Documentation Index

| Document | What it covers |
|---|---|
| [api/endpoints.md](./api/endpoints.md) | Every endpoint: roles, auth-check order, request/response behaviour |
| [api/multipart-uploads.md](./api/multipart-uploads.md) | Databank upload lifecycle, client chunk sizes, provider behavior, and known limits |
| [config/README.md](./config/README.md) | Configuration overview, architecture, values that must match across services |
| [config/file-server.md](./config/file-server.md) | Every environment variable of the Node API |
| [config/zip-worker.md](./config/zip-worker.md) | Every environment variable of the zip worker |
| [config/report-worker.md](./config/report-worker.md) | Every environment variable of the report (data-readiness) worker |
| [config/deployments.md](./config/deployments.md) | Kubernetes/Compose manifests, how config reaches each container, scaling |

## Elsewhere in the repo

| Document | What it covers |
|---|---|
| [../README.md](../README.md) | Project overview, local setup, quick-start configuration |
| [../openapi.json](../openapi.json) | Machine-readable API spec (served at `/openapi.json`, rendered at `/apis`) |
| [../infra/README.md](../infra/README.md) | Image build and `kubectl apply` procedure |
| [../infra/STS_SETUP.md](../infra/STS_SETUP.md) | AWS STS role and trust policy for temporary access |
| [../workers/README.md](../workers/README.md) | Job-queue architecture shared by both workers |
| [../workers/zip-worker/ARCHITECTURE.md](../workers/zip-worker/ARCHITECTURE.md) | Zip worker internals |
| [../workers/report-worker/README.md](../workers/report-worker/README.md) | Report worker quick start and module map |
| [../workers/report-worker/ARCHITECTURE.md](../workers/report-worker/ARCHITECTURE.md) | Report worker internals: pipeline, metrics, scoring, output formats |
| [../workers/report-worker/DEPLOYMENT.md](../workers/report-worker/DEPLOYMENT.md) | Report worker build, deploy, verification and troubleshooting runbook |
| [../postman/README.md](../postman/README.md) | Local Postman example and private environment setup |
| [../workers/report-worker/data/example/README.md](../workers/report-worker/data/example/README.md) | Synthetic local dataset and safe tester |

## Conventions

- Configuration questions ("what does this variable do, what breaks without it") belong in
  `docs/config/`. Worker docs link there instead of repeating variable lists, so there is one place
  to update when configuration changes.
- API contract questions belong in `docs/api/endpoints.md` and `openapi.json`; multipart lifecycle
  and client chunking details belong in `docs/api/multipart-uploads.md`.
- Internals — pipelines, metrics, data flow — belong next to the code they describe, under
  `workers/<worker>/`.
