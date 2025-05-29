/**
 * Processing Service
 * Handles creation and management of processing jobs for databanks
 * and interactions with Lambda functions for processing
 */
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../core/utils/logger";
import {
  NotFoundError,
  ValidationError,
} from "../core/errors/application-errors";
import { env } from "../config/environment";

// Create a logger for this module
const logger = createLogger("ProcessingService");

// Define processing job types
export enum ProcessingJobType {
  ZIP = "zip",
  REPORT = "report",
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
 * Interface for Lambda function result
 */
export interface LambdaFunctionResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Response message */
  message: string;
  /** Optional data returned by the function */
  data?: Record<string, unknown>;
  /** Optional error information */
  error?: {
    code: string;
    details?: unknown;
  };
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
    prefix?: string,
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
   * Triggers a Lambda function for processing
   * @param functionName - The name of the function to trigger
   * @param payload - The payload to send to the function
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the function response
   */
  triggerFunction(
    functionName: string,
    payload: Record<string, unknown>,
    databankId: string
  ): Promise<LambdaFunctionResult>;
}

/**
 * In-memory implementation of the Processing Service
 * In a production environment, this would use a database for persistence
 * Also handles Lambda function triggers for processing jobs
 */
class ProcessingServiceImpl implements ProcessingServiceInterface {
  private jobs: Map<string, ProcessingJob> = new Map();
  private lambdaUrl: string;

  /**
   * Creates a new ProcessingService instance
   * @param lambdaUrl - The URL of the Lambda function
   */
  constructor(lambdaUrl: string) {
    this.lambdaUrl = lambdaUrl;
    logger.info("ProcessingService initialized", { lambdaUrl });
  }

  /**
   * Create a new processing job and trigger the corresponding Lambda function
   * @param type - Type of job (zip or report)
   * @param databankId - ID of the databank
   * @param prefix - Optional prefix for processing specific files
   * @param options - Optional processing options
   * @returns The created job
   */
  async createJob(
    type: string,
    databankId: string,
    prefix?: string,
    options?: any
  ): Promise<ProcessingJob> {
    // Validate job type
    if (!Object.values(ProcessingJobType).includes(type as ProcessingJobType)) {
      throw new ValidationError(`Invalid job type: ${type}`);
    }

    // Create a new job
    const jobId = uuidv4();
    const jobType = type as ProcessingJobType;
    const job: ProcessingJob = {
      jobId,
      type: jobType,
      status: ProcessingJobStatus.PENDING,
      databankId,
      prefix,
      createdAt: new Date(),
      progress: 0,
      options,
    };

    // TODO: Store the job in a database instead of in-memory map
    // In a real implementation, this would be stored in a database
    this.jobs.set(jobId, job);

    // Log job creation
    logger.info(`Created processing job: ${jobId}`, {
      jobId,
      databankId,
      type: jobType,
    });

    // Trigger the Lambda function for processing
    try {
      // Prepare payload for the Lambda function
      const payload: Record<string, unknown> = {
        jobId,
        type: jobType,
        databankId,
        prefix: prefix || "",
        options: options || {},
      };

      // Trigger the Lambda function using the function name based on job type
      // Use the job type as the function name
      logger.info(`Triggering Lambda function for job: ${jobId}`, {
        jobId,
        functionName: jobType,
      });
      await this.triggerFunction(jobType, payload, databankId);

      // Update job status to PROCESSING
      job.status = ProcessingJobStatus.PROCESSING;
      this.jobs.set(jobId, job);
    } catch (error) {
      // If Lambda trigger fails, update job status to FAILED
      logger.error(
        `Failed to trigger Lambda function for job: ${jobId}`,
        error as Error
      );
      job.status = ProcessingJobStatus.FAILED;
      job.error = error instanceof Error ? error.message : String(error);
      this.jobs.set(jobId, job);
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
    // Get the job
    const job = await this.getJob(jobId, databankId);

    // Validate status
    if (
      !Object.values(ProcessingJobStatus).includes(
        status as ProcessingJobStatus
      )
    ) {
      throw new ValidationError(`Invalid job status: ${status}`);
    }

    // Update the job
    job.status = status as ProcessingJobStatus;

    if (progress !== undefined) {
      job.progress = Math.min(Math.max(0, progress), 100); // Ensure progress is between 0-100
    }

    if (error) {
      job.error = error;
    }

    if (result) {
      job.result = result;
    }

    // If the job is completed or failed, set the completedAt timestamp
    if (
      status === ProcessingJobStatus.COMPLETED ||
      status === ProcessingJobStatus.FAILED
    ) {
      job.completedAt = new Date();
    }

    // Store the updated job
    this.jobs.set(jobId, job);

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
    const job = this.jobs.get(jobId);

    if (!job || job.databankId !== databankId) {
      throw new NotFoundError(`Job not found: ${jobId}`);
    }

    return job;
  }

  /**
   * Triggers a Lambda function
   * @param functionName - The name of the function to trigger
   * @param payload - The payload to send to the function
   * @param databankId - The databank ID for authorization
   * @returns Promise resolving to the function response
   */
  async triggerFunction(
    functionName: string,
    payload: Record<string, unknown>,
    databankId: string
  ): Promise<LambdaFunctionResult> {
    logger.debug("Triggering Lambda function", {
      functionName,
      databankId,
      payloadKeys: Object.keys(payload),
    });

    // Check if Lambda URL is configured
    if (!this.lambdaUrl) {
      throw new Error("Lambda URL not configured");
    }

    try {
      // Add databank ID to payload
      const enhancedPayload = {
        ...payload,
        databankId,
        functionName,
      };

      // Call Lambda function
      const response = await fetch(this.lambdaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(enhancedPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Lambda function returned error: ${response.status} ${errorText}`
        );
      }

      const result = (await response.json()) as LambdaFunctionResult;

      logger.debug("Lambda function triggered successfully", {
        functionName,
        databankId,
        statusCode: response.status,
      });

      return result;
    } catch (error) {
      logger.error("Error triggering Lambda function", error as Error, {
        functionName,
        databankId,
      });
      throw error;
    }
  }
}

/**
 * Create a new processing service instance
 * @returns A processing service instance
 */
export function createProcessingService(): ProcessingServiceInterface {
  const lambdaUrl = env.LAMBDA_URL || "";

  if (!lambdaUrl) {
    logger.warn(
      "Lambda URL not configured, Lambda function triggers will not work"
    );
  }

  return new ProcessingServiceImpl(lambdaUrl);
}
