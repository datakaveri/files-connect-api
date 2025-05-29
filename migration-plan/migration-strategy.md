# Migration Plan: Hono to Express.js

## Overview
This document outlines the strategy for migrating the files-connect-api from Hono to Express.js. The migration will maintain all existing functionality while ensuring security, validation, logging, and documentation remain robust.

## 1. Dependencies Update

### Current Dependencies to Replace
- `@hono/node-server` → Express server
- `@hono/swagger-ui` → `swagger-ui-express`
- `@hono/zod-validator` → `express-validator` + `zod` (keep zod)
- `hono` → `express`
- `hono-zod-openapi` → `express-openapi` or `@asteasolutions/zod-to-openapi`

### New Dependencies to Add
```json
{
  "dependencies": {
    "express": "^5.1.0",
    "express-async-errors": "^3.1.1",
    "express-validator": "^7.0.1",
    "helmet": "^7.1.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "swagger-ui-express": "^5.0.0",
    "express-rate-limit": "^7.1.5",
    "@asteasolutions/zod-to-openapi": "^6.4.0",
    "express-pino-logger": "^7.0.0",
    "morgan": "^1.10.0",
    "@types/express": "^4.17.21",
    "@types/swagger-ui-express": "^4.1.6",
    "@types/cors": "^2.8.17",
    "@types/compression": "^1.7.5"
  }
}
```

## 2. Project Structure Reorganization

### Current Structure
```
src/
├── config/
├── core/
├── dev/
├── index.ts
├── middleware/
├── repositories/
├── routes/
├── services/
└── types/
```

### Proposed New Structure
```
src/
├── config/
├── core/
├── dev/
├── middleware/
│   ├── auth.ts
│   ├── error-handler.ts
│   ├── logger.ts
│   ├── performance.ts
│   ├── validation.ts
│   └── index.ts
├── repositories/
├── routes/
│   ├── databanks.routes.ts
│   ├── files.routes.ts
│   ├── health.routes.ts
│   ├── processing.routes.ts
│   ├── uploads.routes.ts
│   └── index.ts
├── services/
├── types/
├── utils/
└── app.ts    (New)
└── server.ts (Renamed from index.ts)
```

## 3. Migration Steps

### Step 1: Entry Point Files
Create `app.ts` to configure Express application and `server.ts` to start the server.

### Step 2: Middleware Migration
- Convert each Hono middleware to Express middleware
- Ensure request context and logging work correctly
- Implement proper error handling middleware
- Migrate performance monitoring to use Express timing

### Step 3: Route Migration
Convert each Hono route to Express, using:
- Express Router instead of Hono Router
- Express middleware pattern for authentication and validation
- Express request/response objects

### Step 4: API Documentation
Integrate OpenAPI/Swagger with Express using:
- `swagger-ui-express` for UI
- `@asteasolutions/zod-to-openapi` for schema generation

### Step 5: Error Handling
- Implement proper Express error handling middleware
- Ensure all errors are caught and formatted consistently

### Step 6: Testing
- Test all endpoints after migration
- Ensure performance is consistent or improved

## 4. Important Migration Considerations

### Middleware Execution
In Express, middleware execution follows a strict order and doesn't use hooks like Hono. 
We need to ensure all middleware completes properly to avoid hanging requests.

### Request/Response Objects
Express and Hono have different request/response objects:
- `req.param()` → `req.params.paramName`
- `c.json()` → `res.json()`
- `c.status()` → `res.status()`
- `c.header()` → `res.set()` or `res.header()`
- Context variables → `res.locals`

### Authentication/Authorization
Express doesn't have built-in `c.set()` for storing context variables. We'll use:
- `res.locals` for request-scoped data
- Express middleware for auth

### Streaming Responses
For streaming responses, we'll use native Express methods instead of Web Streams API.

## 5. Timeline and Implementation Order

1. Setup project structure and dependencies
2. Implement basic Express server
3. Migrate middleware
4. Migrate routes (one at a time)
5. Implement OpenAPI documentation
6. Testing and performance optimization

## 6. Code Samples

Examples of key components will be created in separate files in the `migration-plan` directory.
