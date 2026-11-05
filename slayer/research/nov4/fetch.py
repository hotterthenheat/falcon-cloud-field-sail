"""
Nov 4 research: fetch the regular session's option chains for Compass's two sleeves from the ThetaData terminal.

Per session and root: the 0DTE chain (strike_range 16, as the scan reads it) and the weekly chain (nearest expiry
1-7 weekdays out, strike_range 17), 1-minute NBBO and 1-minute OHLC/volume, 09:30-16:00; open interest on the
session date and the session before (for the build); the underlying's 1-minute bars. Parsed to compact .npz under
$NOV4_DATA (default: the session scratchpad), one file per (day, root, expiry). Already-fetched files are skipped.

  python3 -I research/nov4/fetch.py 2026-11-04 2026-11-03 ...      (CONC env: requests in flight, default 1)

No key is used or read here: the terminal is local.
"""
import json, os, sys, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np

BASE = os.environ.get('THETA_BASE', 'http://127.0.0.1:25503/v3')
DATA = os.environ.get('NOV4_DATA', '/tmp/claude-0/-home-user/f71fb141-33a0-5344-9573-1a2ad4706812/scratchpad/nov4data')
CONC = int(os.environ.get('CONC', '1'))
os.makedirs(DATA, exist_ok=True)

DAILY_0DTE = ['SPXW', 'NDXP', 'XSP', 'RUTW', 'VIX', 'SPY', 'QQQ', 'IWM', 'GLD', 'XLF', 'SMH']
MWF_STOCK = ['AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA']
MWF_ETF = ['SLV', 'TLT', 'XLE', 'EEM', 'TQQQ', 'SOXL']
WF_0DTE = ['USO', 'UNG']
WEEKLY_FOCUS = ['SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF']
INDEX_UNDER = {'SPXW': 'SPX', 'XSP': 'SPX', 'NDXP': 'NDX', 'RUTW': 'RUT', 'VIX': 'VIX'}

sem = threading.Semaphore(CONC)


def get(path, tries=6):
    for i in range(tries):
        try:
            with sem:
                with urllib.request.urlopen(BASE + path, timeout=180) as r:
                    body = r.read()
            if not body.strip():
                raise IOError('empty')
            return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):  # no data
                return {'response': []}
            time.sleep(1.5 * 2 ** i)
        except Exception:
            time.sleep(1.5 * 2 ** i)
    return None


def weekday(day):
    import datetime
    return datetime.date.fromisoformat(day).weekday()  # Mon=0


def weekday_dte(day, exp):
    import datetime
    a, b = datetime.date.fromisoformat(day), datetime.date.fromisoformat(exp)
    n, d = 0, a
    while d < b:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def odte_roots(day):
    wd = weekday(day)
    names = list(DAILY_0DTE)
    if wd in (0, 2, 4):
        names += MWF_STOCK + MWF_ETF
    if wd in (2, 4):
        names += WF_0DTE
    return names


_exp = {}


def expirations(root):
    if root not in _exp:
        j = get(f'/option/list/expirations?symbol={root}&format=json')
        _exp[root] = sorted({r['expiration'][:10] for r in (j or {}).get('response', [])})
    return _exp[root]


def minute_of(ts):  # "2026-11-04T09:31:00.000" -> minutes since 09:30
    h, m = int(ts[11:13]), int(ts[14:16])
    return h * 60 + m - 570


def prev_session(day, all_days=None):
    import datetime
    d = datetime.date.fromisoformat(day)
    while True:
        d -= datetime.timedelta(days=1)
        if d.weekday() < 5:
            return d.isoformat()


def chain(day, root, exp, rng):
    out = os.path.join(DATA, f'{day}_{root}_{exp}.npz')
    if os.path.exists(out):
        return 'have'
    y, e = day.replace('-', ''), exp.replace('-', '')
    common = f'symbol={root}&expiration={e}&start_date={y}&end_date={y}&strike_range={rng}&interval=1m&start_time=09:30:00&end_time=16:00:00&format=json'
    q = get('/option/history/quote?' + common)
    o = get('/option/history/ohlc?' + common)
    p = prev_session(day)
    oi0 = get(f'/option/history/open_interest?symbol={root}&expiration={e}&date={y}&strike_range={rng}&format=json')
    oi1 = get(f'/option/history/open_interest?symbol={root}&expiration={e}&date={p.replace("-", "")}&strike_range={rng}&format=json')
    if q is None or o is None:
        return 'fail'
    keys = {}
    for item in q.get('response', []):
        c = item['contract']
        keys[(float(c['strike']), c['right'][0])] = None
    ks = sorted(keys)
    if not ks:
        np.savez_compressed(out, empty=np.array([1]))
        return 'empty'
    idx = {k: i for i, k in enumerate(ks)}
    N, T = len(ks), 391
    A = {f: np.full((N, T), np.nan, dtype=np.float32) for f in ('bid', 'ask', 'bsz', 'asz', 'vol', 'cnt', 'vwap', 'close', 'high', 'low')}
    for item in q.get('response', []):
        c = item['contract']
        i = idx[(float(c['strike']), c['right'][0])]
        for r in item['data']:
            t = minute_of(r['timestamp'])
            if 0 <= t < T:
                A['bid'][i, t] = r['bid']; A['ask'][i, t] = r['ask']; A['bsz'][i, t] = r['bid_size']; A['asz'][i, t] = r['ask_size']
    for item in o.get('response', []):
        c = item['contract']
        k = (float(c['strike']), c['right'][0])
        if k not in idx:
            continue
        i = idx[k]
        for r in item['data']:
            t = minute_of(r['timestamp'])
            if 0 <= t < T:
                A['vol'][i, t] = r['volume']; A['cnt'][i, t] = r['count']; A['vwap'][i, t] = r['vwap']; A['close'][i, t] = r['close']
                A['high'][i, t] = r['high']; A['low'][i, t] = r['low']
    oi = {}
    for tag, j in (('oi', oi0), ('oi_prev', oi1)):
        arr = np.full(N, np.nan, dtype=np.float32)
        for item in (j or {}).get('response', []):
            c = item['contract']
            k = (float(c['strike']), c['right'][0])
            if k in idx and item.get('data'):
                arr[idx[k]] = item['data'][-1]['open_interest']
        oi[tag] = arr
    np.savez_compressed(out, strike=np.array([k[0] for k in ks]), right=np.array([k[1] for k in ks]), **A, **oi)
    return f'ok {N}'


def under(day, root):
    u = INDEX_UNDER.get(root, root)
    out = os.path.join(DATA, f'{day}_U_{u}.npz')
    if os.path.exists(out):
        return 'have'
    y = day.replace('-', '')
    kind = 'index' if u in ('SPX', 'NDX', 'RUT', 'VIX') else 'stock'
    j = get(f'/{kind}/history/ohlc?symbol={u}&start_date={y}&end_date={y}&interval=1m&format=json')
    if j is None:
        return 'fail'
    T = 391
    A = {f: np.full(T, np.nan) for f in ('o', 'h', 'l', 'c', 'v', 'vwap')}
    for r in j.get('response', []):
        t = minute_of(r['timestamp'])
        if 0 <= t < T:
            A['o'][t], A['h'][t], A['l'][t], A['c'][t], A['v'][t], A['vwap'][t] = r['open'], r['high'], r['low'], r['close'], r['volume'], r['vwap']
    # previous session close for the gap
    p = prev_session(day).replace('-', '')
    jp = get(f'/{kind}/history/ohlc?symbol={u}&start_date={p}&end_date={p}&interval=1m&start_time=15:55:00&end_time=16:00:00&format=json')
    pc = np.nan
    for r in (jp or {}).get('response', []):
        if r['close'] > 0:
            pc = r['close']
    np.savez_compressed(out, prev_close=np.array([pc]), **A)
    return 'ok'


def jobs_for(day):
    js = []
    for r in odte_roots(day):
        if day in expirations(r):
            js.append(('chain', day, r, day, 16))
    for r in WEEKLY_FOCUS:
        near = [e for e in expirations(r) if 1 <= weekday_dte(day, e) <= 7 and e > day]
        if near:
            js.append(('chain', day, r, near[0], 17))
    for r in sorted(set(odte_roots(day) + WEEKLY_FOCUS)):
        js.append(('under', day, r))
    return js


def run(job):
    t0 = time.time()
    try:
        res = chain(*job[1:]) if job[0] == 'chain' else under(*job[1:])
    except Exception as e:  # keep going; the file is not written
        res = f'error {e!r}'
    print(job[:4], res, f'{time.time() - t0:.1f}s', flush=True)


if __name__ == '__main__':
    days = [a for a in sys.argv[1:] if len(a) == 10]
    for day in days:
        js = jobs_for(day)
        with ThreadPoolExecutor(max_workers=CONC) as ex:
            list(ex.map(run, js))
        print('DONE', day, flush=True)
