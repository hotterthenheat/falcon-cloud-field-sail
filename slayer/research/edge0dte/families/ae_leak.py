"""Leakage tests for the AE family features.

  cd slayer/research/edge0dte && python3 -m families.ae_leak

1. lib.tests.test_leakage.leakage(): every registered panel feature, including ae_p, ae_g7 and ae_calc (imported
   here), at 8 random grid times of 5 random DISCOVERY sessions per root, on the full session vs a copy with all data
   stamped after t deleted: values must be identical (plus the library's canary, outcome-horizon and guard checks).
2. A3 1-minute side: at 20 random minutes per test session, a3_side on the full session equals a3_side on the
   session truncated at that minute, with flips taken only from grid times <= the minute (each flip computed on the
   session truncated at its own grid time).
3. Point-in-time standardisation (families.ae_stage1.pit_scale / pit_pct): the scale and percentile of every row of
   day D are identical when all rows of days >= D+1 are deleted from the input.
Prints PASS/FAIL per check; exits non-zero on any failure.
"""
import sys

import numpy as np
import pandas as pd

from families import ae_dealer
from lib import panel
from lib.tests import test_leakage as T


def a3_test(days, n=20, seed=11):
    rng = np.random.default_rng(seed)
    for root, day in days:
        full = panel.session(root, day)
        g = panel.grid(day)
        flips = {}
        for t in g:
            flips[t] = ae_dealer._dealer(full.truncated(t), t, 0)['flip']
        flips_full = {t: ae_dealer._dealer(full, t, 0)['flip'] for t in g}
        T.check('a3 grid flip (truncated == full)', all(T.same(flips[t], flips_full[t]) for t in g), f'{root} {day}')
        for tau in sorted(rng.integers(g[0] // 60, g[-1] // 60 + 1, n) * 60):
            tau = int(tau)
            a = ae_dealer.a3_side(full, tau, flips_full)
            b = ae_dealer.a3_side(full.truncated(tau), tau, {t: f for t, f in flips.items() if t <= tau})
            T.check('a3 1-minute side', T.same(a, b), f'{root} {day} tau={tau}: {a} vs {b}')


def table_test(days, n=8, seed=5):
    """fast_strike_table == lib.dealer's original strike_table, value by value (P and G7)."""
    rng = np.random.default_rng(seed)
    for root, day in days:
        s = panel.session(root, day)
        for t in sorted(rng.choice(panel.grid(day), n, replace=False)):
            for md in (0, 7):
                a = ae_dealer._orig_strike_table(s, int(t), md)
                b = ae_dealer.fast_strike_table(s, int(t), md)
                ok = (a is None and b is None) or (a is not None and b is not None and set(a) == set(b) and all(
                    np.array_equal(np.asarray(a[k]), np.asarray(b[k]), equal_nan=True) for k in a))
                T.check('fast strike_table == lib strike_table', ok, f'{root} {day} t={t} max_dte={md}')


def pit_test():
    from families import ae_stage1 as S
    rng = np.random.default_rng(3)
    days = [f'2021-{m:02d}-{d:02d}' for m in range(1, 13) for d in (5, 12, 19, 26)]
    df = pd.DataFrame({'day': np.repeat(days, 6), 'bucket': np.tile(['10:00', '10:00', '10:00', '14:00', '14:00', '15:30'], len(days))})
    df['x'] = rng.normal(size=len(df))
    full_s = S.pit_scale(df, 'x')
    full_p = S.pit_pct(df, 'x')
    for cut in days[20::5]:
        sub = df[df.day <= cut]
        s = S.pit_scale(sub, 'x')
        p = S.pit_pct(sub, 'x')
        m = sub.day == cut
        T.check('pit scale (rows of D unchanged without D+1..)', np.allclose(s[m], full_s.loc[sub.index][m], equal_nan=True), cut)
        T.check('pit pct (rows of D unchanged without D+1..)', np.allclose(p[m], full_p.loc[sub.index][m], equal_nan=True), cut)
        # and the current day's own value does not enter its scale: perturb day D, scale of D unchanged
        sub2 = sub.copy()
        sub2.loc[m, 'x'] *= 100
        T.check('pit scale excludes day D itself', np.allclose(S.pit_scale(sub2, 'x')[m], s[m], equal_nan=True), cut)


def main():
    days = T.test_days()
    print('test days:', days, flush=True)
    T.leakage(days)
    T.check('canary leak detected', len(T.CANARY) > 0 and all(T.CANARY), f'{sum(T.CANARY)}/{len(T.CANARY)}')
    a3_test(days[::5] + days[1::5])
    table_test(days)
    if '--no-pit' not in sys.argv:
        pit_test()
    T.holdout_guard()
    for k, v in sorted(T.COUNTS.items()):
        nf = sum(1 for f in T.FAILS if f.startswith(k + ':'))
        print(f'{"PASS" if nf == 0 else "FAIL"}  {k}: {v - nf}/{v}')
    for f in T.FAILS[:30]:
        print('  ', f)
    print('TOTAL', 'FAIL' if T.FAILS else 'PASS', sum(T.COUNTS.values()), 'checks,', len(T.FAILS), 'failures')
    sys.exit(1 if T.FAILS else 0)


if __name__ == '__main__':
    main()
