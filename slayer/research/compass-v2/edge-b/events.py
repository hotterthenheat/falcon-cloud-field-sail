"""Build the registered events (PREREG.md) for F1 (flow) and F3 (dark pool). No outcomes are read here.

Output: DATA/events_<FAMILY>.parquet with columns
  variant, split, session, ticker, dir, t0 (UTC epoch s, float), sod0 (ET seconds of day), prem, + family extras.
"""
import datetime as dt
import glob
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, read_jsonl_gz, split_of, et_tz  # noqa: E402

INDEX = {'SPX', 'SPXW', 'NDX', 'NDXP', 'XSP', 'RUT', 'RUTW', 'VIX', 'VIXW', 'DJX'}
SEED = 20261105
CAP_A = 2500


def _et(ts_utc):
    t = pd.to_datetime(ts_utc, utc=True, format='ISO8601')
    return t, t.dt.tz_convert(et_tz())


def _finish(df, family):
    df['split'] = [split_of(d) for d in df['session_date']]
    df = df[df['split'].isin(['DEV', 'VAL'])]
    df = df[(df['sod0'] >= 9 * 3600 + 45 * 60) & (df['sod0'] <= 15 * 3600)]
    df = df[df['session_date'].map(lambda d: d.weekday() < 5)]
    df = df.sort_values('t0')
    out = []
    for v, sub in df.groupby('variant'):
        first = sub.drop_duplicates(['ticker', 'dir', 'session'], keep='first')
        for s, ss in first.groupby('split'):
            n_all = len(ss)
            if n_all > CAP_A:
                ss = ss.sample(CAP_A, random_state=SEED).sort_values('t0')
            ss = ss.assign(n_qualifying=n_all)
            out.append(ss)
    ev = pd.concat(out, ignore_index=True)
    ev['session'] = ev['session'].astype(str)
    ev = ev.drop(columns=['session_date'])
    ev.to_parquet(f'{DATA}/events_{family}.parquet', index=False)
    print(family, ev.groupby(['variant', 'split']).agg(n=('ticker', 'size'), qualifying=('n_qualifying', 'first'),
                                                       sessions=('session', 'nunique')).to_string())
    return ev


def build_f1():
    rows = []
    for f in sorted(glob.glob(f'{DATA}/uw/flow_*.jsonl.gz')):
        rows += read_jsonl_gz(f)
    a = pd.DataFrame(rows).drop_duplicates('id')
    for c in ['strike', 'underlying_price', 'total_premium', 'total_ask_side_prem', 'price']:
        a[c] = pd.to_numeric(a[c], errors='coerce')
    utc, et = _et(a['created_at'])
    a['t0'] = utc.astype('int64') / 1e9
    a['session_date'] = et.dt.date
    a['session'] = a['session_date']
    a['sod0'] = et.dt.hour * 3600 + et.dt.minute * 60 + et.dt.second + et.dt.microsecond / 1e6
    a['dte'] = (pd.to_datetime(a['expiry']).dt.date - a['session_date']).map(lambda x: x.days)
    a['dir'] = np.where(a['type'] == 'call', 1, -1)
    otm = np.where(a['dir'] == 1, a['strike'] > a['underlying_price'], a['strike'] < a['underlying_price'])
    keep = ((a['total_ask_side_prem'] / a['total_premium'] >= 0.80) & (a['has_multileg'] != True)  # noqa: E712
            & (a['issue_type'] != 'Index') & (~a['ticker'].isin(INDEX)) & (a['underlying_price'] >= 10)
            & otm & (a['dte'] >= 0) & (a['dte'] <= 7))
    a = a[keep]
    print('F1 raw alerts', len(rows), 'after filters', len(a))
    v1 = a[a['total_premium'] >= 250_000].assign(variant='F1-A1')
    v2 = a[a['total_premium'] >= 1_000_000].assign(variant='F1-A2')
    v3 = a[(a['total_premium'] >= 250_000) & (a['has_sweep'] == True)].assign(variant='F1-A3')  # noqa: E712
    df = pd.concat([v1, v2, v3])
    df = df.rename(columns={'total_premium': 'prem'})
    df = df.rename(columns={'price': 'alert_px'})
    df = df[['variant', 'session', 'session_date', 'ticker', 'dir', 't0', 'sod0', 'prem', 'option_chain', 'dte',
             'has_sweep', 'underlying_price', 'alert_px', 'strike', 'expiry']]
    return _finish(df, 'F1')


def build_f3():
    rows = []
    for f in sorted(glob.glob(f'{DATA}/uw/dp/*.jsonl.gz')):
        rows += read_jsonl_gz(f)
    a = pd.DataFrame(rows)
    a = a.drop_duplicates(['ticker', 'tracking_id', 'executed_at', 'size', 'price'])
    for c in ['price', 'premium', 'nbbo_bid', 'nbbo_ask']:
        a[c] = pd.to_numeric(a[c], errors='coerce')
    clean = ((a['canceled'] != True) & a['sale_cond_codes'].isna() & a['ext_hour_sold_codes'].isna()  # noqa: E712
             & (a['trade_settlement'].isna() | (a['trade_settlement'] == 'regular'))
             & (a['trade_code'].isna() | (a['trade_code'] == 'intermarket_sweep'))
             & (a['nbbo_bid'] < a['nbbo_ask']))  # PREREG amendment A1
    a = a[clean].copy()
    a['dir'] = np.where(a['price'] >= a['nbbo_ask'], 1, np.where(a['price'] <= a['nbbo_bid'], -1, 0))
    print('F3 raw prints', len(rows), 'clean', len(a), 'signed', int((a['dir'] != 0).sum()))
    a = a[a['dir'] != 0]
    utc, _ = _et(a['executed_at'])
    utc = utc + pd.Timedelta(seconds=10)
    et = utc.dt.tz_convert(et_tz())
    a['t0'] = utc.astype('int64') / 1e9
    a['session_date'] = et.dt.date
    a['session'] = a['session_date']
    a['sod0'] = et.dt.hour * 3600 + et.dt.minute * 60 + et.dt.second
    v1 = a[a['premium'] >= 5_000_000].assign(variant='F3-D1')
    v2 = a[a['premium'] >= 20_000_000].assign(variant='F3-D2')
    df = pd.concat([v1, v2]).rename(columns={'premium': 'prem'})
    df = df[['variant', 'session', 'session_date', 'ticker', 'dir', 't0', 'sod0', 'prem', 'price', 'nbbo_bid',
             'nbbo_ask', 'size']]
    return _finish(df, 'F3')


if __name__ == '__main__':
    {'F1': build_f1, 'F3': build_f3}[sys.argv[1]]()
