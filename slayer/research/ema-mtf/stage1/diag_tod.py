"""POST-HOC diagnostic S1A-T (not a pre-registered test; it can change no Stage-1 decision; logged as 40 looks).

Why: the pre-registered S1A pipeline failed its null calibration (stage1/diag_perm.py). (a) The PREREG's within-
session permutation carries same-day future information (time-shift test). (b) Even a leak-free permutation (across
sessions, same root x bucket x right x decision close) passes features. Their prevalence varies with the time of day,
and Y30 varies with the time of day (theta, the 15:55 cut), while the S1A strata do not hold the time of day fixed.

S1A-T = the same statistic, rules, bootstrap and Holm, with the strata also split by the half-hour of the decision
close. Its calibration = the leak-free permutation null (200 runs, seed 20261108): FWER must be <= 5%.

    python3 -m stage1.diag_tod [--runs 200]   -> v2data/ema/results/stage1/s1_diag_tod.pkl
"""
from __future__ import annotations

import argparse
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.run import OUT, S1A_TESTS, Design, eval_sessions, load_events, null_family, s1a_one, s1a_pass  # noqa: E402
from stage1.events import TFS  # noqa: E402

NH = 13


class DesignTOD(Design):
    def __init__(self, ev, ses):
        super().__init__(ev, ses)
        hh = ((ev.m.to_numpy() + 1) // 30).astype(np.int64)
        self.J0 = self.J0 * NH
        for tf in TFS:
            u = ev[f'ust_{tf}'].to_numpy()
            s = ((self.rbr * NH + hh) * 3 + np.where(np.isfinite(u), u + 1, 0)).astype(np.int64)
            self.strata[tf] = np.where(np.isfinite(u), s, -1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=200)
    a = ap.parse_args()
    ev = load_events()
    ses = eval_sessions(sorted(ev.block.unique()))
    ev = ev[ev.status_ok].reset_index(drop=True)
    D = DesignTOD(ev, ses)
    rows = s1a_pass([s1a_one(D, ev, F, tf, controls=False) for F, tf in S1A_TESTS])
    out = {'s1a_t': rows, 'null': []}
    print('S1A-T passes:', [(r['feature'], r['tf']) for r in rows if r['pass']], flush=True)
    pickle.dump(out, open(os.path.join(OUT, 's1_diag_tod.pkl'), 'wb'))
    cell = pd.factorize(ev.block + '|' + ev.root + '|' + ev.bucket + '|' + ev.right.astype(str) + '|' + ev.m.astype(str))[0]
    rng = np.random.default_rng(20261108)
    for run in range(a.runs):
        fv = {}
        for F, tf in S1A_TESTS:
            f = ev[f'f_{F}_{tf}'].to_numpy(float)
            ok = np.flatnonzero(np.isfinite(f))
            c = cell[ok]
            g = f.copy()
            g[ok[np.argsort(c, kind='stable')]] = f[ok[np.lexsort((rng.random(len(ok)), c))]]
            fv[(F, tf)] = g
        r = null_family(D, ev, fv)
        out['null'].append({k: r[k] for k in ('any_holm', 'any_pass', 'n_holm', 'min_holm')} | {'deltas': r['deltas']})
        if run % 10 == 9:
            pickle.dump(out, open(os.path.join(OUT, 's1_diag_tod.pkl'), 'wb'))
            print('S1A-T leak-free null', run + 1, 'FWER', np.mean([x['any_holm'] for x in out['null']]), flush=True)
    pickle.dump(out, open(os.path.join(OUT, 's1_diag_tod.pkl'), 'wb'))


if __name__ == '__main__':
    main()
