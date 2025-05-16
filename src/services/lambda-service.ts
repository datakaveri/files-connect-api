/**
 * Lambda Service
 * Handles interactions with AWS Lambda functions
 */
// Use global fetch API instead of node-fetch
import { createLogger } from '../core/utils/logger';
import { env } from '../config/environment';

/**
 * Type for the fetch Response
 */
type FetchResponse = {
  /** Whether the response was successful */
  ok: boolean;
  /** HTTP status code */
  status: number;
  /** Get response as text */
  text(): Promise<string>;
  /** Get response as JSON */
  json(): Promise<unknown>;
};

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
};

// Create a logger for this module
const logger = createLogger('LambdaService');

/**
 * Interface for Lambda service
 * Defines methods for interacting with Lambda functions
 */
export interface LambdaServiceInterface {
  /**
   * Triggers a Lambda function
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
 * Lambda Service implementation
 * Handles interactions with AWS Lambda functions
 */
export class LambdaService implements LambdaServiceInterface {
  private lambdaUrl: string;
  
  /**
   * Creates a new LambdaService instance
   * @param lambdaUrl - The URL of the Lambda function
   */
  constructor(lambdaUrl: string) {
    this.lambdaUrl = lambdaUrl;
    logger.info('LambdaService initialized', { lambdaUrl });
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
    logger.debug('Triggering Lambda function', { 
      functionName, 
      databankId,
      payloadKeys: Object.keys(payload)
    });
    
    try {
      // Add databank ID to payload
      const enhancedPayload = {
        ...payload,
        databankId,
        functionName,
      };
      
      // Call Lambda function
      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(enhancedPayload),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Lambda function returned error: ${response.status} ${errorText}`);
      }
      
      const result = await response.json();
      
      logger.debug('Lambda function triggered successfully', { 
        functionName, 
        databankId,
        statusCode: response.status
      });
      
      return result;
    } catch (error) {
      logger.error('Error triggering Lambda function', error as Error, { 
        functionName, 
        databankId 
      });
      throw error;
    }
  }
}

/**
 * Creates a new LambdaService instance with default configuration
 * @returns LambdaService instance
 */
export function createLambdaService(): LambdaService {
  const lambdaUrl = env.LAMBDA_URL || '';
  
  if (!lambdaUrl) {
    logger.warn('Lambda URL not configured, Lambda service will not work');
  }
  
  return new LambdaService(lambdaUrl);
}
