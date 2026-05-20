# Report Worker Deployment Guide

This document provides step-by-step instructions for deploying the report-worker to the Development Environment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Environment Variables](#environment-variables)
4. [Docker Deployment (Local Development)](#docker-deployment-local-development)
5. [Kubernetes Deployment (Development Environment)](#kubernetes-deployment-development-environment)
6. [Configuration](#configuration)
7. [Verification & Testing](#verification--testing)
8. [Monitoring & Logging](#monitoring--logging)
9. [Troubleshooting](#troubleshooting)
10. [Scaling](#scaling)

---

## Prerequisites

### Required Services

- **Redis**: Job queue and status storage
  - Version: 7.0+
  - Must be accessible from worker pods/containers
  - Authentication configured (if required)

- **S3/MinIO**: Object storage for datasets and reports
  - AWS S3 or MinIO instance
  - Two buckets:
    - Input bucket: Contains databank datasets
    - Reports bucket: Stores generated PDF reports

- **OpenAI API**: Required for column/role inference
  - Valid API key with sufficient credits
  - Access to GPT models (used for semantic analysis)

### Required Access

- Kubernetes cluster access (for K8s deployment)
- Docker registry access (for image push/pull)
- S3/MinIO credentials
- Redis connection details
- OpenAI API key

---

## Architecture Overview

```
TypeScript API → Redis Queue (jobs:report) → Report Worker → S3/MinIO
                      ↓
                 Job Status (Redis)
```

**Flow:**
1. API creates job in Redis queue `jobs:report`
2. Worker polls queue and picks up job
3. Worker downloads files from S3 input bucket
4. Worker runs data readiness assessment framework
5. Worker generates JSON and PDF reports
6. Worker uploads PDF to `BUCKET_NAME` at `reports/{databankId}/data_readiness_report.pdf`
7. Worker updates job status in Redis

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `REDIS_HOST` | Redis server hostname | `redis` or `redis-service.default.svc.cluster.local` |
| `REDIS_PORT` | Redis server port | `6379` |
| `REDIS_DB` | Redis database number | `0` |
| `REPORT_QUEUE_NAME` | Queue name to listen on (`READINESS_QUEUE_NAME` is still accepted as a legacy alias) | `jobs:report` |
| `BUCKET_NAME` | Single bucket for all operations (datasets, zips, and PDF reports) | `files-connect-bucket` |
| `S3_ACCESS_KEY` | Storage access key | `minioadmin` or AWS access key |
| `S3_SECRET_KEY` | Storage secret key | `minioadmin` or AWS secret key |
| `STORAGE_PROVIDER` | Storage provider type | `s3` or `minio` |
| `OPENAI_API_KEY` | OpenAI API key (required) | `sk-...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_PASSWORD` | Redis password (if auth enabled) | - |
| `S3_ENDPOINT` | S3/MinIO endpoint URL | AWS default |
| `S3_REGION` | AWS region (for S3) | `us-east-1` |
| `USE_SSL` | Use SSL for storage | `true` for S3, `false` for MinIO |
| `ELASTIC_ID` | Elasticsearch ID (for CAT API) | - |
| `ELASTIC_PASS` | Elasticsearch password (for CAT API) | - |

### Storage Provider Configuration

**For MinIO:**
```bash
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://minio:9000  # or https://minio.example.com
USE_SSL=false
```

**For AWS S3:**
```bash
STORAGE_PROVIDER=s3
S3_REGION=us-east-1
S3_ENDPOINT=  # Optional, uses AWS default
USE_SSL=true
```

---

## Docker Deployment (Local Development)

### Step 1: Build Docker Image

```bash
cd workers/report-worker
docker build -f Dockerfile.worker -t report-worker:latest .
```

### Step 2: Test Locally with Docker Compose

The `docker-compose.yml` in the project root includes the report-worker configuration.

```bash
# From project root
docker-compose up -d report-worker

# View logs
docker-compose logs -f report-worker

# Scale workers
docker-compose up -d --scale report-worker=2
```

### Step 3: Verify Worker is Running

```bash
# Check container status
docker ps | grep report-worker

# Check logs
docker-compose logs report-worker | tail -50

# Test Redis connection (from worker container)
docker exec -it files-connect-report-worker python -c "import redis; r = redis.Redis(host='redis', port=6379); print(r.ping())"
```

---

## Kubernetes Deployment (Development Environment)

### Step 1: Create Kubernetes Secrets

Create a secret for sensitive environment variables:

```bash
kubectl create secret generic report-worker-secret \
  --from-literal=OPENAI_API_KEY='your-openai-api-key' \
  --from-literal=S3_ACCESS_KEY='your-s3-access-key' \
  --from-literal=S3_SECRET_KEY='your-s3-secret-key' \
  --namespace=default
```

**Note:** If using existing secrets (e.g., `files-connect-secret`), reference them in the deployment.

### Step 2: Create ConfigMap (if not exists)

Ensure ConfigMap exists with storage configuration:

```bash
kubectl create configmap files-connect-config \
  --from-literal=STORAGE_PROVIDER=s3 \
  --from-literal=STORAGE_ENDPOINT=https://s3.amazonaws.com \
  --from-literal=STORAGE_REGION=us-east-1 \
  --from-literal=STORAGE_USE_SSL=true \
  --from-literal=BUCKET_NAME=files-connect-bucket \
  --namespace=default
```

### Step 3: Build and Push Docker Image

```bash
# Build image
cd workers/report-worker
docker build -f Dockerfile.worker -t your-registry/files-connect-report-worker:v1.0.0 .

# Tag for registry
docker tag your-registry/files-connect-report-worker:v1.0.0 your-registry/files-connect-report-worker:latest

# Push to registry
docker push your-registry/files-connect-report-worker:v1.0.0
docker push your-registry/files-connect-report-worker:latest
```

### Step 4: Create Kubernetes Deployment

Create `infra/report-worker-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: report-worker
  namespace: default
  labels:
    app: report-worker
    component: job-processor
spec:
  replicas: 2  # Start with 2 replicas, scale as needed
  selector:
    matchLabels:
      app: report-worker
  template:
    metadata:
      labels:
        app: report-worker
        component: job-processor
    spec:
      containers:
      - name: report-worker
        image: your-registry/files-connect-report-worker:latest
        imagePullPolicy: Always
        env:
        # Redis configuration
        - name: REDIS_HOST
          value: "redis-service"  # Update with your Redis service name
        - name: REDIS_PORT
          value: "6379"
        - name: REDIS_DB
          value: "0"
        - name: REPORT_QUEUE_NAME
          value: "jobs:report"
        
        # Redis password (if using authentication)
        # - name: REDIS_PASSWORD
        #   valueFrom:
        #     secretKeyRef:
        #       name: redis-secret
        #       key: password
        
        # Storage configuration - from ConfigMap
        - name: STORAGE_PROVIDER
          valueFrom:
            configMapKeyRef:
              name: files-connect-config
              key: STORAGE_PROVIDER
        - name: S3_ENDPOINT
          valueFrom:
            configMapKeyRef:
              name: files-connect-config
              key: STORAGE_ENDPOINT
              optional: true
        - name: BUCKET_NAME
          valueFrom:
            configMapKeyRef:
              name: files-connect-config
              key: BUCKET_NAME
        - name: S3_REGION
          valueFrom:
            configMapKeyRef:
              name: files-connect-config
              key: STORAGE_REGION
              optional: true
        - name: USE_SSL
          valueFrom:
            configMapKeyRef:
              name: files-connect-config
              key: STORAGE_USE_SSL
        
        # Storage credentials - from Secret
        - name: S3_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: files-connect-secret
              key: STORAGE_ACCESS_KEY
        - name: S3_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: files-connect-secret
              key: STORAGE_SECRET_KEY
        
        # OpenAI API key - from Secret
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: report-worker-secret
              key: OPENAI_API_KEY
        
        # Optional: CAT API configuration
        # - name: ELASTIC_ID
        #   valueFrom:
        #     secretKeyRef:
        #       name: files-connect-secret
        #       key: ELASTIC_ID
        #       optional: true
        # - name: ELASTIC_PASS
        #   valueFrom:
        #     secretKeyRef:
        #       name: files-connect-secret
        #       key: ELASTIC_PASS
        #       optional: true
        
        resources:
          requests:
            memory: "1Gi"      # Report processing can be memory-intensive
            cpu: "500m"
          limits:
            memory: "4Gi"      # Allow for large dataset processing
            cpu: "2000m"
        
        # Health check (optional)
        # livenessProbe:
        #   exec:
        #     command:
        #     - python
        #     - -c
        #     - "import redis; r = redis.Redis(host='redis-service', port=6379); r.ping()"
        #   initialDelaySeconds: 30
        #   periodSeconds: 30
        #   timeoutSeconds: 5
        #   failureThreshold: 3
        
      # Graceful shutdown configuration
      terminationGracePeriodSeconds: 120  # Allow time for job completion
      
      # Security context
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      
      # Restart policy
      restartPolicy: Always
---
# Horizontal Pod Autoscaler (optional - for auto-scaling workers)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: report-worker-hpa
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: report-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 minutes before scaling down
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0  # Scale up immediately
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 2
        periodSeconds: 30
```

### Step 5: Deploy to Kubernetes

```bash
# Apply deployment
kubectl apply -f infra/report-worker-deployment.yaml

# Verify deployment
kubectl get deployments report-worker
kubectl get pods -l app=report-worker

# Check pod status
kubectl describe pod -l app=report-worker

# View logs
kubectl logs -f -l app=report-worker
```

---

## Configuration

### Redis Queue Name

The worker listens on the queue specified by `REPORT_QUEUE_NAME` (default: `jobs:report`; `READINESS_QUEUE_NAME` is still accepted as a legacy alias).

**Important:** Ensure the API is configured to use the same queue name when creating report jobs.

### Storage Buckets

**Single bucket** (`BUCKET_NAME`) used for all operations:
   - Databank datasets: `{databankId}/file1.csv`, `{databankId}/file2.parquet`, etc.
   - Zip archives: `zips/{databankId}.zip`
   - PDF reports: `reports/{databankId}/data_readiness_report.pdf`
   - Ensure the bucket exists and the worker has read/write permissions

### OpenAI API Key

- **Required:** The worker cannot function without a valid OpenAI API key
- Ensure the key has sufficient credits
- Monitor API usage to avoid rate limits
- Consider setting up usage alerts

---

## Verification & Testing

### Step 1: Verify Worker is Running

```bash
# Check pods are running
kubectl get pods -l app=report-worker

# Check logs for startup messages
kubectl logs -l app=report-worker | grep "Starting readiness worker"

# Should see: "Successfully connected to Redis database 0"
# Should see: "Listening on queue: jobs:report"
```

### Step 2: Test Redis Connection

```bash
# Connect to a worker pod
kubectl exec -it deployment/report-worker -- python -c "
import redis
import os
r = redis.Redis(
    host=os.environ['REDIS_HOST'],
    port=int(os.environ['REDIS_PORT']),
    db=int(os.environ.get('REDIS_DB', '0'))
)
print('Redis ping:', r.ping())
print('Queue length:', r.llen('jobs:report'))
"
```

### Step 3: Test S3/MinIO Connection

```bash
# Test S3 access from worker pod
kubectl exec -it deployment/report-worker -- python -c "
import boto3
import os
s3 = boto3.client(
    's3',
    endpoint_url=os.environ.get('S3_ENDPOINT'),
    aws_access_key_id=os.environ['S3_ACCESS_KEY'],
    aws_secret_access_key=os.environ['S3_SECRET_KEY']
)
print('Buckets:', [b['Name'] for b in s3.list_buckets()['Buckets']])
"
```

### Step 4: Create a Test Job

Use the API to create a test report job:

```bash
curl -X POST https://your-api-url/v1/databanks/test-databank-id/process \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "report"
  }'
```

To run both zip and report jobs in one request, use `"type": "all"`; the response will include `jobIds.zip` and `jobIds.report` to poll each job.

### Step 5: Monitor Job Processing

```bash
# Check job in Redis queue
kubectl exec -it deployment/redis -- redis-cli LLEN jobs:report

# Check job status
kubectl exec -it deployment/redis -- redis-cli HGETALL job:YOUR_JOB_ID

# Watch worker logs
kubectl logs -f -l app=report-worker
```

### Step 6: Verify Report Generation

```bash
# Check if PDF was uploaded to reports bucket
kubectl exec -it deployment/report-worker -- python -c "
import boto3
import os
s3 = boto3.client(
    's3',
    endpoint_url=os.environ.get('S3_ENDPOINT'),
    aws_access_key_id=os.environ['S3_ACCESS_KEY'],
    aws_secret_access_key=os.environ['S3_SECRET_KEY']
)
reports = s3.list_objects_v2(
    Bucket=os.environ['BUCKET_NAME'],
    Prefix='reports/',
    Prefix=''
)
print('Reports:', [obj['Key'] for obj in reports.get('Contents', [])])
"
```

---

## Monitoring & Logging

### Logs

```bash
# View all worker logs
kubectl logs -f -l app=report-worker

# View logs from specific pod
kubectl logs -f report-worker-xxxxx-yyyyy

# View last 100 lines
kubectl logs --tail=100 -l app=report-worker

# Search logs for errors
kubectl logs -l app=report-worker | grep -i error
```

### Key Log Messages

- **Startup:**
  - `"Starting readiness worker..."`
  - `"Successfully connected to Redis database 0"`
  - `"Listening on queue: jobs:report"`

- **Job Processing:**
  - `"Received job from queue: jobs:report"`
  - `"Processing readiness job for databank: {databankId}"`
  - `"Detected data type: structured"` or `"Detected data type: unstructured"`
  - `"Readiness job completed successfully"`

- **Errors:**
  - `"Failed to connect to Redis"`
  - `"Missing required environment variables"`
  - `"Error processing readiness job"`

### Metrics to Monitor

1. **Queue Length:**
   ```bash
   kubectl exec -it deployment/redis -- redis-cli LLEN jobs:report
   ```

2. **Job Status Distribution:**
   ```bash
   kubectl exec -it deployment/redis -- redis-cli --scan --pattern "job:*" | \
     xargs -I {} kubectl exec -it deployment/redis -- redis-cli HGET {} status
   ```

3. **Pod Resource Usage:**
   ```bash
   kubectl top pods -l app=report-worker
   ```

4. **Failed Jobs:**
   ```bash
   kubectl logs -l app=report-worker | grep -i "failed\|error" | tail -20
   ```

---

## Troubleshooting

### Worker Not Processing Jobs

**Symptoms:**
- Jobs stuck in `pending` status
- Queue length increasing
- No logs showing job processing

**Solutions:**

1. **Check Redis Connection:**
   ```bash
   kubectl exec -it deployment/report-worker -- python -c "
   import redis, os
   r = redis.Redis(host=os.environ['REDIS_HOST'], port=int(os.environ['REDIS_PORT']))
   print('Connected:', r.ping())
   "
   ```

2. **Verify Queue Name:**
   ```bash
   # Check worker is listening on correct queue
   kubectl logs -l app=report-worker | grep "Listening on queue"
   
   # Check API is using same queue name
   # (Verify in API configuration)
   ```

3. **Check Worker Pods:**
   ```bash
   kubectl get pods -l app=report-worker
   kubectl describe pod -l app=report-worker
   ```

### Job Fails Immediately

**Symptoms:**
- Job status changes to `failed` quickly
- Error message in job status

**Solutions:**

1. **Check Worker Logs:**
   ```bash
   kubectl logs -l app=report-worker | tail -50
   ```

2. **Common Issues:**
   - Missing OpenAI API key
   - Invalid S3 credentials
   - Databank folder doesn't exist in S3
   - Missing required environment variables

3. **Verify Environment Variables:**
   ```bash
   kubectl exec -it deployment/report-worker -- env | grep -E "S3_|REDIS_|OPENAI"
   ```

### Memory Issues

**Symptoms:**
- Pods being killed (OOMKilled)
- Jobs failing with memory errors

**Solutions:**

1. **Increase Memory Limits:**
   ```yaml
   resources:
     limits:
       memory: "8Gi"  # Increase from 4Gi
   ```

2. **Scale Horizontally:**
   - Run more worker pods with lower memory limits
   - Process smaller datasets per worker

3. **Monitor Memory Usage:**
   ```bash
   kubectl top pods -l app=report-worker
   ```

### Redis Connection Errors

**Symptoms:**
- `"Failed to connect to Redis"`
- `"Redis connection error"`

**Solutions:**

1. **Verify Redis Service:**
   ```bash
   kubectl get svc redis
   kubectl get endpoints redis
   ```

2. **Check Redis Host Configuration:**
   - Ensure `REDIS_HOST` matches Redis service name
   - For cross-namespace access, use FQDN: `redis-service.namespace.svc.cluster.local`

3. **Test Connectivity:**
   ```bash
   kubectl exec -it deployment/report-worker -- nc -zv redis-service 6379
   ```

### S3/MinIO Access Issues

**Symptoms:**
- `"Error downloading files from S3"`
- `"Failed to upload report"`

**Solutions:**

1. **Verify Credentials:**
   ```bash
   kubectl exec -it deployment/report-worker -- env | grep S3_
   ```

2. **Test S3 Access:**
   ```bash
   kubectl exec -it deployment/report-worker -- python -c "
   import boto3, os
   s3 = boto3.client('s3',
       endpoint_url=os.environ.get('S3_ENDPOINT'),
       aws_access_key_id=os.environ['S3_ACCESS_KEY'],
       aws_secret_access_key=os.environ['S3_SECRET_KEY']
   )
   print('Buckets:', s3.list_buckets())
   "
   ```

3. **Check Bucket Permissions:**
   - Ensure worker has read access to input bucket
   - Ensure worker has read/write access to `BUCKET_NAME`

### OpenAI API Issues

**Symptoms:**
- `"OpenAI API error"`
- Jobs failing during column inference

**Solutions:**

1. **Verify API Key:**
   ```bash
   kubectl exec -it deployment/report-worker -- env | grep OPENAI_API_KEY
   ```

2. **Check API Credits:**
   - Log into OpenAI dashboard
   - Verify sufficient credits/usage limits

3. **Monitor API Usage:**
   - Check OpenAI dashboard for rate limits
   - Consider implementing retry logic if needed

---

## Scaling

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment report-worker --replicas=5

# Check scaling status
kubectl get deployment report-worker
```

### Auto-Scaling (HPA)

The HorizontalPodAutoscaler is configured in the deployment YAML. It will automatically scale based on CPU and memory usage.

**HPA Configuration:**
- Min replicas: 2
- Max replicas: 10
- CPU threshold: 70%
- Memory threshold: 80%

**Monitor HPA:**
```bash
kubectl get hpa report-worker-hpa
kubectl describe hpa report-worker-hpa
```

### Queue-Based Scaling (Advanced)

For more sophisticated scaling based on queue length, consider using KEDA (Kubernetes Event-Driven Autoscaling):

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: report-worker-scaler
spec:
  scaleTargetRef:
    name: report-worker
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
  - type: redis
    metadata:
      address: redis-service:6379
      listName: jobs:report
      listLength: '5'  # Scale up when queue has 5+ jobs
```

---

## Rollback

If deployment fails, rollback to previous version:

```bash
# Check deployment history
kubectl rollout history deployment/report-worker

# Rollback to previous version
kubectl rollout undo deployment/report-worker

# Rollback to specific revision
kubectl rollout undo deployment/report-worker --to-revision=2
```

---

## Support

For issues or questions:
1. Check worker logs: `kubectl logs -l app=report-worker`
2. Review this deployment guide
3. Check worker documentation: `workers/report-worker/README.md`
4. Contact the development team

---

## Checklist

Before considering deployment complete:

- [ ] Redis is accessible and queue name matches
- [ ] S3/MinIO credentials are correct
- [ ] `BUCKET_NAME` bucket exists and is accessible
- [ ] OpenAI API key is valid and has credits
- [ ] Worker pods are running and healthy
- [ ] Worker logs show successful Redis connection
- [ ] Worker logs show "Listening on queue: jobs:report"
- [ ] Test job can be created via API
- [ ] Test job is processed successfully
- [ ] PDF report is generated and uploaded to `BUCKET_NAME` at `reports/{databankId}/data_readiness_report.pdf`
- [ ] Job status updates correctly in Redis
- [ ] Monitoring and logging are configured
- [ ] HPA is configured (if using auto-scaling)

---

**Last Updated:** 2025-01-28
**Version:** 1.0.0
