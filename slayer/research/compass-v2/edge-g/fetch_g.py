"""EDGE-G book fetcher (PREREG F1, F2). One request in flight. Resumable (one atomic file per root-session).

  python3 fetch_g.py book DEV|VAL

F1: the PRIOR session's EOD greeks (implied vol) per root, expiries up to 35 days after the prior session:
    v2data/edge-g/eod/<ROOT>/<D>.parquet  (D = the session the IVs serve; columns e, k, r, iv, und, ts_ms)
F2: SPX-root (AM monthly) open interest of session D's morning report, expiries D..D+35:
    v2data/edge-g/oi_spx/<D>.parquet
"""
import io, os, sys, time, datetime as dt
import pandas as pd
from common import (OUT, ROOTS, STATS, MIN_FREE_GB, assert_open, atomic_parquet, dev_sessions, disk_free_gb, get,
                    has_chain, prior_session, split_of)


def _ymd(d):
    return d.replace('-', '')


def eod_job(sym, day, allow):
    f = os.path.join(OUT, 'eod', sym, f'{day}.parquet')
    if os.path.exists(f):
        return 'have'
    p = prior_session(day)
    assert_open(day, allow)
    assert split_of(p) != 'LOCKED', (day, p)
    t = get(f'/option/history/greeks/eod?symbol={sym}&expiration=*&start_date={_ymd(p)}&end_date={_ymd(p)}'
            f'&max_dte=35&format=csv')
    if t is None:
        return 'fail'
    if not t.strip() or not t.startswith('symbol'):
        atomic_parquet(pd.DataFrame({'e': [], 'k': [], 'r': [], 'iv': [], 'und': [], 'ts_ms': []}), f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t), usecols=['expiration', 'strike', 'right', 'implied_vol', 'underlying_price',
                                              'timestamp', 'bid', 'ask'])
    d0 = dt.date.fromisoformat(day)
    e = (pd.to_datetime(df['expiration']).dt.date.map(lambda x: (x - d0).days)).astype('int16')
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'e': e, 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'),
                        'iv': df['implied_vol'].astype('float32'), 'und': df['underlying_price'].astype('float32'),
                        'ts_ms': ((ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second) * 1000).astype('int32'),
                        'bid': df['bid'].astype('float32'), 'ask': df['ask'].astype('float32')})
    out = out[out.e >= 0]
    atomic_parquet(out, f)
    return 'ok'


def oi_spx_job(day, allow):
    f = os.path.join(OUT, 'oi_spx', f'{day}.parquet')
    if os.path.exists(f):
        return 'have'
    assert_open(day, allow)
    t = get(f'/option/history/open_interest?symbol=SPX&expiration=*&date={_ymd(day)}&format=csv')
    if t is None:
        return 'fail'
    if not t.strip() or not t.startswith('symbol'):
        atomic_parquet(pd.DataFrame({'e': [], 'k': [], 'r': [], 'oi': []}), f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t))
    d0 = dt.date.fromisoformat(day)
    e = pd.to_datetime(df['expiration']).dt.date.map(lambda x: (x - d0).days).astype('int16')
    out = pd.DataFrame({'e': e, 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'),
                        'oi': df['open_interest'].astype('int32')})
    out = out[(out.e >= 0) & (out.e <= 35)]
    atomic_parquet(out, f)
    return 'ok'


def main():
    which = sys.argv[2] if len(sys.argv) > 2 else 'DEV'
    allow = (which,) if which == 'DEV' else ('VALIDATION',)
    days = dev_sessions('DEV' if which == 'DEV' else 'VALIDATION')
    print(len(days), 'sessions', days[0], days[-1], flush=True)
    jobs = []
    for d in days:
        for r in ROOTS:
            if has_chain(r, d):
                jobs.append(('eod', r, d))
        if has_chain('SPXW', d):
            jobs.append(('eod', 'SPX', d))
            jobs.append(('oi', 'SPX', d))
    print(len(jobs), 'jobs', flush=True)
    t0 = time.time()
    res = {}
    for i, (kind, sym, d) in enumerate(jobs):
        if disk_free_gb() < MIN_FREE_GB:
            print('disk free < 3 GB: stop', flush=True)
            break
        r = eod_job(sym, d, allow) if kind == 'eod' else oi_spx_job(d, allow)
        res[r] = res.get(r, 0) + 1
        if i % 100 == 0:
            print(time.strftime('%H:%M:%S'), i, res, STATS, f'{disk_free_gb():.2f} GB', f'{time.time() - t0:.0f}s', flush=True)
    print('done', res, STATS, flush=True)


if __name__ == '__main__':
    main()
