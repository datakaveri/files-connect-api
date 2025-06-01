# Files Connect API

A TypeScript-based API service for secure file operations with databank support. This service provides a RESTful API for managing files in S3 buckets with features like multipart uploads, presigned URLs, file previews, and ZIP downloads, with built-in security and validation.

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
git clone https://github.com/your-organization/multipartupload-middleware.git
cd multipartupload-middleware
```

2. Install dependencies using pnpm:

```bash
pnpm install
```

3. Create a `.env` file based on the `.env.example` template:

```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:

```
PORT=3000
NODE_ENV=development
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
BUCKET_NAME=your-bucket-name
MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB=5
CORS_ORIGIN=*
LOG_LEVEL=info
# Keycloak Configuration (set ENABLE_AUTH=false to disable in development)
ENABLE_AUTH=true
KEYCLOAK_URL=https://your-keycloak-url/auth
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=your-client-id
KEYCLOAK_PUBLIC_KEY=your-public-key
# Allowed file types (comma-separated)
ALLOWED_FILE_EXTENSIONS=.csv,.json,.txt,.parquet,.xlsx,.zip
# Blocked file extensions (executables)
BLOCKED_FILE_EXTENSIONS=.exe,.dll,.bat,.cmd,.sh,.js,.py,.php
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
docker build -t multipartupload-middleware .
```

2. Run the Docker container:

```bash
docker run -p 3000:3000 --env-file .env multipartupload-middleware
```

### AWS Deployment

1. Build the project:

```bash
pnpm build
```

2. Deploy to AWS using the provided scripts:

```bash
pnpm run deploy:aws
```

## API Documentation

### Interactive Documentation

Once the server is running, you can access the interactive API documentation at:
- Swagger UI: http://localhost:3000/api-docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Key Endpoints

- **Databank Operations**:
  - `POST /v1/databanks/{databankId}/uploads` - Initiate multipart upload
  - `PUT /v1/databanks/{databankId}/uploads/{uploadId}` - Complete multipart upload
  - `GET /v1/databanks/{databankId}/files` - List files in databank
  - `POST /v1/databanks/{databankId}/files/download` - Download files

- **File Type Support**:
  - Allowed: CSV, JSON, TXT, Parquet, XLSX, ZIP
  - Blocked: Executable files (.exe, .dll, .bat, etc.)

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
4. **Input Sanitization**: Protection against injection attacks
5. **Secure Headers**: Security headers for HTTP responses
6. **Rate Limiting**: Protection against brute force attacks

## Performance Optimizations

1. **Streaming**: Efficient file streaming for uploads/downloads
2. **Concurrent Processing**: Parallel processing of file operations
3. **Connection Pooling**: Optimized database and S3 connections
4. **Caching**: In-memory caching for frequently accessed resources

## Development Workflow

1. Install development dependencies:
   ```bash
   pnpm install
   ```

2. Start development server with hot-reload:
   ```bash
   pnpm dev
   ```

3. Run linter:
   ```bash
   pnpm lint
   ```

4. Run tests:
   ```bash
   pnpm test
   ```

5. Build for production:
   ```bash
   pnpm build
   ```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a pull request with a clear description of changes

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [Hono](https://github.com/honojs/hono) - Fast, lightweight web framework
- [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js-v3) - AWS SDK for JavaScript
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
- [Keycloak](https://www.keycloak.org/) - Open Source Identity and Access Management
- [OpenAPI](https://www.openapis.org/) - OpenAPI Specification

## Development Utilities

### Generate Test JWT Token

For development and testing, you can generate a JWT token with the provider role:

```bash
node -e "const jwt = require('jsonwebtoken'); 
const token = jwt.sign({ 
  sub: 'provider-123', 
  roles: ['provider'], 
  realm_access: { roles: ['provider'] }, 
  iat: Math.floor(Date.now() / 1000), 
  exp: Math.floor(Date.now() / 1000) + 3600 
}, 'development-secret-key-do-not-use-in-production'); 
console.log('Bearer ' + token);"
```

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|:--------:|
| `PORT` | Port to run the server on | `3000` | No |
| `NODE_ENV` | Node environment | `development` | No |
| `S3_REGION` | AWS S3 region | - | Yes |
| `S3_ACCESS_KEY` | AWS access key | - | Yes |
| `S3_SECRET_KEY` | AWS secret key | - | Yes |
| `BUCKET_NAME` | S3 bucket name | - | Yes |
| `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB` | Max file size for uploads | `5` | No |
| `LOG_LEVEL` | Logging level | `info` | No |
| `ENABLE_AUTH` | Enable Keycloak authentication | `true` | No |
| `KEYCLOAK_URL` | Keycloak server URL | - | If auth enabled |
| `KEYCLOAK_REALM` | Keycloak realm | - | If auth enabled |
| `KEYCLOAK_CLIENT_ID` | Keycloak client ID | - | If auth enabled |
| `KEYCLOAK_PUBLIC_KEY` | Keycloak public key | - | If auth enabled |