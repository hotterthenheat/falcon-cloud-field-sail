"""Fetch UW flow alerts (ask-side, OTM, DTE<=7, premium>=$100k) for DEV and VAL windows only (never a locked day).

Pages backwards with older_than. Output: DATA/uw/flow_<SPLIT>_<i>.jsonl.gz (raw alerts, trimmed fields).
Usage: python3 fetch_flow.py DEV|VAL
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, WINDOWS, uw_get, write_jsonl_gz  # noqa: E402

KEEP = ['id', 'created_at', 'start_time', 'end_time', 'ticker', 'option_chain', 'type', 'strike', 'expiry', 'price',
        'bid', 'ask', 'underlying_price', 'total_premium', 'total_ask_side_prem', 'total_bid_side_prem', 'total_size',
        'trade_count', 'volume', 'open_interest', 'volume_oi_ratio', 'has_sweep', 'has_floor', 'has_multileg',
        'has_singleleg', 'all_opening_trades', 'alert_rule', 'issue_type', 'er_time', 'marketcap', 'sector']
FILTER = dict(is_ask_side='true', is_otm='true', max_dte=7, min_premium=100000, limit=200)


def fetch(split):
    for i, (lo, hi) in enumerate(WINDOWS[split]):
        out = f'{DATA}/uw/flow_{split}_{i}.jsonl.gz'
        if os.path.exists(out):
            print('have', out); continue
        rows, seen, cur, n = [], set(), hi, 0
        while True:
            js = uw_get('/option-trades/flow-alerts', dict(FILTER, older_than=cur))
            d = js.get('data', [])
            n += 1
            new = [r for r in d if r['id'] not in seen]
            for r in new:
                seen.add(r['id'])
                if r['created_at'] >= lo:
                    rows.append({k: r.get(k) for k in KEEP})
            if not d or not new:
                break
            oldest = min(r['created_at'] for r in d)
            if oldest < lo:
                break
            cur = oldest
            if n % 50 == 0:
                print(split, i, n, len(rows), cur, flush=True)
        write_jsonl_gz(out, rows)
        print('wrote', out, len(rows), 'requests', n, flush=True)


if __name__ == '__main__':
    fetch(sys.argv[1])
