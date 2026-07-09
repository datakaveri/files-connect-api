"""
Readiness Worker
Polls Redis queue for readiness jobs and processes them
"""
import os
import sys
import signal
import logging
import json
import time
import redis
from redis.cluster import RedisCluster
from readiness_processor import process_readiness_job

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global flag for graceful shutdown
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global shutdown_requested
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_requested = True


def get_redis_client():
    """
    Create and return a Redis client (standalone or cluster).
    Use REDIS_CLUSTER=true when connecting to a Redis Cluster (e.g. in Kubernetes).
    """
    redis_host = os.environ.get('REDIS_HOST', 'localhost')
    redis_port = int(os.environ.get('REDIS_PORT', '6379'))
    redis_password = os.environ.get('REDIS_PASSWORD')
    redis_db = int(os.environ.get('REDIS_DB', '0'))
    use_cluster = (
        os.environ.get('REDIS_CLUSTER')
        or os.environ.get('REDIS_CLUSTER_MODE', '')
    ).lower() in ('1', 'true', 'yes')

    if use_cluster:
        logger.info(f"Connecting to Redis Cluster: {redis_host}:{redis_port}")
        cluster_config = {
            'host': redis_host,
            'port': redis_port,
            'decode_responses': True,
            'socket_connect_timeout': 5,
            'socket_keepalive': True,
            'dynamic_startup_nodes': os.environ.get(
                'REDIS_CLUSTER_DYNAMIC_STARTUP_NODES',
                'false',
            ).lower() in ('1', 'true', 'yes'),
        }
        if redis_password:
            cluster_config['password'] = redis_password
        try:
            client = RedisCluster(**cluster_config)
            client.ping()
            logger.info("Successfully connected to Redis Cluster")
            return client
        except Exception as e:
            logger.exception(f"Failed to connect to Redis Cluster: {str(e)}")
            raise
    else:
        logger.info(f"Connecting to Redis: {redis_host}:{redis_port}/{redis_db}")
        redis_config = {
            'host': redis_host,
            'port': redis_port,
            'db': redis_db,
            'decode_responses': True,
            'socket_connect_timeout': 5,
            'socket_keepalive': True,
            'health_check_interval': 30
        }
        if redis_password:
            redis_config['password'] = redis_password
        try:
            client = redis.Redis(**redis_config)
            client.ping()
            logger.info(f"Successfully connected to Redis database {redis_db}")
            return client
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {str(e)}")
            raise


def update_job_status(redis_client, job_id, status, progress=None, error=None, result=None):
    """
    Update job status in Redis
    """
    try:
        status_key = f"job:{job_id}"
        
        # Check if job exists
        if not redis_client.exists(status_key):
            logger.warning(f"Job {job_id} not found in Redis, cannot update status")
            return
        
        update_data = {
            'status': status
        }
        
        if progress is not None:
            update_data['progress'] = str(progress)
        
        if error:
            update_data['error'] = error
        
        if result:
            update_data['result'] = json.dumps(result)
        
        # If job is completed or failed, set completedAt
        if status in ['completed', 'failed']:
            from datetime import datetime
            update_data['completedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        redis_client.hset(status_key, mapping=update_data)
        logger.info(f"Updated job {job_id} status to {status}")
        
    except Exception as e:
        logger.error(f"Failed to update job status: {str(e)}")


def process_job(redis_client, job_data):
    """
    Process a single job
    """
    try:
        # Parse job data
        job_info = json.loads(job_data)
        job_id = job_info.get('jobId')
        databank_id = job_info.get('databankId')
        job_type = job_info.get('type')
        
        logger.info(f"Processing job {job_id} for databank {databank_id}")
        
        # Update status to processing
        update_job_status(redis_client, job_id, 'processing', progress=0)
        
        # Process the readiness job
        result = process_readiness_job(databank_id)
        
        # Update final status
        if result.get('success'):
            logger.info(f"Job {job_id} completed successfully")
            update_job_status(
                redis_client,
                job_id,
                'completed',
                progress=100,
                result=result
            )
        else:
            logger.error(f"Job {job_id} failed: {result.get('error')}")
            update_job_status(
                redis_client,
                job_id,
                'failed',
                error=result.get('error'),
                result=result
            )
        
        return True
        
    except Exception as e:
        logger.error(f"Error processing job: {str(e)}", exc_info=True)
        # Try to update job status to failed
        try:
            if 'job_id' in locals():
                update_job_status(
                    redis_client,
                    job_id,
                    'failed',
                    error=f"Worker error: {str(e)}"
                )
        except:
            pass
        return False


def worker_loop():
    """
    Main worker loop - polls Redis queue and processes jobs
    """
    global shutdown_requested
    
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    logger.info("Starting readiness worker...")
    
    # Validate required environment variables
    # S3_ACCESS_KEY/S3_SECRET_KEY are only required for S3/MinIO; GCS authenticates via
    # GCS_KEY_FILE, GCS_CLIENT_EMAIL/GCS_PRIVATE_KEY, or Application Default Credentials.
    storage_provider = os.environ.get('STORAGE_PROVIDER', 's3').lower()
    required_vars = ['BUCKET_NAME']
    if storage_provider != 'gcs':
        required_vars += ['S3_ACCESS_KEY', 'S3_SECRET_KEY']
    missing_vars = [var for var in required_vars if not os.environ.get(var)]

    if missing_vars:
        logger.error(f"Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)
    
    # Connect to Redis
    try:
        redis_client = get_redis_client()
    except Exception as e:
        logger.error(f"Failed to initialize Redis client: {str(e)}")
        sys.exit(1)
    
    # Queue name for report jobs. READINESS_QUEUE_NAME is kept as a legacy alias.
    queue_name = os.environ.get('REPORT_QUEUE_NAME', os.environ.get('READINESS_QUEUE_NAME', 'jobs:report'))
    logger.info(f"Listening on queue: {queue_name}")
    
    # Main loop
    consecutive_errors = 0
    max_consecutive_errors = 5
    
    while not shutdown_requested:
        try:
            # Block and wait for a job (with 1 second timeout for checking shutdown flag)
            result = redis_client.brpop(queue_name, timeout=1)
            
            if result:
                # Reset error counter on successful pop
                consecutive_errors = 0
                
                queue, job_data = result
                logger.info(f"Received job from queue: {queue}")
                
                # Process the job
                success = process_job(redis_client, job_data)
                
                if success:
                    logger.info("Job processed successfully")
                else:
                    logger.warning("Job processing failed")
            
            # If no job available, just continue (allows checking shutdown flag)
            
        except redis.ConnectionError as e:
            consecutive_errors += 1
            logger.error(f"Redis connection error: {str(e)}")
            
            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"Max consecutive errors ({max_consecutive_errors}) reached, exiting")
                break
            
            # Wait before retrying
            logger.info(f"Waiting 5 seconds before retry (attempt {consecutive_errors}/{max_consecutive_errors})")
            time.sleep(5)
            
            # Try to reconnect
            try:
                redis_client = get_redis_client()
                consecutive_errors = 0  # Reset on successful reconnect
            except Exception as reconnect_error:
                logger.error(f"Failed to reconnect: {str(reconnect_error)}")
        
        except Exception as e:
            consecutive_errors += 1
            logger.error(f"Unexpected error in worker loop: {str(e)}", exc_info=True)
            
            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"Max consecutive errors ({max_consecutive_errors}) reached, exiting")
                break
            
            # Wait before continuing
            time.sleep(5)
    
    # Cleanup
    logger.info("Worker shutting down...")
    try:
        redis_client.close()
    except:
        pass
    
    logger.info("Worker stopped")


if __name__ == '__main__':
    try:
        worker_loop()
    except Exception as e:
        logger.error(f"Fatal error in worker: {str(e)}", exc_info=True)
        sys.exit(1)
