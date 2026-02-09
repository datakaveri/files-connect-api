
# Files Connect API Documentation

## API Endpoints

The API has been restructured to follow REST best practices, with all resources organized under the databanks resource for better hierarchy and RESTful design.

### Health Check APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/health` | GET | Basic health check | No | None |

### Asset Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/assets` | POST | Upload an asset (PDF or image files only) | Yes | Provider, Consumer |
| `/v1/assets/download` | POST | Get presigned URL for an asset | Yes | Provider, Consumer |

### File Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/files` | POST | List files in a databank directory (supports recursive listing of all files in subdirectories) | Yes | Provider, Consumer |
| `/v1/databanks/:databankId/files/:key` | POST | Download a specific file | Yes | Provider, Consumer |
| `/v1/databanks/:databankId/files/:key/metadata` | GET | Get metadata for a specific file | Yes | Provider, Consumer |
| `/v1/databanks/:databankId/files/delete` | POST | Delete a specific file from S3 | Yes | Provider, Consumer |
| `/v1/databanks/:databankId/files/:key/preview` | POST | Generate preview for a specific file | Yes | Provider, Consumer |

### Upload Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/uploads` | POST | Initiate a multipart upload and get presigned URLs (CSV, JSON, GeoJSON, TXT, Parquet, XLSX, ZIP files only) | Yes | Provider |
| `/v1/databanks/:databankId/uploads/:uploadId` | PUT | Finalize a multipart upload | Yes | Provider |
| `/v1/databanks/:databankId/uploads/:uploadId/cancel` | POST | Cancel a multipart upload | Yes | Provider |

### Processing Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/process` | POST | Create a processing job (zip and/or report) | Yes | Provider |
| `/v1/databanks/:databankId/process/:jobId` | GET | Get status of a processing job | Yes | Provider |
| `/v1/databanks/:databankId/process/:jobId/status` | PUT | Update status of a processing job | Yes | Provider |

### Temporary Access APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/query-access` | GET | Generate temporary AWS STS credentials for direct S3 access to databank | Yes | Provider, Consumer |

### Download Operations APIs

| Endpoint | Method | Description | Auth Required | Roles |
|----------|--------|-------------|--------------|-------|
| `/v1/databanks/:databankId/download` | GET | Get download URL for databank zip file | Yes | Provider, Consumer |

## Additional Information

- All APIs use JSON for request and response bodies
- Authentication is handled via Keycloak JWT tokens in the Authorization header
- The base path for all APIs is `/v1` as defined in the main router
- APIs follow REST conventions with appropriate HTTP methods and all resources organized under databanks
- Resources are organized into logical groups (files, uploads, process, download) within the databanks resource
- File preview supports multiple formats: CSV, JSON, GeoJSON, XML, XLSX, and Parquet
- Databank multipart uploads support only CSV, JSON, GeoJSON, TXT, Parquet, XLSX, and ZIP file types. Executable files are not permitted
- Multipart uploads are used for large file uploads and follow the AWS S3 multipart upload protocol
- The processing APIs trigger background jobs for creating zip files and generating reports
- Processing jobs run asynchronously and respond with 202 Accepted status
- Zip creation jobs can be tracked and downloaded once complete via the databanks download API
- Temporary access API generates AWS STS credentials for direct S3 access to databank files without proxying through the API
- Temporary credentials are time-limited (default 15 minutes) and scoped to specific databank access only
- Authorization is role-based with two primary roles: Provider and Consumer