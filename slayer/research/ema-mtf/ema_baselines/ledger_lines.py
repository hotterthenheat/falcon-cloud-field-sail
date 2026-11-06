"""Print one ledger line per baseline x exit (L0c, DEV block A) for research-v2-ledger.md."""
import glob
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from eval.metrics import cluster_ci_mean  # noqa: E402

NAMES = {'BL1': 'buy-and-hold grid', 'BL2': 'random entries', 'BL3': 'underlying-only EMA', 'BL4': 'option-only EMA',
         'BL5': 'combined', 'BL6': 'plain directional'}
d = pd.concat([pd.read_parquet(f) for f in glob.glob(os.path.join(EMA_DATA, 'results', 'baselines_*.parquet'))])
f = d[(d.status == 'filled') & (d.latency == 'L0c')]
for bl, nm in NAMES.items():
    for x in ('XT30', 'X3S'):
        t = f[(f.baseline == bl) & (f.exit == x)]
        lo, hi = cluster_ci_mean(t.ret_net.to_numpy(), t.session.astype(str).to_numpy(), 2000)
        print(f'2026-11-06 | EMA | {bl} {nm} exit {x} | DEV block A (64 sessions, SPY/QQQ/IWM/SPXW, 5 DTE buckets) | {len(t)} | '
              f'exp {100 * t.ret_net.mean():+.1f}% [{100 * lo:+.1f},{100 * hi:+.1f}] net (L0c), win {100 * (t.ret_net > 0).mean():.0f}%, '
              f'mid-to-mid {100 * t.ret_mid.mean():+.1f}% | baseline reference, not a candidate; DSR 0.00; ema-mtf/reports/BASELINES.md')
