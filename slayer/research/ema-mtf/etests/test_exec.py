"""Execution simulator: fills, latency, size, spread, walking exits, and equality with the compass-v2 Engine."""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.execution import ExecConfig, HoldUntil, Simulator, Trade
from etests.util import EXP, K, FakePanel, Sim, random_walk_quotes

D = '20240417'


def _grid_from_ticks(ms, bid, ask, bs, as_, offset_ms):
    """As-of snapshots at each bar end (+offset) from a tick-level quote stream (cents)."""
    t = (9 * 60 + 30 + 1 + np.arange(-1, 390)) * 60_000 + offset_ms
    i = np.searchsorted(ms, t, side='right') - 1
    ok = i >= 0
    return pd.DataFrame({'exp': EXP, 'strike': K, 'right': 1, 'm': np.arange(-1, 390)[ok], 'bid': bid[i[ok]],
                         'ask': ask[i[ok]], 'bs': bs[i[ok]], 'as': as_[i[ok]]})


def test_matches_compass_engine_fills():
    import sys, os
    v2 = os.path.join(os.path.dirname(__file__), '..', '..', 'compass-v2')
    sys.path.insert(0, os.path.abspath(v2))
    from data.store import Contract
    from sim.engine import Engine, SimConfig, Strategy, clock
    from sim.exits import TimeStop
    from sim.memsession import MemSession
    rng = np.random.default_rng(5)
    ms = np.sort(rng.choice(np.arange(clock('09:30'), clock('16:00')), 30000, replace=False)).astype(np.int64)
    mid = 300 + np.cumsum(rng.choice([-1, 0, 1], len(ms)))
    sp = rng.choice([1, 2, 3], len(ms))
    bid, ask = (mid - sp).astype(np.int32), (mid + sp).astype(np.int32)
    bs, as_ = rng.integers(1, 50, len(ms)).astype(np.int32), rng.integers(1, 50, len(ms)).astype(np.int32)
    C = Contract('SPY', EXP, K, 1)
    q = {'ms': ms, 'bid': bid, 'ask': ask, 'bs': bs, 'as': as_}
    t = np.arange(clock('09:30'), clock('16:00') + 1, 1000)
    sess = MemSession(D, {C: q}, underlying={'SPY': {'ms': t, 'px': np.full(len(t), 500.0)}})

    class OneShot(Strategy):
        timer_ms = 1000

        def __init__(self):
            self.done = False

        def on_event(self, ctx, ev):
            if not self.done and ctx.now >= clock('10:00'):
                self.done = True
                ctx.buy(C, 1, exit=TimeStop(at='10:30'))

    ref = Engine(sess, OneShot(), SimConfig(latency_ms=2000, max_entry_spread_frac=None)).run()[0]
    p = FakePanel('SPY', {D: _grid_from_ticks(ms, bid, ask, bs, as_, 0)}, {D: _grid_from_ticks(ms, bid, ask, bs, as_, 2000)})
    sim = Sim(p, ExecConfig(latency='L2', max_spread_frac=1.0))
    mine = sim.run(Trade('SPY', EXP, K, 1, int(D), decision_m=29), HoldUntil(int(D), 59))
    assert mine['status'] == 'filled'
    assert abs(mine['entry_px'] - ref['entry_px']) < 1e-9, (mine['entry_px'], ref['entry_px'])
    assert abs(mine['exit_px'] - ref['exit_px']) < 1e-9, (mine['exit_px'], ref['exit_px'])
    assert abs(mine['pnl_gross'] - ref['pnl_gross']) < 1e-6
    assert abs(mine['ret_net'] - ref['ret_net']) < 1e-9


def _panel(**kw):
    q0, q2 = random_walk_quotes([D, '20240418'], **kw)
    return FakePanel('SPY', q0, q2), q0, q2


def test_latency_variants_use_the_right_snapshot():
    p, q0, q2 = _panel()
    for lat, grid, m in (('L0', q0, 29), ('L2', q2, 29), ('L60', q0, 30)):
        r = Sim(p, ExecConfig(latency=lat)).run(Trade('SPY', EXP, K, 1, int(D), 29), HoldUntil(int(D), 59))
        row = grid[D][grid[D].m == m].iloc[0]
        assert abs(r['entry_px'] - row.ask / 100) < 1e-9, lat


def test_spread_size_and_one_sided_rejections():
    p, q0, q2 = _panel()
    q2[D].loc[q2[D].m == 29, 'ask'] = q2[D].loc[q2[D].m == 29, 'bid'] * 2
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 29), HoldUntil(int(D), 59))
    assert r['status'] == 'rejected' and r['why'] == 'spread'
    q2[D].loc[q2[D].m == 30, 'as'] = 0
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 30), HoldUntil(int(D), 59))
    assert r['status'] == 'rejected' and r['why'] == 'no size'
    q2[D].loc[q2[D].m == 31, 'bid'] = 0
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 31), HoldUntil(int(D), 59))
    assert r['status'] == 'rejected'
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 380), HoldUntil(int(D), 384))
    assert r['status'] == 'rejected' and r['why'] == 'entry window'


def test_partial_entry_and_walking_exit():
    p, q0, q2 = _panel(size=3)
    q2[D].loc[q2[D].m == 59, 'bs'] = 1
    r = Sim(p, ExecConfig(qty=5)).run(Trade('SPY', EXP, K, 1, int(D), 29), HoldUntil(int(D), 59))
    assert r['qty'] == 3 and r['partial_entry']
    b59, b60 = (q2[D][q2[D].m == m].bid.iloc[0] / 100 for m in (59, 60))
    assert abs(r['exit_px'] - (1 * b59 + 2 * b60) / 3) < 1e-9 and r['exit_walk_bars'] == 1


def test_flat_at_1555_and_fees():
    p, q0, q2 = _panel()
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 100), HoldUntil(int(D) + 5, 0))
    assert r['exit_reason'] == 'flat' and r['exit_decision_m'] == 384
    assert abs(r['exit_px'] - q2[D][q2[D].m == 384].bid.iloc[0] / 100) < 1e-9
    assert abs(r['fees'] - 1.30) < 1e-9
    pS = FakePanel('SPXW', q0, q2)
    rS = Sim(pS).run(Trade('SPXW', EXP, K, 1, int(D), 100), HoldUntil(int(D), 120))
    assert abs(rS['fees'] - 2.30) < 1e-9


def test_overnight_hold_and_expiry_flat():
    p, q0, q2 = _panel()
    r = Sim(p, ExecConfig(overnight=True)).run(Trade('SPY', EXP, K, 1, int(D), 300), HoldUntil(20240418, 10))
    assert r['exit_reason'] == 'hold_end' and r['exit_session'] == '20240418'
    q0e, q2e = random_walk_quotes([D], exp=int(D))
    pe = FakePanel('SPY', q0e, q2e)
    r = Sim(pe, ExecConfig(overnight=True)).run(Trade('SPY', int(D), K, 1, int(D), 300), HoldUntil(20240418, 10))
    assert r['exit_reason'] == 'expiry_flat'


def test_no_bid_to_the_end_marks_intrinsic_and_flags():
    p, q0, q2 = _panel()
    for g in (q0, q2):
        g[D].loc[g[D].m > 40, 'bid'] = 0
    r = Sim(p).run(Trade('SPY', EXP, K, 1, int(D), 29), HoldUntil(int(D), 59), und_close=lambda d: 503.0)
    assert r['forced_intrinsic'] and abs(r['exit_px'] - 3.0) < 1e-9
