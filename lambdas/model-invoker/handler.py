"""model-invoker Lambda

Called on demand by api-handler to return a price direction prediction.
1. Downloads (and caches across warm invocations) the model .pkl from S3.
2. Fetches the latest 60 OHLC rows from RDS.
3. Computes the same features used at training time.
4. Returns direction ('up'/'down'/'sideways') + confidence score.
"""

import io
import json
import logging
import os

import boto3
import joblib
import numpy as np
import pandas as pd

from db import get_connection

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Warm-invocation cache
_model_cache: dict = {}
_model_etag: dict = {}

def _load_model(metal: str) -> dict:
    bucket = os.environ["MODEL_BUCKET"]
    key = f"{metal}/model.pkl"
    s3 = boto3.client("s3")

    # 1. Fetch just the metadata to get the latest ETag
    try:
        head_resp = s3.head_object(Bucket=bucket, Key=key)
        current_etag = head_resp["ETag"]
    except s3.exceptions.ClientError:
        raise ValueError(f"No trained model found for {metal}. Run model-trainer first.")

    # 2. Return cached model if ETag matches
    if metal in _model_cache and _model_etag.get(metal) == current_etag:
        return _model_cache[metal]

    # 3. Cache miss or stale model: download the fresh artifact
    obj = s3.get_object(Bucket=bucket, Key=key)
    artifact = joblib.load(io.BytesIO(obj["Body"].read()))
    
    # Update state
    _model_cache[metal] = artifact
    _model_etag[metal] = current_etag
    
    logger.info("Loaded fresh model for %s (v%s)", metal, artifact.get("model_ver"))
    return artifact


def _compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _compute_macd(series: pd.Series) -> pd.DataFrame:
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    return pd.DataFrame({"macd": macd, "macd_signal": signal, "macd_hist": macd - signal})


def _get_features(conn, metal: str, feature_cols: list) -> np.ndarray:
    """Fetch recent OHLC data and compute features; return last row as feature vector."""
    sql = """
        SELECT open_price, high_price, low_price, close_price, timestamp_utc
        FROM ohlc_prices
        WHERE metal = %s
        ORDER BY timestamp_utc DESC
        LIMIT 60
    """
    with conn.cursor() as cur:
        cur.execute(sql, (metal,))
        rows = cur.fetchall()

    if not rows or len(rows) < 30:
        raise ValueError(f"Not enough data for {metal} prediction ({len(rows)} rows)")

    df = pd.DataFrame(rows[::-1], columns=["open_price", "high_price", "low_price", "close_price", "timestamp_utc"])
    for col in ["open_price", "high_price", "low_price", "close_price"]:
        df[col] = df[col].astype(float)

    close = df["close_price"]
    df["sma5"] = close.rolling(5).mean()
    df["sma20"] = close.rolling(20).mean()
    df["sma50"] = close.rolling(50).mean()
    df["rsi14"] = _compute_rsi(close, 14)
    macd_df = _compute_macd(close)
    df = pd.concat([df, macd_df], axis=1)
    df["volatility"] = close.rolling(20).std()
    df["pct_change"] = close.pct_change()

    last_row = df.iloc[-1]
    return last_row[feature_cols].values.reshape(1, -1)


def lambda_handler(event, context):
    metal = event.get("metal", "XAU").upper()
    if metal not in ("XAU", "XAG"):
        return {"statusCode": 400, "body": json.dumps({"error": "metal must be XAU or XAG"})}

    try:
        artifact = _load_model(metal)
        model = artifact["model"]
        feature_cols = artifact["feature_cols"]
        model_ver = artifact.get("model_ver", "unknown")

        conn = get_connection()
        X = _get_features(conn, metal, feature_cols)

        # Cast PostgreSQL Decimal objects to float to prevent np.isnan crashes
        import numpy as np
        X = np.array(X, dtype=float)

        if np.isnan(X).any():
            return {
                "statusCode": 503,
                "body": json.dumps({"error": "Insufficient data to compute features"}),
            }

        direction = model.predict(X)[0]
        proba = model.predict_proba(X)[0]
        confidence = float(max(proba))

        result = {
            "metal": metal,
            "direction": direction,
            "confidence": round(confidence, 4),
            "model_ver": model_ver,
        }
        logger.info("Prediction for %s: %s (%.2f%%)", metal, direction, confidence * 100)
        return {"statusCode": 200, "body": json.dumps(result)}

    except ValueError as exc:
        logger.warning("Prediction failed for %s: %s", metal, exc)
        return {"statusCode": 503, "body": json.dumps({"error": str(exc)})}
    except Exception as exc:
        logger.error("Unexpected error: %s", exc, exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": "Internal error"})}