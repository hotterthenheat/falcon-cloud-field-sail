"""Fetch 1-second stock NBBO windows for every (ticker, session) carrying a registered event, plus SPY full days.

One ThetaData request in flight. Output: DATA/theta/stk/<session>/<T>.parquet (sod int32 = ET second of day of the
row stamp, bid, ask float32). Usage: python3 fetch_under.py F1 [F3 ...]
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, NoData, theta_csv  # noqa: E402

OPEN, CLOSE = 9 * 3600 + 30 * 60, 16 * 3600


def hms(s):
    s = int(s)
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def fetch_one(t, session, lo, hi):
    out = f'{DATA}/theta/stk/{session}/{t}.parquet'
    if os.path.exists(out):
        return 'have'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    try:
        df = theta_csv('/stock/history/quote', dict(symbol=t, date=session.replace('-', ''), interval='1s',
                                                    start_time=hms(lo), end_time=hms(hi)))
    except NoData:
        pd.DataFrame({'sod': np.array([], 'int32'), 'bid': [], 'ask': []}).to_parquet(out)
        return 'nodata'
    ts = pd.to_datetime(df['timestamp'])
    sod = (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).astype('int32')
    o = pd.DataFrame({'sod': sod, 'bid': df['bid'].astype('float32'), 'ask': df['ask'].astype('float32')})
    o.to_parquet(out, compression='zstd')
    return len(o)


def main(fams):
    ev = pd.concat([pd.read_parquet(f'{DATA}/events_{f}.parquet') for f in fams])
    g = ev.groupby(['ticker', 'session']).agg(lo=('sod0', 'min'), hi=('sod0', 'max')).reset_index()
    jobs = [(r.ticker, r.session, max(OPEN, r.lo - 1800 - 5), min(CLOSE, r.hi + 62 * 60 + 15)) for r in g.itertuples()]
    for s in sorted(ev['session'].unique()):
        jobs.append(('SPY', s, OPEN, CLOSE))
    # SPY full days supersede SPY windows
    spy_full = {s for (t, s, lo, hi) in jobs if t == 'SPY' and lo == OPEN and hi == CLOSE}
    jobs = [j for j in jobs if not (j[0] == 'SPY' and j[1] in spy_full and not (j[2] == OPEN and j[3] == CLOSE))]
    print('jobs', len(jobs), flush=True)
    for i, (t, s, lo, hi) in enumerate(jobs):
        try:
            r = fetch_one(t, s, lo, hi)
        except Exception as e:  # noqa
            r = 'ERR ' + str(e)[:100]
        if i % 200 == 0 or str(r).startswith('ERR'):
            print(i, t, s, r, flush=True)
    print('done', flush=True)


if __name__ == '__main__':
    main(sys.argv[1:])
