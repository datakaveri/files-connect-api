/**
 * OpenAPI Schema Definition
 * This file defines the OpenAPI schema for the API
 */
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI functionality (required for zod-to-openapi v7+)
extendZodWithOpenApi(z);
import { env } from './environment';

// Define the OpenAPI info object
export const openApiInfo = {
  info: {
    title: 'Files Connect API',
    version: env.VERSION || '1.0.0',
    description: 'API for file uploads, downloads, and processing',
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
      url: `http://localhost:${env.PORT}/v1`,
      description: 'Local development server',
    },
    {
      url: 'https://api.example.com/v1',
      description: 'Production server',
    },
  ],
  openapi: '3.0.0',
};

// Base schemas for responses
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  meta: z.object({
    requestId: z.string(),
    timestamp: z.string(),
    processingTimeMs: z.number().optional(),
    version: z.string().optional(),
    pagination: z
      .object({
        page: z.number(),
        pageSize: z.number(),
        totalItems: z.number(),
        totalPages: z.number(),
        hasMore: z.boolean(),
      })
      .optional(),
  }),
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
  security = [{ bearerAuth: [] }]
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
          schema: z.ZodType<any>;
        };
      };
    };
  };
}) => {
  // Convert request format to match v7 API
  const convertedRequest: any = {};
  
  if (request) {
    if (request.query) convertedRequest.query = request.query;
    if (request.params) convertedRequest.params = request.params;
    if (request.body) convertedRequest.body = request.body;
  }
  return registry.registerPath({
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

// Create OpenAPI registry
export const registry = new OpenAPIRegistry();

// Register security schemes
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT-based authentication'
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
  etag: z.string().optional()
});

const FileListingSchema = z.object({
  files: z.array(FileMetadataSchema),
  directories: z.array(z.object({
    prefix: z.string(),
    name: z.string()
  }))
});

const FilePreviewSchema = z.object({
  content: z.string(),
  format: z.string(),
  truncated: z.boolean().optional(),
  firstNLines: z.number().optional(),
  totalLines: z.number().optional()
});

const UploadInitiationSchema = z.object({
  uploadId: z.string(),
  key: z.string(),
  parts: z.array(z.object({
    partNumber: z.number(),
    presignedUrl: z.string()
  }))
});

const UploadCompletionSchema = z.object({
  etag: z.string(),
  key: z.string(),
  location: z.string()
});

const ProcessingJobSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  type: z.string(),
  createdAt: z.string(),
  progress: z.number().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional()
});

const DatabankDownloadSchema = z.object({
  downloadUrl: z.string(),
  expiresAt: z.string()
});

// Register Health Check Route (No auth required)
registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Health check endpoint',
  description: 'Checks if the API is running properly',
  security: [], // No security for health check
  responses: {
    '200': {
      description: 'API is healthy',
      content: {
        'application/json': {
          schema: z.object({
            status: z.string(),
            timestamp: z.string(),
            service: z.string(),
            version: z.string()
          })
        }
      }
    }
  }
});

// Register File Operations Routes
// 1. List files in a directory
registry.registerPath({
  method: 'post',
  path: '/files',
  tags: ['Files'],
  summary: 'List files in a directory',
  description: 'Returns a list of files and directories in the specified directory',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            prefix: z.string().optional(),
            delimiter: z.string().optional(),
            maxKeys: z.number().optional()
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'List of files and directories',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FileListingSchema)
        }
      }
    },
    '401': {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    '403': {
      description: 'Forbidden',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// 2. Download a specific file
registry.registerPath({
  method: 'post',
  path: '/files/{key}',
  tags: ['Files'],
  summary: 'Download a specific file',
  description: 'Returns a specific file or generates a presigned URL for download',
  request: {
    params: z.object({
      key: z.string().describe('File key/path')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            presigned: z.boolean().optional()
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'File content or presigned URL',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(z.object({
            presignedUrl: z.string().optional(),
            expiresAt: z.string().optional()
          }))
        }
      }
    },
    '404': {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// 3. Get metadata for a specific file
registry.registerPath({
  method: 'get',
  path: '/files/{key}/metadata',
  tags: ['Files'],
  summary: 'Get metadata for a specific file',
  description: 'Returns metadata for a specific file',
  request: {
    params: z.object({
      key: z.string().describe('File key/path')
    })
  },
  responses: {
    '200': {
      description: 'File metadata',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FileMetadataSchema)
        }
      }
    },
    '404': {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// 4. Generate preview for a specific file
registry.registerPath({
  method: 'post',
  path: '/files/{key}/preview',
  tags: ['Files'],
  summary: 'Generate preview for a specific file',
  description: 'Returns a preview of a specific file',
  request: {
    params: z.object({
      key: z.string().describe('File key/path')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            lines: z.number().optional(),
            format: z.string().optional()
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'File preview',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(FilePreviewSchema)
        }
      }
    },
    '400': {
      description: 'Invalid request or file format not supported',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    },
    '404': {
      description: 'File not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Register Upload Operations Routes
// 1. Initiate a multipart upload and get presigned URLs
registry.registerPath({
  method: 'post',
  path: '/uploads',
  tags: ['Uploads'],
  summary: 'Initiate a multipart upload',
  description: 'Initiates a multipart upload and returns presigned URLs for uploading parts',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            numParts: z.number(),
            contentType: z.string().optional()
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'Upload initiated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(UploadInitiationSchema)
        }
      }
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// 2. Finalize a multipart upload
registry.registerPath({
  method: 'put',
  path: '/uploads/{uploadId}',
  tags: ['Uploads'],
  summary: 'Complete a multipart upload',
  description: 'Finalizes a multipart upload',
  request: {
    params: z.object({
      uploadId: z.string().describe('Upload ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            parts: z.array(z.object({
              partNumber: z.number(),
              etag: z.string()
            }))
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'Upload completed successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(UploadCompletionSchema)
        }
      }
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Register Databank Operations Routes
// 1. Get download URL for databank zip file
registry.registerPath({
  method: 'get',
  path: '/databanks/{databankId}/download',
  tags: ['Databanks'],
  summary: 'Get download URL for databank',
  description: 'Returns a presigned URL for downloading the databank zip file',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    })
  },
  responses: {
    '200': {
      description: 'Download URL generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(DatabankDownloadSchema)
        }
      }
    },
    '404': {
      description: 'Databank not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Register Processing Routes
// 1. Create a processing job
registry.registerPath({
  method: 'post',
  path: '/processing/jobs',
  tags: ['Processing'],
  summary: 'Create a processing job',
  description: 'Creates a new processing job (zip and/or report)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            type: z.string().describe('Type of processing job (zip or report)'),
            databankId: z.string(),
            prefix: z.string().optional(),
            options: z.object({}).passthrough()
          })
        }
      }
    }
  },
  responses: {
    '202': {
      description: 'Processing job created successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(ProcessingJobSchema)
        }
      }
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// 2. Get status of a processing job
registry.registerPath({
  method: 'get',
  path: '/processing/jobs/{jobId}',
  tags: ['Processing'],
  summary: 'Get processing job status',
  description: 'Returns the status of a processing job',
  request: {
    params: z.object({
      jobId: z.string().describe('Job ID')
    })
  },
  responses: {
    '200': {
      description: 'Processing job status',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(ProcessingJobSchema)
        }
      }
    },
    '404': {
      description: 'Job not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Create OpenAPI document generator
const generator = new OpenApiGeneratorV3(registry.definitions);

// Generate OpenAPI document
export const openApiDocument = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Files Connect API',
    version: env.VERSION || '1.0.0',
    description: 'API for file uploads, downloads, and processing',
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
      url: `http://localhost:${env.PORT}/v1`,
      description: 'Local development server',
    },
    {
      url: 'https://api.example.com/v1',
      description: 'Production server',
    },
  ],
});
