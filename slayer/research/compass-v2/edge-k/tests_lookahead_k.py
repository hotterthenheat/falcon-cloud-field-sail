"""EDGE-K look-ahead test with canaries.

  python3 tests_lookahead_k.py [n]   -> results/lookahead.txt

For n signals (both sets, seeded): every picker's contract and K's ER must be IDENTICAL when (1) today's minute returns
and closes after the last closed bar are replaced by noise, (2) every later board minute of the chain (root and A's
board) is replaced by noise, (3) every later session's bars are replaced by noise. Canaries that must be caught:
(a) the chooser reads the board stamped t (not t - 60), (b) L_today includes the forming bar.
"""
import copy, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ek  # noqa: E402
import model as M  # noqa: E402
import sim  # noqa: E402


def key(ch):
    return {n: (p['root'], p['k'], p['call'], round(p.get('er') or 0.0, 12), round(p.get('er0') or 0.0, 12))
            for n, p in ch['picks'].items() if not n.startswith('R')} | {'er_max': ch.get('er_max')}


def noisy_today(und, day, mc, rng):
    r, cl = M.returns(und)[day]
    r2, cl2 = r.copy(), cl.copy()
    r2[mc + 1:] = rng.normal(0, 0.01, len(r2) - mc - 1)
    cl2[mc + 1:] = cl[mc] * np.exp(np.cumsum(r2[mc + 1:]))
    return r2, cl2


def run(n=80):
    sigs = ek.all_signals()
    rng = np.random.default_rng(5)
    pick = [sigs[i] for i in rng.choice(len(sigs), n, replace=False)]
    same = {'today': 0, 'boards': 0, 'later_days': 0}
    caught = {'board_t': 0, 'forming_bar': 0}
    tot = 0
    lines = []
    for s in pick:
        base = ek.choose(s)
        if not base['picks']:
            continue
        tot += 1
        und = M.UND[s['root']]
        mc = M.closed_idx(s['t'])
        # (1) today's later bars
        t1 = ek.choose(s, today=noisy_today(und, s['day'], mc, rng))
        same['today'] += key(t1) == key(base)
        # (2) later board minutes -> noise (root chain, used by K and by A's select)
        ck = (s['root'], s['day'])
        orig = sim.chain(*ck)
        c2 = orig.copy()
        later = c2.m.values > (s['t'] - 60) // 60
        c2.loc[later, 'bid'] = rng.uniform(0.05, 50, later.sum()).astype('float32')
        c2.loc[later, 'ask'] = c2.loc[later, 'bid'] * 1.05
        sim._CH[ck] = c2
        t2 = ek.choose(s)
        sim._CH[ck] = orig
        same['boards'] += key(t2) == key(base)
        # (3) later sessions' bars -> noise
        R = M.returns(und)
        saved = {d: R[d] for d in R if d > s['day']}
        for d in saved:
            R[d] = (rng.normal(0, 0.01, 390), saved[d][1] * 0 + 1.0)
        t3 = ek.choose(s)
        R.update(saved)
        same['later_days'] += key(t3) == key(base)
        # canary (a): read the board stamped t
        ob = sim.board
        sim.board = lambda r, d, tt: ob(r, d, tt + 60)
        ca = ek.choose(s)
        sim.board = ob
        caught['board_t'] += key(ca) != key(base)
        # canary (b): L_today includes the forming bar
        oc = M.closed_idx
        M.closed_idx = lambda t: oc(t) + 1
        cb = ek.choose(s)
        M.closed_idx = oc
        caught['forming_bar'] += key(cb) != key(base)
    lines.append(f'signals tested: {tot} (S1 {sum(1 for s in pick if s["set"] == "S1")}, S2 {sum(1 for s in pick if s["set"] == "S2")} drawn)')
    for k, v in same.items():
        lines.append(f'identical with {k} replaced by noise: {v}/{tot}')
    for k, v in caught.items():
        lines.append(f'canary {k} caught: {v}/{tot}')
    txt = '\n'.join(lines)
    print(txt)
    open(os.path.join(HERE, 'results', 'lookahead.txt'), 'w').write(txt + '\n')


if __name__ == '__main__':
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 80)
