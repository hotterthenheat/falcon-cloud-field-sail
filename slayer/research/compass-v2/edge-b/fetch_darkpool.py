"""Fetch UW dark-pool prints >= $5M for the F3 universe, one ticker-session at a time (DEV/VAL sessions only).

Sessions = the dates that carry regular-hours flow alerts in the fetched flow files (so no locked day is asked).
Output: DATA/uw/dp/<T>.jsonl.gz (all prints for the ticker, both splits). Usage: python3 fetch_darkpool.py
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, read_jsonl_gz, split_of, uw_get, write_jsonl_gz  # noqa: E402
import datetime as dt  # noqa: E402

UNIVERSE = ('SPY QQQ IWM AAPL MSFT NVDA AMZN META GOOGL TSLA AMD NFLX AVGO JPM XOM BA COIN MU INTC SMCI PLTR UBER '
            'DIS WMT').split()


def sessions():
    days = set()
    for f in glob.glob(f'{DATA}/uw/flow_*.jsonl.gz'):
        for r in read_jsonl_gz(f):
            days.add(r['created_at'][:10])
    out = sorted(d for d in days if split_of(dt.date.fromisoformat(d)) in ('DEV', 'VAL')
                 and dt.date.fromisoformat(d).weekday() < 5)
    return out


def main():
    S = sessions()
    print('sessions', len(S), S[0], S[-1], flush=True)
    for t in UNIVERSE:
        out = f'{DATA}/uw/dp/{t}.jsonl.gz'
        if os.path.exists(out):
            continue
        rows = []
        for d in S:
            cur = None
            while True:
                p = dict(date=d, min_premium=5000000, limit=500)
                if cur:
                    p['older_than'] = cur
                try:
                    js = uw_get(f'/darkpool/{t}', p)
                except RuntimeError as e:
                    print('ERR', t, d, str(e)[:120], flush=True); break
                dd = js.get('data', [])
                rows += [dict(r, session=d) for r in dd]
                if len(dd) < 500:
                    break
                cur = min(r['executed_at'] for r in dd)
        write_jsonl_gz(out, rows)
        print('wrote', t, len(rows), flush=True)


if __name__ == '__main__':
    main()
