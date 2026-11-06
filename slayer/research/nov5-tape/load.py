"""NOV5 loaders for the fetched tape (v2data/nov5-tape/<D>/) and the live recorder files. Read-only."""
import datetime as dt, glob, gzip, json, os
import numpy as np
import pandas as pd

DATA = '/home/user/falcon-cloud-field-sail/v2data'
OUT = os.path.join(DATA, 'nov5-tape')
LIVE = os.path.join(DATA, 'live')
ROWS = '/home/user/falcon-cloud-field-sail/slayer/.cache/compass/rows'
YEAR_MIN = 390.0 * 252
RTH0, RTH1 = 9 * 3600 + 30 * 60, 16 * 3600


def ddir(D):
    return os.path.join(OUT, D)


def spx(D):
    s = pd.read_parquet(os.path.join(ddir(D), 'idx_SPX_1s.parquet'))
    s = s[s.px > 0]
    return (s.ms.values // 1000).astype(np.int64), s.px.values.astype(float)


def bars(D, sym='SPX'):
    """1-minute bars from the 1-second index prints: bar m = prints stamped in [m, m+1) minutes (EDGE convention)."""
    f = os.path.join(ddir(D), f'idx_{sym}_1s.parquet')
    s = pd.read_parquet(f)
    s = s[s.px > 0].copy()
    s['m'] = (s.ms // 60000).astype(int)
    b = s.groupby('m').px.agg(o='first', h='max', l='min', c='last').reset_index()
    return b[(b.m >= 570) & (b.m <= 959)].reset_index(drop=True)


def index_1m(D, sym):
    f = glob.glob(os.path.join(ddir(D), f'idx_{sym}_*.parquet'))[0]
    s = pd.read_parquet(f)
    s = s[s.px > 0].copy()
    s['m'] = (s.ms // 60000).astype(int)
    return s.groupby('m').px.last()


def _parts(D, exp, kind):
    p = os.path.join(ddir(D), f'g1m_{exp}_parts')
    fs = sorted(glob.glob(os.path.join(p, f'{kind}_*.parquet')))
    xs = [pd.read_parquet(f) for f in fs]
    xs = [x for x in xs if len(x)]
    return pd.concat(xs, ignore_index=True) if xs else pd.DataFrame()


def chain(D, exp=None):
    """1-minute board: m (minute of day; the quote in force at the minute stamp), k, r (1 call / 0 put), bid, ask, delta,
    iv, und (Theta's greeks; Theta's own clock), vega, theta."""
    exp = exp or D
    f = os.path.join(ddir(D), f'g1m_{exp}_greeks.parquet')
    c = pd.read_parquet(f) if os.path.exists(f) else _parts(D, exp, 'g')
    return c.sort_values(['k', 'r', 'm']).reset_index(drop=True)


def ohlc(D, exp=None):
    exp = exp or D
    f = os.path.join(ddir(D), f'g1m_{exp}_ohlc.parquet')
    o = pd.read_parquet(f) if os.path.exists(f) else _parts(D, exp, 'o')
    return o.sort_values(['k', 'r', 'm']).reset_index(drop=True)


def oi(D):
    o = pd.read_parquet(os.path.join(ddir(D), 'oi_all.parquet'))
    return o


def q1s(D, k, r):
    """1-second NBBO of one 0DTE contract (seconds of day s, bid, ask, bs, as) or None if not fetched / empty."""
    f = os.path.join(ddir(D), 'q1s', f'{k:g}{"C" if r == 1 else "P"}.npz')
    if not os.path.exists(f):
        return None
    z = np.load(f)
    if 's' not in z.files or not len(z['s']):
        return None
    return {x: z[x] for x in z.files}


def trades(D):
    f = os.path.join(ddir(D), 'trades_0dte.parquet')
    return pd.read_parquet(f) if os.path.exists(f) else None


# ---------------------------------------------------------------- live recorder (UW), stamped at publication


def _et_sec(iso):
    """seconds of the ET day for a UTC ISO stamp (Nov 2026: EST = UTC-5)."""
    t = dt.datetime.fromisoformat(iso.replace('Z', '+00:00'))
    t = t.astimezone(dt.timezone(dt.timedelta(hours=-5)))
    return t.date().isoformat(), t.hour * 3600 + t.minute * 60 + t.second + t.microsecond / 1e6


def flow(D):
    """UW flow alerts available at created_at (publication), never start_time/end_time (the prints inside)."""
    iso = f'{D[:4]}-{D[4:6]}-{D[6:]}'
    rows = []
    for f in sorted(glob.glob(os.path.join(LIVE, 'flow-*.jsonl.gz'))):
        for line in gzip.open(f, 'rt'):
            r = json.loads(line)
            d, s = _et_sec(r['created_at'])
            if d != iso:
                continue
            rows.append({'s': s, 'ticker': r.get('ticker'), 'chain': r.get('option_chain'), 'type': r.get('type'),
                         'strike': float(r.get('strike') or 0), 'expiry': r.get('expiry'),
                         'prem': float(r.get('total_premium') or 0), 'ask_prem': float(r.get('total_ask_side_prem') or 0),
                         'bid_prem': float(r.get('total_bid_side_prem') or 0), 'sweep': bool(r.get('has_sweep')),
                         'rule': r.get('alert_rule'), 'size': int(float(r.get('total_size') or 0)),
                         'und': float(r.get('underlying_price') or 0), 'recv': r.get('_received_at')})
    df = pd.DataFrame(rows)
    return df.drop_duplicates(['s', 'chain', 'prem', 'rule']).sort_values('s').reset_index(drop=True) if len(df) else df


def news(D):
    iso = f'{D[:4]}-{D[4:6]}-{D[6:]}'
    rows = []
    for f in sorted(glob.glob(os.path.join(LIVE, 'news-*.jsonl.gz'))):
        for line in gzip.open(f, 'rt'):
            r = json.loads(line)
            d, s = _et_sec(r['created_at'])
            if d != iso:
                continue
            rows.append({'s': s, 'headline': r.get('headline', ''), 'major': bool(r.get('is_major')),
                         'sentiment': r.get('sentiment'), 'tickers': ','.join(r.get('tickers') or []),
                         'source': r.get('source'), 'recv': r.get('_received_at')})
    df = pd.DataFrame(rows)
    return df.drop_duplicates(['headline']).sort_values('s').reset_index(drop=True) if len(df) else df


def compass_rows(D, root='SPXW'):
    iso = f'{D[:4]}-{D[4:6]}-{D[6:]}'
    f = os.path.join(ROWS, f'{iso}.jsonl')
    if not os.path.exists(f):
        return None
    out = []
    for line in open(f):
        r = json.loads(line)
        if not r['k'].startswith(root + ' '):
            continue
        ks = r['k'].split()[1]
        out.append({'t': r['t'] * 60, 'k': float(ks[:-1]), 'r': 1 if ks[-1] == 'C' else 0, 'e': r['e'].replace('-', ''),
                    'bid': r['b'], 'ask': r['a'], 'S': r['s'], 'p1': r['p1'], 'p2': r.get('p2')})
    return pd.DataFrame(out)


def clock(s):
    s = int(round(s))
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def hm(m):
    return f'{int(m) // 60:02d}:{int(m) % 60:02d}'
