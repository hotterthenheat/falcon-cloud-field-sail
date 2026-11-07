"""EDGE0DTE Stage 1, family AE: features for A1-A7 (dealer gamma regimes), E1-E4 (dealer hedging) and the GEX-conditional
tests X4, X7, X8, X9, X10. Every dealer quantity is MODEL (REGISTRY dealer-sign convention, lib.dealer); the inputs
of the X tests' other legs (B7, D1, D4) are CALC.

Registered panel features (leakage-tested by lib.tests.test_leakage / families.ae_leak):

  ae_p   MODEL  lib.dealer.exposures(sess, t, max_dte=0) (same-day OI = REGISTRY P) plus the extras below
  ae_g7  MODEL  the same with max_dte=7 (OI of every expiry <= 7 DTE = REGISTRY G)
     gex_total, flip, flip_dist, call_wall, put_wall, gex_conc, charm_flow, gamma_dealer      (lib.dealer, unchanged)
     vanna_flow_{15,30,60}   -(D(S,T,iv) - D(S,T,iv - dIV_atm(L)))  = lib.dealer vanna_flow at lag L (30 = lib default)
     gamma_flow_{5,15,30}    -gamma_dealer * (S(t) - S(t - L))      = lib.dealer gamma_flow at lag L (15 = lib default)
     gex_open_s              total GEX of the table at t re-priced at S(09:45) (IVs sticky by strike, T at t)
     gex_gross               sum over strikes of |GEX(K)| at S(t)
     dgex_spot               (gex_total - gex_open_s) / gex_gross: the GEX change since 09:45 that the spot move alone
                             explains, as a fraction of gross gamma (A6, before the point-in-time standardisation)
     pin_k                   strike with the largest |GEX(K)| among strikes with |ln(K/S)| <= sigma_close(t)  (A7)
     S, sig30                spot and sigma_30 at t (for the wall distances, A4)
  ae_calc CALC   inputs of the X tests' non-dealer legs
     b7_gap                  ln(S(10:00) / prior session close)            (B7 P: first 30 min plus the overnight gap)
     b7_nogap                ln(S(10:00) / open of the 09:30 bar)          (B7 G: without the gap)
     d4_ivrv                 IV_atm(t)^2 / annualised RV of the last 60 1-minute returns  (D4)
     d1_rvratio              RV(last 30 min) / median RV(last 30 min at the same t) over the prior 20 sessions (D1)
     z_prev15                ln(S(t)/S(t-15)) / sigma_15(t)                (E3 control)

A3 at 1-minute resolution (grid G) is an event scan, `a3_minute_events(sess, flips)`: the flip used at minute tau is
the one computed at the latest 5-minute grid time <= tau (flip recomputed every 5 minutes; MODEL-G approximation,
stated in the report). Its leakage test is in families/ae_leak.py.
"""
import functools
import math

import numpy as np

from lib import dealer
from lib.cal import prev_sessions
from lib.config import YEAR_MIN
from lib.data import bars as load_bars, daily_closes
from lib.panel import feature

T0945 = 9 * 3600 + 45 * 60
T1000 = 10 * 3600

# ---------------------------------------------------------------- speed: lib.dealer.strike_table without re-pivoting
# lib.dealer.strike_table pivots the day's OI at every call (70% of the build time). The OI of a session does not
# change with t, so the pivot is cached per (root, day, max_dte) and only the IV lookup is redone at t. The result is
# identical to lib.dealer.strike_table (asserted value by value in families/ae_leak.py), and it is installed as
# lib.dealer.strike_table in processes that import this module, so lib.dealer.exposures uses it too.
from lib.data import oi as load_oi  # noqa: E402

_orig_strike_table = dealer.strike_table
_PIV = {}


def _pivot(root, day, max_dte):
    key = (root, day, max_dte)
    if key not in _PIV:
        if len(_PIV) > 8:
            _PIV.clear()
        o = load_oi(root, day, max_dte)
        if o is None or not len(o):
            _PIV[key] = None
        else:
            piv = o.pivot_table(index=['e', 'k'], columns='r', values='oi', aggfunc='sum').fillna(0)
            piv = piv[piv.sum(axis=1) > 0]
            if not len(piv):
                _PIV[key] = ()
            else:
                e = piv.index.get_level_values(0).values.astype(float)
                ks = piv.index.get_level_values(1).values.astype(float)
                oi_c = piv[1].values.astype(float) if 1 in piv.columns else np.zeros(len(piv))
                oi_p = piv[0].values.astype(float) if 0 in piv.columns else np.zeros(len(piv))
                _PIV[key] = (e, ks, oi_c, oi_p)
    return _PIV[key]


def fast_strike_table(sess, t, max_dte=0):
    sm = sess.smile(t)
    pv = _pivot(sess.root, sess.day, max_dte)
    if sm is None or pv is None:
        return None
    iv_atm = sess.iv_atm(t)
    if not np.isfinite(iv_atm):
        return None
    if pv == ():
        return None
    e, ks, oi_c, oi_p = pv
    ivmap = dict(zip(sm.k.values.astype(float), sm.iv.values))
    iv = np.array([ivmap.get(k, np.nan) for k in ks])
    iv = np.where(np.isfinite(iv), iv, iv_atm)
    T0 = float(sm.Tyr.iloc[0])
    T = T0 + e * (252.0 / 365.0) / 252.0
    return {'k': ks, 'e': e, 'oi_c': oi_c.copy(), 'oi_p': oi_p.copy(), 'iv': iv, 'S': float(sm.S.iloc[0]),
            'F': float(sm.F.iloc[0]), 'T': T, 'T0': T0, 'iv_atm': iv_atm}


dealer.strike_table = fast_strike_table


def _dealer(sess, t, max_dte):
    e = dealer.exposures(sess, t, max_dte=max_dte)          # lags: vanna 30, gamma 15 (REGISTRY P)
    out = {k: e[k] for k in ('gex_total', 'flip', 'flip_dist', 'call_wall', 'put_wall', 'gex_conc', 'charm_flow',
                             'gamma_dealer')}
    nan = float('nan')
    out.update({'vanna_flow_15': nan, 'vanna_flow_30': e['vanna_flow'], 'vanna_flow_60': nan,
                'gamma_flow_5': nan, 'gamma_flow_15': e['gamma_flow'], 'gamma_flow_30': nan,
                'gex_open_s': nan, 'gex_gross': nan, 'dgex_spot': nan, 'pin_k': nan, 'S': nan, 'sig30': nan})
    tab = dealer.strike_table(sess, t, max_dte)
    if tab is None:
        return out
    S = tab['S']
    out['S'] = S
    out['sig30'] = tab['iv_atm'] * math.sqrt(30 / YEAR_MIN)
    for L in (15, 60):
        iv_prev = sess.iv_atm(t - 60 * L) if t - 60 * L >= 570 * 60 else np.nan
        if np.isfinite(iv_prev):
            dv = tab['iv_atm'] - iv_prev
            out[f'vanna_flow_{L}'] = -(dealer.dealer_delta(tab) - dealer.dealer_delta(tab, dv=-dv))
    gam = e['gamma_dealer']
    for L in (5, 30):
        s_prev = sess.spot(t - 60 * L)
        if np.isfinite(s_prev) and np.isfinite(gam):
            out[f'gamma_flow_{L}'] = -gam * (S - s_prev)
    k, g = dealer.gex_by_strike(tab)
    gross = float(np.abs(g).sum())
    out['gex_gross'] = gross
    s0 = sess.spot(T0945)
    if t >= T0945 and np.isfinite(s0):
        out['gex_open_s'] = float(dealer.gex_rows(tab, S=s0).sum())
        if gross > 0:
            out['dgex_spot'] = (float(g.sum()) - out['gex_open_s']) / gross
    sig_close = tab['iv_atm'] * math.sqrt(tab['T0'])
    win = np.abs(np.log(k / S)) <= sig_close
    if win.any():
        i = np.flatnonzero(win)
        out['pin_k'] = float(k[i[np.argmax(np.abs(g[i]))]])
    return out


@feature('ae_p', 'MODEL')
def ae_p(sess, t):
    return _dealer(sess, t, 0)


@feature('ae_g7', 'MODEL')
def ae_g7(sess, t):
    return _dealer(sess, t, 7)


@functools.lru_cache(maxsize=64)
def _closes(root, day):
    """{minute: close} of a PRIOR session (only ever called for days before the session being built)."""
    h = load_bars(root, day)
    return dict(zip(h.m.astype(int).values, h.c.astype(float).values)) if len(h) else {}


def _rv(sess_bars_c, m_lo, m_hi):
    """Sum of squared 1-minute log returns of the closes of bars m_lo-1 .. m_hi (bars labelled by minute)."""
    c = [sess_bars_c.get(m, np.nan) for m in range(m_lo - 1, m_hi + 1)]
    c = np.array(c, float)
    if not (np.isfinite(c[0]) and np.isfinite(c[-1])) or np.isnan(c).sum() > 0.1 * len(c):
        return np.nan
    c = c[np.isfinite(c)]
    r = np.diff(np.log(c))
    return float(np.sum(r * r))


@feature('ae_calc', 'CALC')
def ae_calc(sess, t):
    nan = float('nan')
    out = {'b7_gap': nan, 'b7_nogap': nan, 'd4_ivrv': nan, 'd1_rvratio': nan, 'z_prev15': nan}
    b = sess.bars_upto(t)
    bm = dict(zip(b.m.astype(int).values, b.c.astype(float).values)) if len(b) else {}
    iv = sess.iv_atm(t)
    m1 = t // 60 - 1                                         # last bar closed by t
    # B7 (known from 10:00 on)
    if t >= T1000:
        s10 = bm.get(T1000 // 60 - 1, np.nan)
        prev = prev_sessions(sess.day, 1)
        dc = daily_closes(sess.root)
        pc = float(dc.get(prev[0], np.nan)) if prev else np.nan
        if np.isfinite(s10) and np.isfinite(pc) and pc > 0:
            out['b7_gap'] = math.log(s10 / pc)
        first = b[b.m.values == 570]
        if np.isfinite(s10) and len(first) and float(first.o.iloc[0]) > 0:
            out['b7_nogap'] = math.log(s10 / float(first.o.iloc[0]))
    # D4: IV_atm^2 / annualised RV of the last 60 one-minute returns (bars m1-59 .. m1)
    if np.isfinite(iv) and iv > 0 and m1 - 60 >= 570:
        rv = _rv(bm, m1 - 59, m1)
        if np.isfinite(rv) and rv > 0:
            out['d4_ivrv'] = iv * iv / (rv / (60 / YEAR_MIN))
    # D1: RV of the last 30 one-minute returns vs the same-time median of the prior 20 sessions
    if m1 - 30 >= 570:
        rv = _rv(bm, m1 - 29, m1)
        hist = []
        for d in prev_sessions(sess.day, 20):
            hc = _closes(sess.root, d)
            if hc:
                x = _rv(hc, m1 - 29, m1)
                if np.isfinite(x):
                    hist.append(x)
        if np.isfinite(rv) and len(hist) >= 10:
            med = float(np.median(hist))
            if med > 0:
                out['d1_rvratio'] = rv / med
    # E3 control: prior 15-minute return in sigma_15 units
    s15 = sess.spot(t - 900)
    s = sess.spot(t)
    if np.isfinite(s15) and np.isfinite(s) and np.isfinite(iv) and iv > 0 and t - 900 >= 571 * 60:
        out['z_prev15'] = math.log(s / s15) / (iv * math.sqrt(15 / YEAR_MIN))
    return out


def a3_side(sess, tau, flips):
    """Side of the 1-minute close at tau relative to the flip of the latest grid time <= tau. flips: {grid t: flip}
    computed from data <= that grid time. Returns +1 / -1 / NaN."""
    g = [x for x in flips if x <= tau]
    if not g:
        return np.nan
    f = flips[max(g)]
    s = sess.spot(tau)
    if not (np.isfinite(f) and np.isfinite(s)) or s == f:
        return np.nan
    return 1.0 if s > f else -1.0


def a3_minute_events(sess, flips, t_lo, t_hi):
    """1-minute flip crossings: decision minutes tau in (t_lo, t_hi] where side(tau) != side(tau - 60), both defined.
    Returns a list of (tau, direction)."""
    out = []
    prev = a3_side(sess, t_lo, flips)
    for tau in range(t_lo + 60, t_hi + 1, 60):
        cur = a3_side(sess, tau, flips)
        if np.isfinite(cur) and np.isfinite(prev) and cur != prev:
            out.append((tau, cur))
        prev = cur
    return out
