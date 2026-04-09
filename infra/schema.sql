-- Gold & Silver Price Tracker — PostgreSQL Schema
-- Run this against the RDS instance after StorageStack deploy:
--   psql -h <rds-endpoint> -U postgres -d pricetracker -f schema.sql

-- ── OHLC Price History ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlc_prices (
    id          BIGSERIAL       PRIMARY KEY,
    metal       VARCHAR(3)      NOT NULL,       -- 'XAU' (gold) or 'XAG' (silver)
    open        NUMERIC(12, 4)  NOT NULL,
    high        NUMERIC(12, 4)  NOT NULL,
    low         NUMERIC(12, 4)  NOT NULL,
    close       NUMERIC(12, 4)  NOT NULL,
    volume      NUMERIC(16, 4)  DEFAULT 0,
    currency    VARCHAR(3)      NOT NULL DEFAULT 'USD',
    timestamp   TIMESTAMPTZ     NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Unique constraint: one record per metal per 5-minute bucket
CREATE UNIQUE INDEX IF NOT EXISTS idx_ohlc_metal_ts_unique
    ON ohlc_prices (metal, timestamp);

-- Fast reads for charting queries
CREATE INDEX IF NOT EXISTS idx_ohlc_metal_ts
    ON ohlc_prices (metal, timestamp DESC);

-- ── ML Predictions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS predictions (
    id           BIGSERIAL      PRIMARY KEY,
    metal        VARCHAR(3)     NOT NULL,
    direction    VARCHAR(10)    NOT NULL,        -- 'up', 'down', 'sideways'
    confidence   NUMERIC(5, 4)  NOT NULL,        -- 0.0000 – 1.0000
    model_ver    VARCHAR(50),                    -- e.g. '2026-04-06'
    predicted_at TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_metal_ts
    ON predictions (metal, predicted_at DESC);

-- ── WebSocket Connection Registry ─────────────────────────────────────────────
-- Stores active WebSocket connection IDs so price-fetcher can broadcast updates
CREATE TABLE IF NOT EXISTS ws_connections (
    connection_id  VARCHAR(128)  PRIMARY KEY,
    connected_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_ping      TIMESTAMPTZ
);
