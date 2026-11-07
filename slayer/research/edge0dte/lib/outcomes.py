"""Forward outcomes (PROTOCOL section 4). HOLDOUT-guarded: refuses 2025 without a registered frozen-spec sha256, and
2026 always.

  Z(t,h) = ln(S(t+h)/S(t)) / (IV_atm(t) * sqrt(h_years))                         CALC
  V(t,h) = RV(t, t+h) / (IV_atm(t)^2 * h_years),  RV = sum of squared 1-minute log returns of the bar closes at
           t, t+1min, ..., t+h                                                         CALC
S(x) = close of the bar that closed at x (bar x//60 - 1). h in {15, 30, 60, 'close'}; 'close' ends at the session
close (16:00, or 13:00 on early-close days); a horizon that passes the close is NaN. A missing endpoint bar -> NaN;
a missing interior bar -> its return spans the gap (no interpolation); more than 10% of interior bars missing -> NaN.
"""
import math

import numpy as np

from . import guard
from .board import Session, horizon_end
from .config import HORIZONS, YEAR_MIN


def _path(sess, t, end):
    m0, m1 = t // 60 - 1, end // 60 - 1
    c = [sess._bm.get(m, np.nan) for m in range(m0, m1 + 1)]
    return np.array(c, float)


def zv(sess, t, h, iv=None):
    """dict(ret, rv, hmin, sig, Z, V, nmiss) for one decision time and horizon. iv defaults to IV_atm(t)."""
    guard.check(sess.day)
    out = {'ret': np.nan, 'rv': np.nan, 'hmin': np.nan, 'sig': np.nan, 'Z': np.nan, 'V': np.nan, 'nmiss': np.nan}
    end = horizon_end(sess, t, h)
    if end is None or end <= t:
        return out
    iv = sess.iv_atm(t) if iv is None else iv
    p = _path(sess, t, end)
    hmin = (end - t) / 60.0
    out['hmin'] = hmin
    out['nmiss'] = int(np.isnan(p[1:-1]).sum()) if len(p) > 2 else 0
    if not (np.isfinite(p[0]) and np.isfinite(p[-1])) or out['nmiss'] > 0.1 * max(len(p) - 2, 1):
        return out
    q = p[np.isfinite(p)]
    r = np.diff(np.log(q))
    out['ret'] = float(math.log(p[-1] / p[0]))
    out['rv'] = float(np.sum(r * r))
    if np.isfinite(iv) and iv > 0:
        hy = hmin / YEAR_MIN
        out['sig'] = iv * math.sqrt(hy)
        out['Z'] = out['ret'] / out['sig']
        out['V'] = out['rv'] / (iv * iv * hy)
    return out


def grid_outcomes(sess, times, horizons=HORIZONS):
    """List of dict rows: t, iv_atm, and Z_h, V_h, sig_h, ret_h, rv_h for each horizon."""
    guard.check(sess.day)
    rows = []
    for t in times:
        iv = sess.iv_atm(t)
        row = {'t': t, 'iv_atm': iv}
        for h in horizons:
            o = zv(sess, t, h, iv)
            row.update({f'Z_{h}': o['Z'], f'V_{h}': o['V'], f'sig_{h}': o['sig'], f'ret_{h}': o['ret'], f'rv_{h}': o['rv']})
        rows.append(row)
    return rows


def event_outcomes(root, day, t, horizons=HORIZONS):
    """Outcomes at an arbitrary event time t (seconds; e.g. the first minute boundary after an event bar closes)."""
    sess = Session(root, day)
    return grid_outcomes(sess, [int(t)], horizons)[0]
