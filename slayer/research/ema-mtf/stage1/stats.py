"""Stage-1 statistics (PREREG sections 4 and 8).

delta(y, f, strata, sessions): the stratified incremental effect
    delta = sum_s w_s [mean(y | f=1, s) - mean(y | f=0, s)] / sum_s w_s,   w_s = #(f=1 in s),
    over strata that hold both f=1 and f=0 events (a stratum with only one side carries no within-stratum contrast).
Inference: session-clustered bootstrap, 4000 resamples, seed 7, resampling whole sessions with replacement exactly as
compass-v2 eval/metrics.py cluster_ci_mean (rng.integers(0, K, (B, K)) over the K clusters, sessions with no event
included as clusters). The statistic is recomputed on every resample (strata means re-formed from the resampled
sessions). 95% CI = 2.5/97.5 percentiles; one-sided p (H1: delta > 0) = (1 + #{delta* <= 0}) / (B + 1).

holm(p) / bh(p): Holm-Bonferroni adjusted p-values (step-down, monotone) and Benjamini-Hochberg q-values.
ols_cluster(y, X, clusters): OLS with CR1 session-clustered standard errors.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sst

N_BOOT, SEED = 4000, 7


def boot_weights(K: int, n_boot: int = N_BOOT, seed: int = SEED) -> np.ndarray:
    """(B, K) multiplicities of each cluster in each resample (same draws as cluster_ci_mean)."""
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, K, (n_boot, K))
    W = np.zeros((n_boot, K))
    np.add.at(W, (np.repeat(np.arange(n_boot), K), pick.ravel()), 1.0)
    return W


def _cells(y, f, strata, ses, K, J):
    ok = np.isfinite(y) & np.isfinite(f)
    y, f, strata, ses = y[ok], f[ok], strata[ok], ses[ok]
    on = f == 1
    idx = ses * J + strata
    s1 = np.bincount(idx[on], weights=y[on], minlength=K * J).reshape(K, J)
    c1 = np.bincount(idx[on], minlength=K * J).reshape(K, J).astype(float)
    s0 = np.bincount(idx[~on], weights=y[~on], minlength=K * J).reshape(K, J)
    c0 = np.bincount(idx[~on], minlength=K * J).reshape(K, J).astype(float)
    return s1, c1, s0, c0


def _delta_from(S1, C1, S0, C0):
    """Works on (J,) or (B, J) arrays."""
    both = (C1 > 0) & (C0 > 0)
    with np.errstate(invalid='ignore', divide='ignore'):
        d = np.where(both, S1 / np.where(C1 > 0, C1, 1) - S0 / np.where(C0 > 0, C0, 1), 0.0)
    w = np.where(both, C1, 0.0)
    sw = w.sum(-1)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(sw > 0, (w * d).sum(-1) / np.where(sw > 0, sw, 1), np.nan)


def delta(y, f, strata, ses, K: int, W: np.ndarray | None = None, J: int | None = None) -> dict:
    """y, f float arrays (NaN excluded); strata, ses int codes (ses in [0, K)). W: boot_weights(K) (reuse it)."""
    y, f = np.asarray(y, float), np.asarray(f, float)
    strata, ses = np.asarray(strata, np.int64), np.asarray(ses, np.int64)
    J = J or (int(strata.max()) + 1 if len(strata) else 1)
    s1, c1, s0, c0 = _cells(y, f, strata, ses, K, J)
    d = float(_delta_from(s1.sum(0), c1.sum(0), s0.sum(0), c0.sum(0)))
    out = {'delta': d, 'n1': int(c1.sum()), 'n0': int(c0.sum()),
           'mean1': float(s1.sum() / c1.sum()) if c1.sum() else np.nan,
           'mean0': float(s0.sum() / c0.sum()) if c0.sum() else np.nan}
    if W is None:
        return out
    db = _delta_from(W @ s1, W @ c1, W @ s0, W @ c0)
    db = db[np.isfinite(db)]
    if len(db) and np.isfinite(d):
        out['ci'] = (float(np.percentile(db, 2.5)), float(np.percentile(db, 97.5)))
        out['p'] = float((1 + np.sum(db <= 0)) / (len(db) + 1))
    else:
        out['ci'], out['p'] = (np.nan, np.nan), np.nan
    return out


def holm(p) -> np.ndarray:
    p = np.asarray(p, float)
    m = np.isfinite(p).sum()
    out = np.full(len(p), np.nan)
    idx = [i for i in np.argsort(p) if np.isfinite(p[i])]
    run = 0.0
    for r, i in enumerate(idx):
        run = max(run, min(1.0, (m - r) * p[i]))
        out[i] = run
    return out


def bh(p) -> np.ndarray:
    p = np.asarray(p, float)
    ok = np.isfinite(p)
    m = ok.sum()
    out = np.full(len(p), np.nan)
    if not m:
        return out
    idx = np.argsort(np.where(ok, p, np.inf))[:m]
    q = p[idx] * m / np.arange(1, m + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out[idx] = np.minimum(q, 1.0)
    return out


def ols_cluster(y: np.ndarray, X: np.ndarray, clusters: np.ndarray) -> dict:
    """OLS of y on X (include the constant / fixed effects in X) with CR1 cluster-robust standard errors."""
    y, X = np.asarray(y, float), np.asarray(X, float)
    n, k = X.shape
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ (X.T @ y)
    u = y - X @ beta
    cl = pd.factorize(np.asarray(clusters))[0]
    G = cl.max() + 1
    S = np.zeros((G, k))
    np.add.at(S, cl, X * u[:, None])
    meat = S.T @ S
    adj = G / (G - 1) * (n - 1) / max(n - k, 1)
    V = adj * XtX_inv @ meat @ XtX_inv
    se = np.sqrt(np.clip(np.diag(V), 0, None))
    t = beta / np.where(se > 0, se, np.nan)
    return {'beta': beta, 'se': se, 't': t, 'p_one_sided': 1 - sst.norm.cdf(t), 'n': n, 'clusters': G}


def vif(X: np.ndarray) -> np.ndarray:
    """Variance inflation factor of each column of X (no constant in X; one is added)."""
    X = np.asarray(X, float)
    out = []
    for j in range(X.shape[1]):
        others = np.c_[np.ones(len(X)), np.delete(X, j, axis=1)]
        b, *_ = np.linalg.lstsq(others, X[:, j], rcond=None)
        r = X[:, j] - others @ b
        ss = ((X[:, j] - X[:, j].mean()) ** 2).sum()
        r2 = 1 - (r ** 2).sum() / ss if ss > 0 else np.nan
        out.append(1 / (1 - r2) if r2 < 1 else np.inf)
    return np.array(out)
