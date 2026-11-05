"""EDGE-V fetcher: 1-minute RTH bars WITH volume for SPY/QQQ (one terminal request in flight). LOCKED periods never.

  python3 vfetch.py DEV|VAL
Writes v2data/edge-v/bars/{SYM}/YYYY-MM.parquet: d, m, o, h, l, c, v (zstd). Days outside the split's session list
are dropped before writing, so no locked day is ever stored.
"""
import io, os, sys, time, urllib.request
import pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'edge'))
import fetch as F

BASE = 'http://127.0.0.1:25503/v3'
VROOT = '/home/user/falcon-cloud-field-sail/v2data/edge-v'


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=240) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                return ''
            time.sleep(3 * (k + 1))
        except Exception:
            time.sleep(5 * (k + 1))
    return None


def bars_job(sym, month, keep_days):
    f = os.path.join(VROOT, 'bars', sym, f'{month}.parquet')
    if os.path.exists(f):
        return 'have'
    y, m = map(int, month.split('-'))
    end = pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0)
    t = get(f'{BASE}/stock/history/ohlc?symbol={sym}&start_date={y}{m:02d}01&end_date={end:%Y%m%d}&interval=1m&format=csv')
    if t is None:
        return 'fail'
    os.makedirs(os.path.dirname(f), exist_ok=True)
    df = pd.read_csv(io.StringIO(t))
    ts = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'d': ts.dt.strftime('%Y-%m-%d'), 'm': (ts.dt.hour * 60 + ts.dt.minute).astype('int16'),
                        'o': df['open'].astype('float64'), 'h': df['high'].astype('float64'), 'l': df['low'].astype('float64'),
                        'c': df['close'].astype('float64'), 'v': df['volume'].astype('int64')})
    out = out[(out.m >= 570) & (out.m < 960) & out.d.isin(keep_days)]
    out.to_parquet(f, compression='zstd')
    return 'ok'


if __name__ == '__main__':
    which = sys.argv[1]
    days = set(F.want_days(which))
    assert not any(F.is_locked(d) for d in days)
    months = sorted(set(d[:7] for d in days))
    for sym in (sys.argv[2:] or ['SPY', 'QQQ']):
        for mo in months:
            print(sym, mo, bars_job(sym, mo, days), flush=True)
