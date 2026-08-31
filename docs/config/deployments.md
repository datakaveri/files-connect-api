# Deployments — Inventory, Wiring and Cleanup Notes

Companion to the three field references. This document covers **where** configuration is delivered
(Kubernetes manifests, Docker Compose), how values flow between objects, and what was changed in the
cleanup that accompanies this documentation.

## 1. Deployable units

| Unit | Manifest | Namespace | Replicas | Exposed |
|---|---|---|---|---|
| File server | [infra/manifest.yaml](../../infra/manifest.yaml) | `sandbox` | 4 | via Service `files-connect-api-service` (80 → 3000) + Ingress |
| Zip worker | [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml) | `sandbox` | 2 (HPA 2→10) | no |
| Report worker | [infra/report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml) | `sandbox` | 4 (HPA 4→12) | no |
| Redis (job queue) | [infra/redis-deployment.yaml](../../infra/redis-deployment.yaml) + [infra/redis-service.yaml](../../infra/redis-service.yaml) | `sandbox` | 1 StatefulSet + 5 Gi PVC | in-cluster only |
| Ingress | [infra/ingress.yaml](../../infra/ingress.yaml) | `sandbox` | — | `files.tgdex.telangana.gov.in`, TLS via cert-manager |

Config objects: `files-connect-config` (ConfigMap), `files-connect-secret`, `report-worker-secret`,
`rabbitmq-secrets` (Secrets) — all in `sandbox`, all defined in
[infra/configmap.yaml](../../infra/configmap.yaml) and [infra/secret.yaml](../../infra/secret.yaml).

RabbitMQ, Keycloak, ACL-APD, the Catalogue and Elasticsearch are **external dependencies**; nothing
in this repo deploys them.

## 2. How values reach each container

```
files-connect-config (ConfigMap) ─┬─ envFrom ────────────────► file server (all keys, verbatim)
                                  ├─ valueFrom + rename ─────► zip worker    (STORAGE_* → S3_*, ELASTICSEARCH_URL → CAT_URL)
                                  └─ valueFrom + rename ─────► report worker (STORAGE_* → S3_*)

files-connect-secret ─────────────┬─ envFrom ────────────────► file server
                                  ├─ valueFrom ──────────────► zip worker    (STORAGE_ACCESS_KEY → S3_ACCESS_KEY, CAT_USERNAME/PASSWORD)
                                  └─ valueFrom ──────────────► report worker (STORAGE_ACCESS_KEY → S3_ACCESS_KEY)

report-worker-secret ─────────────── valueFrom ──────────────► report worker (OPENAI_API_KEY, ELASTIC_ID, ELASTIC_PASS)
rabbitmq-secrets ─────────────────── envFrom ────────────────► file server
```

The file server uses `envFrom`, so **every key in the ConfigMap and Secret lands in its
environment**, including worker-only keys such as `S3_VERIFY_SSL` and `ELASTIC_CAT_INDEX`. Extra
variables are harmless — the Zod schema ignores unknown keys — but it means the ConfigMap is the
union of all three services' non-secret configuration and must be read as such.

The workers use explicit `valueFrom` entries because their variable names differ. Renames in force:

| ConfigMap / Secret key | Delivered to workers as |
|---|---|
| `STORAGE_ENDPOINT` | `S3_ENDPOINT` |
| `STORAGE_REGION` | `S3_REGION` |
| `STORAGE_USE_SSL` | `USE_SSL` |
| `STORAGE_ACCESS_KEY` | `S3_ACCESS_KEY` |
| `STORAGE_SECRET_KEY` | `S3_SECRET_KEY` |
| `ELASTICSEARCH_URL` | `CAT_URL` (zip worker only) |
| `CAT_USERNAME` / `CAT_PASSWORD` | same names (zip worker; Elasticsearch account) |

## 3. Deployment order

```bash
kubectl apply -f infra/secret.yaml        # Secrets first: Deployments fail to start without them
kubectl apply -f infra/configmap.yaml
kubectl apply -f infra/redis-deployment.yaml
kubectl apply -f infra/redis-service.yaml
kubectl apply -f infra/manifest.yaml            # file server Deployment + Service
kubectl apply -f infra/worker-deployment.yaml   # zip worker + HPA
kubectl apply -f infra/report-worker-deployment.yaml
kubectl apply -f infra/ingress.yaml
```

Images are built from [infra/Dockerfile](../../infra/Dockerfile) (file server, Node 24 multi-stage,
runs as the image default user, `CMD node -r elastic-apm-node/start.js ./build/server.js`),
[workers/zip-worker/Dockerfile](../../workers/zip-worker/Dockerfile) and
[workers/report-worker/Dockerfile.worker](../../workers/report-worker/Dockerfile.worker) (Python 3.11,
non-root uid 1000 — matching the `runAsUser: 1000` in both worker manifests). See
[infra/README.md](../../infra/README.md) for build commands and [infra/STS_SETUP.md](../../infra/STS_SETUP.md)
for the IAM role.

Config changes take effect only on pod restart — `envFrom`/`valueFrom` values are injected at
container start, and neither service watches for updates:

```bash
kubectl -n sandbox rollout restart deploy/files-connect-api deploy/zip-worker deploy/report-worker
```

## 4. Local development (Docker Compose)

[docker-compose.yml](../../docker-compose.yml) brings up MinIO (9000/9001), Redis (6379), the zip
worker and the report worker. The API itself is commented out — the normal loop is `pnpm dev` on the
host against those containers. Worker environment is written inline in the Compose file, with the
values that differ per developer interpolated from the root `.env`
(`BUCKET_NAME`, `OPENAI_API_KEY`, `CAT_API_URL`, `ELASTICSEARCH_URL`, `ELASTIC_ID`, `ELASTIC_PASS`,
`ELASTIC_CAT_INDEX`, `CAT_SET_PUBLISH_STATUS`). Scale workers with
`docker compose up -d --scale zip-worker=3`.

## 5. Scaling and limits

| Unit | Requests | Limits | Grace period | Notes |
|---|---|---|---|---|
| File server | 200 m / 256 Mi | 1 CPU / 2 Gi | default 30 s | 4 replicas; each holds its own Redis and RabbitMQ connections |
| Zip worker | 250 m / 512 Mi | 1 CPU / 2 Gi | 60 s | one job at a time; the whole databank is written to the container filesystem before zipping |
| Report worker | 500 m / 1 Gi | 2 CPU / 4 Gi | 120 s | one job at a time; pandas holds the dataset in memory — the memory limit is the real ceiling on dataset size |
| Redis | 100 m / 256 Mi | 500 m / 1 Gi | — | single instance, AOF on, 5 Gi PVC |

Both workers scale on CPU (70%) and memory (80%). Because a worker holds a job for its whole
duration, `terminationGracePeriodSeconds` must exceed the longest expected job: a shorter grace
period during a rolling update kills the job mid-flight and it stays `processing` in Redis until it
is retried. Queue depth (`LLEN jobs:zip` / `LLEN jobs:report`) is the honest scaling signal; CPU
utilisation lags it.

Redis is a **single replica with a PVC** — restarting it drops any queued-but-unstarted jobs that
were not yet persisted by AOF, and it is a single point of failure for both job paths. Note also
that `REDIS_CLUSTER_MODE` support exists in all three services, so moving to a clustered/Sentinel
Redis is a configuration change, not a code change.

## 6. Ingress specifics worth knowing

[infra/ingress.yaml](../../infra/ingress.yaml) sets `proxy-body-size: 5m`, a per-request body cap.
Databank multipart initiation, completion, and cancellation pass through this ingress but contain
only small JSON bodies. The actual part PUTs use object-storage presigned URLs and bypass the file
server ingress, so `proxy-body-size` does not determine their chunk size. The `/v1/assets` upload is
different: it sends the file through the API as `multipart/form-data` and is subject to both ingress
and application limits. See [Databank Multipart Uploads](../api/multipart-uploads.md#ingress-and-asset-uploads).
CORS is enforced **at the ingress** with an explicit origin allow-list; the app-level
`CORS_ORIGIN` is `*` so the two layers do not emit conflicting `Access-Control-Allow-Origin`
headers. Rate limits: 500 rps / 500 connections per server, global limit 5000/s.

## 7. Changes made in this cleanup

All changes are configuration-only; no application code was modified.

### Corrections

| # | File | Change | Why it matters |
|---|---|---|---|
| 1 | `worker-deployment.yaml`, `redis-deployment.yaml`, `redis-service.yaml` | namespace `default` → `sandbox` | ConfigMaps and Secrets are namespaced. The zip worker in `default` referenced `files-connect-config`/`files-connect-secret`, which exist only in `sandbox` — the pods could never start there. Redis was likewise unreachable at the bare name `redis` from `sandbox`. |
| 2 | `secret.yaml` | `rabbitmq-secrets` namespace `rabbitmq-secrets` → `sandbox` | The file server mounts it with `envFrom` from `sandbox`; a Secret in another namespace cannot be referenced, so the Deployment would stay `CreateContainerConfigError`. |
| 3 | `worker-deployment.yaml` | `CAT_URL` now sourced from the ConfigMap key `ELASTICSEARCH_URL` instead of `CAT_API_URL` | The zip worker calls `{CAT_URL}/tgdex__cat/_search`, i.e. Elasticsearch. Fed the catalogue REST URL, every update returned 404 while the zip job still reported success — `dataUploadStatus` silently never updated. |
| 4 | `report-worker-deployment.yaml` | added `ELASTICSEARCH_URL`, `ELASTIC_CAT_INDEX`, `CAT_SET_PUBLISH_STATUS`, `ELASTIC_ID`, `ELASTIC_PASS` | None of the catalogue-writeback configuration was wired into Kubernetes at all, so readiness scores computed in the cluster were never written to the catalogue, and the `CAT_SET_PUBLISH_STATUS` flag added in `a21ca17` had no effect there. |
| 5 | `configmap.yaml` | `ACL_APD_API_URL` trailing slash removed | The code concatenates `/access_request/has_access`, producing `…/v1//access_request/…`. **Verify against the live ACL-APD gateway before rolling out** — if it currently tolerates the double slash this is cosmetic; if not, it was failing closed. |
| 6 | `configmap.yaml` | `LOG_LEVEL` `debug` → `info` | `debug` logs per-request context on every call in production. |
| 7 | `configmap.yaml` | added `ELASTIC_APM_ACTIVE: "false"` | The APM agent is preloaded by the image `CMD` and is **active by default**, targeting `127.0.0.1:8200`; with no APM Server the logs carry continuous transport errors. |

### Additions (previously implicit defaults, now explicit)

`configmap.yaml`: `VERSION`, `AUTH_ENABLED`, `AUTHZ_ENABLED`, `STORAGE_FORCE_PATH_STYLE`,
`REDIS_CLUSTER_MODE`, `ELASTIC_CAT_INDEX`, `CAT_SET_PUBLISH_STATUS`, plus commented templates for
`ISSUER_CONFIG`, `ELASTICSEARCH_URL`, the APM fields and the TANUH encryption fields.
Both worker Deployments now also accept `REDIS_PASSWORD` and `REDIS_CLUSTER_MODE` (both
`optional: true`, so applying them without those keys is a no-op).

### Removals (dead configuration)

`ZIP_LAMBDA_URL`, `REPORTS_LAMBDA_URL`, `LAMBDA_REGION`, `LAMBDA_ACCESS_KEY`, `LAMBDA_SECRET_KEY`,
`KEYCLOAK_REALM` — removed from `.env.example`, `configmap.yaml`, `secret.yaml` and the commented
Compose block. The duplicate `S3_ENDPOINT` / `S3_REGION` ConfigMap keys were also dropped: they held
the same values as `STORAGE_ENDPOINT` / `STORAGE_REGION`, the file server prefers the `STORAGE_*`
pair, and the worker Deployments build their `S3_*` variables by renaming the `STORAGE_*` keys — so
nothing referenced them. Verified unreferenced across `src/`, `workers/` and `scripts/`: the Lambda variables
are declared in the Zod schema but read by nothing (job processing moved to the Redis-queue workers),
and `KEYCLOAK_REALM` is declared optional and never read. They remain optional in
`src/config/environment.ts`, so deployments that still set them keep starting.

### Still requiring a human decision

- **`STS_ROLE_ARN` in `configmap.yaml` is a placeholder** (`arn:aws:iam::123456789012:role/…`). On AWS this
  breaks every temporary-access request with `AccessDenied` on `AssumeRole`. Replace with the real
  role ARN from [infra/STS_SETUP.md](../../infra/STS_SETUP.md).
- **`ELASTICSEARCH_URL` is commented out** — the real cluster URL was not available to fill in.
  Until it is set, readiness scores and `dataUploadStatus` are not written back to the catalogue by
  either worker (both fail soft, so the jobs will look successful).
- **Worker images** in both Deployments are still `your-registry/files-connect-…:latest`. Pin real
  image tags; `latest` also defeats `imagePullPolicy: Always` rollback.
- **`CAT_API_URL` points at `v2.dev.controlplane.iudx.io`** — a dev control plane referenced from the
  production ConfigMap. Confirm this is intended.
- **`ISSUER_CONFIG` vs `KEYCLOAK_PUBLIC_KEY`**: the cluster currently uses the static key, which must
  be rotated by hand whenever the realm rotates keys. Moving to `ISSUER_CONFIG` (JWKS) removes that
  manual step; a commented template is in the ConfigMap.
