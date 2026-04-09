"""Shared database connection helper for all Lambda functions.

Usage:
    from db import get_connection

    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT ...")
"""

import json
import os
import boto3
import psycopg2
from psycopg2.extras import RealDictCursor

_connection = None  # Module-level cache for warm Lambda reuse


def _get_secret(secret_arn: str) -> dict:
    client = boto3.client("secretsmanager")
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response["SecretString"])


def get_connection():
    """Return a (possibly cached) psycopg2 connection.

    Reads DB credentials from Secrets Manager on first call, then reuses the
    connection across warm invocations. A stale/closed connection is
    automatically replaced.
    """
    global _connection

    if _connection is not None and not _connection.closed:
        try:
            # Quick liveness check
            _connection.cursor().execute("SELECT 1")
            return _connection
        except Exception:
            _connection = None

    secret_arn = os.environ["DB_SECRET_ARN"]
    secret = _get_secret(secret_arn)

    _connection = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=secret["username"],
        password=secret["password"],
        connect_timeout=5,
        cursor_factory=RealDictCursor,
    )
    _connection.autocommit = False
    return _connection
