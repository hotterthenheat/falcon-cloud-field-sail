"""EDGE-D strategies (pre-registered in specs/PREREG.md). Everything they see comes through ctx (as-of now)."""
from __future__ import annotations

import os
import sys

FOUND = os.environ.get('V2_FOUNDATION',
                       '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a82a31a7b4c525883/slayer/research/compass-v2')
sys.path.insert(0, FOUND)
from sim.engine import Strategy, clock  # noqa: E402
from sim.exits import AnyOf, TimeStop, TrailingVol, VolBracket  # noqa: E402
from data.store import Contract  # noqa: E402


def _atm_pair(ctx, exp, atm):
    c = Contract('SPXW', exp, atm, 1); p = Contract('SPXW', exp, atm, -1)
    return c, p


class EventStraddle(Strategy):
    """D1/D1b: at t_entry buy the ATM call + put (both at ask, 2 s later), exit by the variant's policy.
    atm was fixed from chain rows stamped <= t_entry (fetch_events.forward; asserted there)."""
    timer_ms = 1000

    def __init__(self, exp, atm, t_entry, exit_factory, max_spread=0.08):
        self.exp, self.atm, self.t_entry, self.exit_factory, self.max_spread = exp, atm, t_entry, exit_factory, max_spread
        self.done = False
        self.start_at = None

    def on_event(self, ctx, ev):
        if self.done or ctx.now < self.t_entry:
            return
        self.done = True
        c, p = _atm_pair(ctx, self.exp, self.atm)
        qc, qp = ctx.quote(c), ctx.quote(p)
        if qc is None or qp is None or not qc.valid or not qp.valid:
            return
        if qc.spread > self.max_spread * qc.mid or qp.spread > self.max_spread * qp.mid:
            return
        if min(qc.as_, qp.as_) < 1:
            return
        ctx.buy([(c, 1), (p, 1)], 1, exit=self.exit_factory(), tag='straddle',
                meta={'abs_delta': 0.5, 'F0': ctx.und('SPX'), 'straddle_ask': qc.ask + qp.ask, 'straddle_mid': qc.mid + qp.mid})


class PostEventDrift(Strategy):
    """D2/D2b: side = sign(F(t_sig) - F(t_ref)) if |move| >= min_move; at t_pick buy the nearest-0.30|delta| contract of
    that side (band 0.25-0.40, spread <= 8%, size >= 1); contrast=True takes the opposite side."""
    timer_ms = 1000

    def __init__(self, t_ref, t_sig, t_pick, exit_factory, min_move=0.001, target_delta=0.30, band=(0.25, 0.40), contrast=False):
        self.t_ref, self.t_sig, self.t_pick = t_ref, t_sig, t_pick
        self.exit_factory, self.min_move, self.td, self.band, self.contrast = exit_factory, min_move, target_delta, band, contrast
        self.f_ref = None
        self.side = None
        self.done = False

    def on_event(self, ctx, ev):
        if self.done:
            return
        if self.f_ref is None and ctx.now >= self.t_ref:
            self.f_ref = ctx.und('SPX')
        if self.side is None and ctx.now >= self.t_sig and self.f_ref:
            f = ctx.und('SPX')
            mv = f / self.f_ref - 1
            if abs(mv) < self.min_move:
                self.done = True
                return
            self.side = 1 if mv > 0 else -1
            if self.contrast:
                self.side = -self.side
            self.move = mv
        if self.side is not None and ctx.now >= self.t_pick:
            self.done = True
            c = ctx.pick('SPXW', 0, self.side, self.td, band=self.band, max_spread_frac=0.08, min_size=1)
            if c is None:
                return
            ctx.buy(c, 1, exit=self.exit_factory(), tag='drift' + ('_contrast' if self.contrast else ''),
                    meta={'abs_delta': self.td, 'side': self.side, 'move5': self.move, 'F0': ctx.und('SPX')})


# ---- variants (exit factories), names as registered
def straddle_exits(T):
    """T = release clock ms. 08:30 -> X1 08:45, X2 09:00, X3 09:20; 14:00 -> 14:20, 14:45, 15:30."""
    if T == clock('08:30'):
        a, b, c = clock('08:45'), clock('09:00'), clock('09:20')
    else:
        a, b, c = clock('14:20'), clock('14:45'), clock('15:30')
    return {
        'X1': lambda: TimeStop(at=a),
        'X2': lambda: TimeStop(at=b),
        'X3': lambda: TimeStop(at=c),
        'X4': lambda: AnyOf(VolBracket(k_tp=1.0, k_sl=1.0, horizon_s=1800, rv_window_s=600, sym='SPX'), TimeStop(at=c)),
        'X5': lambda: AnyOf(TrailingVol(k=2.0, horizon_s=300, rv_window_s=600, arm_frac=0.3, sym='SPX'), TimeStop(at=c)),
    }


def drift_exits(flat_ms, T):
    quick = clock('09:35') if T == clock('08:30') else clock('14:30')
    return {
        'E1': lambda: AnyOf(VolBracket(k_tp=1.5, k_sl=1.0, horizon_s=1800, rv_window_s=600, sym='SPX'), TimeStop(at=flat_ms)),
        'E2': lambda: AnyOf(VolBracket(k_tp=2.0, k_sl=1.0, horizon_s=1800, rv_window_s=600, sym='SPX'),
                            TrailingVol(k=2.0, horizon_s=300, rv_window_s=600, arm_frac=0.5, sym='SPX'), TimeStop(at=flat_ms)),
        'E3': lambda: AnyOf(TrailingVol(k=1.5, horizon_s=300, rv_window_s=600, arm_frac=0.3, sym='SPX'), TimeStop(at=flat_ms)),
        'E4': lambda: TimeStop(at=quick),
    }
