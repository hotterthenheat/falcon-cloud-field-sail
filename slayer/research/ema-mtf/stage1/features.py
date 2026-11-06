"""PREREG section 4.2 option-chart features, vectorised over a bar table that holds MANY contracts.

The eight binary features of one (series, timeframe) table, at each bar close (STRATEGY_SPEC section 8 on that table):
  S    state +1 (c > E9 > E21)                       warm: E21
  A    model A reclaim of E9                          warm: E9
  B    model B cross E9 / E21                         warm: E21
  C    model C alignment continuation (hold 3, hi 5)  warm: E50
  D    model D compression breakout (q .2, 100, 10)   warm: E50
  H    model H early momentum transition (decl 3)     warm: E21
  L50  c > E50                                        warm: E50
  L200 c > E200                                       warm: E200
Values are 1.0 / 0.0, and NaN where the contract is not warm for that feature (PREREG section 3: such an event is
excluded from that feature's test, never back-filled). `state` (-1/0/+1, NaN before E21 is warm) is the S1B regressor.

Every rolling / lagged quantity is computed WITHIN a contract (the table is sorted by contract, session, b; a row
never reads another contract's bars). `etests/test_stage1.py` checks equality with engine/signals.py applied to each
contract on its own.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

KEY = ['exp', 'strike', 'right']
FEATURES = ('S', 'A', 'B', 'C', 'D', 'H', 'L50', 'L200')
WARM_N = {'S': 21, 'A': 9, 'B': 21, 'C': 50, 'D': 50, 'H': 21, 'L50': 50, 'L200': 200}
LENGTHS = (5, 9, 21, 50, 200)


def group_ids(t: pd.DataFrame, key=KEY) -> np.ndarray:
    k = t[key].to_numpy()
    if not len(k):
        return np.zeros(0, np.int64)
    new = np.r_[True, (k[1:] != k[:-1]).any(1)]
    return np.cumsum(new) - 1


def _lag(x: np.ndarray, first: np.ndarray, k: int = 1) -> np.ndarray:
    """x shifted by k rows within each group (NaN where the lag crosses a group start)."""
    out = np.full(len(x), np.nan)
    if len(x) > k:
        out[k:] = x[:-k]
    # invalidate rows whose lag reaches into the previous group
    g = np.cumsum(first) - 1
    gl = np.full(len(x), -1)
    if len(x) > k:
        gl[k:] = g[:-k]
    out[gl != g] = np.nan
    return out


def _run_true(flag: np.ndarray, first: np.ndarray) -> np.ndarray:
    """Length of the run of consecutive True ending at each row, restarting at each group start."""
    s = pd.Series(flag.astype(np.int64))
    block = pd.Series(first | ~flag).cumsum()
    return s.groupby(block.to_numpy()).cumsum().to_numpy()


def _grp_roll(x: np.ndarray, g: np.ndarray, window: int, how: str, min_periods=None, q=None) -> np.ndarray:
    r = pd.Series(x).groupby(g).rolling(window, min_periods=min_periods)
    v = r.quantile(q) if how == 'quantile' else getattr(r, how)()
    return v.to_numpy()          # groupby-rolling keeps the original order when g is sorted (it is)


def features(t: pd.DataFrame) -> pd.DataFrame:
    """t: bar table sorted by KEY + session + b with c, ema5/9/21/50/200 and seen9/21/50/200. Returns a frame aligned
    with t: S A B C D H L50 L200 (1/0/NaN) and state (-1/0/+1/NaN)."""
    n = len(t)
    if n == 0:
        return pd.DataFrame({f: pd.Series(dtype=float) for f in FEATURES + ('state',)})
    g = group_ids(t)
    first = np.r_[True, g[1:] != g[:-1]]
    c = t.c.to_numpy(float)
    e5, e9, e21, e50, e200 = (t[f'ema{k}'].to_numpy(float) for k in (5, 9, 21, 50, 200))
    seen = {k: t[f'seen{k}'].to_numpy() for k in (9, 21, 50, 200)}
    out = {}
    up = (c > e9) & (e9 > e21)
    dn = (c < e9) & (e9 < e21)
    out['S'] = up.astype(float)
    out['state'] = np.where(up, 1.0, np.where(dn, -1.0, 0.0))
    pc, pe9, pe21 = _lag(c, first), _lag(e9, first), _lag(e21, first)
    out['A'] = ((pc < pe9) & (c > e9)).astype(float)
    out['B'] = ((pe9 <= pe21) & (e9 > e21)).astype(float)
    # C: c > E9 > E21 > E50 for >= 3 consecutive bars and c > max(prior 5 closes)
    al = up & (e21 > e50)
    run = _run_true(al, first)
    prior_hi5 = _grp_roll(pc, g, 5, 'max')
    out['C'] = ((run >= 3) & (c > prior_hi5)).astype(float)
    # D: prior bar's width <= 20th pct of the width over the 100 bars before it (>= 50), c > max EMAs, c > prior 10 hi
    emax = np.fmax(np.fmax(e9, e21), e50)
    emin = np.fmin(np.fmin(e9, e21), e50)
    width = np.where(np.isnan(e9) | np.isnan(e21) | np.isnan(e50), np.nan, (emax - emin) / c)
    thr = _grp_roll(_lag(width, first), g, 100, 'quantile', min_periods=50, q=0.2)
    comp = width <= thr
    comp_prev = _lag(comp.astype(float), first) == 1.0
    prior_hi10 = _grp_roll(pc, g, 10, 'max')
    out['D'] = (comp_prev & (c > emax) & (c > prior_hi10)).astype(float)
    # H: E5 slope turns > 0 after >= 3 bars of E5 slope < 0; c > E5; c < E21; E9 slope >= 0
    d5 = e5 - _lag(e5, first)
    d9 = e9 - _lag(e9, first)
    neg = d5 < 0
    down_run = _lag(_run_true(neg, first).astype(float), first)
    down_run = np.where(np.isnan(down_run), 0.0, down_run)
    out['H'] = ((d5 > 0) & (down_run >= 3) & (c > e5) & (c < e21) & (d9 >= 0)).astype(float)
    out['L50'] = (c > e50).astype(float)
    out['L200'] = (c > e200).astype(float)
    for f in FEATURES:
        out[f] = np.where(seen[WARM_N[f]] >= WARM_N[f], out[f], np.nan)
    out['state'] = np.where(seen[21] >= 21, out['state'], np.nan)
    return pd.DataFrame(out, index=t.index)


def asof_join(events: pd.DataFrame, table: pd.DataFrame, cols, prefix: str) -> pd.DataFrame:
    """For each event (exp, strike, right, session, dec_ms) the row of `table` of the same contract with the latest
    (session, known_ms) <= (event session, dec_ms): the last COMPLETED bar. Returns columns prefix+col, aligned with
    events' index, plus prefix+'kms' (the bar's key) for the look-ahead tests."""
    ev = events[KEY + ['session', 'dec_ms']].copy()
    ev['_i'] = np.arange(len(ev))
    ev['tk'] = ev.session.to_numpy(np.int64) * 100_000_000 + ev.dec_ms.to_numpy(np.int64)
    tb = table[KEY + ['session', 'known_ms'] + list(cols)].copy()
    tb['tk'] = tb.session.to_numpy(np.int64) * 100_000_000 + tb.known_ms.to_numpy(np.int64)
    tb = tb.drop(columns=['session', 'known_ms'])
    for k in KEY:
        ev[k] = ev[k].astype(np.int64)
        tb[k] = tb[k].astype(np.int64)
    ev = ev.sort_values('tk', kind='stable')
    tb = tb.sort_values('tk', kind='stable')
    tb['bar_tk'] = tb.tk
    m = pd.merge_asof(ev, tb, on='tk', by=KEY, direction='backward', allow_exact_matches=True)
    m = m.sort_values('_i')
    res = pd.DataFrame({prefix + c: m[c].to_numpy() for c in cols}, index=events.index)
    res[prefix + 'kms'] = m['bar_tk'].to_numpy()
    return res
