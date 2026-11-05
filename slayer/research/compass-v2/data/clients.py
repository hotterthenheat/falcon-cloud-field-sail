"""HTTP clients: the ThetaData v3 terminal (127.0.0.1:25503) and Unusual Whales.

Rules (V2_PROTOCOL): never start/kill the terminal; at most 2 terminal requests in flight from this process
(a process-wide semaphore); UW at most 1 in flight here (the key allows 3 across everyone). Keys are read from
/tmp/qa/keys.env and never printed or logged.
"""
from __future__ import annotations

import io
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

THETA_BASE = os.environ.get('THETA_BASE', 'http://127.0.0.1:25503/v3')
UW_BASE = 'https://api.unusualwhales.com'
KEYS_FILE = os.environ.get('V2_KEYS_FILE', '/tmp/qa/keys.env')

_theta_slots = threading.BoundedSemaphore(int(os.environ.get('V2_THETA_SLOTS', '2')))
_uw_slots = threading.BoundedSemaphore(1)


class NoData(Exception):
    """Terminal 472: the contract/date has no data (an answer, not an outage)."""


def _key(name: str) -> str:
    v = os.environ.get(name)
    if v:
        return v
    with open(KEYS_FILE) as f:
        for line in f:
            line = line.strip()
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise KeyError(f'{name} missing from env and {KEYS_FILE}')


def theta_get(path: str, params: dict, timeout: float = 600, retries: int = 4) -> bytes:
    """GET a terminal path; returns the raw body (csv unless params say otherwise). Raises NoData on 472."""
    q = dict(params)
    q.setdefault('format', 'csv')
    url = f'{THETA_BASE}{path}?{urllib.parse.urlencode(q)}'
    last = None
    for attempt in range(retries):
        with _theta_slots:
            try:
                with urllib.request.urlopen(url, timeout=timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                body = e.read()[:300].decode('utf8', 'replace')
                if e.code == 472 or 'no data' in body.lower():
                    raise NoData(f'{path} {params}') from None
                last = f'HTTP {e.code}: {body}'
                if e.code in (404, 471):
                    raise RuntimeError(f'{url} -> {last}') from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = repr(e)
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'terminal failed after {retries}: {path} {params}: {last}')


def theta_csv(path: str, params: dict, **kw):
    import pandas as pd
    body = theta_get(path, params, **kw)
    if not body.strip():
        raise NoData(f'{path} {params} (empty)')
    return pd.read_csv(io.BytesIO(body))


def uw_get(path: str, params: dict | None = None, timeout: float = 60, retries: int = 4):
    """GET an Unusual Whales REST path (JSON). Waits out 429s; one request in flight."""
    url = UW_BASE + path + (('?' + urllib.parse.urlencode(params, doseq=True)) if params else '')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + _key('UNUSUAL_WHALES_API_KEY'),
                                               'Accept': 'application/json'})
    last = None
    for attempt in range(retries):
        with _uw_slots:
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                body = e.read()[:300].decode('utf8', 'replace')
                last = f'HTTP {e.code}: {body}'
                if e.code == 429:
                    time.sleep(float(e.headers.get('Retry-After') or 2 ** attempt))
                    continue
                if e.code in (400, 401, 403, 404, 422):
                    raise RuntimeError(f'UW {path} -> {last}') from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = repr(e)
        time.sleep(2 ** attempt)
    raise RuntimeError(f'UW failed: {path}: {last}')
