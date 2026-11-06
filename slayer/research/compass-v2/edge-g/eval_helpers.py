"""Small fast helpers for the nulls (session-clustered bootstrap lower bound)."""
import numpy as np


def cluster_lo(values, clusters, n_boot=500, seed=5):
    v = np.asarray(values, float)
    keys, inv = np.unique(np.asarray(clusters).astype(str), return_inverse=True)
    sums = np.bincount(inv, weights=v, minlength=len(keys))
    cnts = np.bincount(inv, minlength=len(keys)).astype(float)
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(keys), (n_boot, len(keys)))
    S, N = sums[pick].sum(1), cnts[pick].sum(1)
    m = S[N > 0] / N[N > 0]
    return float(np.percentile(m, 2.5)) if len(m) else float('nan')
