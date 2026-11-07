"""MODEL dealer exposures (REGISTRY dealer-sign convention). Every output here is labelled MODEL.

Convention (assumed, not observed): customers are net long puts and net short calls, so dealers hold +OI calls and
-OI puts. Rows are (expiry, strike); same-day expiry OI only = REGISTRY primary P; max_dte > 0 = grid G.
  GEX(K)      = gamma(K) * (OI_call(K) - OI_put(K)) * 100 * S^2 * 0.01      ($ of dealer delta change per 1% move)
  dealer delta D(S, T, iv) = sum 100 * (OI_call * delta_call - OI_put * delta_put)    (shares)
  vanna exposure = sum 100 * vanna * (OI_call - OI_put)                     (shares per 1.00 of vol)
  charm exposure = sum 100 * charm * (OI_call - OI_put)                     (shares per trading-year elapsed)
gamma/vanna/charm from Black-76 at S with each strike's call-equivalent IV from the same-day board at t (lib.board
smile; a strike without IV gets IV_atm(t)); OI = OI published for the day (prior close). For G, the boards of later
expiries are not cached: they get the same strike's same-day IV (flat term structure, assumption MODEL-G) and
T = today's remaining T + e calendar days * (252/365) trading days.
  total GEX   = sum GEX
  flip        = spot level where total GEX, re-priced on a grid of S' within +/- 3 sigma_close(t) (IVs sticky by strike,
                T fixed), changes sign; the crossing nearest S; NaN when no sign change on the grid
  flip_dist   = (S - flip) / (S * sigma_close)
  call wall   = strike above S with the largest positive GEX(K); put wall = strike below S with the largest |GEX(K)|
  concentration = Herfindahl of |GEX(K)| over strikes within +/- 2 sigma_close(t) of S
  hedge demand (shares the dealers must BUY to stay delta-neutral; positive = buying):
    charm_flow(t)   = -(D(S, T_end) - D(S, T_t)), T_end = 1 minute before the close, S and IVs fixed      (E1)
    vanna_flow(t,L) = -(D(S, T_t, iv_t) - D(S, T_t, iv_t - dIV_atm)), dIV_atm = IV_atm(t) - IV_atm(t - L), a
                      parallel shift (dealer delta change caused by the last L-minute IV change)           (E2)
    gamma_flow(t,L) = -Gamma_dealer * (S(t) - S(t - L)), Gamma_dealer = sum 100 * gamma * (OI_c - OI_p)   (E3)
"""
import math

import numpy as np

from . import bs
from .config import YEAR_MIN
from .data import oi as load_oi


def strike_table(sess, t, max_dte=0):
    """Rows (e, k): oi_c, oi_p, iv, T. None when the board, IV_atm or OI is missing."""
    sm = sess.smile(t)
    o = load_oi(sess.root, sess.day, max_dte)
    if sm is None or o is None or not len(o):
        return None
    iv_atm = sess.iv_atm(t)
    if not np.isfinite(iv_atm):
        return None
    piv = o.pivot_table(index=['e', 'k'], columns='r', values='oi', aggfunc='sum').fillna(0)
    piv = piv[piv.sum(axis=1) > 0]
    if not len(piv):
        return None
    e = piv.index.get_level_values(0).values.astype(float)
    ks = piv.index.get_level_values(1).values.astype(float)
    oi_c = piv[1].values.astype(float) if 1 in piv.columns else np.zeros(len(piv))
    oi_p = piv[0].values.astype(float) if 0 in piv.columns else np.zeros(len(piv))
    ivmap = dict(zip(sm.k.values.astype(float), sm.iv.values))
    iv = np.array([ivmap.get(k, np.nan) for k in ks])
    iv = np.where(np.isfinite(iv), iv, iv_atm)
    T0 = float(sm.Tyr.iloc[0])
    T = T0 + e * (252.0 / 365.0) / 252.0
    return {'k': ks, 'e': e, 'oi_c': oi_c, 'oi_p': oi_p, 'iv': iv, 'S': float(sm.S.iloc[0]), 'F': float(sm.F.iloc[0]),
            'T': T, 'T0': T0, 'iv_atm': iv_atm}


def dealer_delta(tab, S=None, T0=None, dv=0.0):
    """Dealer share delta. T0 replaces today's remaining time (later expiries shift by the same amount)."""
    S = tab['S'] if S is None else S
    T = tab['T'] if T0 is None else np.maximum(tab['T'] - tab['T0'] + T0, 1e-9)
    v = np.maximum(tab['iv'] + dv, 1e-3)
    dc = bs.delta(S, tab['k'], T, v, True)
    dp = bs.delta(S, tab['k'], T, v, False)
    return float(np.sum(100 * (tab['oi_c'] * dc - tab['oi_p'] * dp)))


def gex_rows(tab, S=None):
    S = tab['S'] if S is None else S
    g = bs.gamma(S, tab['k'], tab['T'], tab['iv'])
    return g * (tab['oi_c'] - tab['oi_p']) * 100 * S * S * 0.01


def gex_by_strike(tab, S=None):
    """(strikes, GEX per strike summed over the included expiries)."""
    g = gex_rows(tab, S)
    ks, inv = np.unique(tab['k'], return_inverse=True)
    return ks, np.bincount(inv, weights=g)


KEYS = ('gex_total', 'flip', 'flip_dist', 'call_wall', 'put_wall', 'gex_conc', 'vanna_exp', 'charm_exp',
        'gamma_dealer', 'charm_flow', 'vanna_flow', 'gamma_flow')


def exposures(sess, t, max_dte=0, lag_vanna=30, lag_gamma=15):
    """All MODEL exposures at t as a dict (NaN where unavailable)."""
    nan = float('nan')
    out = {k: nan for k in KEYS}
    tab = strike_table(sess, t, max_dte)
    if tab is None:
        return out
    S, T = tab['S'], tab['T']
    k, g = gex_by_strike(tab)
    out['gex_total'] = float(g.sum())
    sig_close = tab['iv_atm'] * math.sqrt(tab['T0'])
    grid = S * np.exp(np.linspace(-3, 3, 121) * sig_close)
    tot = np.array([gex_rows(tab, x).sum() for x in grid])
    sgn = np.sign(tot)
    ch = np.flatnonzero(sgn[1:] * sgn[:-1] < 0)
    if len(ch):
        xs = np.array([grid[i] + (grid[i + 1] - grid[i]) * tot[i] / (tot[i] - tot[i + 1]) for i in ch])
        out['flip'] = float(xs[np.argmin(np.abs(xs - S))])
        out['flip_dist'] = (S - out['flip']) / (S * sig_close) if sig_close > 0 else nan
    above, below = k > S, k < S
    if (above & (g > 0)).any():
        i = np.flatnonzero(above & (g > 0))
        out['call_wall'] = float(k[i[np.argmax(g[i])]])
    if below.any():
        i = np.flatnonzero(below)
        out['put_wall'] = float(k[i[np.argmax(np.abs(g[i]))]])
    win = np.abs(np.log(k / S)) <= 2 * sig_close
    if win.any() and np.abs(g[win]).sum() > 0:
        w = np.abs(g[win]) / np.abs(g[win]).sum()
        out['gex_conc'] = float(np.sum(w * w))
    net = tab['oi_c'] - tab['oi_p']
    kr = tab['k']
    out['vanna_exp'] = float(np.sum(100 * bs.vanna(S, kr, T, tab['iv']) * net))
    out['charm_exp'] = float(np.sum(100 * bs.charm(S, kr, T, tab['iv']) * net))
    gam = float(np.sum(100 * bs.gamma(S, kr, T, tab['iv']) * net))
    out['gamma_dealer'] = gam
    out['charm_flow'] = -(dealer_delta(tab, T0=1.0 / YEAR_MIN) - dealer_delta(tab))
    iv_prev = sess.iv_atm(t - 60 * lag_vanna) if t - 60 * lag_vanna >= 570 * 60 else np.nan
    if np.isfinite(iv_prev):
        dv = tab['iv_atm'] - iv_prev
        out['vanna_flow'] = -(dealer_delta(tab) - dealer_delta(tab, dv=-dv))
    s_prev = sess.spot(t - 60 * lag_gamma)
    if np.isfinite(s_prev):
        out['gamma_flow'] = -gam * (S - s_prev)
    return out
