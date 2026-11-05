"""EDGE-V nulls (PREREG): M1-execution real trigger vs (1) random-minute key null, (2) shuffled side; and
(3) synthetic zero-drift null (SPY variants).

  python3 nulls.py m1 DEV [draws]      -> v2data/edge-v/nulls_m1_DEV.json
  python3 nulls.py syn DEV [reps]      -> v2data/edge-v/nulls_syn_DEV.json
"""
import json, math, os, sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import v1
import sim as ES

M1_WAIT = 120


class Day:
    """One root-session: trigger bars, spot bars, triggers, lazily cached selections / M1 paths."""

    def __init__(self, root, day):
        self.root, self.day = root, day
        self.tb, self.spot, self.trs = v1.session_triggers(root, day)
        self._sel, self._path = {}, {}
        if self.tb is None:
            return
        # every minute's selection (same rule as v1.select), computed once; then the board is dropped
        c = v1.board_all(root, day, self.spot)
        if c is None:
            self.tb = None
            return
        lo, hi = v1.ASK_BAND[root]
        g = c[np.isfinite(c.iv.values) & (c.dl >= 0.15) & (c.dl <= 0.25) & (c.ask >= lo) & (c.ask <= hi)
              & (c.spr <= 0.10) & (c['as'] >= 1)].copy()
        g['err'] = np.abs(g.dl - 0.20)
        g = g.sort_values(['m', 'r', 'err'], kind='stable').drop_duplicates(['m', 'r'])
        for r in g.itertuples():
            side = 'C' if r.r == 1 else 'P'
            self._sel[((int(r.m) + 1) * 60, side)] = {'k': float(r.k), 'call': side == 'C', 'delta': float(r.dl),
                                                       'spr0': float(r.spr), 'ask0': float(r.ask)}
        ch = ES.chain(root, day)
        need = set((s['k'], s['call']) for s in self._sel.values())
        for (k, r), x in ch.groupby(['k', 'r']):
            if (float(k), r == 1) in need:
                x = x.sort_values('m')
                self._path[(float(k), r == 1)] = {'s': x.m.values.astype(np.int64) * 60, 'bid': x.bid.values.astype(float),
                                                  'ask': x.ask.values.astype(float), 'as': x['as'].values.astype(np.int64)}
        v1._BD.pop((root, day), None)

    def sel(self, t, side):
        return self._sel.get((t, side))

    def path(self, sel):
        return self._path[(sel['k'], sel['call'])]

    def trade(self, tr, held_side, mode):
        s = self.sel(tr['t'], held_side)
        if not s:
            return None
        return v1.run(self.path(s), tr['t'], v1.t_end_of(tr['t']), mode, v1.under_rule(self.tb, tr, held_side, mode), M1_WAIT)

    def pseudo(self, m, side, x):
        b = self.tb
        i = int(np.flatnonzero(b.m.values == m)[0]) if (b.m.values == m).any() else None
        if i is None:
            return None
        c = float(b.c.values[i])
        X = v1.xval(x, c)
        return {'m': m, 't': (m + 1) * 60, 'c': c, 'V': c + X if side == 'C' else c - X, 'D': X, 'X': X,
                'Lo': float(b.l.values[i]), 'Hi': float(b.h.values[i]), 'side': side}


def stats(rs):
    """rs: list of (day, ret_fee, dbl). Session-clustered bootstrap mean + CI, doubled-rate."""
    if not rs:
        return {'n': 0}
    tr = [{'day': d, 'ret_fee': r} for d, r, _ in rs]
    e, lo, hi = ES.boot(tr, 'ret_fee', n=400, seed=len(rs))
    return {'n': len(rs), 'exp': e, 'lo': lo, 'hi': hi, 'dbl': float(np.mean([b for _, _, b in rs]))}


def m1(which, draws=200, seed=7):
    out = {}
    roots = os.environ.get('V_ROOTS', ','.join(v1.ROOTS)).split(',')
    days = {r: [Day(r, d) for d in v1.days_for(r, which)] for r in roots}
    rng = np.random.default_rng(seed)
    for v in v1.variants():
        root, side, x, mode = v.split('-')
        if root not in roots:
            continue
        sx = f'{side}-{x}'
        trig_days = [D for D in days[root] if D.tb is not None and D.trs.get(sx)]
        real, pairs = [], []
        opp = 'P' if side == 'C' else 'C'
        for D in trig_days:
            tr = D.trs[sx]
            a = D.trade(tr, side, mode)
            if a:
                real.append((D.day, a['ret_fee'], a['dbl']))
            b = D.trade(tr, opp, mode)
            if a and b:
                pairs.append((D.day, a['ret_fee'], b['ret_fee']))
        rs = stats(real)
        # (1) random-minute key null
        rnd, rnd_dbl, rnd_pass, rnd_n = [], [], 0, []
        for _ in range(draws):
            got = []
            for D in trig_days:
                m = int(rng.integers(v1.M_FIRST, v1.M_LAST + 1))
                tr = D.pseudo(m, side, x)
                if not tr:
                    continue
                a = D.trade(tr, side, mode)
                if a:
                    got.append((D.day, a['ret_fee'], a['dbl']))
            s = stats(got)
            if s['n']:
                rnd.append(s['exp']); rnd_dbl.append(s['dbl']); rnd_n.append(s['n'])
                rnd_pass += s['lo'] > 0
        # (2) shuffled side
        shf, shf_pass = [], 0
        for _ in range(draws):
            coin = rng.random(len(pairs)) < 0.5
            got = [(d, (a if c else b), 0) for (d, a, b), c in zip(pairs, coin)]
            s = stats(got)
            if s['n']:
                shf.append(s['exp']); shf_pass += s['lo'] > 0
        e = rs.get('exp', np.nan)
        out[v] = {'real_m1': rs, 'trig_sessions': len(trig_days),
                  'rand': {'mean': float(np.mean(rnd)) if rnd else None, 'p95': float(np.percentile(rnd, 95)) if rnd else None,
                           'beats': float(np.mean(np.array(rnd) < e)) if rnd else None, 'fdr': rnd_pass / draws,
                           'dbl_mean': float(np.mean(rnd_dbl)) if rnd else None, 'n_mean': float(np.mean(rnd_n)) if rnd else None},
                  'shuf': {'pairs': len(pairs), 'mean': float(np.mean(shf)) if shf else None,
                           'p95': float(np.percentile(shf, 95)) if shf else None,
                           'beats': float(np.mean(np.array(shf) < (np.mean([a for _, a, _ in pairs]) if pairs else np.nan))) if shf else None,
                           'fdr': shf_pass / draws}}
        print(v, json.dumps(out[v]), flush=True)
    f = os.path.join(v1.VROOT, f'nulls_m1_{which}.json')
    allv = json.load(open(f)) if os.path.exists(f) else {}
    allv.update(out)
    json.dump(allv, open(f, 'w'), indent=1)
    return out


# ---------------------------------------------------------------- synthetic zero-drift

STEP = 10


def syn_info(which):
    info = []
    for d in v1.days_for('SPY', which):
        tb = v1.vbars('SPY', d)
        if len(tb) < 300 or int(tb.m.iloc[0]) != 570:
            continue
        c = v1.board_all('SPY', d, tb)
        if c is None:
            continue
        b = c[c.m == 599]
        if not len(b):
            continue
        S = float(b.S.iloc[0])
        kk = b.k.values[np.argmin(np.abs(b.k.values - S))]
        iv = b[(b.k == kk)].iv.values
        iv = iv[np.isfinite(iv)]
        if not len(iv):
            continue
        vol = np.zeros(390)
        vol[tb.m.values - 570] = tb.v.values
        info.append({'day': d, 'O': float(tb.o.iloc[0]), 's1m': float(np.std(np.diff(np.log(tb.c.values)), ddof=1)),
                     'iv': float(iv.mean()), 'vol': vol})
    return info


def syn_day(rng, inf):
    n = 390 * 60 // STEP
    s10 = inf['s1m'] / math.sqrt(60 / STEP)
    lp = math.log(inf['O']) + np.concatenate([[0], np.cumsum(rng.normal(-0.5 * s10 * s10, s10, n))])
    S = np.exp(lp)
    per = 60 // STEP
    seg = S[:390 * per + 1]
    o = seg[:-1:per][:390]
    c = seg[per::per][:390]
    blk = S[:390 * per].reshape(390, per)
    h = np.maximum(blk.max(1), c)
    l = np.minimum(blk.min(1), c)
    b = pd.DataFrame({'m': np.arange(570, 960), 'o': o, 'h': h, 'l': l, 'c': c, 'v': np.maximum(inf['vol'], 1)})
    return S, v1.add_vwap(b)


def syn_trade(S, b, tr, side, mode, iv, spr):
    t = tr['t']
    i0 = (t - 34200) // STEP
    T0 = max(960 - t / 60.0, 1) / v1.YEAR_MIN
    ks = np.round(S[i0]) + np.arange(-40, 41)
    call = side == 'C'
    dl = np.abs(v1.delta_vec(S[i0], ks, T0, iv, call))
    mid0 = v1.bs_vec(S[i0], ks, T0, iv, call)
    ask0 = mid0 * (1 + spr / 2)
    ok = (dl >= 0.15) & (dl <= 0.25) & (ask0 >= 0.15) & (ask0 <= 0.80)
    if not ok.any():
        return None
    K = float(ks[np.flatnonzero(ok)[np.argmin(np.abs(dl[ok] - 0.20))]])
    te = v1.t_end_of(t)
    idx = np.arange(i0, min((te + 60 - 34200) // STEP, len(S) - 1) + 1)
    ts = 34200 + idx * STEP
    T = np.maximum(960 - ts / 60.0, 0.05) / v1.YEAR_MIN
    mid = np.maximum(v1.bs_vec(S[idx], K, T, iv, call), 0.0)
    path = {'s': ts, 'bid': np.round(mid * (1 - spr / 2), 2), 'ask': np.round(mid * (1 + spr / 2), 2) + 0.0,
            'as': np.ones(len(ts), int)}
    path['ask'] = np.maximum(path['ask'], path['bid'] + 0.01)
    return v1.run(path, t, te, mode, v1.under_rule(b, tr, side, mode), 60)


def syn(which, reps=100, seed=11):
    info = syn_info(which)
    have = json.load(open(os.path.join(v1.VROOT, f'trades_{which}.json')))
    sp = [s['spr0'] for r in have.values() if r['root'] == 'SPY' for s in r.get('sel', {}).values() if s]
    spr = float(np.median(sp)) if sp else 0.05
    rng = np.random.default_rng(seed)
    vs = [v for v in v1.variants() if v.startswith('SPY-')]
    res = {v: [] for v in vs}
    for rep in range(reps):
        got = {v: [] for v in vs}
        for inf in info:
            S, b = syn_day(rng, inf)
            for side in v1.SIDES:
                for x in v1.XS:
                    tr = v1.trigger(b, side, x)
                    if not tr:
                        continue
                    tr['side'] = side
                    for mode in v1.MODES:
                        a = syn_trade(S, b, tr, side, mode, inf['iv'], spr)
                        if a:
                            got[f'SPY-{side}-{x}-{mode}'].append((inf['day'], a['ret_fee'], a['dbl']))
        for v in vs:
            res[v].append(stats(got[v]))
        if rep % 10 == 0:
            print('syn rep', rep, {v: round(res[v][-1].get('exp', np.nan), 3) for v in vs}, flush=True)
    out = {}
    for v in vs:
        ex = [s['exp'] for s in res[v] if s['n']]
        out[v] = {'reps': reps, 'spread': spr, 'n_mean': float(np.mean([s['n'] for s in res[v]])),
                  'mean': float(np.mean(ex)), 'p95': float(np.percentile(ex, 95)),
                  'fdr': float(np.mean([s['n'] > 0 and s['lo'] > 0 for s in res[v]])),
                  'dbl_mean': float(np.mean([s['dbl'] for s in res[v] if s['n']])), 'exps': ex}
    json.dump(out, open(os.path.join(v1.VROOT, f'nulls_syn_{which}.json'), 'w'), indent=1)
    return out


if __name__ == '__main__':
    cmd, which = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else None
    if cmd == 'm1':
        m1(which, n or 200)
    elif cmd == 'syn':
        syn(which, n or 100)
