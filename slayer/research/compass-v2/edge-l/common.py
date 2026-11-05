"""EDGE-L shared pieces: data loading (read-only caches), point-in-time guards, Black-Scholes, 1-s quote fetch.

Point-in-time rule: every bar/quote/book read for a decision at second T must be stamped strictly before T.
`Clock` enforces it: reads go through `bars_before(T)` / `snap_before(T)`; asking for anything stamped >= T raises
LookAhead. Run `python3 -m edge-l.common` style checks via tests.py.
"""
from __future__ import annotations

import io
import json
import math
import os
import time
import urllib.error
import urllib.request

import numpy as np
import pandas as pd
from scipy.special import ndtr

EDGE = '/home/user/falcon-cloud-field-sail/v2data/edge'
OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-l'
PHYS = '/home/user/falcon-cloud-field-sail/slayer/research/physics/results'
BASE = 'http://127.0.0.1:25503/v3'
UND = {'SPY': 'SPY', 'QQQ': 'QQQ', 'SPXW': 'SPX'}
BOOK = {'SPY': 'SPY', 'QQQ': 'QQQ', 'SPXW': 'SPY'}   # SPXW uses SPY's book (stated proxy)
LAT = 2
FEE = 0.65


class LookAhead(Exception):
    pass


def split_of(d):
    d = d.replace('-', '')
    H1 = [('20220601', '20220630'), ('20240801', '20240830'), ('20261005', '20261030')]
    H2 = [('20220701', '20220930'), ('20250102', '20250331')]
    if any(a <= d <= b for a, b in H1 + H2) or d >= '20260701':
        return 'LOCKED'
    if d < '20250101':
        return 'DEV'
    if d <= '20251231':
        return 'VALIDATION'
    return 'UNASSIGNED'


# ------------------------------------------------------------------ bars
_BARS = {}


def bars(sym):
    """dict day -> DataFrame(m, o, h, l, c) for 570 <= m <= 959 (bar m covers [m, m+1) minutes)."""
    if sym in _BARS:
        return _BARS[sym]
    d = os.path.join(EDGE, 'bars', sym)
    df = pd.concat([pd.read_parquet(os.path.join(d, f)) for f in sorted(os.listdir(d))])
    df['m'] = df.m.astype(np.int64)
    df = df[(df.m >= 570) & (df.m <= 959) & (df.o > 0) & (df.c > 0) & np.isfinite(df.o) & np.isfinite(df.c)]
    out = {k: g.sort_values('m').reset_index(drop=True) for k, g in df.groupby('d')}
    _BARS[sym] = out
    return out


class Clock:
    """Point-in-time view of one session for one decision second T (seconds since midnight ET)."""

    def __init__(self, b: pd.DataFrame, chain: pd.DataFrame | None, T: int):
        self.T = T
        self._b = b
        self._c = chain

    def bars_before(self, T=None):
        T = self.T if T is None else T
        if T > self.T:
            raise LookAhead(f'bars asked for {T} > decision {self.T}')
        v = self._b[self._b.m * 60 + 60 <= T]          # closed: bar end <= T
        assert len(v) == 0 or v.m.iloc[-1] * 60 + 60 <= T
        return v

    def snap_before(self, T=None):
        """The chain snapshot stamped T-60 (the last minute row strictly before T)."""
        T = self.T if T is None else T
        if T > self.T:
            raise LookAhead(f'chain asked for {T} > decision {self.T}')
        m = (T - 1) // 60
        s = self._c[self._c.m == m]
        assert len(s) == 0 or (s.m.max() * 60 < T)
        return s

    def peek(self, T2):
        """Canary: anything stamped >= T must raise."""
        if T2 >= self.T:
            raise LookAhead(f'peek at {T2} >= {self.T}')


def chain(root, day):
    f = os.path.join(EDGE, 'chain', root, f'{day}.parquet')
    if not os.path.exists(f):
        return None
    c = pd.read_parquet(f)
    if not len(c):
        return None
    c['m'] = c.m.astype(np.int64)
    return c


# ------------------------------------------------------------------ gamma book (physics rows)
def book(sym):
    rows = json.load(open(os.path.join(PHYS, f'gravity_rows_{sym}.json')))
    day = [r['day'] for r in rows]
    net = np.array([r['net'] for r in rows])
    scale = np.array([np.median(np.abs(net[max(0, k - 60):k])) if k >= 20 else np.nan for k in range(len(net))])
    return {d: (n, (n / s) if np.isfinite(s) else np.nan) for d, n, s in zip(day, net, scale)}


# ------------------------------------------------------------------ Black-Scholes
def ncdf(x):
    return ndtr(np.asarray(x, float))


def bs(S, K, tau, v, call):
    S, K, tau, v = map(lambda a: np.asarray(a, float), (S, K, tau, v))
    sq = v * np.sqrt(tau)
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    d2 = d1 - sq
    c = S * ncdf(d1) - K * ncdf(d2)
    return np.where(call, c, c - S + K)


def bs_delta(S, K, tau, v, call):
    sq = v * np.sqrt(tau)
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    n = ncdf(d1)
    return np.where(call, n, n - 1)


def iv(price, S, K, tau, call):
    price, K = np.asarray(price, float), np.asarray(K, float)
    call = np.asarray(call, bool)
    lo, hi = np.full(price.shape, 1e-3), np.full(price.shape, 5.0)
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        p = bs(S, K, tau, mid, call)
        hi = np.where(p > price, mid, hi)
        lo = np.where(p > price, lo, mid)
    out = 0.5 * (lo + hi)
    intrinsic = np.where(call, np.maximum(S - K, 0), np.maximum(K - S, 0))
    return np.where(price > intrinsic + 1e-6, out, np.nan)


# ------------------------------------------------------------------ 1-second quotes (one request in flight)
def _clock(s):
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def q1s(root, day, k, call, start, end):
    ks = f'{k:.3f}'.rstrip('0').rstrip('.')
    f = os.path.join(OUT, 'q1s', root, day, f'{ks}{"C" if call else "P"}_{start}_{end}.npz')
    if os.path.exists(f):
        z = np.load(f)
        return {x: z[x] for x in z.files}
    # reuse EDGE's cache if it covers the window
    ed = os.path.join(EDGE, 'q1s', root, day)
    if os.path.isdir(ed):
        for g in os.listdir(ed):
            nm, a, b = g[:-4].split('_')
            if nm == f'{ks}{"C" if call else "P"}' and int(a) <= start and int(b) >= end:
                z = np.load(os.path.join(ed, g))
                o = {x: z[x] for x in z.files}
                m = (o['s'] >= start) & (o['s'] <= end)
                return {x: o[x][m] for x in o}
    y = day.replace('-', '')
    url = (f'{BASE}/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
           f'&start_date={y}&end_date={y}&interval=1s&start_time={_clock(start)}&end_time={_clock(end)}&format=csv')
    txt = None
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                txt = r.read().decode()
            break
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                txt = ''
                break
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(5 * (a + 1))
    if txt is None:
        return None
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not txt.strip() or not txt.startswith('symbol'):
        out = {x: np.zeros(0, np.int32) for x in ('s', 'bid', 'ask', 'bs', 'as')}
    else:
        df = pd.read_csv(io.StringIO(txt))
        ts = pd.to_datetime(df['timestamp'])
        out = {'s': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32),
               'bid': df['bid'].values.astype(np.float32), 'ask': df['ask'].values.astype(np.float32),
               'bs': df['bid_size'].values.astype(np.int32), 'as': df['ask_size'].values.astype(np.int32)}
    np.savez_compressed(f, **out)
    return out
