"""Vendor-lag check: does the option's 1-second NBBO mid lag its underlying? For the contracts nearest the money,
cross-correlate 10-second changes of the option mid with the underlying's 10-second changes at lags -60..+600 s and
report the best lag (0 = in step). python3 lagcheck.py D ROOT[,ROOT] -> printed table (and results/LAG_<D>.md)"""
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bload as B  # noqa: E402
from mdt import md  # noqa: E402

D = sys.argv[1]
rows = []
for root in sys.argv[2].split(','):
    e = B.expiries(D, root)[0]
    us, up = B.und_1s(D, root)
    ch = B.chain(D, root, e)
    for a, b, lab in ((9 * 3600 + 35 * 60, 10 * 3600 + 15 * 60, '09:35-10:15'), (11 * 3600, 12 * 3600, '11:00-12:00'),
                      (14 * 3600, 15 * 3600, '14:00-15:00')):
        grid = np.arange(a, b + 1)
        S = np.interp(grid, us, up)
        k = float(ch.k.unique()[np.argmin(np.abs(ch.k.unique() - S.mean()))])
        best = []
        for r in (1, 0):
            q = B.q1s(D, root, k, r, e)
            if q is None:
                continue
            s = q['s'].astype(np.int64)
            j = np.searchsorted(s, grid, side='right') - 1
            mid = (q['bid'][j] + q['ask'][j]) / 2
            dS = np.diff(S[::10]); dm = np.diff(mid[::10])
            lags = range(-6, 61)
            cc = []
            for L in lags:
                if L >= 0:
                    x, y = dS[:len(dS) - L], dm[L:]
                else:
                    x, y = dS[-L:], dm[:len(dm) + L]
                cc.append(abs(np.corrcoef(x, y)[0, 1]) if len(x) > 10 and x.std() > 0 and y.std() > 0 else np.nan)
            i = int(np.nanargmax(cc))
            best.append((list(lags)[i] * 10, cc[i], cc[6]))
        for (lag, c, c0), r in zip(best, ('C', 'P')):
            rows.append({'root': root, 'window': lab, 'contract': f'{k:g}{r}', 'best lag s': lag, '|corr| at best': round(c, 2),
                         '|corr| at 0': round(c0, 2)})
df = pd.DataFrame(rows)
txt = f'# Vendor-lag check {D}\n\n{__doc__}\n\n' + md(df) + '\n'
open(os.path.join(HERE, 'results', f'LAG_{D}.md'), 'w').write(txt)
print(txt)
