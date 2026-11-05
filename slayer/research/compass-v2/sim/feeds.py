"""Standard external event feeds, stamped at the moment the information became AVAILABLE (never earlier).

    ext = feeds.build(session, ['uw_alerts:SPY', 'uw_gex:SPX'])
    Engine(session, strategy, cfg, ext_events=ext)

uw_alerts:<T>  one event per Unusual Whales flow alert, at its created_at (publication). start_time/end_time (the
               prints inside the alert) are often minutes to hours earlier: using them would be look-ahead.
uw_gex:<T>     one event per per-minute spot-exposure row, at its `time` stamp (the vendor's compute time) + 1 s.
Both exist only for sessions >= 2023-12-06 (the key's history floor); before that the feed is empty.
Strategies receive these as Event(kind='uw_alert'|'uw_gex', data=dict-of-strings) and may read past ones with
ctx.ext_history(kind). A frozen spec names its feeds; it never reads the session itself.
"""
from __future__ import annotations

import pandas as pd


def _ms_et(ts: pd.Series, day: str) -> pd.Series:
    t = pd.to_datetime(ts, utc=True, format='ISO8601').dt.tz_convert('America/New_York')
    d0 = pd.Timestamp(day).tz_localize('America/New_York')
    return ((t - d0).dt.total_seconds() * 1000).round().astype('int64')


def uw_alerts(session, ticker: str) -> list:
    df = session.uw(f'alerts_{ticker}')
    if df is None or len(df) == 0:
        return []
    ms = _ms_et(df['created_at'], session.day)
    out = []
    for m, row in zip(ms, df.to_dict('records')):
        out.append((int(m), 'uw_alert', row))
    return out


def uw_gex(session, ticker: str) -> list:
    df = session.uw(f'gex_{ticker}')
    if df is None or len(df) == 0:
        return []
    ms = _ms_et(df['time'], session.day) + 1000
    return [(int(m), 'uw_gex', row) for m, row in zip(ms, df.to_dict('records'))]


FEEDS = {'uw_alerts': uw_alerts, 'uw_gex': uw_gex}


def build(session, names) -> list:
    ev = []
    for n in names or []:
        kind, _, arg = n.partition(':')
        ev += FEEDS[kind](session, arg)
    return sorted(ev, key=lambda x: x[0])
