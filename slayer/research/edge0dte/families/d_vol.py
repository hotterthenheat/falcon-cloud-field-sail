"""EDGE0DTE Stage 1, family D (volatility): features for registry rows D1-D4 (REGISTRY.md section D).

Every feature is registered with lib.panel.feature (so lib/tests/test_leakage.py and families/test_d_leakage.py run it
with all data after t deleted). The same core functions (_rv_parts) are used by the bulk path (bulk_features), which
reads the 1-minute bar caches once per root instead of building a Session per row; families/d_stage1.py cross-checks
the bulk values against the registered features on a random sample of sessions and stops on any mismatch.

  d_rv30_rel   (D1, D2)  CALC  RV(t-30m, t) / median over the prior 20 NYSE sessions of RV over the same clock window
                               (>= 10 valid prior sessions). RV = sum of squared 1-minute log returns of the closes at
                               t-30m, t-29m, ..., t (31 closes; both endpoints required, <= 3 interior closes missing,
                               a missing close is spanned, never interpolated). First defined at t = 10:05 (the first
                               close is the 09:31 close of the 09:30 bar, as in the base feature rv_ratio30).
  d_semivar60  (D3)      CALC  (RS+ - RS-) / RV over the last 60 min (61 closes, <= 6 interior missing), RS+ = sum of r^2
                               over r > 0, RS- over r < 0 (Bollerslev, Li, Zhao 2020). First defined at t = 10:35.
  d_iv_rv60    (D4)      CALC  IV_atm(t)^2 / (RV(t-60m, t) annualised with the same trading-minute clock,
                               RV * 252*390/60). IV_atm from lib.board (observed mids). First defined at t = 10:35.
Data: 1-minute bars (OBS; SPX index for SPXW, the ETF itself for SPY/QQQ/IWM), the same-day board (OBS) for IV_atm.
"""
import collections

import numpy as np
import pandas as pd

from lib.cal import prev_sessions
from lib.config import YEAR_MIN
from lib.data import bars as load_bars
from lib.panel import feature

FIRST = 571 * 60            # the first usable close (bar 570, 09:30) is stamped 09:31


def _rv_parts(c, max_missing):
    """c: closes at consecutive minute boundaries (NaN = missing bar). Returns (rv, rs_pos, rs_neg) or None."""
    c = np.asarray(c, float)
    if len(c) < 2 or not (np.isfinite(c[0]) and np.isfinite(c[-1])) or np.isnan(c[1:-1]).sum() > max_missing:
        return None
    q = c[np.isfinite(c)]
    if (q <= 0).any():
        return None
    r = np.diff(np.log(q))
    r2 = r * r
    return float(r2.sum()), float(r2[r > 0].sum()), float(r2[r < 0].sum())


def _closes_sess(sess, t, mins):
    return np.array([sess.spot(x) for x in range(t - 60 * mins, t + 1, 60)], float)


# prior-session bar closes (prior sessions are entirely before D, so caching them cannot leak data of D)
_PRIOR = collections.OrderedDict()


def _prior_closes(root, day):
    key = (root, day)
    if key not in _PRIOR:
        b = load_bars(root, day)
        _PRIOR[key] = dict(zip(b.m.astype(int).values, b.c.astype(float).values)) if len(b) else {}
        if len(_PRIOR) > 256:
            _PRIOR.popitem(last=False)
    return _PRIOR[key]


def _rv30_prior_median(root, day, t):
    vals = []
    for d in prev_sessions(day, 20):
        bm = _prior_closes(root, d)
        c = [bm.get(x // 60 - 1, np.nan) for x in range(t - 1800, t + 1, 60)]
        p = _rv_parts(c, 3)
        if p is not None and p[0] > 0:
            vals.append(p[0])
    return float(np.median(vals)) if len(vals) >= 10 else np.nan


@feature('d_rv30_rel', 'CALC')
def d_rv30_rel(sess, t):
    if t - 1800 < FIRST:
        return np.nan
    p = _rv_parts(_closes_sess(sess, t, 30), 3)
    if p is None:
        return np.nan
    med = _rv30_prior_median(sess.root, sess.day, t)
    return p[0] / med if np.isfinite(med) and med > 0 else np.nan


@feature('d_semivar60', 'CALC')
def d_semivar60(sess, t):
    if t - 3600 < FIRST:
        return np.nan
    p = _rv_parts(_closes_sess(sess, t, 60), 6)
    if p is None or p[0] <= 0:
        return np.nan
    return (p[1] - p[2]) / p[0]


@feature('d_iv_rv60', 'CALC')
def d_iv_rv60(sess, t):
    if t - 3600 < FIRST:
        return np.nan
    p = _rv_parts(_closes_sess(sess, t, 60), 6)
    iv = sess.iv_atm(t)
    if p is None or p[0] <= 0 or not np.isfinite(iv) or iv <= 0:
        return np.nan
    return iv * iv / (p[0] * YEAR_MIN / 60.0)


D_FEATURES = ('d_rv30_rel', 'd_semivar60', 'd_iv_rv60')


# ---------------------------------------------------------------- bulk path (same core functions, cached bars)

def _close_matrix(root, days):
    """{day: array of closes indexed by minute 570..959 (NaN = missing)}."""
    out = {}
    for d in days:
        b = load_bars(root, d)
        a = np.full(390, np.nan)
        if len(b):
            m = b.m.astype(int).values
            ok = (m >= 570) & (m < 960)
            a[m[ok] - 570] = b.c.astype(float).values[ok]
        out[d] = a
    return out


def _window(a, t, mins):
    j1 = t // 60 - 1 - 570
    j0 = j1 - mins
    if j0 < 0 or j1 >= 390:
        return None
    return a[j0:j1 + 1]


def bulk_features(root, panel_df):
    """panel_df: rows (day, t, iv_atm) of one root. Returns a DataFrame (index aligned) with D_FEATURES columns."""
    days = sorted(panel_df.day.unique())
    need = set(days)
    for d in days:
        need.update(prev_sessions(d, 20))
    C = _close_matrix(root, sorted(need))
    # prior-session RV30 by (day, t) cached
    rv30 = {}

    def rv30_of(d, t):
        k = (d, t)
        if k not in rv30:
            w = _window(C[d], t, 30)
            p = None if w is None else _rv_parts(w, 3)
            rv30[k] = p[0] if p is not None else np.nan
        return rv30[k]

    out = np.full((len(panel_df), 3), np.nan)
    for i, (d, t, iv) in enumerate(zip(panel_df.day.values, panel_df.t.values.astype(int), panel_df.iv_atm.values)):
        a = C[d]
        if t - 1800 >= FIRST:
            w = _window(a, t, 30)
            p = None if w is None else _rv_parts(w, 3)
            if p is not None:
                vals = [rv30_of(x, t) for x in prev_sessions(d, 20)]
                vals = [v for v in vals if np.isfinite(v) and v > 0]
                if len(vals) >= 10:
                    med = float(np.median(vals))
                    if med > 0:
                        out[i, 0] = p[0] / med
        if t - 3600 >= FIRST:
            w = _window(a, t, 60)
            p = None if w is None else _rv_parts(w, 6)
            if p is not None and p[0] > 0:
                out[i, 1] = (p[1] - p[2]) / p[0]
                if np.isfinite(iv) and iv > 0:
                    out[i, 2] = iv * iv / (p[0] * YEAR_MIN / 60.0)
    return pd.DataFrame(out, columns=list(D_FEATURES), index=panel_df.index)
