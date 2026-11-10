"""
GCS Client Adapter

Provides a minimal boto3 S3-client-compatible facade (get_paginator/list_objects_v2,
get_object, upload_file, download_file) backed by the native google-cloud-storage
client, so the existing boto3-based processing code runs unmodified when
STORAGE_PROVIDER=gcs.

Auth mirrors the TypeScript API's native GCS repository (same env var names), in
order of precedence:
  1. GCS_KEY_FILE                        - path to a service account JSON key file
  2. GCS_CLIENT_EMAIL + GCS_PRIVATE_KEY  - inline service account credentials
  3. Application Default Credentials     - if none of the above are set
"""
import os
import logging
from google.cloud import storage as gcs_storage
from google.oauth2 import service_account

logger = logging.getLogger(__name__)


def _build_storage_client():
    project_id = os.environ.get('GCS_PROJECT_ID')
    key_file = os.environ.get('GCS_KEY_FILE')
    client_email = os.environ.get('GCS_CLIENT_EMAIL')
    private_key = os.environ.get('GCS_PRIVATE_KEY')

    if key_file:
        logger.info(f"Configuring GCS client from GCS_KEY_FILE, project={project_id}")
        credentials = service_account.Credentials.from_service_account_file(key_file)
        return gcs_storage.Client(project=project_id, credentials=credentials)

    if client_email and private_key:
        logger.info(f"Configuring GCS client from inline service-account credentials, project={project_id}")
        # Env vars commonly carry literal \n escapes instead of real newlines
        private_key = private_key.replace('\\n', '\n')
        credentials = service_account.Credentials.from_service_account_info({
            'client_email': client_email,
            'private_key': private_key,
            'token_uri': 'https://oauth2.googleapis.com/token',
        })
        return gcs_storage.Client(project=project_id, credentials=credentials)

    logger.info(
        "No GCS_KEY_FILE or GCS_CLIENT_EMAIL/GCS_PRIVATE_KEY set; "
        "falling back to Application Default Credentials"
    )
    return gcs_storage.Client(project=project_id)


def _blob_to_s3_dict(blob):
    return {
        'Key': blob.name,
        'Size': blob.size or 0,
        'LastModified': blob.updated,
    }


class _ListObjectsV2Paginator:
    """Mimics botocore's list_objects_v2 paginator, one page per GCS API page."""

    def __init__(self, client, page_size=1000):
        self._client = client
        self._page_size = page_size

    def paginate(self, Bucket, Prefix=''):
        iterator = self._client.list_blobs(Bucket, prefix=Prefix, page_size=self._page_size)
        for page in iterator.pages:
            yield {'Contents': [_blob_to_s3_dict(blob) for blob in page]}


class GCSBoto3Adapter:
    """
    boto3 S3-client-compatible facade backed by google-cloud-storage.
    Only implements the operations this codebase actually calls.
    """

    def __init__(self):
        self._client = _build_storage_client()

    def get_paginator(self, operation_name):
        if operation_name != 'list_objects_v2':
            raise NotImplementedError(f"GCSBoto3Adapter does not support paginator '{operation_name}'")
        return _ListObjectsV2Paginator(self._client)

    def list_objects_v2(self, Bucket, Prefix='', MaxKeys=1000, **kwargs):
        blobs = list(self._client.list_blobs(Bucket, prefix=Prefix, max_results=MaxKeys))
        if not blobs:
            return {}
        return {'Contents': [_blob_to_s3_dict(blob) for blob in blobs]}

    def get_object(self, Bucket, Key):
        blob = self._client.bucket(Bucket).blob(Key)
        blob.reload()
        stream = blob.open('rb')
        return {
            'Body': stream,
            'ContentLength': blob.size,
            'LastModified': blob.updated,
        }

    def upload_file(self, Filename, Bucket, Key):
        self._client.bucket(Bucket).blob(Key).upload_from_filename(Filename)

    def download_file(self, Bucket, Key, Filename):
        self._client.bucket(Bucket).blob(Key).download_to_filename(Filename)


def create_gcs_client():
    """Factory matching the boto3.client('s3', ...) call shape used elsewhere."""
    return GCSBoto3Adapter()
