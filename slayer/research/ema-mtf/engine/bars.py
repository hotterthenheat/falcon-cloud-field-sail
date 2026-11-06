"""Bulk timeframe bars + EMA states for EVERY stored contract of a root (the vectorised form of engine/chart.py,
same definitions; `etests/test_bars.py` checks equality with ContractChart).

    mb = mid_bars(panel, days, tf=5)      # exp strike right session b known_ms c ema5..ema200 seen5..seen200
    tb = trade_bars(panel, days, tf=5)    # + o h l v n

MID close of a tf bar = the NBBO mid of the snapshot at the bar's END (no bar if that quote is one-sided/crossed).
1/5-minute MID bars use only sessions stored at 1-minute resolution for that expiration (coarse sessions, a prefix of
each expiration's stored life, feed 15/30/60 only).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.ema import EMA_LENGTHS, ema_fast

M0 = 9 * 60 + 30
KEY = ['exp', 'strike', 'right']


def _bar_end_rows(m: np.ndarray, tf: int) -> np.ndarray:
    return ((m + 1) % tf == 0) | (m == 389)


def add_emas(df: pd.DataFrame, lengths=EMA_LENGTHS, col: str = 'c') -> pd.DataFrame:
    """df sorted by contract, session, b; EMAs per contract (continuous across sessions)."""
    if not len(df):
        return df
    k = df[KEY].to_numpy()
    brk = np.r_[0, np.flatnonzero((k[1:] != k[:-1]).any(1)) + 1, len(df)]
    x = df[col].to_numpy(float)
    for n in lengths:
        e = np.full(len(df), np.nan)
        s = np.zeros(len(df), np.int64)
        for a, b in zip(brk[:-1], brk[1:]):
            e[a:b], s[a:b] = ema_fast(x[a:b], n)
        df[f'ema{n}'] = e
        df[f'seen{n}'] = s
    return df


def mid_bars(panel, days, tf: int, lengths=EMA_LENGTHS, exps=None) -> pd.DataFrame:
    parts = []
    for D in days:
        q = panel.q0(D)
        if not len(q):
            continue
        if exps is not None:
            q = q[q.exp.isin(exps)]
        m = q.m.to_numpy()
        keep = _bar_end_rows(m, tf) & (q.bid.to_numpy() > 0) & (q.ask.to_numpy() >= q.bid.to_numpy())
        if tf < 15:
            fine = [int(e) for e, t in panel.manifest(D)['tiers'].items() if t != 'coarse']
            keep &= q.exp.isin(fine).to_numpy()
        x = q[keep]
        parts.append(pd.DataFrame({'exp': x.exp.to_numpy(), 'strike': x.strike.to_numpy(), 'right': x.right.to_numpy(),
                                   'session': int(D), 'b': (x.m.to_numpy() // tf).astype(np.int16),
                                   'c': (x.bid.to_numpy() + x.ask.to_numpy()) / 200.0}))
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True)
    if tf < 15:
        # 1/5-minute bars start at each contract's first 1-minute session (drop anything earlier: none by construction)
        pass
    df = df.sort_values(KEY + ['session', 'b'], kind='stable').reset_index(drop=True)
    df['known_ms'] = ((M0 + np.minimum((df.b.to_numpy().astype(np.int64) + 1) * tf, 390)) * 60_000).astype(np.int64)
    return add_emas(df, lengths)


def trade_bars(panel, days, tf: int, lengths=EMA_LENGTHS, exps=None) -> pd.DataFrame:
    parts = []
    for D in days:
        t = panel.tb(D)
        if not len(t):
            continue
        if exps is not None:
            t = t[t.exp.isin(exps)]
        t = t[t.c >= 0]
        parts.append(t.assign(session=int(D), b=(t.m.to_numpy() // tf).astype(np.int16)))
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True).sort_values(KEY + ['session', 'm'], kind='stable')
    g = df.groupby(KEY + ['session', 'b'], sort=True)
    out = g.agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), v=('v', 'sum'), n=('n', 'sum')).reset_index()
    for c in ('o', 'h', 'l', 'c'):
        out[c] = out[c] / 100.0
    out['known_ms'] = ((M0 + np.minimum((out.b.to_numpy().astype(np.int64) + 1) * tf, 390)) * 60_000).astype(np.int64)
    return add_emas(out, lengths)


def asof_index(bars: pd.DataFrame):
    """Per-contract searchable keys: {(exp, strike, right): (keys ndarray, row offsets)} for as-of lookups."""
    out = {}
    if not len(bars):
        return out
    k = bars[KEY].to_numpy()
    brk = np.r_[0, np.flatnonzero((k[1:] != k[:-1]).any(1)) + 1, len(bars)]
    key = bars.session.to_numpy(np.int64) * 100_000_000 + bars.known_ms.to_numpy(np.int64)
    for a, b in zip(brk[:-1], brk[1:]):
        out[tuple(int(v) for v in k[a])] = (key[a:b], a)
    return out


def asof_row(bars, idx, contract, session: int, ms: int):
    """Row index of the last bar of `contract` known at (session, ms), or None."""
    e = idx.get(contract)
    if e is None:
        return None
    keys, off = e
    i = int(np.searchsorted(keys, int(session) * 100_000_000 + int(ms), side='right')) - 1
    return None if i < 0 else off + i
