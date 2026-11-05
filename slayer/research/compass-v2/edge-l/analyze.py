"""L1 analysis: per-variant summary (1-s path), nulls (key R<k, shuffled, synthetic no-edge), PBO, DSR, roi.
    SPLIT=DEV python3 analyze.py   -> results/L1_<SPLIT>.json + printed table
"""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from common import OUT, UND, bars, chain, bs  # noqa
from l1sim import VARIANTS, simulate, FLAT  # noqa
from run_l1 import load_signals, legs_of, bars_arr  # noqa
from eval.metrics import summarize, cluster_ci_mean, pbo_cscv, ledger_trials  # noqa

NR = 200
SPLIT = os.environ.get('SPLIT', 'DEV')


def regime(root, day):
    b = bars(UND[root])[day]
    px = np.concatenate([[b.o.iloc[0]], b.c.values])
    rv = np.sqrt(np.sum(np.diff(np.log(px)) ** 2) * 252)
    oc = b.c.iloc[-1] / b.o.iloc[0] - 1
    hi, lo = b.h.max(), b.l.min()
    pos = (b.c.iloc[-1] - lo) / (hi - lo) if hi > lo else 0.5
    if rv >= 0.25:
        return 'high_vol'
    if abs(oc) >= 0.006 and (pos >= 0.75 or pos <= 0.25):
        return 'trend'
    return 'flat'


def as_trades(df):
    t = df.copy()
    t['session'] = t.day
    t['pnl_net'] = t.ret_net * t.cost * 100
    t['pnl_gross'] = t.ret_gross * t.cost * 100
    t['entry_ms'] = t['T'] * 1000
    t['hold_s'] = t.exit_s - t['T']
    return t


def ci_pass(vals, days, nb=500):
    lo, hi = cluster_ci_mean(vals, days, nb)
    return np.mean(vals) > 0 and lo > 0


def key_and_shuffle(M, v, real):
    """M = minute-path rows of the variant's structure in SPLIT. real = its triggered rows. Returns null stats."""
    rng = np.random.default_rng(11)
    out = {}
    trig = M[M.R >= v['k']]
    rm = trig.ret_net.mean()
    for name, pool in (('key_R_lt_k', M[M.R < v['k']]), ('shuffled_any_R', M)):
        means, passes = [], []
        for _ in range(NR):
            parts = []
            for root, g in trig.groupby('root'):
                p = pool[pool.root == root]
                if len(p) == 0:
                    continue
                parts.append(p.sample(min(len(g), len(p)), random_state=int(rng.integers(1e9)), replace=len(p) < len(g)))
            d = pd.concat(parts)
            means.append(d.ret_net.mean())
            passes.append(ci_pass(d.ret_net.values, d.day.values))
        means = np.array(means)
        out[name] = dict(null_mean=float(means.mean()), null_p95=float(np.percentile(means, 95)),
                         real_minute_mean=float(rm), beats=float((rm > means).mean()), fdr=float(np.mean(passes)))
    return out


def synth(rows, v, reps=NR):
    """No-edge world: zero drift, path vol = the entry implied vol; BS at entry IV with the real entry spread."""
    rng = np.random.default_rng(5)
    prep = []
    for _, r in rows.iterrows():
        legs = legs_of(r, v['kind'])
        if not legs:
            continue
        T = int(r['T'])
        snap = chain(r.root, r.day)
        snap = snap[snap.m == T // 60 - 1]
        h = []
        for k, c in legs:
            q = snap[(snap.k == k) & (snap.r == int(c))].iloc[0]
            h.append((q.ask - q.bid) / (q.ask + q.bid))
        prep.append((r, legs, h, T))
    means, passes = [], []
    for rep in range(reps):
        vals, days = [], []
        for r, legs, h, T in prep:
            m0 = T // 60 - 1
            ms = np.arange(m0, 960)
            n = len(ms) - 1
            sd = r.iv_atm * np.sqrt(60 / (365 * 86400))
            S = r.spot * np.exp(np.concatenate([[0], np.cumsum(rng.normal(-0.5 * sd * sd, sd, n))]))
            tau = np.maximum((57600 - (ms + 1) * 60) / (365 * 86400), 1e-8)
            qs = []
            for (k, c), hh in zip(legs, h):
                mid = bs(S[1:], k, tau[:-1] + 60 / (365 * 86400) * 0, r.iv_atm, c)
                mid = np.maximum(mid, 0.005)
                qs.append({'s': (ms[1:] * 60).astype(np.int64), 'bid': mid * (1 - hh), 'ask': mid * (1 + hh),
                           'as': np.full(n, 999)})
            res = simulate(legs, qs, ms, S, T, r.F, v['kind'], v['exit'], side=r.side, K=r.K_atm)
            if res:
                vals.append(res['ret_net'])
                days.append(r.day)
        vals = np.array(vals)
        means.append(vals.mean())
        passes.append(ci_pass(vals, np.array(days)))
    return dict(null_mean=float(np.mean(means)), null_p95=float(np.percentile(means, 95)), fdr=float(np.mean(passes)))


def main():
    S = load_signals()
    sec = pd.read_parquet(os.path.join(OUT, f'sec_{SPLIT}.parquet'))
    sec = sec[~sec.missing.astype(bool)]
    mins = pd.read_parquet(os.path.join(OUT, 'minute_all.parquet'))
    mins = mins[mins.split == SPLIT]
    N = ledger_trials()
    report = {'split': SPLIT, 'ledger_trials': N, 'variants': {}}
    allS = S[S.split == SPLIT]
    report['roi_all_sessions'] = {f'{T}': float(allS[allS['T'] == T].real_over_imp.mean()) for T in (35100, 37800)}
    report['R_quantiles'] = {f'{T}': [float(x) for x in allS[allS['T'] == T].R.quantile([.1, .5, .9, .99])] for T in (35100, 37800)}
    days_all = sorted(allS.day.unique())
    for vid, v in VARIANTS.items():
        t = sec[sec.variant == vid]
        rep = {'n': int(len(t))}
        if len(t):
            tr = as_trades(t)
            tr['label'] = [regime(a, b) for a, b in zip(tr.root, tr.day)]
            s = summarize(tr, sessions=None, n_trials=N)
            rep.update({k: s[k] for k in ('n', 'expectancy', 'median', 'win_rate', 'payoff', 'gross_expectancy',
                                          'ci_expectancy', 'ci_win_rate', 'sharpe_trade', 'dsr_dsr', 'dsr_sr0')})
            rep['ret_no_fee'] = float(t.ret_gross.mean())
            rep['roi_traded'] = float(t.roi.mean())
            rep['by_year'] = {y: [int(len(g)), float(g.ret_net.mean())] for y, g in t.groupby(t.day.str[:4])}
            rep['by_regime'] = {y: [int(len(g)), float(g.ret_net.mean())] for y, g in tr.groupby('label')}
            rep['by_root'] = {y: [int(len(g)), float(g.ret_net.mean())] for y, g in t.groupby('root')}
            rep['reasons'] = t.reason.value_counts().to_dict()
            M = mins[(mins.kind == v['kind']) & (mins['T'] == v['T']) & (mins.exit == v['exit'])]
            rep['nulls'] = key_and_shuffle(M, v, t)
            if os.environ.get('SYNTH', '1') == '1':
                rows = S[(S.split == SPLIT) & (S['T'] == v['T']) & (S.R >= v['k'])]
                rep['nulls']['synthetic_no_edge'] = synth(rows, v)
                rep['nulls']['synthetic_no_edge']['beats'] = float(rep['expectancy'] > rep['nulls']['synthetic_no_edge']['null_p95'])
        report['variants'][vid] = rep
        print(vid, json.dumps({k: rep.get(k) for k in ('n', 'expectancy', 'ci_expectancy', 'win_rate', 'payoff', 'roi_traded')}), flush=True)
    # PBO over the 8 variants: per-session net P&L ($/package-set) with 0 on no-trade sessions
    P = pd.DataFrame(0.0, index=days_all, columns=list(VARIANTS))
    for vid in VARIANTS:
        t = sec[sec.variant == vid]
        g = (t.ret_net).groupby(t.day).mean()
        P.loc[g.index, vid] = g.values
    report['pbo'] = pbo_cscv(P.values, 16)
    json.dump(report, open(os.path.join(HERE, 'results', f'L1_{SPLIT}.json'), 'w'), indent=1, default=str)
    print('PBO', report['pbo'])
    print('roi all', report['roi_all_sessions'], 'R q', report['R_quantiles'])


if __name__ == '__main__':
    main()
