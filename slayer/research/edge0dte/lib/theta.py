"""ThetaData v3 terminal access (127.0.0.1:25503). Never starts or stops the terminal. Callers keep <= 2 requests in
flight in total (each fetch process uses its own ThreadPoolExecutor size; default 1).

Writers (all zstd parquet / compressed npz under config.DATA):
  bars/{SYM}/YYYY-MM.parquet     d, m, o, h, l, c [, v, n]   1-minute OHLC(+volume, trade count for ETFs)   OBS
  chain/{ROOT}/YYYY-MM-DD.parquet m, k, r, bid, ask, bs, as   same-day-expiry 1-minute NBBO board              OBS
  oi/{ROOT}/YYYY-MM-DD.parquet   e, k, r, oi, ts              OI published for D (e = days to expiry, ts = publish minute) OBS
  q1s/{ROOT}/YYYY-MM-DD.npz      1-second NBBO windows of single contracts, change-only encoded            OBS
"""
import io
import os
import threading
import time
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

from .config import BASE, BAND, DATA, KIND, clock

_LOG_FAIL = []


def get(path, tries=4, timeout=300):
    """GET a v3 path; returns text, '' for 'no data' (404/472), None after repeated failure."""
    for k in range(tries):
        try:
            with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(5 * (k + 1))
    _LOG_FAIL.append(path)
    return None


def _csv(t):
    return pd.read_csv(io.StringIO(t))


# ---------------------------------------------------------------- bars

def fetch_bars(sym, month, force=False):
    """1-minute bars of one month, 09:30-15:59 bars kept. Returns status string."""
    f = os.path.join(DATA, 'bars', sym, f'{month}.parquet')
    if os.path.exists(f) and not force:
        return 'have'
    y, m = map(int, month.split('-'))
    end = pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0)
    t = get(f'/{KIND[sym]}/history/ohlc?symbol={sym}&start_date={y}{m:02d}01&end_date={end:%Y%m%d}&interval=1m&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    cols = ['d', 'm', 'o', 'h', 'l', 'c'] + (['v', 'n'] if KIND[sym] == 'stock' else [])
    if not t.strip():
        pd.DataFrame({c: [] for c in cols}).to_parquet(f, compression='zstd')
        return 'empty'
    df = _csv(t)
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'d': ts.dt.strftime('%Y-%m-%d'), 'm': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'),
                        'o': df['open'].astype('float64'), 'h': df['high'].astype('float64'),
                        'l': df['low'].astype('float64'), 'c': df['close'].astype('float64')})
    if KIND[sym] == 'stock':
        out['v'] = df['volume'].astype('int64')
        out['n'] = df['count'].astype('int32')
    out = out[(out.m >= 570) & (out.m < 960)]
    out.to_parquet(f, compression='zstd')
    return 'ok' if len(out) else 'empty'


# ---------------------------------------------------------------- 0DTE board

def fetch_chain(root, day, force=False):
    f = os.path.join(DATA, 'chain', root, f'{day}.parquet')
    if os.path.exists(f) and not force:
        return 'have'
    y = day.replace('-', '')
    t = get(f'/option/history/quote?symbol={root}&expiration={y}&date={y}&interval=1m&strike_range={BAND[root]}'
            f'&start_time=09:30:00&end_time=16:00:00&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t.strip():
        pd.DataFrame({c: [] for c in ['m', 'k', 'r', 'bid', 'ask', 'bs', 'as']}).to_parquet(f, compression='zstd')
        return 'empty'
    df = _csv(t)
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                        'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'),
                        'as': df['ask_size'].astype('int32')})
    out.to_parquet(f, compression='zstd')
    return 'ok' if len(out) else 'empty'


# ---------------------------------------------------------------- open interest

def fetch_oi(root, day, force=False):
    """OI published for `day` (ThetaData stamps it ~06:30-07:00 ET of the day; it is the prior close's OCC OI).
    Keeps expiries 0..31 days out. ts = minute of day of the publish stamp (kept for the OI date check)."""
    f = os.path.join(DATA, 'oi', root, f'{day}.parquet')
    if os.path.exists(f) and not force:
        return 'have'
    y = day.replace('-', '')
    t = get(f'/option/history/open_interest?symbol={root}&expiration=*&date={y}&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    cols = {'e': [], 'k': [], 'r': [], 'oi': [], 'ts': [], 'td': []}
    if not t.strip():
        pd.DataFrame(cols).to_parquet(f, compression='zstd')
        return 'empty'
    df = _csv(t)
    ex = pd.to_datetime(df['expiration'])
    d0 = pd.Timestamp(day)
    df = df[(ex >= d0) & (ex <= d0 + pd.Timedelta(days=31))]
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'e': (pd.to_datetime(df['expiration']) - d0).dt.days.astype('int16'),
                        'k': df['strike'].astype('float32'), 'r': (df['right'].str.upper().str[0] == 'C').astype('int8'),
                        'oi': df['open_interest'].astype('int32'),
                        'ts': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'),
                        'td': (ts.dt.normalize() - d0).dt.days.astype('int16')})   # publish date minus day (expect 0)
    out = out.drop_duplicates(['e', 'k', 'r'])
    out.to_parquet(f, compression='zstd')
    return 'ok' if len(out) else 'empty'


# ---------------------------------------------------------------- 1-second NBBO windows (change-only store)

_LOCKS = {}
_LOCKS_G = threading.Lock()
_Q = ('k', 'r', 's', 'bid', 'ask', 'bs', 'as')
_C = ('ck', 'cr', 'cs', 'ce')


def _lock(key):
    with _LOCKS_G:
        return _LOCKS.setdefault(key, threading.Lock())


def _q1s_path(root, day):
    return os.path.join(DATA, 'q1s', root, f'{day}.npz')


_STORE = {}


def _load_store(root, day):
    """The day's store (cached in memory by file mtime; a fetch rewrites the file and invalidates the entry)."""
    f = _q1s_path(root, day)
    if not os.path.exists(f):
        return {**{x: np.zeros(0) for x in _Q}, **{x: np.zeros(0) for x in _C}}
    mt = os.path.getmtime(f)
    hit = _STORE.get((root, day))
    if hit is not None and hit[0] == mt:
        return dict(hit[1])
    z = np.load(f)
    st = {x: z[x] for x in z.files}
    if len(_STORE) > 8:
        _STORE.pop(next(iter(_STORE)))
    _STORE[(root, day)] = (mt, st)
    return dict(st)


def _covered(st, k, r, a, b):
    m = (np.abs(st['ck'] - k) < 1e-6) & (st['cr'] == r) & (st['cs'] <= a) & (st['ce'] >= b)
    return bool(m.any())


def _parse_1s(txt):
    if not txt or not txt.strip() or not txt.startswith('symbol'):
        return None
    df = _csv(txt)
    if not len(df):
        return None
    ts = pd.to_datetime(df['timestamp'])
    return {'s': (ts.dt.hour * 3600 + ts.dt.minute * 60 + ts.dt.second).values.astype(np.int32),
            'bid': df['bid'].values.astype(np.float32), 'ask': df['ask'].values.astype(np.float32),
            'bs': df['bid_size'].values.astype(np.int32), 'as': df['ask_size'].values.astype(np.int32)}


def _change_only(q):
    """Keep the first row and every row where (bid, ask, bid size > 0, ask size > 0) changes. The as-of quote at any
    second inside the window is then the last kept row stamped <= that second (lossless for prices and for the
    zero-size test; sizes are those of the last price/zero change)."""
    n = len(q['s'])
    if n == 0:
        return q
    # a missing second (no row from ThetaData) is "no quote" (stale): insert a sentinel row (bid = ask = -1) at the
    # first missing second so the as-of lookup inside a gap returns an invalid quote
    gap = np.flatnonzero(np.diff(q['s']) > 1)
    if len(gap):
        ins = {'s': q['s'][gap] + 1, 'bid': np.full(len(gap), -1, np.float32), 'ask': np.full(len(gap), -1, np.float32),
               'bs': np.zeros(len(gap), np.int32), 'as': np.zeros(len(gap), np.int32)}
        q = {x: np.concatenate([q[x], ins[x]]) for x in q}
        o = np.argsort(q['s'], kind='stable')
        q = {x: v[o] for x, v in q.items()}
        n = len(q['s'])
    key = np.stack([q['bid'], q['ask'], (q['bs'] > 0).astype(np.float32), (q['as'] > 0).astype(np.float32)], 1)
    keep = np.ones(n, bool)
    keep[1:] = np.any(key[1:] != key[:-1], axis=1)
    return {x: v[keep] for x, v in q.items()}


def fetch_q1s_windows(root, day, wants):
    """wants: list of (k, call(bool), start_s, end_s). Fetches the windows not yet covered (one request per window),
    appends them to the day's store, and returns the number of requests made. Not thread-safe across processes:
    run one process per (root, day) at a time (the drivers do)."""
    with _lock((root, day)):
        st = _load_store(root, day)
        new_q, new_c, nreq = [], [], 0
        for k, call, a, b in wants:
            r = 1 if call else 0
            if _covered(st, k, r, a, b) or any(abs(c[0] - k) < 1e-6 and c[1] == r and c[2] <= a and c[3] >= b for c in new_c):
                continue
            ks = f'{k:.3f}'.rstrip('0').rstrip('.')
            y = day.replace('-', '')
            txt = get(f'/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if call else "put"}'
                      f'&start_date={y}&end_date={y}&interval=1s&start_time={clock(a)}&end_time={clock(b)}&format=csv')
            nreq += 1
            if txt is None:
                continue                       # transient failure: not marked covered, retried next time
            q = _parse_1s(txt)
            if q is not None:
                q = _change_only(q)
                n = len(q['s'])
                new_q.append({'k': np.full(n, k, np.float32), 'r': np.full(n, r, np.int8), **q})
            new_c.append((k, r, a, b))
        if not new_c:
            return nreq
        for x in _Q:
            st[x] = np.concatenate([st[x].astype(new_q[0][x].dtype if new_q else st[x].dtype)] + [q[x] for q in new_q]) if new_q else st[x]
        st['ck'] = np.concatenate([st['ck'], np.array([c[0] for c in new_c], np.float32)])
        st['cr'] = np.concatenate([st['cr'], np.array([c[1] for c in new_c], np.int8)])
        st['cs'] = np.concatenate([st['cs'], np.array([c[2] for c in new_c], np.int32)])
        st['ce'] = np.concatenate([st['ce'], np.array([c[3] for c in new_c], np.int32)])
        f = _q1s_path(root, day)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        tmp = f + '.tmp.npz'
        np.savez_compressed(tmp, **st)
        os.replace(tmp, f)
        return nreq


def q1s(root, day, k, call, a, b, fetch=True):
    """1-second NBBO rows (change-only) of one contract within [a, b] seconds. Rows before `a` that carry the as-of
    quote are included (the last row <= a), so asof lookups at a work. Returns dict of arrays, or None when the window
    is not cached and fetch=False (or the fetch failed)."""
    r = 1 if call else 0
    st = _load_store(root, day)
    if not _covered(st, k, r, a, b):
        if not fetch:
            return None
        fetch_q1s_windows(root, day, [(k, call, a, b)])
        st = _load_store(root, day)
        if not _covered(st, k, r, a, b):
            return None
    cov = (np.abs(st['ck'] - k) < 1e-6) & (st['cr'] == r) & (st['cs'] <= a) & (st['ce'] >= b)
    w0 = int(st['cs'][cov].min())           # start of the covering window: older rows belong to other windows
    m = (np.abs(st['k'] - k) < 1e-6) & (st['r'] == r) & (st['s'] >= w0)
    out = {x: st[x][m] for x in ('s', 'bid', 'ask', 'bs', 'as')}
    o = np.argsort(out['s'], kind='stable')
    out = {x: v[o] for x, v in out.items()}
    s = out['s']
    if len(s):
        keep = np.r_[s[1:] != s[:-1], True]   # duplicate stamps from overlapping windows: keep one
        out = {x: v[keep] for x, v in out.items()}
        s = out['s']
    lo = max(np.searchsorted(s, a, 'right') - 1, 0)
    hi = np.searchsorted(s, b, 'right')
    return {x: v[lo:hi] for x, v in out.items()}
