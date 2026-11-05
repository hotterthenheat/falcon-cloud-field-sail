"""L3 analysis: summary, side-shuffled null (the opposite 0.35d contract at the same second, coin flip per trade),
synthetic no-edge (zero drift, path vol = the contract's entry IV, BS with the real entry spread), PBO, DSR."""
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from common import bs  # noqa
from l3 import D3, SPLIT, q1, FEE, LAT  # noqa
from eval.metrics import summarize, cluster_ci_mean, pbo_cscv, ledger_trials  # noqa

NR = 200


def ci_pass(v, days):
    lo, _ = cluster_ci_mean(v, days, 500)
    return np.mean(v) > 0 and lo > 0


def main():
    t = pd.read_parquet(os.path.join(D3, f'trades_{SPLIT}.parquet'))
    tr = pd.read_parquet(os.path.join(D3, f'trig_{SPLIT}.parquet'))
    N = ledger_trials()
    rep = {'split': SPLIT, 'n_trials': N, 'variants': {}}
    rng = np.random.default_rng(9)
    for v, g in t.groupby('variant'):
        x = g.copy()
        x['session'] = x.day
        x['pnl_net'] = x.ret_net * x.fill * 100
        x['pnl_gross'] = x.ret_gross * x.fill * 100
        x['entry_ms'] = x['T'] * 1000
        s = summarize(x, n_trials=N)
        r = {k: s[k] for k in ('n', 'expectancy', 'median', 'win_rate', 'payoff', 'gross_expectancy', 'ci_expectancy',
                               'dsr_dsr')}
        r['by_sym'] = {k: [int(len(h)), float(h.ret_net.mean())] for k, h in g.groupby('sym')}
        r['by_year'] = {k: [int(len(h)), float(h.ret_net.mean())] for k, h in g.groupby(g.day.str[:4])}
        r['reasons'] = g.reason.value_counts().to_dict()
        # side-shuffled null
        gg = g[g.opp_net.notna()]
        means, passes = [], []
        for _ in range(NR):
            flip = rng.random(len(gg)) < 0.5
            vals = np.where(flip, gg.opp_net.values, gg.ret_net.values)
            means.append(vals.mean())
            passes.append(ci_pass(vals, gg.day.values))
        r['null_side'] = dict(mean=float(np.mean(means)), p95=float(np.percentile(means, 95)),
                              beats=float((gg.ret_net.mean() > np.array(means)).mean()), fdr=float(np.mean(passes)),
                              opposite_side_mean=float(gg.opp_net.mean()))
        # synthetic no-edge
        prep = []
        for _, a in g.iterrows():
            q = q1(a.sym, a.day, tr[(tr.sym == a.sym) & (tr.day == a.day) & (tr['T'] == a['T'])].exp.iloc[0], a.k,
                   a.side > 0, int(a['T']), int(a['T']) + 3720)
            i = np.where((q['s'] >= a['T'] + LAT) & (q['bid'] > 0) & (q['ask'] > 0))[0][0]
            h = (q['ask'][i] - q['bid'][i]) / (q['ask'][i] + q['bid'][i])
            prep.append((a, h))
        means, passes = [], []
        for _ in range(NR):
            vals, days = [], []
            for a, h in prep:
                sd = a.iv * np.sqrt(60 / (365 * 86400))
                S = a.S * np.exp(np.concatenate([[0], np.cumsum(rng.normal(-0.5 * sd * sd, sd, 61))]))
                tau = np.maximum(a.tau - np.arange(62) * 60 / (365 * 86400), 1e-6)
                mid = np.maximum(bs(S, a.k, tau, a.iv, a.side > 0), 0.01)
                fill = mid[0] * (1 + h)
                j = 60
                if v == 'M2':
                    mv = a.side * np.log(S / S[0])
                    hit = np.where((mv[1:60] >= a.sd60) | (mv[1:60] <= -0.75 * a.sd60))[0]
                    j = hit[0] + 2 if len(hit) else 60
                px = mid[min(j, 61)] * (1 - h)
                vals.append((px * 100 - fill * 100 - 2 * FEE) / (fill * 100 + FEE))
                days.append(a.day)
            means.append(np.mean(vals))
            passes.append(ci_pass(np.array(vals), np.array(days)))
        r['null_synth'] = dict(mean=float(np.mean(means)), p95=float(np.percentile(means, 95)), fdr=float(np.mean(passes)),
                               beats=float((g.ret_net.mean() > np.array(means)).mean()))
        rep['variants'][v] = r
        print(v, json.dumps(r, default=str))
    P = t.pivot_table(index='day', columns='variant', values='ret_net', aggfunc='mean').fillna(0).sort_index()
    rep['pbo'] = pbo_cscv(P.values, 16)
    print('PBO', rep['pbo'])
    json.dump(rep, open(os.path.join(HERE, 'results', f'L3_{SPLIT}.json'), 'w'), indent=1, default=str)


if __name__ == '__main__':
    main()
