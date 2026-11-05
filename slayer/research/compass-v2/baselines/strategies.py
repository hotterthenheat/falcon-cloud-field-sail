"""Three dumb baselines (no edge by design): what 'nothing' looks like after real costs.

B1 RandomSide30   10:00, coin-flip call or put, 0DTE contract nearest 0.30 |delta| (0.15-0.50, spread <= 8% of mid),
                  vol-scaled bracket (TP/SL = entry +/- 1.0 x the 30-minute expected option move from 30-minute realized
                  vol) or 15:50.
B2 OpenStraddle   09:35 (first time 5 minutes of realized vol exist), buy the 0DTE straddle at the strike nearest the
                  underlying, the same vol bracket on the package's bid value, or 15:50.
B3 First15Side    09:45, the side of the 09:30->09:45 underlying move, 0DTE contract nearest 0.30 |delta|, same exit.
One position per root (SPXW, SPY, QQQ) per session per baseline; sessions without a same-day expiry are skipped.
"""
from __future__ import annotations

import numpy as np

from sim.engine import Strategy, clock
from sim.exits import AnyOf, TimeStop, VolBracket

ROOTS = ('SPXW', 'SPY', 'QQQ')


def bracket():
    return AnyOf(VolBracket(k_tp=1.0, k_sl=1.0, horizon_s=1800, rv_window_s=1800, fallback_frac=0.3), TimeStop(at='15:50'))


def same_day(ctx, root) -> bool:
    exps = ctx.expirations(root)
    return bool(exps) and exps[0] == int(ctx.day)


class _Once(Strategy):
    timer_ms = 1000
    at = '10:00'

    def __init__(self, roots=ROOTS):
        self.roots = [r for r in roots]
        self.done = set()

    def decide(self, ctx, root):
        raise NotImplementedError

    def on_event(self, ctx, ev):
        if ctx.now < clock(self.at):
            return
        for root in self.roots:
            if root in self.done:
                continue
            self.done.add(root)
            if same_day(ctx, root):
                self.decide(ctx, root)


class RandomSide30(_Once):
    at = '10:00'

    def decide(self, ctx, root):
        rng = np.random.default_rng(int(ctx.day) * 10 + ROOTS.index(root))
        right = 1 if rng.random() < 0.5 else -1
        c = ctx.pick(root, 0, right, 0.30)
        if c is not None:
            ctx.buy(c, 1, exit=bracket(), tag='B1', meta={'right': right})


class OpenStraddle(_Once):
    at = '09:35'

    def decide(self, ctx, root):
        s = ctx.und(root)
        ch = ctx.chain(root, 0)
        if ch.empty or not s > 0:
            return
        ks = sorted(set(ch.strike.tolist()), key=lambda k: abs(k / 1000 - s))
        for k in ks[:3]:
            legs = [c for c in ch.contract if c.strike == k]
            call = [c for c in legs if c.right == 1]
            put = [c for c in legs if c.right == -1]
            if call and put:
                qc, qp = ctx.quote(call[0]), ctx.quote(put[0])
                if qc is not None and qp is not None and qc.valid and qp.valid:
                    ctx.buy([(call[0], 1), (put[0], 1)], 1, exit=bracket(), tag='B2', meta={'strike': k / 1000})
                    return


class First15Side(_Once):
    at = '09:45'

    def decide(self, ctx, root):
        p = ctx.und_series(root, 15 * 60)
        p = p[np.isfinite(p)]
        if len(p) < 2 or p[-1] == p[0]:
            return
        right = 1 if p[-1] > p[0] else -1
        c = ctx.pick(root, 0, right, 0.30)
        if c is not None:
            ctx.buy(c, 1, exit=bracket(), tag='B3', meta={'right': right, 'move': float(p[-1] / p[0] - 1)})


BASELINES = {'B1_random_side_30d': RandomSide30, 'B2_open_straddle': OpenStraddle, 'B3_first15_side': First15Side}
