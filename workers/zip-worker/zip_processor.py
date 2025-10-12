"""
Zip Processor Module
Handles creation of zip files from S3/MinIO folders
Ported from AWS Lambda function to work with Redis job queue
"""
import os
import boto3
import tempfile
import zipfile
import logging
import time
import urllib3
import base64
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize urllib3 pool manager
http = urllib3.PoolManager()


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
        
        logger.info(f"Configuring MinIO client: endpoint={endpoint}, use_ssl={use_ssl}")
        
        return boto3.client(
            's3',
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            use_ssl=use_ssl,
            verify=use_ssl
        )
    else:
        # AWS S3
        region = os.environ.get('S3_REGION', 'us-east-1')
        endpoint = os.environ.get('S3_ENDPOINT')
        
        logger.info(f"Configuring S3 client: region={region}")
        
        config_params = {
            'aws_access_key_id': access_key,
            'aws_secret_access_key': secret_key,
            'region_name': region
        }
        
        if endpoint:
            config_params['endpoint_url'] = endpoint
        
        return boto3.client('s3', **config_params)


def create_zip_from_s3_folder(s3_client, bucket_name, folder_key, temp_dir):
    """
    Create a zip file from the contents of an S3 folder
    Memory-optimized version using streaming and chunked processing
    """
    start_time = time.time()
    logger.info(f"Starting zip creation for folder: {folder_key} in bucket: {bucket_name}")
    zip_path = os.path.join(temp_dir, 'output.zip')
    file_count = 0
    total_bytes = 0
    
    try:
        # List all objects in the folder
        logger.info(f"Listing objects with prefix: {folder_key}")
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix=folder_key)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zip_file:
            for page_num, page in enumerate(pages, 1):
                logger.info(f"Processing page {page_num} of results")
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    size = obj.get('Size', 0)
                    
                    if key.endswith('/'):  # Skip directories
                        logger.debug(f"Skipping directory: {key}")
                        continue
                    
                    logger.info(f"Processing file: {key} ({size} bytes)")
                    
                    # Calculate the relative path to maintain folder structure
                    prefix = folder_key if folder_key.endswith('/') else folder_key + '/'
                    relative_path = key[len(prefix):] if key.startswith(prefix) else key
                    
                    # If the relative path is empty, use the basename
                    if not relative_path:
                        relative_path = os.path.basename(key)
                        logger.warning(f"Empty relative path detected for {key}, using basename instead")
                    
                    # Use streaming to process the file without loading it entirely into memory
                    # Create a ZipInfo object to set compression method
                    zip_info = zipfile.ZipInfo(relative_path)
                    zip_info.compress_type = zipfile.ZIP_DEFLATED
                    
                    # Get the S3 object response first to extract metadata
                    file_start_time = time.time()
                    response = s3_client.get_object(Bucket=bucket_name, Key=key)
                    
                    # Set the file timestamp from S3 LastModified
                    last_modified = response['LastModified']
                    # Convert datetime to tuple format (year, month, day, hour, minute, second)
                    zip_info.date_time = (
                        last_modified.year,
                        last_modified.month, 
                        last_modified.day,
                        last_modified.hour,
                        last_modified.minute,
                        last_modified.second
                    )
                    
                    logger.info(f"Adding to zip: {relative_path} (modified: {last_modified})")
                    # Stream the file directly from S3 to the zip file
                    with zip_file.open(zip_info, 'w') as dest_file:
                        body = response['Body']
                        file_bytes = 0
                        
                        # Process in chunks to minimize memory usage
                        chunk_size = 4 * 1024 * 1024  # 4MB chunks
                        chunks_processed = 0
                        while True:
                            chunk = body.read(chunk_size)
                            if not chunk:
                                break
                            chunk_len = len(chunk)
                            dest_file.write(chunk)
                            file_bytes += chunk_len
                            chunks_processed += 1
                            if chunks_processed % 5 == 0:  # Log every 5 chunks
                                logger.info(f"Processed {chunks_processed} chunks ({file_bytes/1024/1024:.2f} MB) for {key}")
                        
                        # Close the body to release resources
                        body.close()
                        
                        file_count += 1
                        total_bytes += file_bytes
                        file_duration = time.time() - file_start_time
                        logger.info(f"Completed file: {key} - {file_bytes/1024/1024:.2f} MB in {file_duration:.2f} seconds")
        
        zip_duration = time.time() - start_time
        zip_size_mb = os.path.getsize(zip_path) / 1024 / 1024
        logger.info(f"Zip creation complete: {zip_path}")
        logger.info(f"Zip statistics: {file_count} files, {total_bytes/1024/1024:.2f} MB uncompressed, {zip_size_mb:.2f} MB compressed")
        logger.info(f"Total zip creation time: {zip_duration:.2f} seconds")
        return zip_path, zip_size_mb
    except Exception as e:
        logger.error(f"Error creating zip file: {str(e)}", exc_info=True)
        raise


def update_cat_api(cat_url, cat_username, cat_password, databank_id, zip_size_mb):
    """
    Update the CAT API with dataUploadStatus and fileSize
    """
    try:
        # Define the URL for the GET request
        get_url = f"{cat_url}/tgdex__cat/_search"
        
        logger.info(f"Updating dataUploadStatus for databank ID: {databank_id}")
        
        # Define the query payload for GET request
        query = {
            "query": {
                "match": {
                    "id": databank_id
                }
            }
        }
        
        # Prepare basic authentication header
        auth_string = f"{cat_username}:{cat_password}"
        auth_bytes = auth_string.encode('ascii')
        auth_header = base64.b64encode(auth_bytes).decode('ascii')
        
        # Set headers
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {auth_header}"
        }
        
        # Perform the GET request
        response = http.request(
            'GET',
            get_url,
            body=json.dumps(query),
            headers=headers
        )
        
        # Check the response status for the GET request
        if response.status == 200:
            logger.info("GET request successful")
            # Parse the JSON response
            get_response_json = json.loads(response.data.decode('utf-8'))
            
            # Extract the _id from the hits array
            if get_response_json.get('hits', {}).get('hits'):
                _id = get_response_json['hits']['hits'][0]['_id']
                logger.info(f"Found document with _id: {_id}")
                
                # Now perform the POST request (update document)
                post_url = f"{cat_url}/tgdex__cat/_update/{_id}"
                
                # Define the update payload for POST request
                update_data = {
                    "doc": {
                        "dataUploadStatus": True,
                        "fileSize": f"{max(round(zip_size_mb, 2), 0.1)}MB"
                    }
                }
                
                # Perform the POST request to update the document
                post_response = http.request(
                    'POST',
                    post_url,
                    body=json.dumps(update_data),
                    headers=headers
                )
                
                # Check the response status for the POST request
                if post_response.status == 200:
                    logger.info("POST request successful: Document updated.")
                    post_response_json = json.loads(post_response.data.decode('utf-8'))
                    logger.info(post_response_json)
                else:
                    logger.error(f"POST request failed with status code: {post_response.status}")
                    logger.error(post_response.data.decode('utf-8'))
            else:
                logger.warning(f"No document found with ID: {databank_id}")
        else:
            logger.error(f"GET request failed with status code: {response.status}")
            logger.error(response.data.decode('utf-8'))
    except Exception as e:
        logger.error(f"Failed to update CAT API: {str(e)}", exc_info=True)
        # Don't raise - CAT API update failure shouldn't fail the entire job


def process_zip_job(databankId):
    """
    Process a zip job for the given databank ID
    This is the main entry point called by the worker
    """
    start_time = time.time()
    logger.info(f"Processing zip job for databank: {databankId}")
    
    try:
        # Get bucket name from environment variable
        bucket_name = os.environ.get('S3_BUCKET_NAME')
        if not bucket_name:
            raise ValueError("S3_BUCKET_NAME environment variable is required")
        
        folder_key = databankId
        logger.info(f"Using bucket: {bucket_name}, folder: {folder_key}")
        
        # Create S3 client
        s3_client = get_s3_client()
        
        # Check if the folder exists in S3
        logger.info(f"Checking if folder exists: {folder_key}")
        try:
            # List objects with the given prefix and limit to 1 result
            response = s3_client.list_objects_v2(
                Bucket=bucket_name,
                Prefix=folder_key,
                MaxKeys=1
            )
            
            # If no contents or the only item is the folder itself (ends with /)
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
            
            # Create zip file
            logger.info("Starting zip creation process")
            zip_path, zip_size_mb = create_zip_from_s3_folder(s3_client, bucket_name, folder_key, temp_dir)
            
            # Calculate zip file size
            zip_size_bytes = os.path.getsize(zip_path)
            logger.info(f"Zip file size: {zip_size_mb:.2f} MB ({zip_size_bytes} bytes)")
            
            # Generate output path
            output_key = f"zips/{os.path.basename(folder_key)}.zip"
            logger.info(f"Generated output key: {output_key}")
            
            # Upload zip file to S3
            logger.info(f"Uploading zip file to S3: {bucket_name}/{output_key}")
            upload_start_time = time.time()
            s3_client.upload_file(zip_path, bucket_name, output_key)
            upload_duration = time.time() - upload_start_time
            logger.info(f"Upload completed in {upload_duration:.2f} seconds")
            
            # Update CAT API if configured
            cat_url = os.environ.get('CAT_URL')
            cat_username = os.environ.get('CAT_USERNAME')
            cat_password = os.environ.get('CAT_PASSWORD')
            
            if cat_url and cat_username and cat_password:
                logger.info("Updating CAT API")
                update_cat_api(cat_url, cat_username, cat_password, databankId, zip_size_mb)
            else:
                logger.warning("CAT API credentials not configured, skipping CAT update")
            
            total_duration = time.time() - start_time
            logger.info(f"Zip job completed successfully in {total_duration:.2f} seconds")
            
            return {
                'success': True,
                'message': 'Zip file created successfully',
                'zip_location': f"s3://{bucket_name}/{output_key}",
                'processing_time_seconds': round(total_duration, 2),
                'zip_size_mb': round(zip_size_mb, 2)
            }
            
    except Exception as e:
        logger.error(f"Error processing zip job: {str(e)}", exc_info=True)
        total_duration = time.time() - start_time
        logger.info(f"Zip job failed after {total_duration:.2f} seconds")
        
        return {
            'success': False,
            'error': str(e),
            'processing_time_seconds': round(total_duration, 2)
        }

