# Migration Guide: AWS Lambda to Redis Job Queue

This guide explains the migration from AWS Lambda-based processing to a Redis job queue system with containerized Python workers.

## Overview

### Before (AWS Lambda)
- API triggered AWS Lambda functions via HTTP
- Lambda functions processed jobs (zip creation, reports)
- Jobs stored in-memory in API
- Cloud-dependent (AWS only)

### After (Redis + Workers)
- API pushes jobs to Redis queue
- Python workers poll Redis and process jobs
- Job status stored in Redis
- Cloud-agnostic (works with S3 and MinIO)

## Architecture Changes

```
OLD: API → AWS Lambda → S3
NEW: API → Redis Queue → Python Worker → S3/MinIO
              ↓
         Job Status (Redis)
```

## What Changed

### TypeScript API Changes

1. **New Dependencies**
   - Added `redis` npm package for Redis client
   - Removed direct Lambda invocation code

2. **New Files**
   - `src/core/utils/redis-client.ts` - Redis connection management
   - `src/core/utils/job-queue.ts` - Job queue operations

3. **Modified Files**
   - `src/services/processing-service.ts` - Now uses Redis instead of Lambda
   - `src/config/environment.ts` - Added Redis configuration

4. **Environment Variables**
   ```bash
   # New required variables
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=  # Optional
   
   # Lambda variables now optional (backward compatibility)
   ZIP_LAMBDA_URL=  # Optional
   REPORTS_LAMBDA_URL=  # Optional
   ```

### Python Workers (New)

Created standalone Python workers that replace Lambda functions:

1. **Worker Components**
   - `workers/zip-worker/worker.py` - Main worker loop
   - `workers/zip-worker/zip_processor.py` - Zip processing logic (ported from Lambda)
   - `workers/zip-worker/Dockerfile` - Container image
   - `workers/zip-worker/requirements.txt` - Python dependencies

2. **Worker Features**
   - Polls Redis queue for jobs
   - Processes jobs asynchronously
   - Updates job status in real-time
   - Handles errors gracefully
   - Supports graceful shutdown

### Infrastructure Changes

1. **Docker Compose**
   - Added Redis service
   - Added zip-worker service
   - Workers can be scaled: `docker-compose up --scale zip-worker=3`

2. **Kubernetes**
   - New Redis StatefulSet with persistent storage
   - New worker Deployment with auto-scaling
   - Updated ConfigMap and Secrets

## Migration Steps

### Development Environment

1. **Install Redis** (if not using Docker)
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Ubuntu
   sudo apt-get install redis-server
   sudo systemctl start redis
   
   # Or use Docker
   docker run -d -p 6379:6379 redis:7-alpine
   ```

2. **Update API Configuration**
   ```bash
   # Add to .env file
   REDIS_HOST=localhost
   REDIS_PORT=6379
   ```

3. **Install Dependencies**
   ```bash
   # TypeScript API
   pnpm install
   
   # Python Worker
   cd workers/zip-worker
   pip install -r requirements.txt
   ```

4. **Start Services**
   ```bash
   # Option A: Docker Compose (recommended)
   docker-compose up -d
   
   # Option B: Manual
   # Terminal 1: Start API
   pnpm dev
   
   # Terminal 2: Start worker
   cd workers/zip-worker
   python worker.py
   ```

### Production Deployment

#### Kubernetes

1. **Deploy Redis**
   ```bash
   kubectl apply -f infra/redis-deployment.yaml
   kubectl apply -f infra/redis-service.yaml
   ```

2. **Update Secrets**
   ```bash
   # Edit infra/secret.yaml with your credentials
   kubectl apply -f infra/secret.yaml
   ```

3. **Update ConfigMap**
   ```bash
   # Edit infra/configmap.yaml with Redis config
   kubectl apply -f infra/configmap.yaml
   ```

4. **Deploy Workers**
   ```bash
   # Build and push worker image
   docker build -t your-registry/zip-worker:latest workers/zip-worker
   docker push your-registry/zip-worker:latest
   
   # Update image in worker-deployment.yaml
   # Deploy workers
   kubectl apply -f infra/worker-deployment.yaml
   ```

5. **Deploy/Update API**
   ```bash
   kubectl apply -f infra/manifest.yaml
   ```

6. **Verify Deployment**
   ```bash
   # Check Redis
   kubectl get pods -l app=redis
   kubectl logs -f statefulset/redis
   
   # Check Workers
   kubectl get pods -l app=zip-worker
   kubectl logs -f deployment/zip-worker
   
   # Check API
   kubectl get pods -l app=files-connect-api
   ```

## API Usage (No Changes Required!)

The API endpoints remain the same. No client-side changes needed:

```bash
# Create a zip job (same as before)
POST /v1/databanks/{databankId}/process
{
  "type": "zip"
}

# Check job status (same as before)
GET /v1/databanks/{databankId}/process/{jobId}
```

## Monitoring

### Check Queue Status

```bash
# Connect to Redis
redis-cli -h localhost -p 6379

# Check queue length
LLEN jobs:zip

# View job details
HGETALL job:YOUR-JOB-ID

# List all jobs
KEYS job:*
```

### Worker Logs

```bash
# Docker Compose
docker-compose logs -f zip-worker

# Kubernetes
kubectl logs -f deployment/zip-worker -n sandbox
```

### Job Status Flow

1. `pending` - Job created, waiting in queue
2. `processing` - Worker picked up job
3. `completed` - Job finished successfully
4. `failed` - Job failed (check error field)

## Troubleshooting

### Jobs Not Processing

**Symptom:** Jobs stuck in `pending` status

**Solutions:**
1. Check if workers are running:
   ```bash
   docker-compose ps zip-worker
   kubectl get pods -l app=zip-worker
   ```

2. Check worker logs:
   ```bash
   docker-compose logs zip-worker
   kubectl logs deployment/zip-worker
   ```

3. Verify Redis connection:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

### Worker Connection Errors

**Symptom:** Workers can't connect to Redis or S3

**Solutions:**
1. Check environment variables
2. Verify network connectivity
3. Check credentials in secrets

### Memory Issues

**Symptom:** Workers crashing or out of memory errors

**Solutions:**
1. Increase worker memory limits in Kubernetes
2. Reduce number of concurrent workers
3. Check for memory leaks in logs

## Rollback Plan

If you need to rollback to Lambda:

1. **Revert API Changes**
   ```bash
   git revert <commit-hash>
   pnpm install
   pnpm build
   ```

2. **Update Environment Variables**
   ```bash
   # Restore Lambda URLs
   ZIP_LAMBDA_URL=your-lambda-url
   REPORTS_LAMBDA_URL=your-lambda-url
   LAMBDA_ACCESS_KEY=your-key
   LAMBDA_SECRET_KEY=your-secret
   ```

3. **Remove Redis/Workers**
   ```bash
   # Docker Compose
   docker-compose down redis zip-worker
   
   # Kubernetes
   kubectl delete -f infra/worker-deployment.yaml
   kubectl delete -f infra/redis-service.yaml
   kubectl delete -f infra/redis-deployment.yaml
   ```

## Performance Comparison

### Lambda Approach
- ✅ Serverless (no infrastructure management)
- ✅ Auto-scaling
- ❌ Vendor lock-in (AWS only)
- ❌ Cold start latency
- ❌ Limited execution time (15 minutes)
- ❌ Cost per invocation

### Redis + Workers Approach
- ✅ Cloud-agnostic (works anywhere)
- ✅ No execution time limits
- ✅ Better cost control
- ✅ Full control over infrastructure
- ✅ Works with MinIO (on-premise)
- ⚠️ Requires infrastructure management
- ⚠️ Manual scaling configuration

## Cost Comparison

### AWS Lambda (Example)
- Lambda invocations: ~$0.20 per million requests
- Lambda duration: $0.00001667 per GB-second
- Network egress: $0.09 per GB
- **Estimated monthly cost** (100 jobs/day, 15 min each): ~$50-100

### Redis + Workers (Example)
- Redis instance: $20-50/month
- Worker containers: $30-100/month (2-3 workers)
- Storage: Same as Lambda
- **Estimated monthly cost**: ~$50-150

**For on-premise deployments:** Essentially free (hardware already owned)

## Benefits of New System

1. **Cloud Agnostic** - Works with S3, MinIO, or any S3-compatible storage
2. **On-Premise Ready** - Deploy on your own infrastructure
3. **No Time Limits** - Process jobs as long as needed (not limited to 15 min)
4. **Better Observability** - Direct access to logs and metrics
5. **Easier Testing** - Run workers locally for development
6. **Cost Effective** - Better for high-volume workloads
7. **Horizontal Scaling** - Scale workers independently based on load

## Next Steps

1. ✅ Test job creation via API
2. ✅ Verify jobs are processed correctly
3. ✅ Monitor worker performance
4. ✅ Set up alerting for failed jobs
5. ✅ Configure auto-scaling for workers
6. ✅ Implement monitoring dashboards
7. 🔄 Add report generation worker (future)
8. 🔄 Implement job priorities (future)

## Support

For issues or questions:
1. Check worker logs first
2. Verify Redis connectivity
3. Review this guide
4. Check [workers/README.md](workers/README.md) for detailed documentation

## Conclusion

The migration from Lambda to Redis-based workers provides:
- Greater flexibility for deployment
- Support for on-premise infrastructure
- Better cost control for high-volume usage
- No vendor lock-in

The system maintains API compatibility, so no client changes are required.

