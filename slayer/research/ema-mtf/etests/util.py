"""Synthetic panels for the tests (no terminal, no store)."""
from __future__ import annotations

import numpy as np
import pandas as pd

EXP = 20240419
K = 500_000


class FakePanel:
    """Same reader interface as edata.store.Panel for the pieces the engine uses."""

    def __init__(self, root, q0: dict, q2: dict, tb: dict | None = None, res: int = 1):
        self.root = root
        self._q0, self._q2, self._tb, self._res = q0, q2, tb or {}, res

    def days(self):
        return sorted(self._q0)

    def q0(self, D):
        return self._q0.get(D, pd.DataFrame())

    def q2(self, D):
        return self._q2.get(D, pd.DataFrame())

    def tb(self, D):
        return self._tb.get(D, pd.DataFrame())

    def resolution(self, D, exp):
        return self._res if D in self._q0 else None


def random_walk_quotes(days, seed=1, start=2.0, vol=0.004, spread=0.02, size=20, exp=EXP, strike=K, right=1):
    """1-minute snapshots q0 (bar ends) and q2 (+2 s) of one contract: q2 = q0 of the same minute nudged by a small
    independent move (2 s of drift), both in cents."""
    rng = np.random.default_rng(seed)
    q0, q2 = {}, {}
    px = start
    for D in days:
        m = np.arange(390)
        steps = rng.normal(0, vol, 390)
        mids = px * np.exp(np.cumsum(steps))
        px = mids[-1]
        mids2 = mids * np.exp(rng.normal(0, vol / 6, 390))
        def mk(x, mm):
            return pd.DataFrame({'exp': exp, 'strike': strike, 'right': right, 'm': mm,
                                 'bid': np.round((x - spread / 2) * 100).astype(int),
                                 'ask': np.round((x + spread / 2) * 100).astype(int), 'bs': size, 'as': size})
        q0[D], q2[D] = mk(mids, m), mk(mids2, m)
        q2[D] = pd.concat([mk(mids[:1], np.array([-1])), q2[D]], ignore_index=True)
    return q0, q2


def minutes_frame(q0: dict, exp=EXP, strike=K, right=1) -> pd.DataFrame:
    rows = []
    for D, q in sorted(q0.items()):
        x = q[(q.exp == exp) & (q.strike == strike) & (q.right == right) & (q.m >= 0)]
        rows.append(pd.DataFrame({'session': int(D), 'm': x.m.to_numpy(), 'bid': x.bid / 100, 'ask': x.ask / 100}))
    df = pd.concat(rows, ignore_index=True)
    df['mid'] = (df.bid + df.ask) / 2
    df['c'] = df.mid
    return df
