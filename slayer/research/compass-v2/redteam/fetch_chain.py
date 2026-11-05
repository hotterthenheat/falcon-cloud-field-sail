"""Red team: the SPXW 0DTE chain overnight 00:00-09:30 ET at 1-minute NBBO, +-40 strikes (ThetaData centres the band on
the day's open, so +-200 pts covers the overnight spot), one request at a time, cached as zstd parquet under
/home/user/falcon-cloud-field-sail/v2data/redteam/chain1m/. Budget ~250 MB. Exchange/condition codes kept (attack 6)."""
import io, os, sys, time, urllib.request, urllib.parse, urllib.error
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rt

OUT = '/home/user/falcon-cloud-field-sail/v2data/redteam/chain1m'
THETA = 'http://127.0.0.1:25503/v3'
_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fetch(day):
    os.makedirs(OUT, exist_ok=True)
    f = os.path.join(OUT, f'{day}.parquet')
    if os.path.exists(f):
        return f
    ymd = day.replace('-', '')
    q = {'symbol': 'SPXW', 'expiration': ymd, 'date': ymd, 'interval': '1m', 'strike_range': '40',
         'start_time': '00:00:00', 'end_time': '09:30:00', 'format': 'csv'}
    url = f'{THETA}/option/history/quote?{urllib.parse.urlencode(q)}'
    body = None
    for attempt in range(5):
        try:
            with _op.open(url, timeout=600) as r:
                status = r.status
                body = r.read()
            if status == 200 and body.strip():
                break
        except urllib.error.HTTPError as e:
            if e.code == 472:
                body = b''
                break
            time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(3 * (attempt + 1))
    if not body:
        open(os.path.join(OUT, f'{day}.nodata'), 'w').write('472')
        return None
    df = pd.read_csv(io.BytesIO(body))
    t = pd.to_datetime(df['timestamp'])
    out = pd.DataFrame({'min': (t.dt.hour * 60 + t.dt.minute).astype('int16'),
                        'strike': df['strike'].astype('float32'),
                        'right': np.where(df['right'].astype(str).str.upper().str.startswith('C'), 'C', 'P'),
                        'bid': df['bid'].astype('float32'), 'ask': df['ask'].astype('float32'),
                        'bs': df['bid_size'].astype('int32'), 'as': df['ask_size'].astype('int32'),
                        'bx': df['bid_exchange'].astype('int16'), 'ax': df['ask_exchange'].astype('int16'),
                        'bc': df['bid_condition'].astype('int16'), 'ac': df['ask_condition'].astype('int16')})
    out.to_parquet(f + '.tmp', compression='zstd')
    os.replace(f + '.tmp', f)
    return f


if __name__ == '__main__':
    days = sorted(set(rt.locked_days()) | {'2025-01-08'})
    t0 = time.time()
    for i, d in enumerate(days):
        f = fetch(d)
        time.sleep(0.5)
        if i % 10 == 0:
            sz = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT)) / 1e6
            print(f'[{i+1}/{len(days)}] {d} {"ok" if f else "NO DATA"} {time.time()-t0:.0f}s cache {sz:.0f} MB', flush=True)
    print('done', time.time() - t0)
