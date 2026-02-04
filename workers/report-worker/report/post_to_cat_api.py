import os
from datetime import datetime

import requests
from requests.auth import HTTPBasicAuth
import json
import logging
from dotenv import load_dotenv

load_dotenv()

# Elasticsearch base URL for tgdex__cat index (required when ELASTIC_ID/ELASTIC_PASS are set)
_DEFAULT_INDEX = "tgdex__cat"


def update_cat_readiness_score(uuid, score, username, password):
    logger = logging.getLogger(__name__)
    try:
        score = float(score)
    except (TypeError, ValueError):
        logger.warning(f"Score '{score}' could not be converted to float. Setting as None.")
        score = None
    # Check for missing credentials
    if not username or not password:
        logger.error("Elasticsearch credentials are missing. Username or password is None.")
        return

    # ELASTICSEARCH_URL required for updating readiness scores in tgdex__cat index
    elastic_base = os.environ.get("ELASTICSEARCH_URL")
    if not elastic_base:
        logger.warning("ELASTICSEARCH_URL is not set. Skipping readiness score update in catalogue index.")
        return

    base = elastic_base.rstrip("/")
    index = os.environ.get("ELASTIC_CAT_INDEX", _DEFAULT_INDEX)
    get_url = f"{base}/{index}/_search"

    # Define the query payload for GET request
    query = {
        "query": {
            "match": {
                "id": uuid
            }
        }
    }

    # Set headers for GET request
    headers = {
        "Content-Type": "application/json"
    }

    try:
        # Perform the GET request
        response = requests.get(get_url, auth=HTTPBasicAuth(username, password), headers=headers, data=json.dumps(query))

        # Check the response status for the GET request
        if response.status_code == 200:
            logger.info("GET request successful")
            # Parse the JSON response
            get_response_json = response.json()

            # Extract the _id from the hits array
            hits = get_response_json.get('hits', {}).get('hits', [])
            if not hits:
                logger.warning(f"No document found for uuid: {uuid}")
                return

            _id = hits[0]['_id']
            logger.info(f"Found document with _id: {_id}")
            # Now perform the POST request (update document)
            post_url = f"{base}/{index}/_update/{_id}"

            # Define the update payload for POST request
            update_data = {
                "doc": {
                    "dataReadiness": score,
                    "dataUploadStatus": True,
                    "publishStatus": "ACTIVE",
                    "lastUpdated": datetime.now().strftime("%d %B, %Y - %I:%M %p")
                }
            }

            # Perform the POST request to update the document
            post_response = requests.post(post_url, auth=HTTPBasicAuth(username, password), headers=headers, data=json.dumps(update_data))

            # Check the response status for the POST request
            if post_response.status_code == 200:
                logger.info("POST request successful: Document updated.")
                logger.debug(f"POST response: {post_response.json()}")
            else:
                logger.error(f"POST request failed with status code: {post_response.status_code}")
                logger.error(f"POST response: {post_response.text}")

        else:
            logger.error(f"GET request failed with status code: {response.status_code}")
            logger.error(f"GET response: {response.text}")
    except Exception as e:
        logger.exception(f"Exception occurred while updating dataReadiness for uuid {uuid}: {e}")
    return