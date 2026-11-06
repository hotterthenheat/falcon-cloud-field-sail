"""Stage-2 fast simulator == engine/execution.Simulator + engine/signals.py exit classes, trade by trade.

Every exit (1-10, and the 30-minute time exit) is run from every 5-minute entry of a synthetic contract with
one-sided quotes and zero bid sizes mixed in, at L0c, L0 and L60, with and without a 1-tick slippage; the decision bar,
the exit reason, the fill and every return must be identical. Also: look-ahead of the exit contexts (noise after the
exit decision does not change the exit) with a canary (an exit reading the next bar's mid must change).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine import signals as SG
from engine.bars import add_emas
from engine.execution import ExecConfig, Simulator, Trade
from engine.signals import atr_close
from engine.underlying import structure
from stage1.events import ckey, mid_tables
from stage2.sim import Cfg
from stage2.variants import Runner
from etests.util import FakePanel, random_walk_quotes
from etests.test_stage1 import _cm_from

DAYS = ['20240415', '20240416', '20240417']
EXP, K = 20240419, 500000
L5 = (5, 9, 15, 20, 21, 50, 100, 200)


class _Src:
    def __init__(self, p):
        self.p = p

    def q0(self, D):
        return self.p.q0(D)


class _Data:
    def __init__(self, q0):
        self.root, self.block = 'SPY', 'T'
        self.src = _Src(FakePanel('SPY', q0, {}))
        cm = _cm_from(q0)
        t5 = add_emas(mid_tables(cm, 5), L5)
        t5['atr'] = atr_close(t5[['c']])
        t5['state'] = SG.state(t5)
        t1 = add_emas(mid_tables(cm, 1), (5, 9, 21))
        self.t5, self.th = t5, {1: t1}
        self.keys = np.array([ckey(EXP, K, 1)])
        self.und_last = {int(D): 505.0 for D in DAYS}
        sw = structure(pd.DataFrame({'h': t1.c, 'l': t1.c, 'c': t1.c})).swing_low.to_numpy()
        self.t1sw = t1.assign(swing_low=sw)


def _row_at(tab, s, ms):
    k = tab.session.to_numpy(np.int64) * 100_000_000 + tab.known_ms.to_numpy(np.int64)
    i = int(np.searchsorted(k, int(s) * 100_000_000 + int(ms), side='right')) - 1
    return None if i < 0 else tab.iloc[i].to_dict()


def _ref_exit(name, d: _Data):
    ca = lambda s, ms: _row_at(d.t5, s, ms)
    at = lambda s, ms: (lambda r: r['atr'] if r else None)(_row_at(d.t5, s, ms))
    c1 = lambda s, ms: _row_at(d.t1sw, s, ms)
    return {'X1': lambda: SG.X1NextEMA(ca), 'X3': lambda: SG.X3Hold9(ca), 'X4': lambda: SG.X4Cross920(ca),
            'X5': lambda: SG.X5Structure(c1, at), 'X6': lambda: SG.X6HTFLoss(ca), 'X7': lambda: SG.X7ATR(ca, at),
            'X8': lambda: SG.X8FixedRR(ca), 'X9': lambda: SG.X9Trail(ca, at), 'X10': lambda: SG.X10Combo(ca, at, htf_at=ca),
            'XT30': lambda: SG.XTime(30)}[name]()


def _quotes(seed=4):
    q0, q2 = random_walk_quotes(DAYS, seed=seed, start=3.0, vol=0.006, spread=0.04)
    rng = np.random.default_rng(seed)
    for D in DAYS:
        q = q0[D].copy()
        q.loc[rng.random(len(q)) < 0.04, 'bid'] = 0
        q.loc[rng.random(len(q)) < 0.04, 'bs'] = 0
        q0[D] = q
    return q0, q2


def test_stage2_fast_sim_equals_simulator_every_exit():
    q0, q2 = _quotes()
    d = _Data(q0)
    D = DAYS[-1]
    n = 0
    for lat, slip in (('L0c', 0), ('L0', 1), ('L60', 0)):
        R = Runner(d, Cfg(latency=lat, slip_ticks=slip))
        sim = Simulator(d.src.p, ExecConfig(latency=lat, slip_ticks=slip), sessions=DAYS)
        for name in ('X1', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'XT30'):
            for m in range(9, 380, 15):
                row = {'session': int(D), 'exp': EXP, 'strike': K, 'right': 1, 'm': m}
                mine = R.trade(row, name)
                ref = sim.run(Trade('SPY', EXP, K, 1, int(D), m), _ref_exit(name, d), und_close=lambda x: 505.0)
                assert mine['status'] == ref['status'], (name, m)
                if ref['status'] != 'filled':
                    continue
                n += 1
                for k in ('exit_decision_m', 'exit_m', 'exit_reason', 'forced_intrinsic'):
                    assert mine[k] == ref[k], (lat, name, m, k, mine[k], ref[k])
                for k in ('entry_px', 'exit_px', 'ret_net', 'ret_gross', 'pnl_net', 'mfe_bid', 'mae_bid'):
                    a, b = mine[k], ref[k]
                    assert (a != a and b != b) or abs(a - b) < 1e-12, (lat, name, m, k, a, b)
    assert n > 500


def test_stage2_exit2_three_units_and_intrinsic():
    q0, _ = _quotes(5)
    d = _Data(q0)
    D = DAYS[-1]
    R = Runner(d, Cfg())
    sim = Simulator(d.src.p, ExecConfig(latency='L0c'), sessions=DAYS)
    ca = lambda s, ms: _row_at(d.t5, s, ms)
    for m in range(9, 380, 30):
        mine = R.trade({'session': int(D), 'exp': EXP, 'strike': K, 'right': 1, 'm': m}, 'X2')
        refs = [sim.run(Trade('SPY', EXP, K, 1, int(D), m), SG.X2PartialUnit(ca, j), und_close=lambda x: 505.0) for j in range(3)]
        if refs[0]['status'] != 'filled':
            continue
        assert abs(mine['ret_net'] - np.mean([r['ret_net'] for r in refs])) < 1e-12
        assert mine['exit_decision_m'] == max(r['exit_decision_m'] for r in refs)
    # no bid to the end -> intrinsic at the underlying close, flagged
    q = {k: v.copy() for k, v in q0.items()}
    q[D].loc[q[D].m > 200, 'bid'] = 0
    d2 = _Data(q)
    r = Runner(d2, Cfg()).trade({'session': int(D), 'exp': EXP, 'strike': K, 'right': 1, 'm': 199}, 'XT30')
    assert r['forced_intrinsic'] and abs(r['exit_px'] - 5.0) < 1e-12


def test_stage2_exit_lookahead_noise_after_exit_and_canary():
    q0, _ = _quotes(6)
    D = DAYS[-1]
    d = _Data(q0)
    base = {x: Runner(d, Cfg()).trade({'session': int(D), 'exp': EXP, 'strike': K, 'right': 1, 'm': 99}, x)
            for x in ('X1', 'X3', 'X4', 'X7', 'X8', 'X9', 'X10')}
    rng = np.random.default_rng(1)
    for x, r in base.items():
        cut = r['exit_m']
        q = {k: v.copy() for k, v in q0.items()}
        bad = q[D].m > cut
        q[D].loc[bad, 'bid'] = (q[D].loc[bad, 'bid'] * rng.uniform(0.3, 3, bad.sum())).astype(int)
        q[D].loc[bad, 'ask'] = np.maximum(q[D].loc[bad, 'ask'], q[D].loc[bad, 'bid'])
        r2 = Runner(_Data(q), Cfg()).trade({'session': int(D), 'exp': EXP, 'strike': K, 'right': 1, 'm': 99}, x)
        assert (r2['exit_decision_m'], r2['exit_reason'], r2['exit_px']) == (r['exit_decision_m'], r['exit_reason'], r['exit_px']), x
    # canary: an exit that peeks at the next bar's mid fires earlier somewhere
    from stage2 import sim as S
    R = Runner(d, Cfg())
    cx = R.ctx(int(ckey(EXP, K, 1)), D)
    peek = S.Ctx(np.r_[cx.mid[1:], np.nan], cx.t5, cx.t1, cx.htf)
    moved = 0
    for m in range(9, 370, 10):
        g = R.grid(D).row(int(ckey(EXP, K, 1)))
        a = S.simulate('SPY', D, (EXP, K, 1), m, g, cx, 'X9', Cfg(), 505.0)
        b = S.simulate('SPY', D, (EXP, K, 1), m, g, peek, 'X9', Cfg(), 505.0)
        moved += a.get('exit_decision_m') != b.get('exit_decision_m')
    assert moved > 0
