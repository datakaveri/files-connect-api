# Report Worker Deployment Guide

Runbook for `stable/v2.3`. Environment-variable definitions are maintained in the
[report-worker configuration reference](../../docs/config/report-worker.md); Kubernetes wiring
and resource settings are maintained in [deployment configuration](../../docs/config/deployments.md).
Use the checked-in manifests rather than copying an older inline Deployment from a document.

## Prerequisites

The worker needs access to the API's storage bucket and Redis database/queue. S3/MinIO requires
the configured key pair; GCS uses native credentials or Application Default Credentials.
Catalogue REST lookup and Elasticsearch readiness-score writeback are separate integrations.

Structured column-role inference is currently disabled. Unstructured metadata inference still
uses OpenAI and requires a private key with appropriate quota; approve external metadata sharing
before processing sensitive datasets. No populated credentials belong in the repository.

## Local deployment

From the repository root, prepare your private `.env` as described in [the root README](../../README.md):

```bash
docker compose up -d --build report-worker
docker compose logs -f report-worker
```

The API runs separately with `pnpm dev`. Create the local MinIO bucket before submitting a job.
The [synthetic fixture](data/example/README.md) can also be assessed through
`python local_lambda_tester.py` from this directory after installing Python requirements.
That tester disables Catalogue calls and Elasticsearch writeback.

## Kubernetes deployment

Follow [infra/README.md](../../infra/README.md) to build/push pinned images and populate the
ignored Secret and ConfigMap copies. All related workloads and configuration objects must use
the same namespace; the examples use `sandbox`.

Review [infra/report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml),
including its image, credentials/volumes, resource limits, HPA, and shutdown grace. Then:

```bash
kubectl apply -f infra/report-worker-deployment.yaml
kubectl -n sandbox rollout status deploy/report-worker
kubectl -n sandbox get pods -l app=report-worker
kubectl -n sandbox logs deploy/report-worker --tail=100
```

For a GCS key file, mount a Secret at `GCS_KEY_FILE`; the provided variable wiring alone
does not create a volume. Prefer workload identity instead of long-lived service-account keys.

## Verification

1. Confirm startup connects to the expected Redis DB and listens on `REPORT_QUEUE_NAME`
   (default `jobs:report`).
2. Submit a `report` job for a synthetic databank using [Postman](../../postman/README.md) or
   your private client. Do not put tokens in command-line examples or shared logs.
3. Poll `/v1/databanks/{databankId}/process/{jobId}` for progress and completion.
4. Verify the PDF at `reports/{databankId}/data_readiness_report.pdf` in `BUCKET_NAME`.
5. If Elasticsearch is enabled, verify the readiness score and intended publication state.
   A successful job does not guarantee catalogue writeback happened.

Report PDF download is public in the current API implementation; review your policy before
uploading confidential reports.

## Monitoring and troubleshooting

Monitor queue depth, job duration, error rate, worker memory/disk, Redis availability, and
catalogue writeback failures. Review logs privately: they may contain dataset paths and identifiers.

| Symptom | Checks |
|---|---|
| Jobs stay queued | Worker health; identical Redis host, DB, and queue names across API/worker |
| Storage failure | Provider, bucket, endpoint, TLS, credentials/identity permissions, and GCS mount |
| Wrong/missing title | Explicit `CAT_API_URL`; unreachable/missing lookup falls back to the dataset name |
| Missing catalogue update | `ELASTICSEARCH_URL`, index, write permissions, `ELASTIC_ID` / `ELASTIC_PASS` |
| Unstructured inference failure | Private OpenAI key, model access/quota, connectivity; inspect job errors |
| Worker killed/OOM | Dataset size, pandas memory, temp disk, resource limits, and shutdown grace |
| Job stays processing after restart | Inspect the interrupted job before retrying; avoid duplicate submissions |

Never disable certificate or token-expiry checks as a production workaround. Do not paste
populated Secret output, JWTs, presigned URLs, or dataset contents into public issues.

## Scaling and rollback

```bash
kubectl -n sandbox scale deploy/report-worker --replicas=5
kubectl -n sandbox rollout history deploy/report-worker
kubectl -n sandbox rollout undo deploy/report-worker
kubectl -n sandbox rollout status deploy/report-worker
```

The supplied HPA may override a manual replica count. Queue-depth scaling requires additional
autoscaler configuration; the current HPA uses CPU/memory. Pin image tags/digests so rollbacks
select a known build. After credential/config changes, restart pods; environment values are read
at startup. Keep shutdown grace long enough for in-flight work and check interrupted jobs.

## Release checklist

- Storage/Redis/bucket/queues match the API.
- Image references are pinned; secrets stay private; namespace and mounts are correct.
- A synthetic report job succeeds and outputs are verified.
- Catalogue writeback/publication behavior and public report-download exposure are approved.
- External metadata sharing is approved for unstructured inference.
- Memory/disk capacity, persistence, monitoring, and rollback are tested.
