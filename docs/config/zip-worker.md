# Zip Worker — Configuration Field Reference

## 0. Document header

| | |
|---|---|
| **Service** | zip worker (`zip-worker`) |
| **Code repo / branch** | `datakaveri/files-connect-api` @ `stable/v2.3`, [workers/zip-worker/](../../workers/zip-worker/) |
| **Config path** | environment only — [docker-compose.yml](../../docker-compose.yml) (`zip-worker` service) locally; [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml) + `files-connect-config` / `files-connect-secret` in Kubernetes |
| **Config schema version** | none — variables are read with `os.environ.get` at point of use |
| **Maintainer / point of contact** | Repository maintainers |
| **Last updated** | 2026-09-16 |

## 1. Top-level structure

| Group | Consumed by | Purpose |
|---|---|---|
| Redis | [worker.py](../../workers/zip-worker/worker.py) `get_redis_client()`, `worker_loop()` | Where to `BRPOP` jobs and write job status |
| Storage | [zip_processor.py](../../workers/zip-worker/zip_processor.py) `get_s3_client()`, [gcs_client.py](../../workers/zip-worker/gcs_client.py) | Which object store to read the databank from and write the zip to |
| Catalogue/ES update | [zip_processor.py](../../workers/zip-worker/zip_processor.py) `update_cat_api()` | Optional post-zip update of `dataUploadStatus` / `fileSize` |

**What it does.** `worker.py` blocks on `BRPOP <ZIP_QUEUE_NAME> 1` in a loop, and for each job
downloads every object under `<databankId>/`, zips it, uploads it to `zips/<databankId>.zip` in the
same bucket, updates the `job:<id>` hash in Redis, and — if catalogue credentials are configured —
patches the catalogue's Elasticsearch document. It exposes no port and has no health endpoint;
liveness is inferred from the log line `Listening on queue: <name>` and from queue depth.

**Startup validation.** Before connecting to Redis the worker checks `BUCKET_NAME`, plus
`S3_ACCESS_KEY`/`S3_SECRET_KEY` unless `STORAGE_PROVIDER=gcs`. Missing values produce
`Missing required environment variables: <names>` followed by `sys.exit(1)` — a `CrashLoopBackOff`
whose cause is the first log line. Everything else fails later, per job.

---

## 2. Field blocks

### `REDIS_HOST`

- **Type / format:** hostname or IP — no scheme, no port.
- **Required:** no.
- **Purpose:** Redis endpoint for job polling and status updates.
- **Expected value:** the same Redis the file server uses; in-cluster Service name resolvable **from the worker's namespace**, or an FQDN (`redis.<ns>.svc.cluster.local`) when they differ.
- **Example value:** `redis`
- **Default if omitted:** `localhost` — which in a container means "no Redis", so this is effectively required in every deployment.
- **How to obtain:** the Redis Service name from [infra/redis-deployment.yaml](../../infra/redis-deployment.yaml), or the managed-Redis endpoint.
- **Failure mode:** `Failed to connect to Redis: Error 111 connecting to …` then `sys.exit(1)`. If it merely points at the *wrong* Redis, the worker starts cleanly and idles forever while jobs pile up on the real one.
- **Notes:** must match the file server's `REDIS_HOST` — see [README.md](./README.md#values-that-must-match-across-services).

### `REDIS_PORT`

- **Type / format:** int as string.
- **Required:** no. **Default:** `6379`.
- **Failure mode:** wrong port → connection refused at startup, exit 1.

### `REDIS_DB`

- **Type / format:** int as string.
- **Required:** no. **Default:** `0`.
- **Purpose:** logical database for both the queue list and the `job:<id>` status hashes.
- **Failure mode:** a value different from the file server's → the worker connects successfully, logs `Successfully connected to Redis database N`, and never receives a job. No error is ever printed. Check this first when jobs stay `queued`.
- **Notes:** ignored when cluster mode is on (Redis Cluster has only db 0).

### `REDIS_PASSWORD`

- **Type / format:** string.
- **Required:** conditional — required iff the server enforces AUTH.
- **Purpose:** added to the client config only when non-empty.
- **Privileges required:** list ops on the queue key and hash ops on `job:*` (`brpop`, `exists`, `hset`, `expire`).
- **Failure mode:** missing → `NOAUTH Authentication required` at startup, exit 1; wrong → `WRONGPASS`.
- **Notes:** currently commented out in [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml); uncomment together with the file server's.

### `REDIS_CLUSTER_MODE` *(feature flag)* / `REDIS_CLUSTER` *(legacy alias)*

- **Type / format:** string; true when it is one of `1`, `true`, `yes` (case-insensitive).
- **Required:** no. **Default:** `false`.
- **Purpose:** selects `redis.cluster.RedisCluster` instead of `redis.Redis`.
- **Notes / gotchas:** `REDIS_CLUSTER` is checked **first** and wins over `REDIS_CLUSTER_MODE` ([worker.py:43](../../workers/zip-worker/worker.py#L43)). Prefer `REDIS_CLUSTER_MODE` — it is the name the file server uses — and do not set both.
- **Failure mode:** on against a standalone server → `Failed to connect to Redis Cluster: … cluster support disabled`, exit 1; off against a cluster → `MOVED` errors while processing.

### `REDIS_CLUSTER_DYNAMIC_STARTUP_NODES`

- **Type / format:** string, true when `1`/`true`/`yes`.
- **Required:** no. **Default:** `false`. **Cluster mode only.**
- **Purpose:** lets the client rediscover cluster nodes from `CLUSTER SLOTS` instead of pinning the configured startup node.
- **Expected value:** keep `false` unless node addresses change under the client (e.g. pods rescheduled behind a headless Service).
- **Failure mode:** `true` with pod IPs that are unreachable from the worker's network → intermittent `ConnectionError` on random slots.
- **Notes:** worker-only; the file server does not read this.

### `ZIP_QUEUE_NAME`

- **Type / format:** string (Redis list key).
- **Required:** no. **Default:** `jobs:zip`.
- **Purpose:** the key the worker `BRPOP`s.
- **Expected value:** byte-identical to the file server's `ZIP_QUEUE_NAME`.
- **How to obtain:** copied from `files-connect-config`; the manifest already sources it from that ConfigMap key, which is the right pattern.
- **Failure mode:** mismatch → the worker logs `Listening on queue: <name>` and idles; the API keeps accepting jobs that are never processed. Silent on both sides.

### `STORAGE_PROVIDER`

- **Type / format:** string, lowercased before comparison — `s3` \| `minio` \| `gcs`.
- **Required:** no. **Default:** `s3`.
- **Purpose:** selects the client built by `get_s3_client()`: native GCS (wrapped in a boto3-compatible facade) for `gcs`, boto3 with a MinIO-shaped config for `minio`, plain boto3 otherwise. It also decides whether `S3_ACCESS_KEY`/`S3_SECRET_KEY` are required at startup.
- **Expected value:** same as the file server's.
- **Failure mode:** an unrecognised value silently falls into the S3 branch (there is no enum check) — with a MinIO endpoint that yields virtual-host addressing and `ENOTFOUND bucket.minio`.

### `S3_ENDPOINT`

- **Type / format:** URL with scheme, no trailing slash.
- **Required:** yes for `minio` (explicitly checked: `S3_ENDPOINT must be set for MinIO`); optional for `s3` (omit for real AWS, set for S3-compatible providers); unused for `gcs`.
- **Purpose:** `endpoint_url` of the boto3 client.
- **Example value:** `http://minio:9000`, `https://storage.example.com`
- **How to obtain:** same value as the file server's `STORAGE_ENDPOINT`; the k8s manifest maps `STORAGE_ENDPOINT` → `S3_ENDPOINT` for exactly this reason.
- **Failure mode:** missing for MinIO → `ValueError: S3_ENDPOINT must be set for MinIO`, the job fails and the status hash records the error. Wrong host → `EndpointConnectionError` per job.

### `S3_REGION`

- **Type / format:** AWS region id.
- **Required:** no. **Default:** `us-east-1` (S3 branch only).
- **Purpose:** signing region in the boto3 `Config` (SigV4).
- **Failure mode:** mismatch → `IllegalLocationConstraintException` / `PermanentRedirect` on the first object call.

### `S3_ACCESS_KEY` / `S3_SECRET_KEY` *(credential pair)*

- **Required:** yes unless `STORAGE_PROVIDER=gcs` — checked at startup, and again in `get_s3_client()` (`S3_ACCESS_KEY and S3_SECRET_KEY must be set`).
- **Which system the account lives in:** AWS IAM / MinIO users / the S3-compatible provider.
- **Privileges required:** on `BUCKET_NAME`: `s3:ListBucket` (prefix `<databankId>/`), `s3:GetObject` on that prefix, `s3:PutObject` on `zips/*`. The worker never deletes and never needs STS.
- **Example value:** same pair as the file server's `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`.
- **How to obtain:** delivered from the `files-connect-secret` Secret; the Deployment maps `STORAGE_ACCESS_KEY` → `S3_ACCESS_KEY`.
- **Failure mode:** missing → `Missing required environment variables: S3_ACCESS_KEY, S3_SECRET_KEY`, exit 1. Wrong → `ClientError … InvalidAccessKeyId` per job; the job status is set to `failed` with that message.
- **Change impact:** rotate together with the file server's key pair, or uploads and zips diverge.

### `USE_SSL`

- **Type / format:** string, true only when equal to `true` (case-insensitive).
- **Required:** no. **Default:** `false` — **the opposite of the file server's `STORAGE_USE_SSL` default (`true`)**.
- **Purpose:** MinIO branch only: sets `use_ssl` on the client.
- **Expected value:** must agree with the scheme of `S3_ENDPOINT`.
- **Failure mode:** mismatch → TLS handshake failure or plaintext-to-TLS-port errors on every job.
- **Notes / gotchas:** because the defaults differ between services, always set this explicitly rather than relying on either default.

### `S3_VERIFY_SSL`

- **Type / format:** string, true unless equal to `false`. **Default:** `true`.
- **Required:** no.
- **Purpose:** turns off TLS certificate verification (`verify=False` in boto3) for endpoints behind a self-signed or private CA.
- **Expected value:** `true` everywhere except deployments with a private CA (e.g. `fs-prod.s3.cyfuture.cloud`).
- **Failure mode:** left `true` against a private CA → `SSLError: certificate verify failed: unable to get local issuer certificate` on every job.
- **Notes:** the **file server does not read this variable** — it has no equivalent knob. If a private CA is in play, the API needs the CA added to its trust store instead.

### `BUCKET_NAME`

- **Required:** **yes** — validated at startup and re-read per job.
- **Purpose:** source of `<databankId>/…` objects and destination of `zips/<databankId>.zip`.
- **Expected value:** identical to the file server's and the report worker's.
- **Failure mode:** missing → startup exit 1; wrong → `Folder not found or empty: <databankId>` and the job is marked `failed`.

### `GCS_PROJECT_ID` / `GCS_KEY_FILE` / `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY`

- **Required:** conditional on `STORAGE_PROVIDER=gcs`; precedence is key file → inline credentials → Application Default Credentials.
- **Purpose:** authenticate the native `google-cloud-storage` client in [gcs_client.py](../../workers/zip-worker/gcs_client.py). The variable names and precedence deliberately mirror the file server's.
- **Privileges required:** `roles/storage.objectAdmin` (or `objectViewer` on the databank prefix + `objectCreator` on `zips/`) on `BUCKET_NAME`.
- **How to obtain:** the same service account as the file server unless you deliberately split roles.
- **Failure mode:** no credential of any kind → the client falls back to ADC and, outside GKE/Workload Identity, fails with `DefaultCredentialsError: Could not automatically determine credentials` on the first job.
- **Notes:** `GCS_PRIVATE_KEY` literal `\n` escapes are converted to newlines, so a single-line Secret value is fine. `GCS_KEY_FILE` needs a mounted volume — not present in the current Deployment.

### `CAT_URL` ⚠️

- **Type / format:** URL with scheme, no trailing slash.
- **Required:** no — the catalogue update is skipped entirely unless `CAT_URL`, `CAT_USERNAME` **and** `CAT_PASSWORD` are all set.
- **Purpose:** despite the name, this is the **Elasticsearch base URL**, not the catalogue REST API. `update_cat_api()` builds `{CAT_URL}/tgdex__cat/_search` and then `_update/{_id}` to set `dataUploadStatus` and `fileSize` ([zip_processor.py:275](../../workers/zip-worker/zip_processor.py#L275)).
- **Expected value:** the Elasticsearch cluster origin, e.g. `https://es.<domain>:9200` — the same value the report worker receives as `ELASTICSEARCH_URL`.
- **Default if omitted:** unset → `CAT API credentials not configured, skipping CAT update` (WARN) and the zip still succeeds.
- **How to obtain:** from the Elasticsearch/catalogue owner.
- **Failure mode:** pointed at the catalogue REST API (`…/iudx/v2/cat`) — which is what the current manifest does, sourcing it from the ConfigMap key `CAT_API_URL` — every update returns 404/405 and is logged as `GET request failed with status code: …`. The zip job itself still reports success, so the symptom is a catalogue that never shows `dataUploadStatus`. **This is a real misconfiguration in [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml); see [deployments.md](./deployments.md).**
- **Notes / gotchas:** the index name `tgdex__cat` is **hard-coded** here (unlike the report worker's configurable `ELASTIC_CAT_INDEX`). Non-TGDEX deployments cannot use this path without a code change.

### `CAT_USERNAME` / `CAT_PASSWORD` *(credential pair)*

- **Required:** conditional — with `CAT_URL`, all three or none.
- **Which system the account lives in:** Elasticsearch (native realm or its configured auth backend).
- **Privileges required:** on the `tgdex__cat` index: `read` (for `_search`) and `write` (for `_update`). A minimal role:
  ```json
  { "indices": [ { "names": ["tgdex__cat"], "privileges": ["read", "write"] } ] }
  ```
  Cluster-level privileges are not needed.
- **Purpose:** HTTP Basic credentials for the two Elasticsearch calls.
- **How to obtain:** created by the Elasticsearch owner; stored in `files-connect-secret`.
- **Failure mode:** wrong → `GET request failed with status code: 401`; insufficient role → 403 on `_update` only, so the search succeeds and the write silently does not.
- **Notes:** the report worker uses `ELASTIC_ID`/`ELASTIC_PASS` for the same cluster — **two different variable names for the same account**. Rotate them together.

---

## 3. Extra requirements by field category — summary

### Credentials

| Pair | System | Privileges |
|---|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | AWS IAM / MinIO | `ListBucket` + `GetObject` on `<databankId>/*`, `PutObject` on `zips/*` |
| `GCS_CLIENT_EMAIL` / `GCS_PRIVATE_KEY` | Google Cloud IAM | `roles/storage.objectAdmin` on the bucket |
| `CAT_USERNAME` / `CAT_PASSWORD` | Elasticsearch | `read` + `write` on `tgdex__cat` |
| `REDIS_PASSWORD` | Redis | `brpop`, `hset`, `exists`, `expire` on `jobs:*` / `job:*` |

### Tuning knobs

The worker has **no concurrency knob** — one process handles one job at a time. Throughput is scaled
by replicas only (`replicas` / HPA in [infra/worker-deployment.yaml](../../infra/worker-deployment.yaml),
or `docker compose up -d --scale zip-worker=3` locally). Size replicas against the zip queue depth and
the memory limit: the whole databank is downloaded to the container filesystem before zipping, so the
ephemeral-storage and memory limits bound the largest databank that can be zipped.
`terminationGracePeriodSeconds: 60` must exceed the longest single zip job, otherwise a rolling
update kills jobs mid-flight (the job then stays `processing` until it is retried).

### Values that must match the file server

`REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `ZIP_QUEUE_NAME`, `BUCKET_NAME`, `STORAGE_PROVIDER`,
`S3_ENDPOINT` (= `STORAGE_ENDPOINT`), `S3_ACCESS_KEY`/`S3_SECRET_KEY`
(= `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`), `USE_SSL` (= `STORAGE_USE_SSL`).
