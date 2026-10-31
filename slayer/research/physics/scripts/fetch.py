"""Download and cache the data the physics study needs from the local ThetaData v3 terminal.

Gentle by design: at most 2 requests in flight (the terminal is shared with the live app), every answer
cached under data/ so a re-run downloads nothing it already has.

  python3 scripts/fetch.py bars            # 1-minute RTH bars, SPY QQQ SPX NVDA AAPL, 2023-01 .. 2026-10
  python3 scripts/fetch.py gamma SPY       # per-day OI (06:30 stamp) + prior-day EOD greeks, 0-10 DTE, +-30 strikes
  python3 scripts/fetch.py eod             # daily EOD for VIX (index) -- small
"""
import gzip, json, os, sys, time, urllib.request, urllib.error, datetime as dt
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get('THETA_URL', 'http://127.0.0.1:25503/v3')
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
START, END = dt.date(2023, 1, 1), dt.date(2026, 10, 30)
BAR_SYMBOLS = [('SPY', 'stock'), ('QQQ', 'stock'), ('SPX', 'index'), ('NVDA', 'stock'), ('AAPL', 'stock')]


def _empty(out):
    with gzip.open(out, 'wb') as f:
        f.write(b'{"response":[]}')


def get(path, out, tries=4):
    if os.path.exists(out):
        return 'cached'
    url = BASE + path
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=900) as r:
                body = r.read()
            s = body.lstrip()
            if s.startswith(b'{') or s.startswith(b'['):
                try:
                    json.loads(body)          # a body cut short mid-transfer is retried, never cached
                except ValueError:
                    time.sleep(5 * (k + 1))
                    continue
                tmp = out + '.tmp'
                with gzip.open(tmp, 'wb') as f:
                    f.write(body)
                os.replace(tmp, out)
                return 'ok'
            _empty(out)  # plain-text "no data" answer: remember it, do not ask again
            return 'empty:' + body[:80].decode('utf8', 'replace')
        except urllib.error.HTTPError as e:
            msg = e.read()[:160].decode('utf8', 'replace')
            if e.code in (404, 472) or 'no data' in msg.lower():
                _empty(out)
                return 'empty:%d' % e.code
            time.sleep(5 * (k + 1))
        except Exception:  # timeouts, resets
            time.sleep(5 * (k + 1))
    return 'FAILED ' + url


def months():
    d = dt.date(START.year, START.month, 1)
    while d <= END:
        nxt = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        yield d, min(nxt - dt.timedelta(days=1), END)
        d = nxt


def bar_jobs():
    for sym, kind in BAR_SYMBOLS:
        os.makedirs(os.path.join(DATA, 'bars', sym), exist_ok=True)
        for a, b in months():
            p = f'/{kind}/history/ohlc?symbol={sym}&start_date={a:%Y%m%d}&end_date={b:%Y%m%d}&interval=1m&format=json'
            yield p, os.path.join(DATA, 'bars', sym, f'{a:%Y%m}.json.gz')


def trading_days(sym='SPY'):
    """Days with real bars (from the cached bar files)."""
    days = set()
    d = os.path.join(DATA, 'bars', sym)
    for fn in sorted(os.listdir(d)):
        with gzip.open(os.path.join(d, fn)) as f:
            for row in json.load(f)['response']:
                if row['close'] > 0 and row['volume'] > 0:
                    days.add(row['timestamp'][:10].replace('-', ''))
    return sorted(days)


def gamma_jobs(sym, first='20230201'):
    os.makedirs(os.path.join(DATA, 'gamma', sym), exist_ok=True)
    days = trading_days(sym)
    for prev, day in zip(days[:-1], days[1:]):
        if day < first:
            continue
        q = f'symbol={sym}&expiration=*&max_dte=10&strike_range=30&format=json'
        # OI stamped 06:30 on `day` = the previous session's settled OI: known before the open, no look-ahead
        yield (f'/option/history/open_interest?{q}&date={day}', os.path.join(DATA, 'gamma', sym, f'oi_{day}.json.gz'))
        # prior session's end-of-day greeks: each contract's IV as of the evening before
        yield (f'/option/history/greeks/eod?{q}&start_date={prev}&end_date={prev}', os.path.join(DATA, 'gamma', sym, f'eod_{prev}.json.gz'))


def eod_jobs():
    os.makedirs(os.path.join(DATA, 'eod'), exist_ok=True)
    for y in range(START.year - 1, END.year + 1):
        a, b = dt.date(y, 1, 1), min(dt.date(y, 12, 31), END)
        yield (f'/index/history/eod?symbol=VIX&start_date={a:%Y%m%d}&end_date={b:%Y%m%d}&format=json', os.path.join(DATA, 'eod', f'VIX_{y}.json.gz'))


def run(jobs):
    jobs = list(jobs)
    t0, done = time.time(), 0
    # never more than 2 in flight in total: two jobs side by side must each run with FETCH_WORKERS=1
    with ThreadPoolExecutor(max_workers=int(os.environ.get("FETCH_WORKERS", "2"))) as ex:
        for (p, out), res in zip(jobs, ex.map(lambda j: get(*j), jobs)):
            done += 1
            if res != 'cached':
                print(f'[{done}/{len(jobs)} {time.time() - t0:6.0f}s] {res} {os.path.basename(out)}', flush=True)
    print('done', flush=True)


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'bars'
    if what == 'bars':
        run(bar_jobs())
    elif what == 'gamma':
        run(gamma_jobs(sys.argv[2] if len(sys.argv) > 2 else 'SPY', sys.argv[3] if len(sys.argv) > 3 else '20230201'))
    elif what == 'eod':
        run(eod_jobs())
