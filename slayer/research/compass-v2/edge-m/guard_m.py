"""Amendment A1: M7 (= M6 + quote guard) and M8 (= M3 + quote guard) on the cached 1-second paths (no new fetch).

Quote guard: the simulator sees only 1-second quotes with bid > 0, ask > 0 and spread <= 10% of mid, so it neither
buys a blown-out ask nor stops / sells on a blown-out bid; it waits for the next sane quote (causal: a quote's spread
is known when it prints).

  python3 guard_m.py [in.json] [out.json]
"""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, HERE)
import sim
import hyp
import mdte

GUARD = 0.10
BASE = {'M7': ('E2', '23', 'M6'), 'M8': ('E1', '23', 'M3')}


def guarded(q):
    mid = (q['bid'] + q['ask']) / 2
    ok = (q['bid'] > 0) & (q['ask'] > 0) & ((q['ask'] - q['bid']) <= GUARD * np.maximum(mid, 1e-9))
    return {x: q[x][ok] for x in q}


def augment(have):
    mdte.NOFETCH = True
    for rec in have.values():
        if not rec:
            continue
        for v, (H, b, _) in BASE.items():
            if rec['H'] != H or b not in rec['b']:
                continue
            tr = rec['trig']
            bars = sim.day_bars(rec['root'], rec['day']) if H == 'E2' else None
            for side in ('real', 'opp'):
                s = rec['b'][b].get(side)
                if not s or not s.get('sel') or s.get('missing'):
                    continue
                sel = s['sel']
                q = mdte.q1s_m(rec['root'], rec['day'], s['exp'], sel['k'], sel['call'], int(tr['t']), int(tr['t_end']) + 30)
                if q is None:
                    continue
                _, rules = mdte.rules_for(H, sel, rec['s1m'])
                ur = hyp.under_rule_e2(bars, tr, True) if H == 'E2' else None
                r = sim.run_trade(guarded(q), tr['t'], tr['t_end'], rules, bars, ur)
                if r is None:
                    continue
                u0, u1 = mdte.under_at(rec['root'], rec['day'], r['fill_s']), mdte.under_at(rec['root'], rec['day'], r['exit_s'])
                r['ur'] = (math.log(u1 / u0) * (1 if sel['call'] else -1)) if np.isfinite(u0) and np.isfinite(u1) else np.nan
                s.setdefault('res', {})[v] = r
    return have


if __name__ == '__main__':
    fi = sys.argv[1] if len(sys.argv) > 1 else os.path.join(mdte.MROOT, 'results_DEV.json')
    fo = sys.argv[2] if len(sys.argv) > 2 else os.path.join(mdte.MROOT, 'results_DEV_g.json')
    have = augment(json.load(open(fi)))
    json.dump(mdte.jsonable(have), open(fo, 'w'))
    print('wrote', fo)
