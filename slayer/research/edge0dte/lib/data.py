"""Loaders (read-only). New EDGE0DTE caches first, then the earlier EDGE caches (v2data/edge, never modified).

bars(root_or_sym, day)  1-minute bars of the session, columns m, o, h, l, c [, v, n]; zero/invalid rows dropped (OBS)
chain(root, day)        same-day-expiry 1-minute NBBO board: m, k, r(1=call), bid, ask, bs, as (OBS)
oi(root, day, max_dte)  OI published for day: e (days to expiry), k, r, oi (OBS); None when missing
vix(day, sym)           VIX or VIX1D 1-minute bars (OBS)
All loaders return the whole session; slicing to "data <= t" is done by the board/feature functions, and the leakage
tests prove that slicing.
"""
import functools
import os

import numpy as np
import pandas as pd

from .config import DATA, OLD, UNDER


def _sym(x):
    return UNDER.get(x, x)


@functools.lru_cache(maxsize=96)
def bars_month(sym, month):
    for base in (DATA, OLD):
        f = os.path.join(base, 'bars', sym, f'{month}.parquet')
        if os.path.exists(f):
            b = pd.read_parquet(f)
            if len(b):
                b = b[(b.o > 0) & (b.h > 0) & (b.l > 0) & (b.c > 0) & (b.h >= b.l)]
                return b
            if base == DATA:
                continue                     # empty new file: fall back to the older cache
            return b
    return pd.DataFrame(columns=['d', 'm', 'o', 'h', 'l', 'c'])


def bars(x, day):
    b = bars_month(_sym(x), day[:7])
    if not len(b):
        return b.drop(columns=['d'], errors='ignore')
    return b[b.d == day].drop(columns=['d']).sort_values('m').drop_duplicates('m').reset_index(drop=True)


def vix(day, sym='VIX'):
    return bars(sym, day)


@functools.lru_cache(maxsize=24)
def _chain(root, day):
    for base in (DATA, OLD):
        f = os.path.join(base, 'chain', root, f'{day}.parquet')
        if os.path.exists(f):
            c = pd.read_parquet(f)
            if len(c):
                return c.sort_values(['m', 'k', 'r']).reset_index(drop=True)
            return None
    return None


def chain(root, day):
    return _chain(root, day)


@functools.lru_cache(maxsize=24)
def _oi(root, day):
    for base in (DATA, OLD):
        f = os.path.join(base, 'oi', root, f'{day}.parquet')
        if os.path.exists(f):
            o = pd.read_parquet(f)
            return o if len(o) else None
    return None


def oi(root, day, max_dte=0):
    o = _oi(root, day)
    if o is None:
        return None
    return o[o.e <= max_dte]


@functools.lru_cache(maxsize=8)
def daily_closes(x):
    """Last 1-minute close of every session in the bar caches (used only for prior-session statistics)."""
    sym = _sym(x)
    parts = []
    for base in (DATA, OLD):
        d = os.path.join(base, 'bars', sym)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                b = pd.read_parquet(os.path.join(d, f))
                if len(b):
                    parts.append(b[['d', 'm', 'c']])
    if not parts:
        return pd.Series(dtype=float)
    b = pd.concat(parts)
    b = b[b.c > 0].sort_values(['d', 'm']).drop_duplicates(['d', 'm'])
    return b.groupby('d')['c'].last()


def have_day(root, day):
    """(bars, board, oi) availability flags for a root-session."""
    return (len(bars(root, day)) > 0, chain(root, day) is not None, _oi(root, day) is not None)
