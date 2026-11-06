"""Stage-1 builder tests (no terminal, no store).

1. features(): the vectorised many-contract features equal engine/signals.py applied to each contract on its own.
2. outcomes(): the vectorised L0c XT_h outcome equals engine/execution.Simulator + XTime, including invalid quotes,
   zero bid sizes (exit walks) and the 15:55 flat.
3. LOOK-AHEAD: every contract row after the decision replaced by noise -> every feature read at the decision is
   identical (MID chart, all timeframes; P* reprice with noise in the underlying after the decision too).
   CANARY: a join that reads the bar still forming at the decision must differ.
4. P*: the frozen-IV reprice reproduces the contract's MID at the freeze bar and uses the previous session's IV
   before 10:00 (a reprice that freezes at the session's last bar must differ: canary for the reprice clock).
5. stats.delta: recovers a planted within-stratum effect; is ~0 on a pure-strata effect (Simpson check).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from engine import signals as SG
from engine.bars import add_emas
from engine.execution import ExecConfig, Simulator, Trade
from stage1 import events as E
from stage1 import stats as ST
from stage1.features import FEATURES, KEY, LENGTHS, asof_join, features
from etests.util import FakePanel, random_walk_quotes

DAYS = ['20240415', '20240416', '20240417', '20240418']


def _table(seed, n=600, exp=20240419, strike=500000, right=1):
    rng = np.random.default_rng(seed)
    c = 2.0 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    # stretches of compression so model D can fire
    c[200:260] = c[199] * (1 + rng.normal(0, 0.0005, 60))
    t = pd.DataFrame({'exp': exp, 'strike': strike, 'right': right, 'session': 20240415 + np.arange(n) // 78,
                      'b': np.arange(n) % 78, 'c': c})
    t['known_ms'] = (570 + (t.b + 1) * 5) * 60_000
    return t


def test_stage1_features_equal_signals_per_contract():
    parts = [_table(s, strike=500000 + 1000 * s) for s in range(4)]
    allt = add_emas(pd.concat(parts, ignore_index=True), LENGTHS)
    f = features(allt)
    off = 0
    for p in parts:
        t = add_emas(p.copy(), LENGTHS)
        ref = {'A': SG.entry_A_reclaim(t), 'B': SG.entry_B_cross(t), 'C': SG.entry_C_alignment(t),
               'D': SG.entry_D_compression(t), 'H': SG.entry_H_transition(t), 'S': SG.state(t) == 1,
               'L50': (t.c > t.ema50).to_numpy() & SG.warm(t, 50), 'L200': (t.c > t.ema200).to_numpy() & SG.warm(t, 200)}
        mine = f.iloc[off:off + len(t)]
        for F, r in ref.items():
            v = mine[F].to_numpy()
            warm = np.isfinite(v)
            assert warm.sum() > 100 or F == 'L200', F
            assert np.array_equal(v[warm] == 1, np.asarray(r)[warm]), F
            assert not np.asarray(r)[~warm].any(), F      # the reference never fires before warm-up either
        assert np.nansum(mine['D'].to_numpy()) >= 0
        off += len(t)
    assert np.nansum(f['A'].to_numpy()) > 10 and np.nansum(f['B'].to_numpy()) > 3


def _panel_with_gaps(seed=3):
    q0, q2 = random_walk_quotes(DAYS[:2], seed=seed, start=3.0, vol=0.006, spread=0.04)
    rng = np.random.default_rng(seed)
    for D, q in q0.items():
        q = q.copy()
        bad = rng.random(len(q)) < 0.05
        q.loc[bad, 'bid'] = 0                      # one-sided quotes
        zs = rng.random(len(q)) < 0.05
        q.loc[zs, 'bs'] = 0                        # no bid size: the exit walks
        q.loc[q.m >= 386, 'bs'] = 0                # nothing to sell into after the flat -> intrinsic at the close
        q0[D] = q
    return FakePanel('SPY', q0, q2)


def test_stage1_outcomes_equal_simulator():
    from ema_baselines.run import XTime
    p = _panel_with_gaps()
    D = DAYS[1]
    q = p.q0(D)
    ev = pd.DataFrame({'m': np.array(E.DEC_M), 'exp': 20240419, 'strike': 500000, 'right': 1})
    keys = np.unique(E.ckey(ev.exp, ev.strike, ev.right))
    B, A, BS, AS = E.day_grids(q, keys)
    ci = np.zeros(len(ev), np.int64)
    und_last = 505.0
    o = E.outcomes(ev, 'SPY', B, A, BS, AS, ci, und_last)
    sim = Simulator(p, ExecConfig(latency='L0c'), sessions=DAYS[:2])
    n_ok = 0
    for h in E.HORIZONS:
        for i, m in enumerate(ev.m):
            r = sim.run(Trade('SPY', 20240419, 500000, 1, int(D), int(m)), XTime(h), und_close=lambda d: und_last)
            if r['status'] != 'filled':
                assert not o['status_ok'][i]
                continue
            n_ok += 1
            assert o['status_ok'][i]
            assert abs(r['ret_net'] - o[f'Y{h}'][i]) < 1e-12, (h, m, r['ret_net'], o[f'Y{h}'][i])
            assert abs(r['ret_gross'] - o[f'G{h}'][i]) < 1e-12
            if np.isfinite(r['ret_mid']):
                assert abs(r['ret_mid'] - o[f'Ymid{h}'][i]) < 1e-12
    assert n_ok > 100


def _cm_from(q0: dict, exp=20240419, strike=500000, right=1):
    rows = []
    for D, q in sorted(q0.items()):
        x = q[(q.m >= 0)]
        rows.append(pd.DataFrame({'exp': exp, 'strike': strike, 'right': right, 'session': np.int32(D),
                                  'm': x.m.to_numpy().astype(np.int16), 'bid': x.bid.to_numpy(), 'ask': x.ask.to_numpy(),
                                  'fine': True}))
    return pd.concat(rows, ignore_index=True)


def _und(days, seed, noise_after=None):
    rng = np.random.default_rng(seed)
    rows = []
    px = 500.0
    for D in days:
        r = rng.normal(0, 0.0005, 390)
        c = px * np.exp(np.cumsum(r))
        px = c[-1]
        rows.append(pd.DataFrame({'session': int(D), 'm': np.arange(390), 'o': c, 'h': c, 'l': c, 'c': c, 'v': 100, 'n': 1}))
    u = pd.concat(rows, ignore_index=True)
    if noise_after is not None:
        Dc, mc = noise_after
        bad = (u.session > int(Dc)) | ((u.session == int(Dc)) & (u.m > mc))
        u.loc[bad, 'c'] = u.loc[bad, 'c'] * rng.uniform(0.95, 1.05, bad.sum())
    return u


def _noise_after(q0, Dc, mc, seed=5):
    rng = np.random.default_rng(seed)
    out = {}
    for D, q in q0.items():
        q = q.copy()
        bad = (int(D) > int(Dc)) | ((int(D) == int(Dc)) & (q.m.to_numpy() > mc))
        for c in ('bid', 'ask'):
            v = q[c].to_numpy().astype(float)
            v[bad] = np.maximum(1, v[bad] * rng.uniform(0.3, 3.0, bad.sum()))
            q[c] = v.astype(int)
        q['ask'] = np.maximum(q.ask, q.bid)
        out[D] = q
    return out


def _feats_at(cm, u1, ev, tfs=E.TFS, shift_forming=False):
    out = {}
    ivf = E.frozen_iv(cm, u1)
    for tf in tfs:
        mt = E.mid_tables(cm, tf)
        ft = E.with_features(mt)
        if shift_forming:
            # CANARY reader: stamp each bar at its START, so the bar still forming at the decision is read
            ft = ft.assign(known_ms=ft.known_ms - tf * 60_000)
        j = asof_join(ev, ft, list(FEATURES) + ['state'], 'x')
        rt = E.with_features(E.reprice_table(mt, ivf, u1, tf))
        jp = asof_join(ev, rt, list(FEATURES), 'p')
        for F in FEATURES:
            out[(tf, F)] = j['x' + F].to_numpy()
            out[(tf, 'p' + F)] = jp['p' + F].to_numpy()
        out[(tf, 'state')] = j['xstate'].to_numpy()
    return out


def test_stage1_lookahead_noise_after_decision_and_canary():
    q0, _ = random_walk_quotes(DAYS, seed=9, start=3.0, vol=0.006, spread=0.04)
    Dc = DAYS[-1]
    u_clean = _und(DAYS, 4)
    checked = changed = 0
    for mc in (74, 149, 239):        # decisions 10:45, 12:00, 13:30
        ev = pd.DataFrame({'exp': [20240419], 'strike': [500000], 'right': [1], 'session': [int(Dc)],
                           'dec_ms': [int(E.dec_ms_of(mc))]})
        clean = _feats_at(_cm_from(q0), u_clean, ev)
        noisy = _feats_at(_cm_from(_noise_after(q0, Dc, mc)), _und(DAYS, 4, noise_after=(Dc, mc)), ev)
        for k, v in clean.items():
            a, b = v, noisy[k]
            assert (np.isnan(a) & np.isnan(b)).all() or np.array_equal(a, b), (mc, k, a, b)
            checked += 1
        # canary: reading the forming bar sees the noise
        cn = _feats_at(_cm_from(_noise_after(q0, Dc, mc)), u_clean, ev, tfs=(15, 30, 60), shift_forming=True)
        cc = _feats_at(_cm_from(q0), u_clean, ev, tfs=(15, 30, 60), shift_forming=True)
        changed += sum(not np.array_equal(cc[k], cn[k]) for k in cc if not k[1].startswith('p'))
    assert checked > 200
    assert changed > 0, 'canary: a reader of the forming bar must see the noise'


def test_stage1_reprice_freeze_and_canary():
    q0, _ = random_walk_quotes(DAYS[:2], seed=2, start=3.0, vol=0.004, spread=0.02)
    cm = _cm_from(q0)
    u1 = _und(DAYS[:2], 1)
    ivf = E.frozen_iv(cm, u1)
    mt = E.mid_tables(cm, 1)
    rt = E.reprice_table(mt, ivf, u1, 1)
    # at the freeze bar of session 2 the reprice equals the MID (same S, T, and the IV solved from that MID)
    D2 = int(DAYS[1])
    f2 = ivf[ivf.session == D2].iloc[0]
    row = rt[(rt.session == D2) & (rt.b == int(f2.m_freeze))]
    mid = mt[(mt.session == D2) & (mt.b == int(f2.m_freeze))].c.iloc[0]
    assert abs(row.c.iloc[0] - mid) < 1e-6
    # before 10:00 of session 2 the previous session's IV is used (so no bar before 10:00 reads the 10:00 quote)
    f1 = ivf[ivf.session == int(DAYS[0])].iloc[0]
    early = rt[(rt.session == D2) & (rt.b == 5)].c.iloc[0]
    S = E.und_close_at(u1, [D2], [5])[0]
    T = E.years_to_pm_expiry_vec([D2], [int(E.dec_ms_of(5))], [20240419])[0]
    from engine.bs import price
    assert abs(early - float(price(S, 500.0, T, f1.ivf, True))) < 1e-9
    # canary: an IV frozen at the session's last bar reprices the early bars differently
    late = cm[cm.m == 389].assign(m=np.int16(389))
    ivl = E.frozen_iv(late, u1)
    assert not np.isclose(ivl[ivl.session == D2].ivf.iloc[0], f2.ivf)


def test_stage1_delta_recovers_planted_effect_and_ignores_strata():
    rng = np.random.default_rng(0)
    n, K = 20000, 50
    ses = rng.integers(0, K, n)
    strata = rng.integers(0, 6, n)
    f = (rng.random(n) < 0.2 + 0.1 * strata).astype(float)     # feature prevalence differs by stratum
    y = 0.05 * strata + rng.normal(0, 0.1, n)                   # pure stratum effect: no feature effect
    W = ST.boot_weights(K)
    d0 = ST.delta(y, f, strata, ses, K, W)
    assert abs(d0['delta']) < 0.01 and d0['ci'][0] < 0 < d0['ci'][1]
    assert (d0['mean1'] - d0['mean0']) > 0.02                   # the naive difference would be fooled
    d1 = ST.delta(y + 0.03 * f, f, strata, ses, K, W)
    assert abs(d1['delta'] - 0.03) < 0.01 and d1['ci'][0] > 0 and d1['p'] < 0.001
    assert np.allclose(ST.holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])


def test_stage1_synthetic_is_zero_drift_and_keeps_structure():
    import edata.store as store
    from stage1.synth import SynthSource
    rng = np.random.default_rng(3)
    real_c = 500 * np.exp(np.cumsum(rng.normal(0, 0.0008, 390)))
    und = pd.DataFrame({'mod': 570 + np.arange(390), 'o': np.round(np.r_[500, real_c[:-1]] * 1e4), 'h': 0, 'l': 0,
                        'c': np.round(real_c * 1e4), 'v': 1, 'n': 1})
    q0, q2 = random_walk_quotes(['20240416'], seed=1, start=5.0, vol=0.003, spread=0.04)
    q = q0['20240416'].assign(exp=20240418, strike=500000)       # ATM call, two sessions to expiry
    q.loc[q.m == 100, 'bid'] = 0                                   # one one-sided row
    p = FakePanel('SPY', {'20240416': q}, q2)
    old = store.und_bars
    store.und_bars = lambda sym, D: und
    try:
        a = SynthSource('SPY', 11, panel=p).q0('20240416')
        b = SynthSource('SPY', 11, panel=p).q0('20240416')
        c = SynthSource('SPY', 12, panel=p).q0('20240416')
        assert a.equals(b) and not a.equals(c)                       # deterministic by seed
        assert len(a) == len(q) and (a.bid[q.m == 100] == 0).all()   # same rows; one-sided stays one-sided
        spr = (a.ask - a.bid)[a.bid > 0]
        assert spr.median() >= 4 and spr.max() <= 6                  # real median spread, rounded out to the tick
        du, dp = [], []
        for seed in range(200):                                      # martingale: no drift over 30 minutes
            s = SynthSource('SPY', seed, panel=p)
            S = s.und_day('20240416')[0]
            du.append(S[230] / S[200] - 1)
            x = s.q0('20240416')
            mid = ((x.bid + x.ask) / 2).to_numpy()
            dp.append(mid[230] / mid[200] - 1)
        du, dp = np.array(du), np.array(dp)
        assert abs(du.mean()) < 3 * du.std() / np.sqrt(len(du))
        assert abs(dp.mean()) < 3 * dp.std() / np.sqrt(len(dp)) + 0.002   # + the quote's rounding to the tick
        assert np.corrcoef(du, dp)[0, 1] > 0.8                        # the premium follows the synthetic underlying
    finally:
        store.und_bars = old
