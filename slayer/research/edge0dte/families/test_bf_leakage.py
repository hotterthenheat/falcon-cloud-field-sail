"""Leakage tests for family BF (run: cd slayer/research/edge0dte && python3 -m families.test_bf_leakage).

1. Registry test (lib.tests.test_leakage.leakage, offline): every registered feature, including bf_<row> for all 18
   BF rows (all P and G params as dict columns) and bf_xcond (GEX sign / walls / VIX tercile), computed on the full
   session equals the value on a copy with all data stamped after t deleted (5 DISCOVERY sessions per root, seed 2026,
   8 random grid times each).
2. Prefix test (stronger, covers the 1-minute F7/F8 event times and the state rows): for sessions per root and a set of
   cut times tau (random 5-minute boundaries and random 1-minute boundaries), the events of the bulk run
   (day_events(full session)) with t <= tau are IDENTICAL (row, param, t, dir and every extra) to
     (a) day_events(full session, tmax=tau) and
     (b) day_events(session truncated at tau, tmax=tau).
3. Swing confirmation: every swing of bar i is absent from the swings found with data up to one minute before the
   close of bar i+2 and present at that close (a swing is known 2 bars after it forms, never earlier).
4. Canary: the same prefix test on a deliberately leaky variant (swings usable when they form) must FAIL on at least
   one session, i.e. the test has power.
"""
import sys

import numpy as np

from families import bf          # registers the BF features before the registry test runs
from lib import panel
from lib.tests import test_leakage as TL

FAILS, COUNTS = [], {}


def check(name, ok, detail=''):
    COUNTS[name] = COUNTS.get(name, 0) + 1
    if not ok:
        FAILS.append(f'{name}: {detail}')


def canon(evs):
    out = []
    for e in evs:
        out.append(tuple(sorted((k, repr(v) if not isinstance(v, float) else repr(round(v, 12))) for k, v in e.items())))
    return sorted(out)


def prefix(days, n_cut=14, seed=11, leak=False):
    rng = np.random.default_rng(seed)
    bad = 0
    for root, day in days:
        full = panel.session(root, day)
        allev = bf.day_events(full, _leak_swings=leak)
        cm = full.close
        fives = list(range((570 + 10) * 60, cm * 60 + 1, 300))
        ones = list(range(571 * 60, cm * 60 + 1, 60))
        cuts = sorted(set(rng.choice(fives, n_cut // 2, replace=False).tolist() + rng.choice(ones, n_cut // 2, replace=False).tolist()))
        # also cut exactly at (and one minute before) the time of a few F7/F8 1-minute events
        ev1 = [e['t'] for e in allev if e['row'] in ('F7', 'F8')]
        for t in ev1[:3]:
            cuts += [t, t - 60]
        for tau in sorted(set(cuts)):
            want = canon([e for e in allev if e['t'] <= tau])
            a = canon(bf.day_events(full, tau, _leak_swings=leak))
            b = canon(bf.day_events(full.truncated(tau), tau, _leak_swings=leak))
            ok = want == a and want == b
            if not leak:
                check('prefix events (full tmax=tau, truncated)', ok,
                      f'{root} {day} tau={tau}: bulk {len(want)} vs tmax {len(a)} vs trunc {len(b)}; '
                      f'diff {sorted(set(want) ^ set(b))[:2]}')
            bad += not ok
    return bad


def swing_timing(days):
    for root, day in days:
        full = panel.session(root, day)
        B = bf.bars5(bf._rth(full.bars, day), full.close, full.close)
        sh, sl = bf.swings(B)
        for i, lev, ci in sh + sl:
            tc = int(B['t'][ci])
            b_before = bf.bars5(bf._rth(full.bars_upto(tc - 60), day), (tc - 60) // 60, full.close)
            b_at = bf.bars5(bf._rth(full.bars_upto(tc), day), tc // 60, full.close)
            s0 = bf.swings(b_before) if b_before is not None else ([], [])
            s1 = bf.swings(b_at)
            known0 = any(x[0] == i and x[1] == lev for x in s0[0] + s0[1])
            known1 = any(x[0] == i and x[1] == lev for x in s1[0] + s1[1])
            check('swing unknown 1 min before bar i+2 closes', not known0, f'{root} {day} i={i}')
            check('swing known at the close of bar i+2', known1, f'{root} {day} i={i}')


def main():
    days = TL.test_days()
    print('test days:', days, flush=True)
    TL.leakage(days)
    TL.check('canary leak detected', len(TL.CANARY) > 0 and all(TL.CANARY), '')
    pdays = days[::2]                       # 10 sessions (alternate days of the 20) for the slower prefix test
    prefix(pdays)
    swing_timing(pdays)
    nbad = prefix(pdays[:6], leak=True)
    check('canary: leaky swings caught by the prefix test', nbad > 0, f'{nbad} mismatching cuts')
    for k, v in sorted(TL.COUNTS.items()):
        nf = sum(1 for f in TL.FAILS if f.startswith(k + ':'))
        print(f'{"PASS" if nf == 0 else "FAIL"}  {k}: {v - nf}/{v}')
    for k, v in sorted(COUNTS.items()):
        nf = sum(1 for f in FAILS if f.startswith(k + ':'))
        print(f'{"PASS" if nf == 0 else "FAIL"}  {k}: {v - nf}/{v}')
    for f in (TL.FAILS + FAILS)[:30]:
        print('  ', f)
    allf = TL.FAILS + FAILS
    print('TOTAL', 'FAIL' if allf else 'PASS', sum(TL.COUNTS.values()) + sum(COUNTS.values()), 'checks,', len(allf), 'failures')
    sys.exit(1 if allf else 0)


if __name__ == '__main__':
    main()
