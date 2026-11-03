# Databank Multipart Uploads

Databank uploads use storage-level multipart upload. This is different from the HTTP
`multipart/form-data` upload used by `POST /v1/assets`: databank file bytes are sent directly from
the client to S3, MinIO, or GCS through presigned URLs and do not pass through the file-server
process.

The file server acts as the control plane: it authenticates and authorizes the operation, creates
the upload session, issues temporary part URLs, and finalizes or aborts the upload. Object storage
is the data plane and receives the part bodies.

## Why multipart upload is used

Multipart upload is the primary databank upload path because it:

- lets a client retry one failed part instead of restarting a large file;
- keeps large request bodies out of the file server's memory, bandwidth, and request lifecycle;
- gives clients part-level progress and permits parallel uploads;
- supports the object store's large-object upload workflow; and
- does not publish the newly uploaded bytes at the destination until the client explicitly
  completes the upload.

The supplied Python uploaders currently send parts sequentially. The protocol permits parallel
uploads, but a client must still retain every returned ETag and submit the complete, correctly
numbered part list when finalizing.

Small files use the same protocol for consistency. A one-part multipart upload avoids a separate
databank `PutObject` client path even though it has little performance advantage over a single PUT.

## Request flow

```text
Client                         Files API                    Object storage
  |                                |                              |
  |-- POST key, numParts --------->|-- create upload session ---->|
  |<-- uploadId + N part URLs -----|<-----------------------------|
  |                                                               |
  |-- PUT part 1 to its presigned URL --------------------------->|
  |<-- ETag -------------------------------------------------------|
  |-- PUT part 2 to its presigned URL --------------------------->|
  |<-- ETag -------------------------------------------------------|
  |                         ...                                   |
  |                                                               |
  |-- PUT uploadId + part list -->|-- complete multipart upload ->|
  |<-- completed object key ------|<-----------------------------|
```

### 1. Initiate

An authenticated databank owner with the `provider` role calls:

```http
POST /v1/databanks/{databankId}/uploads
Content-Type: application/json

{
  "key": "folder/large-file.csv",
  "numParts": 10,
  "contentType": "text/csv"
}
```

The client, not the API, calculates `numParts`. The API validates the request and file extension,
creates a storage upload for `{databankId}/{key}`, and returns an `uploadId` plus one presigned URL
for each part number. Part URLs expire after three hours.

### 2. Upload every part

For every returned descriptor, the client reads the corresponding byte range and sends it directly
to the URL:

```http
PUT {presignedUrl}

<raw bytes for this part>
```

The client must save the ETag from each successful response together with its part number. The ETag
is the storage provider's receipt for that uploaded part and must be returned during completion.

The presigned URL is not bound to the placeholder size recorded by the API. In particular, the S3
implementation intentionally omits `Body` and `ContentLength` from the signed request so that the
client can send the real part bytes.

### 3. Complete

After all parts have succeeded, the client calls:

```http
PUT /v1/databanks/{databankId}/uploads/{uploadId}
Content-Type: application/json

{
  "key": "folder/large-file.csv",
  "parts": [
    { "partNumber": 1, "eTag": "etag-from-part-1" },
    { "partNumber": 2, "eTag": "etag-from-part-2" }
  ]
}
```

Camel-case and S3-style names (`PartNumber` and `ETag`) are both accepted. The API normalizes the
fields and asks the storage provider to assemble the final object.

Completion returns 200 only for an active upload ID, the matching key, and ETags returned by
successfully uploaded parts. For S3 and MinIO, a missing, aborted, or already completed
upload returns 404.
Do not use placeholder ETags when testing the successful flow.

### 4. Cancel after failure

If the upload cannot be completed, the client should clean up the session:

```http
POST /v1/databanks/{databankId}/uploads/{uploadId}/cancel
Content-Type: application/json

{ "key": "folder/large-file.csv" }
```

The supplied uploaders make this call on failure. Cancellation is best-effort; clients should log a
cleanup failure so that abandoned multipart data can be found and removed later.

## Part-size policies in the supplied clients

The API has no fixed part size. It receives only `numParts`, and presigned URLs do not enforce a
content length. The client implementation being used therefore determines the actual size.

Sizes called `MB` in the scripts are calculated with `1024 * 1024`, so they are MiB.

### `scripts/databank_uploader.py`

For a file of at most 5 MiB, this uploader creates one part whose size is the file size. For a larger
file it calculates:

```text
part_size = max(5 MiB, min(100 MiB, floor(file_size / 10)))
part_count = ceil(file_size / part_size)
```

This normally targets about ten parts, with a minimum regular part size of 5 MiB and a preferred
maximum of 100 MiB. If the result would exceed 10,000 parts, it increases `part_size` to
`ceil(file_size / 10,000)`. Every part except the last uses `part_size`; the last part contains the
remaining bytes and may be smaller.

| File size | Regular part size | Result |
|---:|---:|---:|
| 4 MiB | 4 MiB | 1 part |
| 6 MiB | 5 MiB | 5 MiB + 1 MiB |
| 50 MiB | 5 MiB | 10 parts |
| 500 MiB | 50 MiB | 10 parts |
| 2 GiB | 100 MiB | 20 x 100 MiB + 48 MiB |

### `scripts/Automation-scripts/creation/file_creation.py`

This uploader reads `part_size_mb` from `file_creation_config.json`; the checked-in default is
100 MiB. It uses that size for every regular part and a smaller remainder for the last part. For
example, a 250 MiB file is sent as 100 MiB, 100 MiB, and 50 MiB.

It enforces a minimum configured size of 5 MiB and increases the size when necessary to keep the
count at or below 10,000 parts.

## Provider behavior

- **S3 and MinIO:** use the provider's native create, upload-part, complete, and abort operations.
- **GCS:** emulates the same API. Each part is written as a temporary object; completion combines
  the objects in part-number order and deletes the temporary objects. Because GCS compose accepts a
  limited number of sources per operation, the repository combines large part sets in multiple
  levels.

## Current size-validation limitation

`MultipartUploadService.initiateUpload()` currently constructs an internal array containing one
placeholder value of 1 MiB for every requested part. `generatePresignedUrls()` sums those values for
the `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB` check. The placeholders generate the correct number of URLs
but are not the actual client chunk sizes and are not enforced by the signed URLs.

As a result, the current check evaluates approximately `numParts * 1 MiB`, not the actual file size.
The API also validates only that `numParts` is a positive integer; the supplied clients, rather than
the API, enforce their 10,000-part ceiling.

Until the initiation contract is changed to include trustworthy file-size or part-size information,
clients must enforce the configured total-size policy before initiation, and operators must not
treat the API-side `MAX_SIZE_IN_MULTIPART_UPLOAD_IN_GB` check as validation of the bytes uploaded.

## Ingress and asset uploads

The nginx `proxy-body-size` setting applies to requests that pass through the file-server ingress.
Multipart initiation, completion, and cancellation contain only small JSON bodies. Part PUTs use
storage presigned URLs and bypass that ingress, so the file-server ingress limit does not determine
the databank part size.

By contrast, `POST /v1/assets` uses HTTP `multipart/form-data`, passes the complete file through the
API, buffers it in memory, and has a 5 MiB application limit. That is a separate upload mechanism.

## Implementation references

- Upload routes: [src/routes/databanks-routes.ts](../../src/routes/databanks-routes.ts)
- Session creation and URL generation: [src/services/multipart-upload-service.ts](../../src/services/multipart-upload-service.ts)
- Completion and key normalization: [src/services/storage-service.ts](../../src/services/storage-service.ts)
- Native S3 implementation: [src/repositories/aws-s3-repository.ts](../../src/repositories/aws-s3-repository.ts)
- GCS staging and compose implementation: [src/repositories/gcs-repository.ts](../../src/repositories/gcs-repository.ts)
- Adaptive uploader: [scripts/databank_uploader.py](../../scripts/databank_uploader.py)
- Configurable 100 MiB uploader: [scripts/Automation-scripts/creation/file_creation.py](../../scripts/Automation-scripts/creation/file_creation.py)
