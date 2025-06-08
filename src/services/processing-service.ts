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
import axios, { AxiosRequestConfig, Method, AxiosRequestHeaders } from "axios";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/types";

// Interface for the status of a Lambda invocation attempt
interface LambdaInvocationStatus {
  success: boolean; // True if the request was successfully initiated
  message: string;  // Message about the initiation
}

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
  private zipLambdaUrl: string;
  private reportsLambdaUrl: string;

  /**
   * Creates a new ProcessingService instance
   * @param zipLambdaUrl - The URL of the Lambda function
   * @param reportsLambdaUrl - The URL of the Lambda function
   */
  constructor(zipLambdaUrl: string, reportsLambdaUrl: string) {
    this.zipLambdaUrl = zipLambdaUrl;
    this.reportsLambdaUrl = reportsLambdaUrl;
    logger.info("ProcessingService initialized", {
      zipLambdaUrl,
      reportsLambdaUrl,
    });
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
      // Trigger the Lambda function using the function name based on job type
      // Use the job type as the function name
      logger.info(`Triggering Lambda function for job: ${jobId}`, {
        jobId,
        functionName: jobType,
      });
      await this.triggerFunction(jobType, databankId);

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
    functionName: "zip" | "report",
    databankId: string
  ): Promise<LambdaInvocationStatus> {
    logger.debug("Triggering Lambda function", {
      functionName,
      databankId,
    });

    // Check if Lambda URL is configured
    if (!this.zipLambdaUrl && !this.reportsLambdaUrl) {
      throw new Error("Lambda URL not configured");
    }

    try {
      const enhancedPayload = {
        databankId,
        functionName,
      };
      const body = JSON.stringify(enhancedPayload);

      // Determine the correct Lambda URL based on functionName
      const targetLambdaUrl =
        functionName === "zip" ? this.zipLambdaUrl : this.reportsLambdaUrl;

      if (!targetLambdaUrl) {
        logger.error("Lambda URL not configured for function", undefined, {
          functionName,
          databankId,
        });
        throw new Error(`Lambda URL for ${functionName} not configured`);
      }

      if (
        !env.LAMBDA_ACCESS_KEY ||
        !env.LAMBDA_SECRET_KEY ||
        !env.LAMBDA_REGION
      ) {
        logger.error(
          "AWS Lambda credentials or region not configured in environment variables",
          undefined,
          { functionName, databankId }
        );
        throw new Error("AWS Lambda credentials or region not configured.");
      }

      const { hostname, pathname, protocol, search } = new URL(targetLambdaUrl);

      const request: HttpRequest = {
        method: "POST",
        protocol: protocol.slice(0, -1), // Remove trailing ':' e.g. 'https:' -> 'https'
        hostname: hostname,
        path: pathname,
        query: Object.fromEntries(new URLSearchParams(search)),
        headers: {
          "Content-Type": "application/json",
          host: hostname,
        },
        body: body,
      };

      const signer = new SignatureV4({
        credentials: {
          accessKeyId: env.LAMBDA_ACCESS_KEY,
          secretAccessKey: env.LAMBDA_SECRET_KEY,
        },
        region: env.LAMBDA_REGION,
        service: "lambda",
        sha256: Sha256,
      });

      const signedRequest = await signer.sign(request);

      const axiosConfig: AxiosRequestConfig = {
        method: signedRequest.method as Method,
        url: targetLambdaUrl,
        headers: signedRequest.headers as AxiosRequestHeaders,
        data: signedRequest.body,
        maxBodyLength: Infinity,
      };
      // Send the request but don't wait for the Lambda to complete
      axios.request(axiosConfig)
        .then(axiosResponse => {
          const result = axiosResponse.data as LambdaFunctionResult;
          if (
            axiosResponse.status < 200 ||
            axiosResponse.status >= 300 ||
            (result && result.success === false)
          ) {
            const errorDetails = result?.error
              ? JSON.stringify(result.error)
              : result?.message || "No additional error details";
            logger.error("Async Lambda function execution finished with an error", undefined, {
              functionName,
              databankId,
              statusCode: axiosResponse.status,
              responseData: result,
              errorDetails,
              async: true
            });
          } else {
            logger.debug("Async Lambda function execution completed successfully", {
              functionName,
              databankId,
              statusCode: axiosResponse.status,
              responseData: result,
              async: true
            });
          }
        })
        .catch(asyncError => {
          let logMessage = "Error during asynchronous Lambda execution";
          const errorContext: any = { functionName, databankId, async: true };
          if (axios.isAxiosError(asyncError)) {
            logMessage = `Axios error during async Lambda execution: ${asyncError.message}`;
            errorContext.axiosError = {
              message: asyncError.message,
              code: asyncError.code,
              config: asyncError.config ? { url: asyncError.config.url, method: asyncError.config.method } : undefined,
            };
            if (asyncError.response) {
              logMessage += ` - Lambda Response (${asyncError.response.status})`;
              errorContext.axiosError.response = {
                status: asyncError.response.status,
                data: asyncError.response.data,
              };
            }
          } else if (asyncError instanceof Error) {
            logMessage = `Error during async Lambda execution: ${asyncError.message}`;
            errorContext.genericError = { name: asyncError.name, message: asyncError.message };
          } else {
            errorContext.unknownError = asyncError;
          }
          logger.error(logMessage, asyncError instanceof Error ? asyncError : new Error(String(asyncError)), errorContext);
        });

      logger.info("Lambda function trigger initiated successfully via AWS Signature", {
        functionName,
        databankId,
      });

      return { success: true, message: "Lambda function trigger initiated." };
    } catch (error: any) {
      let errorMessage = "Error triggering Lambda function";
      let errorDetailsToLog: any = { functionName, databankId };

      if (axios.isAxiosError(error)) {
        errorMessage = `Axios error triggering Lambda: ${error.message}`;
        errorDetailsToLog.axiosError = {
          message: error.message,
          code: error.code,
          config: error.config
            ? {
                url: error.config.url,
                method: error.config.method,
                headers: error.config.headers,
              }
            : undefined,
        };
        if (error.response) {
          const lambdaError =
            error.response.data?.error ||
            error.response.data?.message ||
            JSON.stringify(error.response.data);
          errorMessage += ` - Lambda Response (${error.response.status}): ${lambdaError}`;
          errorDetailsToLog.axiosError.response = {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers,
          };
        } else if (error.request) {
          errorMessage += ` - No response received.`;
          errorDetailsToLog.axiosError.request = "No response received";
        }
      } else if (error instanceof Error) {
        errorMessage = error.message || "Unknown error during Lambda trigger";
        errorDetailsToLog.genericError = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else {
        errorMessage = "An unknown error occurred during Lambda trigger.";
        errorDetailsToLog.unknownError = error;
      }

      logger.error(
        "Error triggering Lambda function",
        error instanceof Error ? error : new Error(String(error)),
        errorDetailsToLog
      );
      // Log the synchronous error and return a failure status for the initiation
      // The logger.error call is already made just before this in the original code
      return { success: false, message: errorMessage };
    }
  }
}

/**
 * Create a new processing service instance
 * @returns A processing service instance
 */
export function createProcessingService(): ProcessingServiceInterface {
  const zipLambdaUrl = env.ZIP_LAMBDA_URL || "";
  const reportsLambdaUrl = env.REPORTS_LAMBDA_URL || "";

  if (!zipLambdaUrl || !reportsLambdaUrl) {
    logger.warn(
      "Lambda URL not configured, Lambda function triggers will not work"
    );
  }

  return new ProcessingServiceImpl(zipLambdaUrl, reportsLambdaUrl);
}
