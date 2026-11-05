"""Group B rows (research/groupb/build.ts): loading, the two feature versions, and the locked session sets.

Each built day is a csv.gz; on first read it is converted once to a float32 zstd parquet (verified readable) and the
csv removed. X(df, 1) is version 1's 56 inputs (the shipped trees' columns), X(df, 2) version 2's (the clock's twelve
columns v15, v24-v27, v36-v42 in place of version 1's; the rest are the same input)."""
import os, glob
import numpy as np
import pandas as pd

DATA = os.environ.get('GB_DATA', '/tmp/gb-data')
ROWS = os.path.join(DATA, 'rows')
V2_COLS = [15, 24, 25, 26, 27, 36, 37, 38, 39, 40, 41, 42]
TEXT = ['day', 'sleeve', 'ticker', 'id', 'expiry', 'right', 'mark', 'session']


def train_days():
    """The current trees' training window that the cache holds (their six months ended 2026-10-23), less the locked
    holdout H1's 2026-10-05.. block: 2026-06-29 .. 2026-10-02."""
    return [d for d in built() if '2026-06-28' < d < '2026-10-03']


def is_h1(d):
    return d.startswith('2022-06') or d.startswith('2024-08') or ('2026-10-05' <= d <= '2026-10-30')


def h1_block(d):
    return 'H1-2022-06' if d.startswith('2022-06') else 'H1-2024-08' if d.startswith('2024-08') else 'H1-2026-10'


def is_h2(d):
    return ('2022-07-01' <= d <= '2022-09-30') or ('2025-01-02' <= d <= '2025-03-31')


def h2_block(d):
    return 'H2-2022Q3' if d.startswith('2022') else 'H2-2025Q1'


def built():
    return sorted({os.path.basename(f)[:10] for f in glob.glob(os.path.join(ROWS, '*.meta.json'))})


def load_day(day):
    pq = os.path.join(ROWS, f'{day}.parquet')
    src = os.path.join(ROWS, f'{day}.csv.gz')
    if os.path.exists(pq) and not os.path.exists(src):
        return pd.read_parquet(pq)
    df = pd.read_csv(src, low_memory=False, dtype={c: str for c in TEXT})
    for c in TEXT:
        df[c] = df[c].fillna('').astype(str)
    for c in df.columns:
        if c in TEXT:
            continue
        if c[0] in 'xv' and c[1:].isdigit() or c in ('p1', 'prun', 'retOpen', 'fill', 'retA', 'retR', 'best', 'bid', 'ask', 'strike'):
            df[c] = df[c].astype(np.float32 if c[0] in 'xv' else np.float64)
    df.to_parquet(pq + '.tmp', compression='zstd')
    back = pd.read_parquet(pq + '.tmp')
    assert len(back) == len(df), f'{day}: parquet rows {len(back)} != {len(df)}'
    os.replace(pq + '.tmp', pq)
    os.remove(src)
    return back


def load(days, cols=None):
    parts = []
    for d in days:
        x = load_day(d)
        if cols is not None:
            x = x[[c for c in cols if c in x.columns]]
        parts.append(x)
    return pd.concat(parts, ignore_index=True)


def X(df, version):
    cols = [f'x{i}' if version == 1 or i not in V2_COLS else f'v{i}' for i in range(56)]
    return df[cols].to_numpy(dtype=np.float32)


def feature_cols():
    return [f'x{i}' for i in range(56)] + [f'v{i}' for i in V2_COLS]
