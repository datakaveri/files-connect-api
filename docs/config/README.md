# Configuration Reference — files-connect-api

Configuration documentation for every deployable unit in `stable/v2.3`.

Unlike the Java/vert.x services in the platform, **none of these services use a `config.json`**.
All three are configured entirely through **environment variables**, supplied by:

| Environment | Source of values |
|---|---|
| Local dev | `.env` at repo root (copied from [.env.example](../../.env.example)); Docker Compose passes a subset into the worker containers |
| Kubernetes | Private copies of [infra/configmap.yaml](../../infra/configmap.yaml) (non-secret example) + [infra/secret.example.yaml](../../infra/secret.example.yaml) (Secret template), consumed via `envFrom` / `valueFrom`. Populated `infra/secret.yaml` is ignored. |

## Documents

| Document | Unit | Runtime | Image |
|---|---|---|---|
| [file-server.md](./file-server.md) | File server (`files-connect-api`) | Node 24 / Express / TypeScript | `ghcr.io/datakaveri/tgdex-file-connect-api` |
| [zip-worker.md](./zip-worker.md) | Zip worker | Python 3.11 | built from [workers/zip-worker/Dockerfile](../../workers/zip-worker/Dockerfile) |
| [report-worker.md](./report-worker.md) | Report (data-readiness) worker | Python 3.11 | built from [workers/report-worker/Dockerfile.worker](../../workers/report-worker/Dockerfile.worker) |
| [deployments.md](./deployments.md) | All deployment manifests | Kubernetes + Docker Compose | — |

## 0. Document header (applies to all three documents)

| | |
|---|---|
| **Repo** | `datakaveri/files-connect-api` |
| **Branch documented** | `stable/v2.3` |
| **Config templates** | `.env.example`, `infra/configmap.yaml`, `infra/secret.example.yaml`, `docker-compose.yml` |
| **Config schema version** | There is no `version` field. The file server validates its environment with a Zod schema in [src/config/environment.ts](../../src/config/environment.ts); the workers read `os.environ` directly. |
| **Maintainer / point of contact** | Repository maintainers |
| **Last updated** | 2026-09-16 |

## Architecture in one paragraph

The **file server** is the only externally reachable component. It authenticates requests (Keycloak
/ multi-IDP JWT), authorises them against the ACL-APD and Catalogue services, reads and writes
objects in S3 / MinIO / GCS, emits audit events to RabbitMQ, and **enqueues long-running jobs into
Redis lists**. The **zip worker** blocks on `BRPOP jobs:zip` and produces `zips/<databankId>.zip` in
the same bucket. The **report worker** blocks on `BRPOP jobs:report`, downloads the databank,
scores it with the data-readiness framework (structured OpenAI inference is currently disabled;
unstructured metadata inference is active), writes the PDF/JSON
report to `reports/<databankId>/`, and updates the catalogue's Elasticsearch document with the score.
No worker is reachable from outside the cluster and no worker talks back to the file server.

```
client ──► file server ──► S3/MinIO/GCS bucket
                │              ▲        ▲
                ├─► RabbitMQ   │        │
                │   (audit)    │        │
                └─► Redis ─────┴──► zip worker (BRPOP jobs:zip)
                          └──► report worker (BRPOP jobs:report) ──► Elasticsearch (tgdex__cat)
```

## Values that MUST match across services

Getting any of these out of sync produces jobs that are enqueued but never picked up, or workers
that write to the wrong bucket. Each row is cross-referenced in both field blocks.

| Value | File server | Zip worker | Report worker | Notes |
|---|---|---|---|---|
| Zip queue name | `ZIP_QUEUE_NAME` | `ZIP_QUEUE_NAME` | — | Must be byte-identical; default `jobs:zip` |
| Report queue name | `REPORT_QUEUE_NAME` | — | `REPORT_QUEUE_NAME` | Default `jobs:report`; legacy alias `READINESS_QUEUE_NAME` |
| Redis endpoint | `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | same | same | Same **logical database** too — job status hashes are written by the file server and updated by the workers |
| Bucket | `BUCKET_NAME` | `BUCKET_NAME` | `BUCKET_NAME` | Single bucket for uploads, `zips/`, and `reports/` |
| Storage provider | `STORAGE_PROVIDER` | `STORAGE_PROVIDER` | `STORAGE_PROVIDER` | `s3` \| `minio` \| `gcs` |
| Storage endpoint | `STORAGE_ENDPOINT` | `S3_ENDPOINT` | `S3_ENDPOINT` | **Different variable names for the same value** — the workers never read `STORAGE_*` |
| Storage credentials | `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Same key pair, different names; the k8s manifests already remap them |
| TLS on storage | `STORAGE_USE_SSL` | `USE_SSL` | `USE_SSL` | Again renamed |
| Catalogue REST API | `CAT_API_URL` | — | `CAT_API_URL` | Item lookup: `{base}/item?id=…` |
| Catalogue ES index | — | `CAT_URL` (**Elasticsearch base URL**, not the REST API) | `ELASTICSEARCH_URL` + `ELASTIC_CAT_INDEX` | See the warning in both worker docs |

## Deprecated / dead fields (removed from the example and infra files)

Verified by grepping the whole source tree. These were declared in config but **never read by any
code path**:

| Field | Where it was | Why it is dead |
|---|---|---|
| `ZIP_LAMBDA_URL` | `.env.example`, `configmap.yaml` | Declared in the Zod schema but never referenced. Zip processing moved from AWS Lambda to the Redis-queue zip worker. |
| `REPORTS_LAMBDA_URL` | `.env.example`, `configmap.yaml` | Same; replaced by the report worker. |
| `LAMBDA_ACCESS_KEY` / `LAMBDA_SECRET_KEY` | `.env.example`, `secret.yaml` | Same. |
| `LAMBDA_REGION` | `.env.example`, `configmap.yaml` | Same. |
| `KEYCLOAK_REALM` | `.env.example`, `configmap.yaml` | Declared optional in the schema, never read. The realm is implicit in `KEYCLOAK_AUTH_URL` and in the `iss` keys of `ISSUER_CONFIG`. |

They remain declared (and optional) in `src/config/environment.ts` so that any deployment still
setting them keeps starting; removing the schema entries is a separate code change.
