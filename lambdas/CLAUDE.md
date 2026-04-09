# CLAUDE.md — lambdas/

Python 3.12 Lambda functions for the Gold & Silver Price Tracker.

## Directory Structure

```
lambdas/
├── shared/
│   └── db.py              # psycopg2 connection helper — source of truth
├── price-fetcher/
│   ├── db.py              # copied from shared/ (CDK bundles each dir independently)
│   ├── handler.py
│   └── requirements.txt
├── model-trainer/
│   ├── db.py
│   ├── handler.py
│   └── requirements.txt
├── model-invoker/
│   ├── db.py
│   ├── handler.py
│   └── requirements.txt
└── api-handler/
    ├── db.py
    ├── handler.py
    ├── technical.py       # RSI/MACD calculations
    └── requirements.txt
```

## Shared `db.py` Pattern

`lambdas/shared/db.py` is the canonical source. It is **copied** into each Lambda directory because `PythonFunction` packages each directory independently. After editing `shared/db.py`, re-copy it:

```bash
for d in price-fetcher model-trainer model-invoker api-handler; do
  cp lambdas/shared/db.py lambdas/$d/db.py
done
```

`db.py` caches the psycopg2 connection at module level — this means it reuses the same connection across warm Lambda invocations. It reconnects automatically if the connection is closed or stale.

## Secrets Manager Access Pattern

Every Lambda reads DB credentials at invocation time via `boto3`:

```python
import boto3, json, os
secret = json.loads(
    boto3.client("secretsmanager")
        .get_secret_value(SecretId=os.environ["DB_SECRET_ARN"])["SecretString"]
)
```

Never hardcode credentials. Never log secret values.

## Function Responsibilities

| Function | Trigger | Key logic |
|---|---|---|
| `price-fetcher` | EventBridge rate(5min) | Fetch goldapi.io → upsert OHLC → broadcast WebSocket |
| `model-trainer` | EventBridge cron(Sun 03:00 UTC) | Read 90d OHLC → train RandomForest → save .pkl to S3 |
| `model-invoker` | Synchronous invocation by `api-handler` | Load .pkl → compute features → predict direction + confidence |
| `api-handler` | API Gateway (REST + WebSocket) | Route `/prices`, `/predict`, `/technical`; handle WS lifecycle |

## Feature Engineering Consistency

`model-trainer` and `model-invoker` must compute **identical** features:
- `sma5`, `sma20`, `sma50` (rolling close means)
- `rsi14` (EWM RSI, period=14)
- `macd`, `macd_signal`, `macd_hist` (12/26/9)
- `volatility` (rolling std of close, window=20)
- `pct_change` (close.pct_change())

If you add or remove a feature in one, update both and retrain.

## Model Artifacts

Models are saved as `{METAL}/model.pkl` in the `model-artifacts` S3 bucket. The `.pkl` is a `joblib` dict:
```python
{
  "model": RandomForestClassifier,
  "feature_cols": List[str],
  "model_ver": "YYYY-MM-DD",
  "metal": "XAU" | "XAG",
}
```

`model-invoker` caches the loaded artifact in a module-level dict across warm invocations.

## Dependencies

All Lambda deps are pinned in `requirements.txt`. CDK `PythonFunction` installs them via `pip` in a Docker container matching the Lambda runtime. Do not add heavy deps (e.g., `torch`, `tensorflow`) — they will exceed the 250 MB Lambda limit.
