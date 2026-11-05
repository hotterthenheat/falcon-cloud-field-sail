"""Synthetic zero-drift null (anti-bias 11b) for EDGE-T's H1, H2 and H3 cells.

Per DEV root-session of the real run: the underlying is re-simulated at 10-second steps from the real day's open at
the real day's 1-minute realised vol with ZERO drift (EDGE's nullsyn generator; H1/H2 triggers are relative to the
open, so no overnight gap is needed). Triggers are recomputed on the synthetic bars (H1: the root's own path, A1
shift included; H2: RULES.md on the root's own synthetic path, standing in for SPX). The contract is the strike
nearest the target |delta| (0.15-0.50) at the real ATM IV of that day (flat smile), Black-Scholes prices, quoted
with the variant's real median entry spread (always 'sane', so raw = sane here); entry at the ask 10 s after the
decision, RT / H3 exits on the 10-second grid, exit at the bid one step after the decision; fee as real.

  python3 nullsyn_t.py [reps]  -> results/synthetic_null.json (null expectancies per variant + CI-pass rate)
"""
import json, math, os, sys
import numpy as np
from scipy.special import ndtr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
import sim  # noqa: E402
import ht  # noqa: E402

STEP = 10
NS = 390 * 60 // STEP          # 2340 steps 09:30:00..16:00:00
FLAT_I = (ht.FLAT_S - 34200) // STEP


def bs(S, K, T, v, call):
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    c = S * ndtr(d1) - K * ndtr(d1 - sq)
    return np.maximum(np.where(call, c, c - S + K), 0.0)


def bsdelta(S, K, T, v, call):
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    n = ndtr(d1)
    return np.where(call, n, n - 1)


def infos(have):
    f = os.path.join(ht.OUT, 'null_info.json')
    if os.path.exists(f):
        return json.load(open(f))
    out = []
    for rec in have.values():
        root, day = rec['root'], rec['day']
        bars = ht.day_bars(root, day)
        lr = np.diff(np.log(bars.c.values))
        S1 = sim.spot_at(bars, ht.H1_T[1])
        S2 = sim.spot_at(bars, 36000)
        iv1 = atm(root, day, ht.H1_T[1], S1)
        iv2 = atm(root, day, 36000, S2)
        if not (np.isfinite(iv1) and np.isfinite(iv2)) or rec.get('sig') is None:
            continue
        # A2: per-minute vol from the real 5-minute RMS profile (first return = 09:30 bar close / open)
        r1 = np.concatenate([[math.log(bars.c.iloc[0] / bars.o.iloc[0])], lr])
        full = np.full(390, np.nan)
        mm = bars.m.values - 570
        full[mm[(mm >= 0) & (mm < 390)]] = r1[:len(mm)][(mm >= 0) & (mm < 390)]
        blk = np.sqrt(np.nanmean(full.reshape(78, 5) ** 2, 1))
        blk = np.where(np.isfinite(blk) & (blk > 0), blk, float(np.std(lr, ddof=1)))
        out.append({'root': root, 'day': day, 'O': float(bars.o.iloc[0]), 's1m': float(np.std(lr, ddof=1)), 'sig': rec['sig'],
                    'iv1': iv1, 'iv2': iv2, 'rv5': blk.tolist()})
    json.dump(out, open(f, 'w'))
    return out


def atm(root, day, t, S):
    b = sim.board(root, day, t)
    if b is None or not np.isfinite(S):
        return np.nan
    b = b[(b.bid > 0) & (b.ask > b.bid)]
    if not len(b):
        return np.nan
    T = max(960 - t / 60.0, 1.0) / sim.YEAR_MIN
    k = b.k.values[np.argmin(np.abs(b.k.values - S))]
    x = b[b.k == k]
    v = sim.implied_vol((x.bid.values + x.ask.values) / 2, S, x.k.values, T, x.r.values == 1)
    v = v[np.isfinite(v)]
    return float(v.mean()) if len(v) else np.nan


def path(rng, info, mode='flat'):
    if mode == 'flat':   # registered: EDGE's generator, the day's 1-minute vol everywhere
        s10 = info['s1m'] / math.sqrt(60 / STEP)
    else:                # A2: the real 5-minute RMS profile (each 1-min vol repeated over its 6 ten-second steps)
        s10 = np.repeat(np.asarray(info['rv5']), 5 * 60 // STEP) / math.sqrt(60 / STEP)
    lp = math.log(info['O']) + np.concatenate([[0], np.cumsum(rng.normal(-0.5 * s10 * s10, s10, NS))])
    S = np.exp(lp)
    per = 60 // STEP
    seg = S[:NS].reshape(390, per)
    c = S[per::per][:390]
    h = np.maximum(seg.max(1), c)
    l = np.minimum(seg.min(1), c)
    return S, h, l, c


def strike(S, T, iv, call, tgt, step):
    ks = np.round(S / step) * step + step * np.arange(-60, 61)
    dl = np.abs(bsdelta(S, ks, T, iv, call))
    ok = (dl >= 0.15) & (dl <= 0.50)
    if not ok.any():
        return None
    return float(ks[np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]])


def trade(S, c, t, call, tgt, iv, spr, step, cells):
    """{cell: ret_fee} for one synthetic trade decided at t."""
    i0 = (t - 34200) // STEP
    T0 = max(960 - t / 60.0, 1) / sim.YEAR_MIN
    K = strike(S[i0], T0, iv, call, tgt, step)
    if K is None:
        return None, None
    idx = np.arange(i0 + 1, FLAT_I + 2)
    tsec = 34200 + idx * STEP
    T = np.maximum(960 - tsec / 60.0, 0.05) / sim.YEAR_MIN
    mid = bs(S[idx], K, T, iv, call)
    bid, ask = mid * (1 - spr / 2), mid * (1 + spr / 2)
    fill = float(ask[0])
    if fill < 0.05:
        return None, None
    b = bid[1:-1]                     # checks at t+20 .. 15:50 (the last one is the flat decision)
    tb = tsec[1:-1]
    pk = np.maximum.accumulate(np.maximum(b, bid[0]))
    out = {}
    exit_s = None
    for name, (pr, rv) in cells.items():
        hit = b <= (1 - ht.STOP) * fill
        if pr == 'TR':
            hit = hit | ((pk >= (1 + ht.ARM) * fill) & (b <= (1 - ht.TRAIL) * pk))
        x = np.flatnonzero(hit[:-1])
        j = int(x[0]) if len(x) else len(b) - 1
        if rv:
            for jj in range(0, j):
                if tb[jj] % 60 == 0:
                    mm = tb[jj] // 60
                    if mm - 6 >= 570:
                        r5 = c[mm - 1 - 570] / c[mm - 6 - 570] - 1
                        if (r5 <= -ht.REVERSAL) if call else (r5 >= ht.REVERSAL):
                            j = jj
                            break
        xb = float(bid[min(j + 2, len(bid) - 1)])   # bid one step after the decision
        if pr == 'TP':
            tgt_px = math.ceil(fill * 150 - 1e-6) / 100.0
            y = np.flatnonzero(b[:j + 1] >= tgt_px)
            if len(y):
                xb = tgt_px
        out[name] = (xb * 100 - sim.FEE) / (fill * 100 + sim.FEE) - 1
        if name == 'RT':
            exit_s = int(tb[min(j + 1, len(tb) - 1)])
    return out, exit_s


def run(reps=100, seed=7, mode='flat'):
    have = {k: v for k, v in json.load(open(os.path.join(ht.OUT, 'dev.json'))).items() if v}
    inf = infos(have)
    summ = json.load(open(os.path.join(HERE, 'results', 'summary.json')))
    spr = {}
    import analyze_t as A
    for v in A.H1V:
        s = [t['spr0'] for t in [a for a, *_ in A.h1_pairs(have, v) if a]]
        spr[f'H1-{v}'] = float(np.median(s)) if s else 0.05
    for v in A.H2V:
        s = [t['spr0'] for t in [a for a, *_ in A.h2_pairs(have, v) if a]]
        spr[f'H2-{v}'] = float(np.median(s)) if s else 0.05
    h3 = {ht.cell_name(*c): (c[0], c[1]) for c in ht.H3_CELLS}
    rng = np.random.default_rng(seed)
    res = {k: [] for k in list(spr) + list(h3)}
    ns = {k: [] for k in res}
    for rep in range(reps):
        trs = {k: [] for k in res}
        for info in inf:
            S, h, l, c = path(rng, info, mode)
            step = 5.0 if info['root'] == 'SPXW' else 1.0
            O = S[0]
            # H1
            first = {}
            for t in ht.H1_T:
                r = c[(t - 60) // 60 - 570] / O - 1
                for k in ht.H1_K:
                    if k not in first and abs(r) >= k * info['sig']:
                        first[k] = (t, r > 0)
            for k, (t, up) in first.items():
                if t == ht.H1_T[0]:
                    t = ht.H1_T[1]
                for d in ht.DELTAS:
                    v = f'H1-k{k:.2f}-d{d:.2f}'
                    cells = {'RT': ('TR', False)}
                    if k == 0.30 and d == 0.35:
                        cells.update(h3)
                    o, _ = trade(S, c, t, up, d, info['iv1'], spr[v], step, cells)
                    if o:
                        trs[v].append({'day': info['day'], 'ret_fee': o['RT']})
                        if k == 0.30 and d == 0.35:
                            for n in h3:
                                trs[n].append({'day': info['day'], 'ret_fee': o[n]})
            # H2 (RULES.md on the root's own synthetic path)
            for d in (0.35, 0.20):
                v = f'H2-d{d:.2f}'
                free = 0
                for t in ht.H2_MARKS:
                    if t < free:
                        continue
                    last = (t - 60) // 60 - 570
                    spot = c[last]
                    hi, lo = max(h[:last + 1].max(), spot), min(l[:last + 1].min(), spot)
                    mv = spot / O - 1
                    up = None
                    if mv <= -0.015 and spot <= lo * 1.0035:
                        up = False
                    elif mv >= 0.015 and spot >= hi * (1 - 0.0035):
                        up = True
                    if up is None:
                        continue
                    o, xs = trade(S, c, t, up, d, info['iv2'], spr[v], step, {'RT': ('TR', False)})
                    if o:
                        trs[v].append({'day': info['day'], 'ret_fee': o['RT']})
                        free = xs
        for k in res:
            e, lo_, hi_ = sim.boot(trs[k], 'ret_fee', n=300, seed=rep) if trs[k] else (np.nan, np.nan, np.nan)
            res[k].append((e, lo_))
            ns[k].append(len(trs[k]))
        if rep % 10 == 0:
            print(rep, {k: (round(res[k][-1][0], 3) if np.isfinite(res[k][-1][0]) else None, ns[k][-1]) for k in list(res)[:6]}, flush=True)
    out = {}
    for k in res:
        ex = np.array([e for e, _ in res[k]], float)
        real = summ.get(k, {}).get('exp')
        out[k] = {'reps': reps, 'n_mean': float(np.mean(ns[k])), 'null_mean': float(np.nanmean(ex)) if np.isfinite(ex).any() else None,
                  'null_p95': float(np.nanpercentile(ex, 95)) if np.isfinite(ex).any() else None,
                  'fdr': float(np.mean([lo_ > 0 for _, lo_ in res[k]])), 'spread': spr.get(k),
                  'real': real, 'beats': float(np.mean(ex[np.isfinite(ex)] < real)) if real is not None and np.isfinite(ex).any() else None}
    f = os.path.join(HERE, 'results', 'synthetic_null.json')
    allm = json.load(open(f)) if os.path.exists(f) else {}
    allm[mode] = out
    json.dump(allm, open(f, 'w'), indent=1)
    print(json.dumps({k: (v['n_mean'], v['null_mean'], v['beats'], v['fdr']) for k, v in out.items()}, indent=1))


if __name__ == '__main__':
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 100, mode=sys.argv[2] if len(sys.argv) > 2 else 'flat')
