/**
 * Processing Routes
 * Handles REST operations for databank processing jobs
 */
import express, { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { openApiDocument, registerPath } from "../config/openapi";
import { 
  authenticate, 
  authorize 
} from "../middleware/auth";
import { validateBody } from "../middleware/validation";
import { errorHandler } from "../middleware/error-handler";
import { requestContext, responseLogger } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { successResponse, errorResponse, notFoundResponse } from "../core/utils/response";
import { HttpStatusCode, ErrorCode } from "../core/types/response";

// Create a logger for this module
const logger = createLogger('ProcessingRoutes');

// Define schema for processing job request
const processingJobSchema = z.object({
  databankId: z.string().min(1, 'Databank ID is required'),
  // Optional job configuration
  config: z.object({
    createZip: z.boolean().optional().default(true),
    generateReport: z.boolean().optional().default(true),
    zipOptions: z.object({
      includeMetadata: z.boolean().optional().default(true),
      compression: z.enum(['standard', 'maximum', 'none']).optional().default('standard')
    }).optional(),
    reportOptions: z.object({
      type: z.enum(['summary', 'detailed', 'compliance']).optional().default('summary'),
      format: z.enum(['pdf', 'json', 'csv']).optional().default('pdf')
    }).optional()
  }).optional().default({})
});

// Type for job request
type ProcessingJobRequest = z.infer<typeof processingJobSchema>;

/**
 * Create a new Express router for processing operations
 */
export const processingRoutes = Router();

// Apply common middleware to all routes
processingRoutes.use(requestContext);

// Register this path in the OpenAPI document
registerPath({
  path: '/processing/jobs',
  method: 'post',
  tags: ['Processing'],
  summary: 'Create a new processing job',
  description: 'Creates a new job for databank processing (zip creation and/or report generation)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: processingJobSchema
        }
      }
    }
  },
  responses: {
    '201': {
      description: 'Job created successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              jobId: z.string(),
              status: z.string(),
              databankId: z.string(),
              operations: z.object({
                createZip: z.boolean(),
                generateReport: z.boolean()
              }),
              config: z.object({
                zipOptions: z.object({
                  includeMetadata: z.boolean(),
                  compression: z.enum(['standard', 'maximum', 'none'])
                }),
                reportOptions: z.object({
                  type: z.enum(['summary', 'detailed', 'compliance']),
                  format: z.enum(['pdf', 'json', 'csv'])
                })
              }),
              createdAt: z.string(),
              estimatedCompletionTime: z.string()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string(),
              processingTimeMs: z.number().optional()
            })
          })
        }
      }
    }
  }
});

/**
 * POST /processing/jobs
 * Create a processing job for a databank (zip creation and/or report generation)
 */
processingRoutes.post(
  '/jobs',
  authenticate,
  authorize([UserRole.PROVIDER]),
  validateBody(processingJobSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as ProcessingJobRequest;
      const databankId = body.databankId;
      const config = body.config || {};
      
      // Determine which operations to perform
      const createZip = config.createZip !== false; // Default to true if not specified
      const generateReport = config.generateReport !== false; // Default to true if not specified
      
      // Log the job request
      logger.info(`Processing job request for databankId: ${databankId}, createZip: ${createZip}, generateReport: ${generateReport}`);
      
      // In a real implementation, this would call AWS Lambda functions
      // to trigger the zip creation and report generation processes
      
      // Generate a unique job ID
      const jobId = `proc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      // Start performance measurement
      const startTime = Date.now();
      
      // Create response data
      const responseData = {
        jobId,
        status: 'submitted',
        databankId,
        operations: {
          createZip,
          generateReport
        },
        config: {
          zipOptions: config.zipOptions || { includeMetadata: true, compression: 'standard' },
          reportOptions: config.reportOptions || { type: 'summary', format: 'pdf' }
        },
        createdAt: new Date().toISOString(),
        estimatedCompletionTime: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes from now
      };
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Return standardized success response
      successResponse(
        responseData,
        res,
        HttpStatusCode.CREATED,
        processingTime
      );
    } catch (error) {
      logger.error(`Error submitting processing job: ${error instanceof Error ? error.message : String(error)}`);
      
      next(error);
    }
  }
);

/**
 * GET /processing/jobs/:jobId
 * Get the status of a processing job
 */
registerPath({
  method: 'get',
  path: '/processing/jobs/:jobId',
  tags: ['Processing'],
  summary: 'Get processing job status',
  description: 'Retrieves the current status of a processing job',
  request: {
    params: z.object({
      jobId: z.string().min(1, 'Job ID is required')
    })
  },
  responses: {
    '200': {
      description: 'Job status retrieved successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              jobId: z.string(),
              status: z.enum(['pending', 'in-progress', 'completed', 'failed']),
              progress: z.number().int().min(0).max(100),
              lastUpdated: z.string(),
              results: z.object({
                zip: z.object({
                  complete: z.boolean(),
                  zipKey: z.string().optional(),
                  size: z.number().optional(),
                  fileCount: z.number().int().optional()
                }).optional(),
                report: z.object({
                  complete: z.boolean(),
                  reportKey: z.string().optional(),
                  pageCount: z.number().int().optional(),
                  summary: z.string().optional()
                }).optional()
              }).nullable()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string(),
              processingTimeMs: z.number().optional()
            })
          })
        }
      }
    },
    '401': {
      description: 'Unauthorized - Authentication required',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '403': {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '404': {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '500': {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    }
  }
});

processingRoutes.get(
  '/jobs/:jobId',
  authenticate,
  authorize([UserRole.PROVIDER]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.jobId;
      
      // Validate job ID format
      if (!jobId || !jobId.startsWith('proc-')) {
        return notFoundResponse(res, `Job not found: ${jobId}`);
      }
      
      logger.info(`Job status request for jobId: ${jobId}`);
      
      // In a real implementation, this would check the status in a database
      // For now, we'll simulate a response
      
      // Start performance measurement
      const startTime = Date.now();
      
      // Randomly determine job status for demo purposes
      const statusOptions = ['pending', 'in-progress', 'completed', 'failed'];
      const randomIndex = Math.floor(Math.random() * statusOptions.length);
      const status = statusOptions[randomIndex];
      
      if (status === 'failed') {
        return errorResponse(
          res,
          'Simulated failure for demonstration purposes',
          ErrorCode.PROCESSING_FAILED,
          HttpStatusCode.OK,
          {
            jobId,
            status,
            lastUpdated: new Date().toISOString()
          }
        );
      }
      
      // Build response with results for completed jobs
      const dbId = databankId(jobId); // Extract the databank ID once
      
      // Create response data
      const responseData = {
        jobId,
        status,
        progress: status === 'completed' ? 100 : Math.floor(Math.random() * 100),
        lastUpdated: new Date().toISOString(),
        results: status === 'completed' ? {
          zip: {
            complete: true,
            zipKey: `zips/${dbId}.zip`,
            size: Math.floor(Math.random() * 1000000) + 1000000, // Random size between 1-2MB
            fileCount: Math.floor(Math.random() * 100) + 50 // Random file count
          },
          report: {
            complete: true,
            reportKey: `reports/${dbId}.pdf`,
            pageCount: Math.floor(Math.random() * 20) + 5, // Random page count
            summary: 'Report generated successfully'
          }
        } : null
      };
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Return standardized success response
      successResponse(
        responseData,
        res,
        HttpStatusCode.OK,
        processingTime
      );
    } catch (error) {
      logger.error(`Error getting job status: ${error instanceof Error ? error.message : String(error)}`);
      
      errorResponse(
        res,
        "Failed to get job status",
        ErrorCode.UNKNOWN_ERROR,
        HttpStatusCode.INTERNAL_SERVER_ERROR
      );
    }
  }
);

/**
 * GET /processing/jobs/:jobId
 * Get details about a specific processing job
 */
registerPath({
  method: 'get',
  path: '/processing/jobs/:jobId',
  tags: ['Processing'],
  summary: 'Get job details',
  description: 'Retrieves details about a specific processing job',
  request: {
    params: z.object({
      jobId: z.string().min(1, 'Job ID is required')
    })
  },
  responses: {
    '200': {
      description: 'Job details retrieved successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              jobId: z.string(),
              status: z.enum(['submitted', 'in-progress', 'completed', 'failed']),
              databankId: z.string(),
              progress: z.number(),
              createdAt: z.string(),
              updatedAt: z.string(),
              completedAt: z.string().optional(),
              result: z.object({
                zipUrl: z.string().optional(),
                reportUrl: z.string().optional()
              }).optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string(),
              processingTimeMs: z.number().optional()
            })
          })
        }
      }
    },
    '404': {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    }
  }
});

processingRoutes.get(
  '/jobs/:jobId',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.jobId || '';
      
      if (!jobId) {
        return notFoundResponse(res, 'Job ID is required');
      }
      
      logger.info(`Job details request received for jobId: ${jobId}`);
      
      // In a real implementation, this would fetch job details from a database
      // For this example, we'll return mock data
      
      // Check if job exists (mock implementation)
      if (jobId.startsWith('proc-')) {
        // Mock job data
        const responseData = {
          jobId,
          status: 'completed' as const,
          databankId: 'databank-123',
          progress: 100,
          createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          updatedAt: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
          completedAt: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
          result: {
            zipUrl: `https://example.com/download/databank-123.zip`,
            reportUrl: `https://example.com/reports/databank-123.pdf`
          }
        };
        
        successResponse(responseData, res);
      } else {
        // Job not found
        notFoundResponse(res, `Job ${jobId} not found`);
      }
    } catch (error) {
      logger.error(`Error retrieving job details: ${error instanceof Error ? error.message : String(error)}`);
      
      next(error);
    }
  }
);

/**
 * DELETE /processing/jobs/:jobId
 * Cancel a processing job
 */
registerPath({
  method: 'delete',
  path: '/processing/jobs/:jobId',
  tags: ['Processing'],
  summary: 'Cancel processing job',
  description: 'Cancels a running processing job',
  request: {
    params: z.object({
      jobId: z.string().min(1, 'Job ID is required')
    })
  },
  responses: {
    '200': {
      description: 'Job cancelled successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              jobId: z.string(),
              status: z.literal('cancelled'),
              message: z.string(),
              cancelledAt: z.string()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string(),
              processingTimeMs: z.number().optional()
            })
          })
        }
      }
    },
    '401': {
      description: 'Unauthorized - Authentication required',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '403': {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '404': {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '409': {
      description: 'Conflict - Job already completed or cancelled',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    },
    '500': {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            error: z.object({
              code: z.string(),
              message: z.string(),
              details: z.any().optional()
            }),
            meta: z.object({
              requestId: z.string(),
              timestamp: z.string()
            })
          })
        }
      }
    }
  }
});

processingRoutes.delete(
  '/jobs/:jobId',
  authenticate,
  authorize([UserRole.PROVIDER]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.jobId;
      
      // Validate job ID format
      if (!jobId || !jobId.startsWith('proc-')) {
        return notFoundResponse(res, `Job not found: ${jobId}`);
      }
      
      logger.info(`Job cancellation request for jobId: ${jobId}`);
      
      // In a real implementation, this would cancel the job in a database
      // and stop any running processes
      
      // Start performance measurement
      const startTime = Date.now();
      
      // Simulate a small chance that the job is already completed
      if (Math.random() < 0.2) {
        return errorResponse(
          res,
          'Job cannot be cancelled because it is already completed',
          ErrorCode.CONFLICT,
          HttpStatusCode.CONFLICT
        );
      }
      
      // Create response data for successful cancellation
      const responseData = {
        jobId,
        status: 'cancelled' as const,
        message: 'Job was successfully cancelled',
        cancelledAt: new Date().toISOString()
      };
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      
      // Return standardized success response
      successResponse(
        responseData,
        res,
        HttpStatusCode.OK,
        processingTime
      );
    } catch (error) {
      logger.error(`Error cancelling job: ${error instanceof Error ? error.message : String(error)}`);
      
      errorResponse(
        res,
        "Failed to cancel job",
        ErrorCode.UNKNOWN_ERROR,
        HttpStatusCode.INTERNAL_SERVER_ERROR
      );
    }
  }
);

/**
 * Helper function to extract a databank ID from a job ID
 * @param jobId Job ID
 * @returns Databank ID
 */
function databankId(jobId: string): string {
  // Extract the timestamp portion from the job ID as the databank ID
  // In a real implementation, this would be properly tracked in a database
  if (!jobId) return 'unknown';
  const parts = jobId.split('-');
  return parts.length > 1 && parts[1] ? parts[1] : 'unknown';
}

/**
 * Creates a new processing routes instance
 * @returns Processing routes instance
 */
export function createProcessingRoutes() {
  return processingRoutes;
}
