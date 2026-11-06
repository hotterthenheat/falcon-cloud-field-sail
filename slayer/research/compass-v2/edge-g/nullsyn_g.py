"""EDGE-G N3 synthetic zero-drift null (PREREG): 100 runs, every variant.

Per root-session and run: the underlying re-simulated at the real day's 5-minute RMS profile with zero drift (1-minute
bars from 10-second sub-steps); the triggers recomputed on it from the REAL book (R1: the real crossings of each minute,
held with stickFlip at the synthetic spot, the regime from the real net and the crossings passed; R2: the real legs
within +-4% re-priced at the synthetic spot; R3: synthetic RV so far vs the real ATM IV); the option priced
Black-Scholes at the real IV on the trading clock, bid/ask = model mid -+ the real median entry half-spread of the
root and cell; the same exits on the 10-second grid (+1 step latency).
  python3 nullsyn_g.py [runs] [workers]   -> results/synthetic_null.json
"""
import json, math, os, sys, time, zlib
import numpy as np
import pandas as pd
from common import OUT, YEAR_MIN, dev_sessions, has_chain, ROOTS
import book as B
import signals_g as G
import gex
from eval_helpers import cluster_lo

sim = B.sim
HERE = os.path.dirname(os.path.abspath(__file__))
STEP = 10
OPEN_S = 9 * 3600 + 30 * 60
NSTEP = 390 * 6
CELLS = {'0D30': (0, 0.30), '0D45': (0, 0.45), '1D45': (1, 0.45)}
VARS = ['R1A', 'R1B', 'R2-CLEAR', 'R2-BLOCKED', 'R3', 'BASE-XA', 'BASE-XB']
SQ2 = math.sqrt(2.0)


def ncdf(x):
    from scipy.special import ndtr
    return ndtr(x)


def bs(S, K, T, v, call):
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    d2 = d1 - sq
    c = S * ncdf(d1) - K * ncdf(d2)
    return np.where(call, c, c - S + K)


def strike_for_delta(S, T, v, call, target):
    from scipy.special import ndtri
    sq = v * math.sqrt(T)
    d1 = ndtri(target) if call else -ndtri(target)
    return S * math.exp(-(d1 * sq - 0.5 * sq * sq))


def paths(bars, n, rng):
    c = bars.c.values
    o = float(bars.o.iloc[0])
    r = np.diff(np.log(np.r_[o, c]))
    var = pd.Series(r * r).rolling(5, center=True, min_periods=1).mean().values
    var = np.r_[var, np.full(max(0, 390 - len(var)), var[-1])][:390]
    sub = np.repeat(var / 6.0, 6)
    z = rng.standard_normal((n, NSTEP))
    inc = np.sqrt(sub)[None, :] * z - sub[None, :] / 2
    S10 = o * np.exp(np.cumsum(inc, axis=1))          # value at the END of each 10-s step
    closes = S10[:, 5::6]                             # minute bar closes (bar m closes at the 6th sub-step)
    return S10, closes


def spot_before(closes, t):
    i = t // 60 - 1 - 570
    return closes[:, i] if i >= 0 else np.full(closes.shape[0], np.nan)


def rv_so_far(closes, t):
    i = t // 60 - 1 - 570
    x = closes[:, :i + 1]
    if x.shape[1] < 6:
        return np.full(closes.shape[0], np.nan)
    lr = np.diff(np.log(x), axis=1)
    return lr.std(axis=1, ddof=1) * math.sqrt(YEAR_MIN)


def held_flips(z, closes):
    """Vectorised stickFlip over paths; returns held flip (paths x reads), regime sign (house>0) at the synthetic spot."""
    n = closes.shape[0]
    T = z['t']
    nc = z['ncross']
    cx = z['cross']
    off = np.r_[0, np.cumsum(nc)]
    held = np.full((n, len(T)), np.nan)
    short = np.zeros((n, len(T)), bool)
    kept = np.full(n, np.nan)
    since = np.full(n, np.nan)
    reads = np.zeros(n)
    for i, t in enumerate(T):
        X = cx[off[i]:off[i + 1]]
        S = spot_before(closes, int(t))
        Sr = z['S'][i]
        # regime at S: real sign flipped once per crossing passed between the real and the synthetic spot
        if len(X):
            passed = ((X[None, :] - Sr) * (X[None, :] - S[:, None]) < 0).sum(axis=1)
        else:
            passed = np.zeros(n, int)
        short[:, i] = ((z['net_all'][i] > 0) ^ (passed % 2 == 1))
        if not len(X):
            raw = np.full(n, np.nan)
        else:
            raw = X[np.argmin(np.abs(X[None, :] - S[:, None]), axis=1)]
        tol = 0.004 * S
        flip = raw.copy()
        has = np.isfinite(kept)
        if len(X) and has.any():
            near = X[np.argmin(np.abs(X[None, :] - np.where(has, kept, 0)[:, None]), axis=1)]
        else:
            near = np.full(n, np.nan)
        ok = has & np.isfinite(near) & (np.abs(near - kept) <= tol)
        miss = has & ~ok
        newk = np.where(ok, near, raw)
        since = np.where(miss, np.where(np.isfinite(since), since, t * 1000.0), np.nan)
        reads = np.where(miss, reads + 1, 0)
        give = miss & (reads >= 3) & (t * 1000.0 - since >= 120000)
        flip = np.where(ok, near, np.where(miss, np.where(give, raw, near), raw))
        newk = np.where(miss & ~give, kept, newk)
        since = np.where(give, np.nan, since)
        reads = np.where(give, 0, reads)
        kept = newk
        held[:, i] = flip
    return held, short


def walls_dist(z, t, S, side):
    """Distance (price) to the largest |net| strike beyond S in the side's direction, real legs at the mark re-priced at S."""
    k, noi, iv, T = (z.get(f'm{t}_{x}') for x in ('k', 'noi', 'iv', 'T'))
    if k is None or not np.size(k):
        return np.full(len(S), np.inf)
    g = noi[None, :] * gex.dollar_gamma_per_contract(S[:, None], k[None, :], T[None, :], iv[None, :])
    ks = np.unique(k)
    ix = np.searchsorted(ks, k)
    oh = np.zeros((len(k), len(ks)))
    oh[np.arange(len(k)), ix] = 1.0
    net = g @ oh
    out = np.full(len(S), np.inf)
    for p in range(len(S)):
        m = (ks > S[p]) if side[p] > 0 else (ks < S[p])
        m &= np.abs(ks / S[p] - 1) <= 0.10
        if m.any():
            out[p] = abs(ks[m][np.argmax(np.abs(net[p, m]))] - S[p])
    return out


def trade(S10, j, t, side, cell, atm, iv_cell, half, fam, D_kind, rv, b=None, held=None, tvec=None, closes=None):
    dte, target = CELLS[cell]
    day_T = lambda sec: max((960 - sec / 60.0), 5) / YEAR_MIN  # noqa: E731
    i0 = (t + 2 - OPEN_S + STEP - 1) // STEP
    if i0 >= NSTEP:
        return None
    S0 = S10[j, i0 - 1]
    extra = 390.0 * dte_sessions(dte)
    T0 = day_T(t) + extra / YEAR_MIN
    v = iv_cell if dte else atm
    call = side > 0
    K = strike_for_delta(S0, T0, v, call, target)
    hold = 3600 if fam != 'XB' else 5400
    i_end = min((min(t + hold, 15 * 3600 + 50 * 60) - OPEN_S) // STEP + 1, NSTEP - 1)
    secs = OPEN_S + STEP * np.arange(i0, i_end + 1)
    Tt = np.maximum((960 - secs / 60.0), 5) / YEAR_MIN + extra / YEAR_MIN
    mid = bs(S10[j, i0 - 1:i_end], K, Tt, v, call)
    h = half * mid[0]
    bid = np.maximum(mid - h, 0)
    fill = mid[0] + h
    if fill <= 0.01:
        return None
    delta = target
    if fam == 'XB':
        D = min(max(1.5 * delta * S0 * rv * math.sqrt(15 / YEAR_MIN), 0.15 * fill), 0.50 * fill)
        peak = np.maximum(fill, np.maximum.accumulate(bid))
        hit = np.flatnonzero(bid[1:] <= peak[1:] - D)
        k = 1 + int(hit[0]) + 1 if len(hit) else len(bid) - 1
        px = bid[min(k, len(bid) - 1)]
    else:
        D = min(max(1.0 * delta * S0 * atm * math.sqrt(30 / YEAR_MIN), 0.20 * fill), 0.50 * fill)
        tp = np.flatnonzero(bid[1:] >= 1.5 * fill)
        st = np.flatnonzero(bid[1:] <= fill - D)
        ktp = 1 + int(tp[0]) if len(tp) else 10 ** 9
        kst = 1 + int(st[0]) + 1 if len(st) else 10 ** 9
        krc = 10 ** 9
        if fam == 'XA_RC':
            for tm in range((t // 60 + 1) * 60, min(t + hold, 15 * 3600 + 50 * 60) + 1, 60):
                ii = np.flatnonzero(tvec == tm)
                F = held[j, ii[0]] if len(ii) else held[j, -1]
                Sx = closes[j, tm // 60 - 1 - 570]
                if np.isfinite(F) and side * (Sx - F) <= -b:
                    krc = (tm - OPEN_S) // STEP - i0 + 1
                    break
        k = min(ktp, kst, krc, len(bid) - 1)
        px = 1.5 * fill if k == ktp else bid[min(k, len(bid) - 1)]
    pnl = 100 * (px - fill) - 1.30
    return pnl / (100 * fill + 0.65)


_DS = {}


def dte_sessions(dte):
    return 1 if dte else 0  # 1-7 DTE cell: the next expiry, ~1 session out (edge-r boards: 1 DTE in 69% of sessions)


def run_session(root, day, runs, half, ivc):
    z = G.load_book(root, day)
    if z is None:
        return {}
    bars = sim.day_bars(root, day)
    if len(bars) < 389:
        return {}
    rng = np.random.default_rng(zlib.crc32(f'{root}|{day}'.encode()))
    S10, closes = paths(bars, runs, rng)
    held, short = held_flips(z, closes)
    T = z['t']
    out = {}  # (var, cell) -> list of (run, ret)

    def add(var, cell, j, r):
        if r is not None and np.isfinite(r):
            out.setdefault((var, cell), []).append((j, r))
    # R1A
    last = np.zeros(runs); last_f = np.full(runs, np.nan); done = np.zeros(runs, bool)
    for i, t in enumerate(T):
        t = int(t)
        if t < G.R1A_FROM or t > G.R1A_TO:
            continue
        S = spot_before(closes, t)
        F = held[:, i]
        atm = z['atm'][i]
        b = 0.10 * S * atm * math.sqrt(60 / YEAR_MIN)
        far = np.isfinite(F) & (np.abs(S - F) >= b)
        cur = np.where(S > F, 1, -1)
        trig = far & ~done & (last != 0) & (cur != last) & (np.abs(F - last_f) <= 0.004 * S) & short[:, i]
        for j in np.flatnonzero(trig):
            for cell in CELLS:
                add('R1A', cell, j, trade(S10, j, t, int(cur[j]), cell, atm, ivc.get(cell, atm), half[cell], 'XA_RC', None, None,
                                         b=float(b[j]), held=held, tvec=T, closes=closes))
        done |= trig
        upd = far & ~done
        last = np.where(upd, cur, last)
        last_f = np.where(upd, F, last_f)
    # R1B and BASE at the marks
    r1b_done = np.zeros(runs, bool)
    for t in B.MARKS:
        ii = np.flatnonzero(T == t)
        if not len(ii):
            continue
        i = int(ii[0])
        S = spot_before(closes, t)
        atm = z['atm'][i]
        e1 = S * atm * math.sqrt(60 / YEAR_MIN)
        F = held[:, i]
        d = F - S
        ok = np.isfinite(F) & (np.abs(d) >= 0.25 * e1) & (np.abs(d) <= 1.5 * e1) & ~r1b_done
        for j in np.flatnonzero(ok):
            for cell in CELLS:
                add('R1B', cell, j, trade(S10, j, t, 1 if d[j] > 0 else -1, cell, atm, ivc.get(cell, atm), half[cell], 'XA', None, None))
        r1b_done |= ok
        S30 = spot_before(closes, t - 1800)
        r30 = np.log(S / S30)
        thr = atm * math.sqrt(30 / YEAR_MIN)
        bse = np.abs(r30) >= thr
        if not bse.any():
            continue
        side = np.where(r30 > 0, 1, -1)
        jj = np.flatnonzero(bse)
        dW = walls_dist(z, t, S[jj], side[jj])
        rv = rv_so_far(closes, t)
        for q, j in enumerate(jj):
            clear, blocked = dW[q] >= 1.0 * e1[j], dW[q] < 0.5 * e1[j]
            r3 = np.isfinite(rv[j]) and rv[j] / atm >= 1.25
            for cell in CELLS:
                ra = trade(S10, j, t, int(side[j]), cell, atm, ivc.get(cell, atm), half[cell], 'XA', None, None)
                rb = trade(S10, j, t, int(side[j]), cell, atm, ivc.get(cell, atm), half[cell], 'XB', None, float(rv[j]) if np.isfinite(rv[j]) else atm)
                add('BASE-XA', cell, j, ra); add('BASE-XB', cell, j, rb)
                if clear:
                    add('R2-CLEAR', cell, j, ra)
                if blocked:
                    add('R2-BLOCKED', cell, j, ra)
                if r3:
                    add('R3', cell, j, rb)
    return out


def _w(a):
    root, day, runs, half, ivc = a
    try:
        return root, day, run_session(root, day, runs, half, ivc)
    except Exception as e:  # noqa: BLE001
        return root, day, {'error': repr(e)[:200]}


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    nw = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    summ = json.load(open(os.path.join(HERE, 'results', 'summary.json')))['variants']
    real = pd.read_parquet(os.path.join(OUT, 'trades_real.parquet'))
    half = {c: float(real[real.cell == c].spr_fill.median() / 2) for c in CELLS}
    ivc_by = real[real.cell == '1D45'].groupby(['root', 'day']).iv.median().to_dict()
    jobs = []
    for d in dev_sessions():
        for r in ROOTS:
            if has_chain(r, d):
                jobs.append((r, d, runs, half, {'1D45': ivc_by.get((r, d))} if (r, d) in ivc_by else {}))
    from multiprocessing import Pool
    acc = {}  # (var, cell) -> run -> list of (day, ret)
    t0 = time.time()
    with Pool(nw) as pool:
        for k, (root, day, res) in enumerate(pool.imap_unordered(_w, jobs, chunksize=4)):
            if 'error' in res:
                print('ERR', root, day, res['error'], flush=True)
                continue
            for (var, cell), lst in res.items():
                a = acc.setdefault(f'{var}|{cell}', {})
                for j, r in lst:
                    a.setdefault(j, []).append((day, r))
            if k % 200 == 0:
                print(time.strftime('%H:%M:%S'), k, len(jobs), f'{time.time() - t0:.0f}s', flush=True)
    out = {}
    for key, byrun in acc.items():
        means, passes = [], 0
        for j in range(runs):
            lst = byrun.get(j, [])
            if len(lst) < 5:
                continue
            days, rr = zip(*lst)
            rr = np.array(rr)
            means.append(rr.mean())
            passes += cluster_lo(rr, days) > 0
        means = np.array(means)
        rm = summ.get(key, {}).get('exp', float('nan'))
        out[key] = {'runs': int(len(means)), 'null_mean': float(means.mean()) if len(means) else float('nan'),
                    'null_p95': float(np.percentile(means, 95)) if len(means) else float('nan'),
                    'beats': float((means < rm).mean()) if len(means) and np.isfinite(rm) else float('nan'),
                    'fdr': passes / max(1, len(means)), 'n_per_run': float(np.mean([len(byrun.get(j, [])) for j in range(runs)]))}
    json.dump(out, open(os.path.join(HERE, 'results', 'synthetic_null.json'), 'w'), indent=1)
    for k, v in sorted(out.items()):
        print(k, v)


if __name__ == '__main__':
    main()
