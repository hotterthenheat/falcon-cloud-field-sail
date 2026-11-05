"""Synthetic zero-drift null for M1-M6 (PREREG: edge/nullsyn.py's generator, re-priced at each DTE).

For every trigger root-session in results_DEV.json: the day is re-simulated at 10-s steps from its real 1-min vol
with zero drift (overnight gap N(0, 0.4 sigma_d)), the trigger is recomputed on the synthetic bars, the contract is the
strike nearest the target delta in 0.30-0.45 at the real ATM IV of that DTE's board (flat smile), BS-priced with that
DTE's T, quoted at the variant's real median entry spread; entry at the ask 10 s after the decision, the same re-scaled
rules on the 10-s grid, exit at the bid 10 s after the decision. M4: after 16:00 a second gap N(0, 0.4 sigma_d),
then 09:30-09:45 at the same vol, T one session shorter. Fee as real.

  python3 nullsyn_m.py M3 [reps]
"""
import json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'edge'))
sys.path.insert(0, HERE)
import sim
import hyp
import nullsyn as NS
import mdte
import fetch as F
import analyze_m as A

STEP = NS.STEP


def board_iv(root, day, exp, n, t, S):
    bd = mdte.board_m(root, day, exp, (int(t) - 60) // 60)
    if bd is None:
        return np.nan
    T = mdte.T_of(t, n)
    bd = bd[(bd.bid > 0) & (bd.ask > bd.bid)]
    if not len(bd):
        return np.nan
    katm = bd.k.values[np.argmin(np.abs(bd.k.values - S))]
    x = bd[bd.k == katm]
    iv = sim.implied_vol((x.bid.values + x.ask.values) / 2, S, x.k.values, T, x.r.values == 1)
    iv = iv[np.isfinite(iv)]
    return float(iv.mean()) if len(iv) else np.nan


def infos(have, v):
    """AMENDMENT A1 (before any full-size null run): the null runs on EVERY root-session of the variant's set (EDGE's
    null_info list: real day vol, prior close, 20-day vol, real 0DTE ATM IV at the decision minute), not only on trigger
    days -- on trigger days alone the synthetic trigger fires on ~5% of them (E2: < 1 trade per run). The DTE ATM IV is
    the real board's on days that have one (trigger days); elsewhere the real 0DTE ATM IV x the median DTE/0DTE IV ratio
    over the trigger days."""
    H, b = mdte.HOF[v], A.BUCKET[v]
    t = 15 * 3600 + 25 * 60 if H == 'E1' else 10 * 3600
    ni = json.load(open(os.path.join(sim.ROOT, 'results', f'null_info_{H}_DEV.json')))
    keep = set(F.want_days('DEV')[::2]) if H == 'E1' else set(F.want_days('DEV'))
    real = {}
    for rec in have.values():
        if rec and rec['H'] == H:
            ex = mdte.expiry_for(rec['root'], rec['day'], b)
            if ex:
                real[(rec['root'], rec['day'])] = board_iv(rec['root'], rec['day'], ex[0], ex[1], t, rec['trig']['S'])
    base = {(x['root'], x['day']): x['iv'] for x in ni}
    ratios = [iv / base[k] for k, iv in real.items() if np.isfinite(iv) and k in base and base[k] > 0]
    ratio = float(np.median(ratios)) if ratios else 1.0
    out = []
    for x in ni:
        if x['day'] not in keep:
            continue
        ex = mdte.expiry_for(x['root'], x['day'], b)
        if ex is None:
            continue
        iv = real.get((x['root'], x['day']), np.nan)
        iv = iv if np.isfinite(iv) else x['iv'] * ratio
        out.append({**x, 'iv': iv, 'n': ex[1]})
    return out, ratio


def run_one(H, v, rng, info, spr):
    S, bars = NS.sim_day(rng, info)
    tr = NS.trigger(H, bars, info)
    if tr is None:
        return None
    n = info['n']
    tgt = mdte.TGT[H]
    i0 = (tr['t'] - 34200) // STEP
    T0 = mdte.T_of(tr['t'], n)
    step = 5.0 if info['root'] == 'SPXW' else 1.0
    K = NS.strike_for(S[i0], T0, info['iv'], tr['up'], mdte.LO, mdte.HI, tgt, step)
    if K is None:
        return None
    i1 = min((tr['t_end'] - 34200) // STEP, len(S) - 2) if v != 'M4' else len(S) - 1
    idx = np.arange(i0 + 1, i1 + 1)
    tsec = 34200 + idx * STEP
    path = S[idx]
    Ts = (np.maximum(960 - tsec / 60.0, 0.05) + 390 * n) / sim.YEAR_MIN
    if v == 'M4':  # overnight gap, then 09:30-09:45 next session
        s10 = info['s1m'] / math.sqrt(60 / STEP)
        m = 15 * 60 // STEP
        lp = math.log(S[-1]) + rng.normal(0, 0.4 * info['sd']) + np.concatenate([[0], np.cumsum(rng.normal(-0.5 * s10 * s10, s10, m))])
        t2 = 86400 + 34200 + np.arange(m + 1) * STEP
        T2 = (390 - (t2 - 86400 - 34200) / 60.0 + 390 * (n - 1)) / sim.YEAR_MIN
        path = np.concatenate([path, np.exp(lp)])
        tsec = np.concatenate([tsec, t2])
        Ts = np.concatenate([Ts, T2])
    mid = np.maximum(sim.bs_price(path, K, Ts, info['iv'], tr['up']), 0.0)
    bid, ask = mid * (1 - spr / 2), mid * (1 + spr / 2)
    fill = float(ask[0])
    if fill <= 0.01:
        return None
    dl = float(abs(sim.bs_delta(S[i0], K, T0, info['iv'], tr['up'])))
    s1 = tr.get('s1m') if H == 'E1' else float(np.std(np.diff(np.log(bars.c.values[:30])), ddof=1))
    _, rules = mdte.rules_for(H, {'delta': dl, 'S': float(S[i0]), 'ask0': fill}, s1)
    b, tb = bid[1:], tsec[1:]
    cand = [len(b) - 1]
    x = np.flatnonzero(b <= rules['stop'] * fill)
    if len(x):
        cand.append(x[0])
    if v != 'M4':
        arm = np.flatnonzero(b >= rules['trail_arm'] * fill)
        if len(arm):
            pk = np.maximum.accumulate(b)
            x = np.flatnonzero((np.arange(len(b)) >= arm[0]) & (b <= rules['trail'] * pk))
            if len(x):
                cand.append(x[0])
        if H == 'E2':
            ur = hyp.under_rule_e2(bars, tr, True)
            for j in range(len(b)):
                if tb[j] % 60 == 0 and ur(tb[j] // 60):
                    cand.append(j)
                    break
    else:
        x = np.flatnonzero(tb >= mdte.ON_EXIT)
        if len(x):
            cand.append(x[0])
    j = min(min(cand) + 1, len(b) - 1)
    xb = float(b[j])
    return {'ret': xb / fill - 1, 'ret_fee': (xb * 100 - sim.FEE) / (fill * 100 + sim.FEE) - 1}


def null_dist(v, reps=100, seed=0):
    have = A.load()
    H = mdte.HOF[v]
    inf, ratio = infos(have, v)
    tr_real = A.trades(have, v)
    spr = float(np.median([t['spr0'] for t in tr_real])) if tr_real else 0.02
    rng = np.random.default_rng(seed)
    exps, passes, ns = [], 0, []
    for rep in range(reps):
        trs = []
        for info in inf:
            out = run_one(H, v, rng, info, spr)
            if out:
                out['day'] = info['day']
                trs.append(out)
        e, lo, hi = sim.boot(trs, 'ret_fee', n=400, seed=rep)
        exps.append(e)
        ns.append(len(trs))
        passes += lo > 0
    return {'variant': v, 'reps': reps, 'sessions': len(inf), 'iv_ratio': ratio, 'spread': spr, 'n_mean': float(np.mean(ns)),
            'null_mean': float(np.nanmean(exps)), 'null_p95': float(np.nanpercentile(exps, 95)), 'fdr': passes / reps,
            'exps': [float(x) for x in exps]}


if __name__ == '__main__':
    v = sys.argv[1]
    reps = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    z = null_dist(v, reps)
    os.makedirs(os.path.join(mdte.MROOT, 'nulls'), exist_ok=True)
    json.dump(z, open(os.path.join(mdte.MROOT, 'nulls', f'{v}.json'), 'w'))
    print(json.dumps({k: x for k, x in z.items() if k != 'exps'}))
