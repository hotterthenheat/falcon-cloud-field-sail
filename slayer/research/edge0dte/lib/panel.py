"""Decision-grid panel and the feature registry.

A feature is ONE function of (sess, t) -> float (or dict of floats), registered with its PROTOCOL label:

    from lib.panel import feature
    @feature('my_feat', 'CALC')
    def my_feat(sess, t):
        b = sess.bars_upto(t)            # only bars that closed by t
        ...
        return value

then `panel.add_features(df, ['my_feat'])` adds the column to an existing panel (or pass features= to build()).
The leakage test (lib/tests/test_leakage.py) runs every registered feature with all data after t deleted and
requires identical values, so a feature must read data only through the Session views (spot, bars_upto, board,
smile, iv_atm, ...) or through data stamped <= t.

Base panel columns (label):
  root, day, t, split, bucket                                 CALC (bookkeeping)
  S                                                           OBS   close of the bar that closed at t
  iv_atm                                                      CALC  lib.board.Session.iv_atm
  sig_15, sig_30, sig_60, sig_close                           CALC  IV_atm * sqrt(h_years)
  Z_15..Z_close, V_15..V_close                                CALC  forward outcomes (lib.outcomes; HOLDOUT-guarded)
  vix                                                         OBS   VIX 1-minute close at t (bar closed at t)
  vix1d                                                       OBS   VIX1D at t where it exists (2023-04+)
  gex_total                                                   MODEL lib.dealer total GEX, same-day OI
  z_prev30                                                    CALC  ln(S(t)/S(t-30m)) / (IV_atm(t) sqrt(30m))
  rv_ratio30                                                  CALC  RV(t-30m, t) / (IV_atm(t)^2 * 30m)  (prior V)
  etf_vol_ratio30                                             OBS/CALC ETF volume of the last 30 min / its median over
                                                              the prior 20 sessions at the same minute (SPY for SPXW)
"""
import math

import numpy as np
import pandas as pd

from . import bs
from .board import Session
from .cal import close_min, prev_sessions
from .config import GRID, HORIZONS, YEAR_MIN, bucket, split
from .data import bars as load_bars, oi as load_oi, vix as load_vix

FEATURES = {}
LABELS = {'root': 'CALC', 'day': 'CALC', 't': 'CALC', 'split': 'CALC', 'bucket': 'CALC', 'S': 'OBS', 'iv_atm': 'CALC',
          'vix': 'OBS', 'vix1d': 'OBS', 'gex_total': 'MODEL', 'z_prev30': 'CALC', 'rv_ratio30': 'CALC',
          'etf_vol_ratio30': 'CALC'}
for _h in HORIZONS:
    LABELS.update({f'sig_{_h}': 'CALC', f'Z_{_h}': 'CALC', f'V_{_h}': 'CALC'})


def feature(name, label):
    assert label in ('OBS', 'CALC', 'MODEL'), label

    def deco(fn):
        FEATURES[name] = (fn, label)
        LABELS[name] = label
        return fn
    return deco


def grid(day):
    last = close_min(day) * 60 - 1800
    return [t for t in GRID if t <= last]


# ---------------------------------------------------------------- base features (registered: leakage-tested too)

def _bar_close_at(b, t):
    if b is None or not len(b):
        return np.nan
    x = b[b.m.values == t // 60 - 1]
    return float(x.c.iloc[0]) if len(x) else np.nan


@feature('vix', 'OBS')
def f_vix(sess, t):
    return _bar_close_at(sess.aux('VIX'), t)


@feature('vix1d', 'OBS')
def f_vix1d(sess, t):
    return _bar_close_at(sess.aux('VIX1D'), t)


@feature('gex_total', 'MODEL')
def f_gex_total(sess, t):
    """Total GEX (REGISTRY convention), same-day OI only."""
    sm = sess.smile(t)
    o = load_oi(sess.root, sess.day, 0)
    iv_atm = sess.iv_atm(t)
    if sm is None or o is None or not len(o) or not np.isfinite(iv_atm):
        return np.nan
    oc = o[o.r == 1].groupby('k')['oi'].sum()
    op = o[o.r == 0].groupby('k')['oi'].sum()
    ks = np.array(sorted(set(oc.index) | set(op.index)), float)
    net = oc.reindex(ks).fillna(0).values - op.reindex(ks).fillna(0).values
    ivmap = dict(zip(sm.k.values.astype(float), sm.iv.values))
    iv = np.array([ivmap.get(k, np.nan) for k in ks])
    iv = np.where(np.isfinite(iv), iv, iv_atm)
    S, T = float(sm.S.iloc[0]), float(sm.Tyr.iloc[0])
    return float(np.sum(bs.gamma(S, ks, T, iv) * net * 100 * S * S * 0.01))


@feature('z_prev30', 'CALC')
def f_z_prev30(sess, t):
    a, b = sess.spot(t - 1800), sess.spot(t)
    iv = sess.iv_atm(t)
    if not (np.isfinite(a) and np.isfinite(b) and np.isfinite(iv)) or iv <= 0 or t - 1800 < 571 * 60:
        return np.nan
    return math.log(b / a) / (iv * math.sqrt(30 / YEAR_MIN))


@feature('rv_ratio30', 'CALC')
def f_rv_ratio30(sess, t):
    iv = sess.iv_atm(t)
    if t - 1800 < 571 * 60 or not np.isfinite(iv) or iv <= 0:
        return np.nan
    c = np.array([sess.spot(x) for x in range(t - 1800, t + 1, 60)])
    if np.isnan(c[0]) or np.isnan(c[-1]) or np.isnan(c).sum() > 3:
        return np.nan
    c = c[np.isfinite(c)]
    r = np.diff(np.log(c))
    return float(np.sum(r * r) / (iv * iv * 30 / YEAR_MIN))


@feature('etf_vol_ratio30', 'CALC')
def f_etf_vol_ratio30(sess, t):
    sym = 'SPY' if sess.root == 'SPXW' else sess.root
    b = sess.aux(sym)
    if b is None or 'v' not in b.columns:
        return np.nan
    m1 = t // 60 - 1
    cur = b[(b.m.values > m1 - 30) & (b.m.values <= m1)]
    if len(cur) < 25:
        return np.nan
    v = float(cur.v.sum())
    hist = []
    for d in prev_sessions(sess.day, 20):
        h = load_bars(sym, d)
        if len(h) and 'v' in h.columns:
            x = h[(h.m.values > m1 - 30) & (h.m.values <= m1)]
            if len(x) >= 25:
                hist.append(float(x.v.sum()))
    if len(hist) < 10:
        return np.nan
    med = float(np.median(hist))
    return v / med if med > 0 else np.nan


BASE_FEATURES = ('vix', 'vix1d', 'gex_total', 'z_prev30', 'rv_ratio30', 'etf_vol_ratio30')


# ---------------------------------------------------------------- builder

def _attach_aux(sess):
    cache = {}

    def aux(sym):
        if sym not in cache:
            cache[sym] = load_vix(sess.day, sym) if sym.startswith('VIX') else load_bars(sym, sess.day)
        return cache[sym]
    sess.aux = aux
    return sess


def session(root, day):
    return _attach_aux(Session(root, day))


def _run_feature(name, sess, t, row):
    fn = FEATURES[name][0]
    v = fn(sess, t)
    if isinstance(v, dict):
        for k, x in v.items():
            row[f'{name}_{k}'] = x
    else:
        row[name] = v


def build_day(root, day, features=BASE_FEATURES, outcomes=True, times=None):
    from .outcomes import zv
    sess = session(root, day)
    rows = []
    for t in (grid(day) if times is None else times):
        iv = sess.iv_atm(t)
        row = {'root': root, 'day': day, 't': int(t), 'split': split(day), 'bucket': bucket(t), 'S': sess.spot(t),
               'iv_atm': iv}
        for h in HORIZONS:
            row[f'sig_{h}'] = sess.sigma_h(t, h, iv)
        if outcomes:
            for h in HORIZONS:
                o = zv(sess, t, h, iv)
                row[f'Z_{h}'] = o['Z']
                row[f'V_{h}'] = o['V']
        for f in features:
            _run_feature(f, sess, t, row)
        rows.append(row)
    return pd.DataFrame(rows)


def build(root, days, features=BASE_FEATURES, outcomes=True, progress=False):
    parts = []
    for i, d in enumerate(days):
        parts.append(build_day(root, d, features, outcomes))
        if progress and i % 50 == 0:
            print(root, i, len(days), d, flush=True)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def add_features(df, names):
    """Add registered features to an existing panel (rows grouped by root, day)."""
    out = []
    for (root, day), g in df.groupby(['root', 'day'], sort=False):
        sess = session(root, day)
        g = g.copy()
        vals = []
        for t in g.t.values:
            row = {}
            for n in names:
                _run_feature(n, sess, int(t), row)
            vals.append(row)
        add = pd.DataFrame(vals, index=g.index)
        out.append(pd.concat([g, add], axis=1))
    return pd.concat(out).loc[df.index]
