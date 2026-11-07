"""Statistics. All inference clusters by trading day (PROTOCOL section 1): never by root-day or by row.

boot_mean(x, day)               day-clustered bootstrap of a mean: (mean, lo, hi, p two-sided)
boot_diff(x, day, g)            day-clustered bootstrap of mean(x | g) - mean(x | ~g)
boot_stat(day, fn, *arrays)     generic day-clustered bootstrap of fn(*arrays)
ols_cluster(y, X, day)          OLS with day-clustered (CR1) standard errors: dict(beta, se, t, p, n, n_clusters)
spearman_ic(x, y, day)          Spearman rank IC with a day-clustered bootstrap CI: (ic, lo, hi, p)
bh_fdr(p, q)                    Benjamini-Hochberg: (q-values, reject mask)
pbo_cscv(M, n_blocks)           probability of backtest overfitting (Bailey et al. CSCV); M = periods x variants
deflated_sharpe(sr, n, n_trials, sr_var, skew, kurt)   Bailey & Lopez de Prado (2014)
"""
import itertools
import math
from statistics import NormalDist

import numpy as np
from scipy import stats as st

_N = NormalDist()


def _clusters(day):
    day = np.asarray(day)
    u, inv = np.unique(day, return_inverse=True)
    return u, inv


def _boot_idx(n_clusters, n_boot, seed):
    rng = np.random.default_rng(seed)
    return rng.integers(0, n_clusters, (n_boot, n_clusters))


def boot_mean(x, day, n_boot=2000, seed=1):
    x = np.asarray(x, float)
    day = np.asarray(day)
    ok = np.isfinite(x)
    x, day = x[ok], day[ok]
    if not len(x):
        return (np.nan,) * 4
    u, inv = _clusters(day)
    s = np.bincount(inv, weights=x)
    c = np.bincount(inv).astype(float)
    idx = _boot_idx(len(u), n_boot, seed)
    bs = s[idx].sum(1) / c[idx].sum(1)
    m = s.sum() / c.sum()
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return float(m), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float(max(p, 1.0 / n_boot))


def boot_diff(x, day, g, n_boot=2000, seed=1):
    """mean(x[g]) - mean(x[~g]), resampling days (both groups move together within a day)."""
    x = np.asarray(x, float)
    g = np.asarray(g, bool)
    day = np.asarray(day)
    ok = np.isfinite(x)
    x, g, day = x[ok], g[ok], day[ok]
    u, inv = _clusters(day)
    s1 = np.bincount(inv, weights=x * g, minlength=len(u))
    c1 = np.bincount(inv, weights=g.astype(float), minlength=len(u))
    s0 = np.bincount(inv, weights=x * ~g, minlength=len(u))
    c0 = np.bincount(inv, weights=(~g).astype(float), minlength=len(u))
    idx = _boot_idx(len(u), n_boot, seed)
    with np.errstate(invalid='ignore', divide='ignore'):
        bs = s1[idx].sum(1) / c1[idx].sum(1) - s0[idx].sum(1) / c0[idx].sum(1)
        m = s1.sum() / c1.sum() - s0.sum() / c0.sum()
    bs = bs[np.isfinite(bs)]
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return float(m), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float(max(p, 1.0 / n_boot))


def boot_stat(day, fn, *arrays, n_boot=2000, seed=1):
    """Generic: fn(*arrays_subset) -> float; resamples whole days. Returns (stat, lo, hi)."""
    day = np.asarray(day)
    u, inv = _clusters(day)
    rows = [np.flatnonzero(inv == i) for i in range(len(u))]
    rng = np.random.default_rng(seed)
    full = fn(*arrays)
    out = []
    for _ in range(n_boot):
        pick = rng.integers(0, len(u), len(u))
        ix = np.concatenate([rows[i] for i in pick])
        out.append(fn(*[np.asarray(a)[ix] for a in arrays]))
    out = np.array(out, float)
    out = out[np.isfinite(out)]
    return float(full), float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def ols_cluster(y, X, day, add_const=True, names=None):
    """OLS with CR1 day-clustered standard errors (Stata small-sample factor). X: (n, k) array."""
    y = np.asarray(y, float)
    X = np.asarray(X, float)
    if X.ndim == 1:
        X = X[:, None]
    day = np.asarray(day)
    ok = np.isfinite(y) & np.all(np.isfinite(X), 1)
    y, X, day = y[ok], X[ok], day[ok]
    if add_const:
        X = np.column_stack([np.ones(len(y)), X])
        names = ['const'] + list(names or [f'x{i}' for i in range(X.shape[1] - 1)])
    n, k = X.shape
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ X.T @ y
    e = y - X @ beta
    u, inv = _clusters(day)
    G = len(u)
    S = np.zeros((G, k))
    np.add.at(S, inv, X * e[:, None])
    meat = S.T @ S
    c = G / (G - 1) * (n - 1) / (n - k) if G > 1 and n > k else 1.0
    V = c * XtX_inv @ meat @ XtX_inv
    se = np.sqrt(np.maximum(np.diag(V), 0))
    tt = beta / np.where(se > 0, se, np.nan)
    p = 2 * st.t.sf(np.abs(tt), df=max(G - 1, 1))
    return {'beta': beta, 'se': se, 't': tt, 'p': p, 'n': n, 'n_clusters': G, 'names': names,
            'r2': 1 - (e @ e) / np.sum((y - y.mean()) ** 2) if n > 1 else np.nan}


def spearman_ic(x, y, day, n_boot=2000, seed=1):
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    day = np.asarray(day)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y, day = x[ok], y[ok], day[ok]
    if len(x) < 10:
        return (np.nan,) * 4
    rx, ry = st.rankdata(x), st.rankdata(y)

    def ic(a, b):
        return np.corrcoef(st.rankdata(a), st.rankdata(b))[0, 1]

    full = float(np.corrcoef(rx, ry)[0, 1])
    u, inv = _clusters(day)
    rows = [np.flatnonzero(inv == i) for i in range(len(u))]
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(n_boot):
        ix = np.concatenate([rows[i] for i in rng.integers(0, len(u), len(u))])
        bs.append(ic(x[ix], y[ix]))
    bs = np.array(bs)
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return full, float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), float(max(p, 1.0 / n_boot))


def bh_fdr(p, q=0.10):
    p = np.asarray(p, float)
    n = np.isfinite(p).sum()
    qv = np.full(p.shape, np.nan)
    if n == 0:
        return qv, np.zeros(p.shape, bool)
    idx = np.flatnonzero(np.isfinite(p))
    order = idx[np.argsort(p[idx])]
    ranked = p[order] * n / np.arange(1, n + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qv[order] = np.minimum(ranked, 1.0)
    return qv, np.nan_to_num(qv, nan=1.0) <= q


def pbo_cscv(M, n_blocks=16, max_combos=5000, seed=0):
    """M: periods (e.g. days) x variants of per-period performance. Splits periods into n_blocks contiguous blocks;
    for each half-split, picks the in-sample best variant (mean) and records its out-of-sample relative rank
    w in (0, 1); PBO = share of splits with logit(w) <= 0. Returns (pbo, logits)."""
    M = np.asarray(M, float)
    if M.ndim != 2 or M.shape[1] < 2:
        return np.nan, np.array([])
    blocks = np.array_split(np.arange(M.shape[0]), n_blocks)
    combos = list(itertools.combinations(range(n_blocks), n_blocks // 2))
    if len(combos) > max_combos:
        rng = np.random.default_rng(seed)
        combos = [combos[i] for i in rng.choice(len(combos), max_combos, replace=False)]
    logits = []
    for c in combos:
        ins = np.concatenate([blocks[i] for i in c])
        oos = np.concatenate([blocks[i] for i in range(n_blocks) if i not in c])
        pi = np.nanmean(M[ins], 0)
        po = np.nanmean(M[oos], 0)
        if not np.isfinite(pi).any():
            continue
        best = int(np.nanargmax(pi))
        fin = np.isfinite(po)
        w = (np.sum(po[fin] < po[best]) + 0.5) / (fin.sum() + 1)
        logits.append(math.log(w / (1 - w)))
    logits = np.array(logits)
    return (float((logits <= 0).mean()) if len(logits) else np.nan), logits


def expected_max_sharpe(n_trials, sr_var):
    g = 0.5772156649
    if n_trials < 2:
        return 0.0
    return math.sqrt(max(sr_var, 1e-12)) * ((1 - g) * _N.inv_cdf(1 - 1 / n_trials) + g * _N.inv_cdf(1 - 1 / (n_trials * math.e)))


def deflated_sharpe(sr, n, n_trials, sr_var, skew=0.0, kurt=3.0):
    """Probability that the true Sharpe exceeds the expected maximum of n_trials unskilled trials. sr is the
    per-observation (non-annualised) Sharpe over n observations; sr_var = variance of the trials' Sharpe ratios."""
    if not np.isfinite(sr) or n < 3:
        return np.nan
    e_max = expected_max_sharpe(n_trials, sr_var)
    den = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    return _N.cdf((sr - e_max) * math.sqrt(n - 1) / den)


def probabilistic_sharpe(sr, n, skew=0.0, kurt=3.0, sr_star=0.0):
    if not np.isfinite(sr) or n < 3:
        return np.nan
    den = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    return _N.cdf((sr - sr_star) * math.sqrt(n - 1) / den)
