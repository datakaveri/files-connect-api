# Job Queue Workers

This directory contains worker applications that process asynchronous jobs from the Redis job queue.

## Architecture

The system uses a Redis-based job queue architecture:

```
TypeScript API → Redis Queue → Python Worker(s) → S3/MinIO
                      ↓
                 Job Status (Redis)
```

1. The TypeScript API receives requests and creates jobs in Redis
2. Python workers poll the Redis queue for jobs
3. Workers process jobs (e.g., creating zip files from S3 folders)
4. Workers update job status in Redis throughout processing
5. The API can query job status from Redis at any time

## Workers

### Zip Worker (`zip-worker/`)

Processes databank zip creation jobs:
- Streams files from S3/MinIO
- Creates compressed zip archives
- Uploads zip files back to storage
- Updates CAT API with completion status

**Key Features:**
- Memory-efficient streaming (handles large datasets)
- Works with both AWS S3 and MinIO
- Maintains folder structure in zip files
- Graceful shutdown handling
- Automatic retry on connection failures

### Report Worker (`report-worker/`)

Processes data readiness assessment jobs:
- Downloads files from S3/MinIO
- Automatically detects structured (CSV, Parquet, JSON) or unstructured (PDF, Images, Audio) datasets
- Runs comprehensive data quality assessment framework
- Generates detailed JSON and PDF reports
- Uploads reports back to storage
- Updates CAT API with readiness scores

**Key Features:**
- Supports both structured and unstructured data
- Automatic data type detection
- Comprehensive metrics (quality, variance, standardization, documentation, etc.)
- LLM-powered column/role inference (OpenAI)
- Memory-efficient processing
- Works with both AWS S3 and MinIO
- Graceful shutdown handling
- Automatic retry on connection failures

## Running Workers

### Docker Compose (Local Development)

```bash
# Start all services (MinIO, Redis, Worker)
docker-compose up -d

# Scale workers
docker-compose up -d --scale zip-worker=3
docker-compose up -d --scale report-worker=2

# View worker logs
docker-compose logs -f zip-worker
docker-compose logs -f report-worker

# Stop services
docker-compose down
```

### Kubernetes (Production)

```bash
# Deploy Redis
kubectl apply -f infra/redis-deployment.yaml
kubectl apply -f infra/redis-service.yaml

# Deploy workers
kubectl apply -f infra/worker-deployment.yaml

# Scale workers
kubectl scale deployment zip-worker --replicas=5

# View worker logs
kubectl logs -f deployment/zip-worker

# Check worker status
kubectl get pods -l app=zip-worker
```

### Standalone (Development/Testing)

```bash
cd workers/zip-worker

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export REDIS_HOST=localhost
export REDIS_PORT=6379
export STORAGE_PROVIDER=minio
export S3_ENDPOINT=http://localhost:9000
export S3_ACCESS_KEY=minioadmin
export S3_SECRET_KEY=minioadmin
export BUCKET_NAME=files-connect-local
export USE_SSL=false

# Run worker
python worker.py
```

## Storage Buckets

Only **one bucket** is required. Both workers use `BUCKET_NAME` — the same bucket as the API — with path prefixes to separate concerns.

| Env Var | Used By | Operation | Key Path |
|---|---|---|---|
| `BUCKET_NAME` | Zip worker, Report worker | **Read** databank files | `{databankId}/*` |
| `BUCKET_NAME` | Zip worker | **Write** zip archive | `zips/{databankId}.zip` |
| `BUCKET_NAME` | Report worker | **Write** PDF report | `reports/{databankId}/data_readiness_report.pdf` |

> `BUCKET_NAME` must match what the API is configured with — all components share the same bucket and credentials.

## Environment Variables

### Required

**For all workers:**
- `REDIS_HOST` - Redis server hostname
- `REDIS_PORT` - Redis server port (default: 6379)
- `BUCKET_NAME` - S3/MinIO bucket (same bucket the API uses)
- `S3_ACCESS_KEY` - Storage access key
- `S3_SECRET_KEY` - Storage secret key

**For readiness worker only:**
- `OPENAI_API_KEY` - OpenAI API key for column/role inference (required)

### Storage Configuration

For **MinIO**:
```bash
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://minio:9000
USE_SSL=false
```

For **AWS S3**:
```bash
STORAGE_PROVIDER=s3
S3_REGION=us-east-1
S3_ENDPOINT=  # Optional, uses AWS default
USE_SSL=true
```

### Optional

**For all workers:**
- `REDIS_CLUSTER` - Set to `true` (or `1`/`yes`) when connecting to a **Redis Cluster** (e.g. Kubernetes with `redis-redis-cluster`). Required to avoid `MOVED` errors; workers use the cluster-aware client.
- `REDIS_PASSWORD` - Redis password (if authentication enabled)
- `CAT_URL` - CAT API URL for status updates
- `CAT_USERNAME` - CAT API username
- `CAT_PASSWORD` - CAT API password

**For readiness worker:**
- `REPORT_QUEUE_NAME` - Custom report queue name (default: `jobs:report`; `READINESS_QUEUE_NAME` is still accepted as a legacy alias)
- `ELASTIC_ID` - Elasticsearch ID for CAT API updates
- `ELASTIC_PASS` - Elasticsearch password for CAT API updates

## Job Queue Structure

### Process endpoint job types
The API `POST /v1/databanks/:databankId/process` accepts a body `type`:
- **`zip`** – One job is created and pushed to `ZIP_QUEUE_NAME` (default: `jobs:zip`).
- **`report`** – One job is created and pushed to `REPORT_QUEUE_NAME` (default: `jobs:report`).
- **`all`** – Two jobs are created: one pushed to each configured queue. The response returns `jobIds.zip` and `jobIds.report`; poll each job ID separately for status.

### Queue Names
- `ZIP_QUEUE_NAME` - Zip creation jobs (default: `jobs:zip`)
- `REPORT_QUEUE_NAME` - Report generation and data readiness assessment jobs (default: `jobs:report`)

### Job Data Format
Each queue entry has the following shape (workers never see `type: "all"`; the API creates separate zip and report jobs):
```json
{
  "jobId": "uuid-v4",
  "type": "zip",
  "databankId": "databank-123",
  "options": {},
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```
Use `"type": "report"` for report jobs.

### Job Status Format (Redis Hash `job:{jobId}`)
```
jobId: "uuid-v4"
type: "zip"
status: "processing"
databankId: "databank-123"
progress: "50"
createdAt: "2025-01-01T00:00:00.000Z"
completedAt: "2025-01-01T00:15:00.000Z"
error: ""
result: "{...}"
```

### Job Status Values
- `pending` - Job queued, waiting for worker
- `processing` - Worker is processing the job
- `completed` - Job completed successfully
- `failed` - Job failed with error

## Monitoring

### Redis CLI

```bash
# Connect to Redis
redis-cli -h localhost -p 6379

# Check queue length
LLEN jobs:zip
LLEN jobs:report

# View job status
HGETALL job:your-job-id-here

# List all job keys
KEYS job:*

# Monitor real-time commands
MONITOR
```

### Docker Logs

```bash
# View worker logs
docker-compose logs -f zip-worker
docker-compose logs -f report-worker

# View last 100 lines
docker-compose logs --tail=100 zip-worker
docker-compose logs --tail=100 report-worker
```

### Kubernetes Logs

```bash
# Stream logs from all worker pods
kubectl logs -f -l app=zip-worker

# View logs from specific pod
kubectl logs -f zip-worker-xxxxx-yyyyy
```

## Troubleshooting

### Worker Not Processing Jobs

1. Check Redis connection:
   ```bash
   docker-compose logs redis
   kubectl logs -f deployment/redis
   ```

2. Verify queue has jobs:
   ```bash
   redis-cli LLEN jobs:zip
   redis-cli LLEN jobs:report
   ```

3. Check worker logs:
   ```bash
   docker-compose logs zip-worker
   docker-compose logs report-worker
   ```

### MOVED / Redis Cluster Errors

If you see `redis.exceptions.ResponseError: MOVED <slot> <host>:<port>` when deploying to Kubernetes with a Redis Cluster:

- Set `REDIS_CLUSTER=true` in the worker deployment environment so the worker uses the cluster-aware Redis client (handles slot redirects).

### Job Stuck in "Pending"

- No workers running
- Workers crashed
- Redis connection issues

**Solution:** Restart workers or check logs

### Job Fails Immediately

- Invalid databankId (folder doesn't exist in S3)
- Missing S3 credentials
- Network connectivity issues

**Solution:** Check worker logs for specific error

### Memory Issues

If workers are running out of memory:

1. Reduce concurrent workers
2. Increase worker memory limits in Kubernetes
3. Check for memory leaks in logs

## Performance Tuning

### Scaling Workers

**Horizontal Scaling:**
```bash
# Docker Compose
docker-compose up -d --scale zip-worker=5
docker-compose up -d --scale report-worker=3

# Kubernetes
kubectl scale deployment zip-worker --replicas=5
kubectl scale deployment report-worker --replicas=3
```

**Vertical Scaling (Kubernetes):**
```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "4Gi"
    cpu: "2000m"
```

### Redis Performance

- Use persistent storage (AOF or RDB)
- Enable connection pooling
- Monitor memory usage
- Consider Redis Cluster for high availability

## Development

### Adding a New Worker

1. Create new directory: `workers/new-worker/`
2. Implement worker script following `zip-worker/worker.py` pattern
3. Create Dockerfile
4. Add to docker-compose.yml
5. Create Kubernetes deployment manifest
6. Update queue name in job-queue.ts

### Testing Workers Locally

```bash
# Terminal 1: Start Redis
docker run -p 6379:6379 redis:7-alpine

# Terminal 2: Start MinIO
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Terminal 3: Run worker
cd workers/zip-worker
python worker.py

# Terminal 4: Test via API (type: zip | report | all)
curl -X POST http://localhost:3000/v1/databanks/test-123/process \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "zip"}'
# For both zip and report: -d '{"type": "all"}' (response includes jobIds.zip and jobIds.report)
```

## Security Considerations

- Workers run as non-root user (UID 1000)
- Credentials stored in Kubernetes Secrets
- Redis authentication recommended for production
- Network policies to restrict worker access
- Regular security updates for base images

## Future Enhancements

- [x] Add report generation worker (report-worker)
- [ ] Implement job priorities
- [ ] Add job retry mechanism
- [ ] Implement job scheduling
- [ ] Add metrics and monitoring (Prometheus)
- [ ] Add distributed tracing
- [ ] Implement job timeouts
- [ ] Add job dependencies

