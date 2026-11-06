"""Entry models A-H, MTF combination models A-F and exit methods 1-10, exactly as specs/STRATEGY_SPEC.md section 7-8
defines them. Every function reads only bars whose known_ms <= the decision time (the tables carry known_ms; the
caller hands in the rows known so far). Phase 1 runs none of these on outcomes except the baselines' simple cross.

A bar table here is one (series, timeframe) EMA table from engine/chart.py or engine/underlying.py:
columns session, b, known_ms, c (and o/h/l when the series has them), ema{N}, seen{N}.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# ------------------------------------------------------------------ bar-level states (vectorised over a table)


def state(t: pd.DataFrame, f: int = 9, s: int = 21) -> np.ndarray:
    """+1 bullish (close > EMAs and EMA_f > EMA_s), -1 bearish (mirror), 0 otherwise; NaN EMAs -> 0."""
    c, ef, es = t.c.to_numpy(), t[f'ema{f}'].to_numpy(), t[f'ema{s}'].to_numpy()
    up = (c > ef) & (ef > es)
    dn = (c < ef) & (ef < es)
    return np.where(up, 1, np.where(dn, -1, 0))


def warm(t: pd.DataFrame, n: int, mult: float = 1.0) -> np.ndarray:
    return t[f'seen{n}'].to_numpy() >= mult * n


def atr_close(t: pd.DataFrame, n: int = 14) -> np.ndarray:
    """ATR of a close-only series: Wilder mean of |close change| x 1.25 (the mean-absolute -> range factor is a fixed
    convention, not fitted); with o/h/l present, the true range."""
    c = t.c.to_numpy(float)
    if {'h', 'l'} <= set(t.columns) and t.h.notna().all():
        pc = np.r_[np.nan, c[:-1]]
        tr = np.nanmax(np.c_[t.h - t.l, np.abs(t.h - pc), np.abs(t.l - pc)], axis=1)
    else:
        tr = np.abs(np.diff(c, prepend=np.nan)) * 1.25
    out = np.full(len(c), np.nan)
    if len(c) > n:
        a = np.nanmean(tr[1:n + 1])
        out[n] = a
        for i in range(n + 1, len(c)):
            a = (a * (n - 1) + tr[i]) / n
            out[i] = a
    return out


# ------------------------------------------------------------------ entry models (boolean per bar, at bar close)

def entry_A_reclaim(t, n=9):
    c, e = t.c.to_numpy(), t[f'ema{n}'].to_numpy()
    pc, pe = np.r_[np.nan, c[:-1]], np.r_[np.nan, e[:-1]]
    return (pc < pe) & (c > e) & warm(t, n)


def entry_B_cross(t, f=9, s=21):
    ef, es = t[f'ema{f}'].to_numpy(), t[f'ema{s}'].to_numpy()
    pf, ps = np.r_[np.nan, ef[:-1]], np.r_[np.nan, es[:-1]]
    return (pf <= ps) & (ef > es) & warm(t, s)


def entry_C_alignment(t, hold=3, hi_n=5):
    c = t.c.to_numpy()
    al = (c > t.ema9.to_numpy()) & (t.ema9.to_numpy() > t.ema21.to_numpy()) & (t.ema21.to_numpy() > t.ema50.to_numpy())
    run = pd.Series(al.astype(int)).groupby((~pd.Series(al)).cumsum()).cumsum().to_numpy()
    prior_hi = pd.Series(c).shift(1).rolling(hi_n).max().to_numpy()
    return (run >= hold) & (c > prior_hi) & warm(t, 50)


def entry_D_compression(t, look=100, q=0.2, brk=10):
    e = np.c_[t.ema9.to_numpy(), t.ema21.to_numpy(), t.ema50.to_numpy()]
    c = t.c.to_numpy()
    width = (e.max(1) - e.min(1)) / c
    thr = pd.Series(width).shift(1).rolling(look, min_periods=look // 2).quantile(q).to_numpy()
    comp_prev = np.r_[False, (width <= thr)[:-1]]
    prior_hi = pd.Series(c).shift(1).rolling(brk).max().to_numpy()
    return comp_prev & (c > e.max(1)) & (c > prior_hi) & warm(t, 50)


def entry_E_pullback(ltf, htf_state_at_ltf, touch_n=3):
    """htf_state_at_ltf: the HTF state as of each LTF bar (as-of join, completed HTF bars only)."""
    c, e9, e21 = ltf.c.to_numpy(), ltf.ema9.to_numpy(), ltf.ema21.to_numpy()
    low = ltf.l.to_numpy() if 'l' in ltf and ltf.l.notna().all() else c
    touched = pd.Series(low <= e21).rolling(touch_n, min_periods=1).max().to_numpy().astype(bool)
    pc, pe9 = np.r_[np.nan, c[:-1]], np.r_[np.nan, e9[:-1]]
    return (np.asarray(htf_state_at_ltf) == 1) & touched & (pc <= pe9) & (c > e9) & warm(ltf, 21)


def entry_F_vwap(opt_trigger, und_close, und_vwap, und_ema21, right):
    side = np.sign(right)
    ok = (side * (und_close - und_vwap) > 0) & (side * (und_close - und_ema21) > 0)
    return np.asarray(opt_trigger) & ok


def entry_G_gex(opt_trigger, net_gex, spot, wall_against, right, min_gap=0.003):
    """Dealer short gamma (amplifying) and no wall within min_gap against the trade's direction."""
    gap = np.where(np.sign(right) > 0, wall_against / spot - 1, 1 - wall_against / spot)
    ok = (np.asarray(net_gex) < 0) & ((gap > min_gap) | ~np.isfinite(gap))
    return np.asarray(opt_trigger) & ok


def entry_H_transition(t, decl=3):
    c, e5, e9, e21 = (t[x].to_numpy() for x in ('c', 'ema5', 'ema9', 'ema21'))
    d5 = np.diff(e5, prepend=np.nan)
    down_run = pd.Series((d5 < 0).astype(int)).groupby((~pd.Series(d5 < 0)).cumsum()).cumsum().shift(1).fillna(0).to_numpy()
    d9 = np.diff(e9, prepend=np.nan)
    return (d5 > 0) & (down_run >= decl) & (c > e5) & (c < e21) & (d9 >= 0) & warm(t, 21)


ENTRY = {'A': entry_A_reclaim, 'B': entry_B_cross, 'C': entry_C_alignment, 'D': entry_D_compression, 'H': entry_H_transition}

# ------------------------------------------------------------------ MTF combination (at an LTF decision bar)
TF_WEIGHT = {1: 1, 5: 2, 15: 3, 30: 4, 60: 5}


def mtf_combine(model: str, ltf_trigger: bool, htf_states: dict, htf_trigger_age: dict | None = None,
                htf_slope_up: dict | None = None, k_of_n: int | None = None, seq_window: int = 3) -> bool:
    """htf_states: {tf: -1/0/+1 of the last COMPLETED bar of tf} for the higher timeframes in the model.
    A sequential: a higher-TF trigger fired within the last seq_window LTF bars, then the LTF trigger.
    B HTF-first: the highest TF bullish, then the LTF trigger.
    C full alignment: every listed TF bullish and the LTF trigger.
    D weighted: sum(w_tf * state_tf) / sum(w_tf) >= 0.6 and the LTF trigger (weights 1,2,3,4,5 for 1m..1h).
    E partial: at least k_of_n (default ceil(n/2)+... = majority) TFs bullish and the LTF trigger.
    F momentum transition: the LTF trigger is an H transition, every HTF still <= 0, and each HTF EMA5 slope > 0."""
    if not ltf_trigger:
        return False
    tfs = sorted(htf_states)
    st = np.array([htf_states[t] for t in tfs])
    if model == 'A':
        return bool(htf_trigger_age) and min(htf_trigger_age.values()) <= seq_window
    if model == 'B':
        return st[-1] == 1
    if model == 'C':
        return bool((st == 1).all())
    if model == 'D':
        w = np.array([TF_WEIGHT[t] for t in tfs], float)
        return float((w * st).sum() / w.sum()) >= 0.6
    if model == 'E':
        k = k_of_n or (len(tfs) // 2 + 1)
        return int((st == 1).sum()) >= k
    if model == 'F':
        return bool((st <= 0).all()) and bool(htf_slope_up) and all(htf_slope_up.values())
    raise KeyError(model)


# ------------------------------------------------------------------ exits 1-10 (stateful policies for engine/execution.py)

class _Exit:
    """Base: views come from execution.Simulator (session, m, now_ms, bid/ask/mid at the bar close). Chart values
    are read through `chart_at(now)` -> dict of the trigger-TF bar known at now (EMAs, c), supplied by the caller."""
    name = 'base'

    def __init__(self, chart_at, stop_frac: float | None = None):
        self.chart_at = chart_at
        self.stop_frac = stop_frac

    def start(self, info):
        self.entry = info
        self.e0 = self.chart_at(info['session'], (9 * 60 + 30 + info['m'] + 1) * 60_000)

    def bar(self, v):
        return self.chart_at(v['session'], v['now_ms'])

    def check(self, v):
        raise NotImplementedError


class X1NextEMA(_Exit):
    """Target: the nearest EMA level ABOVE the entry mid at entry (frozen); stop: the nearest EMA level BELOW (frozen),
    else -1 x the entry ATR. Triggers on the mid at a bar close."""
    name = 'X1'
    LEVELS = (9, 15, 20, 21, 50, 100, 200)

    def start(self, info):
        super().start(info)
        lv = [self.e0.get(f'ema{n}') for n in self.LEVELS] if self.e0 else []
        lv = [x for x in lv if x is not None and x == x]
        m0 = info['entry_mid']
        up, dn = [x for x in lv if x > m0], [x for x in lv if x < m0]
        self.tp = min(up) if up else m0 * 1.5
        self.sl = max(dn) if dn else m0 * 0.7

    def check(self, v):
        x = v['mid']
        if x != x:
            return None
        return 'x1_target' if x >= self.tp else ('x1_stop' if x <= self.sl else None)


class X3Hold9(_Exit):
    name = 'X3'

    def check(self, v):
        b = self.bar(v)
        if b and b.get('ema9') == b.get('ema9') and b['c'] < b['ema9'] and b['known_ms'] > self.e0['known_ms']:
            return 'x3_below9'
        return None


class X4Cross920(_Exit):
    name = 'X4'

    def check(self, v):
        b = self.bar(v)
        if b and b['known_ms'] > self.e0['known_ms'] and b['ema9'] < b['ema20']:
            return 'x4_cross'
        return None


class X7ATR(_Exit):
    """Bracket at entry mid -/+ (k_sl, k_tp) x ATR of the trigger TF at entry (frozen)."""
    name = 'X7'

    def __init__(self, chart_at, atr_at, k_sl=1.5, k_tp=3.0):
        super().__init__(chart_at)
        self.atr_at, self.k_sl, self.k_tp = atr_at, k_sl, k_tp

    def start(self, info):
        super().start(info)
        a = self.atr_at(info['session'], (9 * 60 + 30 + info['m'] + 1) * 60_000)
        m0 = info['entry_mid']
        a = a if a and a == a else 0.1 * m0
        self.sl, self.tp = m0 - self.k_sl * a, m0 + self.k_tp * a

    def check(self, v):
        x = v['mid']
        if x != x:
            return None
        return 'x7_tp' if x >= self.tp else ('x7_sl' if x <= self.sl else None)


class X8FixedRR(_Exit):
    """Comparison only (protocol rule 5): -20% / +40% of the entry fill on the mid."""
    name = 'X8'

    def __init__(self, chart_at, sl=0.20, tp=0.40):
        super().__init__(chart_at)
        self.sl, self.tp = sl, tp

    def check(self, v):
        x = v['mid']
        if x != x:
            return None
        e = self.entry['entry_px']
        return 'x8_tp' if x >= e * (1 + self.tp) else ('x8_sl' if x <= e * (1 - self.sl) else None)


class XTime(_Exit):
    """Hold a fixed number of minutes (baselines)."""
    name = 'XT'

    def __init__(self, minutes: int):
        super().__init__(lambda s, t: None)
        self.minutes = minutes

    def start(self, info):
        self.entry = info

    def check(self, v):
        return 'time' if v['bars'] >= self.minutes else None
