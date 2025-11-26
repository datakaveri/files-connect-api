# API Endpoints - User Role Access Control

This document provides a comprehensive overview of all API endpoints and the user roles that have access to each endpoint.

## User Roles

The Files Connect API uses three distinct user roles for access control:

| Role | Description | Access Level |
|------|-------------|--------------|
| **provider** | Can upload files, create processing jobs, and manage databanks | Full read/write access to their own databanks |
| **consumer** | Can view and download files from databanks they have access to | Read-only access |
| **cos_admin** | Administrative role with elevated privileges | System-wide administrative access |

## Authentication

All API endpoints (except health check and metadata) require JWT Bearer token authentication. The JWT token must contain user roles in the `realm_access.roles` claim.

Example Authorization Header:
```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints and Role Access

### Health Check

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| GET | `/v1/health` | No authentication required | Health check endpoint |

### Databank Operations

#### File Operations

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| POST | `/v1/databanks/{databankId}/files` | `provider`, `consumer` | List files in a databank directory |
| POST | `/v1/databanks/{databankId}/files/download` | `provider`, `consumer` | Download a specific file from a databank |
| POST | `/v1/databanks/{databankId}/files/metadata` | No authentication required | Get metadata for a specific file |
| POST | `/v1/databanks/{databankId}/files/delete` | `provider`, `consumer` (owner only) | Delete a specific file from a databank |
| POST | `/v1/databanks/{databankId}/files/preview` | `provider`, `consumer` | Generate preview for a specific file |

#### Upload Operations

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| POST | `/v1/databanks/{databankId}/uploads` | `provider` | Initiate a multipart upload to a databank |
| PUT | `/v1/databanks/{databankId}/uploads/{uploadId}` | `provider` | Complete a multipart upload to a databank |
| POST | `/v1/databanks/{databankId}/uploads/{uploadId}/cancel` | `provider` | Cancel a multipart upload |

#### Processing Operations

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| POST | `/v1/databanks/{databankId}/process` | `provider` | Create a processing job for a databank |
| PUT | `/v1/databanks/{databankId}/process/{jobId}/status` | `provider` | Update processing job status |

#### Download Operations

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| GET | `/v1/databanks/{databankId}/download` | `provider`, `consumer` | Get download URL for databank zip file |

### Asset Operations

| Method | Endpoint | Allowed Roles | Description |
|--------|----------|---------------|-------------|
| POST | `/v1/assets` | `provider`, `consumer`, `cos_admin` | Upload an asset (PDF or image) |
| POST | `/v1/assets/download` | `provider`, `cos_admin` | Get a presigned URL for an asset |

## Role-Based Access Summary

### Provider Role Access
Providers have full access to:
- All file operations (list, download, preview, delete - for owned files)
- All upload operations (initiate, complete, cancel)
- All processing operations (create jobs, update status)
- Databank download operations
- Asset operations (upload and download)

**Total Endpoints:** 13

### Consumer Role Access
Consumers have limited access to:
- File operations (list, download, preview)
- Databank download operations
- Asset upload only

**Total Endpoints:** 5

### Admin (cos_admin) Role Access
Admins have access to:
- All asset operations
- Additional system-wide privileges (not shown in basic endpoints)

**Total Endpoints:** 2 (explicitly)

## Additional Access Controls

### Owner Checks
Some endpoints require additional ownership verification:
- **File Deletion**: Only the owner of a file can delete it, even if they have the provider or consumer role

### Databank Access Checks
Most databank operations also verify that the user has access to the specific databank through the ACL (Access Control List) API before allowing the operation.

## Viewing the Documentation

You can view the complete API documentation with role information in:

1. **Swagger UI**: http://localhost:3000/v1/docs (when server is running)
2. **Redocs**: http://localhost:3000/apis (when server is running)
3. **OpenAPI JSON**: http://localhost:3000/openapi.json (when server is running)

Each endpoint in these documentation interfaces includes an "**Access Control**" section that specifies the allowed roles.

## Notes

- JWT tokens are issued by Keycloak or another identity provider
- Tokens must include roles in the `realm_access.roles` claim
- Tokens are verified on each request
- Invalid or expired tokens will result in a 401 Unauthorized response
- Insufficient permissions will result in a 403 Forbidden response

