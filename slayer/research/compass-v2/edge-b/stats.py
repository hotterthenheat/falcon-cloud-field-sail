"""Session-clustered bootstrap, permutation and synthetic nulls, PBO (CSCV), deflated Sharpe."""
import math

import numpy as np


def cluster_ci(x, sess, B=2000, seed=1, alpha=0.05):
    """mean and percentile CI of the mean, resampling whole sessions."""
    x = np.asarray(x, float)
    u, inv = np.unique(np.asarray(sess), return_inverse=True)
    S = np.bincount(inv, weights=x, minlength=len(u))
    N = np.bincount(inv, minlength=len(u)).astype(float)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(u), size=(B, len(u)))
    m = S[idx].sum(1) / np.maximum(N[idx].sum(1), 1)
    return x.mean(), np.quantile(m, alpha / 2), np.quantile(m, 1 - alpha / 2)


def norm_cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def dsr(returns, n_trials, sr_var_trials=None):
    """Deflated Sharpe ratio (Bailey & Lopez de Prado). returns: per-trade; n_trials: total trials counted."""
    r = np.asarray(returns, float)
    T = len(r)
    if T < 3 or r.std(ddof=1) == 0:
        return float('nan')
    sr = r.mean() / r.std(ddof=1)
    g3 = ((r - r.mean()) ** 3).mean() / r.std() ** 3
    g4 = ((r - r.mean()) ** 4).mean() / r.std() ** 4
    v = sr_var_trials if sr_var_trials is not None else 1.0 / T
    emc = 0.5772156649
    N = max(n_trials, 2)
    from statistics import NormalDist
    nd = NormalDist()
    sr0 = math.sqrt(v) * ((1 - emc) * nd.inv_cdf(1 - 1 / N) + emc * nd.inv_cdf(1 - 1 / (N * math.e)))
    z = (sr - sr0) * math.sqrt(T - 1) / math.sqrt(max(1e-12, 1 - g3 * sr + (g4 - 1) / 4 * sr ** 2))
    return norm_cdf(z)


def pbo_cscv(M, sess, n_blocks=16):
    """M: trades x variants matrix of returns (same trades), sess: session per trade. Returns PBO."""
    import itertools
    us = np.array(sorted(set(sess)))
    blocks = np.array_split(us, n_blocks)
    bid = {s: i for i, b in enumerate(blocks) for s in b}
    tb = np.array([bid[s] for s in sess])
    BS = np.zeros((n_blocks, M.shape[1])); BN = np.zeros(n_blocks)
    for b in range(n_blocks):
        BS[b] = M[tb == b].sum(0); BN[b] = (tb == b).sum()
    lam = []
    for comb in itertools.combinations(range(n_blocks), n_blocks // 2):
        ins = np.zeros(n_blocks, bool); ins[list(comb)] = True
        mi = BS[ins].sum(0) / max(BN[ins].sum(), 1)
        mo = BS[~ins].sum(0) / max(BN[~ins].sum(), 1)
        best = np.argmax(mi)
        rank = (mo < mo[best]).sum() + 0.5 * ((mo == mo[best]).sum() - 1)
        w = (rank + 1) / (M.shape[1] + 1)
        lam.append(math.log(w / (1 - w)))
    lam = np.array(lam)
    return float((lam <= 0).mean())
