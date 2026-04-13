import time
import sys
import os

import logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas', 'shared-layer', 'python')))

from mock_aws import patch_boto3
patch_boto3()

os.environ["DB_SECRET_ARN"] = "local-db-secret"
os.environ["API_SECRET_ARN"] = "local-api-secret"
os.environ["DB_HOST"] = "localhost"
os.environ["DB_NAME"] = "pricetracker"
os.environ["DB_PORT"] = "5432"
os.environ["WS_ENDPOINT"] = "ws://localhost:8080/ws"

import importlib.util

# Add the specific price-fetcher directory to sys.path
fetcher_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas', 'price-fetcher'))
if fetcher_dir not in sys.path:
    sys.path.append(fetcher_dir)

# Load the price-fetcher module dynamically
handler_path = os.path.join(fetcher_dir, 'handler.py')
spec = importlib.util.spec_from_file_location("fetcher", handler_path)
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)

print("Starting local EventBridge scheduler...")
while True:
    print("\n[EventBridge] Triggering price-fetcher...")
    try:
        fetcher.lambda_handler({}, None)
        print("[EventBridge] Price fetch complete.")
    except Exception as e:
        print(f"[EventBridge] Error: {e}")
    
    # Wait 5 minutes before fetching again
    time.sleep(300)