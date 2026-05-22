CREATE TABLE IF NOT EXISTS ohlc_prices (
    id SERIAL PRIMARY KEY,
    metal VARCHAR(10) NOT NULL,
    open_price NUMERIC NOT NULL,
    high_price NUMERIC NOT NULL,
    low_price NUMERIC NOT NULL,
    close_price NUMERIC NOT NULL,
    timestamp_utc TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (metal, timestamp_utc)
);

CREATE TABLE IF NOT EXISTS ws_connections (
    connection_id VARCHAR(255) PRIMARY KEY,
    last_ping TIMESTAMPTZ DEFAULT NOW()
);