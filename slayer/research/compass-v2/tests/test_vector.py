"""The vectorized exit scan must make exactly the decisions of the change-by-change path."""
import numpy as np
import pandas as pd

from sim.engine import Engine, SimConfig, Strategy, clock
from sim.exits import AnyOf, FixedBracket, TimeStop, TrailingVol, VolBracket
from sim.memsession import MemSession
from tests.test_engine import C, P


def _walk_session(seed):
    rng = np.random.default_rng(seed)
    qs = {}
    for c in (C, P):
        t = np.unique(np.sort(rng.integers(clock('09:30'), clock('16:00'), 20000)))
        mid = np.clip(200 + np.cumsum(rng.normal(0, 1.5, len(t))), 6, None)
        qs[c] = {'ms': t, 'bid': (mid - 3).astype(np.int32), 'ask': (mid + 3).astype(np.int32),
                 'bs': rng.integers(1, 30, len(t)).astype(np.int32), 'as': rng.integers(1, 30, len(t)).astype(np.int32)}
    tu = np.arange(clock('09:30'), clock('16:00') + 1, 1000)
    px = 500 * np.exp(np.cumsum(rng.normal(0, 2e-4, len(tu))))
    gm = np.arange(clock('09:30'), clock('16:00'), 60_000)
    g = pd.concat([pd.DataFrame({'exp': 20240417, 'strike': 500_000, 'right': r, 'ms': gm, 'delta': 0.3 * r, 'iv': 0.2,
                                 'und': 500.0, 'bid': 0, 'ask': 0}) for r in (1, -1)])
    return MemSession('20240417', qs, greeks={'SPY': g}, underlying={'SPY': {'ms': tu, 'px': px}})


class Many(Strategy):
    timer_ms = 1000

    def __init__(self, make_exit, plan):
        self.make_exit, self.plan = make_exit, list(plan)

    def on_event(self, ctx, ev):
        while self.plan and ctx.now >= self.plan[0][0]:
            _, legs, q = self.plan.pop(0)
            ctx.buy(legs, q, exit=self.make_exit())


def test_vectorized_exit_scan_matches_change_by_change():
    exits = [lambda: FixedBracket(1.3, 0.7),
             lambda: AnyOf(VolBracket(1.0, 1.0, horizon_s=600, rv_window_s=300), TimeStop(max_hold_s=1500)),
             lambda: AnyOf(TrailingVol(k=1.5, horizon_s=120, rv_window_s=300, arm_frac=0.05), TimeStop(at='15:00')),
             lambda: AnyOf(VolBracket(2.0, 0.5), TrailingVol(k=3.0, refresh_s=5), TimeStop(max_hold_s=3600))]
    plan = [(clock('09:45'), C, 3), (clock('10:30'), [(C, 1), (P, 1)], 2), (clock('11:00'), P, 5),
            (clock('13:00'), C, 1), (clock('14:30'), [(C, 1), (P, 1)], 1)]
    compared = 0
    for seed in range(4):
        s = _walk_session(seed)
        for mk in exits:
            a = Engine(s, Many(mk, plan), SimConfig(vectorized_exits=True, entry_chase_ms=3000)).run()
            b = Engine(s, Many(mk, plan), SimConfig(vectorized_exits=False, entry_chase_ms=3000)).run()
            assert len(a) == len(b) > 0
            for x, y in zip(a, b):
                for k in ('entry_ms', 'entry_px', 'exit_decision_ms', 'exit_ms', 'exit_px', 'reason', 'mae', 'mfe',
                          'mae_ms', 'mfe_ms', 'qty'):
                    assert x[k] == y[k] or (isinstance(x[k], float) and abs(x[k] - y[k]) < 1e-9), (seed, k, x[k], y[k])
                compared += 1
    assert compared >= 60
