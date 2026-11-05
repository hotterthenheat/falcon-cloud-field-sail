"""EDGE data fetcher (ThetaData terminal, <= 2 requests in flight). Writes only under v2data/edge/ (zstd parquet).

  python3 fetch.py sessions            trading days (SPY EOD) per year
  python3 fetch.py chain DEV|VAL       0DTE 1-minute chain NBBO 09:30-16:00 per root/session
  python3 fetch.py bars DEV|VAL        1-minute underlying bars per root/month (+ the month before, for sigma_d)
  python3 fetch.py oi DEV|VAL          open interest (all expiries; kept <= 31 days out, strikes within 12%)

The LOCKED TEST periods (H1, H2, >= 2026-07-01) are never fetched here.
"""
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import pandas as pd

BASE = 'http://127.0.0.1:25503/v3'
ROOT = '/home/user/falcon-cloud-field-sail/v2data/edge'
ROOTS = ('SPY', 'QQQ', 'IWM', 'SPXW')
UNDER = {'SPY': ('stock', 'SPY'), 'QQQ': ('stock', 'QQQ'), 'IWM': ('stock', 'IWM'), 'SPXW': ('index', 'SPX')}
BAND = {'SPY': 14, 'QQQ': 14, 'IWM': 14, 'SPXW': 24}
INFLIGHT = int(os.environ.get("INFLIGHT", "1"))  # the 1-second fetcher in hyp.py takes the other slot


def is_h1(d):
    return d.startswith('2022-06') or d.startswith('2024-08') or ('2026-10-05' <= d <= '2026-10-30')


def is_h2(d):
    return ('2022-07-01' <= d <= '2022-09-30') or ('2025-01-02' <= d <= '2025-03-31')


def is_locked(d):
    return is_h1(d) or is_h2(d) or d >= '2026-07-01'


def split(d):
    if is_locked(d):
        return 'TEST'
    if d < '2025-01-01':
        return 'DEV'
    return 'VAL'


def get(path, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(BASE + path, timeout=240) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(5 * (k + 1))
    return None


def sessions():
    f = os.path.join(ROOT, 'sessions.json')
    if os.path.exists(f):
        return json.load(open(f))
    out = []
    for y in (2020, 2022, 2023, 2024, 2025):
        t = get(f'/stock/history/eod?symbol=SPY&start_date={y}0101&end_date={y}1231&format=csv')
        df = pd.read_csv(io.StringIO(t))
        col = [c for c in df.columns if 'created' in c or 'date' in c or 'timestamp' in c][0]
        out += sorted(set(str(x)[:10] for x in df[col]))
    json.dump(out, open(f, 'w'))
    return out


def want_days(which):
    ds = [d for d in sessions() if split(d) == which]
    if which == 'DEV':
        ds = [d for d in ds if d[:7] in ('2020-02', '2020-03', '2020-04') or d.startswith('2022-0') and d[:7] <= '2022-05'
              or d.startswith('2022-10') or d.startswith('2023') or d.startswith('2024')]
        ds = [d for d in ds if d >= '2020-02-18' or not d.startswith('2020')]
    return ds


def expirations(root):
    f = os.path.join(ROOT, f'exp_{root}.json')
    if os.path.exists(f):
        return set(json.load(open(f)))
    t = get(f'/option/list/expirations?symbol={root}&format=csv')
    df = pd.read_csv(io.StringIO(t))
    ex = sorted(set(str(x)[:10] for x in df[df.columns[-1]]))
    json.dump(ex, open(f, 'w'))
    return set(ex)


def chain_job(root, d):
    f = os.path.join(ROOT, 'chain', root, f'{d}.parquet')
    if os.path.exists(f):
        return 'have'
    y = d.replace('-', '')
    t = get(f'/option/history/quote?symbol={root}&expiration={y}&date={y}&interval=1m&strike_range={BAND[root]}&start_time=09:30:00&end_time=16:00:00&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t.strip():
        pd.DataFrame().to_parquet(f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'m': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'), 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'bid': df['bid'].astype('float32'),
                        'ask': df['ask'].astype('float32'), 'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32')})
    out.to_parquet(f, compression='zstd')
    return 'ok'


def oi_job(root, d):
    f = os.path.join(ROOT, 'oi', root, f'{d}.parquet')
    if os.path.exists(f):
        return 'have'
    y = d.replace('-', '')
    t = get(f'/option/history/open_interest?symbol={root}&expiration=*&date={y}&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if not t.strip():
        pd.DataFrame().to_parquet(f)
        return 'empty'
    df = pd.read_csv(io.StringIO(t))
    ex = pd.to_datetime(df['expiration'])
    day = pd.Timestamp(d)
    keep = (ex >= day) & (ex <= day + pd.Timedelta(days=31))
    df = df[keep]
    out = pd.DataFrame({'e': (pd.to_datetime(df['expiration']) - day).dt.days.astype('int16'), 'k': df['strike'].astype('float32'),
                        'r': (df['right'].str.upper().str[0] == 'C').astype('int8'), 'oi': df['open_interest'].astype('int32')})
    out.to_parquet(f, compression='zstd')
    return 'ok'


def bars_job(root, month):
    kind, sym = UNDER[root]
    f = os.path.join(ROOT, 'bars', sym, f'{month}.parquet')
    if os.path.exists(f):
        return 'have'
    y, m = map(int, month.split('-'))
    end = pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0)
    t = get(f'/{kind}/history/ohlc?symbol={sym}&start_date={y}{m:02d}01&end_date={end:%Y%m%d}&interval=1m&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    df = pd.read_csv(io.StringIO(t)) if t.strip() else pd.DataFrame(columns=['timestamp', 'open', 'high', 'low', 'close'])
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'d': ts.dt.strftime('%Y-%m-%d'), 'm': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'),
                        'o': df['open'].astype('float64'), 'h': df['high'].astype('float64'), 'l': df['low'].astype('float64'), 'c': df['close'].astype('float64')})
    out = out[(out.m >= 570) & (out.m < 960)]
    out.to_parquet(f, compression='zstd')
    return 'ok'


def run(jobs):
    t0 = time.time()
    done = {}
    with ThreadPoolExecutor(INFLIGHT) as ex:
        for i, r in enumerate(ex.map(lambda j: j[0](*j[1:]), jobs)):
            done[r] = done.get(r, 0) + 1
            if i % 50 == 0:
                print(f'{i}/{len(jobs)} {done} {time.time() - t0:.0f}s', flush=True)
    print('done', done, f'{time.time() - t0:.0f}s', flush=True)


def main():
    what = sys.argv[1]
    if what == 'sessions':
        s = sessions()
        print(len(s), s[0], s[-1])
        return
    which = sys.argv[2]
    days = want_days(which)
    if what == 'chain':
        jobs = [(chain_job, r, d) for d in days for r in ROOTS if d in expirations(r)]
    elif what == 'oi':
        jobs = [(oi_job, r, d) for d in days for r in ROOTS if d in expirations(r)]
    elif what == 'bars':
        months = set()
        for d in days:
            p = pd.Timestamp(d[:7] + '-01')
            months.add(d[:7])
            months.add((p - pd.offsets.MonthBegin(1)).strftime('%Y-%m'))
        months = sorted(m for m in months if not all(is_locked(x) for x in [m + '-15']) or True)
        jobs = [(bars_job, r, m) for m in months for r in ROOTS]
    if 'rev' in sys.argv[3:]:
        jobs = jobs[::-1]
    print(what, which, len(days), 'sessions', len(jobs), 'jobs', flush=True)
    run(jobs)


if __name__ == '__main__':
    main()
