"""NOV5 tape fetcher: resumable, atomic, one terminal request in flight.

  python3 fetch_tape.py base 20261105          indices, OI (all expiries), prior EOD greeks, 0DTE 1m greeks + 1m OHLC
  python3 fetch_tape.py term 20261105          next two expiries' 1m greeks (strikes within +-8% of the open)
  python3 fetch_tape.py q1s 20261105 LO HI     1-second NBBO of every 0DTE contract with LO <= strike <= HI
  python3 fetch_tape.py trades 20261105        every 0DTE print (tick), per strike and right
  python3 fetch_tape.py probe 20261105         is the 1-second quote store for that day's 0DTE built yet? (exit 0 = yes)

Data: /home/user/falcon-cloud-field-sail/v2data/nov5-tape/<D>/ (budget 1 GB; stops when free disk < 3 GB).
Every file is written to <name>.tmp then renamed, so a restart resumes at the first missing file.
"""
import io, json, os, shutil, sys, time, urllib.error, urllib.parse, urllib.request
import numpy as np
import pandas as pd

BASE = 'http://127.0.0.1:25503/v3'
OUT = '/home/user/falcon-cloud-field-sail/v2data/nov5-tape'
MIN_FREE = 3.0e9
BUDGET = 1.0e9


class NoData(Exception):
    pass


def disk_ok():
    free = shutil.disk_usage('/').free
    used = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    if free < MIN_FREE or used > BUDGET:
        print(f'STOP disk: free {free / 1e9:.2f} GB, used {used / 1e6:.0f} MB', flush=True)
        return False
    return True


def get(path, params, timeout=300, tries=6, nodata_tries=2):
    """The terminal answers 'No data' spuriously under load (seen 2026-11-06: 1 in 3 reads of a strike that has
    data), so a 'No data' is believed only after nodata_tries answers in a row."""
    for n in range(nodata_tries):
        try:
            return _get(path, params, timeout, tries)
        except NoData:
            if n == nodata_tries - 1:
                raise
            time.sleep(1.5)


def _get(path, params, timeout=300, tries=6):
    q = dict(params)
    q.setdefault('format', 'csv')
    url = f'{BASE}{path}?{urllib.parse.urlencode(q)}'
    last = None
    for a in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                body = r.read()
            if body.startswith(b'No data') or not body.strip():
                raise NoData(url)
            return body
        except urllib.error.HTTPError as e:
            body = e.read()[:200]
            if e.code in (472,) or b'No data' in body or b'No ' in body[:4]:
                raise NoData(url) from None
            last = f'HTTP {e.code} {body!r}'
            if e.code in (400, 404):
                raise RuntimeError(f'{url}: {last}') from None
        except NoData:
            raise
        except Exception as e:  # terminal busy / restarting: back off gently
            last = repr(e)
        time.sleep(min(120, 5 * 2 ** a))
    raise RuntimeError(f'terminal failed: {url}: {last}')


def csv(path, params, **kw):
    return pd.read_csv(io.BytesIO(get(path, params, **kw)))


def put(df, f):
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if f.endswith('.parquet'):
        tmp = f + '.tmp'
        df.to_parquet(tmp, compression='zstd', index=False)
    else:
        tmp = f[:-4] + '.tmp.npz'
        np.savez_compressed(tmp, **df)
    os.replace(tmp, f)


def ms_of(ts):
    t = pd.to_datetime(ts)
    return ((t.dt.hour * 3600 + t.dt.minute * 60 + t.dt.second) * 1000 + t.dt.microsecond // 1000).astype('int64').values


def strikes(exp):
    d = csv('/option/list/strikes', {'symbol': 'SPXW', 'expiration': exp})
    return sorted(float(x) for x in d.strike)


def expirations():
    d = csv('/option/list/expirations', {'symbol': 'SPXW'})
    return sorted(str(x).replace('-', '') for x in d.expiration)


PASS = {'final': True, 'missed': 0}


def job(f, fn):
    """Fetch one file unless present. A 'No data' answer is only written (as an empty file) on the final pass: the
    terminal gives spurious 'No data' under load, so callers run several passes (see passes())."""
    if os.path.exists(f):
        return True
    if not disk_ok():
        return False
    t0 = time.time()
    try:
        df = fn()
    except NoData:
        if not PASS['final']:
            PASS['missed'] += 1
            return True
        df = pd.DataFrame() if f.endswith('.parquet') else None
    if df is None:
        df = {'empty': np.zeros(0)}
    put(df, f)
    print(f'{time.strftime("%H:%M:%S")} {os.path.relpath(f, OUT)} {time.time() - t0:.1f}s', flush=True)
    return True


def base(D):
    d = os.path.join(OUT, D)
    prior = {'20261105': '20261104', '20261104': '20261103'}[D]
    for sym, iv in (('SPX', '1s'), ('VIX', '1s'), ('VIX1D', '1m'), ('VIX9D', '1m'), ('VIX3M', '1m')):
        job(os.path.join(d, f'idx_{sym}_{iv}.parquet'),
            lambda sym=sym, iv=iv: (lambda p: pd.DataFrame({'ms': ms_of(p.timestamp), 'px': p.price.astype('float64')}))(
                csv('/index/history/price', {'symbol': sym, 'date': D, 'interval': iv})))
    job(os.path.join(d, 'spy_q1s.parquet'), lambda: (lambda q: pd.DataFrame({
        'ms': ms_of(q.timestamp), 'bid': q.bid.astype('float32'), 'ask': q.ask.astype('float32'),
        'bs': q.bid_size.astype('int32'), 'as': q.ask_size.astype('int32')}))(
        csv('/stock/history/quote', {'symbol': 'SPY', 'date': D, 'interval': '1s'}, timeout=600)))
    job(os.path.join(d, 'oi_all.parquet'), lambda: (lambda o: pd.DataFrame({
        'exp': o.expiration.astype(str).str.replace('-', '').astype(int), 'k': o.strike.astype('float32'),
        'r': np.where(o.right.str.upper().str.startswith('C'), 1, 0).astype('int8'),
        'oi': o.open_interest.astype('int64'), 'stamp': o.timestamp.astype(str)}))(
        csv('/option/history/open_interest', {'symbol': 'SPXW', 'expiration': '*', 'date': D}, timeout=600)))
    job(os.path.join(d, 'oi_spx_am.parquet'), lambda: (lambda o: pd.DataFrame({
        'exp': o.expiration.astype(str).str.replace('-', '').astype(int), 'k': o.strike.astype('float32'),
        'r': np.where(o.right.str.upper().str.startswith('C'), 1, 0).astype('int8'),
        'oi': o.open_interest.astype('int64')}))(
        csv('/option/history/open_interest', {'symbol': 'SPX', 'expiration': '*', 'date': D}, timeout=600)))
    for root in ('SPXW', 'SPX'):
        job(os.path.join(d, f'eodgreeks_prior_{root}.parquet'), lambda root=root: (lambda g: pd.DataFrame({
            'exp': g.expiration.astype(str).str.replace('-', '').astype(int), 'k': g.strike.astype('float32'),
            'r': np.where(g.right.str.upper().str.startswith('C'), 1, 0).astype('int8'),
            'bid': g.bid.astype('float32'), 'ask': g.ask.astype('float32'), 'close': g.close.astype('float32'),
            'volume': g.volume.astype('int64'), 'delta': g.delta.astype('float32'), 'gamma': g.gamma.astype('float64'),
            'iv': g.implied_vol.astype('float32'), 'und': g.underlying_price.astype('float32')}))(
            csv('/option/history/greeks/eod', {'symbol': root, 'expiration': '*', 'start_date': prior, 'end_date': prior,
                                               'max_dte': 35}, timeout=600)))
    chain_1m(D, D, os.path.join(d, f'g1m_{D}'))


def full(fn, n=391, tries=4):
    """A 1-minute day has 391 rows (09:30..16:00); the terminal sometimes ends a stream early -> re-read."""
    best = None
    for _ in range(tries):
        df = fn()
        if len(df) >= n:
            return df
        best = df if best is None or len(df) > len(best) else best
        time.sleep(1.5)
    print('short read', len(best), flush=True)
    return best


def chain_1m(D, exp, prefix, band=None, ohlc=True):
    ks = strikes(exp)
    if band:
        ks = [k for k in ks if band[0] <= k <= band[1]]
    parts = prefix + '_parts'
    for k in ks:
        for r in ('call', 'put'):
            ok = job(os.path.join(parts, f'g_{k:g}{r[0]}.parquet'), lambda k=k, r=r: full(lambda: (lambda g: pd.DataFrame({
                'k': np.float32(k), 'r': np.int8(r == 'call'),
                'm': (ms_of(g.timestamp) // 60000).astype('int16'), 'bid': g.bid.astype('float32'), 'ask': g.ask.astype('float32'),
                'delta': g.delta.astype('float32'), 'vega': g.vega.astype('float32'), 'theta': g.theta.astype('float32'),
                'iv': g.implied_vol.astype('float32'), 'und': g.underlying_price.astype('float32')}))(
                csv('/option/history/greeks/first_order', {'symbol': 'SPXW', 'expiration': exp, 'strike': f'{k:g}',
                                                            'right': r, 'date': D, 'interval': '1m'}))))
            if not ok:
                return
            if ohlc:
                ok = job(os.path.join(parts, f'o_{k:g}{r[0]}.parquet'), lambda k=k, r=r: full(lambda: (lambda o: pd.DataFrame({
                    'k': np.float32(k), 'r': np.int8(r == 'call'), 'm': (ms_of(o.timestamp) // 60000).astype('int16'),
                    'o': o.open.astype('float32'), 'h': o.high.astype('float32'), 'l': o.low.astype('float32'),
                    'c': o.close.astype('float32'), 'v': o.volume.astype('int32'), 'n': o['count'].astype('int32'),
                    'vwap': pd.to_numeric(o.vwap, errors='coerce').astype('float32')}))(
                    csv('/option/history/ohlc', {'symbol': 'SPXW', 'expiration': exp, 'strike': f'{k:g}', 'right': r,
                                                 'date': D, 'interval': '1m'}))))
                if not ok:
                    return
    # merge
    g = [pd.read_parquet(os.path.join(parts, f)) for f in sorted(os.listdir(parts)) if f.startswith('g_') and f.endswith('.parquet')]
    put(pd.concat([x for x in g if len(x)], ignore_index=True), prefix + '_greeks.parquet')
    if ohlc:
        o = [pd.read_parquet(os.path.join(parts, f)) for f in sorted(os.listdir(parts)) if f.startswith('o_') and f.endswith('.parquet')]
        put(pd.concat([x for x in o if len(x)], ignore_index=True), prefix + '_ohlc.parquet')
    print('merged', prefix, flush=True)


def term(D):
    d = os.path.join(OUT, D)
    spx = pd.read_parquet(os.path.join(d, 'idx_SPX_1s.parquet'))
    px = spx[spx.px > 0].px
    lo, hi = float(px.min()) * 0.985, float(px.max()) * 1.015   # the day's range +-1.5%: ATM IV and the 25-delta wings
    ex = [e for e in expirations() if e > D][:1]
    for e in ex:
        chain_1m(D, e, os.path.join(d, f'g1m_{e}'), band=(lo, hi), ohlc=False)


def probe(D, k=None):
    k = k or ('7500' if D == '20261105' else '7600')
    try:
        get('/option/history/quote', {'symbol': 'SPXW', 'expiration': D, 'strike': k, 'right': 'put', 'date': D,
                                      'interval': '1s', 'start_time': '10:00:00', 'end_time': '10:00:05'}, tries=1)
        return True
    except (NoData, RuntimeError):
        return False


def q1s(D, lo, hi):
    d = os.path.join(OUT, D, 'q1s')
    ks = [k for k in strikes(D) if lo <= k <= hi]
    # liquid first: nearest the day's mid-range out
    spx = pd.read_parquet(os.path.join(OUT, D, 'idx_SPX_1s.parquet'))
    mid = float(spx[spx.px > 0].px.median())
    ks.sort(key=lambda k: abs(k - mid))
    for k in ks:
        for r in ('put', 'call'):
            def fn(k=k, r=r):
                q = full(lambda: csv('/option/history/quote', {'symbol': 'SPXW', 'expiration': D, 'strike': f'{k:g}',
                                                               'right': r, 'date': D, 'interval': '1s'}, timeout=300),
                         n=23000)
                return {'s': (ms_of(q.timestamp) // 1000).astype(np.int32), 'bid': q.bid.values.astype(np.float32),
                        'ask': q.ask.values.astype(np.float32), 'bs': q.bid_size.values.astype(np.int32),
                        'as': q.ask_size.values.astype(np.int32)}
            if not job(os.path.join(d, f'{k:g}{r[0].upper()}.npz'), fn):
                return


def trades(D, lo=0, hi=1e9):
    d = os.path.join(OUT, D, 'trades_parts')
    for k in [k for k in strikes(D) if lo <= k <= hi]:
        for r in ('put', 'call'):
            def fn(k=k, r=r):
                t = csv('/option/history/trade_quote', {'symbol': 'SPXW', 'expiration': D, 'strike': f'{k:g}', 'right': r,
                                                        'date': D}, timeout=300)
                return pd.DataFrame({'k': np.float32(k), 'r': np.int8(r == 'call'), 'ms': ms_of(t.trade_timestamp),
                                     'px': t.price.astype('float32'), 'size': t['size'].astype('int32'),
                                     'cond': t.condition.astype('int16'), 'exch': t.exchange.astype('int16'),
                                     'bid': t.bid.astype('float32'), 'ask': t.ask.astype('float32'),
                                     'bs': t.bid_size.astype('int32'), 'as': t.ask_size.astype('int32')})
            if not job(os.path.join(d, f'{k:g}{r[0].upper()}.parquet'), fn):
                return
    t = [pd.read_parquet(os.path.join(d, f)) for f in sorted(os.listdir(d)) if f.endswith('.parquet')]
    put(pd.concat([x for x in t if len(x)], ignore_index=True).sort_values('ms', kind='stable'),
        os.path.join(OUT, D, 'trades_0dte.parquet'))
    print('merged trades', flush=True)


def passes(fn, n=4):
    """Run fn n times; only the last pass believes 'No data'. Stops early when a pass misses nothing."""
    for i in range(n):
        PASS['final'] = i == n - 1
        PASS['missed'] = 0
        fn()
        print(f'pass {i + 1}/{n}: {PASS["missed"]} no-data answers deferred', flush=True)
        if not PASS['missed'] and i < n - 1:
            PASS['final'] = True
            fn()
            return
        time.sleep(20 * (i + 1))


if __name__ == '__main__':
    cmd, D = sys.argv[1], sys.argv[2]
    if cmd == 'base':
        passes(lambda: base(D))
    elif cmd == 'term':
        passes(lambda: term(D))
    elif cmd == 'q1s':
        passes(lambda: q1s(D, float(sys.argv[3]), float(sys.argv[4])), n=3)
    elif cmd == 'trades':
        passes(lambda: trades(D, float(sys.argv[3]), float(sys.argv[4])), n=3)
    elif cmd == 'probe':
        sys.exit(0 if probe(D) else 1)
