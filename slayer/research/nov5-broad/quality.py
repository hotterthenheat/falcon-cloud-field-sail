"""Data validation for one day: frozen quotes, 1-minute vs 1-second parity, prints vs the 1-second NBBO.

Frozen (stale) 1-second stretch: the NBBO (bid, ask) unchanged for >= 30 s while the underlying's excursion inside the
stretch, times the contract's |delta| (1-minute board), exceeds the quoted spread + 2 ticks. Every second of such a
stretch after its first 10 s is marked unfillable (stale.npz per root) and is never used for a fill or an exit.
Frozen 1-minute run: the same (bid, ask) on >= 5 consecutive minute stamps while |delta| x |S move| over the run >
spread + 2 ticks: those board rows are dropped from every 1-minute read (frozen_1m.parquet).
Parity: the 1-minute board row at stamp m must equal the 1-second NBBO in force at second 60 m (the documented
interval semantics). Prints: share of tick prints outside [bid - 0.05, ask + 0.05] of the 1-second NBBO in force.

  python3 quality.py 20261105 SPY,QQQ,...   -> results/QUALITY_<D>.md, v2data/nov5-broad/<D>/<ROOT>/{stale.npz,frozen_1m.parquet}
"""
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bload as B  # noqa: E402
from mdt import md  # noqa: E402

TICK = 0.01


def stale_seconds(q, s_und, p_und, delta):
    s, bid, ask = q['s'].astype(np.int64), q['bid'].astype(float), q['ask'].astype(float)
    if len(s) < 3:
        return np.zeros(0, np.int64)
    # dense per-second quote in force
    grid = np.arange(max(s[0], B.RTH0), min(s[-1], B.RTH1) + 1)
    j = np.searchsorted(s, grid, side='right') - 1
    b, a = bid[j], ask[j]
    chg = np.r_[True, (b[1:] != b[:-1]) | (a[1:] != a[:-1])]
    run_id = np.cumsum(chg)
    starts = np.flatnonzero(chg)
    ends = np.r_[starts[1:], len(grid)]
    up = np.interp(grid, s_und, p_und)
    out = []
    for a0, e0 in zip(starts, ends):
        L = e0 - a0
        if L < 30:
            continue
        exc = up[a0:e0].max() - up[a0:e0].min()
        d = delta(grid[a0])
        if not np.isfinite(d):
            continue
        if b[a0] <= 0:
            continue
        if abs(d) * exc > (a[a0] - b[a0]) + 2 * TICK:
            out.append(grid[a0 + 10:e0])
    return np.concatenate(out) if out else np.zeros(0, np.int64)


def frozen_1m(ch, S_by_m):
    rows = []
    for (k, r), c in ch.groupby(['k', 'r']):
        c = c.sort_values('m')
        b, a, m, dl = c.bid.values, c.ask.values, c.m.values, c.delta.values
        same = np.r_[False, (b[1:] == b[:-1]) & (a[1:] == a[:-1])]
        i = 0
        n = len(c)
        while i < n:
            j = i
            while j + 1 < n and same[j + 1]:
                j += 1
            if j - i + 1 >= 5 and b[i] > 0:
                Ss = [S_by_m.get(int(x), np.nan) for x in m[i:j + 1]]
                mv = np.nanmax(Ss) - np.nanmin(Ss)
                if np.isfinite(mv) and abs(dl[i]) * mv > (a[i] - b[i]) + 2 * TICK:
                    rows += [{'k': k, 'r': r, 'm': int(x)} for x in m[i:j + 1]]
            i = j + 1
    return pd.DataFrame(rows, columns=['k', 'r', 'm'])


def run(D, root):
    exp = B.expiries(D, root)[0]
    ch = B.chain(D, root, exp)
    s_und, p_und = B.und_1s(D, root)
    bars = B.bars(D, root)
    S_by_m = dict(zip(bars.m.values, bars.c.values))
    fz = frozen_1m(ch, S_by_m)
    d = B.rdir(D, root)
    os.makedirs(d, exist_ok=True)
    fz.to_parquet(os.path.join(d, 'frozen_1m.parquet'), index=False)
    stale, par_n, par_bad, n_c, n_q = {}, 0, 0, 0, 0
    for (k, r), c in ch.groupby(['k', 'r']):
        q = B.q1s(D, root, float(k), int(r), exp)
        if q is None:
            continue
        n_c += 1
        n_q += len(q['s'])
        dmap = dict(zip(c.m.values, c.delta.values))
        st = stale_seconds(q, s_und, p_und, lambda sec: dmap.get(int(sec // 60), np.nan))
        if len(st):
            stale[f'{k:g}{"C" if r else "P"}'] = st.astype(np.int32)
        # parity: board row m vs the 1-second quote in force at 60 m
        s = q['s'].astype(np.int64)
        cm = c[(c.m >= 571) & (c.m <= 959) & (c.bid > 0)]
        j = np.searchsorted(s, cm.m.values.astype(np.int64) * 60, side="right") - 1
        ok = j >= 0
        par_n += int(ok.sum())
        par_bad += int(((np.abs(q['bid'][j[ok]] - cm.bid.values[ok]) > 1e-6) | (np.abs(q['ask'][j[ok]] - cm.ask.values[ok]) > 1e-6)).sum())
    np.savez_compressed(os.path.join(d, 'stale.npz'), **stale) if stale else np.savez_compressed(os.path.join(d, 'stale.npz'), none=np.zeros(0))
    # prints vs the 1-second NBBO
    tr = B.trades(D, root, exp)
    pr_n = pr_out = 0
    if tr is not None and len(tr):
        for (k, r), t in tr.groupby(['k', 'r']):
            q = B.q1s(D, root, float(k), int(r), exp)
            if q is None:
                continue
            s = q['s'].astype(np.int64)
            ts = t.ms.values // 1000
            # the 1-second snapshot cannot resolve sub-second quote moves: use the band of the quotes in force at
            # seconds ts-1, ts, ts+1 (min bid, max ask)
            js = [np.searchsorted(s, ts + d, side='right') - 1 for d in (-1, 0, 1)]
            ok = js[0] >= 0
            lo = np.minimum.reduce([q['bid'][np.maximum(j, 0)] for j in js])[ok]
            hi = np.maximum.reduce([q['ask'][np.maximum(j, 0)] for j in js])[ok]
            px = t.px.values[ok]
            pr_n += len(px)
            pr_out += int(((px < lo - 0.05) | (px > hi + 0.05)).sum())
    n_stale = sum(len(v) for v in stale.values())
    return {'root': root, 'exp': exp, 'board contracts': ch.groupby(['k', 'r']).ngroups, 'frozen 1m rows': len(fz),
            'frozen 1m contracts': fz.groupby(['k', 'r']).ngroups if len(fz) else 0,
            '1s contracts': n_c, '1s quote changes': n_q, 'stale 1s seconds': n_stale,
            'stale contracts': len(stale), 'parity rows': par_n,
            'parity mismatch': f'{par_bad} ({100 * par_bad / max(par_n, 1):.2f}%)',
            'prints': pr_n, 'prints outside 1s NBBO band (s-1..s+1) +-0.05': f'{pr_out} ({100 * pr_out / max(pr_n, 1):.2f}%)'}


if __name__ == '__main__':
    D = sys.argv[1]
    rows = [run(D, r) for r in sys.argv[2].split(',')]
    df = pd.DataFrame(rows)
    txt = f'# Data quality, {D}\n\n(generated by quality.py; definitions in its docstring)\n\n' + md(df) + '\n'
    open(os.path.join(HERE, 'results', f'QUALITY_{D}.md'), 'w').write(txt)
    print(txt)
