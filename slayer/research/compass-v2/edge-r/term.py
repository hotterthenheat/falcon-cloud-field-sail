"""EDGE-R terminal access: gated (no request before 16:05 ET on a trading weekday), one request in flight per process
(run at most two processes), disk guard, never prints keys (the terminal needs none)."""
import datetime as dt
import os
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

BASE = 'http://127.0.0.1:25503/v3'
OUT = '/home/user/falcon-cloud-field-sail/v2data/edge-r'
NY = ZoneInfo('America/New_York')
STATS = {'req': 0, 'sec': 0.0, 'fail': 0}
BUDGET_MB = 700


def allowed():
    now = dt.datetime.now(NY)
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return not (8 * 60 <= hm < 16 * 60 + 5)


def disk_free_gb():
    st = os.statvfs(OUT)
    return st.f_bavail * st.f_frsize / 1e9


def used_mb():
    tot = 0
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            try:
                tot += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return tot / 1e6


class Refused(RuntimeError):
    pass


_CHECK = {'n': 0, 'mb': 0.0}


def get(path, tries=4, timeout=240):
    """Text body, '' for no data (404/472), None on failure."""
    if not allowed():
        raise Refused('terminal closed to EDGE-R before 16:05 ET')
    if disk_free_gb() < 1.5:
        raise Refused('disk free < 1.5 GB: stop fetching')
    _CHECK['n'] += 1
    if _CHECK['n'] % 200 == 1:
        _CHECK['mb'] = used_mb()
    if _CHECK['mb'] > BUDGET_MB:
        raise Refused('edge-r budget 700 MB reached')
    t0 = time.time()
    try:
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
        STATS['fail'] += 1
        return None
    finally:
        STATS['req'] += 1
        STATS['sec'] += time.time() - t0
