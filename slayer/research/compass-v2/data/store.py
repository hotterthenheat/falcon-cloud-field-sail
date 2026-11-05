"""Read the v2 event-time store (written by data/fetch.py) into per-contract numpy arrays.

    from data.store import Session, list_sessions, Contract
    s = Session('20240417')
    c = s.contracts('SPXW', exp_index=0)[0]
    q = s.quotes(c)            # dict of numpy arrays: ms, bid, ask, bs, as   (cents / contracts; sorted by ms)
    g = s.greeks('SPXW')       # DataFrame: exp strike right ms bid ask delta iv und
    t = s.trades('SPXW')       # DataFrame of every option print with the NBBO in force (tick level)
    u = s.underlying('SPX')    # dict: ms, px (dollars)  — SPY/QQQ: ms, bid, ask, mid, bs, as

Nothing here knows about "now": the simulator (sim/engine.py) is the only thing a strategy sees, and it clamps
every lookup at the simulated clock. Research code should never hand a Session to a strategy.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

V2DATA = os.environ.get('V2DATA', '/home/user/falcon-cloud-field-sail/v2data')
UND_OF = {'SPXW': 'SPX', 'SPX': 'SPX', 'SPY': 'SPY', 'QQQ': 'QQQ'}


@dataclass(frozen=True, order=True)
class Contract:
    root: str
    exp: int      # YYYYMMDD
    strike: int   # dollars x 1000
    right: int    # +1 call, -1 put

    @property
    def k(self) -> float:
        return self.strike / 1000

    @property
    def is_call(self) -> bool:
        return self.right == 1

    def __str__(self):
        return f'{self.root} {self.exp} {self.k:g}{"C" if self.right == 1 else "P"}'

    @staticmethod
    def parse(s: str) -> 'Contract':
        root, exp, ks = s.split()
        return Contract(root, int(exp), int(round(float(ks[:-1]) * 1000)), 1 if ks[-1].upper() == 'C' else -1)


def list_sessions(root: str = V2DATA) -> list[str]:
    d = os.path.join(root, 'sessions')
    if not os.path.isdir(d):
        return []
    return sorted(x for x in os.listdir(d) if os.path.exists(os.path.join(d, x, '_manifest.json')))


def _split_by_contract(df: pd.DataFrame, root: str) -> dict:
    """df sorted by exp, strike, right, ms -> {Contract: {col: ndarray}}."""
    if df.empty:
        return {}
    key = df[['exp', 'strike', 'right']].to_numpy()
    brk = np.flatnonzero(np.any(key[1:] != key[:-1], axis=1)) + 1
    starts = np.r_[0, brk]
    ends = np.r_[brk, len(df)]
    # ms as int64: numpy's searchsorted casts the whole array when the key's dtype differs (45 us a call on int32)
    cols = {c: (df[c].to_numpy().astype(np.int64) if c == 'ms' else df[c].to_numpy())
            for c in df.columns if c not in ('exp', 'strike', 'right')}
    out = {}
    for a, b in zip(starts, ends):
        c = Contract(root, int(key[a, 0]), int(key[a, 1]), int(key[a, 2]))
        out[c] = {k: v[a:b] for k, v in cols.items()}
    return out


class Session:
    def __init__(self, day: str, root_dir: str = V2DATA):
        self.day = day.replace('-', '')
        self.dir = os.path.join(root_dir, 'sessions', self.day)
        mp = os.path.join(self.dir, '_manifest.json')
        if not os.path.exists(mp):
            raise FileNotFoundError(f'no store for {self.day} under {root_dir} (run data/fetch.py)')
        self.manifest = json.load(open(mp))
        self._q: dict = {}

    def __repr__(self):
        return f'Session({self.day})'

    @property
    def roots(self) -> list[str]:
        return [r for r in self.manifest['roots'] if os.path.exists(self._p(f'{r}_quotes'))]

    def expirations(self, root: str) -> list[int]:
        return [int(e) for e in self.manifest['roots'][root]['expirations']]

    def _p(self, name):
        return os.path.join(self.dir, name + '.parquet')

    def _read(self, name) -> pd.DataFrame:
        p = self._p(name)
        return pq.read_table(p).to_pandas() if os.path.exists(p) else pd.DataFrame()

    def quotes_all(self, root: str) -> dict:
        if root not in self._q:
            self._q[root] = _split_by_contract(self._read(f'{root}_quotes'), root)
        return self._q[root]

    def contracts(self, root: str, exp_index: int | None = None) -> list[Contract]:
        cs = sorted(self.quotes_all(root))
        if exp_index is None:
            return cs
        exps = self.expirations(root)
        if exp_index >= len(exps):
            return []
        return [c for c in cs if c.exp == exps[exp_index]]

    def quotes(self, c: Contract) -> dict:
        return self.quotes_all(c.root)[c]

    @lru_cache(maxsize=8)
    def greeks(self, root: str) -> pd.DataFrame:
        return self._read(f'{root}_greeks_1m')

    @lru_cache(maxsize=8)
    def oi(self, root: str) -> pd.DataFrame:
        return self._read(f'{root}_oi')

    @lru_cache(maxsize=8)
    def trades(self, root: str) -> pd.DataFrame:
        return self._read(f'{root}_trades')

    @lru_cache(maxsize=8)
    def underlying(self, sym: str) -> dict:
        sym = UND_OF.get(sym, sym)
        if sym == 'SPX':
            df = self._read('und_SPX_price')
            px = df.px.to_numpy() / 10000
            return {'ms': df.ms.to_numpy().astype(np.int64), 'px': px}
        df = self._read(f'und_{sym}_quotes')
        bid, ask = df.bid.to_numpy() / 10000, df.ask.to_numpy() / 10000
        ok = (bid > 0) & (ask > 0) & (ask >= bid)
        mid = np.where(ok, (bid + ask) / 2, np.nan)
        mid = pd.Series(mid).ffill().to_numpy()
        return {'ms': df.ms.to_numpy().astype(np.int64), 'px': mid, 'bid': bid, 'ask': ask, 'bs': df.bs.to_numpy(), 'as': df['as'].to_numpy()}

    @lru_cache(maxsize=8)
    def stock_trades(self, sym: str) -> pd.DataFrame:
        return self._read(f'und_{sym}_trades')

    @lru_cache(maxsize=8)
    def uw(self, name: str) -> pd.DataFrame:
        """uw('alerts_SPY'), uw('gex_SPX') ... (strings as the vendor sent them; empty before 2023-12-06)."""
        return self._read(f'uw_{name}')

    def bytes(self) -> int:
        return self.manifest.get('bytes_total', 0)
