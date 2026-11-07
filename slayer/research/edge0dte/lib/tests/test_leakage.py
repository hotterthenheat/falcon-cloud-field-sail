"""Leakage, OI-date, expiry and HOLDOUT-guard tests.

  cd slayer/research/edge0dte && python3 -m lib.tests.test_leakage [--fills]

1. Feature leakage: for 5 random DISCOVERY sessions per root (seed 2026) and 8 random grid times each, every exposed
   primitive (Session.spot / board / smile / iv_atm / sigma_h / select_delta / select_atm / bars_upto, dealer.exposures
   P and G, every registered panel feature) computed on the full session must equal the value computed on a copy with
   all data stamped after t deleted.
2. Outcome horizon: Z/V at (t, h) must equal the value with all data after t+h deleted, and must become NaN when the
   endpoint bar (closing at t+h) is deleted (the outcome really uses data up to t+h, and nothing after).
3. OI date: every OI row the loader returns is published on the session day before 09:30 (td == 0, ts < 570) for
   files that carry the stamp (rows stamped later are dropped by lib.data and counted); for cached files without it, 5 days per root are re-fetched raw and compared value by value.
4. Expiry: every panel/plan session is in the root's expiration list; one board row per tested day is re-fetched with
   expiration = day and must equal the cached snapshot.
5. HOLDOUT guard: outcomes and fills refuse 2025 and 2026 days without a registered sha256.
6. (--fills) Fill timing: every simulated fill second is >= decision + 2 s.
Prints PASS/FAIL per check and exits non-zero on any failure.
"""
import io
import math
import os
import sys

import numpy as np
import pandas as pd

from lib import cal, dealer, guard, panel
from lib.board import Session
from lib.config import DATA, OLD, ROOTS, split
from lib.outcomes import zv

FAILS = []
COUNTS = {}
CANARY = []


def same(a, b):
    if isinstance(a, dict) or isinstance(b, dict):
        if a is None or b is None:
            return a is None and b is None
        return set(a) == set(b) and all(same(a[k], b[k]) for k in a)
    if isinstance(a, pd.DataFrame) or isinstance(b, pd.DataFrame):
        if a is None or b is None:
            return a is None and b is None
        return a.reset_index(drop=True).equals(b.reset_index(drop=True))
    if a is None or b is None:
        return a is None and b is None
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return a == b
    if math.isnan(fa) and math.isnan(fb):
        return True
    return fa == fb


def check(name, ok, detail=''):
    COUNTS[name] = COUNTS.get(name, 0) + 1
    if not ok:
        FAILS.append(f'{name}: {detail}')


def test_days(seed=2026, n=5):
    rng = np.random.default_rng(seed)
    out = []
    for root in ROOTS:
        days = [d for d in cal.expiry_sessions(root) if split(d) == 'DISCOVERY']
        from lib.data import chain, bars
        days = [d for d in days if chain(root, d) is not None and len(bars(root, d))]
        for i in rng.choice(len(days), n, replace=False):
            out.append((root, days[i]))
    return out


def leakage(days, n_times=8, seed=7):
    rng = np.random.default_rng(seed)
    for root, day in days:
        full = panel.session(root, day)
        times = sorted(rng.choice(panel.grid(day), n_times, replace=False))
        for t in times:
            t = int(t)
            tr = full.truncated(t)
            prims = {
                'spot': lambda s: s.spot(t),
                'board': lambda s: s.board(t),
                'smile': lambda s: s.smile(t),
                'iv_atm': lambda s: s.iv_atm(t),
                'bars_upto': lambda s: s.bars_upto(t),
                'select_call': lambda s: s.select_delta(t, True),
                'select_put': lambda s: s.select_delta(t, False),
                'select_atm': lambda s: s.select_atm(t),
                'exposures_P': lambda s: dealer.exposures(s, t),
                'exposures_G7': lambda s: dealer.exposures(s, t, max_dte=7),
            }
            for h in (15, 30, 60, 'close'):
                prims[f'sigma_{h}'] = (lambda hh: (lambda s: s.sigma_h(t, hh)))(h)
            for name, (fn, _) in panel.FEATURES.items():
                prims[f'feature:{name}'] = (lambda f: (lambda s: f(s, t)))(fn)
            for name, f in prims.items():
                a, b = f(full), f(tr)
                check(f'leak {name}', same(a, b), f'{root} {day} t={t}: full={a!r:.80} trunc={b!r:.80}')
            # canary: a deliberately leaky feature (last bar of the whole session) must be caught
            canary = (lambda s: float(s.bars.c.iloc[-1]) if len(s.bars) else np.nan)
            CANARY.append(not same(canary(full), canary(tr)))
            # outcomes: identical with data after t+h deleted; NaN without the endpoint bar
            for h in (15, 30, 60, 'close'):
                end = full.close * 60 if h == 'close' else t + 60 * h
                if end > full.close * 60:
                    continue
                a = zv(full, t, h)
                b = zv(full.truncated(end), t, h, iv=full.iv_atm(t))
                check(f'outcome horizon {h}', same(a['Z'], b['Z']) and same(a['V'], b['V']),
                      f'{root} {day} t={t}: {a} vs {b}')
                c = zv(full.truncated(end - 60), t, h, iv=full.iv_atm(t))
                check(f'outcome endpoint {h}', not np.isfinite(c['Z']) or not np.isfinite(a['Z']),
                      f'{root} {day} t={t}: Z computable without its endpoint bar')


def oi_date(days):
    from lib.theta import get
    for root, day in days:
        for base in (DATA, OLD):
            f = os.path.join(base, 'oi', root, f'{day}.parquet')
            if os.path.exists(f):
                o = pd.read_parquet(f)
                break
        else:
            check('oi present', False, f'{root} {day}')
            continue
        if 'td' in o.columns:
            from lib.data import oi as load_oi
            u = load_oi(root, day, 31)                     # the rows the library actually uses
            check('oi stamp (rows used)', u is not None and bool(((u.td == 0) & (u.ts < 570)).all()),
                  f'{root} {day}: td {None if u is None else u.td.unique()} ts max {None if u is None else u.ts.max()}')
            late = o[(o.td != 0) | (o.ts >= 570)]
            COUNTS['oi rows stamped after the open (dropped by the loader)'] = \
                COUNTS.get('oi rows stamped after the open (dropped by the loader)', 0) + len(late)
        else:
            t = get(f'/option/history/open_interest?symbol={root}&expiration={day.replace("-", "")}&date={day.replace("-", "")}&format=csv')
            if not t:
                check('oi refetch', False, f'{root} {day}: no raw OI')
                continue
            raw = pd.read_csv(io.StringIO(t))
            ts = pd.to_datetime(raw['timestamp'])
            check('oi stamp (raw)', bool(((ts.dt.strftime('%Y-%m-%d') == day) & (ts.dt.hour * 60 + ts.dt.minute < 570)).all()),
                  f'{root} {day}: stamps {ts.min()}..{ts.max()}')
            raw = raw.assign(k=raw.strike.astype('float32'), r=(raw.right.str.upper().str[0] == 'C').astype('int8'))
            m = o[o.e == 0].merge(raw[['k', 'r', 'open_interest']], on=['k', 'r'], how='inner')
            check('oi values (raw)', len(m) > 0 and bool((m.oi == m.open_interest).all()), f'{root} {day}: {len(m)} rows')


def expiry(days):
    from lib.theta import get
    from lib.data import chain
    for root, day in days:
        check('expiry list', day in cal.expiries(root), f'{root} {day}')
        c = chain(root, day)
        row = c[c.m == 600].iloc[len(c[c.m == 600]) // 2]
        y = day.replace('-', '')
        ks = f'{float(row.k):.3f}'.rstrip('0').rstrip('.')
        t = get(f'/option/history/quote?symbol={root}&expiration={y}&strike={ks}&right={"call" if row.r == 1 else "put"}'
                f'&start_date={y}&end_date={y}&interval=1m&start_time=10:00:00&end_time=10:00:00&format=csv')
        if not t:
            check('expiry refetch', False, f'{root} {day}')
            continue
        raw = pd.read_csv(io.StringIO(t))
        ok = len(raw) >= 1 and abs(raw.bid.iloc[0] - row.bid) < 1e-4 and abs(raw.ask.iloc[0] - row.ask) < 1e-4 \
            and str(raw.expiration.iloc[0])[:10] == day
        check('expiry board = same-day expiration', ok, f'{root} {day} k={ks}: cached {row.bid}/{row.ask} raw {raw.iloc[0].to_dict()}')


def holdout_guard():
    from lib import fills
    old = os.environ.pop('EDGE0DTE_HOLDOUT', None)
    for day in ('2025-03-03', '2025-12-31', '2026-01-02'):
        try:
            guard.check(day)
            check('guard refuses', False, day)
        except guard.HoldoutError:
            check('guard refuses', True)
        try:
            fills.simulate('SPXW', day, [(5000.0, True, 1)], 36000, 39600, fetch=False)
            check('fills refuse', False, day)
        except guard.HoldoutError:
            check('fills refuse', True)
    os.environ['EDGE0DTE_HOLDOUT'] = '0' * 64
    try:
        guard.check('2025-03-03')
        check('guard refuses unregistered sha', False, 'accepted a fake sha')
    except guard.HoldoutError:
        check('guard refuses unregistered sha', True)
    try:
        guard.check('2026-03-03')
        check('guard refuses 2026', False, '')
    except guard.HoldoutError:
        check('guard refuses 2026', True)
    os.environ.pop('EDGE0DTE_HOLDOUT', None)
    if old is not None:
        os.environ['EDGE0DTE_HOLDOUT'] = old
    check('guard allows 2024', guard.check('2024-12-31'))


def fill_timing():
    import json
    from lib import fills
    for root in ROOTS:
        f = os.path.join(DATA, 'selections', f'{root}.jsonl')
        if not os.path.exists(f):
            continue
        rows = [json.loads(x) for x in open(f)][:200]
        for r in rows:
            if r['status'] != 'ok' or not r.get('call_k'):
                continue
            t = r['t']
            for h in (15, 60, 'close'):
                x = fills.exit_decision(r['day'], t, h)
                s = fills.simulate(root, r['day'], [(r['call_k'], True, 1)], t, x, fetch=False)
                if s['skip']:
                    continue
                lg = s['legs'][0]
                check('fill timing', lg['entry_s'] >= t + 2 and lg['exit_s'] >= x + 2, f'{root} {r["day"]} {t} {lg}')


def main():
    days = test_days()
    print('test days:', days, flush=True)
    leakage(days)
    check('canary leak detected', len(CANARY) > 0 and all(CANARY), f'{sum(CANARY)}/{len(CANARY)} leaky canaries caught')
    if '--offline' not in sys.argv:          # these two make ThetaData requests
        oi_date(days)
        expiry(days)
    holdout_guard()
    if '--fills' in sys.argv:
        fill_timing()
    for k, v in sorted(COUNTS.items()):
        nf = sum(1 for f in FAILS if f.startswith(k + ':'))
        print(f'{"PASS" if nf == 0 else "FAIL"}  {k}: {v - nf}/{v}')
    for f in FAILS[:30]:
        print('  ', f)
    print('TOTAL', 'FAIL' if FAILS else 'PASS', sum(COUNTS.values()), 'checks,', len(FAILS), 'failures')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
