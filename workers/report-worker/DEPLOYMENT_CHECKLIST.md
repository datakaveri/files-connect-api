# Report Worker Deployment - Quick Checklist

Quick reference checklist for deploying report-worker to Development Environment.

## Pre-Deployment

- [ ] Verify Redis service is running and accessible
- [ ] Verify S3/MinIO buckets exist:
  - [ ] Input bucket: `{BUCKET_NAME}`
  - [ ] Reports bucket: `{DATAREADINESS_BUCKET}`
- [ ] Obtain OpenAI API key with sufficient credits
- [ ] Verify Docker registry access
- [ ] Verify Kubernetes cluster access

## Secrets & ConfigMaps

- [ ] Create/update `report-worker-secret` with:
  - [ ] `OPENAI_API_KEY`
- [ ] Create/update `files-connect-secret` with:
  - [ ] `STORAGE_ACCESS_KEY`
  - [ ] `STORAGE_SECRET_KEY`
- [ ] Create/update `files-connect-config` ConfigMap with:
  - [ ] `STORAGE_PROVIDER` (s3 or minio)
  - [ ] `STORAGE_ENDPOINT`
  - [ ] `STORAGE_REGION` (for S3)
  - [ ] `STORAGE_USE_SSL`
  - [ ] `BUCKET_NAME`
  - [ ] `DATAREADINESS_BUCKET`

## Build & Push Image

- [ ] Build Docker image: `docker build -f Dockerfile.worker -t your-registry/files-connect-report-worker:latest .`
- [ ] Tag image: `docker tag your-registry/files-connect-report-worker:latest your-registry/files-connect-report-worker:v1.0.0`
- [ ] Push to registry: `docker push your-registry/files-connect-report-worker:latest`

## Deploy

- [ ] Update `infra/report-worker-deployment.yaml` with:
  - [ ] Correct image registry path
  - [ ] Redis service name
  - [ ] Resource limits appropriate for environment
- [ ] Apply deployment: `kubectl apply -f infra/report-worker-deployment.yaml`
- [ ] Verify pods are running: `kubectl get pods -l app=report-worker`

## Verification

- [ ] Check worker logs show: "Successfully connected to Redis database 0"
- [ ] Check worker logs show: "Listening on queue: jobs:report"
- [ ] Test Redis connection from worker pod
- [ ] Test S3/MinIO connection from worker pod
- [ ] Create test job via API
- [ ] Verify job is picked up by worker
- [ ] Verify job completes successfully
- [ ] Verify PDF report is uploaded to `DATAREADINESS_BUCKET` at `{databankId}/data_readiness_report.pdf`

## Post-Deployment

- [ ] Configure monitoring/alerts
- [ ] Document deployment details
- [ ] Update team on deployment status
- [ ] Schedule regular health checks

## Rollback Plan

If deployment fails:
- [ ] `kubectl rollout undo deployment/report-worker`
- [ ] Check logs: `kubectl logs -l app=report-worker`
- [ ] Verify previous version is working

---

**Full documentation:** See `DEPLOYMENT.md` for detailed instructions.
