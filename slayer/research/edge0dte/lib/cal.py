"""Session calendar: the NYSE exchange calendar (exchange_calendars XNYS), not "days we have data".

sessions(a, b)          list of 'YYYY-MM-DD'
close_min(day)          minute of day of the close (960, or 780 on early-close days)
expiries(root)          set of expiration dates from ThetaData's expiration list (cached exp_{root}.json, read-only)
expiry_sessions(root)   sessions in [START, END] that have a same-day expiry for root
"""
import functools
import json
import os

from .config import DATA, END, OLD, START


@functools.lru_cache(None)
def _cal():
    import exchange_calendars as xc
    return xc.get_calendar('XNYS')


@functools.lru_cache(None)
def _all_sessions():
    c = _cal()
    return tuple(str(x.date()) for x in c.sessions_in_range('2019-12-02', '2025-12-31'))


@functools.lru_cache(None)
def _early():
    c = _cal()
    out = {}
    for x in c.early_closes:
        d = str(x.date())
        if '2019-12-01' <= d <= '2025-12-31':
            cl = c.session_close(d).tz_convert('America/New_York')
            out[d] = cl.hour * 60 + cl.minute
    return out


def sessions(a=START, b=END):
    return [d for d in _all_sessions() if a <= d <= b]


def is_session(day):
    return day in set(_all_sessions())


def close_min(day):
    return _early().get(day, 960)


def prev_sessions(day, n):
    s = _all_sessions()
    import bisect
    i = bisect.bisect_left(s, day)
    return list(s[max(0, i - n):i])


@functools.lru_cache(None)
def expiries(root):
    for base in (DATA, OLD):
        f = os.path.join(base, f'exp_{root}.json')
        if os.path.exists(f):
            return frozenset(json.load(open(f)))
    from .theta import get
    import io
    import pandas as pd
    t = get(f'/option/list/expirations?symbol={root}&format=csv')
    df = pd.read_csv(io.StringIO(t))
    ex = sorted(set(str(x)[:10] for x in df[df.columns[-1]]))
    os.makedirs(DATA, exist_ok=True)
    json.dump(ex, open(os.path.join(DATA, f'exp_{root}.json'), 'w'))
    return frozenset(ex)


def expiry_sessions(root, a=START, b=END):
    e = expiries(root)
    return [d for d in sessions(a, b) if d in e]
