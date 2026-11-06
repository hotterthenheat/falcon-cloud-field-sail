"""Bulk bars (engine/bars.py) == per-contract chart (engine/chart.py)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.bars import asof_index, asof_row, mid_bars, trade_bars
from engine.chart import ContractChart, contract_minutes
from etests.util import EXP, K, FakePanel, random_walk_quotes

DAYS = ['20240415', '20240416', '20240417']


class _P(FakePanel):
    def manifest(self, D):
        return {'tiers': {str(EXP): 'use'}}


def test_bulk_mid_and_trade_bars_equal_contract_chart():
    rng = np.random.default_rng(2)
    q0, q2 = random_walk_quotes(DAYS, seed=8)
    # knock out some end quotes (one-sided) and build sparse prints
    tb = {}
    for D in DAYS:
        x = q0[D]
        bad = rng.random(len(x)) < 0.05
        x.loc[bad, 'bid'] = 0
        mid = (x.bid + x.ask) // 2
        keep = rng.random(len(x)) < 0.3
        tb[D] = pd.DataFrame({'exp': EXP, 'strike': K, 'right': 1, 'm': x.m[keep].to_numpy(), 'o': mid[keep].to_numpy(),
                              'h': mid[keep].to_numpy() + 1, 'l': mid[keep].to_numpy() - 1, 'c': mid[keep].to_numpy(), 'v': 3, 'n': 1})
    p = _P('SPY', q0, q2, tb)
    ch = ContractChart(contract_minutes(p, EXP, K, 1, DAYS))
    for tf in (1, 5, 15, 60):
        mb = mid_bars(p, DAYS, tf)
        a = ch.tables[('mid', tf)]
        assert len(mb) == len(a), (tf, len(mb), len(a))
        assert np.allclose(mb.c.to_numpy(), a.c.to_numpy()) and (mb.known_ms.to_numpy() == a.known_ms.to_numpy()).all()
        for n in (9, 21, 200):
            x, y = mb[f'ema{n}'].to_numpy(), a[f'ema{n}'].to_numpy()
            assert np.array_equal(np.isnan(x), np.isnan(y)) and np.allclose(x[~np.isnan(x)], y[~np.isnan(y)])
        tbb = trade_bars(p, DAYS, tf)
        t = ch.tables[('trade', tf)]
        assert len(tbb) == len(t) and np.allclose(tbb.c.to_numpy(), t.c.to_numpy()), tf
        assert np.allclose(np.nan_to_num(tbb.ema21.to_numpy()), np.nan_to_num(t.ema21.to_numpy()))
    idx = asof_index(mb)
    i = asof_row(mb, idx, (EXP, K, 1), 20240416, (570 + 120) * 60_000)
    assert mb.known_ms.iloc[i] <= (570 + 120) * 60_000 and mb.session.iloc[i] == 20240416
