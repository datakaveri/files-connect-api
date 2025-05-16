# Multipart Upload Middleware

A TypeScript-based middleware service for handling multipart uploads to S3, file management, and related operations. This service provides a robust API for managing files in S3 buckets with features like multipart uploads, presigned URLs, file previews, and ZIP downloads.

## Features

- **S3 Operations**: List, get, create, and delete objects and folders in S3
- **Multipart Uploads**: Handle large file uploads efficiently with multipart upload support
- **Presigned URLs**: Generate secure, time-limited URLs for file access
- **File Previews**: Generate previews for various file types
- **ZIP Downloads**: Create and download ZIP archives of multiple files
- **Lambda Triggers**: Trigger Lambda functions for file processing
- **Performance Optimizations**: Caching, retry logic, and batch processing for S3 operations
- **Request Tracing**: Request ID tracking for better debugging and traceability
- **Robust Error Handling**: Standardized error responses with detailed information

## Prerequisites

- Node.js (v14 or later)
- TypeScript (v4.5 or later)
- AWS Account with S3 access
- Docker (optional, for containerized deployment)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-organization/multipartupload-middleware.git
cd multipartupload-middleware
```

2. Install dependencies:

```bash
npm install
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
KEYCLOAK_URL=https://your-keycloak-url/auth
KEYCLOAK_REALM=your-realm
KEYCLOAK_CLIENT_ID=your-client-id
KEYCLOAK_PUBLIC_KEY=your-public-key
```

## Development

1. Start the development server:

```bash
npm run dev
```

2. Build the project:

```bash
npm run build
```

3. Run tests:

```bash
npm test
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
npm run build
```

2. Deploy to AWS using the provided scripts:

```bash
npm run deploy:aws
```

## API Documentation

Detailed API documentation is available in the [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) file.

## Architecture

The middleware follows a layered architecture:

1. **Routes Layer**: Handles HTTP requests and responses
2. **Service Layer**: Contains business logic
3. **Repository Layer**: Interacts with external services (S3, etc.)
4. **Core Layer**: Contains common utilities, types, and error handling

### Key Components

- **S3 Repository**: Handles direct interactions with AWS S3
- **S3 Service**: Provides business logic for S3 operations
- **Multipart Upload Service**: Manages multipart upload operations
- **File Preview Service**: Generates file previews
- **ZIP Download Service**: Creates and manages ZIP archives
- **Lambda Service**: Triggers Lambda functions for file processing

## Performance Optimizations

The middleware includes several performance optimizations:

1. **Caching**: In-memory caching for frequently accessed objects and presigned URLs
2. **Retry Logic**: Automatic retry for transient S3 errors with exponential backoff
3. **Batch Processing**: Optimized batch operations for S3 (delete, list, copy)
4. **Request Monitoring**: Performance monitoring for request execution time

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [Hono](https://github.com/honojs/hono) - Fast, lightweight web framework
- [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js-v3) - AWS SDK for JavaScript
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation


```bash
node -e "const jwt = require('jsonwebtoken'); const token = jwt.sign({ sub: 'provider-123', roles: ['provider'], realm_access: { roles: ['provider'] }, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, 'development-secret-key-do-not-use-in-production'); console.log(token);"
```