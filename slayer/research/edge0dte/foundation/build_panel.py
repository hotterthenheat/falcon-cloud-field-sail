"""FOUNDATION task 3: per-root DISCOVERY + CALIBRATION decision-grid panels (2020-02-18 .. 2024-12-31 only).

  cd slayer/research/edge0dte && PROCS=3 python3 -m foundation.build_panel [ROOT ...]
  -> v2data/edge0dte/panel/{ROOT}.parquet (zstd) + panel/{ROOT}.labels.json (column -> OBS/CALC/MODEL)

Root-sessions without a board or bars are skipped (listed in results/COVERAGE.md). Columns: lib/panel.py docstring.
"""
import json
import os
import sys
from multiprocessing import Pool

import pandas as pd

from lib import cal, panel
from lib.config import DATA, ROOTS
from lib.data import bars, chain


def one(args):
    root, day = args
    if chain(root, day) is None or not len(bars(root, day)):
        return None
    try:
        return panel.build_day(root, day)
    except Exception as e:                                      # report, never silently drop
        print('ERROR', root, day, repr(e), flush=True)
        return None


def main():
    roots = sys.argv[1:] or list(ROOTS)
    os.makedirs(os.path.join(DATA, 'panel'), exist_ok=True)
    for root in roots:
        days = cal.expiry_sessions(root, '2020-02-18', '2024-12-31')
        with Pool(int(os.environ.get('PROCS', '3'))) as p:
            parts = [x for x in p.imap(one, [(root, d) for d in days], chunksize=4) if x is not None]
        df = pd.concat(parts, ignore_index=True)
        assert df.day.max() < '2025-01-01'
        df.to_parquet(os.path.join(DATA, 'panel', f'{root}.parquet'), compression='zstd')
        json.dump({c: panel.LABELS.get(c, 'CALC') for c in df.columns}, open(os.path.join(DATA, 'panel', f'{root}.labels.json'), 'w'), indent=1)
        print(root, df.shape, df.day.nunique(), 'sessions', 'iv_atm finite', round(df.iv_atm.notna().mean(), 4), flush=True)


if __name__ == '__main__':
    main()
