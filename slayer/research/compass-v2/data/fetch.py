"""Build the Compass v2 event-time store for a list of sessions.

    python3 -m data.fetch --sessions 20240417,20231027 [--roots SPXW,SPY,QQQ] [--no-uw]

Per session D and root R (0DTE = first expiration >= D, 1DTE = the next one):
  greeks_1m   option/history/greeks/first_order, strike=*, 1-minute (delta, iv, underlying) — selection + context
  oi          option/history/open_interest (the morning report = the previous close)
  quotes      option/history/quote interval=100ms for every contract whose |delta| was inside [DMIN, DMAX] at any
              minute of the session, de-duplicated to state changes. A row stamped T is the NBBO in force at T
              (verified against the tick tape: scratch/interval_semantics.py, 100% match), so a change is seen at
              most 100 ms late and never early.
  trades      option/history/trade_quote, strike=* (every OPRA print with the NBBO in force), tick level.
Underlying: SPY/QQQ stock NBBO at 100 ms (de-duplicated) + every stock trade; SPX index price (1 s, its native rate).
UW (sessions >= 2023-12-06 only, the key's history floor): flow alerts and per-minute spot GEX for SPY, QQQ, SPX.

Prices are int32 cents for options (tick >= $0.01) and int32 1/10000 dollars for stock/index. Timestamps are int32 milliseconds since midnight ET of the session. Everything is parquet/zstd.
Layout: V2DATA/sessions/D/{R}_{quotes,trades,greeks_1m,oi}.parquet, D/und_{SPY,QQQ}_{quotes,trades}.parquet,
D/und_SPX_price.parquet, D/uw_*.parquet, D/_manifest.json (sizes, counts, contracts, timings).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from data.clients import NoData, theta_get, uw_get  # noqa: E402

V2DATA = os.environ.get('V2DATA', '/home/user/falcon-cloud-field-sail/v2data')
DMIN, DMAX = 0.10, 0.60
UW_FLOOR = '20231206'
UND = {'SPXW': ('index', 'SPX'), 'SPY': ('stock', 'SPY'), 'QQQ': ('stock', 'QQQ')}


def ms_of_day(s: pd.Series) -> np.ndarray:
    """'2024-04-17T09:30:00.100' -> 34200100 (ms since midnight, the stamp's own clock = ET)."""
    v = s.astype(str).str
    return (v[11:13].astype(int) * 3_600_000 + v[14:16].astype(int) * 60_000 + v[17:19].astype(int) * 1000
            + v[20:23].str.ljust(3, '0').replace('', '0').astype(int)).astype('int32').values


def cents(x) -> np.ndarray:
    return np.round(np.asarray(x, dtype=float) * 100).astype('int32')


def ticks4(x) -> np.ndarray:
    return np.round(np.asarray(x, dtype=float) * 10000).astype('int32')


DELTA_COLS = ('ms', 'qms', 'bid', 'ask', 'bs', 'as', 'px', 'size')


def write(tab: pa.Table, path: str) -> int:
    """parquet/zstd-9; integer time/price/size columns delta-encoded (halves the quote files)."""
    tmp = path + '.tmp'
    enc = {c: 'DELTA_BINARY_PACKED' for c in tab.column_names if c in DELTA_COLS and pa.types.is_integer(tab.schema.field(c).type)}
    pq.write_table(tab, tmp, compression='zstd', compression_level=9,
                   use_dictionary=[c for c in tab.column_names if c not in enc], column_encoding=enc or None)
    os.replace(tmp, path)
    return os.path.getsize(path)


def thin_quotes(df: pd.DataFrame) -> pd.DataFrame:
    """Rows sorted by contract then ms, already de-duplicated. Keep every bid/ask PRICE change (100 ms resolution) and
    the first row of each second; a size-only change inside a second is dropped, so displayed sizes are at most ~1 s
    stale while prices are exact to 100 ms. (SPXW 2024-04-17: 18.2M rows -> 8.2M, 102 MB -> 30 MB.)"""
    if len(df) < 2:
        return df
    k = (df.exp.to_numpy().astype(np.int64) * 10**9 + df.strike.to_numpy().astype(np.int64) * 10 + (df.right.to_numpy() > 0))
    newc = np.r_[True, k[1:] != k[:-1]]
    b, a = df.bid.to_numpy(), df.ask.to_numpy()
    pc = np.r_[True, (b[1:] != b[:-1]) | (a[1:] != a[:-1])]
    sec = df.ms.to_numpy() // 1000
    news = np.r_[True, sec[1:] != sec[:-1]]
    return df[newc | pc | news]


def csv(path, params, **kw) -> pd.DataFrame:
    b = theta_get(path, params, **kw)
    if not b.strip():
        raise NoData(path)
    return pd.read_csv(io.BytesIO(b))


_exp_cache: dict = {}


def expirations(root: str) -> list[str]:
    if root not in _exp_cache:
        df = csv('/option/list/expirations', {'symbol': root})
        _exp_cache[root] = sorted(df.expiration.astype(str).str.replace('-', '').tolist())
    return _exp_cache[root]


def right_code(s: pd.Series) -> np.ndarray:
    return np.where(s.astype(str).str.upper().str.startswith('C'), 1, -1).astype('int8')


def dedupe(df: pd.DataFrame, cols) -> pd.DataFrame:
    """Keep the first row of each run of identical states (per contract when the frame is sorted by contract)."""
    keep = np.ones(len(df), bool)
    if len(df) > 1:
        same = np.ones(len(df) - 1, bool)
        for c in cols:
            v = df[c].values
            same &= v[1:] == v[:-1]
        keep[1:] = ~same
    return df[keep]


def fetch_root(D: str, root: str, out: str, man: dict, workers: int = 2):
    exps = [e for e in expirations(root) if e >= D][:2]
    man['roots'][root] = rm = {'expirations': exps, 'contracts': {}, 'bytes': {}, 'rows': {}}
    greeks, ois, trades, sel = [], [], [], []
    for e in exps:
        t0 = time.time()
        try:
            g = csv('/option/history/greeks/first_order', {'symbol': root, 'expiration': e, 'strike': '*', 'right': 'both',
                                                            'date': D, 'interval': '1m'}, timeout=900)
        except NoData:
            continue
        g = pd.DataFrame({'exp': np.int32(int(e)), 'strike': np.round(g.strike.values * 1000).astype('int32'),
                          'right': right_code(g.right), 'ms': ms_of_day(g.timestamp), 'bid': cents(g.bid), 'ask': cents(g.ask),
                          'delta': g.delta.astype('float32'), 'iv': g.implied_vol.astype('float32'),
                          'und': g.underlying_price.astype('float32')})
        greeks.append(g)
        ok = g[(g.delta.abs() >= DMIN) & (g.delta.abs() <= DMAX) & (g.bid > 0)]
        cs = ok[['exp', 'strike', 'right']].drop_duplicates()
        sel.append(cs)
        rm['contracts'][e] = len(cs)
        try:
            o = csv('/option/history/open_interest', {'symbol': root, 'expiration': e, 'date': D})
            ois.append(pd.DataFrame({'exp': np.int32(int(e)), 'strike': np.round(o.strike.values * 1000).astype('int32'),
                                     'right': right_code(o.right), 'oi': o.open_interest.astype('int32')}))
        except NoData:
            pass
        try:
            t = csv('/option/history/trade_quote', {'symbol': root, 'expiration': e, 'strike': '*', 'right': 'both', 'date': D},
                    timeout=900)
            trades.append(pd.DataFrame({
                'exp': np.int32(int(e)), 'strike': np.round(t.strike.values * 1000).astype('int32'), 'right': right_code(t.right),
                'ms': ms_of_day(t.trade_timestamp), 'qms': ms_of_day(t.quote_timestamp), 'px': cents(t.price),
                'size': t['size'].astype('int32'), 'cond': t.condition.astype('int16'), 'exch': t.exchange.astype('int16'),
                'bid': cents(t.bid), 'ask': cents(t.ask), 'bs': t.bid_size.astype('int32'), 'as': t.ask_size.astype('int32')}))
        except NoData:
            pass
        man['timing'][f'{root}_{e}_chain'] = round(time.time() - t0, 1)

    def put(name, frames, sort):
        if not frames:
            return
        df = pd.concat(frames, ignore_index=True).sort_values(sort, kind='stable')
        p = os.path.join(out, f'{root}_{name}.parquet')
        rm['bytes'][name] = write(pa.Table.from_pandas(df, preserve_index=False), p)
        rm['rows'][name] = len(df)

    put('greeks_1m', greeks, ['exp', 'strike', 'right', 'ms'])
    put('oi', ois, ['exp', 'strike', 'right'])
    put('trades', trades, ['ms', 'exp', 'strike', 'right'])
    if not sel:
        return
    cs = pd.concat(sel, ignore_index=True)

    def one(row):
        e, k, r = int(row.exp), int(row.strike), int(row.right)
        strike = f'{k / 1000:g}'
        try:
            q = csv('/option/history/quote', {'symbol': root, 'expiration': str(e), 'strike': strike,
                                              'right': 'call' if r == 1 else 'put', 'date': D, 'interval': '100ms'}, timeout=600)
        except NoData:
            return None
        df = pd.DataFrame({'exp': np.int32(e), 'strike': np.int32(k), 'right': np.int8(r), 'ms': ms_of_day(q.timestamp),
                           'bid': cents(q.bid), 'ask': cents(q.ask), 'bs': q.bid_size.astype('int32'),
                           'as': q.ask_size.astype('int32')})
        return thin_quotes(dedupe(df, ['bid', 'ask', 'bs', 'as']))

    t0 = time.time()
    with cf.ThreadPoolExecutor(workers) as ex:
        qs = [q for q in ex.map(one, cs.itertuples(index=False)) if q is not None]
    man['timing'][f'{root}_quotes'] = round(time.time() - t0, 1)
    put('quotes', qs, ['exp', 'strike', 'right', 'ms'])
    rm['quote_rule'] = 'price changes at 100 ms + first row of each second (sizes <= ~1 s stale)'


def contract_quotes(root: str, exp: str, strike: float, right: int, D: str, interval: str = '100ms', thin=True) -> pd.DataFrame:
    """One contract-day of NBBO in the store's schema (cents, ms of day). interval='tick' gives every quote."""
    q = csv('/option/history/quote', {'symbol': root, 'expiration': exp, 'strike': f'{strike:g}', 'right': 'call' if right == 1 else 'put',
                                      'date': D, 'interval': interval}, timeout=600)
    df = pd.DataFrame({'exp': np.int32(int(exp)), 'strike': np.int32(round(strike * 1000)), 'right': np.int8(right),
                       'ms': ms_of_day(q.timestamp), 'bid': cents(q.bid), 'ask': cents(q.ask), 'bs': q.bid_size.astype('int32'),
                       'as': q.ask_size.astype('int32')})
    if interval == 'tick':
        return df
    df = dedupe(df, ['bid', 'ask', 'bs', 'as'])
    return thin_quotes(df) if thin else df


def fetch_underlying(D: str, out: str, man: dict, roots):
    um = man['underlying'] = {}
    syms = sorted({UND[r] for r in roots})
    for kind, sym in syms:
        t0 = time.time()
        if kind == 'index':
            p = csv('/index/history/price', {'symbol': sym, 'date': D, 'interval': '1s'})
            df = pd.DataFrame({'ms': ms_of_day(p.timestamp), 'px': ticks4(p.price)})
            df = df[df.px > 0]
            um[f'{sym}_price'] = write(pa.Table.from_pandas(df, preserve_index=False), os.path.join(out, f'und_{sym}_price.parquet'))
        else:
            q = csv('/stock/history/quote', {'symbol': sym, 'date': D, 'interval': '100ms'}, timeout=900)
            df = dedupe(pd.DataFrame({'ms': ms_of_day(q.timestamp), 'bid': ticks4(q.bid), 'ask': ticks4(q.ask),
                                      'bs': q.bid_size.astype('int32'), 'as': q.ask_size.astype('int32')}),
                        ['bid', 'ask', 'bs', 'as'])
            um[f'{sym}_quotes'] = write(pa.Table.from_pandas(df, preserve_index=False), os.path.join(out, f'und_{sym}_quotes.parquet'))
            t = csv('/stock/history/trade', {'symbol': sym, 'date': D}, timeout=900)
            df = pd.DataFrame({'ms': ms_of_day(t.timestamp), 'px': ticks4(t.price), 'size': t['size'].astype('int32'),
                               'cond': t.condition.astype('int16'), 'exch': t.exchange.astype('int16')})
            um[f'{sym}_trades'] = write(pa.Table.from_pandas(df, preserve_index=False), os.path.join(out, f'und_{sym}_trades.parquet'))
        man['timing'][f'und_{sym}'] = round(time.time() - t0, 1)


def _uw_rows(d):
    return d.get('data', []) if isinstance(d, dict) else d


def fetch_uw(D: str, out: str, man: dict):
    um = man['uw'] = {}
    if D < UW_FLOOR:
        um['skipped'] = f'before the key floor {UW_FLOOR}'
        return
    iso = f'{D[:4]}-{D[4:6]}-{D[6:]}'
    for t in ('SPY', 'QQQ', 'SPX'):
        rows = _uw_rows(uw_get(f'/api/stock/{t}/spot-exposures', {'date': iso}))
        if rows:
            df = pd.DataFrame(rows)
            p = os.path.join(out, f'uw_gex_{t}.parquet')
            um[f'gex_{t}'] = write(pa.Table.from_pandas(df.astype(str), preserve_index=False), p)
    # flow alerts: page backwards through the session (newest first) with older_than
    for t in ('SPY', 'QQQ', 'SPX', 'SPXW'):
        got, older = [], f'{iso}T23:59:59Z'
        for _ in range(60):
            rows = _uw_rows(uw_get('/api/option-trades/flow-alerts', {'ticker_symbol': t, 'limit': 200,
                                                                      'newer_than': f'{iso}T00:00:00Z', 'older_than': older}))
            if not rows:
                break
            got += rows
            # the vendor pages on created_at (when the alert was published) -- also the only honest availability
            # time for a strategy: start_time is the first print inside the alert, often hours earlier.
            older = min(r['created_at'] for r in rows if r.get('created_at'))
            if len(rows) < 200:
                break
        if got:
            df = pd.DataFrame(got).drop_duplicates(subset=[c for c in ('id', 'option_chain', 'start_time') if c in got[0]])
            um[f'alerts_{t}'] = write(pa.Table.from_pandas(df.astype(str), preserve_index=False),
                                      os.path.join(out, f'uw_alerts_{t}.parquet'))
            um[f'alerts_{t}_n'] = len(df)


def fetch_session(D: str, roots, uw=True, force=False):
    out = os.path.join(V2DATA, 'sessions', D)
    mpath = os.path.join(out, '_manifest.json')
    if os.path.exists(mpath) and not force:
        print(D, 'done already')
        return json.load(open(mpath))
    os.makedirs(out, exist_ok=True)
    man = {'session': D, 'roots': {}, 'timing': {}, 'delta_band': [DMIN, DMAX], 'quote_interval': '100ms dedup'}
    t0 = time.time()
    for r in roots:
        fetch_root(D, r, out, man)
        print(D, r, man['roots'][r]['contracts'], {k: f'{v/1e6:.1f}MB' for k, v in man['roots'][r]['bytes'].items()}, flush=True)
    fetch_underlying(D, out, man, roots)
    if uw:
        try:
            fetch_uw(D, out, man)
        except Exception as e:  # noqa: BLE001 — UW is context, never blocks the option store
            man['uw'] = {'error': str(e)[:300]}
    man['seconds'] = round(time.time() - t0, 1)
    man['bytes_total'] = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if f.endswith('.parquet'))
    json.dump(man, open(mpath + '.tmp', 'w'), indent=1)
    os.replace(mpath + '.tmp', mpath)
    print(D, f'{man["bytes_total"]/1e6:.1f} MB in {man["seconds"]:.0f}s', flush=True)
    return man


def recompress(D: str):
    """Re-apply the current quote thinning + encoding to an already fetched session (no terminal reads)."""
    out = os.path.join(V2DATA, 'sessions', D)
    mpath = os.path.join(out, '_manifest.json')
    man = json.load(open(mpath))
    for f in sorted(os.listdir(out)):
        if not f.endswith('.parquet'):
            continue
        p = os.path.join(out, f)
        df = pq.read_table(p).to_pandas()
        if f.endswith('_quotes.parquet') and 'exp' in df.columns:
            df = thin_quotes(df)
            man['roots'][f.split('_')[0]]['quote_rule'] = 'price changes at 100 ms + first row of each second'
        n = write(pa.Table.from_pandas(df, preserve_index=False), p)
        root, name = f[:-8].split('_', 1)
        if root in man['roots'] and name in man['roots'][root].get('bytes', {}):
            man['roots'][root]['bytes'][name] = n
            man['roots'][root]['rows'][name] = len(df)
    man['bytes_total'] = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if f.endswith('.parquet'))
    json.dump(man, open(mpath + '.tmp', 'w'), indent=1)
    os.replace(mpath + '.tmp', mpath)
    print(D, 'recompressed', f'{man["bytes_total"]/1e6:.1f} MB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--recompress', action='store_true')
    ap.add_argument('--uw-only', action='store_true', help='refetch only the UW files of fetched sessions')
    ap.add_argument('--sessions', required=True, help='comma list YYYYMMDD, or @file')
    ap.add_argument('--roots', default='SPXW,SPY,QQQ')
    ap.add_argument('--no-uw', action='store_true')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    ss = open(a.sessions[1:]).read().split() if a.sessions.startswith('@') else a.sessions.split(',')
    if a.uw_only:
        for D in ss:
            out = os.path.join(V2DATA, 'sessions', D.strip())
            mp = os.path.join(out, '_manifest.json')
            man = json.load(open(mp))
            fetch_uw(D.strip(), out, man)
            man['bytes_total'] = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if f.endswith('.parquet'))
            json.dump(man, open(mp + '.tmp', 'w'), indent=1)
            os.replace(mp + '.tmp', mp)
            print(D, man['uw'])
        return
    if a.recompress:
        for D in ss:
            recompress(D.strip())
        return
    for D in ss:
        try:
            fetch_session(D.strip(), a.roots.split(','), uw=not a.no_uw, force=a.force)
        except Exception as e:  # noqa: BLE001
            print(D, 'FAILED', repr(e)[:400], flush=True)


if __name__ == '__main__':
    main()
