"""Look-ahead tests for EDGE-M (reuses edge/tests_lookahead.py).

1. Triggers: every recorded E1/E2 trigger is recomputed with later bars and chain quotes hidden (EDGE's with_horizon,
   _len_guard_free) -> must be identical.
2. Selection: the 1-3 DTE / 0DTE contract is re-selected from boards truncated to stamps <= t - 60 -> identical.
3. Exits: each trade is re-simulated on its 1-second path truncated at the exit fill second -> identical result
   (the simulator read nothing after the fill it reports).
4. Canaries: a selection reading the board stamped at t (not yet visible) and an exit rule peeking 60 s ahead must
   both be caught by the same tests.

  python3 tests_lookahead_m.py
"""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, HERE)
import sim
import hyp
import tests_lookahead as TL
import mdte
import analyze_m as A


def trig_test(have, limit=300):
    n = 0
    for rec in have.values():
        if not rec or n >= limit:
            continue
        g = TL._len_guard_free(hyp.TRIG[rec['H']])
        TL.restore()
        full = g(rec['root'], rec['day'])
        TL.with_horizon(int(full['t']))
        vis = g(rec['root'], rec['day'])
        TL.restore()
        if vis is None or not TL.same(full, vis):
            raise TL.LookAheadError(f"{rec['H']} {rec['root']} {rec['day']}: trigger differs when later data is hidden")
        n += 1
    return n


def select_from(rec, b, minute_fn):
    tr = rec['trig']
    ex = mdte.expiry_for(rec['root'], rec['day'], b)
    exp, n = ex
    t = int(tr['t'])
    if exp == rec['day']:
        c = TL._chain(rec['root'], rec['day'])
        bd = c[c.m == minute_fn(t)]
        bd = bd if len(bd) else None
    else:
        bd = mdte.board_m(rec['root'], rec['day'], exp, minute_fn(t))
    return mdte.select_m(bd, tr['S'], mdte.T_of(t, n), tr['up'], mdte.TGT[rec['H']])


def sel_test(have, limit=300, canary=False):
    n = diff = 0
    for rec in have.values():
        if not rec or n >= limit:
            continue
        for b, sides in rec['b'].items():
            s = sides.get('real') or {}
            if not s.get('sel'):
                continue
            if canary and b != '0':
                continue
            fn = (lambda t: t // 60) if canary else (lambda t: (t - 60) // 60)
            new = select_from(rec, b, fn)
            same = new is not None and abs(new['k'] - s['sel']['k']) < 1e-9 and abs(new['ask0'] - s['sel']['ask0']) < 1e-9
            diff += not same
            n += 1
    return n, diff


def exit_test(have, limit=300, canary=False):
    n = diff = 0
    for rec in have.values():
        if not rec or n >= limit or rec['H'] != 'E1':
            continue
        s = rec['b'].get('1', {}).get('real') or {}
        if not s.get('res') or 'M2' not in s['res']:
            continue
        tr, sel = rec['trig'], s['sel']
        q = mdte.q1s_m(rec['root'], rec['day'], s['exp'], sel['k'], sel['call'], int(tr['t']), int(tr['t_end']) + 30)
        _, rules = mdte.rules_for('E1', sel, rec['s1m'])
        r0 = s['res']['M2']
        cut = {x: q[x][q['s'] <= r0['exit_s']] for x in q}
        if canary:  # a rule that sells when the bid 60 s ahead is lower: it needs quotes after the decision
            def run(p):
                ss, bb = p['s'], p['bid']
                for j in range(len(ss)):
                    k = np.flatnonzero(ss >= ss[j] + 60)
                    if len(k) and bb[k[0]] < bb[j] and ss[j] > tr['t'] + 5:
                        return int(ss[j])
                return -1
            e = run(q)  # the same truncation test: cut the path at the canary's own exit fill (decision + 2 s)
            cc = {x: q[x][q['s'] <= e + sim.LAT] for x in q}
            diff += e != run(cc)
        else:
            r1 = sim.run_trade(cut, tr['t'], tr['t_end'], rules, None, None)
            diff += r1 is None or abs(r1['ret'] - r0['ret']) > 1e-12 or r1['exit_s'] != r0['exit_s']
        n += 1
    return n, diff


if __name__ == '__main__':
    mdte.NOFETCH = True
    have = A.load(sys.argv[1] if len(sys.argv) > 1 else None)
    print('triggers: no look-ahead on', trig_test(have), 'recorded triggers')
    n, d = sel_test(have)
    assert d == 0, f'selection differs on {d}/{n}'
    print(f'selection: identical on {n}/{n} with boards truncated to t - 60')
    n, d = exit_test(have)
    assert d == 0, f'exit differs on {d}/{n}'
    print(f'exits: identical on {n}/{n} paths truncated at the exit fill')
    n, d = sel_test(have, 200, canary=True)
    print(f'canary selection (board stamped at t): differs on {d}/{n} -> {"caught" if d else "NOT CAUGHT"}')
    n, d = exit_test(have, 100, canary=True)
    print(f'canary exit (peeks 60 s ahead): differs on {d}/{n} -> {"caught" if d else "NOT CAUGHT"}')
