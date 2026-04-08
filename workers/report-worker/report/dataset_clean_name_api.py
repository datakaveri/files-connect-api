import os
import requests

# Catalogue API base URL from env (e.g. CAT_API_URL). Item endpoint: {base}/item?id={uuid}
_CAT_BASE = os.environ.get('CAT_API_URL', 'https://v2.dev.controlplane.iudx.io/iudx/v2/cat').rstrip('/')
url_format = f'{_CAT_BASE}/item?id={{}}'
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
        item = result[0]
        # Catalogue may use 'label' (e.g. TG-DEX) or 'name' (e.g. IUDX/ForestDX)
        true_name = item.get('label') or item.get('name')
        print(f"True name: {true_name}")
    else:
        true_name = None
    return true_name, dataset_uuid

