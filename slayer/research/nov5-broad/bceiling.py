"""STEP 2 (HINDSIGHT, labelled so): the best long round trip per contract on every root of the day, plus the best 2/3
non-overlapping legs. Same execution rule as nov5-tape/ceiling.py (whose best1 / bestk are reused): buy the ask in
force at a fill second, sell the bid in force at a later fill second, +2 s latency (no fill before 09:30:02, none on the
16:00:00 bell), $0.65 a side, 1 contract (x100). 1-second NBBO (displayed size >= 1 both sides) where fetched, the
1-minute board elsewhere (column res). Stale 1-second seconds (quality.py) and frozen 1-minute rows are dropped.
Entry ask >= $0.05 (SPXW: >= $0.10) so the "multiple" is not a one-tick artefact.

  python3 bceiling.py 20261105 SPXW,SPY,...  -> results/CEILING_<D>.md, v2data/nov5-broad/<D>/ceiling.parquet
"""
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape'))
import bload as B  # noqa: E402
import ceiling as C5  # noqa: E402
from mdt import md  # noqa: E402

LAT, FEE = 2, 0.65


def stale_set(D, root):
    f = os.path.join(B.rdir(D, root), 'stale.npz')
    if not os.path.exists(f):
        return {}
    z = np.load(f)
    return {k: set(z[k].tolist()) for k in z.files if k != 'none'}


def frozen_set(D, root):
    f = os.path.join(B.rdir(D, root), 'frozen_1m.parquet')
    if not os.path.exists(f):
        return set()
    z = pd.read_parquet(f)
    return set(zip(z.k.astype(float), z.r.astype(int), z.m.astype(int)))


def series(D, root, exp, k, r, c, stale, frozen):
    q = B.q1s(D, root, k, r, exp)
    if q is not None:
        s = q['s'].astype(np.int64)
        ok = (q['bid'] > 0) & (q['ask'] >= q['bid']) & (q['bs'] >= 1) & (q['as'] >= 1) & (s >= B.RTH0 + LAT) & (s <= B.RTH1 - 1)
        st = stale.get(f'{k:g}{"C" if r else "P"}')
        if st:
            ok &= ~np.isin(s, np.fromiter(st, np.int64))
        return s[ok], q['bid'][ok].astype(float), q['ask'][ok].astype(float), '1s'
    ok = (c.bid.values > 0) & (c.ask.values >= c.bid.values) & (c.m.values >= 570) & (c.m.values <= 959)
    if frozen:
        ok &= ~np.array([(k, r, int(m)) in frozen for m in c.m.values])
    t = np.maximum(c.m.values[ok].astype(np.int64) * 60, B.RTH0 + LAT)
    return t, c.bid.values[ok].astype(float), c.ask.values[ok].astype(float), '1m'


def run(D, root):
    exp = B.expiries(D, root)[0]
    ch = B.chain(D, root, exp)
    bars = B.bars(D, root)
    S0 = float(bars.o.iloc[0])
    us, up = B.und_1s(D, root)
    S_at = lambda t: float(up[max(np.searchsorted(us, t, side='right') - 1, 0)])  # noqa: E731
    dl = {(float(k), int(r), int(m)): float(d) for k, r, m, d in zip(ch.k, ch.r, ch.m, ch.delta)}
    stale, frozen = stale_set(D, root), frozen_set(D, root)
    min_ask = 0.10 if root == 'SPXW' else 0.05
    rows = []
    for (k, r), c in ch.groupby(['k', 'r']):
        k, r = float(k), int(r)
        t, b, a, res = series(D, root, exp, k, r, c, stale, frozen)
        okb = a >= min_ask
        if okb.sum() < 2 or len(t) < 2:
            continue
        # entries only at ask >= min_ask: mask cheap asks out of the entry side by inflating them
        a_in = np.where(okb, a, np.inf)
        u = C5.best1(t, b, np.where(np.isfinite(a_in), a_in, 1e9), 'usd')
        p = C5.best1(t, b, np.where(np.isfinite(a_in), a_in, 1e9), 'pct')
        if u is None or p is None or u['buy'] >= 1e8:
            continue
        ks = C5.bestk(t, b, np.where(np.isfinite(a_in), a_in, 1e9), 3)
        sgn = 1 if r == 1 else -1
        din = lambda tt: abs(dl.get((k, r, int(min(max(tt // 60, 571), 959))), np.nan))  # noqa: E731
        row = {'root': root, 'exp': exp, 'k': k, 'r': r, 'res': res, 'mny_open': (k / S0 - 1) * sgn,
               'usd_buy': u['buy'], 'usd_sell': u['sell'], 'usd_in': u['t_in'], 'usd_out': u['t_out'],
               'usd_gain': 100 * (u['sell'] - u['buy']) - 2 * FEE, 'usd_mult': u['sell'] / u['buy'],
               'usd_S_in': S_at(u['t_in']), 'usd_S_out': S_at(u['t_out']), 'usd_delta_in': din(u['t_in']),
               'pct_buy': p['buy'], 'pct_sell': p['sell'], 'pct_in': p['t_in'], 'pct_out': p['t_out'],
               'pct_mult': p['sell'] / p['buy'], 'pct_gain': 100 * (p['sell'] - p['buy']) - 2 * FEE,
               'pct_delta_in': din(p['t_in']), 'pct_S_in': S_at(p['t_in'])}
        row['pct_mny_in'] = (k / row['pct_S_in'] - 1) * sgn
        row['usd_mny_in'] = (k / row['usd_S_in'] - 1) * sgn
        for kk, legs in ks.items():
            row[f'k{kk}_usd'] = sum(100 * (x['sell'] - x['buy']) - 2 * FEE for x in legs)
            row[f'k{kk}_legs'] = '; '.join(f"{B.clock(x['t_in'])[:5]} {x['buy']:.2f}->{B.clock(x['t_out'])[:5]} {x['sell']:.2f}"
                                           for x in legs)
        rows.append(row)
    return pd.DataFrame(rows)


def cname(x):
    return f"{x.root} {x.k:g}{'C' if x.r else 'P'}"


def mny_bucket(v):
    for lo, hi, nm in ((-9, -0.02, 'ITM >2%'), (-0.02, -0.005, 'ITM 0.5-2%'), (-0.005, 0.005, 'ATM +-0.5%'),
                       (0.005, 0.02, 'OTM 0.5-2%'), (0.02, 0.04, 'OTM 2-4%'), (0.04, 9, 'OTM >4%')):
        if lo <= v < hi:
            return nm
    return '?'


def tod_bucket(s):
    m = s // 60
    for lo, hi, nm in ((570, 600, '09:30-10:00'), (600, 660, '10:00-11:00'), (660, 780, '11:00-13:00'),
                       (780, 900, '13:00-15:00'), (900, 961, '15:00-16:00')):
        if lo <= m < hi:
            return nm
    return '?'


def report(D, df):
    df = df.copy()
    df['contract'] = [cname(x) for x in df.itertuples()]
    df['side'] = np.where(df.r == 1, 'call', 'put')
    L = [f'# Hindsight ceiling, {D}: every root\n',
         '**HINDSIGHT UPPER BOUNDS, not strategies.** Best long round trip per contract: buy the ask in force at one fill '
         'second, sell the bid in force at a later fill second (+2 s latency), $0.65 a side, 1 contract. Both ends are '
         'chosen knowing the whole day. res = 1s (1-second NBBO, size >= 1) or 1m (1-minute board; a lower bound). '
         'Stale 1-second stretches and frozen 1-minute rows are excluded (QUALITY file). Entry ask >= $0.05 ($0.10 SPXW). '
         'Names trade their nearest expiry (2026-11-06, 1DTE on Thursday); index roots their 0DTE.\n']
    t = df.sort_values('pct_mult', ascending=False).head(20)
    L.append('## Top 20 by % (best multiple)\n')
    L.append(md(pd.DataFrame({'contract': t.contract, 'res': t.res, 'entry delta': t.pct_delta_in.round(3),
                              'buy': t.pct_buy, 'at': [B.clock(x) for x in t.pct_in], 'sell': t.pct_sell,
                              'out': [B.clock(x) for x in t.pct_out], 'multiple': t.pct_mult.round(1),
                              '$ net / lot': t.pct_gain.round(0)})))
    t = df[df.usd_delta_in <= 0.5].sort_values('usd_gain', ascending=False).head(20)
    L.append('\n## Top 20 by $ per contract (entry |delta| <= 0.50, so deep ITM "underlying proxies" are excluded)\n')
    L.append(md(pd.DataFrame({'contract': t.contract, 'res': t.res, 'entry delta': t.usd_delta_in.round(2),
                              'buy': t.usd_buy, 'at': [B.clock(x) for x in t.usd_in], 'sell': t.usd_sell,
                              'out': [B.clock(x) for x in t.usd_out], '$ net': t.usd_gain.round(0),
                              'x': t.usd_mult.round(1), 'best 3 legs $': t.k3_usd.round(0), 'best 3 legs': t.k3_legs})))
    # where the money was: per root & side
    g = df[df.usd_delta_in <= 0.5].groupby(['root', 'side']).agg(n=('k', 'size'), best_usd=('usd_gain', 'max'),
                                                                   median_mult=('pct_mult', 'median'),
                                                                   best_mult=('pct_mult', 'max'),
                                                                   sum_best3=('k3_usd', 'sum')).reset_index()
    L.append('\n## Where the money was: root x side (contracts with entry |delta| <= 0.50)\n')
    L.append(md(g.round(1)))
    df['mb'] = [mny_bucket(v) for v in df.pct_mny_in]
    g = df.groupby(['side', 'mb']).agg(n=('k', 'size'), median_mult=('pct_mult', 'median'), p90_mult=('pct_mult', lambda x: x.quantile(0.9))).reset_index()
    L.append('\n## Moneyness at the best-% entry (all roots)\n')
    L.append(md(g.round(1)))
    df['tb'] = [tod_bucket(s) for s in df.pct_in]
    g = df.groupby(['side', 'tb']).agg(n=('k', 'size'), median_mult=('pct_mult', 'median')).reset_index()
    L.append('\n## Time of day of the best-% entry\n')
    L.append(md(g.round(1)))
    # best legs per root: the most common 3-leg schedule of each root's top-10 $ contracts
    L.append('\n## Best 3 non-overlapping legs, per root (the top-$ contract with entry |delta| <= 0.50)\n')
    rows = []
    for root, x in df[df.usd_delta_in <= 0.5].groupby('root'):
        y = x.sort_values('k3_usd', ascending=False).iloc[0]
        z = x[x.r == 1].sort_values('k3_usd', ascending=False)
        rows.append({'root': root, 'contract': y.contract, 'best 3 $': round(y.k3_usd), 'legs': y.k3_legs,
                     'best call': z.contract.iloc[0] if len(z) else '', 'call legs': z.k3_legs.iloc[0] if len(z) else ''})
    L.append(md(pd.DataFrame(rows)))
    return '\n'.join(L) + '\n'


if __name__ == '__main__':
    D = sys.argv[1]
    df = pd.concat([run(D, r) for r in sys.argv[2].split(',')], ignore_index=True)
    df.to_parquet(os.path.join(B.OUT, D, 'ceiling.parquet'), index=False)
    txt = report(D, df)
    open(os.path.join(HERE, 'results', f'CEILING_{D}.md'), 'w').write(txt)
    print(txt[:6000])
