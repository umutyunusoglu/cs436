import sys
import os
import json
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

import logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

# Map the local Python path to find your lambdas and the shared layer
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas', 'shared-layer', 'python')))

# Apply our AWS bypass before importing the Lambdas
from mock_aws import patch_boto3
patch_boto3()

# Inject the environment variables the Lambdas expect
os.environ["DB_SECRET_ARN"] = "local-db-secret"
os.environ["API_SECRET_ARN"] = "local-api-secret"
os.environ["DB_HOST"] = "localhost"
os.environ["DB_NAME"] = "pricetracker"
os.environ["DB_PORT"] = "5432"
os.environ["WS_ENDPOINT"] = "ws://localhost:8080/ws"

import importlib.util

# Add the specific api-handler directory to sys.path so it can find 'technical.py'
api_handler_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambdas', 'api-handler'))
if api_handler_dir not in sys.path:
    sys.path.append(api_handler_dir)

# Load the api-handler module dynamically
handler_path = os.path.join(api_handler_dir, 'handler.py')
spec = importlib.util.spec_from_file_location("api_lambda", handler_path)
api_lambda = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api_lambda)

app = FastAPI()

# Allow your local React app (usually localhost:5173) to talk to this emulator
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.api_route("/{path:path}", methods=["GET", "POST"])
async def rest_proxy(request: Request, path: str):
    """Packages frontend requests into AWS API Gateway format."""
    event = {
        "rawPath": f"/{path}",
        "queryStringParameters": dict(request.query_params),
        "requestContext": {"http": {"method": request.method}}
    }
    
    # Trigger the Lambda locally
    response = api_lambda.lambda_handler(event, None)

    # DEBUG: Print the response to your terminal
    print(f"📡 [Emulator] {request.method} /{path} -> Status {response.get('statusCode')}")
    if path == "prices":
        body = json.loads(response.get("body", "{}"))
        print(f"📊 [Emulator] Returned {len(body.get('data', []))} price rows.")
    
    return JSONResponse(status_code=response.get("statusCode", 200), content=json.loads(response.get("body", "{}")))

@app.websocket("/ws")
async def websocket_proxy(websocket: WebSocket):
    """Simulates the WebSocket API Gateway connection."""
    await websocket.accept()
    print("🔌 [Local] WebSocket connected.")
    try:
        while True:
            data = await websocket.receive_text()
            print(f"📥 [Local] WS Received: {data}")
    except Exception:
        print("🔌 [Local] WebSocket disconnected.")