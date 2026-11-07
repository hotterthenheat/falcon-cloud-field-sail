"""Black-Scholes on the forward (Black-76, zero rate over the < 1 day to a same-day expiry). All vectorised.
T is in trading-years (minutes to expiry / (252*390)). F = forward (put-call parity forward from the board, CALC).

Greeks are per unit of underlying; charm is the delta change per unit of T *elapsing* (positive charm = delta rises as
time passes). Labels: IV and greeks computed from observed mids = CALC; any use with an assumed dealer side = MODEL.
"""
import numpy as np
from scipy.special import ndtr

_SQ2PI = np.sqrt(2 * np.pi)


def _d1d2(F, K, T, v):
    F, K, T, v = (np.asarray(a, float) for a in (F, K, T, v))
    sq = v * np.sqrt(np.maximum(T, 1e-12))
    sq = np.maximum(sq, 1e-12)
    d1 = (np.log(F / K) + 0.5 * sq * sq) / sq
    return d1, d1 - sq, sq


def npdf(x):
    return np.exp(-0.5 * np.asarray(x, float) ** 2) / _SQ2PI


def price(F, K, T, v, call):
    d1, d2, _ = _d1d2(F, K, T, v)
    F, K = np.asarray(F, float), np.asarray(K, float)
    c = F * ndtr(d1) - K * ndtr(d2)
    return np.where(np.asarray(call, bool), c, c - F + K)


def implied_vol(px, F, K, T, call, lo=1e-3, hi=8.0, it=60):
    """Bisection in log-vol. NaN when px <= intrinsic (+1e-6) or px >= the no-arbitrage upper bound."""
    px, K = np.asarray(px, float), np.asarray(K, float)
    F = np.broadcast_to(np.asarray(F, float), px.shape)
    T = np.broadcast_to(np.asarray(T, float), px.shape)
    call = np.broadcast_to(np.asarray(call, bool), px.shape)
    a = np.full(px.shape, np.log(lo))
    b = np.full(px.shape, np.log(hi))
    for _ in range(it):
        m = 0.5 * (a + b)
        up = price(F, K, T, np.exp(m), call) > px
        b = np.where(up, m, b)
        a = np.where(up, a, m)
    v = np.exp(0.5 * (a + b))
    intrinsic = np.where(call, np.maximum(F - K, 0), np.maximum(K - F, 0))
    upper = np.where(call, F, K)
    ok = (px > intrinsic + 1e-6) & (px < upper) & np.isfinite(px) & (T > 0)
    return np.where(ok, v, np.nan)


def delta(F, K, T, v, call):
    d1, _, _ = _d1d2(F, K, T, v)
    n = ndtr(d1)
    return np.where(np.asarray(call, bool), n, n - 1)


def gamma(F, K, T, v):
    d1, _, sq = _d1d2(F, K, T, v)
    return npdf(d1) / (np.asarray(F, float) * sq)


def vega(F, K, T, v):
    d1, _, _ = _d1d2(F, K, T, v)
    return np.asarray(F, float) * npdf(d1) * np.sqrt(np.maximum(np.asarray(T, float), 1e-12))


def vanna(F, K, T, v):
    """d delta / d sigma (same for calls and puts)."""
    d1, d2, _ = _d1d2(F, K, T, v)
    return -npdf(d1) * d2 / np.asarray(v, float)


def charm(F, K, T, v):
    """d delta / d(time elapsed) = -d delta / dT = n(d1) * d2 / (2T) (same for calls and puts, zero rate)."""
    d1, d2, _ = _d1d2(F, K, T, v)
    return npdf(d1) * d2 / (2 * np.maximum(np.asarray(T, float), 1e-12))
