"""FOUNDATION task 3: per-root DISCOVERY + CALIBRATION decision-grid panels (2020-02-18 .. 2024-12-31 only).

  cd slayer/research/edge0dte && PROCS=2 python3 -m foundation.build_panel [ROOT ...] [--assemble-only]
  -> v2data/edge0dte/panel/{ROOT}.parquet (zstd) + panel/{ROOT}.labels.json (column -> OBS/CALC/MODEL)

Resumable: each root-session is written to panel/parts/{ROOT}/{day}.parquet (atomic rename) as soon as it is built;
a restart skips the parts that exist. Root-sessions without a board or bars are not built; they are recorded in
panel/parts/{ROOT}/_skipped.jsonl with the reason (and listed in results/COVERAGE.md). The final {ROOT}.parquet is
assembled from the parts once every expiry session of the root has a part or a skip record. Columns: lib/panel.py.
"""
import json
import os
import sys
from multiprocessing import Pool

import pandas as pd

from lib import cal, panel
from lib.config import DATA, ROOTS
from lib.data import bars, chain

PANEL = os.path.join(DATA, 'panel')


def part_path(root, day):
    return os.path.join(PANEL, 'parts', root, f'{day}.parquet')


def skip_path(root):
    return os.path.join(PANEL, 'parts', root, '_skipped.jsonl')


def skipped(root):
    f = skip_path(root)
    if not os.path.exists(f):
        return {}
    out = {}
    for line in open(f):
        r = json.loads(line)
        out[r['day']] = r['reason']
    return out


def one(args):
    root, day = args
    c = chain(root, day)
    if c is None or not len(c):
        return root, day, 'no 0DTE board'
    if not len(bars(root, day)):
        return root, day, 'no underlying bars'
    try:
        df = panel.build_day(root, day)
    except Exception as e:                                      # report, never silently drop
        return root, day, f'ERROR {e!r}'
    f = part_path(root, day)
    tmp = f + '.tmp'
    df.to_parquet(tmp, compression='zstd')
    os.replace(tmp, f)
    return root, day, None


def assemble(root, days):
    parts = [pd.read_parquet(part_path(root, d)) for d in days if os.path.exists(part_path(root, d))]
    df = pd.concat(parts, ignore_index=True)
    assert df.day.max() < '2025-01-01'
    df.to_parquet(os.path.join(PANEL, f'{root}.parquet'), compression='zstd')
    json.dump({c: panel.LABELS.get(c, 'CALC') for c in df.columns},
              open(os.path.join(PANEL, f'{root}.labels.json'), 'w'), indent=1)
    print(root, df.shape, df.day.nunique(), 'sessions', 'iv_atm finite', round(df.iv_atm.notna().mean(), 4), flush=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    roots = args or list(ROOTS)
    for root in roots:
        os.makedirs(os.path.join(PANEL, 'parts', root), exist_ok=True)
        days = cal.expiry_sessions(root, '2020-02-18', '2024-12-31')
        if '--assemble-only' not in sys.argv:
            sk = skipped(root)
            todo = [(root, d) for d in days if not os.path.exists(part_path(root, d)) and d not in sk]
            print(root, len(days), 'sessions,', len(todo), 'to build', flush=True)
            with Pool(int(os.environ.get('PROCS', '2'))) as p, open(skip_path(root), 'a') as fs:
                for i, (r, d, why) in enumerate(p.imap_unordered(one, todo, chunksize=2)):
                    if why is not None:
                        print('SKIP', r, d, why, flush=True)
                        if not why.startswith('ERROR'):           # errors are retried on the next run
                            fs.write(json.dumps({'day': d, 'reason': why}) + '\n')
                            fs.flush()
                    if i % 50 == 0:
                        print(root, i, len(todo), d, flush=True)
        assemble(root, days)


if __name__ == '__main__':
    main()
