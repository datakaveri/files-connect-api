"""
Readiness Processor Module
Handles data readiness assessment for both structured and unstructured datasets
Ported from AWS Lambda function to work with Redis job queue
"""
import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import tempfile
import zipfile
import logging
import time
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_s3_client():
    """
    Create and configure S3/MinIO client based on environment variables
    """
    storage_provider = os.environ.get('STORAGE_PROVIDER', 's3').lower()

    # Get credentials
    access_key = os.environ.get('S3_ACCESS_KEY')
    secret_key = os.environ.get('S3_SECRET_KEY')

    if not access_key or not secret_key:
        raise ValueError("S3_ACCESS_KEY and S3_SECRET_KEY must be set")

    # Configure client based on provider
    if storage_provider == 'minio':
        endpoint = os.environ.get('S3_ENDPOINT')
        if not endpoint:
            raise ValueError("S3_ENDPOINT must be set for MinIO")

        use_ssl = os.environ.get('USE_SSL', 'false').lower() == 'true'
        verify_ssl = os.environ.get('S3_VERIFY_SSL', 'true').lower() == 'true'

        logger.info(f"Configuring MinIO client: endpoint={endpoint}, use_ssl={use_ssl}, verify_ssl={verify_ssl}")

        # Create boto3 config with proper signature version and addressing style
        boto_config = Config(
            signature_version='s3v4',
            s3={
                'addressing_style': 'path'  # Use path-style for MinIO
            }
        )

        # Parse endpoint to determine if it's HTTP or HTTPS
        if not use_ssl and not endpoint.startswith('http://'):
            if endpoint.startswith('https://'):
                endpoint = endpoint.replace('https://', 'http://')
            elif not endpoint.startswith('http'):
                endpoint = f'http://{endpoint}'
        elif use_ssl and not endpoint.startswith('https://'):
            if endpoint.startswith('http://'):
                endpoint = endpoint.replace('http://', 'https://')
            elif not endpoint.startswith('http'):
                endpoint = f'https://{endpoint}'

        logger.info(f"Using endpoint URL: {endpoint}")

        verify = use_ssl and verify_ssl
        return boto3.client(
            's3',
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=boto_config,
            verify=verify
        )
    else:
        # AWS S3 or custom S3-compatible endpoint
        region = os.environ.get('S3_REGION', 'us-east-1')
        endpoint = os.environ.get('S3_ENDPOINT')
        verify_ssl = os.environ.get('S3_VERIFY_SSL', 'true').lower() == 'true'

        logger.info(f"Configuring S3 client: region={region}, verify_ssl={verify_ssl}")

        # Create boto3 config
        boto_config = Config(
            signature_version='s3v4',
            region_name=region
        )

        config_params = {
            'aws_access_key_id': access_key,
            'aws_secret_access_key': secret_key,
            'config': boto_config,
            'verify': verify_ssl,
        }

        if endpoint:
            config_params['endpoint_url'] = endpoint

        return boto3.client('s3', **config_params)


def download_files_from_s3(s3_client, bucket_name, folder_key, temp_dir):
    """
    Download all files from an S3 folder to a temporary directory
    Handles zip file extraction automatically
    """
    logger.info(f"Downloading files from S3: {bucket_name}/{folder_key}")
    
    try:
        # List all objects in the folder
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix=folder_key)
        
        file_count = 0
        for page in pages:
            for obj in page.get('Contents', []):
                key = obj['Key']
                
                # Skip directories
                if key.endswith('/'):
                    continue
                
                # Calculate local path
                # Remove the folder_key prefix to get relative path
                if folder_key.endswith('/'):
                    relative_path = key[len(folder_key):]
                else:
                    relative_path = key[len(folder_key) + 1:] if key.startswith(folder_key + '/') else key
                
                local_path = os.path.join(temp_dir, relative_path)
                
                # Create directory structure if needed
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
                
                # Download file
                logger.info(f"Downloading: {key} -> {local_path}")
                s3_client.download_file(bucket_name, key, local_path)
                file_count += 1
                
                # Extract zip files automatically
                if local_path.endswith('.zip'):
                    logger.info(f"Extracting zip file: {local_path}")
                    with zipfile.ZipFile(local_path, 'r') as zf:
                        extract_dir = os.path.join(temp_dir, os.path.splitext(os.path.basename(local_path))[0])
                        zf.extractall(extract_dir)
                    # Optionally remove the zip file after extraction
                    os.remove(local_path)
        
        logger.info(f"Downloaded {file_count} files from S3")
        return file_count
        
    except Exception as e:
        logger.error(f"Error downloading files from S3: {str(e)}", exc_info=True)
        raise


def upload_reports_to_s3(s3_client, temp_dir, folder_key, bucket_name):
    """
    Upload generated PDF report to S3 at reports/{databank_id}/data_readiness_report.pdf
    """
    logger.info(f"Uploading PDF report to S3: {bucket_name}")

    # Get databank ID (folder_key is the databank ID)
    databank_id = os.path.basename(folder_key.rstrip('/'))

    # Look for outputReports directory in temp_dir
    output_reports_dir = os.path.join(temp_dir, 'outputReports')
    if not os.path.exists(output_reports_dir):
        # Also check if reports are directly in temp_dir
        output_reports_dir = temp_dir
        logger.info(f"outputReports directory not found, checking temp_dir directly")

    # Find the PDF file (should be named data_readiness_report.pdf)
    pdf_path = None
    for root, dirs, files in os.walk(output_reports_dir):
        for file in files:
            if file.endswith('.pdf') and 'readiness_report' in file.lower():
                pdf_path = os.path.join(root, file)
                break
        if pdf_path:
            break

    if not pdf_path:
        logger.warning(f"PDF report not found in {output_reports_dir}")
        return 0

    # Construct S3 key: reports/{databank_id}/data_readiness_report.pdf
    s3_key = f"reports/{databank_id}/data_readiness_report.pdf"

    logger.info(f"Uploading PDF report: {pdf_path} -> {bucket_name}/{s3_key}")
    try:
        s3_client.upload_file(pdf_path, bucket_name, s3_key)
        logger.info(f"Successfully uploaded: {s3_key}")
        return 1
    except Exception as e:
        logger.error(f"Failed to upload {s3_key}: {str(e)}")
        return 0


def determine_data_type(temp_dir):
    """
    Determine if the dataset is structured or unstructured based on file types
    NOTE: Unstructured extensions are intentionally ignored. Anything not
    matching structured extensions will be treated as 'unknown'.
    Returns: 'structured' or 'unknown'
    """
    structured_extensions = ('.parquet', '.csv', '.json')
    
    files = []
    for root, dirs, filenames in os.walk(temp_dir):
        for filename in filenames:
            files.append(filename.lower())
    has_structured = any(f.endswith(structured_extensions) for f in files)

    if has_structured:
        return 'structured'
    else:
        return 'unknown'


def process_readiness_job(databank_id):
    """
    Process a readiness job for the given databank ID
    This is the main entry point called by the worker
    """
    start_time = time.time()
    logger.info(f"Processing readiness job for databank: {databank_id}")
    
    try:
        bucket_name = os.environ.get('BUCKET_NAME')

        if not bucket_name:
            raise ValueError("BUCKET_NAME environment variable is required")

        folder_key = databank_id
        logger.info(f"Using bucket: {bucket_name}, folder: {folder_key}")
        logger.info(f"Reports will be written to: {bucket_name}/reports/{folder_key}/")
        
        # Create S3 client
        s3_client = get_s3_client()
        
        # Check if the folder exists in S3
        logger.info(f"Checking if folder exists: {folder_key}")
        try:
            response = s3_client.list_objects_v2(
                Bucket=bucket_name,
                Prefix=folder_key,
                MaxKeys=1
            )
            
            if 'Contents' not in response or (
                len(response['Contents']) == 1 and 
                response['Contents'][0]['Key'] == folder_key and 
                folder_key.endswith('/')
            ):
                error_msg = f"Folder not found or empty: {folder_key}"
                logger.error(error_msg)
                raise ValueError(error_msg)
                
            logger.info(f"Folder exists: {folder_key}")
        except Exception as e:
            if "Folder not found" in str(e):
                raise
            logger.error(f"Error checking folder existence: {str(e)}", exc_info=True)
            raise ValueError(f"Error checking folder existence: {str(e)}")
        
        # Create temporary directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            logger.info(f"Created temporary directory: {temp_dir}")
            
            # Download files from S3
            logger.info("Downloading files from S3")
            download_start = time.time()
            file_count = download_files_from_s3(s3_client, bucket_name, folder_key, temp_dir)
            download_duration = time.time() - download_start
            logger.info(f"Downloaded {file_count} files in {download_duration:.2f} seconds")
            
            if file_count == 0:
                raise ValueError("No files found in the specified folder")
            
            # Determine data type (structured vs unstructured)
            data_type = determine_data_type(temp_dir)
            logger.info(f"Detected data type: {data_type}")
            
            # If the dataset is not structured, skip running any framework
            # but update the catalogue with an 'unknown' readiness score.
            if data_type != 'structured':
                logger.info("Non-structured files detected; updating catalogue with 'unknown' readiness")
                try:
                    from report.post_to_cat_api import update_cat_readiness_score
                    elastic_id = os.environ.get('ELASTIC_ID')
                    elastic_pass = os.environ.get('ELASTIC_PASS')
                    # Use folder_key as fallback uuid (same fallback used in structured_main)
                    update_cat_readiness_score(folder_key, 'NA', elastic_id, elastic_pass)
                    logger.info("Catalogue readiness score updated to 'NA' for unstructured dataset")
                except Exception as e:
                    logger.error(f"Failed to update catalogue readiness score: {e}", exc_info=True)
            
            # Run the appropriate readiness framework
            logger.info(f"Running {data_type} readiness framework")
            framework_start = time.time()
            
            # Set environment variables for the framework modules
            os.environ['BUCKET_NAME'] = bucket_name
            
            # Set WORKER_TEMP_DIR so get_output_dir can use it
            # This ensures reports are created in temp_dir/outputReports
            os.environ['WORKER_TEMP_DIR'] = temp_dir
            
            # Create symlink to plots directory so framework can access it
            # The framework uses relative path "plots/pretty/..." 
            plots_symlink = os.path.join(temp_dir, 'plots')
            app_plots_dir = '/app/plots'
            if os.path.exists(app_plots_dir) and not os.path.exists(plots_symlink):
                try:
                    os.symlink(app_plots_dir, plots_symlink)
                    logger.info(f"Created symlink: {plots_symlink} -> {app_plots_dir}")
                except Exception as e:
                    logger.warning(f"Could not create plots symlink: {str(e)}")
            
            # Change to temp directory so that outputReports is created there
            # The framework expects to run from the data directory
            original_cwd = os.getcwd()
            try:
                os.chdir(temp_dir)
                logger.info(f"Changed working directory to: {temp_dir}")
                
                if data_type == 'structured':
                    from structured_main import main as structured_main
                    structured_main(temp_dir, folder_key)
            finally:
                # Restore original working directory
                os.chdir(original_cwd)
                logger.info(f"Restored working directory to: {original_cwd}")
                # Clean up environment variable
                if 'WORKER_TEMP_DIR' in os.environ:
                    del os.environ['WORKER_TEMP_DIR']
            
            framework_duration = time.time() - framework_start
            logger.info(f"Readiness framework completed in {framework_duration:.2f} seconds")
            
            # Upload reports to S3
            logger.info("Uploading reports to S3")
            upload_start = time.time()
            uploaded_count = upload_reports_to_s3(s3_client, temp_dir, folder_key, bucket_name)
            upload_duration = time.time() - upload_start
            logger.info(f"Uploaded {uploaded_count} reports in {upload_duration:.2f} seconds")
            
            total_duration = time.time() - start_time
            logger.info(f"Readiness job completed successfully in {total_duration:.2f} seconds")
            
            return {
                'success': True,
                'message': 'Readiness assessment completed successfully',
                'data_type': data_type,
                'files_processed': file_count,
                'reports_uploaded': uploaded_count,
                'processing_time_seconds': round(total_duration, 2),
                'download_time_seconds': round(download_duration, 2),
                'framework_time_seconds': round(framework_duration, 2),
                'upload_time_seconds': round(upload_duration, 2)
            }
            
    except Exception as e:
        logger.error(f"Error processing readiness job: {str(e)}", exc_info=True)
        total_duration = time.time() - start_time
        logger.info(f"Readiness job failed after {total_duration:.2f} seconds")
        
        return {
            'success': False,
            'error': str(e),
            'processing_time_seconds': round(total_duration, 2)
        }
