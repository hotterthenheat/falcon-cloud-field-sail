"""Vectorised Black-Scholes (yield q, rate r) and an implied-vol solver. Greeks follow slayer/src/core/greeks.ts:
vega per 1 vol point, vanna = dDelta/dSigma (per 1.00 of vol), charm = -dDelta/dtau per year."""
from __future__ import annotations

import math

import numpy as np
from scipy.special import ndtr

SQ2PI = math.sqrt(2 * math.pi)
YEAR_MIN = 365 * 1440


def npdf(x):
    return np.exp(-0.5 * x * x) / SQ2PI


def d1d2(S, K, T, v, r=0.0, q=0.0):
    S, K, T, v = (np.asarray(a, float) for a in (S, K, T, v))
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + (r - q) * T + 0.5 * sq * sq) / sq
    return d1, d1 - sq, sq


def price(S, K, T, v, call, r=0.0, q=0.0):
    d1, d2, _ = d1d2(S, K, T, v, r, q)
    S, K, T = (np.asarray(a, float) for a in (S, K, T))
    dq, dr = np.exp(-q * T), np.exp(-r * T)
    c = S * dq * ndtr(d1) - K * dr * ndtr(d2)
    p = K * dr * ndtr(-d2) - S * dq * ndtr(-d1)
    return np.where(np.asarray(call, bool), c, p)


def greeks(S, K, T, v, call, r=0.0, q=0.0) -> dict:
    d1, d2, sq = d1d2(S, K, T, v, r, q)
    S, K, T, v = (np.asarray(a, float) for a in (S, K, T, v))
    call = np.asarray(call, bool)
    dq = np.exp(-q * T)
    n1 = npdf(d1)
    delta = np.where(call, dq * ndtr(d1), dq * (ndtr(d1) - 1))
    gamma = dq * n1 / (S * sq)
    vega = S * dq * np.sqrt(np.maximum(T, 1e-9)) * n1 / 100
    vanna = -dq * n1 * d2 / v
    shared = dq * n1 * (2 * (r - q) * T - d2 * sq) / (2 * np.maximum(T, 1e-9) * sq)
    charm = np.where(call, q * dq * ndtr(d1) - shared, -q * dq * ndtr(-d1) - shared)
    return {'delta': delta, 'gamma': gamma, 'vega': vega, 'vanna': vanna, 'charm': charm}


def implied_vol(px, S, K, T, call, r=0.0, q=0.0, lo=0.005, hi=5.0, it=60):
    """Bisection; NaN where the price is outside the no-arbitrage band."""
    px = np.asarray(px, float)
    S, K, T = (np.broadcast_to(np.asarray(a, float), px.shape) for a in (S, K, T))
    call = np.broadcast_to(np.asarray(call, bool), px.shape)
    a = np.full(px.shape, lo)
    b = np.full(px.shape, hi)
    pl = price(S, K, T, a, call, r, q)
    ph = price(S, K, T, b, call, r, q)
    ok = (px > pl) & (px < ph) & np.isfinite(px)
    for _ in range(it):
        m = 0.5 * (a + b)
        pm = price(S, K, T, m, call, r, q)
        up = pm < px
        a = np.where(up, m, a)
        b = np.where(up, b, m)
    return np.where(ok, 0.5 * (a + b), np.nan)


def years_to_pm_expiry(session: int, ms: np.ndarray | int, exp: np.ndarray | int, floor_min: float = 60.0):
    """Calendar years from (session, ms of day ET) to 16:00 ET of the expiration date, at least floor_min minutes."""
    import pandas as pd
    s = pd.Timestamp(str(int(session)))
    e = pd.to_datetime(np.asarray(exp).astype(str), format='%Y%m%d')
    days = (e - s).days.to_numpy() if hasattr(e, 'days') else (e - s).days
    mins = np.asarray(days, float) * 1440 + (16 * 60 - np.asarray(ms, float) / 60000)
    return np.maximum(mins, floor_min) / YEAR_MIN
