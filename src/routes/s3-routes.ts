/**
 * S3 Routes
 * Handles S3 operations like listing, downloading, and deleting files and folders
 */
import { Hono, Context, Next } from "hono";
import { createLogger } from "../core/utils/logger";
import { createS3Service, S3ServiceInterface } from "../services/s3-service";
import { 
  listObjectsSchema, 
  getObjectSchema, 
  createFolderSchema, 
  deleteObjectSchema,
  folderDeleteSchema
} from "../core/validators/schemas";
import { 
  authenticate, 
  authorize, 
  authorizeProvider 
} from "../middleware/auth";
import { validateBody, VALIDATED_BODY } from "../middleware/validation";
import { errorBoundary } from "../middleware/error-handler";
import { requestLogger, requestContext } from "../middleware/logger";
import { UserRole } from "../core/types/auth";
import { 
  ApplicationError, 
  NotFoundError, 
  ValidationError, 
  S3Error 
} from "../core/errors/application-errors";
import { env } from "../config/environment";
import { S3Object, S3ObjectBase } from "../core/types/file";
import {
  ListObjectsRequest,
  ListObjectsResponse,
  GetObjectRequest,
  GetObjectResponse,
  GetObjectDetailsResponse,
  CreateFolderRequest,
  CreateFolderResponse,
  DeleteObjectRequest,
  DeleteObjectResponse,
  DeleteFolderResponse
} from "../core/types/s3-routes";
import { S3Constants } from "../config/constants";

// Create a logger for this module
const logger = createLogger('S3Routes');

// Create service instance
const s3Service = createS3Service();

/**
 * Create a new Hono router for S3 operations
 */
export const s3Routes = new Hono();

// Apply common middleware to all routes
s3Routes.use('*', errorBoundary, requestContext, requestLogger);

/**
 * List objects route
 * Lists files and folders in an S3 bucket with pagination
 */

// POST endpoint for listing objects
s3Routes.post(
  '/list',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  validateBody(listObjectsSchema),
  async (c: Context) => {
    try {
      const body = (c as any)[VALIDATED_BODY] as ListObjectsRequest;
      const databankId = c.get('databankId') as string;
      
      logger.info(`Listing S3 objects: prefix=${body.prefix}, maxKeys=${body.maxKeys}, databankId=${databankId}`);
      
      // Get the delimiter from the request or use the default
      const delimiter = body.delimiter || '/';
      
      // List objects using the S3 service
      const objects = await s3Service.listObjects(
        body.prefix || '',
        databankId,
        body.maxKeys,
        delimiter
      );
      
      // Separate files and folders
      const files: S3Object[] = [];
      const folders: S3Object[] = [];
      
      // Process the objects
      objects.forEach(obj => {
        // Check if it's a folder (either by isFolder property or by checking if isFile is false)
        if ('isFolder' in obj && obj.isFolder || obj.isFile === false) {
          folders.push(obj);
        } else {
          files.push(obj);
        }
      });
      
      // Create the response
      const response: ListObjectsResponse = {
        files,
        folders,
        // TODO: Handle continuation token if needed
        nextContinuationToken: undefined
      };
      
      logger.info(`Listed ${files.length} files and ${folders.length} folders`);
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error listing S3 objects: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to list objects: ${error instanceof Error ? error.message : String(error)}`,
        'listObjects'
      );
    }
  }
);

// GET endpoint for listing objects with query parameters
s3Routes.get(
  '/list',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  async (c: Context) => {
    try {
      // Extract query parameters
      const maxKeys = c.req.query('maxKeys') ? parseInt(c.req.query('maxKeys') as string) : undefined;
      const prefix = c.req.query('prefix') || '';
      
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      logger.info(`Listing S3 objects via GET: prefix=${prefix}, maxKeys=${maxKeys}, databankId=${databankId}`);
      
      // List objects using the S3 service
      const objects = await s3Service.listObjects(
        prefix,
        databankId,
        maxKeys,
        '/'
      );
      
      // Separate files and folders
      const files: S3Object[] = [];
      const folders: S3Object[] = [];
      
      // Process the objects
      objects.forEach(obj => {
        // Check if it's a folder (either by isFolder property or by checking if isFile is false)
        if ('isFolder' in obj && obj.isFolder || obj.isFile === false) {
          folders.push(obj);
        } else {
          files.push(obj);
        }
      });
      
      // Create the response
      const response: ListObjectsResponse = {
        files,
        folders,
        // TODO: Handle continuation token if needed
        nextContinuationToken: undefined
      };
      
      logger.info(`Listed ${files.length} files and ${folders.length} folders via GET`);
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error listing S3 objects via GET: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to list objects: ${error instanceof Error ? error.message : String(error)}`,
        'listObjects'
      );
    }
  }
);

/**
 * Get object (download) route
 * Generates a presigned URL for downloading an object
 */
s3Routes.post(
  '/download',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  // Add middleware to inject databankId into the validation process
  async (c: Context, next: Next) => {
    try {
      // Get the request body
      const body = await c.req.json();
      
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      // Add the databankId to the body
      const modifiedBody = { ...body, databankId };
      
      // Validate the body directly
      const validatedBody = getObjectSchema.parse(modifiedBody);
      
      // Set the validated body directly on the context
      (c as any)[VALIDATED_BODY] = validatedBody;
      
      // Skip the validateBody middleware
      c.set('skip-validation', true);
      
      await next();
    } catch (error) {
      logger.error(`Error injecting databankId: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(getObjectSchema),
  async (c: Context) => {
    try {
      const body = (c as any)[VALIDATED_BODY] as GetObjectRequest;
      const databankId = c.get('databankId') as string;
      
      logger.info(`Generating download URL: ${body.key}, databankId: ${databankId}`);
      
      // Set default expiration if not provided
      const expiresIn = body.expiresIn || S3Constants.DEFAULT_PRESIGNED_URL_EXPIRATION;
      
      // Generate presigned URL
      const url = await s3Service.createPresignedUrl(
        body.key,
        databankId,
        expiresIn
      );
      
      logger.info(`Generated download URL for: ${body.key}`);
      
      // Create the response
      const response: GetObjectResponse = {
        url,
        key: body.key,
        expiresIn
      };
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error generating download URL: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to generate download URL: ${error instanceof Error ? error.message : String(error)}`,
        'createPresignedUrl'
      );
    }
  }
);

/**
 * Get object details route
 * Gets details about a specific object in the S3 bucket
 */
s3Routes.post(
  '/object',
  authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER]),
  // Add middleware to inject databankId into the validation process
  async (c: Context, next: Next) => {
    try {
      // Get the request body
      const body = await c.req.json();
      
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      // Add the databankId to the body
      const modifiedBody = { ...body, databankId };
      
      // Validate the body directly
      const validatedBody = getObjectSchema.parse(modifiedBody);
      
      // Set the validated body directly on the context
      (c as any)[VALIDATED_BODY] = validatedBody;
      
      // Skip the validateBody middleware
      c.set('skip-validation', true);
      
      await next();
    } catch (error) {
      logger.error(`Error processing object request: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(getObjectSchema),
  async (c: Context) => {
    try {
      const body = (c as any)[VALIDATED_BODY] as GetObjectRequest;
      const databankId = c.get('databankId') as string;
      
      logger.info(`Getting object details: ${body.key}, databankId: ${databankId}`);
      
      // Get object details
      const details = await s3Service.getObjectDetails(body.key, databankId);
      
      // Check if the object exists
      if (!details) {
        logger.warn(`Object not found: ${body.key}`);
        throw new S3Error(`Object not found: ${body.key}`, 'getObjectDetails');
      }
      
      // Determine if it's a folder by checking isFolder property or if isFile is false
      const isFolder = ('isFolder' in details && details.isFolder) || details.isFile === false;
      logger.info(`Got details for: ${body.key}, isFolder: ${isFolder}`);
      
      // Create the response
      const response: GetObjectDetailsResponse = {
        key: details.key,
        size: 'size' in details ? details.size : undefined,
        lastModified: details.lastModified,
        contentType: 'contentType' in details ? details.contentType : undefined,
        childCount: 'childCount' in details ? details.childCount : undefined,
        isFile: !isFolder
      };
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error getting object details: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to get object details: ${error instanceof Error ? error.message : String(error)}`,
        'getObjectDetails'
      );
    }
  }
);

/**
 * Create folder route
 * Creates a new folder in the S3 bucket
 */
s3Routes.post(
  '/folder',
  authenticate,
  authorizeProvider,
  // Add middleware to inject databankId into the validation process
  async (c: Context, next: Next) => {
    try {
      // Get the request body
      const body = await c.req.json();
      
      // Get the databank ID from the context (set by authenticate middleware)
      const databankId = c.get('databankId') as string;
      
      // Add the databankId to the body
      const modifiedBody = { ...body, databankId };
      
      // Validate the body directly
      const validatedBody = createFolderSchema.parse(modifiedBody);
      
      // Set the validated body directly on the context
      (c as any)[VALIDATED_BODY] = validatedBody;
      
      // Skip the validateBody middleware
      c.set('skip-validation', true);
      
      await next();
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error preparing folder creation request: ${error instanceof Error ? error.message : String(error)}`);
      throw new ValidationError('Invalid request body');
    }
  },
  validateBody(createFolderSchema),
  async (c: Context) => {
    try {
      const body = (c as any)[VALIDATED_BODY] as CreateFolderRequest;
      const databankId = c.get('databankId') as string;
      
      logger.info(`Creating folder: ${body.folderPath}, databankId: ${databankId}`);
      
      // Create the folder
      await s3Service.createFolder(
        body.folderPath,
        databankId
      );
      
      logger.info(`Successfully created folder: ${body.folderPath}`);
      
      // Create the response
      const response: CreateFolderResponse = {
        message: 'Folder created successfully',
        folderPath: body.folderPath
      };
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error creating folder: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to create folder: ${error instanceof Error ? error.message : String(error)}`,
        'createFolder'
      );
    }
  }
);

/**
 * Delete object route
 * Deletes a file from the S3 bucket
 */
s3Routes.delete(
  '/file',
  authenticate,
  authorizeProvider,
  async (c: Context) => {
    try {
      // Get the key from query parameter
      const key = c.req.query('key');
      const databankId = c.get('databankId') as string;
      
      // Validate key
      if (!key) {
        throw new ValidationError('Key is required');
      }
      
      logger.info(`Deleting file: ${key}, databankId: ${databankId}`);
      
      // Delete the file
      await s3Service.deleteObject(
        key,
        databankId
      );
      
      logger.info(`Successfully deleted file: ${key}`);
      
      // Create the response
      const response: DeleteObjectResponse = {
        message: 'File deleted successfully',
        key: key
      };
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error deleting file: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
        'deleteObject'
      );
    }
  }
);

/**
 * Delete folder route
 * Deletes a folder from the S3 bucket
 */
s3Routes.delete(
  '/folder',
  authenticate,
  authorizeProvider,
  async (c: Context) => {
    try {
      // Get the key from query parameter
      const key = c.req.query('key');
      const databankId = c.get('databankId') as string;
      
      // Validate key
      if (!key) {
        throw new ValidationError('Key is required');
      }
      
      // Ensure the folder key ends with a slash
      const folderKey = key.endsWith('/') ? key : `${key}/`;
      
      logger.info(`Deleting folder: ${folderKey}, databankId: ${databankId}`);
      
      // Delete the folder
      await s3Service.deleteObject(
        folderKey,
        databankId,
        true // recursive delete
      );
      
      logger.info(`Successfully deleted folder: ${folderKey}`);
      
      // Create the response
      const response: DeleteFolderResponse = {
        message: 'Folder deleted successfully',
        folderPath: folderKey
      };
      
      // Return the response
      return c.json(response);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      
      logger.error(`Error deleting folder: ${error instanceof Error ? error.message : String(error)}`);
      
      throw new S3Error(
        `Failed to delete folder: ${error instanceof Error ? error.message : String(error)}`,
        'deleteObject'
      );
    }
  }
);
