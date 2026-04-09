"""Technical indicator calculations: RSI and MACD.

Used by api-handler to serve GET /technical responses.
All calculations are done in-process on the OHLC data fetched from RDS.
"""

from typing import List, Dict, Any
import numpy as np
import pandas as pd


def compute_rsi(closes: List[float], period: int = 14) -> List[Dict[str, Any]]:
    """Compute RSI-{period} for a list of closing prices.

    Returns a list of {'value': float | None} dicts aligned with the input.
    The first `period` values will be None (insufficient history).
    """
    series = pd.Series(closes, dtype=float)
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    return [
        {"value": None if np.isnan(v) else round(float(v), 4)}
        for v in rsi
    ]


def compute_macd(
    closes: List[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> List[Dict[str, Any]]:
    """Compute MACD line, signal line, and histogram.

    Returns a list of:
        {
            'macd': float | None,
            'signal': float | None,
            'histogram': float | None,
        }
    """
    series = pd.Series(closes, dtype=float)
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line

    def _val(v):
        return None if np.isnan(v) else round(float(v), 6)

    return [
        {
            "macd": _val(macd_line.iloc[i]),
            "signal": _val(signal_line.iloc[i]),
            "histogram": _val(histogram.iloc[i]),
        }
        for i in range(len(closes))
    ]
