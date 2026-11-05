"""EDGE-R synthetic zero-drift null (PREREG): the full Model Risk sequencing on zero-drift paths at each real session's
5-minute RMS-return profile (10-second steps), ATM strike, BS at the real pick IV, the variant's real median entry
spread. 100 runs -> results/synthetic_null.json.   python3 synth_r.py [runs]"""
import glob
import json
import math
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from eval.metrics import cluster_ci_mean  # noqa: E402
import rmodel as M  # noqa: E402

RES = os.path.join(M.OUT, 'res')
STEP = {'SPXW': 5.0, 'SPY': 1.0, 'QQQ': 1.0}
VARS = ('R0', 'R1', 'R2')
PREOPEN = os.environ.get('EDGE_R_PREOPEN', '0') == '1'


def ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs(S, K, T, v, call):
    if T <= 0:
        return max(0.0, (S - K) if call else (K - S))
    sq = v * math.sqrt(T)
    d1 = (math.log(S / K) + (M.R + 0.5 * v * v) * T) / sq
    d2 = d1 - sq
    df = math.exp(-M.R * T)
    return S * ncdf(d1) - K * df * ncdf(d2) if call else K * df * ncdf(-d2) - S * ncdf(-d1)


def tyear(sec, dte):
    cash = max(0.0, sec / 60.0 - 570)
    return (max(0.0, M.SESSION_MIN - cash) + dte * M.SESSION_MIN) / (M.SESSION_MIN * M.YEAR_SESSIONS)


def profile(c):
    """per-minute sigma (log) from the real day's 5-minute RMS returns (consecutive printed minutes)."""
    idx = np.flatnonzero(np.isfinite(c))
    sig = np.full(1440, np.nan)
    if len(idx) < 3:
        return sig, idx
    r = np.diff(np.log(c[idx]))
    gap = np.diff(idx)
    r1 = r / np.sqrt(gap)
    blk = idx[1:] // 5
    df = pd.DataFrame({'b': blk, 'r2': r1 * r1})
    rms = np.sqrt(df.groupby('b').r2.mean())
    med = float(np.median(rms.values)) if len(rms) else 1e-4
    for m in range(idx[0], idx[-1] + 1):
        sig[m] = rms.get(m // 5, med)
    return sig, idx


def synth_path(c, rng):
    """(closes 1440, path10 [1440, 6]) zero-drift martingale in log space at the real profile."""
    sig, idx = profile(c)
    out = np.full(1440, np.nan)
    p10 = np.full((1440, 6), np.nan)
    if len(idx) < 3:
        return out, p10
    a, b = idx[0], idx[-1]
    n = b - a
    z = rng.standard_normal((n, 6)) * (sig[a + 1:b + 1, None] / math.sqrt(6))
    lp = math.log(c[a]) + np.cumsum(z.ravel()).reshape(n, 6)
    p10[a + 1:b + 1] = np.exp(lp)
    p10[a] = c[a]
    out[idx] = p10[idx, 5]
    out[a] = c[a]
    return out, p10


def break_sides(cs):
    """side per bar index (0 none, 1 call, -1 put), range hi/lo, from the last 30 printed closes."""
    idx = np.flatnonzero(np.isfinite(cs))
    side = np.zeros(1440, np.int8)
    hi = np.full(1440, np.nan)
    lo = np.full(1440, np.nan)
    if len(idx) <= M.TAIL_FIRST:
        return side, hi, lo
    v = pd.Series(cs[idx])
    h = v.rolling(M.TAIL_FIRST).max().shift(1).values
    l_ = v.rolling(M.TAIL_FIRST).min().shift(1).values
    px = cs[idx]
    hi[idx], lo[idx] = h, l_
    side[idx] = np.where(px > h, -1, np.where(px < l_, 1, 0))
    return side, hi, lo


def value_at(p10, sec):
    m = int(sec // 60)
    k = min(5, int((sec % 60) // 10))
    if m < 0 or m >= 1440:
        return np.nan
    x = p10[m, k]
    if not np.isfinite(x):
        prev = p10[:m + 1].ravel()
        prev = prev[np.isfinite(prev)]
        return prev[-1] if len(prev) else np.nan
    return x


def sim_day(info, paths, variant, iv, half, rng):
    day = info['day']
    exp = info['exp']
    C = {tk: paths[tk][0] for tk in M.TICKERS}
    P = {tk: paths[tk][1] for tk in M.TICKERS}
    BS_ = {tk: break_sides(C[tk]) for tk in M.TICKERS}
    last = {tk: np.maximum.accumulate(np.where(np.isfinite(C[tk]), np.arange(1440), -1)) for tk in M.TICKERS}
    spx = C['SPXW']
    fin = np.flatnonzero(np.isfinite(spx))
    spx_o = spx[fin[0]] if len(fin) else np.nan
    inst = sorted({(int(m) + 1) * 60 for tk in M.TICKERS for m in np.flatnonzero(np.isfinite(C[tk]))})
    taken, out = set(), []
    i, s = 0, (inst[0] if inst else None)
    while s is not None:
        m = s // 60 - 1
        got = None
        for tk in M.TICKERS:
            ix = int(last[tk][min(max(m, 0), 1439)]) if m >= 0 else -1
            if ix < 0:
                continue
            sd = int(BS_[tk][0][ix])
            if sd == 0:
                continue
            side = 'C' if sd == 1 else 'P'
            if variant == 'R2' and tk in M.NO_OVERNIGHT and s < M.OPEN_S + 60:
                continue
            if variant == 'R1' and len(fin):
                j = int(last['SPXW'][min(max(m, 0), 1439)])
                if j >= 0 and np.isfinite(spx_o):
                    pr = spx[:j][np.isfinite(spx[:j])][-30:]
                    if len(pr):
                        mv = spx[j] / spx_o - 1
                        if (side == 'C' and mv <= -M.DIR_MOVE and spx[j] < pr.min()) or \
                           (side == 'P' and mv >= M.DIR_MOVE and spx[j] > pr.max()):
                            continue
            stamp = s // 60
            for book in ('0', '1-7'):
                e = exp.get(tk, {}).get(book)
                if not e or (tk, book, side) in taken:
                    continue
                first = 570 if tk == 'SPXW' else 571
                if PREOPEN and tk in M.NO_OVERNIGHT:
                    first = 540
                last_stamp = 960 if book == '0' else 975
                if not (first <= stamp <= last_stamp):
                    continue
                if book == '0' and ix >= 960:
                    continue
                got = (tk, book, side, ix, e)
                break
            if got:
                break
        if got is None:
            j2 = np.searchsorted(inst, s, side='right')
            s = inst[j2] if j2 < len(inst) else None
            continue
        tk, book, side, ix, e = got
        taken.add((tk, book, side))
        dte = M.weekday_dte(day, e)
        call = side == 'C'
        c = C[tk]
        line = BS_[tk][2][ix] if call else BS_[tk][1][ix]
        eb = M.exit_bar(c, ix, line, side)
        spot = c[ix]
        K = round(spot / STEP[tk]) * STEP[tk]
        v = iv.get((tk, book), 0.2)
        h = half.get((tk, book), 0.01)
        end_d = M.CLOSE0_S if book == '0' else M.CLOSE17_S
        f = max(s + M.LAT, M.OPEN_S + M.LAT)
        if f >= end_d:
            s = (eb[0] + 1) * 60 if eb else None
            continue
        Sf = value_at(P[tk], f)
        fill = bs(Sf, K, tyear(f, dte), v, call) * (1 + h)
        if not (fill > 0.05):
            s = (eb[0] + 1) * 60 if eb else None
            continue
        sx = (eb[0] + 1) * 60 if eb else None
        stop = None
        if variant == 'R2':
            t_hi = min(sx if sx else end_d, end_d)
            t = f + 10 - (f % 10)
            while t < t_hi:
                b = bs(value_at(P[tk], t), K, tyear(t, dte), v, call) * (1 - h)
                if b <= M.STOP_FRAC * fill:
                    stop = t
                    break
                t += 10
        if stop is not None:
            ex = bs(value_at(P[tk], stop + 2), K, tyear(stop + 2, dte), v, call) * (1 - h)
            free = stop
        elif sx is not None and sx + M.LAT <= end_d:
            t = max(sx + M.LAT, M.OPEN_S + M.LAT)
            ex = bs(value_at(P[tk], t), K, tyear(t, dte), v, call) * (1 - h)
            free = sx
        elif book == '0':
            S = c[959] if np.isfinite(c[959]) else value_at(P[tk], 959 * 60 + 59)
            ex = max(0.0, (S - K) if call else (K - S))
            free = sx if sx else None
        else:
            lastv = value_at(P[tk], 1439 * 60)
            sig_d = float(np.sqrt(np.sum(np.diff(np.log(c[np.isfinite(c)])) ** 2)))   # the synthetic day's RV
            Sn = lastv * math.exp(rng.normal(0, 0.4 * sig_d))
            ex = bs(Sn, K, tyear(M.OPEN_S + 2, max(0, dte - 1)), v, call) * (1 - h)
            free = sx if sx else None
        pnl = (ex - fill) * 100 - M.FEE - (0 if (book == '0' and ex <= 0 and stop is None and not (sx and sx + 2 <= end_d)) else M.FEE)
        out.append(pnl / (fill * 100))
        if free is None:
            break
        s = max(int(free), s + 1)
        if s > inst[-1]:
            break
    return out


def main(runs=100, part=None):
    infos = []
    for f in sorted(glob.glob(os.path.join(RES, '*.json'))):
        r = json.load(open(f))
        infos.append(r)
    tr = pd.DataFrame([t for r in infos for t in r['trades']])
    tr = tr[tr.leg_ret_net.notna()]
    ivg = tr.groupby(['tk', 'book']).iv.median().to_dict()
    halfg = {}
    for v in VARS:
        x = tr[tr.variant == v]
        halfg[v] = (x.groupby(['tk', 'book']).leg_spr0.median() / 2).to_dict()
    ivd = tr[tr.variant == 'R0'].groupby(['day', 'tk', 'book']).iv.median().to_dict()
    if os.environ.get('EDGE_R_SYN_NOCOST') == '1':        # calibration: no spread, no fee -> mean should be ~0
        halfg = {v: {k: 0.0 for k in halfg[v]} for v in VARS}
        M.FEE = 0.0
    real = {}
    for r in infos:
        real[r['day']] = {tk: M.day_closes(tk, r['day'])[0] for tk in M.TICKERS}
    res = {v: {'means': [], 'pass': 0} for v in VARS}
    rng = np.random.default_rng(20261105 if part is None else 20261105 + 1000 * (part + 1))
    days = [r['day'] for r in infos]
    for run in range(runs):
        per = {v: ([], []) for v in VARS}
        for r in infos:
            paths = {tk: synth_path(real[r['day']][tk], rng) for tk in M.TICKERS}
            iv = {k: ivd.get((r['day'],) + k, ivg.get(k, 0.2)) for k in ivg}
            for v in VARS:
                rets = sim_day({'day': r['day'], 'exp': r['exp']}, paths, v, iv, halfg[v], rng)
                per[v][0].extend(rets)
                per[v][1].extend([r['day']] * len(rets))
        for v in VARS:
            x, cl = np.array(per[v][0]), np.array(per[v][1])
            if not len(x):
                continue
            res[v]['means'].append(float(x.mean()))
            lo, _ = cluster_ci_mean(x, cl, n_boot=300, extra_clusters=days)
            res[v]['pass'] += int(lo > 0)
            res[v].setdefault('n', []).append(len(x))
        if run % 10 == 9:
            print(run + 1, {v: (round(float(np.mean(res[v]['means'])) * 100, 2), int(np.mean(res[v]['n']))) for v in VARS}, flush=True)
    out = {}
    for v in VARS:
        mm = np.array(res[v]['means'])
        out[v] = {'runs': len(mm), 'mean': float(mm.mean()), 'p95': float(np.percentile(mm, 95)), 'fdr': res[v]['pass'] / max(1, len(mm)),
                  'n_mean': float(np.mean(res[v]['n'])), 'means': mm.tolist()}
    name = 'synthetic_null.json' if part is None else f'synthetic_null_part{part}.json'
    json.dump(out, open(os.path.join(HERE, 'results', name), 'w'))
    print({v: {k: out[v][k] for k in ('mean', 'p95', 'fdr', 'n_mean')} for v in VARS})


def merge():
    """combine synthetic_null_part*.json (parallel chunks, distinct seeds) into synthetic_null.json."""
    parts = sorted(glob.glob(os.path.join(HERE, 'results', 'synthetic_null_part*.json')))
    ps = [json.load(open(f)) for f in parts]
    out = {}
    for v in VARS:
        mm = np.array([m for p in ps for m in p[v]['means']])
        runs = sum(p[v]['runs'] for p in ps)
        fdr = sum(p[v]['fdr'] * p[v]['runs'] for p in ps) / max(1, runs)
        out[v] = {'runs': int(runs), 'mean': float(mm.mean()), 'p95': float(np.percentile(mm, 95)), 'fdr': fdr,
                  'n_mean': float(np.mean([p[v]['n_mean'] for p in ps])), 'means': mm.tolist(), 'parts': len(ps)}
    json.dump(out, open(os.path.join(HERE, 'results', 'synthetic_null.json'), 'w'))
    for f in parts:
        os.remove(f)
    print({v: {k: out[v][k] for k in ('runs', 'mean', 'p95', 'fdr', 'n_mean')} for v in VARS})


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'merge':
        merge()
    else:
        main(int(sys.argv[1]) if len(sys.argv) > 1 else 100, int(sys.argv[2]) if len(sys.argv) > 2 else None)
