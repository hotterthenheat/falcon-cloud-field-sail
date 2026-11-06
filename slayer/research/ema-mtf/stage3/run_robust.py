"""Run the PREREG section-6 sensitivity looks and the ablation for a list of Stage-2 variants (every root, both DEV
blocks) and write v2data/ema/results/stage3/robust_<family>.json (+ every look's trade log under stage3/robust/).

    python3 -m stage3.run_robust --variants S2C-entryF,S2C-centre [--note "..."]

Paired difference vs the base: sessions resampled together (session-clustered bootstrap, 4000, seed 7) for
mean(look) - mean(base) over each resample's pooled trades.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from engine.walkforward import M as CM  # noqa: E402
from stage1.run import eval_sessions  # noqa: E402
from stage1.stats import boot_weights  # noqa: E402
from stage2.run import PARTS, family  # noqa: E402
from stage2.tables import Stage2Data  # noqa: E402
from stage2.variants import Runner, run_variant  # noqa: E402
from stage3.robust import ablations, run_look, sensitivity_specs, survival  # noqa: E402

S3 = os.path.join(EMA_DATA, 'results', 'stage3')
ROB = os.path.join(S3, 'robust')
S2T = os.path.join(EMA_DATA, 'results', 'stage2', 'trades')


def same_as(av: dict, fam: dict):
    """The id of the Stage-2 variant an ablated variant is identical to (same entry, MTF, timeframes, exit), else None."""
    for vid, v in fam.items():
        if (v['entry'], v.get('mtf'), v['exit']) == (av['entry'], av.get('mtf'), av['exit']) and 'mtf_tfs' not in av:
            return vid
    return None


def paired(base: pd.DataFrame, look: pd.DataFrame, days) -> tuple:
    code = {d: i for i, d in enumerate(days)}
    K = len(days)
    W = boot_weights(K)

    def sums(t):
        t = t[t.status == 'filled']
        i = t.session.astype(str).map(code).to_numpy()
        return (np.bincount(i, weights=t.ret_net.to_numpy(float), minlength=K), np.bincount(i, minlength=K).astype(float))
    sb, nb = sums(base)
    sl, nl = sums(look)
    d = (W @ sl) / (W @ nl) - (W @ sb) / (W @ nb)
    d = d[np.isfinite(d)]
    return float(sl.sum() / nl.sum() - sb.sum() / nb.sum()), (float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--variants', required=True)
    ap.add_argument('--family', default='S2C')
    ap.add_argument('--note', default='')
    a = ap.parse_args()
    fam = {v['id']: v for v in family(a.family)}
    ses = eval_sessions()
    days = sorted(s for v in ses.values() for s in v)
    os.makedirs(ROB, exist_ok=True)
    wanted = a.variants.split(',')
    for b in ('A', 'B'):
        # SPXW in bucket parts (memory); a block already started keeps its split, a new one uses single buckets
        started = glob.glob(os.path.join(ROB, f'*_{b}_SPXW_p*.parquet'))
        spx = ([(f'SPXW_p{i}', 'SPXW', bk) for i, bk in enumerate(PARTS['SPXW'])] if started else
               [(f'SPXW_q{i}', 'SPXW', (bk,)) for i, bk in enumerate(('0', '1-7', '8-30', '31-90', '91-200'))])
        for r, r0, bks in [(x, x, None) for x in ('SPY', 'QQQ', 'IWM')] + spx:
            todo = []
            for vid in wanted:
                v = fam[vid]
                for spec in sensitivity_specs(v):
                    todo.append((v, spec, os.path.join(ROB, f"{vid}|{spec['name']}_{b}_{r}.parquet")))
                for av in ablations(v):
                    if same_as(av, fam) is None:
                        todo.append((av, None, os.path.join(ROB, f"{av['id']}_{b}_{r}.parquet")))
            todo = [x for x in todo if not os.path.exists(x[2])]
            if not todo:
                continue
            data = Stage2Data(r0, b, log=lambda *x: None, **({'buckets': bks} if bks else {}))
            R = Runner(data)
            for v, spec, path in todo:
                t = run_look(R, v, spec) if spec else run_variant(R, v)
                t['look'] = spec['name'] if spec else v['id']
                t.to_parquet(path + '.tmp')
                os.replace(path + '.tmp', path)
                print(b, r, os.path.basename(path), int((t.status == 'filled').sum()) if len(t) else 0, flush=True)
            del R, data
    out = {'note': a.note, 'variants': {}}
    for vid in wanted:
        v = fam[vid]
        base = pd.concat([pd.read_parquet(p) for p in glob.glob(os.path.join(S2T, f'{vid}_*.parquet'))], ignore_index=True)
        bf = base[base.status == 'filled']
        looks = {}
        for spec in sensitivity_specs(v) + [{'name': av['id'].split('|', 1)[1], 'abl': av['id']} for av in ablations(v)]:
            pat = f"{spec['abl']}_*.parquet" if 'abl' in spec else f"{vid}|{spec['name']}_*.parquet"
            ps = glob.glob(os.path.join(ROB, pat))
            if 'abl' in spec:
                twin = same_as(next(a for a in ablations(v) if a['id'] == spec['abl']), fam)
                if twin is not None:          # identical to a Stage-2 variant: its stored trades, not a new look
                    ps = glob.glob(os.path.join(S2T, f'{twin}_*.parquet'))
            if not ps:
                continue
            t = pd.concat([pd.read_parquet(p) for p in ps], ignore_index=True)
            tf = t[t.status == 'filled']
            dlt, dci = paired(base, t, days)
            ci = CM.cluster_ci_mean(tf.ret_net.to_numpy(float), tf.session.astype(str).to_numpy(),
                                    extra_clusters=[d for d in days if d not in set(tf.session.astype(str))])
            looks[('ablation:' if 'abl' in spec else '') + spec['name']] = {
                'n': int(len(tf)), 'exp': float(tf.ret_net.mean()), 'ci': ci, 'delta': dlt, 'delta_ci': dci,
                'neighbour': bool(spec.get('neighbour'))}
        out['variants'][vid] = {'base': float(bf.ret_net.mean()), 'base_n': int(len(bf)), 'looks': looks,
                                'survival': survival(float(bf.ret_net.mean()), {k: v for k, v in looks.items() if not k.startswith('ablation')})}
    json.dump(out, open(os.path.join(S3, f'robust_{a.family}.json'), 'w'), indent=1, default=float)
    print('wrote robust json')


if __name__ == '__main__':
    main()
