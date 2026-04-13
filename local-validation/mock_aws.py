import boto3
from unittest.mock import MagicMock
import json
import os # Moved to top

def patch_boto3():
    """Intercepts boto3 calls to prevent Lambdas from hitting real AWS endpoints."""
    original_client = boto3.client

    def mocked_client(service_name, *args, **kwargs):
        if service_name == "secretsmanager":
            mock_sm = MagicMock()
            
            def get_secret_value(SecretId, **kwargs):
                if "api" in SecretId.lower():
                    try:
                        current_dir = os.path.dirname(os.path.abspath(__file__))
                        pointer_path = os.path.join(current_dir, 'path-to-apikey.txt')
                        
                        with open(pointer_path, 'r') as f:
                            relative_path = f.read().strip()
                        
                        key_path = os.path.abspath(os.path.join(current_dir, relative_path))
                        with open(key_path, 'r') as f:
                            api_key = f.read().strip()
                            
                        return {"SecretString": json.dumps({"api_key": api_key})}
                    except FileNotFoundError as e:
                        print(f"❌ Error: Could not find API key file. {e}")
                        return {"SecretString": json.dumps({"api_key": "MISSING_KEY"})}
                else:
                    return {"SecretString": json.dumps({
                        "username": "postgres",
                        "password": "local_password"
                    })}
            
            # CRITICAL: These must be outside get_secret_value but inside the if block
            mock_sm.get_secret_value = get_secret_value
            return mock_sm
            
        return original_client(service_name, *args, **kwargs)

    boto3.client = mocked_client
    print("🔧 [Local] AWS boto3 client mocked for Secrets Manager.")