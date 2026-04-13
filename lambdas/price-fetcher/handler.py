"""price-fetcher Lambda

Triggered every 5 minutes by EventBridge Scheduler.
1. Fetches current XAU and XAG spot prices from Tiingo.
2. Writes an OHLC record for the current 5-minute bucket to RDS.
3. Broadcasts the new price to all active WebSocket clients.
"""

import json
import os
import logging
from datetime import datetime, timezone, timedelta

import boto3
import requests

# db.py is copied into this Lambda package by CDK (via bundling)
from db import get_connection

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# 1. Global Secrets Cache (Cold Start Optimization)
secrets_client = boto3.client("secretsmanager")
_api_key = None


def get_api_key():
    global _api_key
    if not _api_key:
        secret = json.loads(
            secrets_client.get_secret_value(SecretId=os.environ["API_SECRET_ARN"])["SecretString"]
        )
        _api_key = secret["api_key"]
    return _api_key


# Map Tiingo tickers back to our database format
TICKER_MAP = {"xauusd": "XAU", "xagusd": "XAG"}

def _fetch_prices(api_key: str) -> list[dict]:
    """Fetch spot prices for multiple metals from Tiingo in one call."""
    tickers = ",".join(TICKER_MAP.keys())
    url = f"https://api.tiingo.com/tiingo/fx/top?tickers={tickers}"
    
    # Tiingo uses Authorization: Token headers
    headers = {"Authorization": f"Token {api_key}", "Content-Type": "application/json"}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    
    results = []
    for item in resp.json():
        # Force ticker to lowercase before looking it up in our map
        metal = TICKER_MAP.get(item["ticker"].lower())
        if not metal:
            continue
        price = float(item["midPrice"])
        results.append({
            "metal": metal,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
        })
    return results

def _bucket_timestamp() -> datetime:
    """Round down to the nearest 5-minute bucket (UTC)."""
    now = datetime.now(timezone.utc)
    minutes = (now.minute // 5) * 5
    return now.replace(minute=minutes, second=0, microsecond=0)


def _upsert_ohlc(conn, record: dict, bucket_ts: datetime) -> None:
    """Insert OHLC row; ignore if a record for this bucket already exists."""
    sql = """
        INSERT INTO ohlc_prices (metal, open, high, low, close, timestamp)
        VALUES (%(metal)s, %(open)s, %(high)s, %(low)s, %(close)s, %(timestamp)s)
        ON CONFLICT (metal, timestamp) DO NOTHING
    """
    with conn.cursor() as cur:
        cur.execute(sql, {**record, "timestamp": bucket_ts})
    conn.commit()


def _get_active_connections(conn) -> list[str]:
    """Return all active WebSocket connection IDs."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT connection_id FROM ws_connections WHERE last_ping > NOW() - INTERVAL '10 minutes'"
        )
        rows = cur.fetchall()
    return [row["connection_id"] for row in rows]


def _broadcast(connection_ids: list[str], payload: dict) -> None:
    """Post a message to all active WebSocket connections via API GW Management API."""
    ws_endpoint = os.environ.get("WS_ENDPOINT", "")
    if not ws_endpoint or not connection_ids:
        return

    apigw = boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=ws_endpoint,
    )
    data = json.dumps(payload).encode()

    stale_ids = []
    for cid in connection_ids:
        try:
            apigw.post_to_connection(ConnectionId=cid, Data=data)
        except apigw.exceptions.GoneException:
            stale_ids.append(cid)
        except Exception as exc:
            logger.warning("Failed to push to %s: %s", cid, exc)

    # Clean up stale connections
    if stale_ids:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ws_connections WHERE connection_id = ANY(%s)",
                (stale_ids,),
            )
        conn.commit()


def lambda_handler(event, context):
    logger.info("price-fetcher invoked")
    
    api_key = get_api_key()
    bucket_ts = _bucket_timestamp()
    conn = get_connection()
    ws_payload: dict = {"event": "price_update", "timestamp": bucket_ts.isoformat()}

    try:
        # Fetch both metals in one network request
        records = _fetch_prices(api_key)
        for record in records:
            metal = record["metal"]
            _upsert_ohlc(conn, record, bucket_ts)
            
            ws_payload[metal] = {
                "open": record["open"],
                "high": record["high"],
                "low": record["low"],
                "close": record["close"],
            }
            logger.info("Wrote %s OHLC: close=%.4f", metal, record["close"])
    except Exception as exc:
        logger.error("Failed to fetch/store prices: %s", exc)

    # Broadcast to WebSocket clients
    try:
        connection_ids = _get_active_connections(conn)
        if connection_ids:
            _broadcast(connection_ids, ws_payload)
    except Exception as exc:
        logger.warning("WebSocket broadcast failed: %s", exc)

    return {"statusCode": 200, "body": "OK"}
