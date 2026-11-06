"""STEP 2 - the HINDSIGHT CEILING of 2026-11-05 SPXW 0DTE: for every contract, the best long round trip that the
quotes would have let you execute (buy the ask in force at a fill second, sell the bid in force at a later fill
second), its size in % and $, its minutes; plus the best 2 and 3 non-overlapping round trips ($ objective, DP).

These are hindsight upper bounds: they choose both ends with knowledge of the whole day.

Execution in hindsight: an order decided at second d fills at the quote in force at d + 2 s (ask in / bid out). In
hindsight the decision second is free, so this only moves every fill 2 s after its decision and forbids fills before
09:30:02; a fill is allowed only on a quote with bid > 0, ask >= bid and (1-second data) displayed size >= 1. Exit fill
strictly after the entry fill. Resolution: 1-second NBBO where fetched (q1s/), else the 1-minute board (the NBBO in
force at each minute stamp; reported as such in the 'res' column).

  python3 ceiling.py 20261105  -> results/CEILING_<D>.md (+ results/ceiling_<D>.parquet, not committed)
"""
import math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import load  # noqa: E402

RES = os.path.join(HERE, 'results')
LAT = 2
FEE = 0.65


def series(D, k, r, ch):
    """(t seconds of fill, bid, ask, res) for one contract."""
    q = load.q1s(D, k, r)
    if q is not None:
        ok = (q['bid'] > 0) & (q['ask'] >= q['bid']) & (q['bs'] >= 1) & (q['as'] >= 1) & (q['s'] >= load.RTH0 + LAT) & (q['s'] <= load.RTH1)
        return q['s'][ok].astype(np.int64), q['bid'][ok].astype(float), q['ask'][ok].astype(float), '1s'
    c = ch
    ok = (c.bid.values > 0) & (c.ask.values >= c.bid.values) & (c.m.values >= 570) & (c.m.values <= 960)
    t = c.m.values[ok].astype(np.int64) * 60
    t = np.maximum(t, load.RTH0 + LAT)
    return t, c.bid.values[ok].astype(float), c.ask.values[ok].astype(float), '1m'


def best1(t, bid, ask, objective='usd'):
    """Best single round trip: entry i < exit j. objective 'usd' maximises bid_j - ask_i, 'pct' bid_j / ask_i."""
    n = len(t)
    if n < 2:
        return None
    best, bi, bj = -np.inf, -1, -1
    if objective == 'usd':
        cm = np.minimum.accumulate(ask[:-1])
        arg = np.zeros(n - 1, int)
        cur = 0
        for i in range(n - 1):
            if ask[i] < ask[cur]:
                cur = i
            arg[i] = cur
        gain = bid[1:] - cm
    else:
        la = np.log(ask[:-1])
        cm = np.minimum.accumulate(la)
        arg = np.zeros(n - 1, int)
        cur = 0
        for i in range(n - 1):
            if la[i] < la[cur]:
                cur = i
            arg[i] = cur
        gain = np.log(bid[1:]) - cm
    j = int(np.argmax(gain))
    i = int(arg[j])
    return {'i': i, 'j': j + 1, 'buy': ask[i], 'sell': bid[j + 1], 't_in': int(t[i]), 't_out': int(t[j + 1])}


def bestk(t, bid, ask, K=3):
    """Best K non-overlapping round trips maximising total $ (stock-trading DP with K transactions; a sell and the next
    buy may not share a quote second). Returns the legs (list of dicts) for each k = 1..K."""
    n = len(t)
    out = {}
    if n < 2:
        return out
    # compress: keep only quotes that are a local min of ask or local max of bid (exact for the DP)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    keep[1:-1] |= (ask[1:-1] <= ask[:-2]) & (ask[1:-1] <= ask[2:])
    keep[1:-1] |= (bid[1:-1] >= bid[:-2]) & (bid[1:-1] >= bid[2:])
    ix = np.flatnonzero(keep)
    tt, bb, aa = t[ix], bid[ix], ask[ix]
    m = len(ix)
    NEG = -1e18
    for kk in range(1, K + 1):
        # hold[j] best value holding after j buys; free[j] best value flat after j sells; with back-pointers
        hold = np.full(kk + 1, NEG); free = np.full(kk + 1, NEG); free[0] = 0.0
        hb = [[None] * (kk + 1)]  # path pointers (store tuples)
        hold_path = [None] * (kk + 1)
        free_path = [None] * (kk + 1)
        free_path[0] = ()
        for i in range(m):
            nh, nf = hold.copy(), free.copy()
            nhp, nfp = list(hold_path), list(free_path)
            for j in range(1, kk + 1):
                # sell at i (must have bought strictly earlier: hold from previous step)
                v = hold[j] + bb[i]
                if hold[j] > NEG / 2 and v > nf[j]:
                    nf[j] = v
                    nfp[j] = hold_path[j] + (i,)
                # buy at i (after a sell strictly earlier)
                v = free[j - 1] - aa[i]
                if free[j - 1] > NEG / 2 and v > nh[j]:
                    nh[j] = v
                    nhp[j] = free_path[j - 1] + (i,)
            hold, free, hold_path, free_path = nh, nf, nhp, nfp
        j = int(np.argmax(free))
        p = free_path[j] or ()
        legs = []
        for a in range(0, len(p), 2):
            i0, i1 = p[a], p[a + 1]
            legs.append({'buy': float(aa[i0]), 'sell': float(bb[i1]), 't_in': int(tt[i0]), 't_out': int(tt[i1])})
        out[kk] = legs
    return out


def run(D):
    ch = load.chain(D)
    S0 = float(load.bars(D).o.iloc[0])
    ss, sp = load.spx(D)
    spx_at = lambda t: float(sp[max(np.searchsorted(ss, t, side='right') - 1, 0)])  # noqa: E731
    # the 09:30 greeks row is not valid (delta 0 or 1, IV 0): the entry delta of a 09:30 fill is read at 09:31
    dl = {(float(k), int(r), int(m)): float(d) for k, r, m, d in zip(ch.k, ch.r, ch.m, ch.delta)}
    rows = []
    for (k, r), c in ch.groupby(['k', 'r']):
        t, b, a, res = series(D, float(k), int(r), c)
        keep = t <= load.RTH1 - 1           # no fill on the 16:00:00 stamp (the bell)
        t, b, a = t[keep], b[keep], a[keep]
        if len(t) < 2:
            continue
        u = best1(t, b, a, 'usd')
        p = best1(t, b, a, 'pct')
        ks = bestk(t, b, a, 3)
        if u is None:
            continue
        g = u['sell'] - u['buy']
        sgn = 1 if r == 1 else -1
        row = {'k': float(k), 'r': int(r), 'res': res, 'mny_open': (float(k) / S0 - 1) * sgn,
               'open_ask': float(a[0]), 'close_bid': float(b[-1]), 'max_bid': float(b.max()), 'min_ask': float(a.min()),
               'usd_buy': u['buy'], 'usd_sell': u['sell'], 'usd_in': u['t_in'], 'usd_out': u['t_out'],
               'usd_gain': 100 * g - 2 * FEE, 'usd_pct': g / u['buy'],
               'usd_S_in': spx_at(u['t_in']), 'usd_S_out': spx_at(u['t_out']),
               'usd_delta_in': abs(dl.get((float(k), int(r), int(min(max(u['t_in'] // 60, 571), 959))), np.nan)),
               'pct_buy': p['buy'], 'pct_sell': p['sell'], 'pct_in': p['t_in'], 'pct_out': p['t_out'],
               'pct_mult': p['sell'] / p['buy'],
               'pct_delta_in': abs(dl.get((float(k), int(r), int(min(max(p['t_in'] // 60, 571), 959))), np.nan))}
        row['usd_mny_in'] = (float(k) / row['usd_S_in'] - 1) * sgn
        for kk, legs in ks.items():
            row[f'k{kk}_usd'] = sum(100 * (x['sell'] - x['buy']) - 2 * FEE for x in legs)
            row[f'k{kk}_legs'] = '; '.join(f"{load.clock(x['t_in'])[:5]} {x['buy']:.2f}->{load.clock(x['t_out'])[:5]} {x['sell']:.2f}"
                                           for x in legs)
        rows.append(row)
    return pd.DataFrame(rows)


def bucket_mny(x):
    edges = [-1, -0.04, -0.02, -0.01, -0.005, 0.0, 0.005, 0.01, 0.02, 0.04, 1]
    names = ['ITM>4%', 'ITM 2-4%', 'ITM 1-2%', 'ITM 0.5-1%', 'ITM 0-0.5%', 'OTM 0-0.5%', 'OTM 0.5-1%', 'OTM 1-2%',
             'OTM 2-4%', 'OTM>4%']
    return pd.cut(x, edges, labels=names)


def cname(x):
    return f"{x.k:g}{'C' if x.r else 'P'}"


def report(D, df):
    os.makedirs(RES, exist_ok=True)
    df.to_parquet(os.path.join(RES, f'ceiling_{D}.parquet'), index=False)
    L = []
    L.append(f'# Hindsight ceiling, SPXW 0DTE, {D[:4]}-{D[4:6]}-{D[6:]}\n')
    L.append('**HINDSIGHT UPPER BOUNDS, not strategies.** For every listed contract with an executable quote: the best '
             'long round trip = buy the ask in force at one fill second, sell the bid in force at a later fill second '
             '(+2 s latency: no fill before 09:30:02; none on the 16:00:00 bell stamp), 1 contract, $0.65/side in the $ '
             'figures. Both ends are chosen knowing the whole day: this is what was THERE, not what was knowable. '
             '`res` = quote resolution (1s = 1-second NBBO with displayed size >= 1 on both sides; 1m = the NBBO in force '
             'at each 1-minute stamp, which misses sub-minute extremes, so 1m ceilings are LOWER bounds of the true ceiling).\n')
    n1 = (df.res == '1s').sum()
    L.append(f'Contracts: {len(df)} ({n1} on 1-second NBBO, {len(df) - n1} on the 1-minute board). SPX 7678.72 -> 7354.64.\n')
    L.append('Deep in-the-money contracts make the most dollars per lot simply because they are SPX itself (a 1.0-delta put '
             f'on a 325-point fall is ~$32k); the largest $ ceiling of all is {cname(df.loc[df.usd_gain.idxmax()])} '
             f'(${df.usd_gain.max():,.0f}, {100 * df.loc[df.usd_gain.idxmax()].usd_pct:.0f}% on ${100 * df.loc[df.usd_gain.idxmax()].usd_buy:,.0f} '
             'of premium). The tables below therefore rank (1) contracts whose best entry was NOT in the money '
             '(|delta| <= 0.50 at the entry minute) by $, and (2) all contracts by multiple.\n')
    nt = df[df.usd_delta_in <= 0.50]
    top = nt.sort_values('usd_gain', ascending=False).head(15)
    L.append('## 1. Top 15 by best single trade, $ per 1 lot, entry |delta| <= 0.50\n')
    L.append('| # | contract | res | entry delta | buy ask | at (SPX) | sell bid | at (SPX) | min | $ net | multiple | best 2 trades $ | best 3 trades: legs |')
    L.append('|---:|---|---|---:|---:|---|---:|---|---:|---:|---:|---:|---|')
    for i, (_, x) in enumerate(top.iterrows(), 1):
        L.append(f"| {i} | {cname(x)} | {x.res} | {x.usd_delta_in:.2f} | {x.usd_buy:.2f} | {load.clock(x.usd_in)} ({x.usd_S_in:.0f}) | "
                 f"{x.usd_sell:.2f} | {load.clock(x.usd_out)} ({x.usd_S_out:.0f}) | {(x.usd_out - x.usd_in) / 60:.0f} | {x.usd_gain:,.0f} | "
                 f"{x.usd_sell / x.usd_buy:,.1f}x | {x.k2_usd:,.0f} | {x.k3_legs} |")
    topp = df[df.pct_buy >= 0.10].sort_values('pct_mult', ascending=False).head(15)
    L.append('\n## 2. Top 15 by best multiple (entry ask >= $0.10)\n')
    L.append('| # | contract | res | entry delta | buy | at | sell | at | multiple | $ on 1 lot |')
    L.append('|---:|---|---|---:|---:|---|---:|---|---:|---:|')
    for i, (_, x) in enumerate(topp.iterrows(), 1):
        L.append(f"| {i} | {cname(x)} | {x.res} | {x.pct_delta_in:.3f} | {x.pct_buy:.2f} | {load.clock(x.pct_in)} | "
                 f"{x.pct_sell:.2f} | {load.clock(x.pct_out)} | {x.pct_mult:,.0f}x | {100 * (x.pct_sell - x.pct_buy) - 1.3:,.0f} |")
    calls = df[df.r == 1].sort_values('pct_mult', ascending=False)
    L.append('\n## 3. Calls (the counter-trend legs): top 10 by multiple, entry ask >= $0.10\n')
    L.append('| contract | res | buy | at (SPX) | sell | at (SPX) | multiple | $ | best 3 legs |')
    L.append('|---|---|---:|---|---:|---|---:|---:|---|')
    for _, x in calls[calls.pct_buy >= 0.10].head(10).iterrows():
        L.append(f"| {cname(x)} | {x.res} | {x.pct_buy:.2f} | {load.clock(x.pct_in)} | {x.pct_sell:.2f} | {load.clock(x.pct_out)} | "
                 f"{x.pct_mult:,.1f}x | {100 * (x.pct_sell - x.pct_buy) - 1.3:,.0f} | {x.k3_legs} |")
    df = df.assign(side=np.where(df.r == 1, 'call', 'put'), mb=bucket_mny(df.mny_open),
                   hr_in=(df.usd_in // 1800) * 1800, hr_out=(df.usd_out // 1800) * 1800)
    L.append('\n## 4. Where the money was: side x moneyness at the 09:30 open\n')
    L.append('Sum over contracts of each one\'s best single trade (1 lot). "$ per $" = sum of best $ / sum of the entry premiums.\n')
    g = df.groupby(['side', 'mb'], observed=True).agg(n=('k', 'size'), usd=('usd_gain', 'sum'), prem=('usd_buy', 'sum'),
                                                      med=('pct_mult', 'median'), best=('usd_gain', 'max'),
                                                      ge10x=('pct_mult', lambda v: int((v >= 10).sum())),
                                                      ge100x=('pct_mult', lambda v: int((v >= 100).sum())))
    L.append('| side | moneyness at 09:30 | contracts | sum of best $ | $ per $ | median best multiple | max $ | >= 10x | >= 100x |')
    L.append('|---|---|---:|---:|---:|---:|---:|---:|---:|')
    for (s_, m), x in g.iterrows():
        L.append(f'| {s_} | {m} | {x.n} | {x.usd:,.0f} | {x.usd / (100 * x.prem):.2f} | {x.med:,.1f}x | {x.best:,.0f} | {x.ge10x} | {x.ge100x} |')
    tot = df.groupby('side').usd_gain.sum()
    L.append(f"\nTotal of best single trades: calls ${tot.get('call', 0):,.0f}, puts ${tot.get('put', 0):,.0f}.\n")
    L.append('## 5. When: the best trades\' entry and exit times (30-minute buckets; entry |delta| <= 0.50 contracts)\n')
    L.append('| bucket | puts bought | puts $ | calls bought | calls $ | puts sold | calls sold |')
    L.append('|---|---:|---:|---:|---:|---:|---:|')
    dn = df[df.usd_delta_in <= 0.50]
    for h in range(load.RTH0, load.RTH1, 1800):
        pi = dn[(dn.side == 'put') & (dn.hr_in == h)]; ci = dn[(dn.side == 'call') & (dn.hr_in == h)]
        po = dn[(dn.side == 'put') & (dn.hr_out == h)]; co = dn[(dn.side == 'call') & (dn.hr_out == h)]
        L.append(f'| {load.clock(h)[:5]} | {len(pi)} | {pi.usd_gain.sum():,.0f} | {len(ci)} | {ci.usd_gain.sum():,.0f} | {len(po)} | {len(co)} |')
    add2 = (df.k2_usd - df.k1_usd).sum(); add3 = (df.k3_usd - df.k2_usd).sum()
    L.append(f'\nAcross all contracts the best 2 trades add ${add2:,.0f} over the best single trades and a third adds ${add3:,.0f} '
             '(the 2nd/3rd legs of each contract are in table 1).\n')
    open(os.path.join(RES, f'CEILING_{D}.md'), 'w').write('\n'.join(L) + '\n')
    return '\n'.join(L)


if __name__ == '__main__':
    D = sys.argv[1]
    df = run(D)
    print(report(D, df))
