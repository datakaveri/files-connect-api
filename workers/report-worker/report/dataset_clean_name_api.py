import os

import requests
from dotenv import load_dotenv

load_dotenv()

# Required: CAT_API_URL from .env (base URL for catalogue API, e.g. https://dx.tgdex.telangana.gov.in/tgdex/cat/v1)
_cat_base = os.environ.get('CAT_API_URL')
if not _cat_base:
    raise ValueError('CAT_API_URL is required for report worker. Set it in .env')
url_format = f"{_cat_base.rstrip('/')}/item?id={{}}"
def get_uuid_from_dataset_name(folder_name):
    return folder_name.split('.')[0]

def get_dataset_name_from_url(uuid, url_format=url_format):
    # uuid = url.split('=')[-1]
    url= url_format.format(uuid)
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
    }
    response = requests.get(url, headers=headers)
    response_json = response.json()
    print("Dataset name API response:", response_json)
    result = response_json.get('result', [])
    
    dataset_uuid = get_uuid_from_dataset_name(uuid)
    if result:
        true_name = result[0].get('label', None)
    else:
        true_name = None
    return true_name, dataset_uuid

