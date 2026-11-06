"""NOV5-BROAD loaders (read-only): one (day, root) at a time, the same conventions as nov5-tape/load.py.

Roots: SPXW reads nov5-tape (2026-11-04/05) or nov5-broad/<D>/SPXW + IDX; every other root reads nov5-broad/<D>/<ROOT>.
Underlying: SPX index 1 s for SPXW; the stock's 1-second NBBO mid for the others. Bars: 1-minute, bar m = prints in
[m, m+1) minutes (EDGE convention), 09:30..15:59.
"""
import glob, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape'))
import load as L5  # noqa: E402

DATA = '/home/user/falcon-cloud-field-sail/v2data'
OUT = os.path.join(DATA, 'nov5-broad')
TAPE = os.path.join(DATA, 'nov5-tape')
ETF = ('SPY', 'QQQ', 'IWM', 'SPXW')
NAMES = ('NVDA', 'TSLA', 'AAPL', 'AMZN', 'META')
YEAR_MIN = 390.0 * 252
RTH0, RTH1 = 9 * 3600 + 30 * 60, 16 * 3600
clock, hm = L5.clock, L5.hm


def rdir(D, root):
    return os.path.join(OUT, D, root)


def spxw_tape(D):
    return root_is_tape(D, 'SPXW')


def root_is_tape(D, root):
    return root == 'SPXW' and os.path.exists(os.path.join(TAPE, D, f'g1m_{D}_greeks.parquet'))


def expiries(D, root):
    if root_is_tape(D, root):
        ex = sorted(f[4:12] for f in os.listdir(os.path.join(TAPE, D)) if f.startswith('g1m_') and f.endswith('_greeks.parquet'))
        return ex
    return sorted(f[4:12] for f in os.listdir(rdir(D, root)) if f.startswith('g1m_') and f.endswith('.parquet'))


def und_1s(D, root):
    """(seconds, price) of the underlying: SPX index prints for SPXW, stock NBBO mid otherwise (sane quotes only)."""
    if root == 'SPXW':
        f = os.path.join(TAPE, D, 'idx_SPX_1s.parquet')
        if not os.path.exists(f):
            f = os.path.join(OUT, D, 'IDX', 'idx_SPX_1s.parquet')
        s = pd.read_parquet(f)
        s = s[s.px > 0]
        return (s.ms.values // 1000).astype(np.int64), s.px.values.astype(float)
    u = pd.read_parquet(os.path.join(rdir(D, root), 'und_1s.parquet'))
    ok = (u.bid > 0) & (u.ask >= u.bid) & ((u.ask - u.bid) <= 0.01 * u.ask)
    u = u[ok]
    return (u.ms.values // 1000).astype(np.int64), ((u.bid + u.ask) / 2).values.astype(float)


def bars(D, root):
    s, p = und_1s(D, root)
    df = pd.DataFrame({'m': s // 60, 'px': p})
    b = df.groupby('m').px.agg(o='first', h='max', l='min', c='last').reset_index()
    return b[(b.m >= 570) & (b.m <= 959)].reset_index(drop=True)


def chain(D, root, exp=None):
    """1-minute board: m, k, r (1 call), bid, ask, delta, iv, und, vega, theta (quote in force at the minute stamp)."""
    exp = exp or expiries(D, root)[0]
    if root_is_tape(D, root):
        return L5.chain(D, exp)
    c = pd.read_parquet(os.path.join(rdir(D, root), f'g1m_{exp}.parquet'))
    return c.sort_values(['k', 'r', 'm']).reset_index(drop=True)


def ohlc(D, root, exp=None):
    exp = exp or expiries(D, root)[0]
    if root_is_tape(D, root):
        return L5.ohlc(D, exp)
    return pd.read_parquet(os.path.join(rdir(D, root), f'ohlc_{exp}.parquet')).sort_values(['k', 'r', 'm']).reset_index(drop=True)


def oi(D, root):
    if root_is_tape(D, root):
        return L5.oi(D)
    return pd.read_parquet(os.path.join(rdir(D, root), 'oi_all.parquet'))


def q1s(D, root, k, r, exp=None):
    exp = exp or expiries(D, root)[0]
    if root_is_tape(D, root):
        return L5.q1s(D, k, r)
    f = os.path.join(rdir(D, root), f'q1s_{exp}', f'{k:g}{"C" if r == 1 else "P"}.npz')
    if not os.path.exists(f):
        return None
    z = np.load(f)
    if 's' not in z.files or not len(z['s']):
        return None
    return {x: z[x] for x in z.files}


def trades(D, root, exp=None):
    exp = exp or expiries(D, root)[0]
    if root_is_tape(D, root):
        return L5.trades(D)
    f = os.path.join(rdir(D, root), f'trades_{exp}.parquet')
    return pd.read_parquet(f) if os.path.exists(f) else None


def sessions_to_expiry(D, exp):
    """Whole trading sessions between D's close and the expiry's close (weekends skipped; no holidays in Nov 4-13 2026)."""
    d0, d1 = pd.Timestamp(D), pd.Timestamp(exp)
    return int(np.busday_count(d0.date(), d1.date()))


def vix(D, sym='VIX'):
    for f in (os.path.join(TAPE, D, f'idx_{sym}_1s.parquet'), os.path.join(OUT, D, 'IDX', f'idx_{sym}_1s.parquet'),
              os.path.join(TAPE, D, f'idx_{sym}_1m.parquet'), os.path.join(OUT, D, 'IDX', f'idx_{sym}_1m.parquet')):
        if os.path.exists(f):
            s = pd.read_parquet(f)
            s = s[s.px > 0]
            return (s.ms.values // 1000).astype(np.int64), s.px.values.astype(float)
    return None


flow, news, compass_rows = L5.flow, L5.news, L5.compass_rows
