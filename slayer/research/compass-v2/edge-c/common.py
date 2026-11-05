"""EDGE-C shared helpers: splits (locked days filtered BEFORE any file is opened), the challenger's raw 1-minute chain
cache (read-only), EDGE's bar/chain/OI caches (read-only), Black-Scholes, the parity spot, the ThetaData client
(1 request in flight across EDGE-C processes; never started/killed here), 1-second quote cache.

Keys are never read here (no UW use). Data written only under /home/user/falcon-cloud-field-sail/v2data/edge-c/.
"""
from __future__ import annotations

import fcntl
import io
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('EDGEC_DATA', '/home/user/falcon-cloud-field-sail/v2data/edge-c')
CHAL = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger/data'
EDGE = '/home/user/falcon-cloud-field-sail/v2data/edge'
FOUNDATION = '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2'
THETA = 'http://127.0.0.1:25503/v3'
R = 0.042
FEE = 0.65
os.makedirs(DATA, exist_ok=True)

# ---------------------------------------------------------------- splits (V2_PROTOCOL 6)
H1 = [('2022-06-01', '2022-06-30'), ('2024-08-01', '2024-08-31'), ('2026-10-05', '2026-10-30')]
H2 = [('2022-07-01', '2022-09-30'), ('2025-01-01', '2025-03-31')]


def is_locked(d: str) -> bool:
    d = f'{d[:4]}-{d[4:6]}-{d[6:8]}' if '-' not in d else d
    return any(a <= d <= b for a, b in H1 + H2) or d >= '2026-07-01'


def split_of(d: str) -> str:
    d = f'{d[:4]}-{d[4:6]}-{d[6:8]}' if '-' not in d else d
    if is_locked(d):
        return 'LOCKED'
    if d < '2025-01-01':
        return 'DEV'
    if d <= '2025-12-31':
        return 'VAL'
    return 'UNASSIGNED'


def raw_days(split: str, root: str = 'SPXW') -> list[str]:
    """Sessions (YYYY-MM-DD) in the challenger's raw cache with this root's chain, in the split. Locked days are
    excluded by name before anything is opened."""
    out = []
    for d8 in sorted(os.listdir(os.path.join(CHAL, 'raw'))):
        if not d8.isdigit() or len(d8) != 8:
            continue
        d = f'{d8[:4]}-{d8[4:6]}-{d8[6:]}'
        if split_of(d) != split:
            continue
        p = os.path.join(CHAL, 'raw', d8)
        if os.path.exists(os.path.join(p, '_done.json')) and os.path.exists(os.path.join(p, f'{root}_{d8}.csv.gz')):
            out.append(d)
    return out


# ---------------------------------------------------------------- expirations
_EXP = {}


def expirations(root: str) -> list[str]:
    if root not in _EXP:
        f = os.path.join(DATA, f'exp_{root}.json')
        if os.path.exists(f):
            _EXP[root] = json.load(open(f))
        else:
            df = theta_csv('/option/list/expirations', {'symbol': root})
            _EXP[root] = sorted(df.expiration.astype(str).str[:10].tolist())
            json.dump(_EXP[root], open(f, 'w'))
    return _EXP[root]


def two_expiries(root: str, d: str) -> list[str]:
    ex = [e for e in expirations(root) if e >= d]
    return ex[:2]


# ---------------------------------------------------------------- raw chain (challenger cache, read-only)
def load_raw_chain(root: str, session: str, expiry: str) -> pd.DataFrame | None:
    """The challenger's one-minute chain NBBO for (root, expiry) on the session's calendar days (D-1 20:15 .. D 17:00).
    Columns: t (minutes since D 00:00, negative for the evening before), k, r (1 call / 0 put), bid, ask, bs, as."""
    d8 = session.replace('-', '')
    f = os.path.join(CHAL, 'raw', d8, f'{root}_{expiry.replace("-", "")}.csv.gz')
    if not os.path.exists(f):
        return None
    df = pd.read_csv(f, compression='gzip', header=None, names=['ts', 'k', 'r', 'bid', 'ask', 'bs', 'as'],
                     dtype={'ts': str, 'k': float, 'r': str, 'bid': float, 'ask': float, 'bs': float, 'as': float})
    return _norm_chain(df, session)


def _norm_chain(df, session):
    ts = pd.to_datetime(df['ts'], format='%Y-%m-%d %H:%M', errors='coerce')
    d0 = pd.Timestamp(session)
    t = ((ts - d0).dt.total_seconds() // 60).astype('int32')
    out = pd.DataFrame({'t': t, 'k': df['k'].astype('float32'), 'r': (df['r'].str.upper().str[0] == 'C').astype('int8'),
                        'bid': df['bid'].astype('float32'), 'ask': df['ask'].astype('float32'),
                        'bs': df['bs'].fillna(0).astype('int32'), 'as': df['as'].fillna(0).astype('int32')})
    return out[ts.notna()].sort_values(['t', 'k', 'r']).reset_index(drop=True)


def load_fetched_chain(root: str, session: str, expiry: str) -> pd.DataFrame | None:
    """EDGE-C's own fetched overnight chain (XSP, VAL SPXW): same schema as load_raw_chain."""
    f = os.path.join(DATA, 'chain', root, f'{session}_{expiry}.parquet')
    return pd.read_parquet(f) if os.path.exists(f) else None


def load_chain(root, session, expiry):
    x = load_raw_chain(root, session, expiry)
    return x if x is not None else load_fetched_chain(root, session, expiry)


# ---------------------------------------------------------------- EDGE caches (read-only)
_BARS = {}


def bars_month(sym: str, month: str) -> pd.DataFrame:
    k = (sym, month)
    if k not in _BARS:
        f = os.path.join(EDGE, 'bars', sym, f'{month}.parquet')
        _BARS[k] = pd.read_parquet(f) if os.path.exists(f) else pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c'])
    return _BARS[k]


def prior_close(sym: str, session: str) -> tuple[str, float]:
    """(prior session day, its 15:59 one-minute close) from EDGE's bars (a prior session only; up to 2 months back)."""
    months = sorted({(pd.Timestamp(session) - pd.offsets.MonthBegin(n)).strftime('%Y-%m') for n in (0, 1, 2)} | {session[:7]})
    b = pd.concat([bars_month(sym, m) for m in months], ignore_index=True)
    b = b[(b.d < session) & (b.m <= 959) & (b.c > 0)]
    if not len(b):
        return '', float('nan')
    b = b.sort_values(['d', 'm'])
    last = b.iloc[-1]
    return str(last.d), float(last.c)


def day_bars(sym: str, session: str) -> pd.DataFrame:
    b = bars_month(sym, session[:7])
    return b[(b.d == session) & (b.c > 0)].sort_values('m').reset_index(drop=True)


# ---------------------------------------------------------------- Black-Scholes
def _ncdf(x):
    return 0.5 * (1 + np.vectorize(math.erf)(np.asarray(x, float) / math.sqrt(2)))


def bs_price(S, K, T, v, call):
    S, K, T, v = (np.asarray(a, float) for a in (S, K, T, v))
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + (R + 0.5 * v * v) * np.maximum(T, 1e-9)) / sq
    d2 = d1 - sq
    disc = np.exp(-R * np.maximum(T, 1e-9))
    c = S * _ncdf(d1) - K * disc * _ncdf(d2)
    return np.where(call, c, c - S + K * disc)


def bs_delta(S, K, T, v, call):
    T = np.maximum(np.asarray(T, float), 1e-9)
    sq = np.asarray(v, float) * np.sqrt(T)
    d1 = (np.log(np.asarray(S, float) / np.asarray(K, float)) + (R + 0.5 * np.asarray(v, float) ** 2) * T) / sq
    n = _ncdf(d1)
    return np.where(call, n, n - 1)


def bs_gamma(S, K, T, v):
    T = np.maximum(np.asarray(T, float), 1e-9)
    sq = np.asarray(v, float) * np.sqrt(T)
    d1 = (np.log(np.asarray(S, float) / np.asarray(K, float)) + (R + 0.5 * np.asarray(v, float) ** 2) * T) / sq
    return np.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi) / (np.asarray(S, float) * sq)


def implied_vol(price, S, K, T, call, lo=0.01, hi=6.0, it=50):
    price, K = np.asarray(price, float), np.asarray(K, float)
    call = np.asarray(call, bool)
    a = np.full(price.shape, lo)
    b = np.full(price.shape, hi)
    for _ in range(it):
        m = 0.5 * (a + b)
        up = bs_price(S, K, T, m, call) > price
        b = np.where(up, m, b)
        a = np.where(up, a, m)
    v = 0.5 * (a + b)
    disc = math.exp(-R * max(float(np.max(T)) if np.ndim(T) else float(T), 1e-9))
    intrinsic = np.where(call, np.maximum(S - K * disc, 0), np.maximum(K * disc - S, 0))
    return np.where((price > intrinsic + 1e-4) & (v < hi - 1e-3), v, np.nan)


def parity_spot(board: pd.DataFrame, T: float) -> float:
    """The challenger's paritySpot: K + (C - P) e^{rT}, the median over the 3 strikes with the smallest |C - P|."""
    b = board[(board.bid > 0) & (board.ask >= board.bid)]
    if not len(b):
        return float('nan')
    mid = (b.bid.values + b.ask.values) / 2
    c = pd.Series(np.where(b.r.values == 1, mid, np.nan), index=b.k.values).dropna().groupby(level=0).first()
    p = pd.Series(np.where(b.r.values == 0, mid, np.nan), index=b.k.values).dropna().groupby(level=0).first()
    j = c.index.intersection(p.index)
    if not len(j):
        return float('nan')
    gap = (c[j] - p[j]).abs().sort_values()
    ks = gap.index[:3]
    f = ks.values + (c[ks].values - p[ks].values) * math.exp(R * T)
    return float(np.median(f))


def years_to_expiry(expiry: str, session: str, t_min: int) -> float:
    """Calendar years from (session 00:00 + t_min minutes) to the expiry's 16:00 ET."""
    at = pd.Timestamp(session) + pd.Timedelta(minutes=int(t_min))
    ex = pd.Timestamp(expiry) + pd.Timedelta(hours=16)
    return max((ex - at).total_seconds() / (365 * 86400), 1 / (365 * 1440))


# ---------------------------------------------------------------- terminal client (1 in flight across processes)
_slot = threading.BoundedSemaphore(1)
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class NoData(Exception):
    pass


class _xlock:
    def __enter__(self):
        self.f = open(os.path.join(DATA, '.theta.lock'), 'w')
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


def theta_get(path: str, params: dict, timeout=600, retries=4) -> bytes:
    q = dict(params)
    q.setdefault('format', 'csv')
    url = f'{THETA}{path}?{urllib.parse.urlencode(q)}'
    last = None
    for a in range(retries):
        with _slot, _xlock():
            try:
                with _opener.open(url, timeout=timeout) as r:
                    body = r.read()
                time.sleep(0.15)
                if not body.strip():
                    raise NoData(url)
                return body
            except urllib.error.HTTPError as e:
                b = e.read()[:300].decode('utf8', 'replace')
                if e.code == 472 or 'no data' in b.lower():
                    raise NoData(url) from None
                last = f'{e.code} {b}'
                if e.code in (400, 404, 471):
                    raise RuntimeError(f'{url}: {last}') from None
            except NoData:
                raise
            except Exception as e:  # noqa: BLE001
                last = repr(e)
        time.sleep(3 * (a + 1))
    raise RuntimeError(f'theta failed {url}: {last}')


def theta_csv(path, params, **kw) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(theta_get(path, params, **kw)))


def fetch_chain(root: str, session: str, expiry: str, start='00:00:00', end='09:30:00', strike_range=16,
                date: str | None = None) -> pd.DataFrame:
    """One-minute chain NBBO on a calendar date (default the session), cached under DATA/chain/<root>/."""
    out = os.path.join(DATA, 'chain', root, f'{session}_{expiry}.parquet')
    if os.path.exists(out):
        return pd.read_parquet(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    date = (date or session).replace('-', '')
    try:
        df = theta_csv('/option/history/quote', {'symbol': root, 'expiration': expiry.replace('-', ''), 'date': date,
                                                 'interval': '1m', 'strike_range': strike_range,
                                                 'start_time': start, 'end_time': end})
        ts = pd.to_datetime(df['timestamp'])
        d0 = pd.Timestamp(session)
        o = pd.DataFrame({'t': ((ts - d0).dt.total_seconds() // 60).astype('int32'), 'k': df['strike'].astype('float32'),
                          'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                          'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
        o = o[(o.bid > 0) | (o.ask > 0)].sort_values(['t', 'k', 'r']).reset_index(drop=True)
    except NoData:
        o = pd.DataFrame({'t': np.zeros(0, 'int32'), 'k': np.zeros(0, 'float32'), 'r': np.zeros(0, 'int8'),
                          'bid': np.zeros(0, 'float32'), 'ask': np.zeros(0, 'float32'), 'bs': np.zeros(0, 'int32'), 'as': np.zeros(0, 'int32')})
    o.to_parquet(out, compression='zstd')
    return o


def fetch_stock_quotes_1m(sym: str, session: str, start='04:00:00', end='09:30:00') -> pd.DataFrame:
    out = os.path.join(DATA, 'stk1m', sym, f'{session}.parquet')
    if os.path.exists(out):
        return pd.read_parquet(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    try:
        df = theta_csv('/stock/history/quote', {'symbol': sym, 'date': session.replace('-', ''), 'interval': '1m',
                                                'start_time': start, 'end_time': end})
        ts = pd.to_datetime(df['timestamp'])
        o = pd.DataFrame({'t': (ts.dt.hour * 60 + ts.dt.minute).astype('int32'), 'bid': df['bid'].astype('float32'),
                          'ask': df['ask'].astype('float32')})
        o = o[(o.bid > 0) & (o.ask > 0)].reset_index(drop=True)
    except NoData:
        o = pd.DataFrame({'t': np.zeros(0, 'int32'), 'bid': np.zeros(0, 'float32'), 'ask': np.zeros(0, 'float32')})
    o.to_parquet(out, compression='zstd')
    return o


def fetch_1s(root: str, session: str, expiry: str, strike: float, call: bool, start='00:00:00', end='09:30:00') -> pd.DataFrame:
    """1-second NBBO of one contract (state changes only), in the FOUNDATION store's units (cents, ms of the session
    day; the evening before is negative ms). Cached under DATA/q1s/."""
    tag = f'{session}_{expiry}_{strike:g}{"C" if call else "P"}_{start[:5].replace(":", "")}-{end[:5].replace(":", "")}'
    out = os.path.join(DATA, 'q1s', root, f'{tag}.parquet')
    if os.path.exists(out):
        return pd.read_parquet(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    date = session
    if start > end:                       # an evening window: the calendar day before the session
        date = (pd.Timestamp(session) - pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    try:
        df = theta_csv('/option/history/quote', {'symbol': root, 'expiration': expiry.replace('-', ''), 'strike': f'{strike:g}',
                                                 'right': 'call' if call else 'put', 'date': date.replace('-', ''),
                                                 'interval': '1s', 'start_time': start, 'end_time': end if start <= end else '23:59:59'})
        ts = pd.to_datetime(df['timestamp'])
        d0 = pd.Timestamp(session)
        ms = ((ts - d0).dt.total_seconds() * 1000).round().astype('int64')
        o = pd.DataFrame({'ms': ms, 'bid': np.round(df['bid'].to_numpy(float) * 100).astype('int32'),
                          'ask': np.round(df['ask'].to_numpy(float) * 100).astype('int32'),
                          'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
        v = o[['bid', 'ask', 'bs', 'as']].to_numpy()
        ch = np.r_[True, (v[1:] != v[:-1]).any(1)]
        o = o[ch].reset_index(drop=True)
    except NoData:
        o = pd.DataFrame({'ms': np.zeros(0, 'int64'), 'bid': np.zeros(0, 'int32'), 'ask': np.zeros(0, 'int32'),
                          'bs': np.zeros(0, 'int32'), 'as': np.zeros(0, 'int32')})
    o.to_parquet(out, compression='zstd')
    return o


# ---------------------------------------------------------------- statistics
def cluster_ci(values, clusters, n_boot=4000, seed=7):
    import sys
    if FOUNDATION not in sys.path:
        sys.path.insert(0, FOUNDATION)
    from eval.metrics import cluster_ci_mean
    v = np.asarray(values, float)
    if not len(v):
        return float('nan'), float('nan'), float('nan')
    lo, hi = cluster_ci_mean(v, clusters, n_boot, seed=seed)
    return float(v.mean()), lo, hi


def fmt_ci(m, lo, hi, pct=True):
    if pct:
        return f'{100*m:+.1f}% [{100*lo:+.1f}, {100*hi:+.1f}]'
    return f'{m:+.4g} [{lo:+.4g}, {hi:+.4g}]'


def ret_fee(fill, exit_px):
    return (100 * exit_px - FEE) / (100 * fill + FEE) - 1


def data_mb() -> float:
    tot = 0
    for root, _, files in os.walk(DATA):
        tot += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    return tot / 1e6
