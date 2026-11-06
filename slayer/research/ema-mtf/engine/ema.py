"""Multi-timeframe EMA engine (specs/STRATEGY_SPEC.md sections 2-4).

Bars
  A bar is identified by its END time. 1-minute RTH bar m (m = 0..389) covers [09:30+m, 09:30+m+1) ET and ends at
  09:31+m. A k-minute bar (k in 5, 15, 30, 60) is the union of the 1-minute bars of one k-minute window aligned at
  09:30; the last 60-minute bar of a session is 15:30-16:00 (30 minutes). Sessions are concatenated in order: the
  EMA carries across the overnight gap (what a chart does), it never resets at the open.

Timing
  A bar's close is known at its end time E. Everything computed from it carries `known_ms = E`; a decision taken at E
  may use it, a decision at any t < E may not. A higher-timeframe value at a 1-minute decision time t is the value of
  the last HIGHER-timeframe bar with end <= t (the forming bar is never used: no repaint).

EMA
  alpha = 2 / (N + 1). Seed = simple mean of the first N valid closes; EMA defined from the N-th valid bar on (NaN
  before). `bars_seen` counts valid closes so far, so a warm-up rule (bars_seen >= W*N) is applied by the caller.
  Missing closes (NaN, e.g. an empty trade-print minute in the 'skip' series) are skipped: the EMA advances only on
  bars that exist, exactly as a charting app that prints no bar for an empty interval.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

EMA_LENGTHS = (5, 9, 15, 20, 21, 50, 100, 200)
TIMEFRAMES = (1, 5, 15, 30, 60)
RTH_OPEN_MIN = 9 * 60 + 30
RTH_MINUTES = 390
MS_MIN = 60_000


def ema(x: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """SMA-seeded EMA over the valid (non-NaN) entries of x; returns (ema, bars_seen). NaN entries keep the
    previous EMA value in the output (as-of) but do not advance it; bars_seen counts valid entries up to i."""
    x = np.asarray(x, float)
    out = np.full(len(x), np.nan)
    seen = np.cumsum(~np.isnan(x))
    a = 2.0 / (n + 1.0)
    cur = np.nan
    acc, k = 0.0, 0
    for i, v in enumerate(x):
        if v == v:  # not NaN
            if k < n:
                acc += v
                k += 1
                if k == n:
                    cur = acc / n
            else:
                cur = a * v + (1 - a) * cur
        out[i] = cur
    return out, seen


def ema_fast(x: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Same result as ema() (tests check equality), vectorised over the valid entries with a recursive filter."""
    x = np.asarray(x, float)
    ok = ~np.isnan(x)
    v = x[ok]
    seen = np.cumsum(ok)
    res = np.full(len(v), np.nan)
    if len(v) >= n:
        a = 2.0 / (n + 1.0)
        from scipy.signal import lfilter
        seed = v[:n].mean()
        tail = v[n:]
        if len(tail):
            y, _ = lfilter([a], [1, -(1 - a)], tail, zi=[(1 - a) * seed])
            res[n:] = y
        res[n - 1] = seed
    out = np.full(len(x), np.nan)
    idx = np.flatnonzero(ok)
    out[idx] = res
    # as-of fill: NaN inputs keep the previous EMA (positions before the seed stay NaN)
    if len(out):
        out = pd.Series(out).ffill().to_numpy(copy=True)
    return out, seen


def bar_index(minute_of_session: np.ndarray, tf: int) -> np.ndarray:
    """1-minute bar m (0..389) -> index of its tf-minute bar within the session."""
    return np.asarray(minute_of_session) // tf


def bars_per_session(tf: int) -> int:
    return -(-RTH_MINUTES // tf)


def end_minute(bar: np.ndarray, tf: int) -> np.ndarray:
    """Session minute (from 09:30) at which tf-bar `bar` ends (the 15:30 hour bar ends at 390 = 16:00)."""
    return np.minimum((np.asarray(bar) + 1) * tf, RTH_MINUTES)


def resample(df1: pd.DataFrame, tf: int, how: str = 'mid') -> pd.DataFrame:
    """1-minute bars -> tf-minute bars. df1 columns: session (int YYYYMMDD), m (0..389) and either
       'c' (close-only series, e.g. NBBO mid at bar end: the tf close is the close of the last 1-minute bar that has one)
       or o/h/l/c/v/n (trade prints; empty minutes absent or NaN -> the tf bar aggregates only existing minutes and is
       absent if all are empty). Output: session, b (bar index), end_m (session minute of its end), known_ms, o,h,l,c[,v,n]."""
    if not len(df1):
        return pd.DataFrame(columns=['session', 'b', 'end_m', 'known_ms', 'c'])
    d = df1[['session', 'm'] + [c for c in ('o', 'h', 'l', 'c', 'v', 'n') if c in df1]].copy()
    d = d[d.c.notna()]
    d['b'] = d.m.to_numpy().astype(np.int64) // tf
    g = d.groupby(['session', 'b'], sort=True)
    out = g.c.last().to_frame('c')
    if 'o' in d:
        out['o'] = g.o.first()
        out['h'] = g.h.max()
        out['l'] = g.l.min()
    if 'v' in d:
        out['v'] = g.v.sum()
    if 'n' in d:
        out['n'] = g.n.sum()
    out = out.reset_index()
    out['end_m'] = end_minute(out.b.to_numpy(), tf)
    out['known_ms'] = (RTH_OPEN_MIN + out.end_m.to_numpy()) * MS_MIN
    return out


def ema_table(bars: pd.DataFrame, lengths=EMA_LENGTHS, col: str = 'c') -> pd.DataFrame:
    """Add ema_N and seen_N columns (bars ordered by session, b). The series is continuous across sessions."""
    bars = bars.sort_values(['session', 'b']).reset_index(drop=True)
    x = bars[col].to_numpy(float)
    for n in lengths:
        e, s = ema_fast(x, n)
        bars[f'ema{n}'] = e
        bars[f'seen{n}'] = s
    return bars


def asof_htf(decision_session: np.ndarray, decision_ms: np.ndarray, htf: pd.DataFrame, cols) -> pd.DataFrame:
    """For each decision (session, ms of day), the row of `htf` (sorted by session, known_ms) with the latest
    (session, known_ms) <= (decision session, decision ms). Rows of earlier sessions qualify (overnight carry)."""
    key_h = htf.session.to_numpy(np.int64) * 100_000_000 + htf.known_ms.to_numpy(np.int64)
    key_d = np.asarray(decision_session, np.int64) * 100_000_000 + np.asarray(decision_ms, np.int64)
    order = np.argsort(key_h, kind='stable')
    key_h = key_h[order]
    i = np.searchsorted(key_h, key_d, side='right') - 1
    res = {}
    for c in cols:
        v = htf[c].to_numpy()[order]
        res[c] = np.where(i >= 0, v[np.clip(i, 0, None)], np.nan)
    res['htf_known_ms'] = np.where(i >= 0, htf.known_ms.to_numpy()[order][np.clip(i, 0, None)], -1)
    return pd.DataFrame(res)


class MTFState:
    """EMA states of one price series on every timeframe, queryable as of a decision time.

        st = MTFState(one_minute_df, series='mid')        # df: session, m, c (and o/h/l for trade series)
        st.at(session=20240305, ms=clock_ms, tf=15)       # dict ema5..ema200, seen5..seen200, c, known_ms
    """

    def __init__(self, df1: pd.DataFrame, lengths=EMA_LENGTHS, tfs=TIMEFRAMES):
        self.lengths = tuple(lengths)
        self.tables = {tf: ema_table(resample(df1, tf), self.lengths) for tf in tfs}
        self._keys = {}
        for tf, t in self.tables.items():
            self._keys[tf] = t.session.to_numpy(np.int64) * 100_000_000 + t.known_ms.to_numpy(np.int64)

    def at(self, session: int, ms: int, tf: int) -> dict | None:
        k = int(session) * 100_000_000 + int(ms)
        i = int(np.searchsorted(self._keys[tf], k, side='right')) - 1
        if i < 0:
            return None
        return self.tables[tf].iloc[i].to_dict()

    def warm(self, session: int, ms: int, tf: int, n: int, mult: float = 1.0) -> bool:
        r = self.at(session, ms, tf)
        return bool(r) and r[f'seen{n}'] >= mult * n
