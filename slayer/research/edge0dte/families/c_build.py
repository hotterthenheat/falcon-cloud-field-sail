"""Build the family-C feature table for DISCOVERY sessions only (no outcome is read here).

  cd slayer/research/edge0dte && python3 -m families.c_build SPXW [SPY ...]

Writes v2data/edge0dte/stage1/C_feat/{ROOT}/part_NNN.parquet (resumable: days already in a part are skipped), one row
per (day, t) of the panel's decision grid. Sessions are processed in date order so the per-minute delta-flow and
spread series of a finished session are reused as "prior session" history (families.c_micro.STORE).
"""
import os
import sys
import time

import pandas as pd

from families import c_micro as C
from lib import panel
from lib.config import DATA

OUT = os.path.join(DATA, 'stage1', 'C_feat')


def run(root):
    d = os.path.join(OUT, root)
    os.makedirs(d, exist_ok=True)
    done = set()
    parts = sorted(f for f in os.listdir(d) if f.endswith('.parquet'))
    for f in parts:
        done |= set(pd.read_parquet(os.path.join(d, f), columns=['day']).day.unique())
    p = pd.read_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'), columns=['day', 't', 'split'])
    p = p[p.split == 'DISCOVERY']                       # DISCOVERY only; 2024+ never touched
    days = sorted(p.day.unique())
    times = {dd: sorted(g.t.astype(int)) for dd, g in p.groupby('day')}
    rows, n_part, t0 = [], len(parts), time.time()
    for i, day in enumerate(days):
        if day in done:
            continue
        sess = panel.session(root, day)
        for t in times[day]:
            row = {'root': root, 'day': day, 't': t}
            for n in C.C_FEATURES:
                panel._run_feature(n, sess, t, row)
            rows.append(row)
        # finished session: keep its per-minute series for later sessions' prior-day history
        if hasattr(sess, '_dfc'):
            C.STORE['df'][(root, day)] = dict(sess._dfc)
        if hasattr(sess, '_snapc'):
            C.STORE['c7'][(root, day)] = {mm: v[1] for mm, v in sess._snapc.items()}
        del sess
        if len({r['day'] for r in rows}) >= 50 or i == len(days) - 1:
            if rows:
                pd.DataFrame(rows).to_parquet(os.path.join(d, f'part_{n_part:03d}.parquet'), compression='zstd')
                n_part += 1
                rows = []
            print(root, i + 1, len(days), day, f'{time.time() - t0:.0f}s', flush=True)
    if rows:
        pd.DataFrame(rows).to_parquet(os.path.join(d, f'part_{n_part:03d}.parquet'), compression='zstd')


def load(root):
    d = os.path.join(OUT, root)
    return pd.concat([pd.read_parquet(os.path.join(d, f)) for f in sorted(os.listdir(d)) if f.endswith('.parquet')],
                     ignore_index=True)


if __name__ == '__main__':
    for r in sys.argv[1:]:
        run(r)
