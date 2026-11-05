"""H3b (PREREG, optional): the 8 H3 exit cells on EDGE's E3 entries (opening-range break 10:01-13:00, both sides,
contracts as EDGE selected them: edge/results/E3_DEV.json `sel`; roots SPXW/SPY/QQQ). Fill and exits as H3
(RULES.md fill sanity at t + 2 s, 10-second checks, flat 15:50). 1-second paths t -> 15:51 in v2data/edge-t/q1s.

  python3 h3b.py run [max_minutes]
"""
import json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim  # noqa: E402
import ht  # noqa: E402

SRC = os.path.join(sim.ROOT, 'results', 'E3_DEV.json')
DST = os.path.join(ht.OUT, 'h3b.json')


def run(max_minutes=1e9):
    src = json.load(open(SRC))
    have = json.load(open(DST)) if os.path.exists(DST) else {}
    keys = [k for k, v in src.items() if v and v['root'] in ht.ROOTS and v['day'] < '2025-01-01']
    rng = np.random.default_rng(20261105)
    keys = [keys[i] for i in rng.permutation(len(keys))]
    t0 = time.time()
    for i, key in enumerate(keys):
        if key in have:
            continue
        if time.time() - t0 > max_minutes * 60:
            print('time cut', flush=True)
            break
        rec = src[key]
        root, day = rec['root'], rec['day']
        t = int(rec['trig']['t'])
        bars = ht.day_bars(root, day)
        closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
        out = {'root': root, 'day': day, 't': t, 'spx': ht.spx_day(day), 'sides': {}}
        for side in ('real', 'opp'):
            s = rec['sides'].get(side)
            if not s or not s.get('sel'):
                out['sides'][side] = None
                continue
            sel = s['sel']
            p = ht.path(root, day, sel['k'], sel['call'], t)
            if p is None:
                out['sides'][side] = {'sel': sel, 'missing': True}
                continue
            ent, skip = ht.enter(p, t)
            if ent is None:
                out['sides'][side] = {'sel': sel, 'skip': skip}
                continue
            res = {ht.cell_name(*c): ht.manage(p, ent, sel['call'], profit=c[0], rev=c[1], quotes=c[2], closes=closes)
                   for c in ht.H3_CELLS}
            out['sides'][side] = {'sel': sel, 'res': res}
        have[key] = ht._clean(out)
        if i % 50 == 0:
            json.dump(have, open(DST, 'w'))
            print(f'{time.strftime("%H:%M:%S")} {len(have)}/{len(keys)} fetch {ht.STATS["fetch"]} disk {ht.disk_free_gb():.2f} GB', flush=True)
    json.dump(have, open(DST, 'w'))
    print('done', len(have), ht.STATS, flush=True)


if __name__ == '__main__':
    if sys.argv[1] == 'run':
        mm = [float(a) for a in sys.argv[2:] if a[0].isdigit()]
        run(mm[0] if mm else 1e9)
