"""EDGE-T look-ahead test with canaries (cache only, no terminal reads).

1. Triggers: H1 and H2 recomputed with every bar that had not closed by the decision replaced by noise -> identical.
2. Contract selection: chain rows stamped after (t - 60)//60 replaced by noise -> identical selection.
3. Exits: every 1-second quote after the exit fill second, and every underlying bar after the exit decision,
   replaced by noise -> identical exit (all 9 exit rules: RT + 8 H3 cells).
Canaries (must be CAUGHT, i.e. differ): (a) an H1 trigger that reads the bar still forming at t; (b) a selection
from the board stamped t; (c) an exit that peeks 60 s ahead.

  python3 tests_lookahead_t.py [n_sessions] > results/lookahead.txt
"""
import json, os, sys
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim  # noqa: E402
import ht  # noqa: E402

ht.NOFETCH = True
RNG = np.random.default_rng(3)


def noisy_bars(bars, first_bad_m):
    b = bars.copy()
    bad = b.m >= first_bad_m
    for col in ('o', 'h', 'l', 'c'):
        b.loc[bad, col] = b.loc[bad, col] * np.exp(RNG.normal(0, 0.02, bad.sum()))
    b.loc[bad, 'h'] = b.loc[bad, ['o', 'h', 'l', 'c']].max(1)
    b.loc[bad, 'l'] = b.loc[bad, ['o', 'h', 'l', 'c']].min(1)
    return b


def trig_h1_canary(bars, sig):
    """Canary: reads the close of the bar that STARTS at t (still forming)."""
    O = float(bars.o.iloc[0])
    out = {}
    for t in ht.H1_T:
        x = bars[bars.m <= t // 60]
        r = float(x.c.iloc[-1]) / O - 1
        for k in ht.H1_K:
            if k not in out and abs(r) >= k * sig:
                out[k] = (t, bool(r > 0), float(x.c.iloc[-1]))
    return out


def main(n=150):
    have = {k: v for k, v in json.load(open(os.path.join(ht.OUT, 'dev.json'))).items() if v}
    keys = sorted(have)[:: max(1, len(have) // n)][:n]
    res = {'h1_trig': [0, 0], 'h1_canary_diff': [0, 0], 'h2_trig': [0, 0], 'sel': [0, 0], 'sel_canary_diff': [0, 0],
           'exit': [0, 0], 'exit_canary_diff': [0, 0]}
    for key in keys:
        rec = have[key]
        root, day = rec['root'], rec['day']
        bars = ht.day_bars(root, day)
        sig = rec['sig']
        full = ht.trig_h1(bars, sig)
        # 1. H1 trigger: bars starting at/after 09:35 (not closed at the last decision 09:35:00) -> noise
        part = ht.trig_h1(noisy_bars(bars, 575), sig)
        res['h1_trig'][0] += 1
        res['h1_trig'][1] += (part == full)
        can = trig_h1_canary(noisy_bars(bars, 576), sig) if np.isfinite(sig or np.nan) else {}
        if full:
            res['h1_canary_diff'][0] += 1
            res['h1_canary_diff'][1] += (can != full)
        # H2: at each recorded mark, bars not closed by t -> noise; the decision at t must be the same
        spx = ht.day_bars('SPXW', day)
        marks = ht.trig_h2(spx)
        for (t, up, s) in marks[:5]:
            m2 = ht.trig_h2(noisy_bars(spx, t // 60))
            res['h2_trig'][0] += 1
            res['h2_trig'][1] += any(x[0] == t and x[1] == up for x in m2)
        # 2. selection
        for v, x in rec['h1'].items():
            t, up, S = x['t'], x['up'], x['S']
            if not x['real'].get('sel'):
                continue
            orig = sim.chain(root, day)
            ch = orig.copy()
            bad = (ch.m > (t - 60) // 60).values
            nb = ch.bid.values.copy()
            nb[bad] = nb[bad] * RNG.uniform(0.3, 3, bad.sum()).astype(np.float32)
            na = ch.ask.values.copy()
            na[bad] = nb[bad] * np.float32(1.05) + np.float32(0.01)
            ch['bid'], ch['ask'] = nb, na
            sim._CH[(root, day)] = ch
            sel = ht.select(root, day, t, up, float(v.split('-d')[1]), S)
            res['sel'][0] += 1
            res['sel'][1] += (sel is not None and sel['k'] == x['real']['sel']['k'])
            # canary: board stamped t (read the noisy minute t//60 through a shifted t)
            sel_c = ht.select(root, day, t + 60, up, float(v.split('-d')[1]), S)
            res['sel_canary_diff'][0] += 1
            res['sel_canary_diff'][1] += (sel_c is None or sel_c['k'] != x['real']['sel']['k'] or abs(sel_c['bid0'] - x['real']['sel']['bid0']) > 1e-6)
            sim._CH[(root, day)] = orig
        # 3. exits on the H1-k0.30-d0.35 real side (9 rules)
        x = rec['h1'].get('k0.30-d0.35')
        if not x or not x['real'].get('res'):
            continue
        sel = x['real']['sel']
        p = ht.path(root, day, sel['k'], sel['call'], ht.H1_START)
        if p is None:
            continue
        ent, _ = ht.enter(p, x['t'])
        closes = dict(zip(bars.m.values.tolist(), bars.c.values.tolist()))
        for name in ['RT'] + [ht.cell_name(*c) for c in ht.H3_CELLS]:
            r0 = x['real']['res'][name]
            if name == 'RT':
                kw = {}
            else:
                pr, rv, qu = name.split('-')[1:]
                kw = {'profit': pr, 'rev': rv == 'rev', 'quotes': qu}
            q = {k2: (v2.copy() if isinstance(v2, np.ndarray) else v2) for k2, v2 in p.items()}
            cut = r0['exit_s'] - q['s0'] + 1
            for f in ('bid', 'ask'):
                q[f][cut:] = q[f][cut:] * RNG.uniform(0.2, 5, len(q[f]) - cut)
            cl = {m: (c if m * 60 + 60 <= r0['exit_s'] - 2 else c * np.exp(RNG.normal(0, 0.02))) for m, c in closes.items()}
            r1 = ht.manage(q, ent, sel['call'], closes=cl, **kw)
            res['exit'][0] += 1
            res['exit'][1] += (r1['exit_s'] == r0['exit_s'] and abs(r1['exit'] - r0['exit']) < 1e-9 and r1['why'] == r0['why'])
            # canary: decide on the bid 60 s ahead
            qc = {k2: (v2.copy() if isinstance(v2, np.ndarray) else v2) for k2, v2 in p.items()}
            qc['bid'] = np.concatenate([qc['bid'][60:], np.repeat(qc['bid'][-1], 60)])
            qc['ask'] = np.concatenate([qc['ask'][60:], np.repeat(qc['ask'][-1], 60)])
            rc = ht.manage(qc, ent, sel['call'], closes=closes, **kw)
            res['exit_canary_diff'][0] += 1
            res['exit_canary_diff'][1] += (rc['exit_s'] != r0['exit_s'] or abs(rc['exit'] - r0['exit']) > 1e-9)
    print(f'EDGE-T look-ahead test on {len(keys)} root-sessions (cache only)')
    for k, (a, b) in res.items():
        tag = 'canary CAUGHT (differs)' if 'canary' in k else 'identical'
        print(f'{k:18s} {b}/{a} {tag}')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 150)
