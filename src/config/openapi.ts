/**
 * OpenAPI Schema Definition
 * This file defines the OpenAPI schema for the API
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { env } from './environment';

extendZodWithOpenApi(z);

export const openApiInfo = {
  info: {
    title: 'Files Connect API',
    version: env.VERSION || '1.0.0',
    description: `API for file uploads, downloads, and processing.

## Authentication & Authorization

This API uses JWT Bearer token authentication with role-based access control (RBAC).

### User Roles

The following roles are defined in the system:

- **provider**: Can upload files, create processing jobs, and manage databanks. Full read/write access to their own databanks.
- **consumer**: Can view and download files from databanks they have access to. Read-only access.
- **cos_admin**: Administrative role with elevated privileges across the system.

### Access Control

Each API endpoint specifies which roles are allowed to access it. Check the endpoint description for the "Access Control" section to see which roles can use that endpoint.`,
    contact: {
      name: 'API Support',
      email: 'support@example.com',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
  },
  servers: [
    {
      url: 'https://v2.dev.file-s3.iudx.io/v1/',
      description: 'Development environment',
    },
    {
      url: 'https://staging.file.forestdx.iudx.io/v1/',
      description: 'Staging environment',
    },
    {
      url: 'https://files.forest-stack.digivan.forest.rajasthan.gov.in/v1/',
      description: 'Production environment',
    },
  ],
  openapi: '3.0.0' as const,
};

// Base schemas for responses
export const ApiResponseSchema = z.object({
  success: z.boolean(),
});

export const ErrorResponseSchema = ApiResponseSchema.extend({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  ApiResponseSchema.extend({
    success: z.literal(true),
    data: dataSchema,
  });

// Define pagination query parameters
export const PaginationQuerySchema = z.object({
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('10').transform(Number),
});

// Create OpenAPI registry
export const registry = new OpenAPIRegistry();

// Helper function to register routes in the OpenAPI registry
export const registerPath = <
  T extends z.ZodTypeAny,
  U extends z.ZodTypeAny,
  V extends z.ZodTypeAny
>({
  method,
  path,
  tags,
  summary,
  description,
  request,
  responses,
  security = [{ bearerAuth: [] }],
}: {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  request?: {
    query?: T;
    params?: U;
    body?: {
      content: {
        'application/json': {
          schema: V;
        };
      };
    };
  };
  responses: {
    [statusCode: string]: {
      description: string;
      content: {
        'application/json': {
          schema: z.ZodTypeAny;
        };
      };
    };
  };
}) => {
  const convertedRequest: Record<string, unknown> = {};
  
  if (request) {
    if (request.query) convertedRequest.query = request.query;
    if (request.params) convertedRequest.params = request.params;
    if (request.body) convertedRequest.body = request.body;
  }

  registry.registerPath({
    method,
    path,
    tags,
    summary,
    description,
    security,
    request: convertedRequest,
    responses,
  });
};

// For backward compatibility, keep registerRoute as an alias to registerPath
export const registerRoute = registerPath;

// Register security schemes
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT-based authentication. The JWT token should contain user roles in the realm_access.roles claim. Supported roles: provider, consumer, cos_admin',
});

// Register base schemas
registry.register('ApiResponse', ApiResponseSchema);
registry.register('ErrorResponse', ErrorResponseSchema);

// Define common schemas for API requests and responses
const FileMetadataSchema = z.object({
  key: z.string(),
  size: z.number(),
  lastModified: z.string(),
  contentType: z.string().optional(),
  etag: z.string().optional(),
});

const FileListingSchema = z.object({
  files: z.array(FileMetadataSchema),
  directories: z.array(
    z.object({
      prefix: z.string(),
      name: z.string(),
    }),
  ),
});

const FilePreviewSchema = z.object({
  content: z.string(),
  format: z.string(),
  truncated: z.boolean().optional(),
  firstNLines: z.number().optional(),
  totalLines: z.number().optional(),
});

const UploadInitiationSchema = z.object({
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(
    z.object({
      partNumber: z.number(),
      presignedUrl: z.string(),
    }),
  ),
});

const UploadCompletionSchema = z.object({
  etag: z.string(),
  key: z.string(),
  location: z.string(),
});

const ProcessingJobSchema = z.object({
  jobId: z.string(),
  status: z.string().describe('Job status: pending, processing, completed, or failed'),
  type: z.string().describe('Job type: zip, report, or all'),
  createdAt: z.string(),
  progress: z.number().optional().describe('Progress percentage (0-100)'),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  result: z.object({}).passthrough().optional().describe('Job result data (varies by job type)'),
});

const ProcessingJobAllResponseSchema = z.object({
  type: z.literal('all'),
  jobIds: z.object({
    zip: z.string().describe('Job ID for the zip job; poll GET .../process/{jobId} with this ID'),
    report: z.string().describe('Job ID for the report job; poll GET .../process/{jobId} with this ID'),
  }),
  zip: z.object({
    jobId: z.string(),
    status: z.string(),
    createdAt: z.string(),
    progress: z.number().optional(),
  }),
  report: z.object({
    jobId: z.string(),
    status: z.string(),
    createdAt: z.string(),
    progress: z.number().optional(),
  }),
});

const ReportJobResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data_type: z.enum(['structured', 'unstructured']).optional().describe('Type of data processed'),
  files_processed: z.number().optional().describe('Number of files processed'),
  reports_uploaded: z.number().optional().describe('Number of reports uploaded'),
  processing_time_seconds: z.number().optional().describe('Total processing time'),
  download_time_seconds: z.number().optional().describe('Time spent downloading files'),
  framework_time_seconds: z.number().optional().describe('Time spent running assessment framework'),
  upload_time_seconds: z.number().optional().describe('Time spent uploading reports'),
});

const DatabankDownloadSchema = z.object({
  downloadUrl: z.string(),
  expiresAt: z.string(),
});

const QueryAccessResponseSchema = z.object({
  credentials: z.object({
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    sessionToken: z.string(),
    expiration: z.string(),
  }),
  s3Config: z.object({
    region: z.string(),
    bucket: z.string(),
    databankId: z.string(),
  }),
  expiresAt: z.string(),
});

// Register Health Check Route (No auth required)
registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Health check endpoint',
  description: 'Checks if the API is running properly',
  security: [],
  responses: {
    200: {
      description: 'API is healthy',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
            service: z.string(),
            version: z.string(),
          }),
        },
      },
    },
  },
});

// Register File Operations Routes (All under databanks)
registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files',
  tags: ['Databanks'],
  summary: 'List files in a databank directory',
  description:
    'Returns a list of files and directories in the specified databank directory.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            prefix: z.string().optional(),
            delimiter: z.string().optional(),
            maxKeys: z.number().optional(),
            recursive: z
              .boolean()
              .optional()
              .describe(
                'When true, returns all files recursively including those in subdirectories',
              ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'List of files and directories',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FileListingSchema),
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files/download',
  tags: ['Databanks'],
  summary: 'Download a specific file from a databank',
  description:
    'Returns a specific file or generates a presigned URL for download.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key'),
            presigned: z
              .boolean()
              .optional()
              .describe('Whether to return a presigned URL'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File content or presigned URL',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.object({
              presignedUrl: z.string().optional(),
              expiresAt: z.string().optional(),
            }),
          ),
        },
      },
    },
    404: {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files/metadata',
  tags: ['Databanks'],
  summary: 'Get metadata for a specific file in a databank',
  description: 'Returns metadata for a specific file in a databank.\n\n**Access Control:**\n- Allowed Roles: No authentication required (Public endpoint)',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File metadata',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FileMetadataSchema),
        },
      },
    },
    404: {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files/delete',
  tags: ['Databanks'],
  summary: 'Delete a specific file from a databank',
  description: 'Deletes a specific file from a databank by key.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer` (owner only)',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('S3 object key to delete'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File deleted successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.object({
              message: z.string(),
            }),
          ),
        },
      },
    },
    404: {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files/preview',
  tags: ['Databanks'],
  summary: 'Generate preview for a specific file in a databank',
  description: 'Returns a preview of a specific file in a databank.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key'),
            maxLines: z
              .number()
              .optional()
              .describe('Maximum number of lines to return'),
            fileType: z
              .string()
              .optional()
              .describe('File type for preview'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'File preview',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FilePreviewSchema),
        },
      },
    },
    400: {
      description: 'Invalid request or file format not supported',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register Upload Operations Routes (under databanks)
registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/uploads',
  tags: ['Databanks'],
  summary: 'Initiate a multipart upload to a databank',
  description:
    'Initiates a multipart upload to a databank and returns presigned URLs for uploading parts. Only allows CSV, JSON, TXT, Parquet, XLSX, and ZIP file types. Executable files are not permitted.\n\n**Access Control:**\n- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            numParts: z.number(),
            contentType: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload initiated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(UploadInitiationSchema),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    415: {
      description: 'Unsupported file type',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/databanks/{databankId}/uploads/{uploadId}',
  tags: ['Databanks'],
  summary: 'Complete a multipart upload to a databank',
  description: 'Finalizes a multipart upload to a databank.\n\n**Access Control:**\n- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
      uploadId: z.string().describe('Upload ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            parts: z.array(
              z.object({
                partNumber: z.number(),
                etag: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload completed successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(UploadCompletionSchema),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/uploads/{uploadId}/cancel',
  tags: ['Databanks'],
  summary: 'Cancel a multipart upload',
  description:
    'Cancels an in-progress multipart upload and removes any uploaded parts.\n\n**Access Control:**\n- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
      uploadId: z.string().describe('Upload ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('S3 object key'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Multipart upload canceled successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.object({
              message: z.string(),
              key: z.string(),
              uploadId: z.string(),
            }),
          ),
        },
      },
    },
    404: {
      description: 'Upload not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register Asset Routes
registry.registerPath({
  method: 'post',
  path: '/assets',
  tags: ['Assets'],
  summary: 'Upload an asset (multipart/form-data)',
  description:
    'Uploads an asset using multipart/form-data and returns a unique key for future reference. Only PDF and image files are allowed (JPEG, PNG, GIF, WebP, SVG, TIFF, BMP).\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`, `cos_admin`',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().describe('File to upload'),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Asset uploaded successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.object({
              key: z
                .string()
                .describe('Unique key for the uploaded asset'),
              originalname: z.string().describe('Original filename'),
              size: z.number().describe('File size in bytes'),
              contentType: z.string().describe('Content type of the file'),
            }),
          ),
        },
      },
    },
    400: {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/assets/download',
  tags: ['Assets'],
  summary: 'Get a presigned URL for an asset',
  description: 'Returns a presigned URL for downloading an asset.\n\n**Access Control:**\n- Allowed Roles: `provider`, `cos_admin`',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('Asset key'),
            expiresIn: z
              .number()
              .optional()
              .describe('Expiration time in seconds'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Presigned URL generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.object({
              url: z.string().describe('Presigned URL for the asset'),
              expiresIn: z
                .number()
                .describe('Expiration time in seconds'),
            }),
          ),
        },
      },
    },
    404: {
      description: 'Asset not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register Query Access Route (temporary S3 credentials)
registry.registerPath({
  method: 'get',
  path: '/databanks/{databankId}/query-access',
  tags: ['Databanks'],
  summary: 'Generate temporary credentials for databank access',
  description:
    'Returns AWS STS temporary credentials with limited permissions to the databank. Use these credentials for direct S3 access (e.g. DuckDB, Athena). Duration is configured via STS_SESSION_DURATION_IN_SECONDS.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
  },
  responses: {
    200: {
      description: 'Temporary credentials generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(QueryAccessResponseSchema),
        },
      },
    },
    400: {
      description: 'Validation error (e.g. missing databank ID)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register Databank Download Route
registry.registerPath({
  method: 'get',
  path: '/databanks/{databankId}/download',
  tags: ['Databanks'],
  summary: 'Get download URL for databank',
  description: 'Returns a presigned URL for downloading the databank zip file.\n\n**Access Control:**\n- Allowed Roles: `provider`, `consumer`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
  },
  responses: {
    200: {
      description: 'Download URL generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(DatabankDownloadSchema),
        },
      },
    },
    404: {
      description: 'Databank not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/databanks/{databankId}/report/download',
  tags: ['Databanks'],
  summary: 'Get download URL for report PDF',
  description:
    'Returns a presigned URL for downloading the data readiness report PDF for a databank.\n\n' +
    '**Report Location:**\n' +
    '- Reports are stored at `{databankId}/data_readiness_report.pdf` in the reports bucket configured via `DATAREADINESS_BUCKET`\n' +
    '- Reports are generated by the report worker after processing a report job\n' +
    '- The report contains comprehensive data quality assessment including metrics for quality, variance, standardization, documentation, etc.\n\n' +
    '**Access Control:**\n' +
    '- This endpoint is public and does not require authentication.',
  // Override global security to make this endpoint public
  security: [],
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
  },
  responses: {
    200: {
      description: 'Download URL generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(DatabankDownloadSchema),
        },
      },
    },
    404: {
      description: 'Report PDF not found (report may not have been generated yet)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/process',
  tags: ['Databanks'],
  summary: 'Create a processing job for a databank',
  description:
    'Creates a new processing job for a databank. Supports three job types:\n\n' +
    '**Job Types:**\n' +
    '- `zip`: Creates a compressed zip archive of the databank files (zip job only)\n' +
    '- `report`: Runs data readiness assessment on the databank, generating JSON and PDF reports (report job only)\n' +
    '- `all`: Runs both zip and report jobs; returns separate job IDs for each so you can poll status for each\n\n' +
    '**Report Job Details:**\n' +
    '- Automatically detects structured (CSV, Parquet, JSON) or unstructured (PDF, Images, Audio, Excel, DICOM) datasets\n' +
    '- Runs comprehensive data quality assessment framework\n' +
    '- Generates detailed JSON reports and a visual PDF summary\n' +
    '- Uploads PDF report to `{databankId}/data_readiness_report.pdf` in the reports bucket configured via `DATAREADINESS_BUCKET`\n' +
    '- Uses Redis job queue for asynchronous processing\n' +
    '- Job status can be queried via the job status endpoint\n\n' +
    '**Access Control:**\n' +
    '- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            type: z
              .enum(['zip', 'report', 'all'])
              .describe('Type of processing job: zip (zip only), report (report only), or all (both zip and report)'),
            prefix: z.string().optional().describe('Optional prefix for processing specific files (not used for report jobs)'),
            options: z.object({}).passthrough().optional().describe('Optional processing options'),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description:
        'Processing job(s) created and queued. For type zip or report, returns a single job. For type all, returns jobIds.zip and jobIds.report so you can poll each job separately.',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(
            z.union([ProcessingJobSchema, ProcessingJobAllResponseSchema])
          ),
        },
      },
    },
    400: {
      description: 'Invalid request (e.g., invalid job type)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/databanks/{databankId}/process/{jobId}',
  tags: ['Databanks'],
  summary: 'Get processing job status',
  description:
    'Retrieves the current status of a processing job for a databank.\n\n' +
    '**Status Values:**\n' +
    '- `pending`: Job queued, waiting for worker\n' +
    '- `processing`: Worker is processing the job\n' +
    '- `completed`: Job completed successfully\n' +
    '- `failed`: Job failed with error\n\n' +
    '**Result Field (for completed report jobs):**\n' +
    'When a report job completes, the `result` field contains:\n' +
    '- `success`: Boolean indicating success\n' +
    '- `data_type`: Type of data processed (`structured` or `unstructured`)\n' +
    '- `files_processed`: Number of files processed\n' +
    '- `reports_uploaded`: Number of reports uploaded\n' +
    '- `processing_time_seconds`: Total processing time\n\n' +
    '**Access Control:**\n' +
    '- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
      jobId: z.string().describe('Job ID'),
    }),
  },
  responses: {
    200: {
      description: 'Processing job status retrieved successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(ProcessingJobSchema),
        },
      },
    },
    404: {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/databanks/{databankId}/process/{jobId}/status',
  tags: ['Databanks'],
  summary: 'Update processing job status',
  description:
    'Updates the status of a processing job for a databank.\n\n' +
    '**Note:** This endpoint is primarily used by worker processes to update job status during processing. ' +
    'The status is automatically updated by workers as jobs progress.\n\n' +
    '**Status Values:**\n' +
    '- `pending`: Job queued, waiting for worker\n' +
    '- `processing`: Worker is processing the job\n' +
    '- `completed`: Job completed successfully\n' +
    '- `failed`: Job failed with error\n\n' +
    '**Result Field (for report jobs):**\n' +
    'When a report job completes, the `result` field contains:\n' +
    '- `success`: Boolean indicating success\n' +
    '- `data_type`: Type of data processed (`structured` or `unstructured`)\n' +
    '- `files_processed`: Number of files processed\n' +
    '- `reports_uploaded`: Number of reports uploaded\n' +
    '- `processing_time_seconds`: Total processing time\n' +
    '- `download_time_seconds`: Time spent downloading files\n' +
    '- `framework_time_seconds`: Time spent running assessment framework\n' +
    '- `upload_time_seconds`: Time spent uploading reports\n\n' +
    '**Access Control:**\n' +
    '- Allowed Roles: `provider`',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
      jobId: z.string().describe('Job ID'),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            status: z
              .enum(['pending', 'processing', 'completed', 'failed'])
              .describe('New status for the job'),
            progress: z
              .number()
              .min(0)
              .max(100)
              .optional()
              .describe('Progress percentage (0-100)'),
            error: z.string().optional().describe('Error message if job failed'),
            result: z
              .object({})
              .passthrough()
              .optional()
              .describe('Result data (varies by job type; see description for report job structure)'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Processing job status updated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(ProcessingJobSchema),
        },
      },
    },
    404: {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: openApiInfo.openapi,
  info: openApiInfo.info,
  servers: openApiInfo.servers,
  security: [{ bearerAuth: [] }],
});


