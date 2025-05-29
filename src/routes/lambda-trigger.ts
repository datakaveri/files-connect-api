import express, { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import axios from "axios";
import { authenticate, authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validation";
import { UserRole } from "../core/types/auth";
import { successResponse, errorResponse } from "../core/utils/response";

// Create a logger for this module
const logger = createLogger('LambdaTriggerRoutes');

// Define schema for Lambda trigger request
const lambdaTriggerSchema = z.object({
  databankId: z.string().min(1, 'Databank ID is required')
});

// Type for Lambda trigger request
export type LambdaTriggerRequest = z.infer<typeof lambdaTriggerSchema>;

/**
 * Create a new Express router for Lambda trigger operations
 */
export const lambdaTriggerRoutes = Router();

/**
 * Lambda trigger route
 * Triggers a Lambda function for processing a databank
 */
lambdaTriggerRoutes.post(
  '/',
  authenticate,
  authorize([UserRole.PROVIDER]), // Only providers can trigger Lambda functions
  validateBody(lambdaTriggerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get the validated request body directly from the request
      const body = req.body as LambdaTriggerRequest;
      // Validation middleware has already validated this body
      const databankId = body.databankId;
      
      logger.info(`Lambda trigger request received for databankId: ${databankId}`);
      
      // In a real implementation, this would call an AWS Lambda function
      // For now, we'll simulate the Lambda call
      const lambdaUrl = env.LAMBDA_URL || "https://lambda.example.com";
      
      logger.info(`Calling Lambda function at ${lambdaUrl} for databankId: ${databankId}`);
      
      try {
        // Simulate Lambda call
        // In production, this would be a real Lambda call
        // const response = await axios.post(lambdaUrl, {
        //   databankId
        // });
        
        // For development, we'll simulate the response
        const lambdaResponse = {
          success: true,
          message: `Lambda function called successfully for databank ${databankId}`,
          jobId: `job-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        };
        
        logger.info(`Lambda function called successfully for databank: ${databankId}, jobId: ${lambdaResponse.jobId}`);
        
        res.status(200).json({
          message: "Lambda function triggered successfully",
          databankId,
          jobId: lambdaResponse.jobId
        });
      } catch (lambdaError) {
        logger.error(`Error calling Lambda function: ${lambdaError instanceof Error ? lambdaError.message : String(lambdaError)}`);
        
        res.status(500).json({
          success: false,
          error: {
            message: "Failed to call Lambda function",
            code: "INTERNAL_SERVER_ERROR"
          }
        });
      }
    } catch (error) {
      // Handle errors
      logger.error(`Error processing Lambda trigger request: ${error instanceof Error ? error.message : String(error)}`);
      
      next(error);
    }
  }
);
