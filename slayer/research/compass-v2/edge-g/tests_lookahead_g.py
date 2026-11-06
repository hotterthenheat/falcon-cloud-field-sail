"""EDGE-G look-ahead test (PREREG): run before any outcome is read.

For sampled triggers: every bar that starts after t - 60 and every chain/board row stamped after (t - 60)//60 is replaced
by noise; the book read at t (spot, ATM IV, raw flip, net at spot, walls), the trigger's features (R1a: every read up to
t; R1b / BASE: the mark read, r30, RV so far) and the contract picks of all cells must be identical. Two canaries that
peek (the forming bar t//60; the chain stamp t//60) must be caught on every sample.
  python3 tests_lookahead_g.py [n]   -> results/lookahead.txt
"""
import math, os, sys
import numpy as np
import pandas as pd
from common import OUT
import book as B
import signals_g as G
import sim_g as SG
import gex

sim = B.sim
HERE = os.path.dirname(os.path.abspath(__file__))


def masked(df, col, last_ok, rng, cols):
    d = df.copy()
    late = d[col].values > last_ok
    for c in cols:
        dt0 = d[c].values.dtype
        v = d[c].values.astype(float)
        v[late] = v[late] * rng.uniform(0.5, 1.5, late.sum()) + rng.uniform(0, 1, late.sum())
        d[c] = v.astype(dt0)  # keep the stored dtype (float32 boards): only the late rows change
    return d


def install(root, day, t, rng):
    """Mask the caches EDGE's sim reads from (bars by month, chain by day) and edge-r boards."""
    real_bars = sim.day_bars(root, day)
    mb = t // 60 - 1
    month = sim.bars_month(sim.UNDER[root], day[:7]).copy()
    sel = month.d == day
    mday = masked(month[sel], 'm', mb, rng, ['o', 'h', 'l', 'c'])
    month = pd.concat([month[~sel], mday]).sort_values(['d', 'm']).reset_index(drop=True)
    sim._BARS[(sim.UNDER[root], day[:7])] = month
    ch = sim.chain(root, day)
    sim._CH[(root, day)] = masked(ch, 'm', (t - 60) // 60, rng, ['bid', 'ask'])
    SG._BC.clear()
    for f in list(SG._BC):
        SG._BC.pop(f)
    exp = B.next_expiry(root, day)
    if exp and root != 'IWM':
        f = os.path.join(SG.DATA, 'edge-r', 'board', root, f'{day}_{exp}.parquet')
        if os.path.exists(f):
            SG._BC[f] = masked(pd.read_parquet(f), 'm', (t - 60) // 60, rng, ['bid', 'ask'])
    return real_bars


def reset():
    sim._BARS.clear(); sim._CH.clear(); SG._BC.clear()


def read_at(root, day, t, st=None, canary=None):
    st = st or B.load_static(root, day)
    if canary == 'bar':
        b = sim.day_bars(root, day)
        st = dict(st)
        st['bars'] = b
        x = b[b.m <= t // 60]  # peeks at the forming bar
        return {'S': float(x.c.iloc[-1])}
    if canary == 'chain':
        c = sim.chain(root, day)
        b = c[(c.m == t // 60) & (c.bid > 0)]
        return {'S': float(b.bid.sum() + b.ask.sum())}
    st = dict(st)
    st['bars'] = sim.day_bars(root, day)
    rd = B.read_legs(st, root, day, t)
    if rd is None:
        return None
    fr = gex.repriced_flip(rd['legs'], rd['S'], fast=True)
    w = B.walls_at(rd['legs'], rd['S'])
    return {'S': rd['S'], 'atm': rd['atm'], 'flip': fr['flip'], 'net': fr['netAtSpot'], 'nc': len(fr['crossings']), **w}


def features(ev, root, day, t):
    bars = sim.day_bars(root, day)
    out = {'S30': G.spot_before(bars, t - 1800), 'rv': G.rv_so_far(bars, t)}
    for cell, (dte, tg) in SG.CELLS.items():
        pk, why = SG.pick(root, day, t, ev['side'] > 0, dte, tg, bars)
        out[cell] = None if pk is None else (pk['exp'], pk['k'], round(pk['delta'], 12))
    return out


def same(a, b):
    if a.keys() != b.keys():
        return False
    for k in a:
        x, y = a[k], b[k]
        if isinstance(x, float) and isinstance(y, float):
            if not ((math.isnan(x) and math.isnan(y)) or x == y):
                return False
        elif x != y:
            return False
    return True


def main():
    SG.NOFETCH = True
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    ev = pd.read_parquet(os.path.join(OUT, 'events_DEV.parquet'))
    rng = np.random.default_rng(7)
    samp = ev.iloc[rng.permutation(len(ev))[:n]]
    ok_read = ok_feat = ok_r1a = c_bar = c_chain = n_r1a = 0
    lines = []
    for _, e in samp.iterrows():
        root, day, t = e.root, e.day, int(e.t)
        reset()
        st = B.load_static(root, day)
        a = read_at(root, day, t, st)
        fa = features(e, root, day, t)
        cb = read_at(root, day, t, st, 'bar')
        cc = read_at(root, day, t, st, 'chain')
        install(root, day, t, np.random.default_rng(int(t)))
        b = read_at(root, day, t, st)
        fb = features(e, root, day, t)
        cb2 = read_at(root, day, t, st, 'bar')
        cc2 = read_at(root, day, t, st, 'chain')
        r_ok = same(a, b)
        f_ok = same({k: v for k, v in fa.items() if not isinstance(v, tuple)}, {k: v for k, v in fb.items() if not isinstance(v, tuple)}) and \
            all(fa[c] == fb[c] for c in SG.CELLS)
        ok_read += r_ok
        ok_feat += f_ok
        c_bar += cb['S'] != cb2['S']
        c_chain += cc['S'] != cc2['S']
        if e.fam == 'R1A':  # every read up to t, held flip, the trigger's own minute
            n_r1a += 1
            stick = gex.StickFlip()
            held = []
            for tt in range(B.READ_FROM, t + 1, 60):
                r = read_at(root, day, tt, st)
                if r is None:
                    continue
                fr = {'flip': r['flip'], 'crossings': None}
                held.append(r['flip'])
            zb = G.load_book(root, day)
            mine = zb['flip_raw'][zb['t'] <= t]
            ok_r1a += bool(len(held) == len(mine) and np.allclose(np.nan_to_num(np.array(held, float), nan=-1), np.nan_to_num(mine, nan=-1), rtol=0, atol=0))
        lines.append(f'{e.fam} {root} {day} {t}: read {"same" if r_ok else "DIFF"}, features+picks {"same" if f_ok else "DIFF"}')
    reset()
    summ = [f'samples {len(samp)} (seed 7 of {len(ev)} triggers)',
            f'book read at t identical with later bars/boards as noise: {ok_read}/{len(samp)}',
            f'trigger features + all three cell picks identical: {ok_feat}/{len(samp)}',
            f'R1a: every masked read up to t equals the stored book (raw flip): {ok_r1a}/{n_r1a}',
            f'canary forming bar caught: {c_bar}/{len(samp)}', f'canary next chain stamp caught: {c_chain}/{len(samp)}']
    txt = '\n'.join(summ + [''] + lines) + '\n'
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    open(os.path.join(HERE, 'results', 'lookahead.txt'), 'w').write(txt)
    print('\n'.join(summ))


if __name__ == '__main__':
    main()
