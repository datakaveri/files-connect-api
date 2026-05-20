# TGDEX Files Connect API

A TypeScript-based API service for secure file operations with databank support. This service is part of the TGDEX platform and provides a RESTful API for managing files in S3 buckets with features like multipart uploads, presigned URLs, file previews, and ZIP downloads.

## Features

- **Databank Management**: Organize files into logical databanks with access control
- **Secure File Uploads**: Support for large file uploads with multipart upload
- **File Type Validation**: Strict validation of uploaded files (CSV, JSON, GeoJSON, TXT, Parquet, XLSX, ZIP)
- **Security**: Role-based access control (RBAC) with Keycloak integration
- **Temporary Access Credentials**: Generate time-limited AWS STS credentials for direct S3 access
- **File Operations**: List, download, and manage files with metadata
- **File Previews**: Generate previews for supported file types (CSV, JSON, GeoJSON, XLSX, Parquet)
- **Asynchronous Processing**: Redis-based job queue with Python workers for ZIP creation and reports
- **Cloud Agnostic**: Works with both AWS S3 and MinIO for on-premise deployments
- **RESTful API**: Standardized API following REST best practices
- **OpenAPI Documentation**: Auto-generated API documentation with ReDoc

## Prerequisites

- Node.js (v18 or later)
- TypeScript (v5.0 or later)
- pnpm (package manager)
- Storage backend: AWS S3 or MinIO
- Redis (v7 or later) for job queue
- Python 3.11+ (for workers)
- Keycloak server for authentication (optional, can be disabled in development)
- Docker (optional, for containerized deployment)

## Storage Providers

This API supports multiple storage backends through a unified interface:

### AWS S3 (Production)
- Set `STORAGE_PROVIDER=s3` in environment variables
- Requires AWS credentials and S3 bucket access

### MinIO (Development/Local)
- Set `STORAGE_PROVIDER=minio` in environment variables
- Lightweight S3-compatible object storage
- Perfect for local development and testing

### Docker Development Setup

For local development with MinIO, Redis, and workers, use the provided Docker Compose setup:

1. Start all services:
```bash
docker-compose up -d
```

when new changes
```bash
docker-compose build zip-worker
```

This starts:
- **MinIO** - S3-compatible object storage (ports 9000, 9001)
- **Redis** - Job queue server (port 6379)
- **Zip Worker** - Python worker for processing zip jobs

2. Access services:
- MinIO Console: http://localhost:9001
- Redis: localhost:6379
   - Username: `minioadmin`
   - Password: `minioadmin`

3. The API will automatically connect to MinIO with the provided configuration.

## Installation

1. Clone the repository:

```bash
git clone https://github.com/datakaveri/files-connect-api.git
cd files-connect-api
```

2. Install dependencies using pnpm:

```bash
pnpm install
```

3. Configure environment variables in `.env` file (see `.env.example` for all options):

### Basic Configuration
```
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGIN="http://localhost:8080,http://localhost:5173"
```

### Storage Configuration
```
# Choose storage provider: 's3' or 'minio'
STORAGE_PROVIDER=minio

# MinIO (for local development)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_FORCE_PATH_STYLE=true
STORAGE_USE_SSL=false

# AWS S3 (for production)
# STORAGE_PROVIDER=s3
# STORAGE_ENDPOINT=https://s3.amazonaws.com
# STORAGE_REGION=us-east-1
# STORAGE_ACCESS_KEY=your-aws-access-key
# STORAGE_SECRET_KEY=your-aws-secret-key

# Bucket configuration (see Storage Buckets section below)
BUCKET_NAME=your-main-bucket
MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB=5
```

## Storage Buckets

### Buckets Required

Only **one bucket** needs to be created. Everything lives under `BUCKET_NAME` using path prefixes to separate concerns:

| Env Var | Purpose |
|---|---|
| `BUCKET_NAME` | Single bucket for all operations — databank files, assets, zips, and PDF reports |

> **Note:** The bucket must be accessible by the API and both Python workers using the same credentials (`STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`).

### Upload & Read Paths

| Operation | Component | Bucket | Key Path |
|---|---|---|---|
| Databank file upload | API (multipart) | `BUCKET_NAME` | `{databankId}/{filename}` |
| Databank file download | API | `BUCKET_NAME` | `{databankId}/{filename}` |
| Asset upload (PDF/image) | API | `BUCKET_NAME` | `assets/{userId}/{timestamp}-{uuid}-{filename}` |
| Asset download | API | `BUCKET_NAME` | `assets/{userId}/{timestamp}-{uuid}-{filename}` |
| Zip creation (read) | Zip worker | `BUCKET_NAME` | `{databankId}/*` |
| Zip upload (write) | Zip worker | `BUCKET_NAME` | `zips/{databankId}.zip` |
| Zip download URL | API | `BUCKET_NAME` | `zips/{databankId}.zip` |
| Report generation (read) | Report worker | `BUCKET_NAME` | `{databankId}/*` |
| Report PDF upload (write) | Report worker | `BUCKET_NAME` | `reports/{databankId}/data_readiness_report.pdf` |
| Report PDF download URL | API | `BUCKET_NAME` | `reports/{databankId}/data_readiness_report.pdf` |

### Authentication Configuration
```
KEYCLOAK_AUTH_URL=https://your-keycloak-url
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=your-client-id
KEYCLOAK_PUBLIC_KEY="your-public-key"
```

### Redis Configuration (Job Queue)
```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
# REDIS_PASSWORD=your-password  # Optional
```

### Temporary Access Configuration (Optional)
```
# AWS STS for temporary credentials (optional)
STS_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT_ID:role/DatabanksTemporaryAccessRole
STS_SESSION_DURATION_IN_SECONDS=900
```

See [STS Setup Guide](./infra/STS_SETUP.md) for detailed configuration instructions.

### Other Services
```
# ACL and Catalogue APIs
ACL_APD_API_URL=http://localhost:8081
CAT_API_URL=http://localhost:8082

# RabbitMQ (for async processing)
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=guest
RABBITMQ_PASSWORD=guest

# Lambda functions (optional)
ZIP_LAMBDA_URL=http://localhost:8083
REPORTS_LAMBDA_URL=http://localhost:8084
```

## Development

1. Start the development server with hot-reload:

```bash
pnpm dev
```

2. Build the project:

```bash
pnpm build
```

3. Start the production server:

```bash
pnpm start
```

4. Run tests:

```bash
pnpm test
```

5. Generate OpenAPI spec (static `openapi.json`):

```bash
pnpm openapi
```

## Deployment

For deployment instructions, please refer to the [Infrastructure Guide](./infra/README.md).

## API Documentation

### Interactive Documentation

Once the server is running, you can access the interactive API documentation at:
- **ReDoc**: http://localhost:3000/apis

The OpenAPI spec is also available at http://localhost:3000/openapi.json

### Key Endpoints

- **Databank Operations**:
  - `POST /v1/databanks/{databankId}/uploads` - Initiate multipart upload (CSV, JSON, TXT, Parquet, XLSX, ZIP only)
  - `PUT /v1/databanks/{databankId}/uploads/{uploadId}` - Complete multipart upload
  - `POST /v1/databanks/{databankId}/files` - List files in databank
  - `POST /v1/databanks/{databankId}/files/download` - Download files
  - `POST /v1/databanks/{databankId}/process` - Create processing job (type: `zip`, `report`, or `all` for both)
  - `GET /v1/databanks/{databankId}/query-access` - Generate temporary S3 credentials

- **Asset Operations**:
  - `POST /v1/assets` - Upload asset files
  - `POST /v1/assets/download` - Download asset files

For detailed API documentation, see the [API.md](./API.md) file.

## Architecture

The application follows a clean architecture with clear separation of concerns:

1. **Presentation Layer**:
   - Routes and controllers for handling HTTP requests/responses
   - Request validation and authentication middleware
   - OpenAPI (ReDoc) documentation

2. **Application Layer**:
   - Business logic and use cases
   - File processing and validation services
   - Background job management

3. **Domain Layer**:
   - Core business entities and interfaces
   - Repository interfaces
   - Domain events and value objects

4. **Infrastructure Layer**:
   - AWS S3 integration
   - Keycloak authentication
   - Logging and monitoring

### Key Components

- **Databank Service**: Manages databank operations and access control
- **File Validation Service**: Validates file types and content
- **Multipart Upload Service**: Handles large file uploads with S3
- **Job Queue System**: Redis-based async job processing with Python workers

## Async Job Processing

The system uses a Redis-based job queue for long-running operations:

### Architecture
```
API (TypeScript) → Redis Queue → Worker (Python) → S3/MinIO
                        ↓
                   Job Status
```

### Supported Jobs
**Job types** (request body `type` on `POST .../process`):
- **`zip`** – Zip job only: streams files from the databank and creates a compressed archive.
- **`report`** – Report job only: runs data readiness assessment and generates JSON and PDF reports.
- **`all`** – Both: creates one zip job and one report job; response includes `jobIds.zip` and `jobIds.report` so you can poll each job separately.

### Features
- **Memory Efficient**: Streams large files without loading into memory
- **Scalable**: Horizontally scale workers based on load
- **Resilient**: Automatic retry on failures, graceful shutdown
- **Cloud Agnostic**: Works with both S3 and MinIO
- **Progress Tracking**: Real-time job status updates via Redis

For detailed documentation on workers, see [workers/README.md](workers/README.md)
- **Preview Service**: Generates previews for supported file types
- **Job Service**: Manages background processing jobs
- **Auth Service**: Handles authentication and authorization

## Security Features

1. **Authentication**: JWT-based authentication with Keycloak
2. **Authorization**: Role-based access control (Provider/Consumer roles)
3. **File Validation**: Strict file type validation to prevent upload of malicious files
4. **Input Validation**: Request validation using Zod schemas

## Development Workflow

1. Start development server with hot-reload:
   ```bash
   pnpm dev
   ```

2. Build the project:
   ```bash
   pnpm build
   ```

3. Start the production server:
   ```bash
   pnpm start
   ```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a pull request with a clear description of changes

## Acknowledgements

- [Express](https://github.com/expressjs/express) - Fast, unopinionated, minimalist web framework for Node.js
- [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js-v3) - AWS SDK for JavaScript
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
- [Keycloak](https://www.keycloak.org/) - Open Source Identity and Access Management
- [OpenAPI](https://www.openapis.org/) - OpenAPI Specification

## File Type Validation

The API enforces strict file type validation for databank uploads:

- **Allowed file types**: CSV, JSON, GeoJSON, TXT, Parquet, XLSX, ZIP
- **Blocked file types**: Executable files (.exe, .dll, .bat, .cmd, .sh, .js, .py, .php)

Validation occurs during multipart upload initiation and returns a 415 Unsupported Media Type status code for disallowed file types.

### Kubernetes Deployment
Create docker image:
```bash
docker build -t ghcr.io/datakaveri/tgdex-file-connect-api:latest -f ./infra/Dockerfile .
```
Push docker image:
```bash
docker push ghcr.io/datakaveri/tgdex-file-connect-api:latest
```

To create the secret:
```bash
kubectl apply -f ./infra/secret.yaml
```      
Deploy the application:
```bash
kubectl apply -f ./infra/manifest.yaml
```