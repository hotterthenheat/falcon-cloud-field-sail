"""EDGE-B shared helpers: clients (1 ThetaData request in flight, 1 UW request in flight), splits, calendars.

Keys are read from /tmp/qa/keys.env and never printed. ThetaData terminal: 127.0.0.1:25503 (never started/killed here).
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DATA = os.environ.get('EDGEB_DATA', '/home/user/falcon-cloud-field-sail/v2data/edge-b')
THETA = 'http://127.0.0.1:25503/v3'
UW = 'https://api.unusualwhales.com/api'
_theta_slot = threading.BoundedSemaphore(1)   # EDGE-B: at most 1 terminal request in flight
_uw_slot = threading.BoundedSemaphore(1)


class NoData(Exception):
    pass


def _key(name):
    with open('/tmp/qa/keys.env') as f:
        for line in f:
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise KeyError(name)


def uw_get(path, params=None, retries=5):
    url = UW + path + (('?' + urllib.parse.urlencode(params, doseq=True)) if params else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + _key('UNUSUAL_WHALES_API_KEY'),
                                               'Accept': 'application/json'})
    last = None
    for a in range(retries):
        with _uw_slot:
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                body = e.read()[:300].decode('utf8', 'replace')
                last = f'{e.code} {body}'
                if e.code == 429:
                    time.sleep(float(e.headers.get('Retry-After') or 2 ** a)); continue
                if e.code in (400, 401, 403, 404, 422):
                    raise RuntimeError(f'UW {path}: {last}') from None
            except Exception as e:  # noqa
                last = repr(e)
        time.sleep(2 ** a)
    raise RuntimeError(f'UW failed {path}: {last}')


class _xproc_lock:
    """cross-process lock: all EDGE-B processes together keep 1 terminal request in flight"""
    def __enter__(self):
        import fcntl
        self.f = open(os.path.join(DATA, '.theta.lock'), 'w')
        fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        import fcntl
        fcntl.flock(self.f, fcntl.LOCK_UN); self.f.close()


def theta_csv(path, params, retries=4, timeout=300):
    import pandas as pd
    q = dict(params); q.setdefault('format', 'csv')
    url = f'{THETA}{path}?{urllib.parse.urlencode(q)}'
    last = None
    for a in range(retries):
        with _theta_slot, _xproc_lock():
            try:
                with urllib.request.urlopen(url, timeout=timeout) as r:
                    body = r.read()
                if not body.strip():
                    raise NoData(url)
                return pd.read_csv(io.BytesIO(body))
            except urllib.error.HTTPError as e:
                b = e.read()[:300].decode('utf8', 'replace')
                if e.code == 472 or 'no data' in b.lower():
                    raise NoData(url) from None
                last = f'{e.code} {b}'
                if e.code in (404, 471, 400):
                    raise RuntimeError(f'{url}: {last}') from None
            except NoData:
                raise
            except Exception as e:  # noqa
                last = repr(e)
        time.sleep(2 * (a + 1))
    raise RuntimeError(f'theta failed {url}: {last}')


# ---- splits (V2_PROTOCOL item 6; UW history starts 2023-12-06 for this token) ----
LOCKED_RANGES = [(dt.date(2022, 6, 1), dt.date(2022, 9, 30)), (dt.date(2024, 8, 1), dt.date(2024, 8, 31)),
                 (dt.date(2025, 1, 1), dt.date(2025, 3, 31)), (dt.date(2026, 7, 1), dt.date(2099, 1, 1))]


def split_of(d: dt.date) -> str:
    for a, b in LOCKED_RANGES:
        if a <= d <= b:
            return 'LOCKED'
    if d < dt.date(2025, 1, 1):
        return 'DEV'
    if d <= dt.date(2025, 12, 31):
        return 'VAL'
    return 'LOCKED'


# fetch windows that never touch a locked day (UTC bounds, generous)
WINDOWS = {
    'DEV': [('2023-12-06T00:00:00Z', '2024-08-01T00:00:00Z'), ('2024-09-01T00:00:00Z', '2025-01-01T00:00:00Z')],
    'VAL': [('2025-04-01T00:00:00Z', '2026-01-01T00:00:00Z')],
}

ET = None


def et_tz():
    global ET
    if ET is None:
        from zoneinfo import ZoneInfo
        ET = ZoneInfo('America/New_York')
    return ET


def write_jsonl_gz(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with gzip.open(tmp, 'wt') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    os.replace(tmp, path)


def read_jsonl_gz(path):
    with gzip.open(path, 'rt') as f:
        return [json.loads(l) for l in f]
