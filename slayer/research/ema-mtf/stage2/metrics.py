"""The brief's required metrics (section 13) for any trade log, with session-clustered bootstrap CIs, and the day-type
regime labels.

metrics(trades, sessions): n, win rate, average winner / loser, expectancy (net and gross, % of premium), profit factor,
net profit $, return on premium deployed (sum net $ / sum premium + entry fees $), max drawdown $ (daily, in session
order), Sharpe and Sortino per day (zero-trade sessions count as 0) and annualised (sqrt 252), average / median holding
minutes, max consecutive losses, mean entry spread (% of mid), spread cost $ (half-spread at entry and exit vs mid),
slippage/latency cost $ (fill vs bar-end quote), gross vs net $. CIs: compass-v2 cluster_ci_mean (4000, seed 7, sessions
with no trade included as clusters).

regime(session): compass-v2 eval/metrics.py classify_session rules (fixed, untuned) on the 1-minute closes 09:35-15:55 of
SPX (index; SPY when SPX is missing): high_vol if annualised RV >= 25%; trend if |open -> close| >= 0.6% and the close sits
in the outer 25% of the range in the move's direction; else flat.
"""
from __future__ import annotations

import math
import os
import sys
from functools import lru_cache

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.walkforward import M as CM  # noqa: E402  (compass-v2 eval/metrics)
from edata.store import und_bars  # noqa: E402


@lru_cache(maxsize=4096)
def regime(session: str) -> str:
    for sym in ('SPX', 'SPY'):
        b = und_bars(sym, str(session))
        if len(b):
            break
    if not len(b):
        return 'unknown'
    b = b[(b['mod'] >= 575) & (b['mod'] <= 955)]
    p = b.c.to_numpy(float) / 1e4
    p = p[np.isfinite(p) & (p > 0)]
    if len(p) < 30:
        return 'unknown'
    r = np.diff(np.log(p))
    rv = float(np.sqrt(np.sum(r * r) * 252))
    o, c, hi, lo = p[0], p[-1], p.max(), p.min()
    ret = c / o - 1
    pos = (c - lo) / (hi - lo) if hi > lo else 0.5
    if rv >= 0.25:
        return 'high_vol'
    if abs(ret) >= 0.006 and ((ret > 0 and pos >= 0.75) or (ret < 0 and pos <= 0.25)):
        return 'trend'
    return 'flat'


def _streak(x: np.ndarray) -> int:
    best = cur = 0
    for v in x:
        cur = cur + 1 if v <= 0 else 0
        best = max(best, cur)
    return best


def metrics(t: pd.DataFrame, sessions=None, ci=True) -> dict:
    t = t[t.status == 'filled'] if 'status' in t and len(t) else t
    out = {'n': int(len(t))}
    if not len(t):
        return out
    sessions = sorted(map(str, sessions)) if sessions is not None else sorted(t.session.astype(str).unique())
    r = t.ret_net.to_numpy(float)
    w, l = r[r > 0], r[r <= 0]
    pn = t.pnl_net.to_numpy(float)
    ses = t.session.astype(str).to_numpy()
    cost = (t.entry_px.to_numpy(float) * 100 + t.fees.to_numpy(float) / 2)
    out.update({
        'win_rate': float((r > 0).mean()), 'avg_win': float(w.mean()) if len(w) else np.nan,
        'avg_loss': float(l.mean()) if len(l) else np.nan, 'expectancy': float(r.mean()),
        'median': float(np.median(r)), 'gross_expectancy': float(t.ret_gross.mean()),
        'mid_expectancy': float(np.nanmean(t.ret_mid.to_numpy(float))) if 'ret_mid' in t else np.nan,
        'profit_factor': float(pn[pn > 0].sum() / -pn[pn < 0].sum()) if (pn < 0).any() else np.inf,
        'net_profit': float(pn.sum()), 'gross_profit': float(t.pnl_gross.sum()), 'fees': float(t.fees.sum()),
        'roc': float(pn.sum() / cost.sum()), 'pnl_per_trade': float(pn.mean()),
        'hold_mean': float(t.hold_min.mean()), 'hold_median': float(t.hold_min.median()),
        'max_losing_streak': _streak(t.sort_values(['session', 'decision_m']).ret_net.to_numpy()),
        'entry_spread': float(t.entry_spread_frac.mean()),
    })
    # cost attribution ($ per trade): half-spread paid at entry and exit vs the mids; fill vs bar-end quote
    out['spread_cost'] = float(((t.entry_px - t.entry_mid) * 100).mean() + ((t.exit_mid - t.exit_px) * 100).clip(lower=0).mean())
    day = pd.Series(pn, index=ses).groupby(level=0).sum().reindex(sessions).fillna(0.0)
    dr = pd.Series(r, index=ses).groupby(level=0).mean().reindex(sessions).fillna(0.0)
    sd = dr.std(ddof=1)
    dn = dr[dr < 0]
    dsd = math.sqrt((dn ** 2).sum() / max(len(dr) - 1, 1)) if len(dn) else np.nan
    out.update({'sharpe_day': float(dr.mean() / sd) if sd > 0 else np.nan,
                'sortino_day': float(dr.mean() / dsd) if dsd and dsd > 0 else np.nan,
                'max_dd': float(CM.max_drawdown(day.to_numpy())), 'n_sessions': len(sessions)})
    out['sharpe_ann'] = out['sharpe_day'] * math.sqrt(252) if out['sharpe_day'] == out['sharpe_day'] else np.nan
    out['sortino_ann'] = out['sortino_day'] * math.sqrt(252) if out['sortino_day'] == out['sortino_day'] else np.nan
    sd_t = r.std(ddof=1)
    out['sharpe_trade'] = float(r.mean() / sd_t) if sd_t > 0 else np.nan
    if ci:
        extra = [s for s in sessions if s not in set(ses)]
        out['ci'] = CM.cluster_ci_mean(r, ses, extra_clusters=extra)
        out['ci_win'] = CM.cluster_ci_mean((r > 0).astype(float), ses, extra_clusters=extra)
        out['ci_gross'] = CM.cluster_ci_mean(t.ret_gross.to_numpy(float), ses, extra_clusters=extra)
    return out


def by(t: pd.DataFrame, col: str, sessions=None) -> dict:
    t = t[t.status == 'filled'] if len(t) else t
    return {k: metrics(g, sessions) for k, g in t.groupby(col)} if len(t) else {}


def with_labels(t: pd.DataFrame) -> pd.DataFrame:
    if not len(t):
        return t
    t = t.copy()
    t['regime'] = [regime(str(s)) for s in t.session]
    t['side'] = np.where(t.right.to_numpy() > 0, 'call', 'put')
    return t
