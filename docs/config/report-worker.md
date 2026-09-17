# Report Worker (data readiness) — Configuration Field Reference

## 0. Document header

| | |
|---|---|
| **Service** | report worker (`report-worker`), a.k.a. readiness worker |
| **Code repo / branch** | `datakaveri/files-connect-api` @ `stable/v2.3`, [workers/report-worker/](../../workers/report-worker/) |
| **Config path** | environment only — [docker-compose.yml](../../docker-compose.yml) (`report-worker` service) locally; [infra/report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml) + `files-connect-config` / `files-connect-secret` / `report-worker-secret` in Kubernetes |
| **Config schema version** | none — `os.environ.get` at point of use, plus `load_dotenv()` in the framework modules |
| **Maintainer / point of contact** | Repository maintainers |
| **Last updated** | 2026-09-16 |

## 1. Top-level structure

| Group | Consumed by | Purpose |
|---|---|---|
| Redis | [worker.py](../../workers/report-worker/worker.py) | Queue polling and job status |
| Storage | [readiness_processor.py](../../workers/report-worker/readiness_processor.py), [gcs_client.py](../../workers/report-worker/gcs_client.py) | Download the databank, upload the generated report |
| Scoring / LLM | [structured_main.py](../../workers/report-worker/structured_main.py), [unstructured_main.py](../../workers/report-worker/unstructured_main.py) | Structured inference is disabled; unstructured metadata inference uses OpenAI |
| Catalogue REST | [report/dataset_clean_name_api.py](../../workers/report-worker/report/dataset_clean_name_api.py) | Resolve the human-readable dataset name for the report |
| Catalogue index (Elasticsearch) | [report/post_to_cat_api.py](../../workers/report-worker/report/post_to_cat_api.py) | Write `dataReadiness`, `dataUploadStatus`, `lastUpdated`, optionally `publishStatus` |
| Internal | `WORKER_TEMP_DIR`, `AWS_LAMBDA_FUNCTION_NAME` | Set by the worker itself / by the Lambda runtime — **not operator-configurable** |

**What it does.** Blocks on `BRPOP <REPORT_QUEUE_NAME> 1`; per job it downloads everything under
`<databankId>/` into a temp dir, classifies the dataset as structured or unstructured, runs the
corresponding readiness framework, writes the PDF/JSON report to `reports/<databankId>/` in the
bucket, and updates the catalogue's Elasticsearch document with the score. Unstructured datasets skip
scoring and are recorded with readiness `NA`.

**Startup validation.** Identical to the zip worker: `BUCKET_NAME` always, plus
`S3_ACCESS_KEY`/`S3_SECRET_KEY` unless `STORAGE_PROVIDER=gcs`; otherwise
`Missing required environment variables: …` and `sys.exit(1)`. Everything else — OpenAI, Elastic,
catalogue — degrades **per job**, usually with a warning rather than a failure, which is why the
failure-mode notes below matter more than usual.

---

## 2. Field blocks

### Redis and storage fields

`REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`, `REDIS_CLUSTER_MODE` / `REDIS_CLUSTER`,
`REDIS_CLUSTER_DYNAMIC_STARTUP_NODES`, `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `USE_SSL`, `S3_VERIFY_SSL`, `BUCKET_NAME`, `GCS_PROJECT_ID`,
`GCS_KEY_FILE`, `GCS_CLIENT_EMAIL`, `GCS_PRIVATE_KEY` behave **exactly** as documented in
[zip-worker.md](./zip-worker.md) — the two workers share `get_redis_client()` and the storage-client
code almost line for line. Only the differences are repeated here:

- **Storage privileges differ:** this worker also **writes** `reports/<databankId>/…`, so the account
  needs `s3:PutObject` on `reports/*` in addition to read access on `<databankId>/*`.
- **Disk footprint differs:** the entire databank is downloaded into a `TemporaryDirectory`, and
  pandas holds tabular data in memory while scoring. Size the memory limit and ephemeral storage
  against the largest expected dataset, not the average.

### `REPORT_QUEUE_NAME`

- **Type / format:** string (Redis list key).
- **Required:** no.
- **Purpose:** the key this worker `BRPOP`s ([worker.py:220](../../workers/report-worker/worker.py#L220)).
- **Expected value:** byte-identical to the file server's `REPORT_QUEUE_NAME`.
- **Default if omitted:** `READINESS_QUEUE_NAME` if set, else `jobs:report` — the same resolution order the file server uses.
- **How to obtain:** from `files-connect-config`; the Deployment already sources it from that key.
- **Failure mode:** mismatch → `Listening on queue: <name>` and permanent idling while readiness jobs queue up elsewhere. No error on either side.

### `READINESS_QUEUE_NAME` *(legacy alias — deprecated)*

- **Required:** no. Only for deployments predating the rename.
- **Notes:** `REPORT_QUEUE_NAME` takes precedence. Do not set both; do not use in new deployments.

### `OPENAI_API_KEY`

- **Type / format:** string, OpenAI API key (`sk-…`).
- **Required:** for unstructured metadata inference; not currently required for structured inference, which is disabled. The process starts without a key.
- **Purpose:** `infer_metadata_roles_openai()` infers roles from extracted file metadata. The structured column-role helper remains in the code but is not called by `structured_main.py` in this branch.
- **Expected value:** a private key with quota/model access for the active inference path.
- **Default if omitted:** none. At startup the worker logs `OPENAI_API_KEY not found in environment variables. Column role inference will fail.` (WARN) — **and keeps running**.
- **How to obtain:** the OpenAI account owner for the project; stored in the `report-worker-secret` Secret, never in the ConfigMap. This is a paid external provider relationship — confirm who owns billing before rolling to a new environment.
- **Privileges required:** a standard API key with model access; no admin scope.
- **Failure mode:** missing/invalid key or exhausted quota causes errors on the active unstructured inference path; inspect the job errors rather than assuming all report modes require a key.
- **Change impact:** rotating the key requires restarting the report-worker pods (the value is read at import time).
- **Notes:** metadata may leave your environment on the unstructured path. Approve this data sharing before processing sensitive datasets. The startup warning about column-role inference is stale while structured inference is disabled.

### `CAT_API_URL`

- **Type / format:** URL with scheme; a trailing slash is stripped by the code.
- **Required:** no, but required in practice for correct report titles.
- **Purpose:** Catalogue REST base for dataset-name resolution: `{CAT_API_URL}/item?id=<uuid>&auditEnabled=false`, reading `label` (TG-DEX) or `name` (IUDX/ForestDX) from the response ([dataset_clean_name_api.py](../../workers/report-worker/report/dataset_clean_name_api.py)).
- **Expected value:** identical to the file server's `CAT_API_URL`.
- **Example value:** `https://catalogue.example.com/iudx/v2/cat`
- **Default if omitted:** none. No external Catalogue endpoint is selected implicitly; lookup raises a configuration error and the pipeline falls back to the local dataset name.
- **How to obtain:** the catalogue deployment for the environment.
- **Failure mode:** missing/unreachable → lookup raises and the pipeline uses its dataset-name fallback; a wrong environment can still produce the wrong or missing title. Always configure the intended Catalogue.
- **Notes:** this is the **REST API**, distinct from `ELASTICSEARCH_URL` below. Setting one to the other's value is the single most common mistake in this service.

### `ELASTICSEARCH_URL`

- **Type / format:** URL with scheme; trailing slash stripped.
- **Required:** no — the score update is skipped without it.
- **Purpose:** base URL of the Elasticsearch cluster holding the catalogue index; the worker runs `{base}/{index}/_search` to find the document by `id`, then `{base}/{index}/_update/{_id}` ([post_to_cat_api.py:29](../../workers/report-worker/report/post_to_cat_api.py#L29)).
- **Expected value:** cluster origin only, e.g. `https://es.<domain>:9200`. No index, no path.
- **Default if omitted:** unset → `ELASTICSEARCH_URL is not set. Skipping readiness score update in catalogue index.` (WARN). The report is still generated and stored; only the catalogue is not updated.
- **How to obtain:** the Elasticsearch owner for the environment.
- **Failure mode:** absent is a quiet failure — reports exist but catalogue readiness/publication updates are skipped. The current Deployment wires this optional key from the ConfigMap; configure it only when writeback is intended. See [deployments.md](./deployments.md).
- **Notes:** the same cluster the zip worker addresses as `CAT_URL`.

### `ELASTIC_CAT_INDEX`

- **Type / format:** string, Elasticsearch index (or alias) name.
- **Required:** no.
- **Purpose:** the index searched and updated.
- **Expected value:** the catalogue index of that deployment — `tgdex__cat` for TG-DEX; other deployments have their own.
- **Default if omitted:** `tgdex__cat`.
- **Failure mode:** wrong index → `index_not_found_exception` (logged as a failed GET) or, worse, a *valid but wrong* index in which no document matches and the worker logs `No document found for uuid: <id>` and returns — no score written, job still "successful".
- **Notes:** the zip worker hard-codes `tgdex__cat` and ignores this variable.

### `ELASTIC_ID` / `ELASTIC_PASS` *(credential pair)*

- **Type / format:** string / string.
- **Required:** conditional — required whenever `ELASTICSEARCH_URL` is set.
- **Which system the account lives in:** Elasticsearch (native realm or configured backend).
- **Privileges required:** on the index named by `ELASTIC_CAT_INDEX`: `read` (for `_search`) and `write` (for `_update`):
  ```json
  { "indices": [ { "names": ["tgdex__cat"], "privileges": ["read", "write"] } ] }
  ```
  No cluster privileges. `elastic` (superuser) is often used and should be replaced with a scoped role.
- **Example value:** `elastic` / a generated password.
- **Default if omitted:** none — `Elasticsearch credentials are missing. Username or password is None.` (ERROR) and the update is skipped; the job still completes.
- **How to obtain:** the Elasticsearch owner; stored in `report-worker-secret`.
- **Failure mode:** wrong → `GET request failed with status code: 401`; read-only role → the search succeeds and the `_update` fails with 403, so scores are computed but never visible.
- **Change impact:** the same account is used by the zip worker under the names `CAT_USERNAME`/`CAT_PASSWORD` — rotate both places together.

### `CAT_SET_PUBLISH_STATUS` *(feature flag)*

- **Type / format:** string, true unless equal to `false` (case-insensitive).
- **Required:** no.
- **Purpose:** when true, the readiness update also sets `publishStatus: "ACTIVE"` on the catalogue document, i.e. **completing a readiness report publishes the dataset** ([post_to_cat_api.py:93](../../workers/report-worker/report/post_to_cat_api.py#L93)).
- **Expected value:** `true` for TG-DEX; `false` for deployments that manage publication elsewhere (e.g. MahaAgri).
- **Default if omitted:** `true`.
- **How to obtain:** product decision per deployment, not an infrastructure detail — confirm with the deployment owner.
- **Failure mode:** wrongly `true` → datasets are auto-published the moment a report finishes, bypassing that deployment's review step. Wrongly `false` → datasets stay unpublished and operators see readiness scores appear with no state change (log line `CAT_SET_PUBLISH_STATUS is disabled. Skipping publishStatus update.`).
- **Notes:** added in commit `a21ca17`; it must be set explicitly in every non-TG-DEX deployment because the default publishes.

### `WORKER_TEMP_DIR` *(internal — do not set)*

- **Purpose:** written by `readiness_processor.py` before invoking the framework so report output lands in the job's temp directory; read back by `get_output_dir()`.
- **Notes:** setting it externally makes reports land outside the per-job `TemporaryDirectory` and leak disk across jobs. Leave unset.

### `AWS_LAMBDA_FUNCTION_NAME` *(internal — set by the Lambda runtime)*

- **Purpose:** presence switches report output to `/tmp` for the Lambda packaging of the same code ([lambda_handler.py](../../workers/report-worker/lambda_handler.py)). Irrelevant to the container deployment.
- **Notes:** never set manually.

---

## 3. Extra requirements by field category — summary

### Credentials

| Pair | System | Privileges |
|---|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | AWS IAM / MinIO | `ListBucket` + `GetObject` on `<databankId>/*`; `PutObject` on `reports/*` |
| `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY` | Google Cloud IAM | `roles/storage.objectAdmin` on the bucket |
| `ELASTIC_ID` / `ELASTIC_PASS` | Elasticsearch | `read` + `write` on `ELASTIC_CAT_INDEX` |
| `OPENAI_API_KEY` | OpenAI (external provider) | model access; billing owner must be identified per environment |
| `REDIS_PASSWORD` | Redis | `brpop`, `hset`, `exists`, `expire` on `jobs:*` / `job:*` |

### External provider fields

`OPENAI_API_KEY` is the only external-provider dependency. It requires an OpenAI account with an
active payment method; there is no sandbox/dev endpoint distinction in the code (the default OpenAI
API base is used). Datasets are sent as **column names plus the first 20 rows** to the model — confirm
that this is acceptable for the data classification of each deployment before enabling structured
scoring on sensitive datasets.

### Feature flags

| Flag | Turns on | Then also required |
|---|---|---|
| `CAT_SET_PUBLISH_STATUS` (default **true**) | auto-publishing on report completion | `ELASTICSEARCH_URL`, `ELASTIC_ID`, `ELASTIC_PASS` |
| `REDIS_CLUSTER_MODE` (default false) | cluster client | cluster-capable Redis; `REDIS_DB` ignored |

### Tuning knobs

No concurrency setting — one job per process. Scale with replicas / HPA
([infra/report-worker-deployment.yaml](../../infra/report-worker-deployment.yaml): `replicas: 4`,
HPA 4→12 at 70% CPU / 80% memory). Because scoring is CPU- and memory-heavy, the memory **limit**
(4 Gi) is the real ceiling on dataset size: exceeding it gets the container OOM-killed mid-job and the
job stays `processing` until retried, with no application-level error.
`terminationGracePeriodSeconds: 120` should exceed the longest expected report run.

### Values that must match other services

`REDIS_HOST`/`REDIS_PORT`/`REDIS_DB` and `REPORT_QUEUE_NAME` (file server), `BUCKET_NAME` /
`STORAGE_PROVIDER` / storage endpoint and credentials (file server and zip worker), `CAT_API_URL`
(file server), `ELASTICSEARCH_URL` ≡ the zip worker's `CAT_URL`, `ELASTIC_ID`/`ELASTIC_PASS` ≡ the
zip worker's `CAT_USERNAME`/`CAT_PASSWORD`.
