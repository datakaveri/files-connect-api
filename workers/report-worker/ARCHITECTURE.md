# Report Worker — Architecture

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [Entry Points & Invocation](#3-entry-points--invocation)
4. [Message & Event Schema](#4-message--event-schema)
5. [External Service Integrations](#5-external-service-integrations)
6. [Report Generation Pipeline](#6-report-generation-pipeline)
   - [Structured Data](#61-structured-data-flow)
   - [Unstructured Data](#62-unstructured-data-flow)
   - [Unknown / Non-Classified Data](#63-unknown--non-classified-data)
7. [Metrics Catalogue](#7-metrics-catalogue)
   - [Structured Metrics](#71-structured-metrics)
   - [Unstructured Metrics](#72-unstructured-metrics)
8. [Scoring Model](#8-scoring-model)
9. [Output Formats](#9-output-formats)
10. [Error Handling & Retry Strategy](#10-error-handling--retry-strategy)
11. [Configuration Reference](#11-configuration-reference)
12. [Integration with files-connect-api](#12-integration-with-files-connect-api)
13. [Infrastructure & Deployment](#13-infrastructure--deployment)
14. [Python Dependencies](#14-python-dependencies)
15. [Local Development & Testing](#15-local-development--testing)
16. [Known Limitations](#16-known-limitations)

---

## 1. Overview

The **Report Worker** is an asynchronous Python microservice that computes a **data readiness score** for uploaded datasets and produces:

- A **JSON raw report** (per-metric detail)
- A **JSON final report** (scored summary)
- A **PDF visual report** (human-readable)
- An **Elasticsearch update** (dataset catalogue entry)

It runs continuously as a Kubernetes workload (or an AWS Lambda for legacy use), polling a Redis queue for jobs. Each job targets a **databank** — a logical folder in S3/MinIO/GCS containing one or more dataset files.

The worker supports two broad data classes:

| Class | File Types |
|---|---|
| **Structured** | CSV, Parquet, JSON |
| **Unstructured** | PDF, images (JPG/PNG/TIFF), audio (MP3), Office (XLSX/XLS), DICOM, text (TXT/MD) |

If a dataset is neither, it is classified as `unknown` and skipped (the catalogue is updated with `score='NA'`).

---

## 2. Directory Structure

```
workers/report-worker/
├── Dockerfile.worker               # Kubernetes worker container image
├── requirements.txt                # Python dependencies
│
├── worker.py                       # Redis queue worker — main loop
├── lambda_handler.py               # AWS Lambda entry point (legacy)
├── readiness_processor.py          # Core orchestration: S3 download → framework → S3 upload
├── structured_main.py              # Structured data processing entry
├── unstructured_main.py            # Unstructured data processing entry
│
├── report/                         # Report generation modules
│   ├── input_handler.py            # Loads CSV/Parquet/JSON from disk
│   ├── aggregate_structured.py     # Runs all structured metrics, compiles raw report
│   ├── aggregate_unstructured.py   # Runs all unstructured metrics, compiles raw report
│   ├── scoring_structured.py       # Weighted final score (structured)
│   ├── scoring_unstructured.py     # Weighted final score (unstructured)
│   ├── json_writer.py              # Writes raw & final reports to JSON files
│   ├── pdf_writer.py               # Generates styled PDF from final JSON
│   ├── post_to_cat_api.py          # Updates Elasticsearch catalogue
│   ├── dataset_clean_name_api.py   # Resolves display name from CAT API
│   └── multifile_average_score.py  # Averages scores across multiple files
│
├── structured_metrics/             # Metric implementations for structured data
│   ├── quality.py                  # Missing values, row duplicates
│   ├── variance_correctness.py     # Numeric variance, categorical distribution
│   ├── standardization.py          # File format, date/timestamp consistency
│   ├── relevance_completeness.py   # Geographic region coverage
│   ├── documentation.py            # Data dictionary / README presence
│   ├── llm_api.py                  # OpenAI column role inference (optional)
│   ├── model_ingestible.py         # Model readiness checks
│   └── regular_refresh.py          # Data freshness checks
│
├── unstructured_metrics/           # Metric implementations for unstructured data
│   ├── metadata_parser.py          # File metadata extraction
│   ├── file_format_check.py        # Extension validation
│   ├── file_openability.py         # Read-access tests
│   ├── file_duplicates.py          # Duplicate detection
│   ├── file_type_consistency.py    # Type uniformity across dataset
│   ├── llm_api.py                  # OpenAI metadata role inference
│   ├── documentation.py            # Documentation presence
│   ├── coverage.py                 # Geographic coverage
│   ├── timestamps_presence.py      # Timestamp metadata
│   └── model_ingestible.py         # Model readiness checks
│
├── tests/                          # Unit tests (pytest)
│   ├── test_quality.py
│   ├── test_documentation.py
│   ├── test_model_ingestible.py
│   └── test_standardization.py
│
├── data/                           # Sample data for testing
├── outputReports/                  # Local output directory (dev/debug)
├── plots/                          # Logo assets used in PDF generation
└── local_lambda_tester.py          # Legacy local Lambda invocation helper
```

---

## 3. Entry Points & Invocation

### 3.1 Redis Worker (Production)

**File**: `worker.py`
**Trigger**: Redis list `jobs:report` (blocking pop)

```
┌──────────────┐   push job JSON   ┌───────────────────┐
│ files-connect│ ────────────────► │ Redis              │
│     API      │                   │  List: jobs:report │
└──────────────┘                   └────────┬──────────┘
                                            │ BRPOP (1s timeout)
                                   ┌────────▼──────────┐
                                   │   worker.py        │
                                   │  main loop         │
                                   └────────┬──────────┘
                                            │ process_readiness_job()
                                   ┌────────▼──────────┐
                                   │ readiness_         │
                                   │ processor.py       │
                                   └───────────────────┘
```

**Worker loop logic**:

1. `BRPOP jobs:report 1` — wait up to 1 second for a job.
2. Parse JSON: `{jobId, type, databankId, createdAt, options}`.
3. Update Redis hash `job:{jobId}` → `status=processing`.
4. Call `process_readiness_job(databankId)`.
5. On success: update hash → `status=completed`, `result=<json>`, `completedAt=<iso>`.
6. On failure: update hash → `status=failed`, `error=<message>`, `completedAt=<iso>`.
7. If 5 consecutive errors occur (connection failures), wait 5 s, then retry.
8. Graceful shutdown on `SIGTERM`/`SIGINT`.

---

### 3.2 AWS Lambda (Legacy)

**File**: `lambda_handler.py`
**Handler**: `lambda_handler.lambda_handler`

**Event schema**:
```json
{
  "body": {
    "folder_key": "databank-id"
  }
}
```
`folder_key` may also be a list for batch processing.

The Lambda container image Dockerfile has been removed; active deployments build `Dockerfile.worker`.

The Lambda path downloads files, runs the framework, and uploads reports directly — bypassing the Redis queue.

---

### 3.3 Direct Execution (Testing / Debug)

From `workers/report-worker`, run the synthetic structured example with
`python local_lambda_tester.py` after installing the worker dependencies. It invokes
`structured_main.main(directory, folder_key)` directly with Catalogue lookups and writeback
turned off, and writes ignored outputs under `outputReports/`.

The bare `python structured_main.py` / `python unstructured_main.py` entrypoints do not supply
those required arguments. Use the tester or an explicit Python call instead. Unstructured
inference makes external OpenAI calls; use only approved data and private credentials.

---

## 4. Message & Event Schema

### 4.1 Job Queue Entry

Pushed by `files-connect-api` into the Redis list `jobs:report`:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "type": "report",
  "databankId": "databank-123",
  "options": {},
  "createdAt": "2025-04-28T10:00:00.000Z"
}
```

### 4.2 Job Status Hash (Redis)

Stored at key `job:{jobId}` (TTL: 7 days):

| Field | Type | Values |
|---|---|---|
| `jobId` | string | UUID |
| `type` | string | `"report"` |
| `status` | string | `pending` → `processing` → `completed` \| `failed` |
| `databankId` | string | Target databank ID |
| `progress` | string | `"0"` – `"100"` |
| `createdAt` | string | ISO 8601 |
| `completedAt` | string | ISO 8601 (set on finish) |
| `error` | string | Error message (failed only) |
| `result` | string | JSON-stringified result (completed only) |

### 4.3 Processor Result

Returned by `readiness_processor.process_readiness_job()`:

```python
{
    'success': bool,
    'message': str,
    'data_type': 'structured' | 'unstructured' | 'unknown',
    'files_processed': int,
    'reports_uploaded': int,
    'processing_time_seconds': float,
    'download_time_seconds': float,
    'framework_time_seconds': float,
    'upload_time_seconds': float,
    # only on failure:
    'error': str
}
```

---

## 5. External Service Integrations

### 5.1 S3 / MinIO (Object Storage)

**Used for**: downloading input files, uploading output reports.

| Operation | S3 Path |
|---|---|
| Download input | `{BUCKET_NAME}/{databankId}/*` |
| Upload PDF report | `{BUCKET_NAME}/reports/{databankId}/data_readiness_report.pdf` |
| Upload raw JSON | `{BUCKET_NAME}/reports/{databankId}/{name}_raw_readiness_report.json` |
| Upload final JSON | `{BUCKET_NAME}/reports/{databankId}/{name}_final_readiness_report.json` |

**Client**: `boto3` with signature v4 and path-style addressing for MinIO compatibility.

**Special handling**:
- ZIP files in the bucket are automatically extracted before processing.
- Large files (> 400 MB) are sampled to 1 M rows to prevent OOM.

**Configuration**:

```
STORAGE_PROVIDER   s3 | minio
S3_ACCESS_KEY      AWS access key or MinIO root user
S3_SECRET_KEY      AWS secret or MinIO root password
BUCKET_NAME        Target bucket name
S3_ENDPOINT        http://minio:9000  (MinIO); omit for AWS
S3_REGION          us-east-1          (S3 only)
USE_SSL            true | false
S3_VERIFY_SSL      true | false
```

---

### 5.2 Redis (Job Queue & Status Store)

**Used for**: receiving jobs, tracking job state.

| Operation | Command | Purpose |
|---|---|---|
| Receive job | `BRPOP jobs:report 1` | Blocking pop with 1 s timeout |
| Check queue depth | `LLEN jobs:report` | Monitoring |
| Write status | `HSET job:{jobId} ...` | Status updates |
| Check job exists | `EXISTS job:{jobId}` | Deduplication |

**Configuration**:

```
REDIS_HOST            redis (Docker) or redis-service.default.svc.cluster.local (K8s)
REDIS_PORT            6379
REDIS_DB              0
REDIS_PASSWORD        (optional)
REDIS_CLUSTER         false | true  — enables cluster-aware client for K8s
REPORT_QUEUE_NAME     jobs:report
```

---

### 5.3 OpenAI API

**Used for**: semantic column/metadata role inference (LLM-assisted metrics).

- **Structured**: `structured_metrics/llm_api.py` — an inactive helper for inferring the semantic role of each column (e.g., "region", "date", "identifier") to improve coverage and completeness scoring.
- **Unstructured**: `unstructured_metrics/llm_api.py` — infers the semantic category of each file from its metadata.

> **Note**: Structured OpenAI calls are currently **disabled** in `structured_main.py`; setting a key alone does not enable them. Unstructured metadata inference still makes external calls. Approve data sharing before using it.

**Configuration**:

```
OPENAI_API_KEY   sk-...
```

---

### 5.4 Elasticsearch / CAT API (Catalogue)

**Used for**: updating the dataset catalogue with readiness scores and status.

**Update payload** (via `report/post_to_cat_api.py`):

```json
{
  "dataReadiness": 78.5,
  "dataUploadStatus": "processed",
  "publishStatus": "ready",
  "lastUpdated": "2025-04-28T15:30:00+05:30"
}
```

**Flow**:
1. GET request to find the document by `databankId`.
2. POST/PATCH to update readiness fields.
3. Timestamp recorded in `Asia/Kolkata` timezone.

If credentials are missing, the update is **skipped with a warning** — this is non-fatal.

**Dataset name resolution** (`report/dataset_clean_name_api.py`):
- Calls the CAT API to resolve a human-readable display name from the folder key before embedding it in the PDF.

**Configuration**:

```
ELASTICSEARCH_URL    https://elastic.example.com
ELASTIC_CAT_INDEX    tgdex__cat  (default)
ELASTIC_ID           username
ELASTIC_PASS         password
CAT_API_URL          https://cat-api.example.com
```

---

## 6. Report Generation Pipeline

### 6.1 Structured Data Flow

Input file types: **CSV**, **Parquet**, **JSON**

```
readiness_processor.py
  │  Detect: at least one .csv / .parquet / .json file
  ▼
structured_main.py
  │
  ├─► input_handler.load_data_from_directory()
  │     Loads all files into pandas DataFrames
  │     Applies 1 M row sampling if file > 400 MB
  │
  └─► for each file:
        │
        ├─► aggregate_structured.generate_raw_report()
        │     ├─ quality.check_column_missing()
        │     ├─ quality.check_row_missing()
        │     ├─ quality.check_row_duplicates()
        │     ├─ relevance_completeness.check_coverage_region()
        │     ├─ variance_correctness.check_numeric_variance()
        │     ├─ variance_correctness.check_categorical_variation()
        │     ├─ standardization.check_file_format()
        │     ├─ standardization.check_date_and_timestamp_format()
        │     ├─ standardization.check_date_or_timestamp_fields()
        │     └─ documentation.check_documentation_presence()
        │
        ├─► scoring_structured.compute_aggregate_score()
        │     Applies section weights → total_percentage
        │
        ├─► json_writer.write_report_outputs()
        │     Writes raw + final JSON to outputReports/
        │
        └─► pdf_writer.generate_pdf_from_json()
              Generates data_readiness_report.pdf

  If multiple files ──► multifile_average_score.calculate_average_readiness()

  └─► post_to_cat_api.update_cat_readiness_score()
        Updates Elasticsearch catalogue entry
```

---

### 6.2 Unstructured Data Flow

Input file types: **PDF, JPG, PNG, TIFF, MP3, XLSX, XLS, DICOM, TXT, MD**

```
readiness_processor.py
  │  Detect: structured files absent, unstructured files present
  ▼
unstructured_main.py
  │
  ├─► metadata_parser.process_folder_to_metadata_json()
  │     Extracts: file type, size, mtime, dimensions (images),
  │               duration (audio), DICOM tags, etc.
  │
  └─► for each subfolder (or root):
        │
        ├─► llm_api.infer_metadata_roles_openai()   [optional]
        │
        ├─► aggregate_unstructured.generate_raw_report()
        │     ├─ file_duplicates.check_file_duplicates()
        │     ├─ file_type_consistency.check_type_uniformity()
        │     ├─ file_openability.check_file_openability()
        │     ├─ documentation.check_label_presence()
        │     ├─ timestamps_presence.check_timestamp_presence()
        │     ├─ coverage.region_coverage()
        │     ├─ file_format_check.check_file_format()
        │     └─ documentation.check_documentation_presence()
        │
        ├─► scoring_unstructured.compute_aggregate_score()
        │
        ├─► json_writer.write_report_outputs()
        │
        ├─► pdf_writer.generate_pdf_from_json()
        │
        └─► post_to_cat_api.update_cat_readiness_score()

  If multiple datasets ──► multifile_average_score.calculate_average_readiness()
```

---

### 6.3 Unknown / Non-Classified Data

If a databank contains neither recognized structured nor unstructured file types:

1. Framework processing is **skipped entirely**.
2. CAT API is updated with `score='NA'`.
3. No JSON or PDF reports are generated.
4. Job completes successfully with `data_type='unknown'`.

---

## 7. Metrics Catalogue

### 7.1 Structured Metrics

| ID | Module | Metric | Description |
|---|---|---|---|
| QC01 | `quality.py` | Column Missing Values | % of nulls per column; flags columns exceeding 30% threshold |
| QC02 | `quality.py` | Row Missing Values | Rows with any null value |
| QC03 | `quality.py` | Row Duplicates | Exact duplicate row count |
| VC01 | `variance_correctness.py` | Numeric Variance | Variance per numeric column; detects zero-variance columns |
| VC02 | `variance_correctness.py` | Categorical Distribution | Value frequency distribution for categorical columns |
| ST01 | `standardization.py` | File Format | Validates expected file extension and encoding |
| ST02 | `standardization.py` | Date/Timestamp Format | Consistency of date patterns across columns |
| ST03 | `standardization.py` | Date/Timestamp Fields Presence | Whether any date/time columns exist |
| RC01 | `relevance_completeness.py` | Region Coverage | Presence of expected geographic region identifiers |
| DC01 | `documentation.py` | Documentation Presence | Whether a data dictionary or README exists in the folder |
| LLM01 | `llm_api.py` | Column Role Inference | OpenAI-assigned semantic roles (disabled by default) |
| MI01 | `model_ingestible.py` | Model Readiness | Checks whether data is suitable for ML ingestion |
| RR01 | `regular_refresh.py` | Data Freshness | Recency of the dataset based on file modification timestamps |

---

### 7.2 Unstructured Metrics

| ID | Module | Metric | Description |
|---|---|---|---|
| UQ01 | `file_duplicates.py` | File Duplicates | Detects identical files by hash or name |
| UQ02 | `file_type_consistency.py` | Type Uniformity | Whether all files share the same type |
| UQ03 | `file_openability.py` | File Openability | Attempts to open/read each file; flags corrupted files |
| UD01 | `documentation.py` | Label Presence | Whether label / annotation files exist |
| UD02 | `documentation.py` | Documentation Presence | README or data dictionary in the folder |
| UT01 | `timestamps_presence.py` | Timestamp Presence | Metadata timestamp fields present on files |
| UC01 | `coverage.py` | Region Coverage | Geographic coverage represented in metadata |
| UF01 | `file_format_check.py` | File Format Validity | Extension matches recognized unstructured formats |
| ULLM01 | `llm_api.py` | Metadata Role Inference | OpenAI-assigned semantic categories from metadata |
| UMI01 | `model_ingestible.py` | Model Readiness | File format and structure suitable for ML ingestion |

---

## 8. Scoring Model

Each metric produces a raw result. The scoring modules translate these into a weighted score.

### Structured Scoring (`scoring_structured.py`)

```
Section                 Weight
─────────────────────   ──────
Data Quality            25 %
Variance & Correctness  20 %
Standardization         20 %
Relevance & Completeness 15 %
Documentation           10 %
Model Ingestibility     10 %
─────────────────────   ──────
Total                   100 %
```

### Unstructured Scoring (`scoring_unstructured.py`)

Similar weighted sections adapted for file-centric metrics (openability, duplicates, format, documentation, coverage, model readiness).

### Multi-File Aggregation (`multifile_average_score.py`)

When a databank contains multiple independent datasets:
- Each file/folder is scored independently.
- `calculate_average_readiness()` computes the arithmetic mean of all `total_percentage` values.
- The average is used for the CAT API update and PDF summary.

---

## 9. Output Formats

### 9.1 Raw Report JSON (`{dataset_name}_raw_readiness_report.json`)

Detailed per-metric results before weighting:

```json
{
  "detailed_scores": {
    "column_missing": { "col1": 5.2, "col2": 0.0 },
    "column_missing_count": 2,
    "row_missing_count": 10,
    "row_duplicates_count": 5,
    "numeric_variance": { "price": 12345.6 },
    "categorical_variation": { "region": { "North": 400, "South": 600 } }
  },
  "total_percentage": 78.5
}
```

### 9.2 Final Report JSON (`{dataset_name}_final_readiness_report.json`)

Scored, human-readable summary per section:

```json
{
  "total_percentage": 78.5,
  "sections": [
    {
      "name": "Data Quality",
      "weight": 25,
      "tests": [
        {
          "id": "QC01",
          "title": "Column Missing Values",
          "note": "2 columns exceed 30% missing threshold",
          "score": 13,
          "max_score": 15
        }
      ]
    }
  ]
}
```

### 9.3 PDF Report (`data_readiness_report.pdf`)

Generated by `fpdf` via `report/pdf_writer.py`:

- **Header**: dataset name, generation date, overall readiness percentage.
- **Logo**: MahaAgX branding from `plots/pretty/mahaagx-logo-dark.png` (if present).
- **Body**: table per section — test ID, description, findings, score / max score.
- **Footer**: page numbers and timestamp.
- **Encoding**: Helvetica font; all text is ASCII-sanitised to avoid FPDF encoding errors.

Uploaded to S3 at: `{BUCKET_NAME}/reports/{databankId}/data_readiness_report.pdf`

Accessible via API at: `GET /v1/databanks/{databankId}/report/download`

---

## 10. Error Handling & Retry Strategy

### Worker Level (`worker.py`)

| Scenario | Behaviour |
|---|---|
| Redis connection error | Wait 5 s, increment error counter, retry |
| 5 consecutive errors | Log critical error, continue waiting (does not exit) |
| Successful reconnect | Reset error counter to 0 |
| `SIGTERM` / `SIGINT` | Set shutdown flag, finish current job, then exit cleanly |

### Job Level (`readiness_processor.py`)

| Scenario | Behaviour |
|---|---|
| Missing required env vars | Validate on startup; log and raise immediately |
| S3 connection failure | Exception propagates → job marked `failed` |
| Empty databank folder | `ValueError` raised → job marked `failed` |
| Framework execution error | Caught, full traceback logged, job marked `failed` |
| CAT API failure | Logged as warning; job still completes as `success` |
| Unknown data type | No processing; job completes as `success` with `data_type='unknown'` |

### Infrastructure Level (Kubernetes)

- `terminationGracePeriodSeconds: 120` — gives in-flight jobs time to finish on pod eviction.
- The example HPA maintains at least 4 worker replicas, but Redis remains a single point of failure.
- Redis AOF/PVC reduces data loss but cannot guarantee durability for jobs not yet persisted.

---

## 11. Configuration Reference

Use [the report-worker field reference](../../docs/config/report-worker.md) for required fields,
provider-specific credentials, defaults, and failure modes. The [shared configuration overview](../../docs/config/README.md)
lists the bucket, Redis DB, queues, and storage settings that must align with the API.

Configuration templates contain only localhost/example values. Keep populated `.env`,
Kubernetes Secrets, key files, and Postman exports private. Structured OpenAI inference is
currently disabled; unstructured metadata inference remains active.

---

## 12. Integration with files-connect-api

The report worker is triggered exclusively through the main API. Here is the end-to-end call chain:

```
Client
  │  POST /v1/databanks/{databankId}/process   {"type": "report"}
  ▼
src/routes/databanks-routes.ts
  │  Validates request, resolves databankId
  ▼
src/services/processing-service.ts
  │  Generates UUID jobId
  │  Calls pushJob('report', jobId, databankId)
  ▼
src/core/utils/job-queue.ts
  │  HSET job:{jobId} {status: 'pending', ...}   (7-day TTL)
  │  LPUSH jobs:report  <job-json>
  ▼
Redis
  │  Queue: jobs:report
  ▼
worker.py  ◄──── BRPOP ─────
  │  process_readiness_job(databankId)
  ▼
readiness_processor.py
  │  Download from S3 → Run framework → Upload to S3
  ▼
Job status updated: completed | failed
  ▼
Client
  GET /v1/databanks/{databankId}/process/{jobId}    — poll status
  GET /v1/databanks/{databankId}/report/download    — fetch PDF
```

**Shared infrastructure**:
- Both the API and worker use the **same Redis instance** and **same S3 bucket**.
- The API reads job status from Redis (`job:{jobId}`) and serves PDF presigned URLs from S3.
- No direct network call exists between the API and the worker — all coordination is through Redis and S3.

---

## 13. Infrastructure & Deployment

The active worker image is [Dockerfile.worker](Dockerfile.worker). The legacy Lambda container
Dockerfile was removed. Kubernetes uses [report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml)
with non-root uid 1000, configurable storage/Redis credentials, and an HPA.

Follow [the infrastructure guide](../../infra/README.md) to build pinned images and prepare
private configuration copies. The current example manifest has 4 base/minimum replicas and
an HPA maximum of 12; resource settings and scaling limits are documented centrally in
[deployment configuration](../../docs/config/deployments.md).

For verification, troubleshooting, scaling, and rollback, use [DEPLOYMENT.md](DEPLOYMENT.md).
The [local Compose stack](../../docker-compose.yml) supplies MinIO, Redis, and the workers;
its API is commented out. Local storage/Redis ports bind only to localhost.

---

## 14. Python Dependencies

[requirements.txt](requirements.txt) is the source of truth for worker dependencies and security
version constraints. Do not copy dependency versions from an old documentation table.
Install pytest separately when running the scoring test suite; it is not a runtime dependency.

---

## 15. Local Development & Testing

Start the local stack and private environment as described in [the root README](../../README.md).
Use a synthetic databank when submitting report jobs through [Postman](../../postman/README.md).
Do not put JWTs, presigned URLs, or credentials in command-line snippets or shared logs.

From this directory, after installing dependencies:

```bash
python local_lambda_tester.py
python -m pytest tests
```

The [synthetic tester](data/example/README.md) does not call a Catalogue or write back to
Elasticsearch. Its structured path currently skips OpenAI inference. Generated reports and
additional local input data are ignored by Git.

Configuration-hygiene tests can run without the scoring dependencies (requests is required):

```bash
python -m unittest discover -s tests -p test_dataset_name_configuration.py
```

---

## 16. Known Limitations

| # | Limitation | Detail |
|---|---|---|
| 1 | **Structured OpenAI inference disabled** | Column role inference in `structured_main.py` is commented out; unstructured metadata inference remains active. Re-enable by restoring the LLM call and setting `OPENAI_API_KEY`. |
| 2 | **Single-bucket architecture** | Input files, intermediate state, and output reports all share the same `BUCKET_NAME`. No staging or output-only bucket separation. |
| 3 | **No job timeout** | Individual jobs have no wall-clock timeout. A hung job will block the worker slot until Kubernetes kills the pod (`terminationGracePeriodSeconds: 120`). |
| 4 | **Memory-bound on large files** | Files > 400 MB are sampled to 1 M rows. The sampling flag is noted in the PDF but the metric results may not represent the full dataset. |
| 5 | **Job status TTL** | Redis keys expire after 7 days. Long-running investigations relying on old job IDs will get a 404. |
| 6 | **CAT API is optional but silent** | If `ELASTICSEARCH_URL` is absent, the catalogue is never updated. There is no alerting on this condition. |
| 7 | **PDF logo path is hard-coded** | `pdf_writer.py` expects `plots/pretty/mahaagx-logo-dark.png` at a relative path inside the temp directory. Missing logo produces a PDF without branding but no error. |
| 8 | **Unknown data type produces no report** | If a dataset cannot be classified as structured or unstructured, no PDF/JSON is generated and the API returns `data_type='unknown'` with no actionable output for the user. |
