"""An in-memory session with the same reader interface as data.store.Session (used by tests and sim/synthetic.py)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from data.store import Contract


class MemSession:
    def __init__(self, day: str, quotes: dict, greeks: dict | None = None, underlying: dict | None = None,
                 trades: dict | None = None, expirations: dict | None = None):
        """quotes: {Contract: {'ms','bid','ask','bs','as'} arrays (bid/ask in CENTS, like the store)}
        greeks: {root: DataFrame(exp, strike, right, ms, delta, iv, und)}; underlying: {sym: {'ms','px'}}."""
        self.day = day
        self._q = {c: {k: np.asarray(v) for k, v in q.items()} for c, q in quotes.items()}
        self._g = greeks or {}
        self._u = underlying or {}
        self._t = trades or {}
        roots = sorted({c.root for c in self._q})
        self._exp = expirations or {r: sorted({c.exp for c in self._q if c.root == r}) for r in roots}
        self.manifest = {'roots': {r: {} for r in roots}}

    @property
    def roots(self):
        return list(self.manifest['roots'])

    def expirations(self, root):
        return self._exp.get(root, [])

    def contracts(self, root, exp_index=None):
        cs = sorted(c for c in self._q if c.root == root)
        if exp_index is None:
            return cs
        e = self.expirations(root)
        return [c for c in cs if exp_index < len(e) and c.exp == e[exp_index]]

    def quotes(self, c: Contract):
        return self._q[c]

    def greeks(self, root):
        return self._g.get(root, pd.DataFrame())

    def trades(self, root):
        return self._t.get(root, pd.DataFrame())

    def underlying(self, sym):
        from data.store import UND_OF
        return self._u[UND_OF.get(sym, sym)]

    def oi(self, root):
        return pd.DataFrame()

    def uw(self, name):
        return pd.DataFrame()
