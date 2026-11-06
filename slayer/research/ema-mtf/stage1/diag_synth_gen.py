"""POST-HOC diagnostic of the synthetic zero-drift generator (stage1/synth.py): is its premium a martingale at the
decision times?

The generator prices every option at Black-Scholes with ONE vol per session (the session's annualised RV) while the
synthetic underlying moves with the real 5-minute vol profile (U-shaped). The premium then drifts: up early, when local
variance is above the session average, and down midday, when it is below. The drift's size depends on gamma (moneyness,
DTE) and on the session's vol level. So a premium-state feature can "predict" it even though the underlying is a
martingale: the generator, not the screen, carries information. Output: mean synthetic mid-to-mid Y30 by half-hour, and
by L200@60m, over every cached seed.

    python3 -m stage1.diag_synth_gen   -> v2data/ema/results/stage1/s1_diag_synthgen.pkl
"""
from __future__ import annotations

import glob
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.run import OUT, SYN_PARTS  # noqa: E402


def main():
    rows, split = [], []
    for p in sorted(glob.glob(os.path.join(SYN_PARTS, 'seed*_*.parquet'))):
        ev = pd.read_parquet(p, columns=['m', 'status_ok', 'Ymid30', 'f_L200_60', 'f_L50_15', 'f_S_15'])
        ev = ev[ev.status_ok]
        ev['hh'] = (ev.m + 1) // 30
        rows.append(ev.groupby('hh').Ymid30.agg(['sum', 'count']))
        for F in ('f_L200_60', 'f_L50_15', 'f_S_15'):
            x = ev[np.isfinite(ev[F])]
            split.append({'feature': F, 'v': 1, 's': x[x[F] == 1].Ymid30.sum(), 'n': int((x[F] == 1).sum())})
            split.append({'feature': F, 'v': 0, 's': x[x[F] == 0].Ymid30.sum(), 'n': int((x[F] == 0).sum())})
    prof = pd.concat(rows).groupby(level=0).sum()
    prof['mean'] = prof['sum'] / prof['count']
    sp = pd.DataFrame(split).groupby(['feature', 'v'])[['s', 'n']].sum()
    sp['mean'] = sp.s / sp.n
    out = {'by_halfhour': prof['mean'].to_dict(), 'by_feature': sp['mean'].to_dict(),
           'n_parts': len(glob.glob(os.path.join(SYN_PARTS, 'seed*_*.parquet')))}
    pickle.dump(out, open(os.path.join(OUT, 's1_diag_synthgen.pkl'), 'wb'))
    print(out)


if __name__ == '__main__':
    main()
