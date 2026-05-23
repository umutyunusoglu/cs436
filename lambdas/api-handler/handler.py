"""api-handler Lambda

Handles REST API requests from API Gateway:
  GET /prices?metal=gold&range=7d   — OHLC history
  GET /predict?metal=gold            — ML direction prediction
  GET /technical?metal=silver        — RSI + MACD

Also handles WebSocket lifecycle events:
  $connect    — register connection ID
  $disconnect — remove connection ID
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3

from db import get_connection
from technical import compute_rsi, compute_macd

logger = logging.getLogger()
logger.setLevel(logging.INFO)

METAL_MAP = {"gold": "XAU", "silver": "XAG", "xau": "XAU", "xag": "XAG"}
RANGE_MAP = {
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "1d": timedelta(days=1),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}
DEFAULT_RANGE = "7d"


def _ok(body: Any, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }


def _err(message: str, status: int = 400) -> dict:
    return _ok({"error": message}, status)


# ── /prices ───────────────────────────────────────────────────────────────────

def handle_prices(params: dict) -> dict:
    metal_raw = (params.get("metal") or "gold").lower()
    metal = METAL_MAP.get(metal_raw)
    if not metal:
        return _err(f"Unknown metal '{metal_raw}'. Use gold or silver.")

    range_str = (params.get("range") or DEFAULT_RANGE).lower()
    delta = RANGE_MAP.get(range_str)
    if not delta:
        return _err(f"Unknown range '{range_str}'. Use 1h, 6h, 1d, 7d, 30d, 90d.")

    since = datetime.now(timezone.utc) - delta
    conn = get_connection()

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT open_price, high_price, low_price, close_price, timestamp_utc
            FROM ohlc_prices
            WHERE metal = %s AND timestamp_utc >= %s
            ORDER BY timestamp_utc ASC
            """,
            (metal, since),
        )
        rows = cur.fetchall()

    data = [
        {
            "open": float(r["open_price"]),
            "high": float(r["high_price"]),
            "low": float(r["low_price"]),
            "close": float(r["close_price"]),
            "volume": 0.0,
            "timestamp": r["timestamp_utc"].isoformat(),
        }
        for r in rows
    ]
    return _ok({"metal": metal, "range": range_str, "count": len(data), "data": data})


# ── /predict ──────────────────────────────────────────────────────────────────

def handle_predict(params: dict) -> dict:
    metal_raw = (params.get("metal") or "gold").lower()
    metal = METAL_MAP.get(metal_raw)
    if not metal:
        return _err(f"Unknown metal '{metal_raw}'.")

    invoker_arn = os.environ.get("MODEL_INVOKER_ARN")
    if not invoker_arn:
        return _err("model-invoker not configured", 503)

    lambda_client = boto3.client("lambda")
    response = lambda_client.invoke(
        FunctionName=invoker_arn,
        InvocationType="RequestResponse",
        Payload=json.dumps({"metal": metal}),
    )
    payload = json.loads(response["Payload"].read())
    body = json.loads(payload.get("body", "{}"))

    if payload.get("statusCode", 200) >= 400:
        return _ok(body, payload["statusCode"])
    return _ok(body)


# ── /technical ────────────────────────────────────────────────────────────────

def handle_technical(params: dict) -> dict:
    metal_raw = (params.get("metal") or "gold").lower()
    metal = METAL_MAP.get(metal_raw)
    if not metal:
        return _err(f"Unknown metal '{metal_raw}'.")

    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT close_price, timestamp_utc
            FROM ohlc_prices
            WHERE metal = %s
            ORDER BY timestamp_utc DESC
            LIMIT 200
            """,
            (metal,),
        )
        rows = cur.fetchall()

    if not rows:
        return _ok({"metal": metal, "rsi": [], "macd": []})

    rows = list(reversed(rows))
    closes = [float(r["close_price"]) for r in rows]
    timestamps = [r["timestamp_utc"].isoformat() for r in rows]

    rsi_values = compute_rsi(closes, period=14)
    macd_values = compute_macd(closes)

    rsi_data = [{"value": rsi_values[i]["value"], "timestamp": timestamps[i]} for i in range(len(rows))]
    macd_data = [
        {
            "macd": macd_values[i]["macd"],
            "signal": macd_values[i]["signal"],
            "histogram": macd_values[i]["histogram"],
            "timestamp": timestamps[i],
        }
        for i in range(len(rows))
    ]

    return _ok({"metal": metal, "rsi": rsi_data, "macd": macd_data})


# ── WebSocket lifecycle ───────────────────────────────────────────────────────

def handle_ws_connect(connection_id: str) -> dict:
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ws_connections (connection_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (connection_id,),
        )
    conn.commit()
    logger.info("WS connected: %s", connection_id)
    return {"statusCode": 200}


def handle_ws_disconnect(connection_id: str) -> dict:
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ws_connections WHERE connection_id = %s", (connection_id,))
    conn.commit()
    logger.info("WS disconnected: %s", connection_id)
    return {"statusCode": 200}

# A handler that updates the database whenever the frontend sends a ping message
def handle_ws_ping(connection_id: str) -> dict:
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE ws_connections SET last_ping = NOW() WHERE connection_id = %s",
            (connection_id,)
        )
    conn.commit()
    return {"statusCode": 200}

# ── Router ────────────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    logger.debug("Event: %s", json.dumps(event, default=str))

    request_context = event.get("requestContext", {})
    route_key = request_context.get("routeKey")
    
    # 1. WebSocket routing (Isolated by checking for connectionId)
    if "connectionId" in request_context:
        connection_id = request_context["connectionId"]
        
        if route_key == "$connect":
            return handle_ws_connect(connection_id)
        if route_key == "$disconnect":
            return handle_ws_disconnect(connection_id)
        # Route custom ping messages or default WS fallbacks
        if route_key == "ping" or route_key == "$default":
            return handle_ws_ping(connection_id)
            
        return {"statusCode": 200, "body": "Connected"}

    # 2. REST events (HTTP traffic)
    path = event.get("path", "") or event.get("rawPath", "")
    params = event.get("queryStringParameters") or {}

    if path.startswith("/prices"):
        return handle_prices(params)
    if path.startswith("/predict"):
        return handle_predict(params)
    if path.startswith("/technical"):
        return handle_technical(params)

    return _err(f"Unknown path: {path}", 404)
