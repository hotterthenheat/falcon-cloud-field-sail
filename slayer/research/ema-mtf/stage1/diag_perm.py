"""Post-hoc diagnostic of the PREREG section-4.5 permutation null (labelled post-hoc; it changes no Stage-1 decision).

Hypothesis: permuting a feature's values across the decisions of one session (cell = session x root x bucket x right)
keeps each cell's daily prevalence. That prevalence partly reflects the price path AFTER a decision (a call's premium
spends more of the day above its EMAs on days it rallies), so the permuted feature carries same-day future information
and the null is not a no-information null.

Test 1 (time shift): replace each event's feature value by the value of the same cell's event k decisions LATER (future
information) or EARLIER (past information only), k = 6 (30 minutes) and 12 (60 minutes); compute delta Y30 as in S1A.
Test 2 (leak-free null, the design a future pre-registration should use): permute feature values across SESSIONS among
events with the same root x bucket x right x decision close (time of day kept, the day's path broken); 200 runs; FWER.

    python3 -m stage1.diag_perm [--runs 200]   -> v2data/ema/results/stage1/s1_diag_perm.pkl
"""
from __future__ import annotations

import argparse
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.run import OUT, S1A_TESTS, Design, eval_sessions, load_events, null_family  # noqa: E402


def shifted(ev, f, k):
    """Value of the same cell's event k decisions later (k > 0) or earlier (k < 0); NaN past the cell's ends."""
    key = ev.session.astype(str) + '|' + ev.root + '|' + ev.bucket + '|' + ev.right.astype(str)
    s = pd.Series(f, index=ev.index)
    order = ev.assign(_k=key).sort_values(['_k', 'm']).index
    g = key.loc[order]
    sh = s.loc[order].groupby(g.to_numpy()).shift(-k)
    return sh.reindex(ev.index).to_numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=200)
    a = ap.parse_args()
    ev = load_events()
    ses = eval_sessions(sorted(ev.block.unique()))
    ev = ev[ev.status_ok].reset_index(drop=True)
    D = Design(ev, ses)
    y = ev.Y30.to_numpy(float)
    J = D.J0 * 3
    out = {'shift': {}}
    for F, tf in S1A_TESTS:
        f = ev[f'f_{F}_{tf}'].to_numpy(float)
        row = {'real': D.d(y, f, D.strata[tf], J, boot=False)['delta']}
        for k in (6, 12, -6, -12):
            row[k] = D.d(y, shifted(ev, f, k), D.strata[tf], J, boot=False)['delta']
        out['shift'][(F, tf)] = row
        print(F, tf, {k: round(v * 100, 2) for k, v in row.items()}, flush=True)
    # leak-free permutation: across sessions, same root x bucket x right x decision close
    cell = pd.factorize(ev.block + '|' + ev.root + '|' + ev.bucket + '|' + ev.right.astype(str) + '|' + ev.m.astype(str))[0]
    rng = np.random.default_rng(20261107)
    runs = []
    for run in range(a.runs):
        fv = {}
        for F, tf in S1A_TESTS:
            f = ev[f'f_{F}_{tf}'].to_numpy(float)
            ok = np.flatnonzero(np.isfinite(f))
            c = cell[ok]
            o1 = ok[np.argsort(c, kind='stable')]
            o2 = ok[np.lexsort((rng.random(len(ok)), c))]
            g = f.copy()
            g[o1] = f[o2]
            fv[(F, tf)] = g
        r = null_family(D, ev, fv)
        runs.append({k: r[k] for k in ('any_holm', 'any_pass', 'n_holm', 'min_holm')} | {'deltas': r['deltas']})
        if run % 20 == 19:
            print('leak-free perm', run + 1, 'FWER', np.mean([x['any_holm'] for x in runs]), flush=True)
            out['leakfree'] = runs
            pickle.dump(out, open(os.path.join(OUT, 's1_diag_perm.pkl'), 'wb'))
    out['leakfree'] = runs
    pickle.dump(out, open(os.path.join(OUT, 's1_diag_perm.pkl'), 'wb'))


if __name__ == '__main__':
    main()
