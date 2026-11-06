"""Read the EMA-MTF panel (edata/panel.py). Research code reads this; a strategy only ever sees engine/ objects that are
clamped at the decision time (engine/execution.py, engine/chart.py).

    p = Panel('SPY')
    p.days()                      # sessions stored (sorted)
    p.q0('20240305')              # exp strike right m bid ask bs as  (cents; m = bar the snapshot closes)
    p.q2('20240305'); p.tb('20240305'); p.gx('20240305'); p.oi('20240305'); p.manifest('20240305')
    und_bars('SPY', '20240305')   # mod o h l c v n (1/10000 $)
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

import pandas as pd

from edata.common import EMA_DATA

PANEL = os.path.join(EMA_DATA, 'panel')
UND_DIR = os.path.join(EMA_DATA, 'und')


class Panel:
    def __init__(self, root: str, base: str = PANEL):
        self.root = root
        self.dir = os.path.join(base, root)

    def days(self) -> list[str]:
        if not os.path.isdir(self.dir):
            return []
        return sorted(d for d in os.listdir(self.dir) if d.isdigit() and os.path.exists(os.path.join(self.dir, d, '_manifest.json')))

    def plan(self, block: str) -> dict:
        return json.load(open(os.path.join(self.dir, f'plan_{block}.json')))

    @lru_cache(maxsize=256)
    def manifest(self, D: str) -> dict:
        return json.load(open(os.path.join(self.dir, D, '_manifest.json')))

    def _read(self, D, name) -> pd.DataFrame:
        p = os.path.join(self.dir, D, f'{name}.parquet')
        if not os.path.exists(p):
            return pd.DataFrame()
        df = pd.read_parquet(p)
        if 'm' in df:
            df['m'] = df.m.astype('int64')      # stored int16; times are computed from it in ms
        return df

    @lru_cache(maxsize=6)
    def q0(self, D):
        return self._read(D, 'q0')

    @lru_cache(maxsize=6)
    def q2(self, D):
        return self._read(D, 'q2')

    @lru_cache(maxsize=6)
    def tb(self, D):
        return self._read(D, 'tb')

    @lru_cache(maxsize=6)
    def gx(self, D):
        return self._read(D, 'gx')

    @lru_cache(maxsize=6)
    def gxp(self, D):
        return self._read(D, 'gxp')

    @lru_cache(maxsize=6)
    def oi(self, D):
        p = os.path.join(self.dir, 'oi', f'{D}.parquet')
        return pd.read_parquet(p) if os.path.exists(p) else pd.DataFrame()

    def resolution(self, D: str, exp: int) -> int | None:
        """1 (1-minute snapshots) or 15 (15-minute snapshots) for this expiration's quotes on D; None if absent."""
        t = self.manifest(D)['tiers'].get(str(exp))
        if t is None:
            return None
        return 15 if t == 'coarse' else 1


@lru_cache(maxsize=512)
def und_bars(sym: str, D: str) -> pd.DataFrame:
    p = os.path.join(UND_DIR, sym, f'{D}.parquet')
    return pd.read_parquet(p) if os.path.exists(p) else pd.DataFrame()
