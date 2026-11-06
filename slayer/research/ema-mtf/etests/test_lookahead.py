"""Look-ahead tests with canaries (pattern of compass-v2/edge-t/tests_lookahead_t.py).

1. Contract chart: every 1-minute row that ends after the decision is replaced by noise -> every (series, timeframe)
   EMA state read at the decision is identical. CANARY: a reader that takes the higher-timeframe bar still forming at
   the decision (its final close) must differ.
2. Underlying features (EMAs, RSI, structure, VWAP, RVOL, opening range): same noise test. CANARY: VWAP read one
   minute ahead must differ.
3. Exits: every quote after the exit fill and every chart row after the exit decision replaced by noise -> the same
   exit (time, price, reason) for X1/X3/X4/X7/X8. CANARY: an exit that reads the next bar's mid must differ.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine.chart import SERIES, ContractChart, contract_minutes
from engine.execution import ExecConfig, Simulator, Trade
from engine import signals as S
from etests.util import EXP, K, FakePanel, Sim, random_walk_quotes

DAYS = ['20240415', '20240416', '20240417']
RNG = np.random.default_rng(11)


def _trade_bars(q0):
    """Sparse synthetic trade prints: about 40% of minutes print near the mid."""
    out = {}
    for D, q in q0.items():
        x = q[q.m >= 0]
        keep = RNG.random(len(x)) < 0.4
        mid = (x.bid.to_numpy() + x.ask.to_numpy()) // 2
        out[D] = pd.DataFrame({'exp': EXP, 'strike': K, 'right': 1, 'm': x.m.to_numpy()[keep], 'o': mid[keep], 'h': mid[keep] + 1,
                               'l': mid[keep] - 1, 'c': mid[keep], 'v': 5, 'n': 1})
    return out


def _noised(q0, q2, tb, D_cut, m_cut):
    """Copies with every row after (D_cut, minute m_cut) replaced by noise."""
    def nz(g, extra=0):
        out = {}
        for D, x in g.items():
            x = x.copy()
            bad = (int(D) > int(D_cut)) | ((int(D) == int(D_cut)) & (x.m.to_numpy() > m_cut + extra))
            for c in [c for c in ('bid', 'ask', 'o', 'h', 'l', 'c') if c in x]:
                v = x[c].to_numpy().astype(float)
                v[bad] = np.maximum(1, v[bad] * RNG.uniform(0.3, 3.0, bad.sum()))
                x[c] = v.astype(int)
            if 'ask' in x:
                x['ask'] = np.maximum(x.ask, x.bid)
            out[D] = x
        return out
    return nz(q0), nz(q2), nz(tb)


def _chart(q0, q2, tb):
    p = FakePanel('SPY', q0, q2, tb)
    return ContractChart(contract_minutes(p, EXP, K, 1, DAYS))


def test_chart_states_identical_when_the_future_is_noise_and_canary_caught():
    q0, q2 = random_walk_quotes(DAYS, seed=3)
    tb = _trade_bars(q0)
    full = _chart(q0, q2, tb)
    same = n = caught = nc = 0
    for D, m in (('20240416', 44), ('20240416', 200), ('20240417', 13), ('20240417', 333)):
        ms = (570 + m + 1) * 60_000                   # decision at the close of bar m
        cut = _chart(*_noised(q0, q2, tb, D, m))
        for s in SERIES:
            for tf in (1, 5, 15, 30, 60):
                a, b = full.at(s, tf, int(D), ms), cut.at(s, tf, int(D), ms)
                n += 1
                same += (a is not None and b is not None and all(
                    (a[k] == b[k]) or (a[k] != a[k] and b[k] != b[k]) for k in a))
                # canary: the bar of tf that CONTAINS the decision minute (still forming) read with its final close
                t = full.tables[(s, tf)]
                k = int(D) * 100_000_000 + ms
                keys = t.session.to_numpy(np.int64) * 100_000_000 + t.known_ms.to_numpy(np.int64)
                i = int(np.searchsorted(keys, k, side='right'))
                if tf > 1 and i < len(t) and t.session.iloc[i] == int(D) and t.known_ms.iloc[i] > ms:
                    tc = cut.tables[(s, tf)]
                    j = int(np.searchsorted(tc.session.to_numpy(np.int64) * 100_000_000 + tc.known_ms.to_numpy(np.int64), k, side='right'))
                    nc += 1
                    caught += (j < len(tc) and t.c.iloc[i] != tc.c.iloc[j])
    assert same == n, f'{same}/{n} identical'
    assert nc > 0 and caught / nc > 0.9, f'canary caught {caught}/{nc}'


def _und_bars_factory(days, seed=4):
    rng = np.random.default_rng(seed)
    store = {}
    px = 500.0
    for D in days:
        mod = np.arange(4 * 60, 16 * 60)
        r = px * np.exp(np.cumsum(rng.normal(0, 0.0005, len(mod))))
        px = r[-1]
        store[D] = pd.DataFrame({'mod': mod, 'o': np.round(r * 1e4).astype('int64'), 'h': np.round(r * 1.0003 * 1e4).astype('int64'),
                                 'l': np.round(r * 0.9997 * 1e4).astype('int64'), 'c': np.round(r * 1e4).astype('int64'),
                                 'v': rng.integers(1000, 5000, len(mod)), 'n': 10})
    return store


def test_underlying_features_identical_when_the_future_is_noise_and_canary_caught():
    import engine.underlying as U
    days = [f'202404{d:02d}' for d in range(1, 26)]
    base = _und_bars_factory(days)
    orig = U.und_bars
    try:
        U.und_bars = lambda sym, D: base.get(D, pd.DataFrame())
        full = U.Underlying('SPY', days)
        D, m = days[-2], 150
        ms = (570 + m + 1) * 60_000
        noisy = {}
        for d, x in base.items():
            x = x.copy()
            bad = (int(d) > int(D)) | ((int(d) == int(D)) & (x['mod'].to_numpy() > 570 + m))
            for c in ('o', 'h', 'l', 'c'):
                v = x[c].to_numpy().astype(float)
                v[bad] = v[bad] * RNG.uniform(0.9, 1.1, bad.sum())
                x[c] = v.astype('int64')
            x.loc[bad, 'v'] = RNG.integers(1, 100000, bad.sum())
            noisy[d] = x
        U.und_bars = lambda sym, d: noisy.get(d, pd.DataFrame())
        cut = U.Underlying('SPY', days)
    finally:
        U.und_bars = orig
    for tf in (1, 5, 15, 30, 60):
        a, b = full.at(tf, int(D), ms), cut.at(tf, int(D), ms)
        for k in a:
            assert (a[k] == b[k]) or (a[k] != a[k] and b[k] != b[k]), (tf, k, a[k], b[k])

    def vw(u, mm):
        x = u.vwap[(u.vwap.session == int(D)) & (u.vwap.known_ms <= (570 + mm + 1) * 60_000)]
        return x.vwap.iloc[-1]
    assert vw(full, m) == vw(cut, m)
    assert vw(full, m + 1) != vw(cut, m + 1)          # canary: one minute ahead
    rv = lambda u: u.rvol[(u.rvol.session == int(D)) & (u.rvol.known_ms <= ms)].rvol_cum.iloc[-1]
    assert rv(full) == rv(cut)
    lv = lambda u: u.session_levels[u.session_levels.session == int(D)].iloc[0]
    for k in ('pdh', 'pdl', 'pdc', 'pmh', 'pml', 'orh5', 'orl30'):
        assert lv(full)[k] == lv(cut)[k], k


class PeekExit:
    """CANARY: exits when the NEXT bar's mid (not known yet) is below this bar's."""

    def __init__(self, q0):
        self.q0 = q0

    def start(self, info):
        pass

    def check(self, v):
        x = self.q0[str(v['session'])]
        nxt = x[x.m == v['m'] + 1]
        if len(nxt):
            mid = (nxt.bid.iloc[0] + nxt.ask.iloc[0]) / 200
            if mid < v['mid'] * 0.995:
                return 'peek'
        return None


def test_exits_identical_when_the_future_is_noise_and_canary_caught():
    q0, q2 = random_walk_quotes(DAYS, seed=9, vol=0.006)
    tb = _trade_bars(q0)
    D = '20240417'
    exits = {}

    def make(name, chart):
        at = lambda s, t: chart.at('mid', 5, s, t)
        atr_tab = chart.tables[('mid', 5)].assign(atr=lambda t: S.atr_close(t))
        atr_keys = atr_tab.session.to_numpy(np.int64) * 100_000_000 + atr_tab.known_ms.to_numpy(np.int64)

        def atr_at(s, t):
            i = int(np.searchsorted(atr_keys, int(s) * 100_000_000 + int(t), side='right')) - 1
            return atr_tab.atr.iloc[i] if i >= 0 else np.nan
        from engine.underlying import structure
        t1 = chart.tables[('mid', 1)]
        t1 = structure(t1.assign(h=t1.c, l=t1.c))
        k1 = t1.session.to_numpy(np.int64) * 100_000_000 + t1.known_ms.to_numpy(np.int64)

        def at1(s, t):
            i = int(np.searchsorted(k1, int(s) * 100_000_000 + int(t), side='right')) - 1
            return t1.iloc[i].to_dict() if i >= 0 else None
        htf = lambda s, t: chart.at('mid', 15, s, t)
        return {'X1': S.X1NextEMA(at), 'X3': S.X3Hold9(at), 'X4': S.X4Cross920(at), 'X7': S.X7ATR(at, atr_at),
                'X8': S.X8FixedRR(at), 'X2a': S.X2PartialUnit(at, 0), 'X2c': S.X2PartialUnit(at, 2),
                'X5': S.X5Structure(at1, atr_at), 'X6': S.X6HTFLoss(htf), 'X9': S.X9Trail(at, atr_at),
                'X10': S.X10Combo(at, atr_at, htf)}[name]

    for name in ('X1', 'X3', 'X4', 'X7', 'X8', 'X2a', 'X2c', 'X5', 'X6', 'X9', 'X10'):
        chart = _chart(q0, q2, tb)
        sim = Sim(FakePanel('SPY', q0, q2, tb), ExecConfig(max_spread_frac=1.0))
        r0 = sim.run(Trade('SPY', EXP, K, 1, int(D), 60), make(name, chart))
        assert r0['status'] == 'filled'
        xd, xm = r0['exit_decision_session'], r0['exit_decision_m']
        nq0, nq2, ntb = _noised(q0, q2, tb, r0['exit_session'], r0['exit_m'])
        # chart rows after the exit DECISION are noise too
        cq0, _, ctb = _noised(q0, q2, tb, xd, xm)
        chart_n = ContractChart(contract_minutes(FakePanel('SPY', cq0, nq2, ctb), EXP, K, 1, DAYS))
        sim_n = Sim(FakePanel('SPY', nq0, nq2, ntb), ExecConfig(max_spread_frac=1.0))
        r1 = sim_n.run(Trade('SPY', EXP, K, 1, int(D), 60), make(name, chart_n))
        assert (r1['exit_m'], r1['exit_reason']) == (r0['exit_m'], r0['exit_reason']), name
        assert abs(r1['exit_px'] - r0['exit_px']) < 1e-12, name
        exits[name] = r0["exit_reason"]
    print("    exit reasons:", exits)
    # canary
    sim = Sim(FakePanel('SPY', q0, q2, tb), ExecConfig(max_spread_frac=1.0))
    r0 = sim.run(Trade('SPY', EXP, K, 1, int(D), 60), PeekExit(q0))
    assert r0['exit_reason'] == 'peek'
    nq0, nq2, ntb = _noised(q0, q2, tb, D, r0['exit_decision_m'])
    r1 = Sim(FakePanel('SPY', nq0, nq2, ntb), ExecConfig(max_spread_frac=1.0)).run(
        Trade('SPY', EXP, K, 1, int(D), 60), PeekExit(nq0))
    assert (r1['exit_decision_m'], r1['exit_px']) != (r0['exit_decision_m'], r0['exit_px']), 'canary not caught'
