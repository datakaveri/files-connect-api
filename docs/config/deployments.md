# Deployment Configuration and Wiring

This guide documents the example manifests and Docker Compose setup for `stable/v2.3`.
It describes configuration flow, not the organization's live infrastructure.

## Deployable units

| Unit | Manifest | Example namespace | Replicas |
|---|---|---|---|
| API + Service | [infra/manifest.yaml](../../infra/manifest.yaml) | `sandbox` | 4 |
| ZIP worker + HPA | [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml) | `sandbox` | 2 (HPA 2–10) |
| Report worker + HPA | [infra/report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml) | `sandbox` | 4 (HPA 4–12) |
| Redis | [deployment](../../infra/redis-deployment.yaml) + [service](../../infra/redis-service.yaml) | `sandbox` | 1 StatefulSet, 5 Gi PVC |
| Ingress | [infra/ingress.yaml](../../infra/ingress.yaml) | `sandbox` | example `files.example.com` host |

Config objects are `files-connect-config`, `files-connect-secret`, `report-worker-secret`,
and `rabbitmq-secrets`. All must be in the same namespace as their consumers.
[configmap.yaml](../../infra/configmap.yaml) contains generic non-secret examples;
[secret.example.yaml](../../infra/secret.example.yaml) is an unpopulated template.

RabbitMQ, the identity provider, ACL-APD, Catalogue, Elasticsearch, and the storage bucket are
external dependencies. The repository does not provision them in Kubernetes.

## How values reach containers

The API uses `envFrom` for the ConfigMap, `files-connect-secret`, and `rabbitmq-secrets`.
Every key in those objects reaches its environment, including worker-only keys; unknown keys
are ignored by the API's Zod schema.

Workers use explicit `valueFrom` entries with these renames:

| ConfigMap / Secret key | Worker variable |
|---|---|
| `STORAGE_ENDPOINT` | `S3_ENDPOINT` |
| `STORAGE_REGION` | `S3_REGION` |
| `STORAGE_USE_SSL` | `USE_SSL` |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | `S3_ACCESS_KEY` / `S3_SECRET_KEY` |
| `ELASTICSEARCH_URL` | `CAT_URL` (ZIP worker only) |
| `CAT_USERNAME` / `CAT_PASSWORD` | same names (ZIP worker Elasticsearch credentials) |

The report worker receives `OPENAI_API_KEY`, `ELASTIC_ID`, and `ELASTIC_PASS` from
`report-worker-secret`. Both workers also accept optional GCS credentials, Redis auth, and
cluster-mode settings; consult their manifests and field references.

For GCS, use native clients with Application Default Credentials/workload identity where possible.
A configured `GCS_KEY_FILE` requires a corresponding Secret volume and mount in **each**
container; setting the variable alone does not mount anything.

## Prepare and apply

Follow [infra/README.md](../../infra/README.md) to build images, prepare private local copies,
fill every example value, and apply in dependency order: Secrets, ConfigMap, Redis,
API/worker Deployments, then ingress. Never apply the Secret template or commit populated copies.

Configuration changes require pod restarts:

```bash
kubectl -n sandbox rollout restart deploy/files-connect-api deploy/zip-worker deploy/report-worker
```

Validate each Deployment with `kubectl -n sandbox rollout status deploy/<name>` and inspect
startup logs without sharing credentials or dataset identifiers.

## Local Docker Compose

[docker-compose.yml](../../docker-compose.yml) starts MinIO, Redis, and the two workers.
The API service is commented out; run `pnpm dev` on the host. MinIO ports 9000/9001 and
Redis 6379 bind only to `127.0.0.1`. Public demo credentials are development-only.
Create `BUCKET_NAME` in MinIO before uploading files.

The root `.env` supplies interpolated values such as `BUCKET_NAME`, `CAT_API_URL`,
`OPENAI_API_KEY`, and optional Elasticsearch settings. Container storage and Redis hosts are
service names; host API settings use localhost. Queue names, DB, bucket, and credentials must match.
The default Compose file does not deploy the identity provider, Catalogue, or ACL-APD.
RabbitMQ and the API are only commented examples.

Copy [docker-compose.override.example.yml](../../docker-compose.override.example.yml) to
ignored `docker-compose.override.yml` for private overrides. The default ZIP worker has a fixed
`container_name`; remove that setting in your local override before trying to scale it.
The report worker can be scaled with `docker compose up -d --scale report-worker=4`.

## Scaling and limitations

| Unit | Requests | Limits | Shutdown grace |
|---|---|---|---|
| API | 200 m CPU / 256 Mi | 1 CPU / 2 Gi | default 30 s |
| ZIP worker | 250 m CPU / 512 Mi | 1 CPU / 2 Gi | 60 s |
| Report worker | 500 m CPU / 1 Gi | 2 CPU / 4 Gi | 120 s |
| Redis | 100 m CPU / 256 Mi | 500 m CPU / 1 Gi | default |

Workers process one job at a time. ZIP processing uses container disk; report processing holds
datasets in memory. Size resources and scratch space accordingly. Both HPAs target CPU and memory;
queue depth is also useful for capacity planning. Shutdown grace must cover in-flight jobs.
An interrupted job can remain `processing`; do not assume automatic recovery without checking it.

Redis is a single instance with AOF and a PVC: it is a single point of failure, and jobs not yet
persisted can be lost. Redis Cluster support does not imply Sentinel/HA is automatically configured.

The ingress body cap is 5 MiB. Databank multipart part PUTs bypass it and go directly to storage;
asset uploads pass through the API and ingress. See
[multipart limits](../api/multipart-uploads.md#ingress-and-asset-uploads).
Align app and ingress CORS allow-lists; review the supplied rate limits for your workload.

## Deployment decisions

- Replace every example endpoint, image reference, bucket, and STS ARN. Pin image tags/digests.
- Ensure the storage bucket and RabbitMQ exchange exist before starting integrations.
- Choose JWKS or a static Keycloak public key; enable expiry and audience verification as appropriate.
- Configure Elasticsearch only when catalogue writeback is intended; without it workers skip updates.
- In this branch, structured OpenAI inference is disabled; unstructured metadata inference is active.
  Use synthetic data for tests and approve external metadata sharing before deployed report jobs.
- Review public metadata/report-download routes in [the endpoint reference](../api/endpoints.md).
- Keep sensitive values in Secrets or a secret manager, not ConfigMaps, committed overrides, or logs.
