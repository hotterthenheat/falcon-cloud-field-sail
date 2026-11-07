"""Leakage test for the family-C features (families/c_micro.py).

  cd slayer/research/edge0dte && python3 -m families.c_test_leakage

For random DISCOVERY sessions (3 per root; SPXW/SPY drawn from sessions that have flow data, seed 2026) and 6 random
grid times each, every family-C feature computed on the full session must equal the value computed on a copy holding
only data stamped <= t: Session.truncated(t) (bars closed by t, board snapshots stamped <= t, aux series) AND the flow
table cut to minutes usable by t (mm + 1 <= t // 60). A deliberately leaky canary (the whole day's flow volume, and
the session's last bar) must be caught. Prior-session history is data of earlier days and is shared by both copies.
Exits non-zero on any failure.
"""
import sys

import numpy as np

from families import c_micro as C
from lib import panel
from lib.cal import expiry_sessions
from lib.config import ROOTS, split
from lib.data import bars, chain
from lib.tests.test_leakage import same


def main():
    rng = np.random.default_rng(2026)
    fails, n, canary = [], 0, []
    for root in ROOTS:
        days = [d for d in expiry_sessions(root) if split(d) == 'DISCOVERY' and chain(root, d) is not None
                and len(bars(root, d))]
        if root in ('SPXW', 'SPY'):
            days = [d for d in days if C.has_flow(root, d) and d >= '2022-07-01']   # >= 20 prior flow sessions
        for i in rng.choice(len(days), 3, replace=False):
            day = days[i]
            full = panel.session(root, day)
            full._flow = C._flow_file(root, day)
            for t in sorted(int(x) for x in rng.choice(panel.grid(day), 6, replace=False)):
                tr = full.truncated(t)
                f = full._flow
                tr._flow = None if f is None else f[f.mm.values + 1 <= t // 60].reset_index(drop=True)
                for name in C.C_FEATURES:
                    a, b = panel.FEATURES[name][0](full, t), panel.FEATURES[name][0](tr, t)
                    n += 1
                    if not same(a, b):
                        fails.append(f'{name} {root} {day} t={t}: full={a} trunc={b}')
                if f is not None:
                    canary.append(float(f.volume.sum()) != float(tr._flow.volume.sum()))
                canary.append(float(full.bars.c.iloc[-1]) != float(tr.bars.c.iloc[-1]))
                print(root, day, t, 'ok' if not fails else f'{len(fails)} fails', flush=True)
    print(f'{"PASS" if not fails else "FAIL"} family-C feature leakage: {n - len(fails)}/{n}')
    print(f'{"PASS" if all(canary) else "FAIL"} canary leaks detected: {sum(canary)}/{len(canary)}')
    for x in fails[:20]:
        print('  ', x)
    sys.exit(1 if fails or not all(canary) else 0)


if __name__ == '__main__':
    main()
