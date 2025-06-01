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
  success: z.boolean()
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

// Register File Operations Routes (All under databanks)
// 1. List files in a directory
registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/files',
  tags: ['Databanks'],
  summary: 'List files in a databank directory',
  description: 'Returns a list of files and directories in the specified databank directory',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
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
  path: '/databanks/{databankId}/files/download',
  tags: ['Databanks'],
  summary: 'Download a specific file from a databank',
  description: 'Returns a specific file or generates a presigned URL for download',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key'),
            presigned: z.boolean().optional().describe('Whether to return a presigned URL')
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
  method: 'post',
  path: '/databanks/{databankId}/files/metadata',
  tags: ['Databanks'],
  summary: 'Get metadata for a specific file in a databank',
  description: 'Returns metadata for a specific file in a databank',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key')
          })
        }
      }
    }
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
  path: '/databanks/{databankId}/files/preview',
  tags: ['Databanks'],
  summary: 'Generate preview for a specific file in a databank',
  description: 'Returns a preview of a specific file in a databank',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('File key'),
            maxLines: z.number().optional().describe('Maximum number of lines to return'),
            fileType: z.string().optional().describe('File type for preview')
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

// Register Upload Operations Routes (under databanks)
// 1. Initiate a multipart upload and get presigned URLs
registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/uploads',
  tags: ['Databanks'],
  summary: 'Initiate a multipart upload to a databank',
  description: 'Initiates a multipart upload to a databank and returns presigned URLs for uploading parts',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
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
  path: '/databanks/{databankId}/uploads/{uploadId}',
  tags: ['Databanks'],
  summary: 'Complete a multipart upload to a databank',
  description: 'Finalizes a multipart upload to a databank',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
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

// Register Asset Routes
// 1. Upload an asset (multipart/form-data)
registry.registerPath({
  method: 'post',
  path: '/assets',
  tags: ['Assets'],
  summary: 'Upload an asset (multipart/form-data)',
  description: 'Uploads an asset using multipart/form-data and returns a unique key for future reference. Only PDF and image files are allowed (JPEG, PNG, GIF, WebP, SVG, TIFF, BMP).',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().describe('File to upload')
          })
        }
      }
    }
  },
  responses: {
    '201': {
      description: 'Asset uploaded successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(z.object({
            key: z.string().describe('Unique key for the uploaded asset'),
            originalname: z.string().describe('Original filename'),
            size: z.number().describe('File size in bytes'),
            contentType: z.string().describe('Content type of the file')
          }))
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

// 3. Get a presigned URL for an asset
registry.registerPath({
  method: 'post',
  path: '/assets/download',
  tags: ['Assets'],
  summary: 'Get a presigned URL for an asset',
  description: 'Returns a presigned URL for downloading an asset',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().describe('Asset key'),
            expiresIn: z.number().optional().describe('Expiration time in seconds')
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'Presigned URL generated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema(z.object({
            url: z.string().describe('Presigned URL for the asset'),
            expiresIn: z.number().describe('Expiration time in seconds')
          }))
        }
      }
    },
    '404': {
      description: 'Asset not found',
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

// Register Processing Routes (under databanks)
// 1. Create a processing job
registry.registerPath({
  method: 'post',
  path: '/databanks/{databankId}/process',
  tags: ['Databanks'],
  summary: 'Create a processing job for a databank',
  description: 'Creates a new processing job (zip and/or report) for a databank',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            type: z.string().describe('Type of processing job (zip or report)'),
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

// 2. Update status of a processing job
registry.registerPath({
  method: 'put',
  path: '/databanks/{databankId}/process/{jobId}/status',
  tags: ['Databanks'],
  summary: 'Update processing job status',
  description: 'Updates the status of a processing job for a databank',
  request: {
    params: z.object({
      databankId: z.string().describe('Databank ID'),
      jobId: z.string().describe('Job ID')
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            status: z.string().describe('New status for the job'),
            progress: z.number().optional(),
            error: z.string().optional(),
            result: z.object({}).passthrough().optional()
          })
        }
      }
    }
  },
  responses: {
    '200': {
      description: 'Processing job status updated successfully',
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
