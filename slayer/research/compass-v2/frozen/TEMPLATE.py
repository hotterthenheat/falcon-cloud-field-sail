"""FROZEN SPEC — template (this one freezes baseline B3 so the scorer can be exercised on DEV; it is not a candidate).

One self-contained file. Copy it to frozen/<ID>.py, fill SPEC and the strategy, commit, and hand the scorer ONLY
the path and the commit hash:  python3 -m eval.score_frozen --spec frozen/<ID>.py --commit <hash> --split LOCKED
Rules (checked by sim/lint.py): import only sim.*, numpy, math, and `from data.store import Contract`; no file,
network or private-attribute access; every number the strategy uses is written here.
"""
import numpy as np

from sim.engine import Strategy, clock
from sim.exits import AnyOf, TimeStop, VolBracket

SPEC = {
    'id': 'TEMPLATE-B3',
    'registered_commit': None,          # hash of the commit that pre-registered this hypothesis in the ledger
    'mechanism': 'none (baseline): buys the side of the first 15 minutes; expected sign <= 0 after costs',
    'roots': ['SPXW', 'SPY', 'QQQ'],
    'sim': {'latency_ms': 2000, 'fee_per_contract': 0.65},
    'feeds': [],                        # e.g. ['uw_alerts:SPY'] — events stamped at publication
    'ret': 'ret_net',
    'trials_at_freeze': 3,              # the ledger's total trial count when frozen (for the deflated Sharpe)
    'sr_var_trials': None,              # variance of the trials' per-trade Sharpes, if known
}


def exit_policy():
    return AnyOf(VolBracket(k_tp=1.0, k_sl=1.0, horizon_s=1800, rv_window_s=1800, fallback_frac=0.3), TimeStop(at='15:50'))


class Frozen(Strategy):
    timer_ms = 1000

    def __init__(self):
        self.done = set()

    def on_event(self, ctx, ev):
        if ctx.now < clock('09:45'):
            return
        for root in SPEC['roots']:
            if root in self.done:
                continue
            self.done.add(root)
            exps = ctx.expirations(root)
            if not exps or exps[0] != int(ctx.day):
                continue
            p = ctx.und_series(root, 900)
            p = p[np.isfinite(p)]
            if len(p) < 2 or p[-1] == p[0]:
                continue
            c = ctx.pick(root, 0, 1 if p[-1] > p[0] else -1, 0.30)
            if c is not None:
                ctx.buy(c, 1, exit=exit_policy(), tag=SPEC['id'])


def make_strategy(day):
    return Frozen()
