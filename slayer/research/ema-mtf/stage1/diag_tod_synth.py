"""POST-HOC: the S1A-T design (strata also split by block and half-hour; stage1/diag_tod.py) on the synthetic zero-drift
null seeds (the cached synthetic event tables of stage1.run synth). Calibration check: share of seeds with any
CI > 0 & Holm-passing feature must be <= 5%.

    python3 -m stage1.diag_tod_synth     -> v2data/ema/results/stage1/s1_diag_tod_synth.pkl
"""
from __future__ import annotations

import glob
import os
import pickle
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.diag_tod import DesignTOD  # noqa: E402
from stage1.run import BLOCKS, OUT, ROOTS, S1A_TESTS, SYN_PARTS, eval_sessions, null_family  # noqa: E402


def main():
    ses = eval_sessions()
    p = os.path.join(OUT, 's1_diag_tod_synth.pkl')
    done = pickle.load(open(p, 'rb')) if os.path.exists(p) else {}
    for seed in range(100):
        parts = [os.path.join(SYN_PARTS, f'seed{seed:03d}_{b}_{r}.parquet') for b in BLOCKS for r in ROOTS]
        if seed in done or not all(os.path.exists(x) for x in parts):
            continue
        ev = pd.concat([pd.read_parquet(x) for x in parts], ignore_index=True)
        ev = ev[ev.status_ok].reset_index(drop=True)
        D = DesignTOD(ev, ses)
        r = null_family(D, ev, {(F, tf): ev[f'f_{F}_{tf}'].to_numpy(float) for F, tf in S1A_TESTS})
        done[seed] = {k: r[k] for k in ('any_holm', 'any_pass', 'n_holm', 'min_holm', 'deltas', 'ps')}
        pickle.dump(done, open(p, 'wb'))
        print('seed', seed, 'any_holm', r['any_holm'], flush=True)
    print('S1A-T synthetic FWER', sum(v['any_holm'] for v in done.values()), '/', len(done))


if __name__ == '__main__':
    main()
