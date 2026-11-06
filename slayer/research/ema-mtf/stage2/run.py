"""Stage-2 driver: every registered variant of a family on every (block, root), its trade log, and its nulls.

    python3 -m stage2.run --family S2C --blocks A,B [--roots SPY,QQQ,IWM,SPXW] [--null-seeds 20]

Trade logs (every trade, winners and losers, rejected entries included as status='rejected'):
    v2data/ema/results/stage2/trades/<variant>_<block>_<root>.parquet
Null summaries (per variant x null kind x seed x block x root: n, sum of net returns, sum of net $):
    v2data/ema/results/stage2/nulls/<variant>_<block>_<root>.parquet
Resumable: a (variant, block, root) whose files exist is skipped.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from stage2.tables import Stage2Data  # noqa: E402
from stage2.sim import Cfg  # noqa: E402
from stage2.variants import Runner, null_summaries, run_variant, stage2c  # noqa: E402

OUT = os.path.join(EMA_DATA, 'results', 'stage2')
REFS = [{'id': 'REF-BL3-X3', 'entry': 'BL3', 'mtf': None, 'exit': 'X3'}]


def family(name: str) -> list:
    if name == 'S2C':
        return stage2c() + REFS
    if name == 'S2S':
        import json
        return json.load(open(os.path.join(OUT, 'S2S_variants.json')))
    raise KeyError(name)


def _write(df, p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    df.to_parquet(p + '.tmp')
    os.replace(p + '.tmp', p)


def run(fam: str, blocks, roots, null_seeds: int, log=print, lat='L0c', also_l60=True):
    vs = family(fam)
    tdir = 'trades' if lat == 'L0c' else f'trades_{lat}'
    if lat != 'L0c':
        null_seeds = 0
    for b in blocks:
        for r in roots:
            todo = [v for v in vs if not (os.path.exists(os.path.join(OUT, tdir, f"{v['id']}_{b}_{r}.parquet")) and
                                          (v['id'].startswith('REF') or null_seeds == 0 or
                                           os.path.exists(os.path.join(OUT, 'nulls', f"{v['id']}_{b}_{r}.parquet"))))]
            if not todo:
                continue
            t0 = time.time()
            data = Stage2Data(r, b, log=log)
            R = Runner(data, Cfg(latency=lat))
            log(r, b, f'data in {time.time()-t0:.0f}s')
            for v in todo:
                t1 = time.time()
                tp = os.path.join(OUT, tdir, f"{v['id']}_{b}_{r}.parquet")
                if os.path.exists(tp):
                    t = pd.read_parquet(tp)
                else:
                    t = run_variant(R, v)
                    t['variant'] = v['id']
                    _write(t, tp)
                nf = int((t.status == 'filled').sum()) if len(t) else 0
                if lat == 'L0c' and also_l60:
                    p60 = os.path.join(OUT, 'trades_L60', f"{v['id']}_{b}_{r}.parquet")
                    if not os.path.exists(p60):
                        t60 = run_variant(R, v, cfg=Cfg(latency='L60'))
                        t60['variant'] = v['id']
                        _write(t60, p60)
                rows = []
                if null_seeds and not v['id'].startswith('REF') and nf:
                    ns = null_summaries(R, t, v['exit'], range(null_seeds)).assign(variant=v['id'], block=b, root=r)
                    rows = ns.to_dict('records')
                    _write(pd.DataFrame(rows), os.path.join(OUT, 'nulls', f"{v['id']}_{b}_{r}.parquet"))
                log(r, b, v['id'], f'{nf} trades', f"mean {t[t.status == 'filled'].ret_net.mean() if nf else np.nan:+.4f}" if False else '',
                    f'{time.time()-t1:.0f}s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default='S2C')
    ap.add_argument('--blocks', default='A,B')
    ap.add_argument('--roots', default='SPY,QQQ,IWM,SPXW')
    ap.add_argument('--null-seeds', type=int, default=20)
    ap.add_argument('--lat', default='L0c')
    a = ap.parse_args()
    run(a.family, a.blocks.split(','), a.roots.split(','), a.null_seeds, log=lambda *x: print(*x, flush=True), lat=a.lat)


if __name__ == '__main__':
    main()
