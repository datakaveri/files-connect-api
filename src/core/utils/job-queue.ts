/**
 * Job Queue Manager
 * Manages job queues and status using Redis
 */
import { executeRedisCommand } from "./redis-client";
import { createLogger } from "./logger";
import { env } from "../../config/environment";

const logger = createLogger("JobQueue");

// Job queue names
export const JOB_QUEUES = {
  ZIP: env.ZIP_QUEUE_NAME,
  REPORT: env.REPORT_QUEUE_NAME,
} as const;

/**
 * Get the queue key for a given job type
 * @param type - Job type (zip or report)
 * @returns Queue key string
 * @throws Error if job type is invalid
 */
function getQueueKey(type: string): string {
  if (type === "zip") {
    return JOB_QUEUES.ZIP;
  } else if (type === "report") {
    return JOB_QUEUES.REPORT;
  } else {
    throw new Error(`Invalid job type: ${type}. Valid types are: zip, report`);
  }
}

// Job data structure
export interface JobData {
  jobId: string;
  type: string;
  databankId: string;
  options?: any;
  createdAt: string;
}

// Job status structure
export interface JobStatus {
  jobId: string;
  type: string;
  status: string;
  databankId: string;
  progress?: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  result?: any;
  options?: any;
}

/**
 * Push a job to the queue
 * @param type - Job type (zip or report)
 * @param jobId - Unique job ID
 * @param databankId - Databank ID to process
 * @param options - Optional job options
 */
export async function pushJob(
  type: string,
  jobId: string,
  databankId: string,
  options?: any
): Promise<void> {
  // Determine the queue based on job type
  const queueKey = getQueueKey(type);

  // Create job data
  const jobData: JobData = {
    jobId,
    type,
    databankId,
    options,
    createdAt: new Date().toISOString(),
  };

  // Push job to queue (left push, workers pop from right)
  await executeRedisCommand("pushJob.lPush", (redis) =>
    redis.lPush(queueKey, JSON.stringify(jobData))
  );

  // Initialize job status in Redis hash
  const statusKey = `job:${jobId}`;
  await executeRedisCommand("pushJob.hSet", (redis) =>
    redis.hSet(statusKey, {
      jobId,
      type,
      status: "pending",
      databankId,
      progress: "0",
      createdAt: jobData.createdAt,
      options: options ? JSON.stringify(options) : "",
    })
  );

  // Set expiration for job status (7 days)
  await executeRedisCommand("pushJob.expire", (redis) =>
    redis.expire(statusKey, 7 * 24 * 60 * 60)
  );

  logger.info(`Job pushed to queue: ${jobId}`, {
    jobId,
    type,
    databankId,
    queueKey,
  });
}

/**
 * Update job status
 * @param jobId - Job ID to update
 * @param status - New status (pending, processing, completed, failed)
 * @param progress - Optional progress (0-100)
 * @param error - Optional error message
 * @param result - Optional result data
 */
export async function updateJobStatus(
  jobId: string,
  status: string,
  progress?: number,
  error?: string,
  result?: any
): Promise<void> {
  const statusKey = `job:${jobId}`;

  // Check if job exists
  const exists = await executeRedisCommand("updateJobStatus.exists", (redis) =>
    redis.exists(statusKey)
  );
  if (!exists) {
    logger.warn(`Attempted to update non-existent job: ${jobId}`);
    throw new Error(`Job not found: ${jobId}`);
  }

  // Prepare update data
  const updateData: Record<string, string> = {
    status,
  };

  if (progress !== undefined) {
    updateData.progress = Math.min(Math.max(0, progress), 100).toString();
  }

  if (error) {
    updateData.error = error;
  }

  if (result) {
    updateData.result = JSON.stringify(result);
  }

  // If job is completed or failed, set completedAt timestamp
  if (status === "completed" || status === "failed") {
    updateData.completedAt = new Date().toISOString();
  }

  // Update job status
  await executeRedisCommand("updateJobStatus.hSet", (redis) => redis.hSet(statusKey, updateData));

  logger.info(`Job status updated: ${jobId}`, {
    jobId,
    status,
    progress,
  });
}

/**
 * Get job status
 * @param jobId - Job ID to retrieve
 * @returns Job status or null if not found
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const statusKey = `job:${jobId}`;

  // Check if job exists
  const exists = await executeRedisCommand("getJobStatus.exists", (redis) =>
    redis.exists(statusKey)
  );
  if (!exists) {
    logger.debug(`Job not found: ${jobId}`);
    return null;
  }

  // Get all job data
  const jobData = await executeRedisCommand("getJobStatus.hGetAll", (redis) =>
    redis.hGetAll(statusKey)
  );

  if (!jobData || Object.keys(jobData).length === 0) {
    return null;
  }

  // Parse the job status
  const jobStatus: JobStatus = {
    jobId: jobData.jobId || "",
    type: jobData.type || "",
    status: jobData.status || "",
    databankId: jobData.databankId || "",
    createdAt: jobData.createdAt || "",
  };

  if (jobData.progress) {
    jobStatus.progress = parseInt(jobData.progress, 10);
  }

  if (jobData.completedAt) {
    jobStatus.completedAt = jobData.completedAt;
  }

  if (jobData.error) {
    jobStatus.error = jobData.error;
  }

  if (jobData.result) {
    try {
      jobStatus.result = JSON.parse(jobData.result);
    } catch (e) {
      // If parsing fails, store as string
      jobStatus.result = jobData.result;
    }
  }

  if (jobData.options) {
    try {
      jobStatus.options = JSON.parse(jobData.options);
    } catch (e) {
      // If parsing fails, store as string
      jobStatus.options = jobData.options;
    }
  }

  return jobStatus;
}

/**
 * Get queue length
 * @param type - Job type (zip or report)
 * @returns Number of jobs in the queue
 */
export async function getQueueLength(type: string): Promise<number> {
  const queueKey = getQueueKey(type);
  return await executeRedisCommand("getQueueLength.lLen", (redis) => redis.lLen(queueKey));
}

/**
 * Clear a job from Redis (cleanup)
 * @param jobId - Job ID to clear
 */
export async function clearJob(jobId: string): Promise<void> {
  const statusKey = `job:${jobId}`;
  await executeRedisCommand("clearJob.del", (redis) => redis.del(statusKey));
  logger.debug(`Job cleared: ${jobId}`);
}
