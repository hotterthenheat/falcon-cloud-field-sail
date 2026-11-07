"""Build the AE feature table (DISCOVERY sessions only) and the A3 1-minute crossing events.

  cd slayer/research/edge0dte && PROCS=2 python3 -m families.ae_build ROOT [ROOT ...]

Per root-session -> v2data/edge0dte/stage1_AE/parts/{ROOT}/{day}.parquet (grid rows: features only, no outcomes;
outcomes come from the FOUNDATION panel) and {day}.a3m.parquet (1-minute flip-crossing events with their Z at
15/30/60/close, computed with lib.outcomes.zv). Resumable. Then assembled into stage1_AE/{ROOT}.parquet and
{ROOT}.a3m.parquet. Sessions > 2023-12-31 are refused here (DISCOVERY only; CALIBRATION is a later single look).
"""
import os
import sys

for _v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_v, '1')
from multiprocessing import Pool

import numpy as np
import pandas as pd

from families import ae_dealer  # noqa: F401  (registers the features)
from lib import cal, panel
from lib.config import DATA, HORIZONS, bucket, split
from lib.data import bars, chain
from lib.outcomes import zv

OUT = os.path.join(DATA, 'stage1_AE')
FEATS = ('ae_p', 'ae_g7', 'ae_calc')


def one(args):
    root, day = args
    assert split(day) == 'DISCOVERY', day
    d = os.path.join(OUT, 'parts', root)
    f = os.path.join(d, f'{day}.parquet')
    if os.path.exists(f):
        return root, day, 'exists'
    c = chain(root, day)
    if c is None or not len(c) or not len(bars(root, day)):
        return root, day, 'no board/bars'
    try:
        sess = panel.session(root, day)
        rows = []
        for t in panel.grid(day):
            row = {'root': root, 'day': day, 't': int(t)}
            for n in FEATS:
                panel._run_feature(n, sess, int(t), row)
            rows.append(row)
        df = pd.DataFrame(rows)
        # A3 G 1-minute: flip of the latest 5-minute grid time <= tau (same-day OI, P)
        ev = []
        for oi in ('p', 'g7'):
            flips = dict(zip(df.t.values.astype(int), df[f'ae_{oi}_flip'].values))
            g = sorted(flips)
            for tau, dr in ae_dealer.a3_minute_events(sess, flips, g[0], g[-1]):
                iv = sess.iv_atm(tau)
                r = {'root': root, 'day': day, 't': tau, 'oi': oi, 'dir': dr, 'bucket': bucket(tau)}
                for h in HORIZONS:
                    r[f'Z_{h}'] = zv(sess, tau, h, iv)['Z']
                ev.append(r)
        os.makedirs(d, exist_ok=True)
        a3 = pd.DataFrame(ev, columns=['root', 'day', 't', 'oi', 'dir', 'bucket'] + [f'Z_{h}' for h in HORIZONS])
        a3.to_parquet(os.path.join(d, f'{day}.a3m.parquet'))
        df.to_parquet(f + '.tmp')
        os.replace(f + '.tmp', f)
    except Exception as e:
        return root, day, f'ERROR {e!r}'
    return root, day, None


def assemble(root):
    d = os.path.join(OUT, 'parts', root)
    days = [x[:-8] for x in sorted(os.listdir(d)) if x.endswith('.parquet') and not x.endswith('.a3m.parquet')]
    g = pd.concat([pd.read_parquet(os.path.join(d, f'{x}.parquet')) for x in days], ignore_index=True)
    a = pd.concat([pd.read_parquet(os.path.join(d, f'{x}.a3m.parquet')) for x in days], ignore_index=True)
    g.to_parquet(os.path.join(OUT, f'{root}.parquet'), compression='zstd')
    a.to_parquet(os.path.join(OUT, f'{root}.a3m.parquet'), compression='zstd')
    print(root, 'assembled', len(days), 'sessions', len(g), 'rows', len(a), 'a3m events', flush=True)


def main():
    roots = [r for r in sys.argv[1:] if not r.startswith('-')]
    procs = int(os.environ.get('PROCS', '2'))
    for root in roots:
        days = [d for d in cal.expiry_sessions(root) if split(d) == 'DISCOVERY']
        todo = [(root, d) for d in days]
        bad = []
        with Pool(procs, maxtasksperchild=40) as pool:
            for i, (r, d, why) in enumerate(pool.imap_unordered(one, todo, chunksize=2)):
                if why not in (None, 'exists'):
                    bad.append((d, why))
                    print(r, d, why, flush=True)
                if i % 50 == 0:
                    print(r, i, len(todo), d, flush=True)
        with open(os.path.join(OUT, f'{root}.skipped.txt'), 'w') as f:
            for d, why in bad:
                f.write(f'{d}\t{why}\n')
        assemble(root)


if __name__ == '__main__':
    main()
