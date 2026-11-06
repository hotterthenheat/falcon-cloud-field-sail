"""Report one day's rule results (brunner.py day): every trade, real side and the opposite side, and per variant.
python3 bday_report.py 20261105 "in-sample (rules derived from this day)" -> results/RULES_<D>.md"""
import json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bload as B  # noqa: E402
from mdt import md  # noqa: E402

D = sys.argv[1]
label = sys.argv[2] if len(sys.argv) > 2 else ''
rows = json.load(open(os.path.join(B.OUT, 'res', 'days', f'{D}.json')))
df = pd.DataFrame(rows)
L = [f'# NOV5-BROAD rules on {D} ({label})\n', 'Execution: ask in / bid out on the 1-second NBBO +2 s, $0.65 per contract per side '
     '(every leg of a package). L = long single option (delta 0.30; R3 = ATM straddle); S = debit spread (R3 = both '
     'sides). "opposite" = the same trigger with the other side (side-shuffle reference). Stale 1-second seconds are never '
     'filled.\n']
if not len(df):
    L.append('No trigger of any registered rule.\n')
else:
    df['clock'] = [B.clock(t)[:5] for t in df.t]
    for c in ('entry_s', 'exit_s'):
        df[c] = [B.clock(v) if pd.notna(v) else '' for v in df.get(c, [np.nan] * len(df))]
    real = df[df.sideset == 'real']
    cols = ['root', 'variant', 'clock', 'side', 'k', 'k2', 'delta', 'fill', 'exit', 'reason', 'entry_s', 'exit_s', 'ret_net',
            'pnl_net', 'skip']
    x = real[[c for c in cols if c in real.columns]].copy()
    x['ret_net'] = [f'{100 * v:+.1f}%' if pd.notna(v) else '' for v in x.ret_net]
    x['pnl_net'] = [f'{v:,.0f}' if pd.notna(v) else '' for v in x.pnl_net]
    if 'headline' in real:
        pass
    L.append('## Every trade (real side)\n')
    L.append(md(x.fillna('')))
    g = []
    for v, z in df[df.ret_net.notna()].groupby('variant'):
        r = z[z.sideset == 'real'].ret_net
        f = z[z.sideset == 'flip'].ret_net
        g.append({'variant': v, 'n': len(r), 'win': f'{100 * (r > 0).mean():.0f}%' if len(r) else '',
                  'mean net': f'{100 * r.mean():+.1f}%' if len(r) else '', 'sum $': f'{z[z.sideset == "real"].pnl_net.sum():,.0f}',
                  'opposite n': len(f), 'opposite mean': f'{100 * f.mean():+.1f}%' if len(f) else ''})
    L.append('\n## Per variant\n')
    L.append(md(pd.DataFrame(g)))
    if 'headline' in df:
        h = df[df.rule == 'R5'].drop_duplicates('t')[['clock', 'headline']]
        if len(h):
            L.append('\n## R5 headlines matched (publication +10 min = decision)\n')
            L.append(md(h))
txt = '\n'.join(L) + '\n'
open(os.path.join(HERE, 'results', f'RULES_{D}.md'), 'w').write(txt)
print(txt[:12000])
