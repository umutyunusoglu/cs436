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

_connection = None
_db_credentials = None  # Global cache for cold-start secrets optimization

def get_connection():
    """
    Return a cached psycopg2 connection.
    Fetches credentials ONCE during the Lambda cold start.
    """
    global _connection, _db_credentials

    # 1. Return warm connection if valid
    if _connection is not None and not _connection.closed:
        try:
            _connection.cursor().execute("SELECT 1")
            return _connection
        except Exception:
            _connection = None

    # 2. Fetch secret only if not cached (Cold Start)
    if not _db_credentials:
        client = boto3.client("secretsmanager")
        response = client.get_secret_value(SecretId=os.environ["DB_SECRET_ARN"])
        _db_credentials = json.loads(response["SecretString"])

    # 3. Establish new connection
    _connection = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=_db_credentials["username"],
        password=_db_credentials["password"],
        connect_timeout=5,
        cursor_factory=RealDictCursor,
    )
    _connection.autocommit = False
    return _connection