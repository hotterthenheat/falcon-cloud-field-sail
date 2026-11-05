"""Store size per session (from the manifests) -> data/SIZES.md, and the projection for a full DEV set.

    python3 -m data.sizes
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from data.store import Session, list_sessions
from eval.report import md_table

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    rows = []
    for d in list_sessions():
        s = Session(d)
        m = s.manifest
        r = {'session': d, 'MB': round(m['bytes_total'] / 1e6, 1), 'fetch s': m.get('seconds')}
        for root, v in m['roots'].items():
            r[f'{root} contracts'] = sum(v['contracts'].values())
            r[f'{root} MB'] = round(sum(v['bytes'].values()) / 1e6, 1)
            r[f'{root} exps'] = ','.join(e[4:] for e in v['expirations'])
        z = 0.0
        for root, v in m['roots'].items():
            f = os.path.join(s.dir, f'{root}_quotes.parquet')
            if os.path.exists(f):
                e = pq.read_table(f, columns=['exp']).column('exp').to_numpy()
                z += (e == int(d)).mean() * v['bytes'].get('quotes', 0)
        r['0DTE quote MB'] = round(z / 1e6, 1)
        r['und MB'] = round(sum(m.get('underlying', {}).values()) / 1e6, 1)
        r['uw MB'] = round(sum(x for k, x in m.get('uw', {}).items() if isinstance(x, int) and not k.endswith('_n')) / 1e6, 2)
        rows.append(r)
    df = pd.DataFrame(rows)
    mb = df.MB.to_numpy()
    txt = (f'# Store size per session\n\n{len(df)} sessions, total {mb.sum()/1e3:.2f} GB; per session median {np.median(mb):.0f} MB, '
           f'mean {mb.mean():.0f} MB, max {mb.max():.0f} MB (fetch {df["fetch s"].median():.0f} s median at 2 requests in flight).\n'
           f'Projection: all ~1,000 DEV sessions 2020-2024 x 3 roots at the mean = {mb.mean()*1000/1e3:.0f} GB. '
           f'Of which same-day (0DTE) option quotes: mean {df["0DTE quote MB"].mean():.0f} MB/session (the 1DTE/next-expiry '
           f'quotes, the whole-chain prints, greeks, underlying and UW are the rest).\n'
           f'Full tick NBBO instead of the 100 ms rule is ~10x the quote bytes (busy ATM SPXW contract, 2024-08-05: '
           f'4.29 MB vs 0.44 MB, both delta-encoded zstd).\n\n' + md_table(df, '.1f') + '\n')
    open(os.path.join(HERE, 'SIZES.md'), 'w').write(txt)
    print(txt[:900])


if __name__ == '__main__':
    sys.exit(main())
