/**
 * Processing Service
 * Handles creation and management of processing jobs for databanks
 * Uses Redis job queue for async processing by worker containers
 */
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../core/utils/logger";
import {
  NotFoundError,
  ValidationError,
} from "../core/errors/application-errors";
import {
  pushJob,
  getJobStatus,
  updateJobStatus as updateJobStatusInQueue,
} from "../core/utils/job-queue";

// Create a logger for this module
const logger = createLogger("ProcessingService");

// Define processing job types
export enum ProcessingJobType {
  ZIP = "zip",
  READINESS = "readiness",
  REPORT = "report", // Deprecated, use READINESS instead
}

// Define processing job status
export enum ProcessingJobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

// Define the job object interface
export interface ProcessingJob {
  jobId: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  databankId: string;
  prefix?: string;
  createdAt: Date;
  progress?: number;
  completedAt?: Date;
  error?: string;
  result?: any;
  options?: any;
}

/**
 * Interface for job trigger result
 */
export interface JobTriggerResult {
  /** Whether the job was successfully queued */
  success: boolean;
  /** Response message */
  message: string;
}

// Define the processing service interface
export interface ProcessingServiceInterface {
  /**
   * Create a new processing job
   * @param type - Type of job (zip or report)
   * @param databankId - ID of the databank
   * @param prefix - Optional prefix for processing specific files
   * @param options - Optional processing options
   * @returns The created job
   */
  createJob(
    type: string,
    databankId: string,
    options?: any
  ): Promise<ProcessingJob>;

  /**
   * Update the status of a processing job
   * @param jobId - ID of the job to update
   * @param databankId - ID of the databank
   * @param status - New status for the job
   * @param progress - Optional progress value (0-100)
   * @param error - Optional error message if job failed
   * @param result - Optional result data if job completed
   * @returns The updated job
   */
  updateJobStatus(
    jobId: string,
    databankId: string,
    status: string,
    progress?: number,
    error?: string,
    result?: any
  ): Promise<ProcessingJob>;

  /**
   * Get a processing job by ID
   * @param jobId - ID of the job to retrieve
   * @param databankId - ID of the databank
   * @returns The job if found
   */
  getJob(jobId: string, databankId: string): Promise<ProcessingJob>;

  /**
   * Triggers a job in the queue for processing
   * @param functionName - The name of the function to trigger
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the trigger result
   */
  triggerFunction(
    functionName: string,
    databankId: string
  ): Promise<JobTriggerResult>;
}

/**
 * Redis-based implementation of the Processing Service
 * Uses Redis for job queue management and status tracking
 */
class ProcessingServiceImpl implements ProcessingServiceInterface {
  constructor() {
    logger.info("ProcessingService initialized with Redis job queue");
  }

  /**
   * Create a new processing job and push it to the Redis queue
   * @param type - Type of job (zip or report)
   * @param databankId - ID of the databank
   * @param options - Optional processing options
   * @returns The created job
   */
  async createJob(
    type: string,
    databankId: string,
    options?: any
  ): Promise<ProcessingJob> {
    // Validate job type
    if (!Object.values(ProcessingJobType).includes(type as ProcessingJobType)) {
      throw new ValidationError(`Invalid job type: ${type}`);
    }

    // Create a new job
    const jobId = uuidv4();
    const jobType = type as ProcessingJobType;
    const createdAt = new Date();
    
    const job: ProcessingJob = {
      jobId,
      type: jobType,
      status: ProcessingJobStatus.PENDING,
      databankId,
      createdAt,
      progress: 0,
      options,
    };

    // Log job creation
    logger.info(`Created processing job: ${jobId}`, {
      jobId,
      databankId,
      type: jobType,
    });

    // Push job to Redis queue for processing
    try {
      logger.info(`Pushing job to Redis queue: ${jobId}`, {
        jobId,
        type: jobType,
      });
      
      await pushJob(jobType, jobId, databankId, options);
      
      logger.info(`Job successfully queued: ${jobId}`);
    } catch (error) {
      // If queue push fails, mark job as failed
      logger.error(
        `Failed to push job to queue: ${jobId}`,
        error as Error
      );
      job.status = ProcessingJobStatus.FAILED;
      job.error = error instanceof Error ? error.message : String(error);
      
      // Still try to update status in Redis
      try {
        await updateJobStatusInQueue(
          jobId,
          ProcessingJobStatus.FAILED,
          0,
          job.error
        );
      } catch (updateError) {
        logger.error("Failed to update job status after queue error", updateError as Error);
      }
    }

    return job;
  }

  /**
   * Update the status of a processing job
   * @param jobId - ID of the job to update
   * @param databankId - ID of the databank
   * @param status - New status for the job
   * @param progress - Optional progress value (0-100)
   * @param error - Optional error message if job failed
   * @param result - Optional result data if job completed
   * @returns The updated job
   */
  async updateJobStatus(
    jobId: string,
    databankId: string,
    status: string,
    progress?: number,
    error?: string,
    result?: any
  ): Promise<ProcessingJob> {
    // Validate status
    if (
      !Object.values(ProcessingJobStatus).includes(
        status as ProcessingJobStatus
      )
    ) {
      throw new ValidationError(`Invalid job status: ${status}`);
    }

    // Update job status in Redis
    await updateJobStatusInQueue(jobId, status, progress, error, result);

    // Get the updated job
    const job = await this.getJob(jobId, databankId);

    logger.info(
      `Updated processing job: ${jobId}, status: ${status}, progress: ${progress}`
    );

    return job;
  }

  /**
   * Get a processing job by ID
   * @param jobId - ID of the job to retrieve
   * @param databankId - ID of the databank
   * @returns The job if found
   * @throws NotFoundError if the job doesn't exist
   */
  async getJob(jobId: string, databankId: string): Promise<ProcessingJob> {
    // Get job status from Redis
    const jobStatus = await getJobStatus(jobId);

    if (!jobStatus || jobStatus.databankId !== databankId) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    // Convert JobStatus to ProcessingJob
    const job: ProcessingJob = {
      jobId: jobStatus.jobId,
      type: jobStatus.type as ProcessingJobType,
      status: jobStatus.status as ProcessingJobStatus,
      databankId: jobStatus.databankId,
      createdAt: new Date(jobStatus.createdAt),
      progress: jobStatus.progress,
      error: jobStatus.error,
      result: jobStatus.result,
      options: jobStatus.options,
    };

    if (jobStatus.completedAt) {
      job.completedAt = new Date(jobStatus.completedAt);
    }

    return job;
  }

  /**
   * Triggers a job in the queue for processing
   * Note: This method exists for backward compatibility but the actual
   * job queuing happens in createJob()
   * @param functionName - The name of the function to trigger
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the trigger result
   */
  async triggerFunction(
    functionName: "zip" | "report",
    databankId: string
  ): Promise<JobTriggerResult> {
    logger.debug("Job trigger called (queue-based)", {
      functionName,
      databankId,
    });

    // This is now handled by pushJob in createJob method
    // This method exists primarily for backward compatibility
    return {
      success: true,
      message: "Job queued for processing",
    };
  }
}

/**
 * Create a new processing service instance
 * @returns A processing service instance
 */
export function createProcessingService(): ProcessingServiceInterface {
  return new ProcessingServiceImpl();
}
