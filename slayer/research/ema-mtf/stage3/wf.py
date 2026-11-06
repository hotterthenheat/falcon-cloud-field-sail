"""Stage 3 (PREREG section 6, amendment A3 item 10): walk-forward selection within a Stage-2 family, PBO (CSCV) on the
family's sessions x variants matrix, DSR of the walk-forward OOS trades, and the section-7 DEV bar.

    python3 -m stage3.wf --family S2C        -> v2data/ema/results/stage3/wf_<family>.pkl, wf_<family>_oos.parquet

Folds: engine/walkforward.monthly_folds over the DEV months 2022-03..05, 2024-03..05 (anchored expanding, >= 2 train
months, 1-session embargo) -> test months 2022-05, 2024-03, 2024-04, 2024-05. In each fold the variant with the best
train expectancy (pooled net mean, L0c) is applied to the test month; its test-month trades (already simulated in
Stage 2, the same code) are the OOS trades.
"""
from __future__ import annotations

import argparse
import glob
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from engine.walkforward import M as CM, config_matrix, monthly_folds  # noqa: E402
from stage1.run import eval_sessions  # noqa: E402
from stage2.metrics import metrics, regime, with_labels  # noqa: E402

S2 = os.path.join(EMA_DATA, 'results', 'stage2')
OUT = os.path.join(EMA_DATA, 'results', 'stage3')


def load_family(ids) -> dict:
    out = {}
    for v in ids:
        parts = [pd.read_parquet(p) for p in sorted(glob.glob(os.path.join(S2, 'trades', f'{v}_*.parquet')))]
        t = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        out[v] = t[t.status == 'filled'].copy() if len(t) else t
    return out


def walk_forward(fam: dict, days) -> dict:
    folds = monthly_folds(days, min_train_months=2, embargo=1)
    oos, chosen = [], []
    for f in folds:
        tr = set(f.train)
        scores = {}
        for v, t in fam.items():
            x = t[t.session.astype(str).isin(tr)]
            scores[v] = float(x.ret_net.mean()) if len(x) else -np.inf
        best = max(scores, key=lambda k: scores[k])
        te = set(f.test)
        o = fam[best][fam[best].session.astype(str).isin(te)].assign(fold=f.k, chosen=best)
        oos.append(o)
        chosen.append({'fold': f.k, 'test_month': f.test[0][:6], 'chosen': best, 'train_exp': scores[best],
                       'n_train_sessions': len(f.train), 'n_test_sessions': len(f.test), 'test_n': len(o),
                       'test_exp': float(o.ret_net.mean()) if len(o) else np.nan})
    return {'oos': pd.concat(oos, ignore_index=True) if oos else pd.DataFrame(), 'chosen': pd.DataFrame(chosen),
            'test_days': sorted(d for f in folds for d in f.test)}


def pbo(fam: dict, days) -> dict:
    per = {v: t.groupby(t.session.astype(str)).ret_net.mean() for v, t in fam.items() if len(t)}
    M = config_matrix(per, days)
    return CM.pbo_cscv(M, n_blocks=16)


def dev_bar(oos: pd.DataFrame, test_days, n_trials: int, pbo_val: float, null_pct: dict | None = None) -> dict:
    o = with_labels(oos)
    m = metrics(o, test_days)
    r = o.ret_net.to_numpy(float)
    from scipy import stats as sst
    sk = float(sst.skew(r)) if len(r) > 2 else 0.0
    ku = float(sst.kurtosis(r, fisher=False)) if len(r) > 3 else 3.0
    dsr = CM.deflated_sharpe(m.get('sharpe_trade', np.nan), len(r), n_trials, None, sk, ku) if len(r) > 2 else {'dsr': np.nan}
    blk = {b: float(g.ret_net.mean()) for b, g in o.groupby('block')} if len(o) else {}
    reg = {k: (len(g), float(g.ret_net.mean())) for k, g in o.groupby('regime')} if len(o) else {}
    t = {'n_ge_150': m['n'] >= 150, 'ci_gt_0': bool(m.get('ci', (np.nan,))[0] > 0),
         'win_or_payoff': bool(m.get('win_rate', 0) >= 0.55 or m.get('expectancy', -1) >= 0.10),
         'dsr_ge_0.95': bool(dsr.get('dsr', 0) >= 0.95), 'pbo_lt_0.3': bool(pbo_val < 0.3),
         'both_blocks_gt_0': bool(len(blk) == 2 and all(v > 0 for v in blk.values())),
         'ge2_daytypes_gt_0': sum(1 for n, v in reg.values() if n >= 10 and v > 0) >= 2}
    if null_pct is not None:
        t['beats_nulls_95'] = all(v >= 0.95 for v in null_pct.values())
    t['pass'] = all(t.values())
    return {'metrics': m, 'dsr': dsr, 'by_block': blk, 'by_regime': reg, 'tests': t}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default='S2C')
    a = ap.parse_args()
    from stage2.run import family
    ids = [v['id'] for v in family(a.family) if not v['id'].startswith('REF')]
    fam = load_family(ids)
    ses = eval_sessions()
    days = sorted(s for v in ses.values() for s in v)
    wf = walk_forward(fam, days)
    pb = pbo(fam, days)
    N = CM.ledger_trials()
    bar = dev_bar(wf['oos'], wf['test_days'], N, pb['pbo'])
    os.makedirs(OUT, exist_ok=True)
    wf['oos'].to_parquet(os.path.join(OUT, f'wf_{a.family}_oos.parquet'))
    pickle.dump({'chosen': wf['chosen'], 'pbo': pb, 'bar': bar, 'n_trials': N, 'test_days': wf['test_days']},
                open(os.path.join(OUT, f'wf_{a.family}.pkl'), 'wb'))
    print(wf['chosen'].to_string())
    print('PBO', pb.get('pbo'), 'DSR', bar['dsr'], 'bar', bar['tests'])


if __name__ == '__main__':
    main()
