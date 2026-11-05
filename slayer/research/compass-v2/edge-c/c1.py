"""C1 CLOSE-FLOW (PREREG): the sign of the dealers' charm/vanna hedging flow into the close, from the 0DTE book at 15:00.

Stage A (gate, underlying only):  python3 c1.py stageA DEV
  For each root-session (SPY, QQQ, SPXW) with a 0DTE chain, OI and bars: dealer book = morning OI of the 0DTE (dealers
  long calls, short puts), IV per strike from the 14:59 board (stamped <= 15:00 - 60 s), spot = the 14:59 bar close
  (a closed bar; no bar at or after the mark is read). Charm flow F_c = -[Delta_d(15:55) - Delta_d(15:00)] (S, sigma
  held); vanna flow F_v = -(dDelta_d/dsigma) x (ATM IV 15:00 - ATM IV 14:00). Side = sign(F). Gate G1: |F| >= trailing
  20-session median |F| (past sessions, same root) and (dealer gamma < 0 or spot >= 0.5 expected moves from the flip).
  Outcome: side x ln(S_15:54 close / S_14:59 close). 4 looks: {C, CV} x {G0, G1}. Pass: clustered CI > 0, permutation
  p < 0.0125, mean >= +3 bp. Stage B (1-second option execution) only for a passer.
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

OUT = os.path.join(C.DATA, 'results')
os.makedirs(OUT, exist_ok=True)
ROOTS = ('SPY', 'QQQ', 'SPXW')
UND = {'SPY': 'SPY', 'QQQ': 'QQQ', 'SPXW': 'SPX'}
YEAR_MIN = 252 * 390.0
T0_MIN, T1_MIN = 15 * 60, 15 * 60 + 55          # decision 15:00, horizon 15:55


def edge_sessions(split):
    f = os.path.join(C.EDGE, 'sessions.json')
    days = json.load(open(f))
    out = [d for d in days if C.split_of(d) == split]
    if split == 'DEV':
        out = [d for d in out if d >= '2020-02-18']
    return out


def chain_at(root, d, m):
    f = os.path.join(C.EDGE, 'chain', root, f'{d}.parquet')
    if not os.path.exists(f):
        return None
    c = pd.read_parquet(f)
    if not len(c):
        return None
    b = c[(c.m == m) & (c.bid > 0) & (c.ask > c.bid)]
    return b if len(b) else None


def oi_0dte(root, d):
    f = os.path.join(C.EDGE, 'oi', root, f'{d}.parquet')
    if not os.path.exists(f):
        return None
    o = pd.read_parquet(f)
    o = o[o.e == 0] if len(o) else o
    return o if len(o) else None


def book_iv(board, S, T):
    """Per-strike IV (mean of the two rights where both solve) and the ATM IV from a board."""
    mid = (board.bid.values + board.ask.values) / 2
    iv = C.implied_vol(mid, S, board.k.values, T, board.r.values == 1)
    s = pd.Series(iv, index=board.k.values).dropna()
    per_k = s.groupby(level=0).mean()
    if not len(per_k):
        return None, float('nan')
    katm = per_k.index[np.argmin(np.abs(per_k.index.values - S))]
    return per_k, float(per_k[katm])


def dealer_delta(q, k, call, S, T, iv):
    return float(np.sum(q * C.bs_delta(S, k, T, iv, call)))


def dealer_gamma(q, k, S, T, iv):
    return float(np.sum(q * C.bs_gamma(S, k, T, iv)))


def signal(root, d):
    bars = C.day_bars(UND[root], d)
    if len(bars) < 300:
        return None
    closed = bars[bars.m <= T0_MIN - 1]                       # bars that have closed by 15:00 (start <= 14:59)
    if not len(closed) or int(closed.m.iloc[-1]) != T0_MIN - 1:
        return None
    S = float(closed.c.iloc[-1])
    b = chain_at(root, d, T0_MIN - 1)                         # the 14:59 board (stamped <= 15:00 - 60 s)
    b14 = chain_at(root, d, 14 * 60 - 1)
    o = oi_0dte(root, d)
    if b is None or o is None or b14 is None:
        return None
    T0 = (16 * 60 - T0_MIN) / YEAR_MIN
    T1 = (16 * 60 - T1_MIN) / YEAR_MIN
    per_k, atm0 = book_iv(b, S, T0)
    if per_k is None or not np.isfinite(atm0):
        return None
    S14 = float(bars[bars.m <= 14 * 60 - 1].c.iloc[-1])
    _, atm14 = book_iv(b14, S14, (16 * 60 - 14 * 60) / YEAR_MIN)
    o = o[np.abs(o.k / S - 1) <= 0.03]
    if not len(o):
        return None
    k = o.k.values.astype(float)
    call = o.r.values == 1
    q = np.where(call, 1.0, -1.0) * o.oi.values.astype(float)          # dealers long calls, short puts
    iv = per_k.reindex(k, method='nearest').values
    iv = np.where(np.isfinite(iv), iv, atm0)
    d0, d1 = dealer_delta(q, k, call, S, T0, iv), dealer_delta(q, k, call, S, T1, iv)
    F_c = -(d1 - d0) * 100                                             # shares the dealers must buy (+) / sell (-)
    dsig = atm0 - atm14 if np.isfinite(atm14) else 0.0
    dd_dsig = (dealer_delta(q, k, call, S, T0, iv + 0.01) - d0) / 0.01
    F_v = -dd_dsig * dsig * 100
    gam = dealer_gamma(q, k, S, T0, iv) * 100
    grid = S * (1 + np.linspace(-0.03, 0.03, 121))
    gg = np.array([dealer_gamma(q, k, s, T0, iv) for s in grid])
    sgn = np.sign(gg)
    flips = np.flatnonzero(sgn[1:] * sgn[:-1] < 0)
    em = S * atm0 * math.sqrt(T0)
    if len(flips):
        sstar = grid[flips[np.argmin(np.abs(grid[flips] - S))]]
        dflip = (sstar - S) / em if em > 0 else np.nan
    else:
        dflip = np.inf
    end = bars[(bars.m <= T1_MIN - 1)]
    S1 = float(end.c.iloc[-1])
    return dict(root=root, session=d, S=S, atm_iv=atm0, d_iv=dsig, F_c=F_c, F_v=F_v, F_cv=F_c + F_v, gamma=gam, dflip=dflip,
                oi_total=float(o.oi.sum()), ret=math.log(S1 / S), ret_1558=math.log(float(bars[bars.m <= 957].c.iloc[-1]) / S))


def stage_a(split):
    f = os.path.join(OUT, f'c1_signals_{split}.parquet')
    if os.path.exists(f):
        df = pd.read_parquet(f)
    else:
        rows = []
        for d in edge_sessions(split):
            assert not C.is_locked(d), d
            for r in ROOTS:
                try:
                    s = signal(r, d)
                except Exception as ex:  # noqa: BLE001
                    s = None
                    print('ERR', r, d, str(ex)[:80], flush=True)
                if s:
                    rows.append(s)
        df = pd.DataFrame(rows)
        df.to_parquet(f)
    df = df.sort_values(['root', 'session']).reset_index(drop=True)
    for col in ('F_c', 'F_cv'):
        df[f'med20_{col}'] = df.groupby('root')[col].transform(lambda s: s.abs().shift(1).rolling(20, min_periods=10).median())
    out = []
    rng = np.random.default_rng(1)
    for sidecol, sname in (('F_c', 'C'), ('F_cv', 'CV')):
        for gate in ('G0', 'G1'):
            g = df[np.isfinite(df[sidecol]) & (df[sidecol] != 0)]
            if gate == 'G1':
                g = g[(g[sidecol].abs() >= g[f'med20_{sidecol}']) & ((g.gamma < 0) | (np.abs(g.dflip) >= 0.5))]
            if len(g) < 30:
                out.append(dict(side=sname, gate=gate, n=len(g)))
                continue
            side = np.sign(g[sidecol].to_numpy())
            r = side * g.ret.to_numpy()
            m, lo, hi = C.cluster_ci(r, g.session.to_numpy())
            # permutation: sides re-drawn by a fair coin per row
            perm = np.array([(np.where(rng.random(len(r)) < 0.5, 1, -1) * np.abs(r)).mean() for _ in range(4000)])
            p = float((perm >= m).mean())
            by_root = {k: float((np.sign(v[sidecol]) * v.ret).mean() * 1e4) for k, v in g.groupby('root')}
            by_year = {k: float((np.sign(v[sidecol]) * v.ret).mean() * 1e4) for k, v in g.groupby(g.session.str[:4])}
            hit = float((r > 0).mean())
            out.append(dict(side=sname, gate=gate, n=int(len(g)), sessions=int(g.session.nunique()), mean_bp=m * 1e4, lo_bp=lo * 1e4,
                            hi_bp=hi * 1e4, perm_p=p, hit=hit, by_root_bp=by_root, by_year_bp=by_year,
                            frac_short_gamma=float((g.gamma < 0).mean()), frac_buy=float((side > 0).mean()),
                            gate_pass=bool(lo > 0 and p < 0.0125 and m >= 3e-4)))
    rep = pd.DataFrame(out)
    pd.set_option('display.width', 250)
    print(rep.to_string(index=False))
    json.dump(out, open(os.path.join(OUT, f'c1_stageA_{split}.json'), 'w'), indent=1, default=float)
    return df, rep


if __name__ == '__main__':
    stage_a(sys.argv[2] if len(sys.argv) > 2 else 'DEV')
