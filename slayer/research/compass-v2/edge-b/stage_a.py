"""Stage A (drift gate) per PREREG.md. Usage: python3 stage_a.py F1|F3 DEV|VAL

Timing: te = ceil(sod0) + 2 s. S(t) = mid of the first good 1-second row stamped >= t (never earlier than t).
sigma_1s from good rows stamped in [t0-1800, t0-1] (decision-safe).
"""
import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA  # noqa: E402
from stats import cluster_ci  # noqa: E402

H = [5, 15, 30, 60]
STK = os.environ.get('EDGEB_STK', 'stk')
_cache = {}


def load(t, s):
    k = (t, s)
    if k not in _cache:
        p = f'{DATA}/theta/{STK}/{s}/{t}.parquet'
        if t == 'SPY' and os.path.exists(f'{DATA}/theta/stk/{s}/SPY.parquet'):
            p = f'{DATA}/theta/stk/{s}/SPY.parquet'   # SPY full days (hedge leg and SPY events)
        if not os.path.exists(p):
            _cache[k] = None
        else:
            d = pd.read_parquet(p)
            ok = (d['bid'] > 0) & (d['ask'] > d['bid']) & ((d['ask'] - d['bid']) / (d['ask'] + d['bid']) * 2 < 0.02)
            d = d[ok]
            _cache[k] = (d['sod'].to_numpy(), ((d['bid'] + d['ask']) / 2).to_numpy(float))
        if len(_cache) > 3000:
            _cache.pop(next(iter(_cache)))
    return _cache[k]


def at_or_after(sod, mid, t, limit=16 * 3600 + 5):
    i = np.searchsorted(sod, t, 'left')
    if i >= len(sod) or sod[i] > limit:
        # past the close: last good row at/before the close
        j = np.searchsorted(sod, limit, 'right') - 1
        return mid[j] if j >= 0 and sod[j] >= t - 120 else np.nan
    return mid[i] if sod[i] - t <= 60 else np.nan


def measure(ev):
    out = []
    for r in ev.itertuples():
        w = load(r.ticker, r.session)
        spy = load('SPY', r.session)
        rec = dict(idx=r.Index, ok=False)
        if w is not None and len(w[0]) > 100:
            sod, mid = w
            te = math.ceil(r.sod0) + 2
            pre = (sod >= r.sod0 - 1800) & (sod <= r.sod0 - 1)
            if pre.sum() >= 300:
                lm = np.log(mid[pre])
                rec['sig1'] = float(np.std(np.diff(lm)))
                s0 = at_or_after(sod, mid, te)
                if np.isfinite(s0):
                    rec['ok'] = True
                    for h in H:
                        s1 = at_or_after(sod, mid, te + 60 * h)
                        rec[f'r{h}'] = r.dir * (s1 / s0 - 1)
                        if spy is not None and len(spy[0]) > 100:
                            p0 = at_or_after(*spy, te); p1 = at_or_after(*spy, te + 60 * h)
                            rec[f'h{h}'] = r.dir * ((s1 / s0 - 1) - (p1 / p0 - 1)) if r.ticker != 'SPY' else np.nan
        out.append(rec)
    m = pd.DataFrame(out).set_index('idx')
    return ev.join(m)


def gate(x, sess, B=2000, seed=1):
    mu, lo, hi = cluster_ci(x, sess, B=B, seed=seed)
    return mu, lo, hi


def run(fam, split, n_perm=1000, n_syn=200):
    ev = pd.read_parquet(f'{DATA}/events_{fam}.parquet')
    ev = ev[ev['split'] == split]
    res = {}
    variants = sorted(ev['variant'].unique())
    k = len(variants)
    rows = []
    for v in variants:
        e = measure(ev[ev['variant'] == v].copy())
        e = e[e['ok'] == True]  # noqa: E712
        e.to_parquet(f'{DATA}/stageA_{v}_{split}.parquet')
        sess = e['session'].to_numpy()
        rng = np.random.default_rng(7)
        rv = {'n': int(len(e)), 'sessions': int(e['session'].nunique()), 'qualifying': int(e['n_qualifying'].iloc[0])}
        for h in H:
            x = e[f'r{h}'].to_numpy(float); good = np.isfinite(x)
            x, s_ = x[good], sess[good]
            raw = x * e['dir'].to_numpy()[good]  # unsigned return (dir * signed)
            mu, lo, hi = gate(x, s_)
            z = x / (e['sig1'].to_numpy()[good] * math.sqrt(60 * h))
            muz, loz, hiz = gate(z, s_, seed=2)
            hh = e[f'h{h}'].to_numpy(float)[good]
            gh = np.isfinite(hh)
            muh, loh, hih = gate(hh[gh], s_[gh], seed=3) if gh.sum() > 10 else (np.nan,) * 3
            # (a) shuffled signal: permute directions across events
            d = e['dir'].to_numpy()[good]
            perm = np.empty(n_perm); perm_pass = 0
            for i in range(n_perm):
                pd_ = rng.permutation(d)
                xp = raw * pd_
                perm[i] = xp.mean()
                if i < 200:
                    m_, l_, _ = cluster_ci(xp, s_, B=500, seed=i)
                    perm_pass += (m_ > 0) & (l_ > 0)
            p = float((perm >= mu).mean())
            # (b) synthetic zero drift: driftless Gaussian walk at each event's own sigma
            sd = e['sig1'].to_numpy()[good] * math.sqrt(60 * h)
            syn_pass = 0; syn_means = []
            for i in range(n_syn):
                xs = rng.normal(0, sd)
                m_, l_, _ = cluster_ci(xs, s_, B=500, seed=1000 + i)
                syn_means.append(m_)
                syn_pass += (m_ > 0) & (l_ > 0)
            syn_means = np.array(syn_means)
            rv[f'h{h}'] = dict(n=int(good.sum()), mean_bps=mu * 1e4, ci_bps=[lo * 1e4, hi * 1e4],
                               mean_sig=muz, ci_sig=[loz, hiz], spy_hedged_bps=muh * 1e4,
                               spy_hedged_ci=[loh * 1e4, hih * 1e4], win=float((x > 0).mean()),
                               perm_p=p, perm_ci_pass_rate=perm_pass / 200,
                               syn_ci_pass_rate=syn_pass / n_syn,
                               beats_syn=float((syn_means < mu).mean()),
                               gate=bool(mu > 0 and lo > 0 and p < 0.05 / k) if h == 30 else None)
            rows.append([v, split, h, int(good.sum()), round(mu * 1e4, 2), round(lo * 1e4, 2), round(hi * 1e4, 2),
                         round(muz, 4), round(muh * 1e4, 2), round(float((x > 0).mean()), 3), round(p, 4),
                         perm_pass / 200, syn_pass / n_syn])
        res[v] = rv
    with open(f'{DATA}/stageA_{fam}_{split}.json', 'w') as f:
        json.dump(res, f, indent=1)
    t = pd.DataFrame(rows, columns=['variant', 'split', 'h', 'n', 'mean_bps', 'lo', 'hi', 'mean_sig', 'spyhedged_bps',
                                    'win', 'perm_p', 'perm_ci_pass', 'syn_ci_pass'])
    print(t.to_string(index=False))
    for v in variants:
        print(v, 'GATE(h=30):', res[v]['h30']['gate'], 'n', res[v]['n'], 'sessions', res[v]['sessions'],
              'qualifying', res[v]['qualifying'])


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
