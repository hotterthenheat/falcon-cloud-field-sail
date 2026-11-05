"""Simulator unit tests: latency, spread crossing, size caps, exits, and no look-ahead.
Run: python3 -m tests.run   (from slayer/research/compass-v2)"""
from __future__ import annotations

import numpy as np
import pandas as pd

from data.store import Contract
from sim.engine import Engine, LookAheadError, SimConfig, Strategy, clock
from sim.exits import FixedBracket, FnExit, TimeStop, VolBracket
from sim.memsession import MemSession

C = Contract('SPY', 20240417, 500_000, 1)
P = Contract('SPY', 20240417, 500_000, -1)


def Q(rows):
    """rows: [(clock, bid, ask, bs, as)] with dollar prices -> store-style arrays (cents)."""
    return {'ms': np.array([clock(r[0]) for r in rows], np.int64),
            'bid': np.array([round(r[1] * 100) for r in rows], np.int32),
            'ask': np.array([round(r[2] * 100) for r in rows], np.int32),
            'bs': np.array([r[3] for r in rows], np.int32), 'as': np.array([r[4] for r in rows], np.int32)}


def und_flat(px=500.0):
    t = np.arange(clock('09:30'), clock('16:00') + 1, 1000)
    return {'SPY': {'ms': t, 'px': np.full(len(t), px)}}


class OneShot(Strategy):
    timer_ms = 1000

    def __init__(self, at, legs=C, qty=1, exit=None):
        self.at, self.legs, self.qty, self.exit, self.done = clock(at), legs, qty, exit, False

    def on_event(self, ctx, ev):
        if not self.done and ctx.now >= self.at:
            self.done = True
            ctx.buy(self.legs, self.qty, exit=self.exit)


def run(quotes, strat, **cfg):
    s = MemSession('20240417', quotes, underlying=und_flat())
    e = Engine(s, strat, SimConfig(**cfg))
    return e.run(), e


def test_fill_uses_quote_in_force_at_arrival_not_a_better_one_inside_latency():
    q = Q([('09:30', 0.90, 1.00, 10, 10), ('10:00:00.500', 0.40, 0.50, 10, 10), ('10:00:01.500', 1.00, 1.10, 10, 10)])
    log, _ = run({C: q}, OneShot('10:00', exit=TimeStop(max_hold_s=60)), latency_ms=2000)
    assert len(log) == 1
    t = log[0]
    assert t['entry_ms'] == clock('10:00:02') and abs(t['entry_px'] - 1.10) < 1e-9, t


def test_latency_is_configurable_and_zero_latency_takes_the_quote_at_decision():
    q = Q([('09:30', 0.90, 1.00, 10, 10), ('10:00:00.500', 0.40, 0.50, 10, 10)])
    log, _ = run({C: q}, OneShot('10:00', exit=TimeStop(max_hold_s=60)), latency_ms=0)
    assert abs(log[0]['entry_px'] - 1.00) < 1e-9
    log, _ = run({C: q}, OneShot('10:00', exit=TimeStop(max_hold_s=60)), latency_ms=500)
    assert abs(log[0]['entry_px'] - 0.50) < 1e-9


def test_next_change_rule_waits_for_a_new_quote():
    q = Q([('09:30', 0.90, 1.00, 10, 10), ('10:00:05', 0.95, 1.05, 10, 10)])
    log, _ = run({C: q}, OneShot('10:00', exit=TimeStop(max_hold_s=60)), latency_ms=2000, fill_rule='next_change')
    assert log[0]['entry_ms'] == clock('10:00:05') and abs(log[0]['entry_px'] - 1.05) < 1e-9


def test_round_trip_on_a_still_quote_loses_exactly_the_spread_plus_fees():
    q = Q([('09:30', 1.00, 1.10, 50, 50)])
    log, _ = run({C: q}, OneShot('10:00', qty=3, exit=TimeStop(max_hold_s=10)))
    t = log[0]
    assert abs(t['entry_px'] - 1.10) < 1e-9 and abs(t['exit_px'] - 1.00) < 1e-9
    assert abs(t['pnl_gross'] - (-0.10 * 3 * 100)) < 1e-6
    assert abs(t['fees'] - 0.65 * 3 * 2) < 1e-9 and abs(t['pnl_net'] - (-30 - 3.9)) < 1e-6
    log, _ = run({C: q}, OneShot('10:00', qty=3, exit=TimeStop(max_hold_s=10)), fee_per_contract=0.0)
    assert log[0]['fees'] == 0 and abs(log[0]['pnl_net'] + 30) < 1e-6


def test_entry_size_capped_by_displayed_ask_size_and_chase():
    q = Q([('09:30', 1.00, 1.10, 50, 3), ('10:00:03', 1.00, 1.20, 50, 5), ('10:00:04', 1.00, 1.30, 50, 50)])
    log, _ = run({C: q}, OneShot('10:00', qty=10, exit=TimeStop(max_hold_s=60)))
    assert log[0]['qty'] == 3 and log[0]['qty_req'] == 10
    log, _ = run({C: q}, OneShot('10:00', qty=10, exit=TimeStop(max_hold_s=60)), entry_chase_ms=5000)
    t = log[0]
    assert t['qty'] == 10
    assert abs(t['entry_px'] - (3 * 1.10 + 5 * 1.20 + 2 * 1.30) / 10) < 1e-9


def test_exit_size_capped_by_displayed_bid_size_walks_later_quotes():
    q = Q([('09:30', 1.00, 1.10, 2, 50), ('10:05:03', 0.90, 1.10, 2, 50), ('10:05:04', 0.80, 1.10, 50, 50)])
    log, _ = run({C: q}, OneShot('10:00', qty=5, exit=TimeStop(at='10:05')))
    t = log[0]
    assert t['qty'] == 5
    assert abs(t['exit_px'] - (2 * 1.00 + 2 * 0.90 + 1 * 0.80) / 5) < 1e-9
    assert t['exit_ms'] == clock('10:05:04')


def test_exit_fills_at_the_bid_latency_after_the_trigger():
    q = Q([('09:30', 1.00, 1.10, 50, 50), ('10:10', 1.70, 1.80, 50, 50), ('10:10:01', 1.40, 1.50, 50, 50)])
    log, _ = run({C: q}, OneShot('10:00', exit=FixedBracket(tp=1.5, sl=0.5)))
    t = log[0]
    assert t['reason'] == 'tp' and t['exit_decision_ms'] == clock('10:10')
    assert t['exit_ms'] == clock('10:10:02') and abs(t['exit_px'] - 1.40) < 1e-9   # the 1.70 bid was gone by arrival
    assert abs(t['mfe'] - (1.70 / 1.10 - 1)) < 1e-9


def test_mae_mfe_and_hold_time():
    q = Q([('09:30', 1.00, 1.10, 50, 50), ('10:01', 0.70, 0.80, 50, 50), ('10:02', 1.60, 1.70, 50, 50),
           ('10:03', 1.20, 1.30, 50, 50)])
    log, _ = run({C: q}, OneShot('10:00', exit=TimeStop(at='10:04')))
    t = log[0]
    assert abs(t['mae'] - (0.70 / 1.10 - 1)) < 1e-9 and t['mae_ms'] == clock('10:01')
    assert abs(t['mfe'] - (1.60 / 1.10 - 1)) < 1e-9 and t['mfe_ms'] == clock('10:02')
    assert t['hold_s'] == 240.0


def test_session_flat_closes_open_positions():
    q = Q([('09:30', 1.00, 1.10, 50, 50), ('15:55:01', 0.50, 0.60, 50, 50)])
    log, _ = run({C: q}, OneShot('15:00'))
    t = log[0]
    assert t['reason'] == 'flat' and t['exit_ms'] == clock('15:55:02') and abs(t['exit_px'] - 0.50) < 1e-9


def test_no_entry_after_flat_and_rejects_on_bad_quotes():
    q = Q([('09:30', 0.00, 1.10, 0, 50)])
    _, e = run({C: q}, OneShot('10:00'))
    assert len(e.log) == 0 and e.rejects and 'quote' in e.rejects[0]['why']
    q = Q([('09:30', 1.00, 1.10, 50, 50)])
    _, e = run({C: q}, OneShot('15:54:59'))
    assert len(e.log) == 0 and e.rejects[0]['why'] == 'no quote before flat'


def test_spread_rule_at_arrival():
    q = Q([('09:30', 1.00, 1.50, 50, 50)])
    _, e = run({C: q}, OneShot('10:00'), max_entry_spread_frac=0.08)
    assert len(e.log) == 0 and e.rejects[0]['why'] == 'spread too wide at arrival'


def test_package_straddle_fills_each_leg_at_its_ask_and_exits_at_bids():
    qc = Q([('09:30', 2.00, 2.10, 50, 4)])
    qp = Q([('09:30', 3.00, 3.20, 50, 9)])
    log, _ = run({C: qc, P: qp}, OneShot('10:00', legs=[(C, 1), (P, 1)], qty=6, exit=TimeStop(max_hold_s=5)))
    t = log[0]
    assert t['qty'] == 4 and abs(t['entry_px'] - 5.30) < 1e-9 and abs(t['exit_px'] - 5.00) < 1e-9
    assert abs(t['fees'] - 0.65 * 2 * 4 * 2) < 1e-9


# --------------------------------------------------------------------------- no look-ahead
class Peeker(Strategy):
    """Tries every accessor; records the latest stamp of anything returned; tries to ask the future."""
    timer_ms = 1000

    def __init__(self):
        self.max_seen_minus_now = -1e18
        self.raised = 0
        self.asks = 0

    def on_event(self, ctx, ev):
        q = ctx.quote(C)
        if q is not None:
            self.max_seen_minus_now = max(self.max_seen_minus_now, q.ms - ctx.now)
        h = ctx.quote_history(C, 0)
        if len(h['ms']):
            self.max_seen_minus_now = max(self.max_seen_minus_now, h['ms'].max() - ctx.now)
        ch = ctx.chain('SPY', 0)
        if len(ch):
            self.max_seen_minus_now = max(self.max_seen_minus_now, int(ch.gms.iloc[0]) - ctx.now)
        self.asks += 1
        try:
            ctx.quote_at(C, ctx.now + 1)
        except LookAheadError:
            self.raised += 1


def _rich_session():
    rng = np.random.default_rng(1)
    t = np.sort(rng.integers(clock('09:30'), clock('16:00'), 5000))
    t = np.unique(t)
    mid = 100 + np.cumsum(rng.normal(0, 1, len(t)))
    mid = np.clip(mid, 10, None)
    q = {'ms': t, 'bid': (mid - 2).astype(np.int32), 'ask': (mid + 2).astype(np.int32),
         'bs': np.full(len(t), 10, np.int32), 'as': np.full(len(t), 10, np.int32)}
    gm = np.arange(clock('09:30'), clock('16:00'), 60_000)
    g = pd.DataFrame({'exp': 20240417, 'strike': 500_000, 'right': 1, 'ms': gm, 'delta': 0.3, 'iv': 0.2, 'und': 500.0,
                      'bid': 0, 'ask': 0})
    return MemSession('20240417', {C: q}, greeks={'SPY': g}, underlying=und_flat()), q


def test_a_peeking_strategy_sees_nothing_stamped_after_now():
    s, q = _rich_session()
    st = Peeker()
    Engine(s, st, SimConfig()).run()
    assert st.max_seen_minus_now <= 0, st.max_seen_minus_now
    assert st.raised == st.asks > 300


def test_quote_seen_equals_the_raw_as_of_quote():
    s, q = _rich_session()

    class Check(Strategy):
        timer_ms = 777
        bad = 0

        def on_event(self, ctx, ev):
            got = ctx.quote(C)
            i = np.searchsorted(q['ms'], ctx.now, side='right') - 1
            if i >= 0 and (got is None or got.ms != q['ms'][i]):
                Check.bad += 1

    Engine(s, Check(), SimConfig()).run()
    assert Check.bad == 0


def test_greeks_row_not_visible_before_its_stamp_plus_delay():
    s, _ = _rich_session()

    class G(Strategy):
        timer_ms = 1000
        worst = -1e18

        def on_event(self, ctx, ev):
            ch = ctx.chain('SPY', 0)
            if len(ch):
                G.worst = max(G.worst, int(ch.gms.iloc[0]) + 30_000 - ctx.now)

    Engine(s, G(), SimConfig(greeks_delay_ms=30_000)).run()
    assert G.worst <= 0


def test_a_strategy_that_knows_the_jump_cannot_buy_before_it_without_beating_latency():
    """The price jumps at 11:00:00. A strategy that 'knows' and fires at 10:59:59 fills after the jump (2 s latency):
    knowledge inside the latency window is worthless, exactly as live."""
    q = Q([('09:30', 1.00, 1.10, 50, 50), ('11:00', 3.00, 3.10, 50, 50)])
    log, _ = run({C: q}, OneShot('10:59:59', exit=TimeStop(max_hold_s=30)))
    assert abs(log[0]['entry_px'] - 3.10) < 1e-9 and log[0]['pnl_gross'] < 0


def test_exit_fn_sees_only_the_present():
    s, q = _rich_session()
    seen = []

    def fn(ctx, pos):
        qq = ctx.quote(C)
        seen.append(qq.ms - ctx.now)
        return None

    Engine(s, OneShot('10:00', exit=FnExit(fn)), SimConfig()).run()
    assert seen and max(seen) <= 0


def test_external_events_arrive_at_their_availability_time():
    q = Q([('09:30', 1.00, 1.10, 50, 50)])
    s = MemSession('20240417', {C: q}, underlying=und_flat())
    got = []

    class X(Strategy):
        timer_ms = None

        def on_event(self, ctx, ev):
            got.append((ctx.now, ev.kind, ev.data))

    Engine(s, X(), SimConfig(), ext_events=[(clock('10:00:00.250'), 'alert', 'A'), (clock('09:45'), 'alert', 'B')]).run()
    assert got == [(clock('09:45'), 'alert', 'B'), (clock('10:00:00.250'), 'alert', 'A')]


def test_vol_bracket_levels_use_realized_vol_at_entry():
    t = np.arange(clock('09:30'), clock('16:00') + 1, 1000)
    rng = np.random.default_rng(5)
    px = 500 * np.exp(np.cumsum(rng.normal(0, 1e-4, len(t))))
    q = Q([('09:30', 1.00, 1.10, 50, 50)])
    g = pd.DataFrame({'exp': 20240417, 'strike': 500_000, 'right': 1, 'ms': np.arange(clock('09:30'), clock('16:00'), 60_000),
                      'delta': 0.3, 'iv': 0.2, 'und': 500.0, 'bid': 0, 'ask': 0})
    s = MemSession('20240417', {C: q}, greeks={'SPY': g}, underlying={'SPY': {'ms': t, 'px': px}})
    caught = {}

    class S(OneShot):
        def on_fill(self, ctx, pos, kind):
            if kind == 'entry':
                caught.update(pos.state)

    Engine(s, S('10:00', exit=VolBracket(k_tp=1, k_sl=1, horizon_s=1800, rv_window_s=900)), SimConfig()).run()
    # expected move = 0.3 * 500 * 1e-4 * sqrt(1800) ~= 0.636
    assert 0.5 < caught['move'] < 0.8, caught
    assert abs(caught['tp'] - (1.10 + caught['move'])) < 1e-9
