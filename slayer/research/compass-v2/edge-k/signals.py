"""EDGE-K signal sets (specs/PREREG.md). Triggers only: no option outcome is read here.

S1 = EDGE-T H1-k0.30 (opening drive), rebuilt with EDGE-T's own code (ht.trig_h1, amendment A1), on every DEV session.
S2 = EDGE E1-z0.5 (momentum into the close), the triggers EDGE stored in v2data/edge/results/E1_DEV.json, minus any
     whose 20-day sigma_d window touched a LOCKED session (EDGE's daily_closes read 2022-09 / 2024-08 bar files).
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, os.path.join(HERE, '..', 'edge-t'))
import sim  # noqa: E402
import fetch as F  # noqa: E402
import ht  # noqa: E402

OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-k'
E1_JSON = '/home/user/falcon-cloud-field-sail/v2data/edge/results/E1_DEV.json'


def dev_days():
    return sorted(d for d in F.want_days('DEV') if d < '2025-01-01' and not F.is_locked(d))


def s1_signals():
    f = os.path.join(OUT, 'signals_S1.json')
    if os.path.exists(f):
        return json.load(open(f))
    out = []
    for day in dev_days():
        spx = ht.spx_day(day)
        if not spx:
            continue
        for root in ('SPXW', 'SPY', 'QQQ'):
            if day not in F.expirations(root) or sim.chain(root, day) is None or not len(sim.chain(root, day)):
                continue
            bars = ht.day_bars(root, day)
            if len(bars) < 300:
                continue
            sig = ht.sigma_prev(root, day)
            trig = ht.trig_h1(bars, sig)
            if 0.30 not in trig:
                continue
            t, up, S = trig[0.30]
            if t == ht.H1_T[0]:  # EDGE-T amendment A1
                t = ht.H1_T[1]
                S = sim.spot_at(bars, t)
            out.append({'set': 'S1', 'root': root, 'day': day, 't': int(t), 'up': bool(up), 'S': float(S)})
    json.dump(out, open(f, 'w'))
    return out


def s2_signals():
    f = os.path.join(OUT, 'signals_S2.json')
    if os.path.exists(f):
        return json.load(open(f))
    cal = F.sessions()
    d = json.load(open(E1_JSON))
    out, dropped = [], 0
    for key, rec in sorted(d.items()):
        if not rec or not rec.get('trig'):
            continue
        tr = rec['trig']
        if tr['z'] < 0.5:
            continue
        day = rec['day']
        i = cal.index(day)
        if any(F.is_locked(x) for x in cal[max(0, i - 21):i]):
            dropped += 1
            continue
        out.append({'set': 'S2', 'root': rec['root'], 'day': day, 't': int(tr['t']), 'up': bool(tr['up']), 'S': float(tr['S']),
                    't_end': int(tr['t_end'])})
    json.dump(out, open(f, 'w'))
    print('S2 dropped (locked sigma_d window):', dropped)
    return out


if __name__ == '__main__':
    import collections
    for name, fn in (('S1', s1_signals), ('S2', s2_signals)):
        s = fn()
        print(name, len(s), 'signals,', len(set(x['day'] for x in s)), 'sessions', collections.Counter(x['root'] for x in s))
