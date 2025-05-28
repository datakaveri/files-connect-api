/**
 * OpenAPI Schema Definition
 * This file defines the OpenAPI schema for the API
 */
import { OpenAPIHono } from 'hono-zod-openapi';
import { createRoute } from 'hono-zod-openapi';
import { z } from 'zod';
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

// Create base routes for documentation
export const createSuccessRoute = <
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
}: {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  tags: string[];
  summary: string;
  description?: string;
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
  return createRoute({
    method,
    path,
    tags,
    summary,
    description,
    request,
    responses,
  });
};

// Initialize OpenAPIHono
export const createOpenAPIHono = () => {
  return new OpenAPIHono({
    defaultHook: (result: any, c: any) => {
      if (!result.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Validation failed',
              details: result.error.flatten(),
            },
            meta: {
              requestId: c.get('requestId') || 'unknown',
              timestamp: new Date().toISOString(),
              version: env.VERSION || '1.0.0',
            },
          },
          400
        );
      }
    },
  });
};
