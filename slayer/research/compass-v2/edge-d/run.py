"""EDGE-D runner: pre-registered variants on event days vs control days, with nulls.

    python3 run.py --split DEV --family D1 [--events CPI,NFP] [--release 08:30]
    python3 run.py --split DEV --family D2
Outputs: results/<family>_<split>.json (+ trades parquet). Never touches LOCKED days (asserted via data.splits).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
from build import FOUND, build_session, straddle_implied  # noqa: E402
sys.path.insert(0, FOUND)
from data.splits import split_of  # noqa: E402
from data.store import Contract  # noqa: E402
from sim.engine import Engine, SimConfig, clock  # noqa: E402
from sim.memsession import MemSession  # noqa: E402
from eval.metrics import summarize, passes_bar, cluster_ci_mean, pbo_cscv, ledger_trials  # noqa: E402
from eval.nulls import ShuffledSignal, entries_from_trades  # noqa: E402
from strategies import EventStraddle, PostEventDrift, straddle_exits, drift_exits  # noqa: E402

RES = os.path.join(HERE, 'results')
os.makedirs(RES, exist_ok=True)


def cfg_for(T):
    flat = min(T + 120 * 60000, clock('15:55'))
    return SimConfig(latency_ms=2000, start_ms=T - 9 * 60000, flat_ms=flat, end_ms=flat + 60000), flat


def day_sets(split, events, release):
    ev, ct = [], []
    for d in build.days(status='ok'):
        m = build.meta(d)
        if m['release_et'] != release or split_of(d) != split:
            continue
        if m['kind'] == 'event' and m['event'] in events:
            ev.append(d)
        elif m['kind'] == 'control':
            ct.append(d)
    assert all(split_of(d) == split for d in ev + ct), 'wrong split'
    assert not any(split_of(d) == 'LOCKED' for d in ev + ct), 'locked day'
    return ev, ct


_cache = {}


def load(d):
    if d not in _cache:
        if len(_cache) > 40:
            _cache.clear()
        _cache[d] = build_session(d)
    return _cache[d]


def run_family(family, days, T, variants, contrast=False):
    cfg, flat = cfg_for(T)
    out = {v: [] for v in variants}
    for d in days:
        s = load(d)
        if s is None:
            continue
        m = s.edge_meta
        for v, ef in variants.items():
            if family.startswith('D1'):
                st = EventStraddle(int(m['exp']), int(m['atm_entry']), T - 5 * 60000, ef)
            else:
                st = PostEventDrift(T - 1000, T + 5 * 60000, T + 6 * 60000, ef, contrast=contrast)
            rows = Engine(s, st, cfg).run()
            for r in rows:
                r['variant'] = v; r['kind'] = m['kind']; r['event'] = m['event']
            out[v] += rows
    return {v: pd.DataFrame(r) for v, r in out.items()}


def realized_vs_implied(days, T):
    """Per event day: straddle mid at T-5m (chain rows <= T-5m) vs |F(t) - F(T-5m)| at the exit clocks."""
    rows = []
    for d in days:
        s = load(d)
        if s is None:
            continue
        si = straddle_implied(d, T - 5 * 60000)
        if si is None:
            continue
        u = s.underlying('SPX')

        def F(t):
            i = int(np.searchsorted(u['ms'], t, side='right')) - 1
            return float(u['px'][i]) if i >= 0 else float('nan')
        f0 = F(T - 5 * 60000)
        r = {'session': d, 'event': s.edge_meta['event'], 'kind': s.edge_meta['kind'], 'straddle_mid': si['straddle_mid'],
             'implied_pct': si['straddle_mid'] / si['F'], 'spread_frac_0825': si['spread_frac'], 'F0': f0}
        for name, t in (('r15', T + 15 * 60000), ('r30', T + 30 * 60000), ('r50', T + 50 * 60000), ('r120', min(T + 120 * 60000, clock('15:55')))):
            r[name] = abs(F(t) - f0) / si['straddle_mid'] if np.isfinite(f0) else float('nan')
        rows.append(r)
    return pd.DataFrame(rows)


# ---- synthetic zero-drift sessions for the pre-open window (eval.nulls.synthetic_session is RTH-only)
def synthetic_preopen(real, seed, T, iv_mode='real'):
    rng = np.random.default_rng(seed)
    u = real.underlying('SPX')
    t = u['ms']
    p = u['px']
    r = np.diff(np.log(p))
    b = np.arange(len(r)) // 300
    sig_b = np.sqrt(pd.Series(r * r).groupby(b).mean().to_numpy())
    med = np.nanmedian(sig_b[sig_b > 0]) if np.any(sig_b > 0) else 1e-4
    sig_b = np.where(np.isfinite(sig_b) & (sig_b > 0), sig_b, med)
    sig = sig_b[np.clip(np.arange(len(r)) // 300, 0, len(sig_b) - 1)]
    z = rng.standard_normal(len(r))
    S = np.exp(np.log(p[0]) + np.r_[0, np.cumsum(sig * z - 0.5 * sig * sig)])
    ann = float(np.sqrt(np.mean(sig_b ** 2) * 23400 * 252))
    g = real.greeks('SPXW')
    quotes, rows = {}, []
    for c in real.contracts('SPXW'):
        rq = real.quotes(c)
        ok = (rq['bid'] > 0) & (rq['ask'] >= rq['bid'])
        if not ok.any():
            continue
        spread_c = int(np.median((rq['ask'] - rq['bid'])[ok]))
        bs_med, as_med = int(np.median(rq['bs'][ok])), int(np.median(rq['as'][ok]))
        gi = g[(g.strike == c.strike) & (g.right == c.right)]
        iv = float(np.nanmedian(gi.iv)) if (iv_mode == 'real' and len(gi) and np.nanmedian(gi.iv) > 0) else ann
        tau = np.array([build._tau(int(x), real.day, c.exp) for x in t])
        sq = iv * np.sqrt(tau)
        d1 = (np.log(S / c.k) + 0.5 * sq * sq) / sq
        d2 = d1 - sq
        from scipy.stats import norm
        if c.right == 1:
            fair = S * norm.cdf(d1) - c.k * norm.cdf(d2); delta = norm.cdf(d1)
        else:
            fair = c.k * norm.cdf(-d2) - S * norm.cdf(-d1); delta = norm.cdf(d1) - 1
        tk = np.where(fair >= 3, 0.10, 0.05)
        half = spread_c / 200
        bid = np.maximum(0.0, np.floor((fair - half) / tk) * tk)
        ask = np.maximum(bid + tk, np.ceil((fair + half) / tk) * tk)
        bid_c, ask_c = np.round(bid * 100).astype(np.int64), np.round(ask * 100).astype(np.int64)
        quotes[c] = {'ms': t, 'bid': bid_c, 'ask': ask_c, 'bs': np.full(len(t), max(bs_med, 1)), 'as': np.full(len(t), max(as_med, 1))}
        m = (t % 60000) == 0
        rows.append(pd.DataFrame({'exp': c.exp, 'strike': c.strike, 'right': c.right, 'ms': t[m], 'delta': delta[m], 'iv': iv, 'und': S[m]}))
    s = MemSession(real.day, quotes, greeks={'SPXW': pd.concat(rows, ignore_index=True)}, underlying={'SPX': {'ms': t, 'px': S}},
                   expirations={'SPXW': [real.expirations('SPXW')[0]]})
    s.edge_meta = real.edge_meta
    return s


def rep(trades, days, n_trials):
    if len(trades) == 0:
        return {'n': 0}
    r = summarize(trades, sessions=days, ret='ret_net', n_trials=n_trials, n_boot=2000)
    g = summarize(trades, sessions=days, ret='ret_gross', n_trials=n_trials, n_boot=500)
    out = {k: r[k] for k in ('n', 'n_sessions', 'expectancy', 'median', 'win_rate', 'payoff', 'ci_expectancy', 'ci_win_rate',
                             'pnl_net_per_trade', 'sharpe_trade', 'sharpe_day', 'max_dd_dollars', 'dsr_dsr', 'hold_s_median') if k in r}
    out['gross_expectancy'] = g['expectancy']; out['ci_gross'] = g['ci_expectancy']
    out['by_year'] = {y: {'n': int(len(x)), 'exp': float(x.ret_net.mean()), 'win': float((x.ret_net > 0).mean())}
                      for y, x in trades.groupby(trades.session.str[:4])}
    out['bar'] = passes_bar(r)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', default='DEV')
    ap.add_argument('--family', required=True)          # D1 | D2 | D1b | D2b
    ap.add_argument('--events', default='CPI,NFP')
    ap.add_argument('--release', default='08:30')
    ap.add_argument('--shuffle-seeds', type=int, default=50)
    ap.add_argument('--synth-seeds', type=int, default=8)
    a = ap.parse_args()
    T = clock(a.release)
    events = a.events.split(',')
    ev, ct = day_sets(a.split, events, a.release)
    print(f'{a.family} {a.split}: {len(ev)} event days, {len(ct)} control days', flush=True)
    n_trials = ledger_trials()
    cfg, flat = cfg_for(T)
    res = {'family': a.family, 'split': a.split, 'events': events, 'n_event_days': len(ev), 'n_control_days': len(ct),
           'n_trials_ledger': int(n_trials), 'variants': {}}
    if a.family.startswith('D1'):
        variants = straddle_exits(T)
        rvi = realized_vs_implied(ev, T)
        rvc = realized_vs_implied(ct, T)
        rvi.to_csv(os.path.join(RES, f'{a.family}_{a.split}_realized_vs_implied.csv'), index=False)
        res['realized_vs_implied_event'] = {k: {'median': float(rvi[k].median()), 'mean': float(rvi[k].mean()), 'share_gt1': float((rvi[k] > 1).mean())}
                                            for k in ('r15', 'r30', 'r50', 'r120') if len(rvi)}
        res['realized_vs_implied_control'] = {k: {'median': float(rvc[k].median()), 'mean': float(rvc[k].mean()), 'share_gt1': float((rvc[k] > 1).mean())}
                                              for k in ('r15', 'r30', 'r50', 'r120') if len(rvc)}
        res['implied_pct_event_median'] = float(rvi.implied_pct.median()) if len(rvi) else None
        res['implied_pct_control_median'] = float(rvc.implied_pct.median()) if len(rvc) else None
        res['spread_frac_0825_event_median'] = float(rvi.spread_frac_0825.median()) if len(rvi) else None
        res['share_event_days_spread_le_8pct'] = float((rvi.spread_frac_0825 <= 0.08).mean()) if len(rvi) else None
        print('realized/implied event:', res['realized_vs_implied_event'], flush=True)
        print('realized/implied control:', res['realized_vs_implied_control'], flush=True)
        te = run_family(a.family, ev, T, variants)
        tc = run_family(a.family, ct, T, variants)
        for v in variants:
            res['variants'][v] = {'event': rep(te[v], ev, n_trials), 'control': rep(tc[v], ct, n_trials)}
            print(v, 'EVENT', {k: res['variants'][v]['event'].get(k) for k in ('n', 'expectancy', 'ci_expectancy', 'win_rate', 'gross_expectancy')},
                  'CONTROL', {k: res['variants'][v]['control'].get(k) for k in ('n', 'expectancy', 'ci_expectancy', 'win_rate')}, flush=True)
        # synthetic zero-drift null at the real IV (keeps the premium) and at realized vol (fair)
        for mode in ('real', 'rv'):
            exps = []
            for k in range(a.synth_seeds):
                rows = []
                for d in ev:
                    s = load(d)
                    if s is None:
                        continue
                    syn = synthetic_preopen(s, seed=k * 7919 + int(d) % 100000, T=T, iv_mode=mode)
                    m = s.edge_meta
                    rows += Engine(syn, EventStraddle(int(m['exp']), int(m['atm_entry']), T - 5 * 60000, variants['X3']), cfg).run()
                tr = pd.DataFrame(rows)
                exps.append(float(tr.ret_net.mean()) if len(tr) else float('nan'))
            exps = np.array(exps)
            res[f'synthetic_null_X3_{mode}'] = {'mean': float(np.nanmean(exps)), 'p95': float(np.nanpercentile(exps, 95)),
                                                'candidate_beats_share': float(np.mean(res['variants']['X3']['event'].get('expectancy', -9) > exps))}
            print('synthetic', mode, res[f'synthetic_null_X3_{mode}'], flush=True)
        all_tr = pd.concat([t.assign(set='event') for t in te.values()] + [t.assign(set='control') for t in tc.values()], ignore_index=True)
    else:
        variants = drift_exits(flat, T)
        te = run_family(a.family, ev, T, variants)
        tc = run_family(a.family, ct, T, variants)
        tcon = run_family(a.family, ev, T, {k: variants[k] for k in ('E1', 'E2', 'E3')}, contrast=True)
        for v in variants:
            res['variants'][v] = {'event': rep(te[v], ev, n_trials), 'control': rep(tc[v], ct, n_trials)}
            if v in tcon:
                res['variants'][v]['contrast_event'] = rep(tcon[v], ev, n_trials)
            print(v, 'EVENT', {k: res['variants'][v]['event'].get(k) for k in ('n', 'expectancy', 'ci_expectancy', 'win_rate')},
                  'CONTROL', {k: res['variants'][v]['control'].get(k) for k in ('n', 'expectancy', 'ci_expectancy', 'win_rate')},
                  'CONTRAST', {k: res['variants'][v].get('contrast_event', {}).get(k) for k in ('n', 'expectancy', 'ci_expectancy')}, flush=True)
        # shuffled-side null on the best registered continuation variant by DEV expectancy is NOT allowed to pick; use E1 (first registered)
        base = te['E1']
        if len(base):
            ent = entries_from_trades(base, default_delta=0.30)
            exps, ci_pass = [], 0
            for k in range(a.shuffle_seeds):
                rows = []
                for d in ev:
                    e = ent.get(str(d), [])
                    if not e:
                        continue
                    s = load(d)
                    rows += Engine(s, ShuffledSignal(e, variants['E1'], seed=k * 100003 + int(d) % 100000,
                                                     pick_kw={'band': (0.25, 0.40), 'max_spread_frac': 0.08}), cfg).run()
                tr = pd.DataFrame(rows)
                if len(tr):
                    exps.append(float(tr.ret_net.mean()))
                    ci_pass += cluster_ci_mean(tr.ret_net.to_numpy(float), tr.session.astype(str).to_numpy(), 500)[0] > 0
            exps = np.array(exps)
            res['shuffled_null_E1'] = {'n_runs': len(exps), 'mean': float(exps.mean()), 'p95': float(np.percentile(exps, 95)),
                                       'ci_pass_rate': ci_pass / max(len(exps), 1),
                                       'candidate_beats_share': float(np.mean(res['variants']['E1']['event']['expectancy'] > exps))}
            print('shuffled E1', res['shuffled_null_E1'], flush=True)
        # synthetic zero-drift (real IV) with the E1 rule
        exps = []
        for k in range(a.synth_seeds):
            rows = []
            for d in ev:
                s = load(d)
                if s is None:
                    continue
                syn = synthetic_preopen(s, seed=k * 7919 + int(d) % 100000, T=T, iv_mode='real')
                rows += Engine(syn, PostEventDrift(T - 1000, T + 5 * 60000, T + 6 * 60000, variants['E1']), cfg).run()
            tr = pd.DataFrame(rows)
            exps.append(float(tr.ret_net.mean()) if len(tr) else float('nan'))
        exps = np.array(exps)
        res['synthetic_null_E1_real'] = {'mean': float(np.nanmean(exps)), 'p95': float(np.nanpercentile(exps, 95)),
                                         'candidate_beats_share': float(np.mean(res['variants']['E1']['event'].get('expectancy', -9) > exps))}
        print('synthetic E1', res['synthetic_null_E1_real'], flush=True)
        all_tr = pd.concat([t.assign(set='event') for t in te.values()] + [t.assign(set='control') for t in tc.values()]
                           + [t.assign(set='contrast') for t in tcon.values()], ignore_index=True)
    # PBO across the family's variants (sessions x variants, per-session mean net return; zero-trade sessions = 0)
    try:
        M = np.array([[te[v][te[v].session == d].ret_net.mean() if len(te[v]) and (te[v].session == d).any() else 0.0 for v in variants] for d in ev])
        res['pbo_cscv'] = pbo_cscv(M, n_blocks=8)['pbo'] if len(ev) >= 16 else None
    except Exception as e:  # noqa
        res['pbo_cscv'] = f'err {e!r}'
    if len(all_tr):
        all_tr.to_parquet(os.path.join(RES, f'{a.family}_{a.split}_trades.parquet'))
    json.dump(res, open(os.path.join(RES, f'{a.family}_{a.split}.json'), 'w'), indent=1, default=lambda o: float(o) if isinstance(o, (np.floating, np.integer)) else str(o))
    print('PBO', res['pbo_cscv'])


if __name__ == '__main__':
    main()
