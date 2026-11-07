"""FOUNDATION task 1 report: results/COVERAGE.md (sessions expected vs present, every missing day with its reason).

  cd slayer/research/edge0dte && python3 -m foundation.coverage
"""
import collections
import os

import pandas as pd

from lib import cal
from lib.config import DATA, OLD, ROOTS, UNDER

OUT = os.path.join(os.path.dirname(__file__), '..', 'results', 'COVERAGE.md')


def _file(kind, root, day):
    for base in (DATA, OLD):
        f = os.path.join(base, kind, root, f'{day}.parquet')
        if os.path.exists(f):
            return f
    return None


def _rows(f):
    try:
        return len(pd.read_parquet(f, columns=[]))
    except Exception:
        return len(pd.read_parquet(f))


_BARS = {}


def bar_days(sym):
    if sym not in _BARS:
        days = collections.Counter()
        vol = set()
        for base in (OLD, DATA):
            d = os.path.join(base, 'bars', sym)
            if not os.path.isdir(d):
                continue
            for f in os.listdir(d):
                b = pd.read_parquet(os.path.join(d, f))
                if len(b):
                    c = b.groupby('d').size()
                    for k, v in c.items():
                        days[k] = max(days[k], int(v))
                    if 'v' in b.columns:
                        vol.update(b.d[b.v > 0].unique())
        _BARS[sym] = (days, vol)
    return _BARS[sym]


def status(root, day):
    """(ok, reasons) for one root-session."""
    reasons = []
    days, vol = bar_days(UNDER[root])
    nb = days.get(day, 0)
    full = (cal.close_min(day) - 570)
    if nb == 0:
        reasons.append('no 1-min underlying bars (ThetaData returned none)')
    elif nb < 0.9 * full:
        reasons.append(f'underlying bars partial ({nb}/{full})')
    if root != 'SPXW':
        if day not in vol:
            reasons.append('no ETF volume')
    f = _file('chain', root, day)
    if f is None:
        reasons.append('0DTE board not fetched (request failed)')
    elif _rows(f) == 0:
        reasons.append('0DTE board empty (ThetaData returned no quotes for the same-day expiry)')
    f = _file('oi', root, day)
    if f is None:
        reasons.append('OI not fetched (request failed)')
    else:
        o = pd.read_parquet(f)
        if not len(o) or not (o.e == 0).any():
            reasons.append('no same-day-expiry OI published for the day')
    return (not reasons), reasons


def main():
    lines = ['# EDGE0DTE data coverage (FOUNDATION task 1)', '',
             'Session calendar: NYSE exchange calendar (exchange_calendars XNYS), 2020-02-18 .. 2025-12-31 '
             f'({len(cal.sessions())} sessions; early closes at 13:00 handled: grid ends 12:30, close = 13:00). '
             'A root-session is EXPECTED when ThetaData\'s expiration list for the root has an expiry that day '
             '(sessions without a same-day expiry are excluded for that root, never filled with 1DTE). '
             'PRESENT = 1-minute underlying bars (>= 90% of minutes) + ETF volume (ETF roots) + the 0DTE 1-minute '
             'board + same-day OI.', '',
             'Labels: bars o/h/l/c/v/n OBS; board m/k/r/bid/ask/bs/as OBS; OI e/k/r/oi OBS (ts/td = publish stamp, '
             'OBS); VIX/VIX1D bars OBS. Caches: v2data/edge0dte (new, zstd parquet) then v2data/edge (earlier, read-only).',
             '', '## Root-sessions expected vs present', '',
             '| root | year | expected | present | missing | bars | board | OI |', '|---|---|---:|---:|---:|---:|---:|---:|']
    missing = []
    for root in ROOTS:
        by = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
        for d in cal.expiry_sessions(root):
            ok, rs = status(root, d)
            y = d[:4]
            by[y][0] += 1
            by[y][1] += ok
            by[y][2] += not any('bars' in r for r in rs)
            by[y][3] += not any('board' in r for r in rs)
            by[y][4] += not any('OI' in r for r in rs)
            if not ok:
                missing.append((root, d, '; '.join(rs)))
        for y in sorted(by):
            e, p, b, c, o = by[y]
            lines.append(f'| {root} | {y} | {e} | {p} | {e - p} | {b} | {c} | {o} |')
    lines += ['', '## Regime series (OBS)', '', '| series | year | sessions with 1-min bars | of sessions |', '|---|---|---:|---:|']
    for sym in ('VIX', 'VIX1D', 'SPX', 'SPY', 'QQQ', 'IWM'):
        days, _ = bar_days(sym)
        for y in ('2020', '2021', '2022', '2023', '2024', '2025'):
            ss = [d for d in cal.sessions() if d[:4] == y]
            lines.append(f'| {sym} | {y} | {sum(1 for d in ss if days.get(d, 0) > 0)} | {len(ss)} |')
    lines += ['', f'## Every missing root-session ({len(missing)})', '', '| root | day | reason |', '|---|---|---|']
    lines += [f'| {r} | {d} | {why} |' for r, d, why in missing]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:60]))
    print(len(missing), 'missing')


if __name__ == '__main__':
    main()
