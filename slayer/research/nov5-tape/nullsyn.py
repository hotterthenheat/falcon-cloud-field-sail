"""NOV5 synthetic zero-drift null (PREREG.md "Nulls"): does the pipeline find an "edge" in a world with none?

Per DEV session with a real book: SPX re-simulated from the real open with zero drift at the real day's 5-minute RMS
profile of 1-minute log returns (1-minute steps, 6 sub-steps for the bar high/low); the book's net and walls re-priced at
the synthetic S from the real 10:30 legs (a grid of S, EDGE-G walls_at); IV_atm = the real per-minute ATM IV; triggers
recomputed by rules.py; the option priced Black-Scholes at the per-minute ATM IV on the trading clock (flat smile),
bid/ask = mid -+ the cell's real median entry half-spread (10-second steps held), same exits (devsim.simulate).

  python3 nullsyn.py prep          per-session inputs (v2data/nov5-tape/syn/prep), CPU only
  python3 nullsyn.py run 100       100 runs -> v2data/nov5-tape/syn/summary.json
"""
import glob, json, math, os, sys, time
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'edgeg'))
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2'))
import runner as RN  # noqa: E402
import rules as RU  # noqa: E402
import devsim as DS  # noqa: E402
import gex  # noqa: E402
from eval.metrics import cluster_ci_mean  # noqa: E402

SYN = os.path.join(RN.OUT, 'syn')
PREP = os.path.join(SYN, 'prep')
YEAR_MIN = 390.0 * 252
SUB = 6


def prep_day(day):
    import book as B
    import sim as esim
    f = os.path.join(PREP, f'{day}.npz')
    if os.path.exists(f):
        return True
    bk = RN.dev_book(day)
    if bk is None or not len(bk):
        return False
    bars = esim.day_bars('SPXW', day)
    if len(bars) < 300:
        return False
    st = B.load_static('SPXW', day)
    rd = B.read_legs(st, 'SPXW', day, 10 * 3600 + 30 * 60)
    if rd is None:
        return False
    legs = rd['legs']
    S0 = float(bars.o.iloc[0])
    grid = np.arange(math.floor(S0 * 0.92), math.ceil(S0 * 1.08) + 1, 1.0)
    K, side, oi, T, iv = legs['strike'], legs['side'], legs['oi'], legs['t'], legs['iv']
    ks = np.unique(K)
    ix = np.searchsorted(ks, K)
    net = np.zeros(len(grid)); wu = np.full(len(grid), np.nan); wd = np.full(len(grid), np.nan)
    for gi in range(0, len(grid), 64):
        Sg = grid[gi:gi + 64]
        g = side[:, None] * oi[:, None] * gex.dollar_gamma_per_contract(Sg[None, :], K[:, None], T[:, None], iv[:, None])
        net[gi:gi + 64] = g.sum(0)
        dealer = np.zeros((len(ks), len(Sg)))
        np.add.at(dealer, ix, -g)
        a = np.abs(dealer)
        for j, S in enumerate(Sg):
            inr = np.abs(ks / S - 1) <= 0.10
            up, dn = inr & (ks > S), inr & (ks < S)
            if up.any():
                wu[gi + j] = ks[up][np.argmax(a[up, j])]
            if dn.any():
                wd[gi + j] = ks[dn][np.argmax(a[dn, j])]
    lr = np.diff(np.log(bars.c.values))
    m = bars.m.values[1:]
    blk = (m - 570) // 5
    rms = np.zeros(78)
    for b in range(78):
        x = lr[blk == b]
        rms[b] = np.sqrt(np.mean(x * x)) if len(x) else np.nan
    rms = pd.Series(rms).ffill().bfill().values
    atm = dict(zip(bk.t.values // 60, bk.atm.values))
    am = np.array([atm.get(mm, np.nan) for mm in range(570, 960)])
    am = pd.Series(am).ffill().bfill().values
    os.makedirs(PREP, exist_ok=True)
    np.savez_compressed(f[:-4] + '.tmp.npz', S0=S0, grid=grid, net=net, wu=wu, wd=wd, rms=rms, atm=am)
    os.replace(f[:-4] + '.tmp.npz', f)
    return True


def bs(S, K, T, v, call):
    sq = v * np.sqrt(np.maximum(T, 1e-9))
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    from scipy.special import ndtr
    c = S * ndtr(d1) - K * ndtr(d1 - sq)
    return np.where(call, c, c - S + K)


def syn_day(z, day, rng):
    """One synthetic session: bars, a book frame, and the sub-step (10 s) path of S."""
    S0, rms = float(z['S0']), z['rms']
    n = 390
    sd = np.repeat(rms, 5)[:n] / math.sqrt(SUB)
    steps = rng.standard_normal((n, SUB)) * sd[:, None]
    lp = math.log(S0) + np.cumsum(steps.ravel())
    sub = np.exp(np.r_[math.log(S0), lp])          # 390*6 + 1 points, 10 s apart from 09:30:00
    o = sub[:-1].reshape(n, SUB)[:, 0]
    hl = np.c_[sub[:-1].reshape(n, SUB), sub[1:].reshape(n, SUB)[:, -1]]
    bars = pd.DataFrame({'m': np.arange(570, 960), 'o': o, 'h': hl.max(1), 'l': hl.min(1), 'c': sub[1:].reshape(n, SUB)[:, -1]})
    grid = z['grid']
    ts = np.arange(RN.READ_FROM, RN.READ_TO + 1, 60)
    Sb = bars.c.values[ts // 60 - 1 - 570]
    gi = np.clip(np.round(Sb - grid[0]).astype(int), 0, len(grid) - 1)
    book = pd.DataFrame({'t': ts, 'S': Sb, 'atm': z['atm'][ts // 60 - 1 - 570], 'net_all': z['net'][gi],
                         'wall_up': z['wu'][gi], 'wall_dn': z['wd'][gi]})
    return bars, book, sub


def syn_path(z, sub, K, call, start, end, h):
    """1-second path (held 10-second BS values) of one contract from start to end."""
    t10 = 9 * 3600 + 30 * 60 + 10 * np.arange(len(sub))
    mins = np.clip((t10 // 60) - 570, 0, 389)
    T = np.maximum(16 * 3600 - t10, 60) / 60.0 / YEAR_MIN
    mid = bs(sub, K, T, z['atm'][mins], call)
    mid = np.maximum(mid, 0.0)
    bid = np.where(mid > 0.05, np.round((mid * (1 - h)) / 0.05) * 0.05, 0.0)
    ask = np.maximum(np.round((mid * (1 + h)) / 0.05) * 0.05, 0.05)
    grid = np.arange(start, end + 1)
    j = np.clip((grid - t10[0]) // 10, 0, len(sub) - 1)
    return {'s0': start, 'src': 'syn', 'bid': bid[j].astype(float), 'ask': ask[j].astype(float),
            'bs': np.full(len(grid), 10.0), 'as': np.full(len(grid), 10.0)}


def pick_syn(S, atm, t, call, target):
    T = max((960 - (t - 60) // 60), 5) / YEAR_MIN
    ks = np.arange(round(S / 5) * 5 - 400, round(S / 5) * 5 + 405, 5.0)
    sq = atm * math.sqrt(T)
    d1 = (np.log(S / ks) + 0.5 * sq * sq) / sq
    from scipy.special import ndtr
    dl = np.abs(np.where(call, ndtr(d1), ndtr(d1) - 1))
    i = int(np.argmin(np.abs(dl - target)))
    return {'k': float(ks[i]), 'call': bool(call), 'delta': float(dl[i])}


def run(nruns, half):
    days = sorted(f[:-4] for f in os.listdir(PREP) if f.endswith('.npz'))
    out = {v: {'means': [], 'pass': []} for v in RN.variants()}
    t0 = time.time()
    for r in range(nruns):
        rng = np.random.default_rng(1000 + r)
        rows = []
        for day in days:
            z = np.load(os.path.join(PREP, f'{day}.npz'))
            bars, book, sub = syn_day(z, day, rng)
            d = RU.Day(day, bars, pd.DataFrame(columns=['m', 'k', 'r', 'bid', 'ask']), book)
            for ev in RU.events(d):
                t = int(ev['t'])
                for cell, tgt in RN.CELLS.items():
                    pk = pick_syn(ev['S'], ev['atm'], t, ev['side'] > 0, tgt)
                    start, end = max(t - RN.PRE, 9 * 3600 + 31 * 60), min(t + RN.WIN, DS.END_CAP)
                    p = syn_path(z, sub, pk['k'], pk['call'], start, end, half[cell])
                    for x in RN.EXITS[ev['rule']]:
                        if x == 'XW':
                            tw = RN.target_exit(d, ev, min(t + 5400, DS.FLAT_S))
                            res = DS.simulate(p, t, 'XA_W', pk, ev['S'], ev['atm'], ev['rv'], t_target=tw)
                        else:
                            res = DS.simulate(p, t, x, pk, ev['S'], ev['atm'], ev['rv'])
                        if 'ret_net' in res:
                            rows.append((f"{ev['rule']}-{x}-{cell}", day, res['ret_net']))
        df = pd.DataFrame(rows, columns=['variant', 'day', 'ret'])
        for v in RN.variants():
            x = df[df.variant == v]
            if len(x) >= 5:
                lo, hi = cluster_ci_mean(x.ret.values, x.day.values, n_boot=1000)
                out[v]['means'].append(float(x.ret.mean()))
                out[v]['pass'].append(bool(lo > 0))
                out[v].setdefault('n', []).append(len(x))
        print(time.strftime('%H:%M:%S'), 'run', r + 1, nruns, f'{time.time() - t0:.0f}s', flush=True)
        summ = {v: {'means': o['means'], 'fdr': float(np.mean(o['pass'])) if o['pass'] else float('nan'),
                    'n_mean': float(np.mean(o.get('n', [0]))), 'runs': len(o['means'])} for v, o in out.items()}
        os.makedirs(SYN, exist_ok=True)
        json.dump({**summ, '_half_spread': half, '_days': len(days)}, open(os.path.join(SYN, 'summary.json.tmp'), 'w'))
        os.replace(os.path.join(SYN, 'summary.json.tmp'), os.path.join(SYN, 'summary.json'))


def main():
    if sys.argv[1] == 'prep':
        import common as EC
        n = 0
        for day in EC.dev_sessions('DEV'):
            if os.path.exists(os.path.join(RN.DATA, 'edge', 'chain', 'SPXW', f'{day}.parquet')):
                n += prep_day(day)
        print('prepped', n, flush=True)
    else:
        nruns = int(sys.argv[2])
        # the cells' real median entry half-spread (fraction of mid) from the DEV real-side trades
        real = pd.concat([pd.DataFrame(json.load(open(f))) for f in glob.glob(os.path.join(RN.RESD, 'dev', '*.json'))
                          if os.path.getsize(f) > 2], ignore_index=True)
        half = {c: float(real[real.cell == c].spr0.median() / 2) for c in RN.CELLS}
        run(nruns, half)


if __name__ == '__main__':
    main()
