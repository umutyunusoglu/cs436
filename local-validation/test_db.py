import psycopg2
from datetime import datetime, timezone, timedelta

try:
    conn = psycopg2.connect(host="localhost", user="postgres", password="local_password", dbname="pricetracker")
    cur = conn.cursor()
    now = datetime.now(timezone.utc)

    print("🚀 Injecting 75 bars of historical data...")
    for i in range(75):
        # Create unique 5-minute buckets going backward
        ts = now - timedelta(minutes=5 * i)
        for metal in ['XAU', 'XAG']:
            cur.execute("""
                INSERT INTO ohlc_prices (metal, open, high, low, close, timestamp)
                VALUES (%s, 2300, 2305, 2295, 2302, %s)
                ON CONFLICT (metal, timestamp) DO UPDATE SET close = EXCLUDED.close
            """, (metal, ts))
    
    conn.commit()
    cur.execute("SELECT count(*) FROM ohlc_prices;")
    print(f"✅ Success! Total rows in DB: {cur.fetchone()[0]}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"❌ Error: {e}")