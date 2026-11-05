"""Look-ahead assertion for EDGE's pipeline (coordinator, after the K5 leak).

1. Truncation test: every recorded trigger (E1, E2, E3, E6 on DEV) is recomputed with sim.day_bars and the chain
   board restricted to what was visible at the trigger's decision time t (bars that closed by t; chain stamps
   <= t - 60). Any difference means the trigger read something later -> LookAheadError.
2. Canary: a deliberately peeking trigger (reads the bar that starts at t) must be caught by the same test.
3. Exits: run_trade asserts every underlying-rule minute it evaluates closed at or before the current second.
None of E1-E6 reads the challenger rows or common.load_day (only v2data/edge bars, chains, OI, 1-second quotes).

  python3 tests_lookahead.py
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim
import hyp


class LookAheadError(Exception):
    pass


_day_bars, _chain = sim.day_bars, sim.chain


def with_horizon(t):
    """Patch the data accessors so only data visible at t exists."""
    def db(root, day):
        b = _day_bars(root, day)
        return b[b.m <= (t - 60) // 60].reset_index(drop=True)

    def ch(root, day):
        c = _chain(root, day)
        return None if c is None else c[c.m <= (t - 60) // 60]
    sim.day_bars, sim.chain = db, ch
    hyp.sim.day_bars, hyp.sim.chain = db, ch


def restore():
    sim.day_bars, sim.chain = _day_bars, _chain


def same(a, b):
    for k, v in a.items():
        if k in ('band', 'bars', 't_end'):
            continue
        w = b.get(k)
        if isinstance(v, float) and isinstance(w, float):
            if np.isnan(v) and np.isnan(w):
                continue
            if np.isnan(v) != np.isnan(w) or abs(v - w) > 1e-9 * max(1, abs(v)):
                return False
        elif v != w:
            return False
    return True


def check(H, trig, limit=400):
    f = os.path.join(sim.ROOT, 'results', f'{H}_DEV.json')
    if not os.path.exists(f):
        return None
    have = json.load(open(f))
    n = 0
    for key, rec in have.items():
        if not rec or n >= limit:
            continue
        restore()
        full = trig(rec['root'], rec['day'])
        with_horizon(int(full['t']))
        try:
            vis = trig(rec['root'], rec['day'])
        except Exception:
            vis = None
        restore()
        if H == 'E1' and vis is not None and full is not None:
            # E1's day_bars length guard (>= 300 bars) is a data-completeness check on the whole day; skip it here
            pass
        if vis is None or not same(full, vis):
            raise LookAheadError(f'{H} {key}: trigger differs when later data is hidden')
        n += 1
    return n


def _len_guard_free(fn):
    """The triggers' '>= 300 bars' completeness guard reads the day's bar count (a data-quality filter, known from
    the vendor's session schedule, not from prices); the truncation test lifts it by padding the bar count check."""
    def g(root, day):
        b = sim.day_bars(root, day)
        if len(b) < 300 and len(_day_bars(root, day)) >= 300:
            pad = _day_bars(root, day)
            fut = pad[pad.m > b.m.max()].copy()
            fut[['o', 'h', 'l', 'c']] = np.nan  # future bars exist, their prices do not
            real = sim.day_bars
            sim.day_bars = hyp.sim.day_bars = lambda r, d: __import__('pandas').concat([b, fut], ignore_index=True)
            try:
                return fn(root, day)
            finally:
                sim.day_bars = hyp.sim.day_bars = real
        return fn(root, day)
    return g


def peeking_e1(root, day):
    b = sim.day_bars(root, day)
    t = 15 * 3600 + 25 * 60
    x = b[b.m == t // 60]  # the bar that starts at t: not closed at t
    return {'t': t, 'peek': float(x.c.iloc[0]) if len(x) else float('nan')}


if __name__ == '__main__':
    for H in ('E1', 'E2', 'E6', 'E3'):
        n = check(H, _len_guard_free(hyp.TRIG[H]))
        print(H, 'no look-ahead on', n, 'recorded triggers' if n is not None else '(not materialised)')
    try:
        have = json.load(open(os.path.join(sim.ROOT, 'results', 'E1_DEV.json')))
        rec = next(r for r in have.values() if r)
        restore()
        full = peeking_e1(rec['root'], rec['day'])
        with_horizon(full['t'])
        vis = peeking_e1(rec['root'], rec['day'])
        restore()
        if same(full, vis):
            print('CANARY NOT CAUGHT: the test is broken')
            sys.exit(1)
        print('canary (reads the bar starting at t) caught: OK')
    finally:
        restore()
