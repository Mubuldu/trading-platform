"""
download_candles.py — Download OHLCV candles from Binance's public REST API.

No API key required (public data endpoint).

Usage:
    python download_candles.py --symbol BTCUSDT --interval 15m --years 4 --out data/btc_15m.csv
    python download_candles.py --symbol ETHUSDT --interval 15m --years 4 --out data/eth_15m.csv
    python download_candles.py --symbol SOLUSDT --interval 15m --years 4 --out data/sol_15m.csv
"""

from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import requests

BINANCE_URL = "https://api.binance.com/api/v3/klines"
LIMIT = 1000  # max per request


def fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[list]:
    """Paginate through Binance klines endpoint and return all raw rows."""
    rows: list[list] = []
    current_start = start_ms

    while current_start < end_ms:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": current_start,
            "endTime": end_ms,
            "limit": LIMIT,
        }
        for attempt in range(5):
            try:
                resp = requests.get(BINANCE_URL, params=params, timeout=15)
                resp.raise_for_status()
                batch = resp.json()
                break
            except Exception as exc:
                if attempt == 4:
                    raise
                wait = 2 ** attempt
                print(f"  [retry {attempt+1}] {exc} — sleeping {wait}s")
                time.sleep(wait)

        if not batch:
            break

        rows.extend(batch)
        # Advance past the last candle's open_time
        current_start = int(batch[-1][0]) + 1

        pct = (current_start - start_ms) / (end_ms - start_ms) * 100
        print(f"  {len(rows):>7} rows   {pct:.1f}%", end="\r")

        if len(batch) < LIMIT:
            break
        time.sleep(0.1)  # rate-limit courtesy delay

    print()
    return rows


def rows_to_df(rows: list[list]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "n_trades",
        "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    df = df[["open_time", "open", "high", "low", "close", "volume"]].copy()
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    # Use int64 explicitly — Windows numpy defaults to int32 which overflows
    # millisecond timestamps from 2020+ (> 2^31 ms since epoch).
    df["open_time"] = df["open_time"].astype("int64")
    df = df.sort_values("open_time").drop_duplicates("open_time").reset_index(drop=True)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description="Download OHLCV candles from Binance")
    parser.add_argument("--symbol", required=True, help="e.g. BTCUSDT")
    parser.add_argument("--interval", default="15m", help="e.g. 15m, 1h, 4h")
    parser.add_argument("--years", type=float, default=4.0, help="Years of history to download")
    parser.add_argument("--out", required=True, help="Output CSV path")
    args = parser.parse_args()

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=365 * args.years)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    print(f"Downloading {args.symbol} {args.interval} from {start_dt.date()} → {end_dt.date()}")

    rows = fetch_klines(args.symbol, args.interval, start_ms, end_ms)
    df = rows_to_df(rows)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)

    start_readable = pd.Timestamp(df["open_time"].iloc[0], unit="ms").date()
    end_readable   = pd.Timestamp(df["open_time"].iloc[-1], unit="ms").date()
    print(f"Saved {len(df):,} candles  [{start_readable} → {end_readable}]  → {out.resolve()}")


if __name__ == "__main__":
    main()
