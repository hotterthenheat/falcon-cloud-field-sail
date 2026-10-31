"""Shared loading, feature and evaluation code for the physics-indicator study.

Everything here is causal: a feature stamped at decision minute j uses bars 0..j-1 of the day (and earlier days)
only; a target uses bars j.. onward. Parameters are fixed constants below, chosen before looking at any result.
"""
import gzip, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
RESULTS = os.path.join(HERE, '..', 'results')
NBAR = 390                       # 09:30 .. 15:59 regular session, one-minute bars
DECISIONS = list(range(30, 331, 15))   # 10:00 .. 15:00 every 15 minutes (minute index after 09:30)
TEST_START = '2024-07-01'        # everything before is the first training block; refit every quarter after
SEED = 7

# ----------------------------------------------------------------------------------------------- loading

def load_bars(sym):
    """Return (days[list of 'YYYY-MM-DD'], O,H,L,C,V arrays [ndays, 390]); missing minutes forward-filled with v=0."""
    cache = os.path.join(DATA, f'{sym}_bars.npz')
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        return list(z['days']), z['O'], z['H'], z['L'], z['C'], z['V']
    rows = {}
    d = os.path.join(DATA, 'bars', sym)
    for fn in sorted(os.listdir(d)):
        with gzip.open(os.path.join(d, fn)) as f:
            for r in json.load(f)['response']:
                if not r['close'] or r['close'] <= 0:
                    continue
                ts = r['timestamp']
                m = (int(ts[11:13]) - 9) * 60 + int(ts[14:16]) - 30
                if 0 <= m < NBAR:
                    rows.setdefault(ts[:10], {})[m] = (r['open'], r['high'], r['low'], r['close'], r['volume'])
    days = sorted(k for k, v in rows.items() if len(v) >= 150)   # drop broken/near-empty days
    n = len(days)
    O, H, L, C, V = (np.full((n, NBAR), np.nan) for _ in range(5))
    for i, day in enumerate(days):
        for m, (o, h, l, c, v) in rows[day].items():
            O[i, m], H[i, m], L[i, m], C[i, m], V[i, m] = o, h, l, c, v
        # last real bar of the day (early closes end at 12:59)
        last = max(rows[day])
        for m in range(1, last + 1):
            if np.isnan(C[i, m]):
                O[i, m] = H[i, m] = L[i, m] = C[i, m] = C[i, m - 1]
                V[i, m] = 0.0
        if np.isnan(C[i, 0]):
            j = min(rows[day])
            O[i, :j] = H[i, :j] = L[i, :j] = C[i, :j] = O[i, j]
            V[i, :j] = 0
    np.savez_compressed(cache, days=np.array(days), O=O, H=H, L=L, C=C, V=V)
    return days, O, H, L, C, V


def returns(O, C):
    """Intraday one-minute log returns; bar 0 is its own open->close (the overnight gap is excluded)."""
    r = np.full(C.shape, np.nan)
    r[:, 1:] = np.log(C[:, 1:] / C[:, :-1])
    r[:, 0] = np.log(C[:, 0] / O[:, 0])
    return r


def load_vix():
    out = {}
    d = os.path.join(DATA, 'eod')
    for fn in sorted(os.listdir(d)):
        with gzip.open(os.path.join(d, fn)) as f:
            for r in json.load(f)['response']:
                c = r.get('close') or 0
                if c > 0:
                    day = (r.get('created') or r.get('timestamp') or r.get('date') or '')[:10]
                    out[day] = c
    return out

# ----------------------------------------------------------------------------------------------- features

def perm_entropy(x, m=3, tau=1):
    """Normalised Bandt-Pompe permutation entropy in [0,1]."""
    n = len(x) - (m - 1) * tau
    if n <= 0:
        return np.nan
    emb = np.stack([x[i * tau:i * tau + n] for i in range(m)], axis=1)
    ranks = np.argsort(emb, axis=1, kind='stable')
    code = (ranks * (m ** np.arange(m))).sum(axis=1)
    _, cnt = np.unique(code, return_counts=True)
    p = cnt / cnt.sum()
    return float(-(p * np.log(p)).sum() / np.log(float(np.prod(np.arange(1, m + 1)))))


def sample_entropy(x, m=2, rfrac=0.2):
    """Richman-Moorman sample entropy, tolerance r = rfrac * std(x), Chebyshev distance."""
    x = np.asarray(x, float)
    r = rfrac * x.std()
    if r <= 0:
        return np.nan
    def count(mm):
        emb = np.lib.stride_tricks.sliding_window_view(x, mm)[: len(x) - m]
        d = np.abs(emb[:, None, :] - emb[None, :, :]).max(axis=2)
        return ((d <= r).sum() - len(emb)) / 2
    b, a = count(m), count(m + 1)
    return float(-np.log(a / b)) if a > 0 and b > 0 else np.nan


DFA_SCALES = np.unique(np.round(np.logspace(np.log10(6), np.log10(48), 8)).astype(int))

def dfa_alpha(r):
    """DFA-1 scaling exponent of a return series (alpha 0.5 = random walk, >0.5 persistent, <0.5 anti-persistent)."""
    y = np.cumsum(r - r.mean())
    F = []
    for s in DFA_SCALES:
        k = len(y) // s
        seg = y[: k * s].reshape(k, s)
        t = np.arange(s)
        tc = t - t.mean()
        b = (seg - seg.mean(1, keepdims=True)) @ tc / (tc @ tc)
        resid = seg - seg.mean(1, keepdims=True) - b[:, None] * tc
        F.append(np.sqrt((resid ** 2).mean()))
    F = np.array(F)
    if np.any(F <= 0):
        return np.nan
    return float(np.polyfit(np.log(DFA_SCALES), np.log(F), 1)[0])


def lyapunov_rosenstein(x, m=5, tau=1, theiler=10, kmax=8):
    """Largest Lyapunov exponent (Rosenstein et al. 1993), per step: slope of mean log divergence of nearest
    neighbours in an m-dimensional delay embedding, Theiler window `theiler`, over k = 1..kmax steps."""
    x = (x - x.mean()) / (x.std() + 1e-18)
    N = len(x) - (m - 1) * tau
    emb = np.stack([x[i * tau:i * tau + N] for i in range(m)], axis=1)
    n_use = N - kmax
    E = emb[:n_use]
    D = np.sqrt(((E[:, None, :] - E[None, :, :]) ** 2).sum(-1))
    ii = np.arange(n_use)
    D[np.abs(ii[:, None] - ii[None, :]) < theiler] = np.inf
    nn = np.argmin(D, axis=1)
    curve = []
    for k in range(1, kmax + 1):
        d = np.sqrt(((emb[ii + k] - emb[nn + k]) ** 2).sum(-1))
        d = d[d > 0]
        curve.append(np.mean(np.log(d)))
    return float(np.polyfit(np.arange(1, kmax + 1), curve, 1)[0])


def variance_ratio(r, q=5):
    """Lo-MacKinlay VR(q) on the window (overlapping q-sums)."""
    v1 = r.var()
    if v1 <= 0:
        return np.nan
    s = np.convolve(r, np.ones(q), 'valid')
    return float(s.var() / (q * v1))


def efficiency_ratio(r):
    a = np.abs(r).sum()
    return float(abs(r.sum()) / a) if a > 0 else np.nan


def ema(x, span):
    a = 2.0 / (span + 1)
    out = np.empty_like(x)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def analytic_last(x):
    """Phase of the last sample of the analytic signal of a (demeaned, Hann-tapered on the left only) window."""
    x = x - x.mean()
    n = len(x)
    taper = np.ones(n)
    k = n // 4
    taper[:k] = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)   # taper only the old end: the newest sample is untouched
    X = np.fft.fft(x * taper)
    h = np.zeros(n)
    h[0] = 1
    h[1:(n + 1) // 2] = 2
    if n % 2 == 0:
        h[n // 2] = 1
    z = np.fft.ifft(X * h)
    return float(np.angle(z[-1]))


PHASE_SCALES = (8, 16, 32, 64)

def bands(logp_series):
    """Causal band-passes of a whole log-price series: EMA(s/2) - EMA(2s) for each phase scale s."""
    return {s: ema(logp_series, max(2, s // 2)) - ema(logp_series, 2 * s) for s in PHASE_SCALES}


def phase_sync(band_windows):
    """Hilbert phase synchronisation across timeframes (causal: phase of the newest sample of a trailing window).

    For each scale s the band is EMA(s/2) - EMA(2s) of log price (a causal band-pass, see bands()). Phase phi_s of its
    analytic signal at the newest sample. R = |mean exp(i phi_s)| (1 = all cycles in phase). Rising-phase direction
    D = -sin(mean phase) (a cosine cycle is rising when sin(phi) < 0). Returns R, D, R*D."""
    ph = [analytic_last(w) for w in band_windows]
    z = np.exp(1j * np.array(ph)).mean()
    R, Phi = abs(z), np.angle(z)
    D = -np.sin(Phi)
    return R, D, R * D


def mtf_agreement(r):
    """Simple baseline: mean sign of the trailing 8/16/32/64-minute returns (+1 all up, -1 all down)."""
    return float(np.mean([np.sign(r[-s:].sum()) for s in PHASE_SCALES]))

# ----------------------------------------------------------------------------------------------- evaluation

def quarter(day):
    return day[:4] + 'Q' + str((int(day[5:7]) - 1) // 3 + 1)


def walk_forward_ols(X, y, days, test_start=TEST_START):
    """Expanding-window OLS refit at the start of every test quarter; returns OOS predictions (NaN in training)."""
    days = np.asarray(days)
    q = np.array([quarter(d) for d in days])
    pred = np.full(len(y), np.nan)
    ok = np.isfinite(y) & np.all(np.isfinite(X), axis=1)
    for qq in sorted(set(q[days >= test_start])):
        tr = ok & (days < min(days[q == qq]))
        te = ok & (q == qq)
        if tr.sum() < 200 or te.sum() == 0:
            continue
        beta, *_ = np.linalg.lstsq(X[tr], y[tr], rcond=None)
        pred[te] = X[te] @ beta
    return pred


def block_boot_ratio(num_by_day, den_by_day, n=2000, seed=SEED):
    """Day-block bootstrap of sum(num)/sum(den): point, 95% CI, two-sided p for 'equals 0'."""
    rng = np.random.default_rng(seed)
    num_by_day, den_by_day = np.asarray(num_by_day, float), np.asarray(den_by_day, float)
    k = len(num_by_day)
    pt = num_by_day.sum() / den_by_day.sum()
    idx = rng.integers(0, k, size=(n, k))
    bs = num_by_day[idx].sum(1) / den_by_day[idx].sum(1)
    lo, hi = np.percentile(bs, [2.5, 97.5])
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return float(pt), float(lo), float(hi), float(max(p, 1.0 / n))


def by_day(values, days):
    days = np.asarray(days)
    u, inv = np.unique(days, return_inverse=True)
    return np.bincount(inv, weights=values, minlength=len(u)), u


def delta_r2(y, pb, pa, days):
    """OOS R^2 of the baseline and the augmented model, and the gain with a day-block bootstrap CI."""
    m = np.isfinite(y) & np.isfinite(pb) & np.isfinite(pa)
    y, pb, pa, d = y[m], pb[m], pa[m], np.asarray(days)[m]
    var = ((y - y.mean()) ** 2)
    eb, ea = (y - pb) ** 2, (y - pa) ** 2
    num, _ = by_day(eb - ea, d)
    den, _ = by_day(var, d)
    pt, lo, hi, p = block_boot_ratio(num, den)
    return dict(n=int(m.sum()), days=int(len(num)), r2_base=float(1 - eb.sum() / var.sum()),
                r2_aug=float(1 - ea.sum() / var.sum()), d_r2=pt, ci=[lo, hi], p=p)


def tercile_spread(feat, y, days, train_mask, test_mask):
    """Mean of y in the top minus bottom tercile of feat (cut points from training rows only), day-bootstrapped."""
    lo_c, hi_c = np.nanpercentile(feat[train_mask], [100 / 3, 200 / 3])
    m = test_mask & np.isfinite(feat) & np.isfinite(y)
    top = m & (feat >= hi_c)
    bot = m & (feat <= lo_c)
    d = np.asarray(days)
    u = np.unique(d[m])
    pos = {k: i for i, k in enumerate(u)}
    def per(mask):
        s = np.zeros(len(u)); c = np.zeros(len(u))
        for di, yy in zip(d[mask], y[mask]):
            s[pos[di]] += yy; c[pos[di]] += 1
        return s, c
    st, ct = per(top); sb, cb = per(bot)
    rng = np.random.default_rng(SEED)
    idx = rng.integers(0, len(u), size=(2000, len(u)))
    bs = st[idx].sum(1) / ct[idx].sum(1) - sb[idx].sum(1) / cb[idx].sum(1)
    pt = st.sum() / ct.sum() - sb.sum() / cb.sum()
    lo, hi = np.percentile(bs, [2.5, 97.5])
    p = 2 * min((bs <= 0).mean(), (bs >= 0).mean())
    return dict(n=int(m.sum()), top=float(st.sum() / ct.sum()), bottom=float(sb.sum() / cb.sum()),
                mid=float(np.nanmean(y[m & (feat > lo_c) & (feat < hi_c)])), spread=float(pt),
                ci=[float(lo), float(hi)], p=float(max(p, 1 / 2000)), cuts=[float(lo_c), float(hi_c)])


def auc(score, label):
    m = np.isfinite(score) & np.isfinite(label)
    s, l = score[m], label[m].astype(bool)
    if l.sum() == 0 or (~l).sum() == 0:
        return np.nan
    order = np.argsort(s, kind='stable')
    ranks = np.empty(len(s)); ranks[order] = np.arange(1, len(s) + 1)
    # average ranks for ties
    _, inv, cnt = np.unique(s, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=ranks)
    ranks = (sums / cnt)[inv]
    return float((ranks[l].sum() - l.sum() * (l.sum() + 1) / 2) / (l.sum() * (~l).sum()))


def auc_boot(score_a, score_b, label, days, n=1000):
    """AUC of a, of b, and a-b with a day-block bootstrap CI."""
    m = np.isfinite(score_a) & np.isfinite(score_b) & np.isfinite(label)
    a, b, l, d = score_a[m], score_b[m], label[m], np.asarray(days)[m]
    u, inv = np.unique(d, return_inverse=True)
    groups = [np.where(inv == k)[0] for k in range(len(u))]
    rng = np.random.default_rng(SEED)
    diffs = []
    for _ in range(n):
        pick = np.concatenate([groups[k] for k in rng.integers(0, len(u), len(u))])
        diffs.append(auc(a[pick], l[pick]) - auc(b[pick], l[pick]))
    diffs = np.array(diffs)
    lo, hi = np.nanpercentile(diffs, [2.5, 97.5])
    p = 2 * min(np.nanmean(diffs <= 0), np.nanmean(diffs >= 0))
    return dict(n=int(m.sum()), events=int(l.sum()), auc_a=auc(a, l), auc_b=auc(b, l),
                d_auc=float(auc(a, l) - auc(b, l)), ci=[float(lo), float(hi)], p=float(max(p, 1 / n)))


def holm(pvals):
    """Holm-Bonferroni adjusted p-values (same order as given)."""
    p = np.asarray(pvals, float)
    order = np.argsort(p)
    adj = np.empty_like(p)
    run = 0.0
    for rank, i in enumerate(order):
        run = max(run, min(1.0, (len(p) - rank) * p[i]))
        adj[i] = run
    return adj


def save_json(name, obj):
    os.makedirs(RESULTS, exist_ok=True)
    with open(os.path.join(RESULTS, name), 'w') as f:
        json.dump(obj, f, indent=1, default=float)
