#!/usr/bin/env python3
"""
Databank File Uploader

A Python script to upload large files to the TGDEX Files Connect API using multipart upload.
Supports both single file and directory uploads with proper authentication and progress tracking.

API Endpoints Used:
- POST /v1/databanks/{databankId}/uploads - Initiate multipart upload
- PUT /v1/databanks/{databankId}/uploads/{uploadId} - Complete multipart upload
- POST /v1/databanks/{databankId}/uploads/{uploadId}/cancel - Cancel multipart upload
- POST /v1/databanks/{databankId}/process - Create processing jobs (zip/report)

Features:
- Automatic chunk size calculation respecting S3 multipart upload requirements
- Single part upload for small files (< 5MB)
- Multipart upload for larger files with minimum 5MB part sizes
- Automatic zip and report generation after successful uploads
- Proper error handling and upload cancellation on failures

Usage:
    Configure the variables at the top of the script and run:
    python databank_uploader.py
"""

import os
import json
import requests
import hashlib
import time
import mimetypes
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
from dataclasses import dataclass
from urllib.parse import urljoin
import logging
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURATION VARIABLES - UPDATE THESE
# =============================================================================

# API Configuration
API_BASE_URL = "<API_BASE_URL>"  # Update with your API base URL
API_VERSION = "v1"

# Authentication Configuration
KEYCLOAK_TOKEN_URL = "https://<KEYCLOAK_URL>/auth/realms/<REALM>/protocol/openid-connect/token"
USERNAME = "<USERNAME>"
PASSWORD = "<PASSWORD>"
CLIENT_ID = "<CLIENT_ID>"

# Upload Configuration
DATABANK_ID = "<DATABANK_ID>"  # Update with your databank ID

# File/Directory Configuration
# Set either FILE_PATH for single file or DIRECTORY_PATH for directory upload
FILE_PATH = "<FILE_PATH>"  # e.g., "/path/to/your/file.csv"
DIRECTORY_PATH = None  # e.g., "/path/to/your/directory"

# Upload Configuration
MAX_FILE_SIZE_GB = 1000  # Maximum file size in GB (matches API default)
MAX_RETRIES = 3
RETRY_DELAY = 1  # seconds

# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class AuthToken:
    """Authentication token data"""
    access_token: str
    refresh_token: Optional[str]
    expires_in: int
    token_type: str = "Bearer"
    expires_at: Optional[datetime] = None
    
    def __post_init__(self):
        """Set expiration time after initialization"""
        if self.expires_at is None:
            self.expires_at = datetime.now() + timedelta(seconds=self.expires_in - 60)  # 60 seconds buffer
    
    @property
    def header_value(self) -> str:
        return f"{self.token_type} {self.access_token}"
    
    @property
    def is_expired(self) -> bool:
        """Check if token is expired or about to expire"""
        return datetime.now() >= self.expires_at

@dataclass
class UploadPart:
    """Upload part information"""
    part_number: int
    presigned_url: str
    etag: Optional[str] = None
    uploaded: bool = False

@dataclass
class UploadSession:
    """Upload session information"""
    upload_id: str
    key: str
    parts: List[UploadPart]
    total_parts: int

@dataclass
class FileInfo:
    """File information for upload"""
    path: Path
    size: int
    content_type: str
    relative_path: str  # Path relative to upload directory

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_content_type(file_path: Path) -> str:
    """Get content type for a file"""
    content_type, _ = mimetypes.guess_type(str(file_path))
    if content_type is None:
        # Default mappings for common file types
        ext = file_path.suffix.lower()
        content_type_map = {
            '.csv': 'text/csv',
            '.json': 'application/json',
            '.txt': 'text/plain',
            '.parquet': 'application/octet-stream',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.zip': 'application/zip'
        }
        content_type = content_type_map.get(ext, 'application/octet-stream')
    return content_type

def calculate_file_parts(file_size: int) -> Tuple[int, int]:
    """
    Calculate number of parts and optimal chunk size for multipart upload

    S3 multipart upload requirements:
    - Minimum part size: 5MB (except last part)
    - Maximum parts: 10,000
    - Maximum file size: 5TB

    Returns:
        Tuple of (num_parts, chunk_size)
    """
    # Minimum part size for multipart uploads (except last part)
    MIN_PART_SIZE = 5 * 1024 * 1024  # 5MB
    MAX_PARTS = 10000

    # For small files (< 5MB), use single part upload
    if file_size <= MIN_PART_SIZE:
        return 1, file_size

    # For larger files, ensure each part is at least 5MB
    # Use a reasonable chunk size that's at least 5MB but not too large
    optimal_chunk_size = max(MIN_PART_SIZE, min(100 * 1024 * 1024, file_size // 10))  # 100MB or 1/10th of file

    # Calculate number of parts
    num_parts = (file_size + optimal_chunk_size - 1) // optimal_chunk_size

    # Ensure we don't exceed maximum parts
    if num_parts > MAX_PARTS:
        optimal_chunk_size = (file_size + MAX_PARTS - 1) // MAX_PARTS
        num_parts = (file_size + optimal_chunk_size - 1) // optimal_chunk_size

    return num_parts, optimal_chunk_size

def validate_file_size(file_size: int) -> bool:
    """Validate file size against maximum allowed"""
    max_size_bytes = MAX_FILE_SIZE_GB * 1024 * 1024 * 1024
    return file_size <= max_size_bytes

def get_file_info(file_path: Path, base_path: Path = None) -> FileInfo:
    """Get file information"""
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    if not file_path.is_file():
        raise ValueError(f"Path is not a file: {file_path}")
    
    file_size = file_path.stat().st_size
    
    if not validate_file_size(file_size):
        raise ValueError(f"File size ({file_size / (1024**3):.2f} GB) exceeds maximum allowed ({MAX_FILE_SIZE_GB} GB)")
    
    content_type = get_content_type(file_path)
    
    if base_path:
        relative_path = str(file_path.relative_to(base_path))
    else:
        relative_path = file_path.name
    
    return FileInfo(
        path=file_path,
        size=file_size,
        content_type=content_type,
        relative_path=relative_path
    )

def collect_files_from_directory(directory_path: Path) -> List[FileInfo]:
    """Collect all supported files from directory"""
    if not directory_path.exists():
        raise FileNotFoundError(f"Directory not found: {directory_path}")
    
    if not directory_path.is_dir():
        raise ValueError(f"Path is not a directory: {directory_path}")
    
    files = []
    for file_path in directory_path.rglob('*'):
        if file_path.is_file():
            try:
                file_info = get_file_info(file_path, directory_path)
                files.append(file_info)
            except ValueError as e:
                logger.warning(f"Skipping file {file_path}: {e}")
    
    return files

# =============================================================================
# API CLIENT
# =============================================================================

class DatabankAPIClient:
    """Client for interacting with the Databank API"""
    
    def __init__(self, base_url: str, version: str = "v1"):
        self.base_url = base_url.rstrip('/')
        self.version = version
        self.session = requests.Session()
        self.token: Optional[AuthToken] = None
    
    def _get_api_url(self, endpoint: str) -> str:
        """Get full API URL for an endpoint"""
        return urljoin(f"{self.base_url}/{self.version}/", endpoint.lstrip('/'))
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Make authenticated API request"""
        url = self._get_api_url(endpoint)
        headers = kwargs.get('headers', {})
        
        # Check if token needs refresh before making request
        if self.token and self.token.is_expired:
            logger.info("Token expired, refreshing...")
            self._refresh_token()
        
        if self.token:
            headers['Authorization'] = self.token.header_value
        
        kwargs['headers'] = headers
        
        logger.debug(f"{method.upper()} {url}")
        
        for attempt in range(MAX_RETRIES):
            try:
                response = self.session.request(method, url, **kwargs)
                
                if response.status_code == 401:
                    logger.info("Token invalid, attempting refresh...")
                    self._refresh_token()
                    headers['Authorization'] = self.token.header_value
                    kwargs['headers'] = headers
                    response = self.session.request(method, url, **kwargs)
                
                return response
                
            except requests.exceptions.RequestException as e:
                logger.warning(f"Request failed (attempt {attempt + 1}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (2 ** attempt))
                else:
                    raise
    
    def authenticate(self) -> AuthToken:
        """Authenticate and get access token"""
        logger.info("Authenticating with Keycloak...")
        
        data = {
            'grant_type': 'password',
            'client_id': CLIENT_ID,
            'username': USERNAME,
            'password': PASSWORD
        }
        
        response = requests.post(
            KEYCLOAK_TOKEN_URL,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        if response.status_code != 200:
            raise Exception(f"Authentication failed: {response.status_code} - {response.text}")
        
        token_data = response.json()
        self.token = AuthToken(
            access_token=token_data['access_token'],
            refresh_token=token_data.get('refresh_token'),
            expires_in=token_data['expires_in'],
            token_type=token_data.get('token_type', 'Bearer')
        )
        
        logger.info("Authentication successful")
        return self.token
    
    def _refresh_token(self) -> AuthToken:
        """Refresh access token using refresh token"""
        if not self.token or not self.token.refresh_token:
            logger.info("No refresh token available, re-authenticating...")
            return self.authenticate()
        
        logger.info("Refreshing access token...")
        
        data = {
            'grant_type': 'refresh_token',
            'client_id': CLIENT_ID,
            'refresh_token': self.token.refresh_token
        }
        
        response = requests.post(
            KEYCLOAK_TOKEN_URL,
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        
        if response.status_code != 200:
            logger.warning(f"Token refresh failed: {response.status_code} - {response.text}")
            logger.info("Falling back to full authentication...")
            return self.authenticate()
        
        token_data = response.json()
        self.token = AuthToken(
            access_token=token_data['access_token'],
            refresh_token=token_data.get('refresh_token', self.token.refresh_token),
            expires_in=token_data['expires_in'],
            token_type=token_data.get('token_type', 'Bearer')
        )
        
        logger.info("Token refresh successful")
        return self.token
    
    def initiate_upload(self, key: str, num_parts: int, content_type: str, databank_id: str) -> UploadSession:
        """Initiate multipart upload"""
        logger.info(f"Initiating upload: {key} ({num_parts} parts)")

        payload = {
            'key': key,
            'numParts': num_parts,
            'contentType': content_type
        }

        response = self._make_request(
            'POST',
            f'databanks/{databank_id}/uploads',
            json=payload
        )

        if response.status_code != 200:
            raise Exception(f"Failed to initiate upload: {response.status_code} - {response.text}")

        data = response.json()
        if not data.get('success', False):
            raise Exception(f"Upload initiation failed: {data.get('error', 'Unknown error')}")

        result = data['data']
        parts = [
            UploadPart(part_number=part['partNumber'], presigned_url=part['presignedUrl'])
            for part in result['parts']
        ]

        return UploadSession(
            upload_id=result['uploadId'],
            key=result['key'],
            parts=parts,
            total_parts=len(parts)
        )
    
    def upload_part(self, part: UploadPart, data: bytes) -> str:
        """Upload a single part"""
        logger.debug(f"Uploading part {part.part_number}")
        
        response = requests.put(
            part.presigned_url,
            data=data,
            headers={'Content-Type': 'application/octet-stream'}
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to upload part {part.part_number}: {response.status_code} - {response.text}")
        
        etag = response.headers.get('ETag', '').strip('"')
        part.etag = etag
        part.uploaded = True
        
        return etag
    
    def complete_upload(self, session: UploadSession, databank_id: str) -> Dict:
        """Complete multipart upload"""
        logger.info(f"Completing upload: {session.key}")

        parts = [
            {
                'PartNumber': part.part_number,
                'ETag': part.etag
            }
            for part in session.parts if part.uploaded
        ]

        payload = {
            'key': session.key,
            'parts': parts
        }

        response = self._make_request(
            'PUT',
            f'databanks/{databank_id}/uploads/{session.upload_id}',
            json=payload
        )

        if response.status_code != 200:
            raise Exception(f"Failed to complete upload: {response.status_code} - {response.text}")

        data = response.json()
        if not data.get('success', False):
            raise Exception(f"Upload completion failed: {data.get('error', 'Unknown error')}")

        return data['data']
    
    def cancel_upload(self, session: UploadSession, databank_id: str) -> None:
        """Cancel multipart upload"""
        logger.info(f"Canceling upload: {session.key}")

        payload = {
            'key': session.key
        }

        response = self._make_request(
            'POST',
            f'databanks/{databank_id}/uploads/{session.upload_id}/cancel',
            json=payload
        )

        if response.status_code != 200:
            logger.warning(f"Failed to cancel upload: {response.status_code} - {response.text}")
        else:
            data = response.json()
            if not data.get('success', False):
                logger.warning(f"Upload cancellation failed: {data.get('error', 'Unknown error')}")
            else:
                logger.info("Upload cancelled successfully")

    def create_processing_job(self, databank_id: str, job_type: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a processing job (zip or report)"""
        logger.info(f"Creating {job_type} processing job for databank: {databank_id}")

        payload = {
            'type': job_type
        }

        if options:
            payload['options'] = options

        response = self._make_request(
            'POST',
            f'databanks/{databank_id}/process',
            json=payload
        )

        if response.status_code not in [200, 202]:
            raise Exception(f"Failed to create {job_type} job: {response.status_code} - {response.text}")

        data = response.json()
        if not data.get('success', False):
            raise Exception(f"Failed to create {job_type} job: {data.get('error', 'Unknown error')}")

        job_data = data['data']
        logger.info(f"{job_type.capitalize()} job created: {job_data.get('jobId')} (status: {job_data.get('status')})")

        return job_data

# =============================================================================
# FILE UPLOADER
# =============================================================================

class FileUploader:
    """Handles file upload operations"""
    
    def __init__(self, client: DatabankAPIClient, databank_id: str):
        self.client = client
        self.databank_id = databank_id
    
    def upload_file(self, file_info: FileInfo) -> Dict:
        """Upload a single file"""
        logger.info(f"Starting upload: {file_info.relative_path} ({file_info.size} bytes)")

        # Calculate number of parts and optimal chunk size
        num_parts, chunk_size = calculate_file_parts(file_info.size)

        logger.info(f"Using {num_parts} parts with chunk size: {chunk_size} bytes ({chunk_size/1024/1024:.1f}MB)")

        # Initiate upload
        session = self.client.initiate_upload(
            key=file_info.relative_path,
            num_parts=num_parts,
            content_type=file_info.content_type,
            databank_id=self.databank_id
        )

        try:
            # Upload parts
            with open(file_info.path, 'rb') as f:
                for i, part in enumerate(session.parts):
                    # Read chunk
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break

                    # Upload part
                    self.client.upload_part(part, chunk)

                    # Progress
                    progress = (i + 1) / session.total_parts * 100
                    logger.info(f"Progress: {progress:.1f}% ({i + 1}/{session.total_parts} parts)")

            # Complete upload
            result = self.client.complete_upload(session, self.databank_id)

            logger.info(f"Upload completed successfully: {file_info.relative_path}")
            return result

        except Exception as e:
            logger.error(f"Upload failed: {e}")
            # Cancel upload on failure
            try:
                self.client.cancel_upload(session, self.databank_id)
            except Exception as cancel_error:
                logger.warning(f"Failed to cancel upload: {cancel_error}")
            raise
    
    def upload_files(self, files: List[FileInfo]) -> List[Dict]:
        """Upload multiple files"""
        results = []
        
        for i, file_info in enumerate(files):
            logger.info(f"Uploading file {i + 1}/{len(files)}: {file_info.relative_path}")
            
            try:
                result = self.upload_file(file_info)
                results.append({
                    'file': file_info.relative_path,
                    'success': True,
                    'result': result
                })
            except Exception as e:
                logger.error(f"Failed to upload {file_info.relative_path}: {e}")
                results.append({
                    'file': file_info.relative_path,
                    'success': False,
                    'error': str(e)
                })
        
        return results

# =============================================================================
# MAIN EXECUTION
# =============================================================================

def main():
    """Main execution function"""
    # Validate configuration
    if not API_BASE_URL or API_BASE_URL == "https://your-api-domain.com":
        raise ValueError("Please configure API_BASE_URL")
    
    if not DATABANK_ID or DATABANK_ID == "your-databank-id":
        raise ValueError("Please configure DATABANK_ID")
    
    if not FILE_PATH and not DIRECTORY_PATH:
        raise ValueError("Please configure either FILE_PATH or DIRECTORY_PATH")
    
    if FILE_PATH and DIRECTORY_PATH:
        raise ValueError("Configure either FILE_PATH or DIRECTORY_PATH, not both")
    
    # Initialize client
    client = DatabankAPIClient(API_BASE_URL, API_VERSION)
    
    # Authenticate
    client.authenticate()
    
    # Initialize uploader
    uploader = FileUploader(client, DATABANK_ID)
    
    # Collect files
    files = []
    if FILE_PATH:
        file_path = Path(FILE_PATH)
        file_info = get_file_info(file_path)
        files.append(file_info)
        logger.info(f"Single file upload: {file_info.relative_path}")
    else:
        directory_path = Path(DIRECTORY_PATH)
        files = collect_files_from_directory(directory_path)
        logger.info(f"Directory upload: {len(files)} files found")
    
    if not files:
        logger.warning("No files to upload")
        return
    
    # Upload files
    logger.info(f"Starting upload of {len(files)} files to databank {DATABANK_ID}")
    results = uploader.upload_files(files)

    # Summary
    successful = sum(1 for r in results if r['success'])
    failed = len(results) - successful

    logger.info(f"Upload completed: {successful} successful, {failed} failed")

    if failed > 0:
        logger.info("Failed uploads:")
        for result in results:
            if not result['success']:
                logger.info(f"  - {result['file']}: {result['error']}")

    # Trigger processing jobs if there were successful uploads
    if successful > 0:
        try:
            logger.info("Triggering processing jobs...")

            # Create zip job
            try:
                zip_job = client.create_processing_job(DATABANK_ID, 'zip')
                logger.info(f"Zip job created successfully: {zip_job.get('jobId')}")
            except Exception as e:
                logger.warning(f"Failed to create zip job: {e}")

            # Create report job
            try:
                report_job = client.create_processing_job(DATABANK_ID, 'report')
                logger.info(f"Report job created successfully: {report_job.get('jobId')}")
            except Exception as e:
                logger.warning(f"Failed to create report job: {e}")

        except Exception as e:
            logger.warning(f"Failed to trigger processing jobs: {e}")
    else:
        logger.info("No successful uploads, skipping processing jobs")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.error(f"Script failed: {e}")
        exit(1) 