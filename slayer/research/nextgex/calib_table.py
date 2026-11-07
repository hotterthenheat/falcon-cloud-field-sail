"""The track-record table the prototype ships with: for each root, how often a tail the 0DTE board priced at p
actually happened (pooled 2020-02 .. 2024-12, never 2025+), by priced-probability bin and by distance in priced
standard moves, with day-clustered bootstrap CIs. Aggregates only: no quote, OI or price row leaves v2data.

    python3 -I calib_table.py   # writes proto/calibration.json
"""
import json, os
import numpy as np
import pandas as pd

V2 = '/home/user/falcon-cloud-field-sail/v2data/nextgex'
HERE = os.path.dirname(os.path.abspath(__file__))
BINS = [0, .01, .02, .05, .1, .2, .3, .5]
RNG = np.random.default_rng(7)


def cell(x):
    g = x.groupby('day')[['y', 'p']].agg(['sum']).droplevel(1, axis=1)
    n = x.groupby('day').size()
    W = RNG.multinomial(len(g), np.full(len(g), 1 / len(g)), size=2000).astype(float)
    fr = (W @ g.y.values) / (W @ n.values)
    return {'n': int(len(x)), 'days': int(len(g)), 'priced': round(float(x.p.mean()), 4), 'real': round(float(x.y.mean()), 4),
            'real_lo': round(float(np.percentile(fr, 2.5)), 4), 'real_hi': round(float(np.percentile(fr, 97.5)), 4)}


def main():
    out = {'period': '2020-02-18..2024-12-31', 'outcome': '15:59-bar close (OBS proxy of the 16:00 settlement)',
           'priced': 'vertical-spread odds off the 0DTE board (CALC), isotonic', 'roots': {}}
    for root in ('SPXW', 'SPY', 'QQQ', 'IWM'):
        d = pd.read_parquet(os.path.join(V2, f'{root}_odds.parquet'))
        assert (d.day < '2025-01-01').all()
        d = d[np.isfinite(d.p)]
        d['side'] = np.where(d.z < 0, 'down', 'up')
        r = {'byBin': [], 'bySigma': []}
        for side in ('down', 'up'):
            x = d[d.side == side]
            for lo, hi in zip(BINS[:-1], BINS[1:]):
                y = x[(x.p > lo) & (x.p <= hi)]
                if len(y) >= 50:
                    r['byBin'].append({'side': side, 'lo': lo, 'hi': hi, **cell(y)})
            for z in sorted(x.z.unique(), key=abs):
                r['bySigma'].append({'side': side, 'sigma': abs(float(z)), **cell(x[x.z == z])})
        out['roots'][root] = r
    with open(os.path.join(HERE, 'proto', 'calibration.json'), 'w') as fh:
        json.dump(out, fh, indent=1)


if __name__ == '__main__':
    main()
