"""Leakage test for the family-D features (families/d_vol.py), offline (no ThetaData requests).

  cd slayer/research/edge0dte && python3 -m families.test_d_leakage

1. The library's own leakage run (lib.tests.test_leakage.leakage) with the D features registered: 5 DISCOVERY
   sessions per root x 8 random grid times; every primitive and every registered feature must equal its value on a
   copy of the session with all data stamped after t deleted; the leaky canary must be caught.
2. A targeted run for the D features only at times where they are defined (t >= 10:35): 10 more DISCOVERY sessions per
   root (seed 4242) x 8 times each; full vs truncated must be identical, and the count of finite (non-NaN) values is
   reported so the test is not passing on NaN == NaN.
3. A "future-bar" canary per feature: appending a large jump to a bar AFTER t must not change the value at t, while
   changing a bar at or before t must change d_semivar60 / d_rv30_rel (the feature really reads the window).
4. HOLDOUT guard (lib.tests.test_leakage.holdout_guard).
"""
import sys

import numpy as np

from families import d_vol
from lib import cal, panel
from lib.config import ROOTS, split
from lib.tests import test_leakage as T


def targeted(seed=4242, n_days=10, n_times=8):
    rng = np.random.default_rng(seed)
    finite = {f: 0 for f in d_vol.D_FEATURES}
    total = 0
    from lib.data import bars, chain
    for root in ROOTS:
        days = [d for d in cal.expiry_sessions(root) if split(d) == 'DISCOVERY']
        days = [d for d in days if chain(root, d) is not None and len(bars(root, d))]
        for i in rng.choice(len(days), n_days, replace=False):
            day = days[i]
            full = panel.session(root, day)
            g = [t for t in panel.grid(day) if t >= 10 * 3600 + 35 * 60]
            for t in sorted(rng.choice(g, min(n_times, len(g)), replace=False)):
                t = int(t)
                tr = full.truncated(t)
                for f in d_vol.D_FEATURES:
                    fn = panel.FEATURES[f][0]
                    a, b = fn(full, t), fn(tr, t)
                    T.check(f'D targeted leak {f}', T.same(a, b), f'{root} {day} t={t}: full={a} trunc={b}')
                    finite[f] += int(np.isfinite(a))
                total += 1
                # future-bar perturbation: shift every close after t by +5%: value at t must not move
                fut = full.truncated(full.close * 60)
                bm = dict(fut._bm)
                for m in list(bm):
                    if m + 1 > t // 60:
                        bm[m] = bm[m] * 1.05
                fut._bm = bm
                for f in d_vol.D_FEATURES:
                    fn = panel.FEATURES[f][0]
                    T.check(f'D future-bar invariance {f}', T.same(fn(full, t), fn(fut, t)), f'{root} {day} t={t}')
                # past-bar perturbation (the bar closing 10 min before t, +1%) must change the RV-based features
                past = full.truncated(full.close * 60)
                bm = dict(past._bm)
                m0 = t // 60 - 11
                if m0 in bm:
                    bm[m0] = bm[m0] * 1.01
                    past._bm = bm
                    for f in ('d_semivar60', 'd_rv30_rel'):
                        fn = panel.FEATURES[f][0]
                        a, b = fn(full, t), fn(past, t)
                        if np.isfinite(a):
                            T.check(f'D past-bar sensitivity {f}', not T.same(a, b), f'{root} {day} t={t}: unchanged {a}')
    return finite, total


def main():
    days = T.test_days()
    print('library leakage days:', days, flush=True)
    T.leakage(days)
    T.check('canary leak detected', len(T.CANARY) > 0 and all(T.CANARY), f'{sum(T.CANARY)}/{len(T.CANARY)}')
    finite, total = targeted()
    T.holdout_guard()
    for k, v in sorted(T.COUNTS.items()):
        nf = sum(1 for f in T.FAILS if f.startswith(k + ':'))
        print(f'{"PASS" if nf == 0 else "FAIL"}  {k}: {v - nf}/{v}')
    for f in T.FAILS[:30]:
        print('  ', f)
    print('targeted D times:', total, 'finite values per feature:', finite)
    print('TOTAL', 'FAIL' if T.FAILS else 'PASS', sum(T.COUNTS.values()), 'checks,', len(T.FAILS), 'failures')
    sys.exit(1 if T.FAILS else 0)


if __name__ == '__main__':
    main()
