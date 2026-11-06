"""EDGE-D2 look-ahead test: the open-board features (09:35) and the first-30-minute features (10:00) must not change
when every later bar / board row / OI-independent input is replaced by noise; a canary that reads a later bar must change.

  python3 tests_lookahead_d2.py [n_days]   -> results/lookahead.txt
"""
import json, os, sys
import numpy as np
import pandas as pd
import features_d2 as F
from common_d2 import HERE, OUT

sys.path.insert(0, os.path.join(HERE, '..', 'edge-g'))
import book, sim  # noqa: E402

KEYS_OPEN = ['S', 'S_q', 'O', 'iv0', 'im', 'iv1', 'net', 'flip']
KEYS_30 = ['S10', 'rv30']


def noisy(df, cut, rng, cols):
    df = df.copy()
    late = df.m.values > cut
    for c in cols:
        if c in df:
            df.loc[late, c] = (df.loc[late, c].values * (1 + 0.05 * rng.standard_normal(late.sum()))).astype(df[c].dtype)
    return df


def run_one(day, cut, rng, canary=False):
    ob, oc, orb = F.bars_of, sim.chain, pd.read_parquet

    def bars2(d):
        b = ob(d)
        if b is None:
            return b
        b = noisy(b, cut, rng, ['o', 'h', 'l', 'c'])
        if canary:  # a feature that peeked at the 10:30 bar would see this
            b.loc[b.m == 574, 'c'] = float(b[b.m == 630].c.iloc[0])
        return b

    def chain2(r, d):
        c = oc(r, d)
        return None if c is None else noisy(c, cut, rng, ['bid', 'ask'])

    def rp2(f, *a, **k):
        x = orb(f, *a, **k)
        if 'edge-r' in f and 'm' in x:
            x = noisy(x, cut, rng, ['bid', 'ask'])
        return x

    F.bars_of, sim.chain, pd.read_parquet = bars2, chain2, rp2
    sim._CH.clear() if hasattr(sim, '_CH') else None
    try:
        fo = os.path.join(OUT, 'board', f'{day}.json')
        tmp = fo + '.lk'
        os.rename(fo, tmp)
        try:
            F.board_one(day)
            new = json.load(open(fo))
        finally:
            os.replace(tmp, fo)
    finally:
        F.bars_of, sim.chain, pd.read_parquet = ob, oc, orb
        sim._CH.clear() if hasattr(sim, '_CH') else None
    return new


def main(n=20):
    rng = np.random.default_rng(3)
    days = [d for d in F.board_days() if os.path.exists(os.path.join(OUT, 'board', f'{d}.json'))]
    days = [d for d in days if json.load(open(os.path.join(OUT, 'board', f'{d}.json'))).get('ok') == 1]
    pick = list(rng.choice(days, min(n, len(days)), replace=False))
    same_open = same_30 = caught = 0
    lines = []
    for d in pick:
        ref = json.load(open(os.path.join(OUT, 'board', f'{d}.json')))
        a = run_one(d, 574, rng)            # noise after the 09:34 stamp / bar: open features identical
        b = run_one(d, 599, rng)            # noise after the 09:59 bar: 30-minute features identical
        c = run_one(d, 599, rng, canary=True)
        eq = lambda x, y, ks: all((x.get(k) == y.get(k)) or (x.get(k) is None and y.get(k) is None) or
                                  (isinstance(x.get(k), float) and isinstance(y.get(k), float) and abs(x[k] - y[k]) <= 1e-12 * max(1, abs(x[k]))) for k in ks)
        so, s3, cc = eq(ref, a, KEYS_OPEN), eq(ref, b, KEYS_30), not eq(ref, c, ['S', 'iv0', 'im'])
        same_open += so; same_30 += s3; caught += cc
        lines.append(f'{d}: open-features identical {so}, 30-min identical {s3}, canary caught {cc}')
    txt = '\n'.join(lines) + f'\nSUMMARY: open identical {same_open}/{len(pick)}, 30-min identical {same_30}/{len(pick)}, canary caught {caught}/{len(pick)}\n'
    os.makedirs(os.path.join(HERE, 'results'), exist_ok=True)
    open(os.path.join(HERE, 'results', 'lookahead.txt'), 'w').write(txt)
    print(txt)


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 20)
