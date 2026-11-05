"""Adaptive exit policies. Each is an object with
    on_entry(pos, ctx)  -> None        called once when the entry is fully filled (ctx.now = the fill time)
    check(pos, ctx)     -> str | None  called at every quote change of a held leg and at every driving event;
                                       a non-empty string is the exit reason (the engine then sends the sell order,
                                       which arrives latency_ms later and fills at the bid in force).
`pos.value` is the package's sellable value now (sum of leg bids x ratio, $ per share), `pos.entry_px` the price paid,
`pos.peak`/`pos.trough` the best/worst sellable value since the fill. Everything a policy reads comes from ctx, so it
is as of now; levels set at entry use only what was known at the fill.

Volatility-scaled levels use the package's expected move over a horizon:
    move = sum_legs |delta_leg| * ratio * S * sigma_1s * sqrt(horizon_s)
with sigma_1s the underlying's realized per-second log-return stdev over rv_window_s (ctx.realized_vol), S the
underlying now, delta from the latest 1-minute greeks row. (First order in S: for a straddle it measures how far one
leg can run, ignoring gamma.) A floor keeps the level at least floor_frac of the entry price away.
"""
from __future__ import annotations

import math

from sim.engine import clock


def package_move(pos, ctx, horizon_s, rv_window_s, sym=None) -> float:
    root = pos.legs[0][0].root
    sym = sym or root
    s = ctx.und(sym)
    sig = ctx.realized_vol(sym, rv_window_s)
    if not (s > 0) or not (sig > 0) or math.isnan(sig):
        return float('nan')
    d = 0.0
    for c, r in pos.legs:
        dd = ctx.delta(c)
        if math.isnan(dd):
            return float('nan')
        d += abs(dd) * r
    return d * s * sig * math.sqrt(horizon_s)


class FixedBracket:
    """Take profit at tp x entry, stop at sl x entry (on the bid). The protocol forbids this as the only exit;
    it is here for comparisons and baselines."""

    def __init__(self, tp=1.5, sl=0.5):
        self.tp, self.sl = tp, sl

    def on_entry(self, pos, ctx):
        pos.state['tp'] = self.tp * pos.entry_px
        pos.state['sl'] = self.sl * pos.entry_px

    def check(self, pos, ctx):
        if pos.value >= pos.state['tp']:
            return 'tp'
        if pos.value <= pos.state['sl']:
            return 'sl'
        return None


class VolBracket:
    """TP = entry + k_tp * move, SL = entry - k_sl * move, the move set at entry from realized vol (see module doc).
    If the move cannot be computed, falls back to fallback_frac of the entry price."""

    def __init__(self, k_tp=1.0, k_sl=1.0, horizon_s=1800, rv_window_s=900, floor_frac=0.05, fallback_frac=0.3, sym=None):
        self.k_tp, self.k_sl, self.h, self.w = k_tp, k_sl, horizon_s, rv_window_s
        self.floor, self.fb, self.sym = floor_frac, fallback_frac, sym

    def on_entry(self, pos, ctx):
        e = pos.entry_px
        m = package_move(pos, ctx, self.h, self.w, self.sym)
        if not (m > 0):
            m = self.fb * e
        m = max(m, self.floor * e)
        pos.state.update(tp=e + self.k_tp * m, sl=max(0.01, e - self.k_sl * m), move=m)

    def check(self, pos, ctx):
        if pos.value >= pos.state['tp']:
            return 'vol_tp'
        if pos.value <= pos.state['sl']:
            return 'vol_sl'
        return None


class TrailingVol:
    """Trailing stop: exit when value <= peak - k * move(now), move recomputed from the CURRENT realized vol and delta
    (re-read at most every refresh_s). Arms once the peak is at least arm_frac above the entry (0 = at once)."""

    def __init__(self, k=2.0, horizon_s=300, rv_window_s=600, arm_frac=0.0, refresh_s=15, sym=None):
        self.k, self.h, self.w, self.arm, self.refresh, self.sym = k, horizon_s, rv_window_s, arm_frac, refresh_s, sym

    def on_entry(self, pos, ctx):
        pos.state['tv_at'] = -1e18

    def check(self, pos, ctx):
        if pos.peak < pos.entry_px * (1 + self.arm):
            return None
        if ctx.now - pos.state['tv_at'] >= self.refresh * 1000:
            m = package_move(pos, ctx, self.h, self.w, self.sym)
            if m > 0:
                pos.state['tv_move'] = m
            pos.state['tv_at'] = ctx.now
        m = pos.state.get('tv_move')
        if m and pos.value <= pos.peak - self.k * m:
            return 'trail'
        return None


class TimeStop:
    """Exit after max_hold_s seconds held and/or at a clock time ('15:30')."""

    def __init__(self, max_hold_s=None, at=None):
        self.max_hold = max_hold_s
        self.at = clock(at) if isinstance(at, str) else at

    def on_entry(self, pos, ctx):
        pass

    def check(self, pos, ctx):
        if self.max_hold is not None and ctx.now - pos.entry_fill_ms >= self.max_hold * 1000:
            return 'time'
        if self.at is not None and ctx.now >= self.at:
            return 'clock'
        return None


class SignalDecay:
    """Exit when signal(ctx, pos) falls below threshold (after min_hold_s). The signal function must only use ctx."""

    def __init__(self, signal, threshold=0.0, min_hold_s=0):
        self.f, self.th, self.min_hold = signal, threshold, min_hold_s

    def on_entry(self, pos, ctx):
        pass

    def check(self, pos, ctx):
        if ctx.now - pos.entry_fill_ms < self.min_hold * 1000:
            return None
        v = self.f(ctx, pos)
        return 'decay' if v is not None and v < self.th else None


class FnExit:
    """Any user rule: fn(ctx, pos) -> reason or None; optional init(ctx, pos) at entry."""

    def __init__(self, fn, init=None):
        self.fn, self.init = fn, init

    def on_entry(self, pos, ctx):
        if self.init:
            self.init(ctx, pos)

    def check(self, pos, ctx):
        return self.fn(ctx, pos)


class AnyOf:
    """The first of several policies to fire."""

    def __init__(self, *policies):
        self.ps = policies

    def on_entry(self, pos, ctx):
        for p in self.ps:
            p.on_entry(pos, ctx)

    def check(self, pos, ctx):
        for p in self.ps:
            r = p.check(pos, ctx)
            if r:
                return r
        return None
