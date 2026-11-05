"""Tables for one hypothesis on one set: every variant, shuffled-signal null, PBO (CSCV over the variants), DSR at
the global trial count, splits by year and by right, exit reasons.

  python3 analyze.py E1 DEV [--trials N]
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import hyp

PRIOR_TRIALS = 155 + 112 + 9  # challenger, nov4, dont-chase (their logs)


def main():
    H, which = sys.argv[1], sys.argv[2]
    trials = int(sys.argv[sys.argv.index('--trials') + 1]) if '--trials' in sys.argv else PRIOR_TRIALS + 16
    have = json.load(open(os.path.join(sim.ROOT, 'results', f'{H}_{which}.json')))
    text, rows = hyp.report(H, which, have)
    print(text)
    names = hyp.variant_names(H)
    days = sorted(set(r['day'] for r in have.values() if r))
    M = np.full((len(days), len(names)), np.nan)
    di = {d: i for i, d in enumerate(days)}
    for j, v in enumerate(names):
        by = {}
        for t in rows[v][1]:
            by.setdefault(t['day'], []).append(t['ret_fee'])
        for d, x in by.items():
            M[di[d], j] = np.mean(x)
    hyp_names = [v for v in names if 'contrast' not in v]
    Mh = M[:, [names.index(v) for v in hyp_names]]
    print(f'\nPBO (CSCV, 16 blocks, {len(hyp_names)} variants): {sim.pbo(Mh):.2f}')
    shs = [rows[v][0].get('sharpe', np.nan) for v in hyp_names]
    var = float(np.nanvar(shs)) if np.isfinite(shs).sum() > 1 else 0.01
    var = max(var, 0.002)
    print(f'DSR at N = {trials} trials (Sharpe variance {var:.4f} across this hypothesis\'s variants):')
    for v in hyp_names:
        s = rows[v][0]
        if s.get('n', 0) > 3:
            print(f"  {v}: n {s['n']}, Sharpe/trade {s['sharpe']:.3f}, DSR {sim.dsr(s['sharpe'], s['n'], trials, var, s['skew'], s['kurt']):.3f}")
    for v in names:
        tr = rows[v][1]
        if not tr:
            continue
        print(f'\n### {v}: by year / right / exit')
        print(sim.HEAD)
        for y in sorted(set(t['day'][:4] for t in tr)):
            print(sim.fmt(sim.summary([t for t in tr if t['day'][:4] == y], f'{v} {y}')))
        for c, lab in ((True, 'calls'), (False, 'puts')):
            print(sim.fmt(sim.summary([t for t in tr if t['call'] == c], f'{v} {lab}')))
        for r in sorted(set(t['root'] for t in tr)):
            print(sim.fmt(sim.summary([t for t in tr if t['root'] == r], f'{v} {r}')))
        why = {}
        for t in tr:
            why.setdefault(t['why'], []).append(t['ret_fee'])
        print('  exits: ' + ', '.join(f"{k} {len(x)} ({100 * np.mean(x):+.1f}%)" for k, x in why.items()))
        miss = sum(1 for r in have.values() if r and r['sides'].get('real') and r['sides']['real'].get('missing'))
        nosel = sum(1 for r in have.values() if r and r['sides'].get('real') is None)
        print(f'  triggers with no gated contract: {nosel}; 1-second window missing: {miss}')


if __name__ == '__main__':
    main()
