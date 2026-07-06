# Report Worker Documentation

## 1. Project Overview
The **Report Worker** is a Redis-based worker application that processes data readiness assessment jobs from a job queue. It evaluates the quality, readiness, and completeness of both structured (CSV, Parquet, JSON) and unstructured (PDF, Images, Audio, Excel, DICOM) datasets. It generates detailed JSON reports and PDF summaries, providing scores based on various metrics like missingness, variance, format consistency, and documentation presence.

## 2. Architecture

The report worker follows a Redis-based job queue architecture:

```
TypeScript API → Redis Queue (jobs:report) → Report Worker → S3/MinIO
                      ↓
                 Job Status (Redis)
```

1. The TypeScript API receives requests and creates jobs in Redis
2. The report worker polls the Redis queue for jobs
3. Worker downloads files from S3/MinIO, processes them, and generates reports
4. Worker uploads reports back to storage
5. Worker updates job status in Redis throughout processing

## 3. Installation & Setup

### Prerequisites
- Python 3.11+
- Redis server (for job queue)
- S3/MinIO access credentials
- OpenAI API Key (required for column/role inference)

### Installation

**Using Docker (Recommended):**
```bash
docker-compose up -d report-worker
```

**Manual Installation:**
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Configuration

The worker requires the following environment variables:

#### Required Environment Variables

**Redis Configuration:**
- `REDIS_HOST` - Redis server hostname (default: `localhost`)
- `REDIS_PORT` - Redis server port (default: `6379`)
- `REDIS_DB` - Redis database number (default: `0`)
- `REDIS_PASSWORD` - Redis password (optional, if authentication enabled)
- `REPORT_QUEUE_NAME` - Queue name to listen on (default: `jobs:report`; `READINESS_QUEUE_NAME` is still accepted as a legacy alias)

**Storage Configuration:**
- `BUCKET_NAME` - Single S3/MinIO bucket for all operations (datasets, zips, and PDF reports)
- `S3_ACCESS_KEY` - Storage access key
- `S3_SECRET_KEY` - Storage secret key
- `STORAGE_PROVIDER` - Either `s3` (AWS S3) or `minio` (default: `s3`)

**For MinIO:**
- `S3_ENDPOINT` - MinIO endpoint URL (e.g., `http://minio:9000`)
- `USE_SSL` - Set to `true` or `false` (default: `false`)

**For AWS S3:**
- `S3_REGION` - AWS region (default: `us-east-1`)
- `S3_ENDPOINT` - Optional custom endpoint

**OpenAI Configuration:**
- `OPENAI_API_KEY` - Required for column/role inference

**Optional - CAT API Updates:**
- `ELASTIC_ID` - Elasticsearch ID for CAT API updates
- `ELASTIC_PASS` - Elasticsearch password for CAT API updates

## 4. Usage

### Running the Worker

**Docker Compose:**
```bash
# Start single worker
docker-compose up -d report-worker

# Scale to multiple workers
docker-compose up -d --scale report-worker=4

# View logs
docker-compose logs -f report-worker
```

**Standalone:**
```bash
cd workers/report-worker
python worker.py
```

### Job Queue Format

The API creates report jobs when `POST .../process` is called with body `type` equal to `report` or `all`. For `type: "all"`, the API creates both a zip job and a report job and returns two job IDs; only the report job is pushed to `jobs:report`.

Jobs in the Redis queue (`jobs:report` by default) have the following format:

```json
{
  "jobId": "uuid-v4",
  "type": "report",
  "databankId": "databank-123",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

The worker automatically:
1. Downloads files from `BUCKET_NAME/{databankId}/`
2. Detects data type (structured vs unstructured)
3. Runs appropriate assessment framework
4. Generates JSON and PDF reports
5. Uploads PDF report to `{BUCKET_NAME}/reports/{databankId}/data_readiness_report.pdf`
6. Updates job status in Redis

### Job Status Updates

The worker updates job status in Redis at key `job:{jobId}`:

- `status`: `pending` → `processing` → `completed` or `failed`
- `progress`: Percentage (0-100)
- `result`: JSON string with processing details
- `error`: Error message (if failed)
- `completedAt`: ISO timestamp (when completed/failed)

## 5. Module Descriptions

### Core Worker Modules
- **`worker.py`**: Main worker entry point. Polls Redis queue, processes jobs, and updates job status.
- **`readiness_processor.py`**: Core processing logic. Handles S3 downloads, data type detection, framework execution, and report uploads.
- **`structured_main.py`**: Entry point for structured data assessment. Orchestrates loading, inference, metric calculation, and reporting.
- **`unstructured_main.py`**: Entry point for unstructured data assessment. Handles metadata extraction and similar orchestration.
- **`lambda_handler.py`**: Legacy AWS Lambda wrapper (not used by worker, kept for reference).

### Report Modules (`report/`)
- **`input_handler.py`**: Loads data from directories (supports CSV, Parquet, JSON).
- **`aggregate_structured.py`**: Runs all structured metrics and compiles the raw report.
- **`aggregate_unstructured.py`**: Runs all unstructured metrics and compiles the raw report.
- **`scoring_structured.py` / `scoring_unstructured.py`**: Computes the final weighted scores and percentages.
- **`json_writer.py`**: Saves the raw and final reports to JSON.
- **`pdf_writer.py`**: Generates a visual PDF report from the JSON data.
- **`post_to_cat_api.py`**: Updates an external API (CAT) with the readiness score (optional).

### Metrics Modules
#### Structured Metrics (`structured_metrics/`)
- **`quality.py`**: Checks for missing values (rows/cols) and duplicates.
- **`variance_correctness.py`**: Analyzes numeric variance and categorical distribution.
- **`standardization.py`**: Checks file formats and date/timestamp consistency.
- **`relevance_completeness.py`**: Checks for region coverage.
- **`documentation.py`**: Checks for the presence of data dictionaries/readmes.
- **`llm_api.py`**: Uses OpenAI to infer the semantic roles of columns (e.g., "this is a date", "this is a region").

#### Unstructured Metrics (`unstructured_metrics/`)
- **`metadata_parser.py`**: Extracts metadata from files.
- **`file_format_check.py`**: Validates file extensions.
- **`file_openability.py`**: Tests if files can be opened/read.
- **`file_duplicates.py`**: Checks for duplicate files.
- **`consistency.py`**: Checks if all files in a dataset are of the same type.
- **`llm_api.py`**: Infers roles from metadata.

## 6. Output Artifacts

For each dataset, the framework generates:
1. **`*_raw_readiness_report.json`**: Detailed metric results with all calculated values.
2. **`*_final_readiness_report.json`**: Scored and summarized report with final readiness scores.
3. **`data_readiness_report.pdf`**: A user-friendly PDF summary with visualizations.

The worker uploads the PDF report to S3/MinIO at:
- **Bucket**: `BUCKET_NAME`
- **Path**: `reports/{databankId}/data_readiness_report.pdf`

JSON reports are generated locally during processing but are not uploaded to S3 (only the PDF is uploaded).

## 7. Features

- **Automatic Data Type Detection**: Automatically detects structured (CSV, Parquet, JSON) vs unstructured (PDF, Images, Audio, Excel, DICOM) datasets
- **Memory-Efficient Processing**: Uses temporary directories and streaming downloads
- **Graceful Shutdown**: Handles SIGTERM/SIGINT signals for clean shutdown
- **Automatic Retry**: Retries Redis connection failures (up to 5 consecutive errors)
- **Progress Tracking**: Updates job progress in Redis throughout processing
- **Error Handling**: Comprehensive error handling with detailed logging
- **Dual Storage Support**: Works with both AWS S3 and MinIO
- **Zip File Support**: Automatically extracts zip files during download

## 8. Troubleshooting

### Worker Not Processing Jobs
1. Check Redis connection: `docker-compose logs redis`
2. Verify queue has jobs: `redis-cli LLEN jobs:report`
3. Check worker logs: `docker-compose logs report-worker`

### Job Fails
- Check if databank folder exists in S3/MinIO
- Verify S3 credentials are correct
- Ensure OpenAI API key is set (required)
- Check worker logs for specific error messages

### Missing Reports
- Verify `BUCKET_NAME` is set correctly
- Check worker logs for upload errors
- Ensure the framework successfully generated the PDF report
