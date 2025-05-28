# Files Connect API Documentation

## API Endpoints

The API has been restructured to follow REST best practices, with resources organized into logical groups.

### Health Check APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/health` | GET | Basic health check | No | None |
| `/v1/health/deep` | GET | Deep health check with dependencies | No | None |

### File Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/files` | POST | List files in a directory | Yes | Provider, Consumer |
| `/v1/files/:key` | POST | Download a specific file | Yes | Provider, Consumer |
| `/v1/files/:key/metadata` | GET | Get metadata for a specific file | Yes | Provider, Consumer |
| `/v1/files/:key/preview` | POST | Generate preview for a specific file | Yes | Provider, Consumer |

### Upload Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/uploads` | POST | Initiate a multipart upload and get presigned URLs | Yes | Provider |
| `/v1/uploads/:uploadId` | PUT | Finalize a multipart upload | Yes | Provider |

### Databank Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/download` | GET | Get download URL for databank zip file | Yes | Provider, Consumer |

### Processing APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/processing/jobs` | POST | Create a processing job (zip and/or report) | Yes | Provider |
| `/v1/processing/jobs/:jobId` | GET | Get status of a processing job | Yes | Provider |

## Additional Information

- All APIs use JSON for request and response bodies
- Authentication is handled via JWT tokens in the Authorization header
- The base path for all APIs is `/v1` as defined in the main router
- APIs follow REST conventions with appropriate HTTP methods
- Resources are organized into logical groups (files, uploads, databanks, processing)
- File preview supports multiple formats: CSV, JSON, XML, XLSX, and Parquet
- Multipart uploads are used for large file uploads and follow the AWS S3 multipart upload protocol
- The processing APIs trigger background jobs for creating zip files and generating reports
- Zip creation jobs can be tracked and downloaded once complete via the databanks API