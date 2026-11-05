"""E1's two pre-registered GEX < 0 variants (the two best E1 variants on DEV by net expectancy: z0.5-X2, z1.0-X2),
restricted to sessions whose prior-close dealer GEX (hyp.gex at the 09:59 spot, 0DTE ATM IV at 10:00) is negative.

  python3 e1_gex.py DEV
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import hyp

which = sys.argv[1]
have = json.load(open(os.path.join(sim.ROOT, 'results', f'E1_{which}.json')))
g = {}
for key, rec in have.items():
    if not rec:
        continue
    b = sim.day_bars(rec['root'], rec['day'])
    x = b[b.m == 599]
    if not len(x):
        continue
    S = float(x.c.iloc[0])
    g[key] = hyp.gex(rec['root'], rec['day'], S, hyp.atm_iv(rec['root'], rec['day'], 600 * 60, S))
print(sim.HEAD)
for v in ('z0.5-X2', 'z1.0-X2'):
    for lab, cond in (('GEX<0', lambda z: z < 0), ('GEX>=0 (complement)', lambda z: z >= 0)):
        sub = {k: r for k, r in have.items() if r and k in g and np.isfinite(g[k]) and cond(g[k])}
        print(sim.fmt(sim.summary(hyp.trades(sub, v), f'{v} {lab}')))
    sub = {k: r for k, r in have.items() if r and k in g and np.isfinite(g[k]) and g[k] < 0}
    z = hyp.shuffle_null(sub, v)
    if z:
        print(f"  shuffled null {v} GEX<0: pairs {z['n_pairs']}, real {100 * z['real']:+.1f}%, null mean {100 * z['null_mean']:+.1f}%, beats {100 * z['beats']:.0f}%, FDR {100 * z['fdr']:.1f}%")
print('GEX<0 share of E1 trigger sessions:', np.mean([v < 0 for v in g.values() if np.isfinite(v)]))
