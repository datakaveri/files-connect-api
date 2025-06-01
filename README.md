# TGDEX Files Connect API

A TypeScript-based API service for secure file operations with databank support. This service is part of the TGDEX platform and provides a RESTful API for managing files in S3 buckets with features like multipart uploads, presigned URLs, file previews, and ZIP downloads.

## Features

- **Databank Management**: Organize files into logical databanks with access control
- **Secure File Uploads**: Support for large file uploads with multipart upload
- **File Type Validation**: Strict validation of uploaded files (CSV, JSON, TXT, Parquet, XLSX, ZIP)
- **Security**: Role-based access control (RBAC) with Keycloak integration
- **File Operations**: List, download, and manage files with metadata
- **File Previews**: Generate previews for supported file types (CSV, JSON, XLSX, Parquet)
- **Asynchronous Processing**: Background job processing for ZIP creation and reports
- **RESTful API**: Standardized API following REST best practices
- **OpenAPI Documentation**: Auto-generated API documentation with Swagger UI

## Prerequisites

- Node.js (v18 or later)
- TypeScript (v5.0 or later)
- pnpm (package manager)
- AWS Account with S3 access
- Keycloak server for authentication (optional, can be disabled in development)
- Docker (optional, for containerized deployment)

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

3. Configure environment variables in `.env` file:

```
PORT=3000
NODE_ENV=development
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
BUCKET_NAME=your-bucket-name
MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB=1000
CORS_ORIGIN="http://localhost:8080,http://localhost:5173"
LOG_LEVEL=debug

# Keycloak Configuration
KEYCLOAK_URL=https://your-keycloak-url/auth/realms/your-realm
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=your-client-id
KEYCLOAK_PUBLIC_KEY="your-public-key"
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

5. Generate API documentation (OpenAPI/Swagger):

```bash
pnpm openapi
```

## Deployment

### Docker Deployment

1. Build the Docker image:

```bash
docker build -t files-connect-api .
```

2. Run the Docker container:

```bash
docker run -p 3000:3000 --env-file .env files-connect-api
```

## API Documentation

### Interactive Documentation

Once the server is running, you can access the interactive API documentation at:
- Swagger UI: http://localhost:3000/v1/docs

### Key Endpoints

- **Databank Operations**:
  - `POST /v1/databanks/{databankId}/uploads` - Initiate multipart upload (CSV, JSON, TXT, Parquet, XLSX, ZIP only)
  - `PUT /v1/databanks/{databankId}/uploads/{uploadId}` - Complete multipart upload
  - `POST /v1/databanks/{databankId}/files` - List files in databank
  - `POST /v1/databanks/{databankId}/files/download` - Download files
  - `POST /v1/databanks/{databankId}/process` - Create processing job

- **Asset Operations**:
  - `POST /v1/assets` - Upload asset files
  - `POST /v1/assets/download` - Download asset files

For detailed API documentation, see the [API.md](./API.md) file.

## Architecture

The application follows a clean architecture with clear separation of concerns:

1. **Presentation Layer**:
   - Routes and controllers for handling HTTP requests/responses
   - Request validation and authentication middleware
   - OpenAPI/Swagger documentation

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

- **Allowed file types**: CSV, JSON, TXT, Parquet, XLSX, ZIP
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