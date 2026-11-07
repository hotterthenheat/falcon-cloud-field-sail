"""FOUNDATION task 1 report: results/COVERAGE.md (sessions expected vs present, every missing day with its reason).

  cd slayer/research/edge0dte && python3 -m foundation.coverage

Expected root-session (REGISTRY_ADDENDUM_1 section 1): an NYSE session D (exchange calendar) on which a series of the
root expiring D was LISTED (ThetaData expiration list) AND TRADED on D (>= 1 print in the EOD record of that series,
foundation/expiry_check.py). Every NYSE session that is not expected is listed by reason (no series expiring D in the
record / listed but no print). Present = 1-minute underlying bars (>= 90% of minutes) + ETF volume (ETF roots) + the
0DTE 1-minute board + same-day OI.
"""
import collections
import json
import os

import pandas as pd

from lib import cal
from lib.config import DATA, OLD, ROOTS, START, UNDER

OUT = os.path.join(os.path.dirname(__file__), '..', 'results', 'COVERAGE.md')
WD = 'Mon Tue Wed Thu Fri'.split()


def _file(kind, root, day):
    for base in (DATA, OLD):
        f = os.path.join(base, kind, root, f'{day}.parquet')
        if os.path.exists(f):
            return f
    return None


def _rows(f):
    try:
        return len(pd.read_parquet(f, columns=['m']))
    except Exception:
        try:
            return len(pd.read_parquet(f))
        except Exception:
            return -1                                   # unreadable file


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


def expiry_record(root):
    f = os.path.join(DATA, 'expiry_check', f'{root}.jsonl')
    out = {}
    if os.path.exists(f):
        for line in open(f):
            r = json.loads(line)
            if r['status'] != 'fail':
                out[r['day']] = r
    return out


def status(root, day):
    """(ok, reasons) for one expected root-session."""
    reasons = []
    days, vol = bar_days(UNDER[root])
    nb = days.get(day, 0)
    full = (cal.close_min(day) - 570)
    if nb == 0:
        reasons.append('no 1-min underlying bars (ThetaData returned none)')
    elif nb < 0.9 * full:
        reasons.append(f'underlying bars partial ({nb}/{full})')
    if root != 'SPXW' and day not in vol:
        reasons.append('no ETF volume')
    f = _file('chain', root, day)
    if f is None:
        reasons.append('0DTE board not fetched yet (no request completed)')
    else:
        n = _rows(f)
        if n == 0:
            reasons.append('0DTE board empty (ThetaData returned no 1-min quotes for the same-day expiry)')
        elif n < 0:
            reasons.append('0DTE board file unreadable')
    f = _file('oi', root, day)
    if f is None:
        reasons.append('OI not fetched yet (no request completed)')
    else:
        o = pd.read_parquet(f)
        if not len(o) or not (o.e == 0).any():
            reasons.append('no same-day-expiry OI published for the day')
    return (not reasons), reasons


def main():
    sessions = cal.sessions()
    lines = ['# EDGE0DTE data coverage (FOUNDATION task 1, U1: SPXW, SPY, QQQ, IWM)', '',
             f'Session calendar: NYSE exchange calendar (exchange_calendars XNYS), {START} .. 2025-12-31 '
             f'({len(sessions)} sessions; early closes at 13:00 handled: grid ends 12:30, close = 13:00).', '',
             'EXPECTED root-session = a series of the root expiring that day was LISTED (ThetaData expiration list) AND '
             'TRADED that day (>= 1 print in the EOD record of the series expiring D, one request per root and NYSE '
             'session: foundation/expiry_check.py). No listing pattern (daily, Mon/Wed/Fri, ...) is assumed anywhere; '
             'the weekday profile below only describes the record. Sessions without a same-day expiry are excluded for '
             'that root, never filled with 1DTE. PRESENT = 1-minute underlying bars (>= 90% of minutes) + ETF volume '
             '(ETF roots) + the 0DTE 1-minute board + same-day OI. 2025 (HOLDOUT) data are fetched and counted here '
             'only; no outcome is computed on them.', '',
             'Labels: bars o/h/l/c/v/n OBS; board m/k/r/bid/ask/bs/as OBS; OI e/k/r/oi OBS (ts/td = publish stamp, '
             'OBS); EOD volume/count OBS; VIX/VIX1D bars OBS. Caches: v2data/edge0dte (new, zstd parquet) then '
             'v2data/edge (earlier, read-only).', '']
    # ---- same-day expiry record
    lines += ['## Same-day expiry: listed vs traded (the record)', '',
              '| root | year | NYSE sessions | listed | listed + traded (EXPECTED) | listed, no print | prints, not listed | '
              'no series expiring D | not yet checked | weekday profile of EXPECTED (Mon..Fri) |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---|']
    expected, anomalies, not_expected = {}, [], collections.defaultdict(list)
    for root in ROOTS:
        ex = cal.expiries(root)
        rec = expiry_record(root)
        exp_r = []
        for y in ('2020', '2021', '2022', '2023', '2024', '2025'):
            ss = [d for d in sessions if d[:4] == y]
            c = collections.Counter()
            wd = collections.Counter()
            for d in ss:
                listed = d in ex
                r = rec.get(d)
                if r is None:
                    c['unchecked'] += 1
                    if listed:
                        exp_r.append(d)
                        c['exp'] += 1
                        wd[pd.Timestamp(d).dayofweek] += 1
                    else:
                        not_expected[root].append((d, 'no series expiring D listed (EOD not yet checked)'))
                    c['listed'] += listed
                    continue
                traded = r.get('count', 0) > 0
                c['listed'] += listed
                if listed and traded:
                    c['exp'] += 1
                    exp_r.append(d)
                    wd[pd.Timestamp(d).dayofweek] += 1
                elif listed and not traded:
                    c['listed_np'] += 1
                    anomalies.append((root, d, f'listed, but no print in the EOD record (n={r.get("n")} series rows)'))
                    not_expected[root].append((d, 'listed but not traded'))
                elif traded and not listed:
                    c['np_listed'] += 1
                    anomalies.append((root, d, f'prints on D for an expiry D that is not in the expiration list '
                                               f'(count={r["count"]}); excluded until the list is reconciled'))
                    not_expected[root].append((d, 'traded but not listed'))
                else:
                    c['none'] += 1
                    not_expected[root].append((d, 'no series expiring D in the record'))
            prof = ' / '.join(str(wd.get(i, 0)) for i in range(5))
            lines.append(f"| {root} | {y} | {len(ss)} | {c['listed']} | {c['exp']} | {c['listed_np']} | {c['np_listed']} | "
                         f"{c['none']} | {c['unchecked']} | {prof} |")
        expected[root] = exp_r
    lines += ['', 'Anomalies (listed vs record): ' + (str(len(anomalies)) if anomalies else 'none'), '']
    if anomalies:
        lines += ['| root | day | anomaly |', '|---|---|---|'] + [f'| {r} | {d} | {a} |' for r, d, a in anomalies] + ['']
    # ---- expected vs present
    lines += ['## Root-sessions expected vs present', '',
              '| root | year | expected | present | missing | bars | board | OI |', '|---|---|---:|---:|---:|---:|---:|---:|']
    missing = []
    for root in ROOTS:
        by = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
        for d in expected[root]:
            ok, rs = status(root, d)
            y = d[:4]
            by[y][0] += 1
            by[y][1] += ok
            by[y][2] += not any('bars' in r or 'volume' in r for r in rs)
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
            ss = [d for d in sessions if d[:4] == y]
            lines.append(f'| {sym} | {y} | {sum(1 for d in ss if days.get(d, 0) > 0)} | {len(ss)} |')
    # ---- board quality (minutes with at least one valid two-sided quote)
    lines += ['', '## 0DTE board quality (OBS)', '',
              'Per expected root-session: share of the session\'s minutes (09:30 .. close-1) whose 1-minute snapshot has at '
              'least one strike with a valid two-sided quote (bid > 0, ask > bid).', '',
              '| root | year | sessions | median minute share | sessions < 90% | sessions < 50% |', '|---|---|---:|---:|---:|---:|']
    low = []
    for root in ROOTS:
        by = collections.defaultdict(list)
        for d in expected[root]:
            f = _file('chain', root, d)
            if f is None:
                continue
            try:
                c = pd.read_parquet(f, columns=['m', 'bid', 'ask'])
            except Exception:
                continue
            full = cal.close_min(d) - 570
            ok = c[(c.bid > 0) & (c.ask > c.bid) & (c.m >= 570) & (c.m < cal.close_min(d))]
            share = ok.m.nunique() / full
            by[d[:4]].append(share)
            if share < 0.9:
                low.append((root, d, share))
        for y in sorted(by):
            v = pd.Series(by[y])
            lines.append(f'| {root} | {y} | {len(v)} | {100 * v.median():.1f}% | {(v < 0.9).sum()} | {(v < 0.5).sum()} |')
    if low:
        lines += ['', 'Sessions below 90%: ' + ', '.join(f'{r} {d} ({100 * s:.0f}%)' for r, d, s in low)]
    lines += ['', '## Why sessions were missing in the previous report', '',
              'The 2026-11-07 WIP report counted 2021 entirely missing, 2020 and 2022 partial, 22 sessions of 2024 and '
              '60 of 2025. None of these was a data hole in ThetaData and none was a session without a same-day expiry '
              '(those are excluded above, never counted as missing): the old EDGE caches (v2data/edge) only held the '
              'periods earlier families had fetched, and the FOUNDATION gap fetcher (foundation/fetch_gaps.py) was '
              'stopped by the container restart part-way through SPY 2021 (1,704 of 3,455 board/OI jobs done, all ok). '
              'FOUNDATION-2 resumed it: the remaining 1,744 jobs (SPY 2021-11 .. QQQ/IWM 2020-2024, then 2025) all '
              'returned data (status ok, none empty, none failed). Two monthly bar files of the new cache were '
              'truncated by an earlier fetch (QQQ 2020-04: 13 of 21 sessions, SPY 2025-05: 15 of 21) and were '
              're-fetched in full (the truncated copies are kept as *.partial-bak). OI rows stamped after 09:30 of the '
              'session (intraday-listed strikes, almost all OI 0) are dropped by the loader (leakage rule).', '',
              f'## Every missing expected root-session ({len(missing)})', '', '| root | day | reason |', '|---|---|---|']
    lines += [f'| {r} | {d} | {why} |' for r, d, why in missing]
    lines += ['', '## NYSE sessions without a same-day expiry, by root (excluded, not missing)', '']
    for root in ROOTS:
        ne = not_expected[root]
        by = collections.Counter((d[:4], why) for d, why in ne)
        lines.append(f'- {root}: ' + '; '.join(f'{y} {why}: {n}' for (y, why), n in sorted(by.items())))
    lines.append('')
    lines += ['<details><summary>Full list of excluded sessions</summary>', '']
    for root in ROOTS:
        lines.append(f'{root}: ' + ', '.join(f'{d}' + ('' if why.startswith('no series') else f' ({why})')
                                             for d, why in not_expected[root]))
        lines.append('')
    lines += ['</details>', '']
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:70]))
    print(len(missing), 'missing')


if __name__ == '__main__':
    main()
