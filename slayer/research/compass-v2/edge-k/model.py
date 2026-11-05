"""EDGE-K chooser model (specs/PREREG.md @ a0e1dc6): realised-vol forecast, signal drift, business-time decay, spread
model, Monte Carlo of each contract's net return per dollar risked under the signal set's own exits.

Everything that is fitted is fitted per cross-fold (5 contiguous DEV folds; a signal uses the other 4). Nothing reads
VALIDATION or LOCKED: bar months after 2024-12 and locked months are never loaded, locked days are dropped.
"""
import json, math, os, sys
import numpy as np
import pandas as pd
from scipy.special import ndtr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, os.path.join(HERE, '..', 'edge-t'))
import sim  # noqa: E402
import fetch as F  # noqa: E402
import signals as SG  # noqa: E402

OUT = SG.OUT
NPROF = 60
NMIN = 15
FEE = 0.65
UND = {'SPXW': 'SPX', 'XSP': 'SPX', 'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM'}
SCALE = {'XSP': 0.1}
SET = {
    'S1': dict(dt=30, npaths=1000, flat_s=15 * 3600 + 50 * 60, flat_bar=379, stop=0.65, arm=1.50, trail=0.75, kind='RT',
               fit_ts=[9 * 3600 + m * 60 for m in (32, 33, 34, 35)]),
    'S2': dict(dt=15, npaths=2000, flat_s=15 * 3600 + 58 * 60 + 30, flat_bar=388, stop=0.50, arm=1.25, trail=0.75, kind='X2',
               fit_ts=[15 * 3600 + 25 * 60]),
}

# ---------------------------------------------------------------- folds


_DEV = None


def dev_days():
    global _DEV
    if _DEV is None:
        _DEV = SG.dev_days()
    return _DEV


def fold(day):
    d = dev_days()
    i = int(np.searchsorted(d, day))
    return min(4, i * 5 // len(d))


# ---------------------------------------------------------------- minute returns per underlying (non-locked, <= 2024)


_R = {}


def returns(und):
    """{day: r[390]} squared-return source: r_0 = ln(c/o) of the 09:30 bar, r_m = ln(c_m / c_prev) (gaps -> later bar).
    Only days with >= 300 bars and a 09:30 bar; locked days and months after 2024-12 are never read."""
    if und in _R:
        return _R[und]
    d = os.path.join(sim.ROOT, 'bars', und)
    out = {}
    for f in sorted(os.listdir(d)):
        month = f[:7]
        if month > '2024-12' or SGlocked_month(month):
            continue
        b = pd.read_parquet(os.path.join(d, f))
        b = b[(b.c > 0) & (b.o > 0)]
        for day, g in b.groupby('d'):
            if F.is_locked(day):
                continue
            g = g.sort_values('m')
            if len(g) < 300 or int(g.m.iloc[0]) != 570:
                continue
            m = g.m.values - 570
            keep = (m >= 0) & (m < 390)
            m, c, o = m[keep], g.c.values[keep].astype(float), g.o.values[keep].astype(float)
            r = np.zeros(390)
            r[0] = math.log(c[0] / o[0])
            lr = np.diff(np.log(c))
            r[m[1:]] = lr
            cl = np.full(390, np.nan)
            cl[m] = c
            out[day] = (r, cl)
    _R[und] = out
    return out


def SGlocked_month(month):
    return F.is_locked(month + '-15') and F.is_locked(month + '-01') and F.is_locked(month + '-28')


def smooth5(x):
    k = np.ones(5)
    num = np.convolve(x, k, 'same')
    den = np.convolve(np.ones_like(x), k, 'same')
    return num / den


def profile(und, day):
    """(P[390], prev_r2[390] or None, zpool) from the prior <= 60 eligible sessions, or None."""
    R = returns(und)
    prior = [d for d in sorted(R) if d < day][-NPROF:]
    if len(prior) < NMIN:
        return None
    M = np.array([R[d][0] for d in prior]) ** 2
    P = np.maximum(smooth5(M.mean(0)), 1e-12)
    lev = M.sum(1) / P.sum()
    z = (np.array([R[d][0] for d in prior]) / np.sqrt(P[None, :] * np.maximum(lev[:, None], 1e-6))).ravel()
    return {'P': P, 'prev_r2': M[-1], 'z': z}


def closed_idx(t):
    return (t - 60) // 60 - 570


def level_features(und, day, t, flat_bar, prof=None, causal=False, today=None):
    """ln L_prev, ln L_today at decision t; plus (for fitting only, causal=False) ln L_rem and the hold's closes.
    causal=True reads today's bars only up to the last closed bar (start <= t - 60); `today` overrides the day's
    (r, closes) arrays (look-ahead test)."""
    prof = prof or profile(und, day)
    R = returns(und)
    if prof is None or (day not in R and today is None):
        return None
    P = prof['P']
    r, cl = today if today is not None else R[day]
    mc = closed_idx(t)
    if mc < 0:
        return None
    lp = math.log(max(prof['prev_r2'].sum() / P.sum(), 0.05))
    lt = math.log(max((r[:mc + 1] ** 2).sum() / P[:mc + 1].sum(), 0.05))
    if causal:
        return {'lp': lp, 'lt': lt, 'mc': mc}
    hold = slice(mc + 1, flat_bar + 1)
    lr = math.log(max((r[hold] ** 2).sum() / P[hold].sum(), 0.05))
    return {'lp': lp, 'lt': lt, 'lr': lr, 'Phold': float(P[hold].sum()), 'S_t': cl[mc], 'S_f': cl[flat_bar], 'mc': mc}


# ---------------------------------------------------------------- fitting (per set, per fold)


def roots_of(setname):
    return ('SPXW', 'SPY', 'QQQ') if setname == 'S1' else ('SPY', 'QQQ', 'IWM', 'SPXW')


def fit(setname, sigs):
    """Per fold k: parameters from the other 4 folds. Saved to v2data/edge-k/fit_<set>.json."""
    f = os.path.join(OUT, f'fit_{setname}.json')
    if os.path.exists(f):
        return json.load(open(f))
    cfg = SET[setname]
    rows = []
    for und in sorted(set(UND[r] for r in roots_of(setname))):
        for day in dev_days():
            prof = profile(und, day)
            if prof is None or day not in returns(und):
                continue
            for t in cfg['fit_ts']:
                x = level_features(und, day, t, cfg['flat_bar'], prof)
                if x:
                    rows.append({'und': und, 'day': day, 'fold': fold(day), **x})
    L = pd.DataFrame(rows)
    # signal drift rows: side-signed hold log return over the point-forecast sigma (computed per fold below)
    S = []
    for s in sigs:
        und = UND[s['root']]
        x = level_features(und, s['day'], s['t'], cfg['flat_bar'])
        if x and np.isfinite(x['S_t']) and np.isfinite(x['S_f']):
            S.append({'day': s['day'], 'fold': fold(s['day']), 'sgn': 1.0 if s['up'] else -1.0,
                      'ret': math.log(x['S_f'] / x['S_t']), **{k: x[k] for k in ('lp', 'lt', 'Phold')}})
    S = pd.DataFrame(S)
    spreads = spread_rows(setname)
    out = {}
    for k in range(5):
        tr = L[L.fold != k]
        X = np.c_[np.ones(len(tr)), tr.lp.values, tr.lt.values]
        coef, *_ = np.linalg.lstsq(X, tr.lr.values, rcond=None)
        res = tr.lr.values - X @ coef
        ss = S[S.fold != k]
        lpt = coef[0] + coef[1] * ss.lp.values + coef[2] * ss.lt.values
        sig_f = np.sqrt(np.exp(lpt) * np.mean(np.exp(res)) * ss.Phold.values)
        kappa = float(np.mean(ss.sgn.values * ss.ret.values / sig_f))
        sp = {}
        for root, g in spreads.items():
            g = g[g.fold != k]
            if len(g) < 50:
                continue
            Xs = np.c_[np.ones(len(g)), np.log(g.mid.values)]
            cs, *_ = np.linalg.lstsq(Xs, np.log(g.h.values), rcond=None)
            sp[root] = {'beta': float(cs[1]), 'hmin': float(np.percentile(g.h.values, 5)), 'n': int(len(g))}
        rng = np.random.default_rng(k)
        out[str(k)] = {'coef': [float(c) for c in coef], 'res': [float(x) for x in rng.choice(res, min(2000, len(res)), replace=False)],
                       'res_sd': float(res.std()), 'n_level': int(len(tr)), 'r2': float(1 - res.var() / tr.lr.var()),
                       'kappa': kappa, 'n_kappa': int(len(ss)), 'spread': sp}
    json.dump(out, open(f, 'w'))
    return out


def spread_rows(setname):
    """Half-spread vs mid on DEV boards at the set's signal minutes (two-sided contracts), per root (+ XSP from the
    fetched XSP boards), with the fold of each session."""
    import ek_data as D
    mins = sorted(set((t - 60) // 60 for t in SET[setname]['fit_ts']))
    out = {}
    for root in roots_of(setname):
        parts = []
        for day in dev_days():
            if day not in F.expirations(root):
                continue
            c = sim.chain(root, day)
            if c is None or not len(c):
                continue
            b = c[c.m.isin(mins) & (c.bid > 0) & (c.ask > c.bid)]
            if len(b):
                parts.append(pd.DataFrame({'mid': (b.bid.values + b.ask.values) / 2, 'h': (b.ask.values - b.bid.values) / 2,
                                           'fold': fold(day)}))
        if parts:
            out[root] = pd.concat(parts)
    parts = []
    for day, m, b in D.xsp_boards_cached():
        if m in mins:
            b = b[(b.bid > 0) & (b.ask > b.bid)]
            parts.append(pd.DataFrame({'mid': (b.bid.values + b.ask.values) / 2, 'h': (b.ask.values - b.bid.values) / 2,
                                       'fold': fold(day)}))
    if parts and 'SPXW' in roots_of(setname):
        out['XSP'] = pd.concat(parts)
    return out


# ---------------------------------------------------------------- Monte Carlo


def bs_mid(S, K, W, call):
    sq = np.sqrt(np.maximum(W, 1e-14))
    d1 = (np.log(S / K) + 0.5 * W) / sq
    c = S * ndtr(d1) - K * ndtr(d1 - sq)
    return np.maximum(c if call else c - S + K, 0.0)


def simulate_paths(setname, t, S0, prof, feat, par, kappa_eff, side_up, seed):
    """log-price paths (npaths, nsteps) at the end of each sub-step, and the business-time decay factor per step."""
    cfg = SET[setname]
    dt, n = cfg['dt'], cfg['npaths']
    secs = np.arange(t + dt, cfg['flat_s'] + 1, dt)
    if secs[-1] != cfg['flat_s']:
        secs = np.r_[secs, cfg['flat_s']]
    steps = np.diff(np.r_[t, secs]).astype(float)
    mstep = np.clip((secs - 1) // 60 - 570, 0, 389)
    P = prof['P']
    var_unit = P[mstep] * steps / 60.0
    rng = np.random.default_rng(seed)
    a, b, c = par['coef']
    res = np.asarray(par['res'])
    lpt = a + b * feat['lp'] + c * feat['lt']
    Lp = np.exp(lpt + rng.choice(res, n))
    Lpoint = math.exp(lpt) * float(np.mean(np.exp(res)))
    Phold = var_unit.sum()
    sig_f = math.sqrt(Lpoint * Phold)
    mu = kappa_eff * sig_f * var_unit / Phold * (1.0 if side_up else -1.0)
    z = rng.choice(prof['z'], (n, len(secs)))
    sd = np.sqrt(Lp[:, None] * var_unit[None, :])
    inc = mu[None, :] + sd * z - 0.5 * sd * sd
    lS = math.log(S0) + np.cumsum(inc, 1)
    # business-time remaining variance to 16:00 at each step end vs at t
    cumP = np.r_[np.cumsum(P[::-1])[::-1], 0.0]  # cumP[m] = sum P[m:]

    def prem(sec):
        m = np.clip((np.asarray(sec) - 570 * 60) // 60, 0, 390)
        frac = ((np.asarray(sec) - 570 * 60) % 60) / 60.0
        return cumP[np.minimum(m + 1, 390)] + np.where(m < 390, P[np.minimum(m, 389)] * (1 - frac), 0.0)
    decay = prem(secs) / max(float(prem(t)), 1e-14)
    return lS, decay, {'Lpoint': Lpoint, 'sig_f': sig_f}


def er_contracts(setname, lS, decay, cands, rules=None):
    """Expected net return per $ risked for each candidate dict (K, call, W, ask, bid, h0, mid0, beta, hmin, scale)."""
    cfg = SET[setname]
    out = []
    for cd in cands:
        S = np.exp(lS) * cd['scale']
        mid = bs_mid(S, cd['K'], cd['W'] * decay[None, :], cd['call'])
        h = np.maximum(cd['hmin'], cd['h0'] * np.power(np.maximum(mid, 1e-9) / cd['mid0'], cd['beta']))
        bid = np.maximum(mid - h, 0.0)
        fill = cd['ask']
        peak = np.maximum(np.maximum.accumulate(bid, 1), cd['bid'])
        hit = bid <= cfg['stop'] * fill
        if cfg['kind'] == 'RT':
            hit |= (peak >= cfg['arm'] * fill) & (bid <= cfg['trail'] * peak)
        else:
            hit |= (np.maximum.accumulate(bid, 1) >= cfg['arm'] * fill) & (bid <= cfg['trail'] * peak)
        anyh = hit.any(1)
        j = np.where(anyh, hit.argmax(1), bid.shape[1] - 1)
        bx = bid[np.arange(bid.shape[0]), j]
        r = (100 * bx - FEE) / (100 * fill + FEE) - 1
        out.append(float(r.mean()))
    return out
