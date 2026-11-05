"""L1 runner.  python3 run_l1.py minute|fetch|sec|nulls|val   (outputs under v2data/edge-l/ and edge-l/results/)

minute : every eligible (root, session, T) x structure x exit on the 1-minute chain path (all R; nulls, sweep)
fetch  : 1-second NBBO for the legs of triggered rows (split given by SPLIT env, default DEV), one request in flight
sec    : the triggered trades on the 1-second path (primary execution)
"""
import json
import os
import shutil
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from common import OUT, UND, bars, chain, q1s, bs  # noqa
from l1sim import VARIANTS, simulate, minute_quotes, FLAT  # noqa

RES = os.path.join(HERE, 'results')
os.makedirs(RES, exist_ok=True)


def load_signals():
    s = pd.read_parquet(os.path.join(OUT, 'signals.parquet'))
    return s[s.F.notna()].reset_index(drop=True)


def straddle_ok(r):
    for b, a, sz, d in ((r.c_bid, r.c_ask, r.c_as, r.dC), (r.p_bid, r.p_ask, r.p_as, r.dP)):
        mid = (a + b) / 2
        if b <= 0 or a - b > 0.08 * mid or sz < 1 or not (0.35 <= abs(d) <= 0.65):
            return False
    return True


def legs_of(r, kind):
    if kind == 'S':
        return [(r.K_atm, True), (r.K_atm, False)] if straddle_ok(r) else None
    if r.side == 0:
        return None
    k = r.dc_k if r.side > 0 else r.dp_k
    return [(float(k), r.side > 0)] if np.isfinite(k) else None


def bars_arr(root, day):
    b = bars(UND[root])[day]
    return b.m.values.astype(np.int64), b.c.values.astype(float)


STRUCT = sorted({(v['kind'], v['T'], v['exit']) for v in VARIANTS.values()})


def run_minute():
    S = load_signals()
    out = []
    for (root, day), g in S.groupby(['root', 'day']):
        ch = chain(root, day)
        bm, bc = bars_arr(root, day)
        for kind, T, ex in STRUCT:
            rr = g[g['T'] == T]
            if not len(rr):
                continue
            r = rr.iloc[0]
            legs = legs_of(r, kind)
            if legs is None:
                continue
            qs = [minute_quotes(ch, k, c) for k, c in legs]
            res = simulate(legs, qs, bm, bc, T, r.F, kind, ex, side=r.side, K=r.K_atm)
            if res:
                out.append(dict(root=root, day=day, T=T, kind=kind, exit=ex, R=r.R, split=r.split,
                                roi=r.real_over_imp, **res))
    df = pd.DataFrame(out)
    df.to_parquet(os.path.join(OUT, 'minute_all.parquet'))
    print(len(df), df.groupby(['kind', 'T', 'exit', 'split']).ret_net.agg(['size', 'mean']).to_string())


def triggered(S, split):
    rows = []
    for vid, v in VARIANTS.items():
        g = S[(S['T'] == v['T']) & (S.R >= v['k']) & (S.split == split)]
        for _, r in g.iterrows():
            legs = legs_of(r, v['kind'])
            if legs:
                rows.append((vid, r, legs))
    return rows


def run_fetch(split):
    S = load_signals()
    todo = {}
    for vid, r, legs in triggered(S, split):
        for k, c in legs:
            todo[(r.root, r.day, k, c, int(r['T']))] = 1
    print('legs to fetch', len(todo), flush=True)
    for i, (root, day, k, c, T) in enumerate(sorted(todo)):
        st = shutil.disk_usage('/home/user')
        if st.free < 2.0e9:
            print('disk low, stop', st.free)
            break
        q1s(root, day, k, c, T, FLAT + 120)
        if i % 25 == 0:
            print(i, root, day, k, c, flush=True)


def run_sec(split):
    S = load_signals()
    out = []
    for vid, r, legs in triggered(S, split):
        T = int(r['T'])
        qs = [q1s(r.root, r.day, k, c, T, FLAT + 120) for k, c in legs]
        if any(q is None or not len(q['s']) for q in qs):
            out.append(dict(variant=vid, root=r.root, day=r.day, missing=True))
            continue
        bm, bc = bars_arr(r.root, r.day)
        v = VARIANTS[vid]
        res = simulate(legs, qs, bm, bc, T, r.F, v['kind'], v['exit'], side=r.side, K=r.K_atm)
        if res is None:
            out.append(dict(variant=vid, root=r.root, day=r.day, missing=True))
            continue
        out.append(dict(variant=vid, root=r.root, day=r.day, T=T, R=r.R, roi=r.real_over_imp, missing=False,
                        legs=json.dumps(legs), **res))
    df = pd.DataFrame(out)
    df.to_parquet(os.path.join(OUT, f'sec_{split}.parquet'))
    print(df.groupby('variant').agg(n=('ret_net', 'count'), miss=('missing', 'sum'), net=('ret_net', 'mean'),
                                    gross=('ret_gross', 'mean'), win=('ret_net', lambda x: (x > 0).mean())).to_string())


if __name__ == '__main__':
    cmd = sys.argv[1]
    split = os.environ.get('SPLIT', 'DEV')
    {'minute': run_minute, 'fetch': lambda: run_fetch(split), 'sec': lambda: run_sec(split)}[cmd]()
