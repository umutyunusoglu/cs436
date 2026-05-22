"""model-trainer Lambda

Triggered every Sunday at 03:00 UTC by EventBridge.
1. Reads 90 days of OHLC price data from RDS.
2. Feature-engineers RSI-14, MACD, and rolling means.
3. Labels each row: 'up' / 'down' / 'sideways'.
4. Trains a RandomForestClassifier (one model per metal).
5. Saves the serialized model to S3 model-artifacts bucket.
"""

import io
import json
import logging
import os
from datetime import datetime, timezone

import boto3
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

from db import get_connection

logger = logging.getLogger()
logger.setLevel(logging.INFO)

METALS = ["XAU", "XAG"]
LOOKBACK_DAYS = 90
UP_THRESHOLD = 1.005    # +0.5% → 'up'
DOWN_THRESHOLD = 0.995  # -0.5% → 'down'


# ── Feature Engineering ───────────────────────────────────────────────────────

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


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values("timestamp_utc").copy()
    close = df["close_price"]

    df["sma5"] = close.rolling(5).mean()
    df["sma20"] = close.rolling(20).mean()
    df["sma50"] = close.rolling(50).mean()
    df["rsi14"] = _compute_rsi(close, 14)
    macd_df = _compute_macd(close)
    df = pd.concat([df, macd_df], axis=1)
    df["volatility"] = close.rolling(20).std()
    df["pct_change"] = close.pct_change()

    # Label: compare close[t] vs close[t+1]
    next_close = close.shift(-1)
    ratio = next_close / close
    df["label"] = "sideways"
    df.loc[ratio > UP_THRESHOLD, "label"] = "up"
    df.loc[ratio < DOWN_THRESHOLD, "label"] = "down"

    # Drop rows with NaN features or last row (no next_close)
    feature_cols = ["sma5", "sma20", "sma50", "rsi14", "macd", "macd_signal", "macd_hist", "volatility", "pct_change"]
    df = df.dropna(subset=feature_cols + ["label"])
    df = df.iloc[:-1]  # last row has no valid label

    return df, feature_cols


def _load_data(conn, metal: str) -> pd.DataFrame:
    sql = """
        SELECT open_price, high_price, low_price, close_price, timestamp_utc
        FROM ohlc_prices
        WHERE metal = %s
          AND timestamp_utc > NOW() - (INTERVAL '1 day' * %s)
        ORDER BY timestamp_utc ASC
    """
    with conn.cursor() as cur:
        # Pass the parameter safely without string interpolation
        cur.execute(sql, (metal, LOOKBACK_DAYS))
        rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["open_price", "high_price", "low_price", "close_price", "timestamp_utc"])
    for col in ["open_price", "high_price", "low_price", "close_price"]:
        df[col] = df[col].astype(float)
    return df


def _train_model(df: pd.DataFrame, feature_cols: list) -> RandomForestClassifier:
    X = df[feature_cols].values
    y = df["label"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False  # time-series: no shuffle
    )

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=8,
        random_state=42,
        n_jobs=1,  # FIX: Changed from -1 to prevent thread thrashing on 512MB Lambda
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    logger.info("Classification report:\n%s", classification_report(y_test, y_pred))

    return model


def _save_model(model, metal: str, feature_cols: list, model_ver: str) -> None:
    bucket = os.environ["MODEL_BUCKET"]
    key = f"{metal}/model.pkl"

    artifact = {
        "model": model,
        "feature_cols": feature_cols,
        "model_ver": model_ver,
        "metal": metal,
    }

    buf = io.BytesIO()
    joblib.dump(artifact, buf)
    buf.seek(0)

    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=buf.read(),
        ContentType="application/octet-stream",
        Metadata={"model_ver": model_ver, "metal": metal},
    )
    logger.info("Saved model to s3://%s/%s", bucket, key)


def lambda_handler(event, context):
    logger.info("model-trainer invoked")
    conn = get_connection()
    model_ver = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for metal in METALS:
        logger.info("Training model for %s", metal)
        df = _load_data(conn, metal)

        if df.empty or len(df) < 100:
            logger.warning("Not enough data for %s (%d rows), skipping", metal, len(df))
            continue

        df, feature_cols = _build_features(df)
        if len(df) < 50:
            logger.warning("Not enough labeled rows for %s after feature engineering", metal)
            continue

        model = _train_model(df, feature_cols)
        _save_model(model, metal, feature_cols, model_ver)
        logger.info("Finished training %s model (v%s)", metal, model_ver)

    return {"statusCode": 200, "body": "Training complete"}
