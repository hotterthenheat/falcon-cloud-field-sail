"""Adaptive exit simulation (PREREG Stage B) on per-second arrays.

Inputs per trade, on a 1-second grid g = te, te+1, ..., te+L (L = 60 min + slack):
  u[g]  : underlying mid usable at decision time g (row stamped <= g-1)
  ob[g] : option bid usable at decision time g (row stamped <= g-1)
  fb[g] : option bid of the first row stamped >= g (fill price for an exit decided at g-2, i.e. fb[g+2])
  entry ask A (fill at te), dir, s = sigma_30, grid end cap (15:55 ET).
Returns the exit fill bid for each of the 27 grid variants.
"""
import itertools

import numpy as np

KT = (1.0, 1.5, 2.0)
KS = (0.75, 1.0, 1.5)
TT = (15, 30, 60)
GRID = list(itertools.product(KT, KS, TT))
FEE = 0.65


def simulate(u, ob, fb, A, d, s, n_max):
    """u, ob, fb: arrays indexed by seconds after te (index 0 = te). n_max: last decision index allowed (15:55 cap)."""
    m = d * (u / u[0] - 1)
    out = np.empty(len(GRID))
    floor_hit = ob <= 0.40 * A
    runmax = np.maximum.accumulate(np.where(np.isfinite(m), m, -np.inf))
    for j, (kt, ks, T) in enumerate(GRID):
        last = min(T * 60, n_max, len(m) - 3)
        mm = m[1:last + 1]
        rm = runmax[1:last + 1]
        trail_on = rm >= 0.5 * kt * s
        stop_lvl = np.where(trail_on, 0.0, -ks * s)
        trig = (mm >= kt * s) | (mm <= stop_lvl) | floor_hit[1:last + 1]
        k = np.argmax(trig) + 1 if trig.any() else last
        out[j] = fb[min(k + 2, len(fb) - 1)]
    return out


def ret(exit_bid, A, fee=True):
    f = FEE if fee else 0.0
    return (100 * exit_bid - f) / (100 * A + f) - 1
