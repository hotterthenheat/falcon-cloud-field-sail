"""Check: the chunked 1-second fetch gives the same trades as one full window (E1 DEV records, cached data only)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hyp
import sim

h = json.load(open(os.path.join(sim.ROOT, 'results', 'E1_DEV.json')))
orig = sim.q1s
cache = {}


def fake(root, d, k, call, a, b):
    key = (root, d, k, call)
    if key not in cache:
        cache[key] = orig(root, d, k, call, 55500, 57540)  # the cached full window: no network
    q = cache[key]
    m = (q['s'] >= a) & (q['s'] <= b)
    return {x: q[x][m] for x in q}


sim.q1s = fake
bad = n = 0
for key, rec in list(h.items())[:500]:
    if not rec or not rec['sides'].get('real') or not rec['sides']['real'].get('res'):
        continue
    tr = hyp.trig_e1(rec['root'], rec['day'])
    sel = rec['sides']['real']['sel']
    bars = sim.day_bars(rec['root'], rec['day'])
    vs = {a: x for a, x in hyp.variants('E1', tr, sel, bars).items() if x[2]}
    res, _ = hyp.chunked(rec['root'], rec['day'], sel, sel['call'], tr, bars, vs)
    for v, o in rec['sides']['real']['res'].items():
        n += 1
        if v not in res or abs(res[v]['ret'] - o['ret']) > 1e-9:
            bad += 1
print('checked', n, 'mismatch', bad)
