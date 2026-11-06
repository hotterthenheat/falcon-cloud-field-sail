"""EDGE-G shared paths, calendar, split guards and the terminal client (one request in flight, never prints keys).

Reuses EDGE's caches read-only: v2data/edge/{chain,bars,oi}, edge-r/board. Own data: v2data/edge-g.
"""
import io, json, os, sys, time, urllib.request, urllib.error
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.join(HERE, '..', '..', 'compass-v2')  # NOV5 vendored copy: path adjusted
sys.path.insert(0, V2)
from data.splits import split_of  # noqa: E402

DATA = '/home/user/falcon-cloud-field-sail/v2data'
EDGE = os.path.join(DATA, 'edge')
OUT = os.path.join(DATA, 'edge-g')
BASE = 'http://127.0.0.1:25503/v3'
ROOTS = ('SPY', 'QQQ', 'IWM', 'SPXW')
UNDER = {'SPY': 'SPY', 'QQQ': 'QQQ', 'IWM': 'IWM', 'SPXW': 'SPX'}
YEAR_MIN = 390.0 * 252
MIN_FREE_GB = 3.0
STATS = {'req': 0, 'req_s': 0.0, 'fail': 0}


def disk_free_gb(p=DATA):
    st = os.statvfs(p)
    return st.f_bavail * st.f_frsize / 1e9


def assert_open(day, allow=('DEV',)):
    s = split_of(day)
    if s not in allow:
        raise AssertionError(f'{day} is {s}: refused')


def get(path, tries=5, timeout=300):
    """One terminal GET (callers are sequential: one request in flight). '' = no data; None = failed."""
    url = BASE + path
    for k in range(tries):
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                txt = r.read().decode()
            STATS['req'] += 1
            STATS['req_s'] += time.time() - t0
            return txt
        except urllib.error.HTTPError as e:
            if e.code in (404, 472):
                STATS['req'] += 1
                return ''
            time.sleep(5 * (k + 1))
        except Exception:
            time.sleep(10 * (k + 1))
    STATS['fail'] += 1
    return None


def atomic_parquet(df, f):
    os.makedirs(os.path.dirname(f), exist_ok=True)
    tmp = f + '.tmp'
    df.to_parquet(tmp, compression='zstd', index=False)
    os.replace(tmp, f)


def atomic_json(obj, f):
    os.makedirs(os.path.dirname(f), exist_ok=True)
    tmp = f + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(obj, fh)
    os.replace(tmp, f)


_CAL = None


def calendar():
    """Every trading day in EDGE's session list and SPX bar files (non-LOCKED months only are read)."""
    global _CAL
    if _CAL is None:
        days = set(json.load(open(os.path.join(EDGE, 'sessions.json'))))
        d = os.path.join(EDGE, 'bars', 'SPX')
        for f in os.listdir(d):
            m = f[:7]
            if split_of(m + '-15') in ('LOCKED',) and split_of(m + '-01') == 'LOCKED' and split_of(m + '-28') == 'LOCKED':
                continue
            if m[:4] == '2021':
                days |= set(pd.read_parquet(os.path.join(d, f)).d.unique())
        _CAL = sorted(days)
    return _CAL


def prior_session(day):
    c = calendar()
    i = int(np.searchsorted(c, day))
    return c[i - 1] if i > 0 else None


def dev_sessions(split='DEV'):
    """Sessions with a same-day expiry cached for at least one root, in the split, prior session not LOCKED."""
    days = set()
    for r in ROOTS:
        d = os.path.join(EDGE, 'chain', r)
        days |= {f[:10] for f in os.listdir(d) if f.endswith('.parquet')}
    out = []
    for d in sorted(days):
        if split_of(d) != split:
            continue
        p = prior_session(d)
        if p is None or split_of(p) == 'LOCKED':
            continue
        out.append(d)
    return out


def has_chain(root, day):
    return os.path.exists(os.path.join(EDGE, 'chain', root, f'{day}.parquet'))
