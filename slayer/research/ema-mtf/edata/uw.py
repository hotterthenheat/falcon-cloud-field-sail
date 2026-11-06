"""Unusual Whales flow alerts for the panel's eval sessions (>= 2023-12-06, the key's floor), one request in flight.

    python3 -m edata.uw --block A          -> v2data/ema/uw/{TICKER}/{D}.parquet (strings as sent; resumable)

Alerts are usable from `created_at` (publication), never `start_time` (STRATEGY_SPEC section 13). Paging follows
compass-v2 data/fetch.py: newest first, older_than = the oldest created_at of the page.
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA, guard, write_parquet  # noqa: E402
from data.clients import uw_get  # noqa: E402

UW_DIR = os.path.join(EMA_DATA, 'uw')
FLOOR = '20231206'
TICKERS = ('SPY', 'QQQ', 'IWM', 'SPX', 'SPXW')


def rows_of(d):
    return d.get('data', []) if isinstance(d, dict) else d


def fetch_day(t: str, D: str):
    p = os.path.join(UW_DIR, t, f'{D}.parquet')
    if os.path.exists(p) or D < FLOOR:
        return None
    guard(D)
    iso = f'{D[:4]}-{D[4:6]}-{D[6:]}'
    got, older = [], f'{iso}T23:59:59Z'
    for _ in range(80):
        rows = rows_of(uw_get('/api/option-trades/flow-alerts', {'ticker_symbol': t, 'limit': 200,
                                                                 'newer_than': f'{iso}T00:00:00Z', 'older_than': older}))
        if not rows:
            break
        got += rows
        older = min(r['created_at'] for r in rows if r.get('created_at'))
        if len(rows) < 200:
            break
    df = pd.DataFrame(got)
    if len(df):
        df = df.drop_duplicates(subset=[c for c in ('id', 'option_chain', 'start_time') if c in df.columns]).astype(str)
    else:
        df = pd.DataFrame({'created_at': pd.Series(dtype=str)})
    write_parquet(df, p)
    return len(df)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--block', default='A')
    a = ap.parse_args()
    from edata.store import Panel
    plan = Panel('SPY').plan(a.block)
    for D in plan['eval']:
        for t in TICKERS:
            try:
                n = fetch_day(t, D)
                if n is not None:
                    print(t, D, n, 'alerts', flush=True)
            except Exception as e:  # noqa: BLE001
                print(t, D, 'FAILED', str(e)[:200], flush=True)


if __name__ == '__main__':
    main()
