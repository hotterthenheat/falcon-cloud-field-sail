"""NOV5-BROAD fetcher: SPY / QQQ / IWM / single names (and SPXW extras) for one day. Resumable, atomic, at most one
terminal request in flight per process (run at most two processes).

  python3 fetch_broad.py base D ROOT        underlying 1 s NBBO, OI (all expiries), 1-minute greeks + OHLC of the
                                            0DTE and the next expiry (names: the nearest expiry on/after D)
  python3 fetch_broad.py q1s D ROOT [band]  1-second NBBO of every traded contract of the first expiry with strike in
                                            [day low x (1-band), day high x (1+band)] (default band 0.03)
  python3 fetch_broad.py trades D ROOT [band]   every print (trade_quote, with the NBBO in force), same contracts
  python3 fetch_broad.py idx D              VIX / VIX1D / VIX9D 1 s and 1 m (SPX 1 s) for days not in nov5-tape

Data: /home/user/falcon-cloud-field-sail/v2data/nov5-broad/<D>/<ROOT>/ (budget 1 GB; stops below 2.5 GB free).
Reuses nov5-tape/fetch_tape.py (the terminal client that survives spurious 'No data' and truncated streams).
"""
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'nov5-tape'))
import fetch_tape as FT  # noqa: E402

FT.OUT = '/home/user/falcon-cloud-field-sail/v2data/nov5-broad'
FT.MIN_FREE = 2.5e9
FT.BUDGET = 1.0e9
OUT = FT.OUT
ETF = ('SPY', 'QQQ', 'IWM', 'SPXW')


def rdir(D, root):
    return os.path.join(OUT, D, root)


def expirations(root):
    d = FT.csv('/option/list/expirations', {'symbol': root})
    return sorted(str(x).replace('-', '') for x in d.expiration)


def exps_for(D, root):
    ex = [e for e in expirations(root) if e >= D]
    if root in ETF:
        return ex[:2] if ex and ex[0] == D else ex[:1]
    return ex[:1]


def und_1s(D, root):
    sym = {'SPXW': 'SPY'}.get(root, root)
    q = FT.csv('/stock/history/quote', {'symbol': sym, 'date': D, 'interval': '1s'}, timeout=600)
    return pd.DataFrame({'ms': FT.ms_of(q.timestamp), 'bid': q.bid.astype('float32'), 'ask': q.ask.astype('float32'),
                         'bs': q.bid_size.astype('int32'), 'as': q.ask_size.astype('int32')})


def g1m_wild(D, root, exp):
    """Whole-expiry 1-minute greeks in one read; contracts with fewer than 391 rows are re-read one by one."""
    g = FT.csv('/option/history/greeks/first_order', {'symbol': root, 'expiration': exp, 'strike': '*', 'date': D,
                                                       'interval': '1m'}, timeout=600)
    df = pd.DataFrame({'k': g.strike.astype('float32'), 'r': g.right.str.upper().str.startswith('C').astype('int8'),
                       'm': (FT.ms_of(g.timestamp) // 60000).astype('int16'), 'bid': g.bid.astype('float32'),
                       'ask': g.ask.astype('float32'), 'delta': g.delta.astype('float32'),
                       'vega': g.vega.astype('float32'), 'theta': g.theta.astype('float32'),
                       'iv': g.implied_vol.astype('float32'), 'und': g.underlying_price.astype('float32')})
    n = df.groupby(['k', 'r']).size()
    short = n[n < 391]
    if len(short):
        print(f'{root} {exp}: {len(short)} short contracts, re-reading one by one', flush=True)
        keep = df.set_index(['k', 'r']).drop(index=short.index).reset_index()
        parts = [keep]
        for (k, r) in short.index:
            gg = FT.full(lambda k=k, r=r: FT.csv('/option/history/greeks/first_order', {
                'symbol': root, 'expiration': exp, 'strike': f'{k:g}', 'right': 'call' if r else 'put', 'date': D,
                'interval': '1m'}))
            parts.append(pd.DataFrame({'k': np.float32(k), 'r': np.int8(r), 'm': (FT.ms_of(gg.timestamp) // 60000).astype('int16'),
                                       'bid': gg.bid.astype('float32'), 'ask': gg.ask.astype('float32'),
                                       'delta': gg.delta.astype('float32'), 'vega': gg.vega.astype('float32'),
                                       'theta': gg.theta.astype('float32'), 'iv': gg.implied_vol.astype('float32'),
                                       'und': gg.underlying_price.astype('float32')}))
        df = pd.concat(parts, ignore_index=True)
    return df.sort_values(['k', 'r', 'm']).reset_index(drop=True)


def ohlc_wild(D, root, exp):
    o = FT.csv('/option/history/ohlc', {'symbol': root, 'expiration': exp, 'strike': '*', 'date': D, 'interval': '1m'},
               timeout=600)
    return pd.DataFrame({'k': o.strike.astype('float32'), 'r': o.right.str.upper().str.startswith('C').astype('int8'),
                         'm': (FT.ms_of(o.timestamp) // 60000).astype('int16'), 'o': o.open.astype('float32'),
                         'h': o.high.astype('float32'), 'l': o.low.astype('float32'), 'c': o.close.astype('float32'),
                         'v': o.volume.astype('int32'), 'n': o['count'].astype('int32'),
                         'vwap': pd.to_numeric(o.vwap, errors='coerce').astype('float32')})


def oi_all(D, root):
    o = FT.csv('/option/history/open_interest', {'symbol': root, 'expiration': '*', 'date': D}, timeout=600)
    return pd.DataFrame({'exp': o.expiration.astype(str).str.replace('-', '').astype(int), 'k': o.strike.astype('float32'),
                         'r': np.where(o.right.str.upper().str.startswith('C'), 1, 0).astype('int8'),
                         'oi': o.open_interest.astype('int64'), 'stamp': o.timestamp.astype(str)})


def base(D, root):
    d = rdir(D, root)
    if root != 'SPXW':
        FT.job(os.path.join(d, 'und_1s.parquet'), lambda: und_1s(D, root))
    FT.job(os.path.join(d, 'oi_all.parquet'), lambda: oi_all(D, root))
    for e in exps_for(D, root):
        FT.job(os.path.join(d, f'g1m_{e}.parquet'), lambda e=e: g1m_wild(D, root, e))
        FT.job(os.path.join(d, f'ohlc_{e}.parquet'), lambda e=e: ohlc_wild(D, root, e))


def band_contracts(D, root, band):
    d = rdir(D, root)
    e = exps_for(D, root)[0]
    u = pd.read_parquet(os.path.join(d, 'und_1s.parquet')) if root != 'SPXW' else None
    if u is not None:
        mid = ((u.bid + u.ask) / 2)[(u.bid > 0) & (u.ask > 0)]
        lo, hi = float(mid.min()), float(mid.max())
    else:
        s = pd.read_parquet(os.path.join(OUT, '..', 'nov5-tape', D, 'idx_SPX_1s.parquet'))
        lo, hi = float(s[s.px > 0].px.min()), float(s[s.px > 0].px.max())
    o = pd.read_parquet(os.path.join(d, f'ohlc_{e}.parquet'))
    v = o.groupby(['k', 'r']).v.sum()
    v = v[v > 0]
    ks = [(float(k), int(r)) for (k, r) in v.index if lo * (1 - band) <= k <= hi * (1 + band)]
    c = (lo + hi) / 2
    ks.sort(key=lambda x: abs(x[0] - c))
    return e, ks


def q1s(D, root, band):
    e, ks = band_contracts(D, root, band)
    d = os.path.join(rdir(D, root), f'q1s_{e}')
    for k, r in ks:
        def fn(k=k, r=r):
            q = FT.full(lambda: FT.csv('/option/history/quote', {'symbol': root, 'expiration': e, 'strike': f'{k:g}',
                                                                 'right': 'call' if r else 'put', 'date': D,
                                                                 'interval': '1s'}, timeout=300), n=23000)
            return {'s': (FT.ms_of(q.timestamp) // 1000).astype(np.int32), 'bid': q.bid.values.astype(np.float32),
                    'ask': q.ask.values.astype(np.float32), 'bs': q.bid_size.values.astype(np.int32),
                    'as': q.ask_size.values.astype(np.int32)}
        if not FT.job(os.path.join(d, f'{k:g}{"C" if r else "P"}.npz'), fn):
            return


def trades(D, root, band):
    e, ks = band_contracts(D, root, band)
    d = os.path.join(rdir(D, root), f'trades_{e}_parts')
    for k, r in ks:
        def fn(k=k, r=r):
            t = FT.csv('/option/history/trade_quote', {'symbol': root, 'expiration': e, 'strike': f'{k:g}',
                                                       'right': 'call' if r else 'put', 'date': D}, timeout=300)
            return pd.DataFrame({'k': np.float32(k), 'r': np.int8(r), 'ms': FT.ms_of(t.trade_timestamp),
                                 'px': t.price.astype('float32'), 'size': t['size'].astype('int32'),
                                 'cond': t.condition.astype('int16'), 'exch': t.exchange.astype('int16'),
                                 'bid': t.bid.astype('float32'), 'ask': t.ask.astype('float32'),
                                 'bs': t.bid_size.astype('int32'), 'as': t.ask_size.astype('int32')})
        if not FT.job(os.path.join(d, f'{k:g}{"C" if r else "P"}.parquet'), fn):
            return
    fs = [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.parquet')]
    t = [pd.read_parquet(f) for f in fs]
    FT.put(pd.concat([x for x in t if len(x)], ignore_index=True).sort_values('ms', kind='stable'),
           os.path.join(rdir(D, root), f'trades_{e}.parquet'))
    print('merged trades', root, flush=True)


def idx(D):
    d = os.path.join(OUT, D, 'IDX')
    for sym, iv in (('SPX', '1s'), ('VIX', '1s'), ('VIX1D', '1m'), ('VIX9D', '1m'), ('VIX3M', '1m'), ('VXN', '1m'), ('RVX', '1m')):
        FT.job(os.path.join(d, f'idx_{sym}_{iv}.parquet'),
               lambda sym=sym, iv=iv: (lambda p: pd.DataFrame({'ms': FT.ms_of(p.timestamp), 'px': p.price.astype('float64')}))(
                   FT.csv('/index/history/price', {'symbol': sym, 'date': D, 'interval': iv})))


if __name__ == '__main__':
    cmd, D = sys.argv[1], sys.argv[2]
    if cmd == 'idx':
        FT.passes(lambda: idx(D))
        sys.exit(0)
    root = sys.argv[3]
    band = float(sys.argv[4]) if len(sys.argv) > 4 else 0.03
    if cmd == 'base':
        FT.passes(lambda: base(D, root))
    elif cmd == 'q1s':
        FT.passes(lambda: q1s(D, root, band), n=3)
    elif cmd == 'trades':
        FT.passes(lambda: trades(D, root, band), n=3)
