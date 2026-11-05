"""Synthetic zero-drift null (anti-bias 11b) for E1-E3.

For every session/root the real test traded (or could have: every root-session with bars and a chain), the
underlying is re-simulated at 10-second steps from the real day's 1-minute realised vol with ZERO drift (overnight
gap from a normal with 0.4 x the prior 20-day vol), the trigger is recomputed on the synthetic bars, the contract
is the strike nearest the target delta at the real ATM IV (flat smile), priced by Black-Scholes with that IV, quoted
with the real median entry spread of the hypothesis, entered at the ask 10 s after the decision (>= the 2 s
latency), and exited by the same rules on the 10-second grid at the bid 10 s after the decision. Fee as real.

  python3 nullsyn.py E1 DEV z0.5-X2 [reps]
Prints the null distribution of the variant's expectancy and the fraction of runs that 'pass' (CI excludes 0).
"""
import json, math, os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import hyp

STEP = 10


def sessions_info(H, which):
    """Per root-session: the real day's 1-min vol, prior close, 20-day vol, real ATM IV near the decision, gex."""
    f = os.path.join(sim.ROOT, 'results', f'null_info_{H}_{which}.json')
    if os.path.exists(f):
        return json.load(open(f))
    have = json.load(open(os.path.join(sim.ROOT, 'results', f'{H}_{which}.json')))
    t_ref = {'E1': 15 * 3600 + 25 * 60, 'E2': 10 * 3600, 'E3': 10 * 3600, 'E6': 15 * 3600}[H]
    out = []
    import fetch as F
    for d in F.want_days(which):
        for root in F.ROOTS:
            if d not in F.expirations(root) or sim.chain(root, d) is None:
                continue
            bars = sim.day_bars(root, d)
            if len(bars) < 300:
                continue
            pc, sd = sim.prior_close_and_vol(root, d)
            if not np.isfinite(sd):
                continue
            lr = np.diff(np.log(bars.c.values))
            s1m = float(np.std(lr, ddof=1))
            S = sim.spot_at(bars, t_ref)
            iv = hyp.atm_iv(root, d, t_ref, S)
            if not np.isfinite(iv):
                continue
            rec = have.get(f'{root}|{d}') or {}
            g = (rec.get('trig') or {}).get('gex', np.nan) if H == 'E3' else np.nan
            if H == 'E3' and not rec:
                o = sim.day_bars(root, d)
                g = hyp.gex(root, d, float(o.c.iloc[29]), hyp.atm_iv(root, d, 600 * 60, float(o.c.iloc[29])))
            K = hyp.pin_strike(root, d, S) if H == 'E6' else np.nan
            out.append({'root': root, 'day': d, 'pc': pc, 'sd': sd, 's1m': s1m, 'iv': iv, 'gex': g, 'K': K})
    json.dump(out, open(f, 'w'))
    return out


def median_spread(H, which):
    have = json.load(open(os.path.join(sim.ROOT, 'results', f'{H}_{which}.json')))
    sp = [s['sel']['spr0'] for r in have.values() if r for s in r['sides'].values() if s and s.get('sel')]
    return float(np.median(sp)) if sp else 0.04


def sim_day(rng, info):
    """10-second synthetic path 09:30:00..16:00:00 and its 1-minute bars."""
    n = 390 * 60 // STEP
    s10 = info['s1m'] / math.sqrt(60 / STEP)
    gap = rng.normal(0, 0.4 * info['sd'])
    lp = math.log(info['pc']) + gap + np.concatenate([[0], np.cumsum(rng.normal(-0.5 * s10 * s10, s10, n))])
    S = np.exp(lp)  # S[i] at 09:30 + i*STEP
    per = 60 // STEP
    m = np.arange(570, 960)
    o = S[:-1:per][:390]
    c = S[per::per][:390]
    seg = S[:390 * per].reshape(390, per)
    h = np.maximum(seg.max(1), c)
    l = np.minimum(seg.min(1), c)
    bars = pd.DataFrame({'m': m, 'o': o, 'h': h, 'l': l, 'c': c})
    return S, bars


def trigger(H, bars, info):
    if H == 'E1':
        t = 15 * 3600 + 25 * 60
        S = float(bars.c.values[924 - 570])
        r = math.log(S / info['pc'])
        z = abs(r) / info['sd']
        if z < 0.5:
            return None
        w = bars.c.values[900 - 570:925 - 570]
        return {'t': t, 't_end': 15 * 3600 + 58 * 60 + 30, 'up': r > 0, 'z': z, 'S': S,
                's1m': float(np.std(np.diff(np.log(w)), ddof=1)), 'band': (0.25, 0.50, 0.35)}
    if H == 'E2':
        mb = bars.iloc[:30]
        O, S = float(mb.o.iloc[0]), float(mb.c.iloc[-1])
        m = math.log(S / O)
        X = float(mb.h.max()) if m > 0 else float(mb.l.min())
        if X == O:
            return None
        pull = (X - S) / (X - O)
        a = abs(m) / info['sd']
        if a < 0.35 or pull < 0.25:
            return None
        return {'t': 36000, 't_end': 43200, 'up': m < 0, 'z': a, 'S': S, 'O': O, 'X': X, 'm': m, 'band': (0.20, 0.45, 0.30)}
    if H == 'E6':
        S = float(bars.c.values[899 - 570])
        K = info.get('K', np.nan)
        if not np.isfinite(K):
            return None
        d = (K - S) / (S * info['iv'] * math.sqrt(60 / sim.YEAR_MIN))
        if abs(d) < 0.5 or abs(d) > 2.0:
            return None
        return {'t': 54000, 't_end': 57000, 'up': K > S, 'z': abs(d), 'S': S, 'K': K, 'band': (0.25, 0.50, 0.35)}
    if H == 'E3':
        orb = bars.iloc[:30]
        hi, lo = float(orb.h.max()), float(orb.l.min())
        later = bars.iloc[30:210]
        out = later[(later.c > hi) | (later.c < lo)]
        if not len(out):
            return None
        m = int(out.m.iloc[0])
        c = float(out.c.iloc[0])
        return {'t': (m + 1) * 60, 't_end': 55800, 'up': c > hi, 'z': np.nan, 'S': c, 'hi': hi, 'lo': lo, 'gex': info['gex'],
                'band': (0.25, 0.50, 0.35)}


def strike_for(S, T, iv, call, lo, hi, tgt, step):
    ks = np.round(S / step) * step + step * np.arange(-40, 41)
    dl = np.abs(sim.bs_delta(S, ks, T, iv, call))
    ok = (dl >= lo) & (dl <= hi)
    if not ok.any():
        return None
    i = np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - tgt))]
    return float(ks[i])


def run_syn(H, variant, S, bars, tr, info, spr):
    lo, hi, tgt = tr['band']
    i0 = (tr['t'] - 34200) // STEP
    i1 = min((tr['t_end'] - 34200) // STEP, len(S) - 2)
    T0 = max(960 - tr['t'] / 60.0, 1) / sim.YEAR_MIN
    step = 1.0 if info['root'] != 'SPXW' else 5.0
    K = strike_for(S[i0], T0, info['iv'], tr['up'], lo, hi, tgt, step)
    if K is None:
        return None
    idx = np.arange(i0 + 1, i1 + 2)
    tsec = 34200 + idx * STEP
    T = np.maximum(960 - tsec / 60.0, 0.05) / sim.YEAR_MIN
    mid = sim.bs_price(S[idx], K, T, info['iv'], tr['up'])
    mid = np.maximum(mid, 0.0)
    bid = mid * (1 - spr / 2)
    ask = mid * (1 + spr / 2)
    fill = float(ask[0])
    if fill <= 0.01:
        return None
    b = bid[1:]
    t_b = tsec[1:]
    rules, ur, ok = hyp.variants(H, tr, {'delta': float(abs(sim.bs_delta(S[i0], K, T0, info['iv'], tr['up'])))}, bars)[variant]
    if not ok:
        return None
    cand = [len(b) - 1]
    if rules.get('stop'):
        x = np.flatnonzero(b <= rules['stop'] * fill)
        if len(x):
            cand.append(x[0])
    if rules.get('tp_abs'):
        x = np.flatnonzero(b >= fill + rules['tp_abs'])
        if len(x):
            cand.append(x[0])
    if rules.get('trail'):
        arm = np.flatnonzero(b >= rules['trail_arm'] * fill)
        if len(arm):
            pk = np.maximum.accumulate(b)
            x = np.flatnonzero((np.arange(len(b)) >= arm[0]) & (b <= rules['trail'] * pk))
            if len(x):
                cand.append(x[0])
    if ur is not None:
        for j in range(0, len(b)):
            if t_b[j] % 60 == 0 and ur(t_b[j] // 60):
                cand.append(j)
                break
    j = min(cand)
    j = min(j + 1, len(b) - 1)  # the bid one step (10 s) after the decision
    xb = float(b[j])
    return {'ret': xb / fill - 1, 'ret_fee': (xb * 100 - sim.FEE) / (fill * 100 + sim.FEE) - 1}


def null_dist(H, which, variant, reps=200, seed=0):
    infos = sessions_info(H, which)
    spr = median_spread(H, which)
    rng = np.random.default_rng(seed)
    exps, passes, ns = [], 0, []
    for rep in range(reps):
        trs = []
        for info in infos:
            S, bars = sim_day(rng, info)
            tr = trigger(H, bars, info)
            if tr is None:
                continue
            out = run_syn(H, variant, S, bars, tr, info, spr)
            if out:
                out['day'] = info['day']
                trs.append(out)
        e, lo, hi = sim.boot(trs, 'ret_fee', n=400, seed=rep)
        exps.append(e)
        ns.append(len(trs))
        passes += (lo > 0)
    return {'variant': variant, 'reps': reps, 'spread': spr, 'n_mean': float(np.mean(ns)), 'null_mean': float(np.nanmean(exps)),
            'null_p95': float(np.nanpercentile(exps, 95)), 'fdr': passes / reps, 'exps': exps}


if __name__ == '__main__':
    H, which, v = sys.argv[1:4]
    reps = int(sys.argv[4]) if len(sys.argv) > 4 else 200
    z = null_dist(H, which, v, reps)
    print(json.dumps({k: x for k, x in z.items() if k != 'exps'}, indent=1))
