"""
Nov 4 research: the frozen rules' holdout calls in detail (session-bootstrap interval of the win rate, by root, by
time of day, the share of calls on the session's worst day). Reads the same rows as `study.py rules`; chooses nothing.

  python3 -I research/nov4/holdout_detail.py
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import study as S

df = S.load(S.HOLD)
for name, rule in S.RULES.items():
    c = S.calls_of(df, rule)
    lo, hi = S.boot_mean(c.win.values.astype(float), c.day.values)
    per = c.groupby('day').agg(n=('win', 'size'), win=('win', 'mean'), ret=('ret', 'mean'))
    print(f'{name}: n={len(c)} win={c.win.mean():.0%} session-bootstrap [{lo:.0%},{hi:.0%}]; '
          f'sessions with win>=60%: {(per.win >= 0.6).sum()}/{len(per)}; median session ret {per.ret.median():+.1%}; '
          f'without its best session: win={c[c.day != per.ret.idxmax()].win.mean():.0%} ret={c[c.day != per.ret.idxmax()].ret.mean():+.1%}')
    if name.startswith('R4'):
        print('  by root:', c.groupby('root').win.agg(['size', 'mean']).query('size >= 3').round(2).to_dict('index'))
        print('  by right:', c.groupby('right').agg(n=('win', 'size'), win=('win', 'mean'), ret=('ret', 'mean')).round(3).to_dict('index'))
        print('  by entry clock:', c.groupby(c.m.map(S.clock)).agg(n=('win', 'size'), win=('win', 'mean')).round(2).to_dict('index'))
        print('  median |delta|', round(c.absdelta.median(), 3), 'median ask', c.ask.median(), 'median s_open', round(c.s_open.median(), 4))
