"""Build the decision-point feature table (every 15 min, 10:00-15:00 ET) and the breakout event table per symbol.

  python3 scripts/build_features.py SPY QQQ SPX NVDA AAPL

Writes data/feat_<SYM>.npz and data/brk_<SYM>.npz. All windows and constants are fixed here, a priori.
"""
import sys, time
import numpy as np
from lib import (load_bars, returns, perm_entropy, sample_entropy, dfa_alpha, variance_ratio, efficiency_ratio,
                 lyapunov_rosenstein,
                 bands, phase_sync, mtf_agreement, PHASE_SCALES, DECISIONS, NBAR, DATA)
import os

PE_WIN = 120        # permutation / sample entropy window (1-min returns)
DFA_WIN = 240       # DFA / variance-ratio window
PH_WIN = 256        # phase window
LIQ_WIN = 60        # Amihud / Kyle window
EVENT_SIGMA = 2.5   # a "large move" is a next-60-min excursion beyond 2.5 sigma of the trailing-day 1-min vol * sqrt(60)


def build(sym):
    t0 = time.time()
    days, O, H, L, C, V = load_bars(sym)
    r = returns(O, C)
    valid = np.isfinite(r)
    flat_r = r[valid]
    flat_c = C[valid]
    flat_v = V[valid]
    pos = np.cumsum(valid.ravel()).reshape(valid.shape) - valid   # number of valid bars before (i, j)
    lp = np.cumsum(flat_r)
    bnd = bands(lp)
    has_vol = np.nansum(V) > 0
    dv = flat_c * flat_v

    rows = []
    for i in range(len(days)):
        for j in DECISIONS:
            p = pos[i, j]
            if p < 400 or not valid[i, j - 1]:
                continue
            fut = r[i, j:j + 60]
            rv_next60 = np.sqrt(np.sum(fut ** 2)) if np.all(np.isfinite(fut)) and len(fut) == 60 else np.nan
            if j + 30 <= NBAR and np.isfinite(C[i, j + 29]):
                ret_next30 = np.log(C[i, j + 29] / C[i, j - 1])
            else:
                ret_next30 = np.nan
            w60, w390 = flat_r[p - 60:p], flat_r[p - 390:p]
            sd390 = w390.std()
            if np.all(np.isfinite(fut)) and len(fut) == 60 and sd390 > 0:
                path = np.cumsum(fut)
                big = float(np.max(np.abs(path)) > EVENT_SIGMA * sd390 * np.sqrt(60))
            else:
                big = np.nan
            wpe = flat_r[p - PE_WIN:p]
            wd = flat_r[p - DFA_WIN:p]
            # critical slowing down: AR(1) and variance of the price residual (log price minus its 20-bar causal mean)
            seg = lp[p - 140:p]
            ma = np.convolve(seg, np.ones(20) / 20, 'valid')          # ma[k] = mean(seg[k:k+20])
            resid = seg[19:] - ma                                    # 121 values, each uses only past/current bars
            rec, pri = resid[-60:], resid[-120:-60]
            ar_rec = np.corrcoef(rec[:-1], rec[1:])[0, 1]
            ar_pri = np.corrcoef(pri[:-1], pri[1:])[0, 1]
            var_rise = np.log(np.var(flat_r[p - 60:p]) / np.var(flat_r[p - 120:p - 60]))
            R, D, RD = phase_sync([bnd[s][p - PH_WIN:p] for s in PHASE_SCALES])
            if has_vol:
                dvw = dv[p - LIQ_WIN:p]
                okv = dvw > 0
                ami = np.mean(np.abs(w60[okv]) / dvw[okv]) if okv.sum() > 20 else np.nan
                s = np.sign(w60[okv]) * np.sqrt(dvw[okv])
                kyle = np.cov(w60[okv], s)[0, 1] / np.var(s) if okv.sum() > 20 and np.var(s) > 0 else np.nan
                relvol = np.log((flat_v[p - 15:p].sum() + 1) / (flat_v[p - 390:p].sum() / 26 + 1))
            else:
                ami = kyle = relvol = np.nan
            rows.append((i, j, rv_next60, ret_next30, big,
                         np.log(np.sqrt(np.sum(w60 ** 2)) + 1e-12), np.log(np.sqrt(np.sum(w390 ** 2)) + 1e-12),
                         np.log(np.sqrt(np.sum(flat_r[p - 15:p] ** 2)) + 1e-12),
                         flat_r[p - 30:p].sum(), np.log(C[i, j - 1] / O[i, 0]),
                         perm_entropy(wpe, 3, 1), sample_entropy(wpe, 2, 0.2),
                         dfa_alpha(wd), variance_ratio(wd, 5), efficiency_ratio(w60),
                         ar_rec - ar_pri, var_rise, R, D, RD, mtf_agreement(flat_r[p - 64:p]),
                         np.log(ami) if ami and ami > 0 else np.nan, np.log(kyle) if kyle and kyle > 0 else np.nan,
                         relvol, sd390, lyapunov_rosenstein(wd)))
    cols = ['i', 'j', 'rv_next60', 'ret_next30', 'big', 'lrv60', 'lrv390', 'lrv15', 'past30', 'from_open',
            'pe', 'sampen', 'dfa', 'vr5', 'er60', 'csd_ar', 'csd_var', 'ph_R', 'ph_D', 'ph_RD', 'mtf',
            'amihud', 'kyle', 'relvol', 'sd390', 'lyap']
    A = np.array(rows, float)
    np.savez_compressed(os.path.join(DATA, f'feat_{sym}.npz'), A=A, cols=np.array(cols), days=np.array(days))
    print(sym, 'features', A.shape, f'{time.time() - t0:.0f}s', flush=True)
    build_breakouts(sym, days, O, H, L, C, V, r)


BOX = 60            # consolidation box: the trailing 60 one-minute bars
COMPRESS = 1.25     # box range < 1.25 * sigma1m * sqrt(60)  (Brownian E[range] ~ 1.6 sigma sqrt(n))
FAIL_WIN = 30


def build_breakouts(sym, days, O, H, L, C, V, r):
    """Escape velocity: first close outside a compressed 60-bar box. One event per day per side; 10:30-15:00 only."""
    ev = []
    sig_prev = None
    for i in range(1, len(days)):
        c, h, l, v = C[i], H[i], L[i], V[i]
        sd = np.nanstd(r[i - 1])                                   # prior session's 1-min vol (known at the open)
        if not np.isfinite(sd) or sd <= 0:
            continue
        done = set()
        for j in range(BOX, 331):
            if not np.isfinite(c[j]) or not np.isfinite(c[j + 30] if j + 30 < NBAR else np.nan):
                continue
            hi, lo = np.max(h[j - BOX:j]), np.min(l[j - BOX:j])
            rng = np.log(hi / lo)
            if rng >= COMPRESS * sd * np.sqrt(BOX):
                continue
            side = 1 if c[j] > hi else (-1 if c[j] < lo else 0)
            if side == 0 or side in done:
                continue
            done.add(side)
            edge = hi if side > 0 else lo
            z1 = side * r[i, j] / sd                                         # the breakout bar alone (baseline)
            z5 = side * np.log(c[j] / c[j - 5]) / (sd * np.sqrt(5))           # 5-bar velocity
            vol_box = np.nanmean(v[j - BOX:j])
            rel = (np.nanmean(v[j - 4:j + 1]) / vol_box) if vol_box > 0 else np.nan
            esc = z5 * np.sqrt(rel) if np.isfinite(rel) and rel > 0 else np.nan  # "escape velocity" = velocity * sqrt(mass)
            pen = side * np.log(c[j] / edge) / (sd * np.sqrt(BOX))               # how far past the edge, in box units
            fwd = side * np.log(c[j + 30] / c[j]) / sd                           # continuation, in 1-min sigmas
            fwd_bps = side * np.log(c[j + 30] / c[j]) * 1e4
            back = side * (np.log(c[j + 1:j + 1 + FAIL_WIN] / edge))
            failed = float(np.any(back < 0))                                  # closes back inside the box within 30 min
            ev.append((i, j, side, z1, z5, rel, esc, pen, rng / (sd * np.sqrt(BOX)), fwd, fwd_bps, failed))
    cols = ['i', 'j', 'side', 'z1', 'z5', 'relvol', 'esc', 'pen', 'compress', 'fwd_sig', 'fwd_bps', 'failed']
    E = np.array(ev, float)
    np.savez_compressed(os.path.join(DATA, f'brk_{sym}.npz'), A=E, cols=np.array(cols), days=np.array(days))
    print(sym, 'breakouts', E.shape, flush=True)


if __name__ == '__main__':
    for s in sys.argv[1:] or ['SPY']:
        build(s)
