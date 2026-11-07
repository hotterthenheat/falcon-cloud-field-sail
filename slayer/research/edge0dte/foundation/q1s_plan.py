"""Decision times that need executable fills (hurdle + baselines). Seeded and fixed before any fill is seen.

  python3 -m foundation.q1s_plan base     -> v2data/edge0dte/plan_base.parquet
  python3 -m foundation.q1s_plan signals  -> v2data/edge0dte/plan_signals.parquet  (EMA 9/21, ORB-30 entries)

base (priority order):
  1 SPXW, every DISCOVERY+CALIBRATION expiry session x {10:00, 12:00, 14:00}  (unconditional baselines; also
    hurdle rows for the 10:00, 12:00, 14:00 buckets on DISCOVERY)
  2 SPXW hurdle: for each other 30-min bucket of the 09:45-15:30 grid, 100 DISCOVERY sessions (seed 7) at a random
    grid time inside the bucket
  3 SPY, QQQ, IWM hurdle: 30 DISCOVERY sessions per bucket per root (seed 11) at a random grid time in the bucket
  4 SPY, QQQ, IWM unconditional baselines (as 1), fetched last if time allows
Each row: root, day, t, prio, purpose. The fetcher selects the 0.30-delta call, 0.30-delta put and the ATM strike from
the board at t and fetches their 1-second windows.
"""
import os
import sys

import numpy as np
import pandas as pd

from lib import cal
from lib.config import DATA, GRID, ROOTS, bucket, split

BASE_TIMES = (36000, 43200, 50400)


def disc_cal_sessions(root):
    return [d for d in cal.expiry_sessions(root, '2020-02-18', '2024-12-31')]


def grid_for(day):
    last = cal.close_min(day) * 60 - 30 * 60
    return [t for t in GRID if t <= last]


def base_plan():
    rows = []
    for d in disc_cal_sessions('SPXW'):
        for t in BASE_TIMES:
            if t <= cal.close_min(d) * 60 - 1800:
                rows.append(('SPXW', d, t, 1, 'base'))
    buckets = sorted(set(bucket(t) for t in GRID))
    for root, n, seed, prio in (('SPXW', 100, 7, 2), ('SPY', 30, 11, 3), ('QQQ', 30, 12, 3), ('IWM', 30, 13, 3)):
        rng = np.random.default_rng(seed)
        days = [d for d in disc_cal_sessions(root) if split(d) == 'DISCOVERY']
        for b in buckets:
            if root == 'SPXW' and b in ('10:00', '12:00', '14:00'):
                continue
            pick = rng.choice(len(days), size=min(n, len(days)), replace=False)
            for i in sorted(pick):
                d = days[i]
                ts = [t for t in grid_for(d) if bucket(t) == b]
                if not ts:
                    continue
                rows.append((root, d, int(rng.choice(ts)), prio, 'hurdle'))
    for root in ('SPY', 'QQQ', 'IWM'):
        for d in disc_cal_sessions(root):
            for t in BASE_TIMES:
                if t <= cal.close_min(d) * 60 - 1800:
                    rows.append((root, d, t, 4, 'base'))
    df = pd.DataFrame(rows, columns=['root', 'day', 't', 'prio', 'purpose'])
    df = df.sort_values(['prio', 'root', 'day', 't']).drop_duplicates(['root', 'day', 't'], keep='first')
    return df.reset_index(drop=True)


def main():
    what = sys.argv[1]
    if what == 'base':
        df = base_plan()
        df.to_parquet(os.path.join(DATA, 'plan_base.parquet'))
        print(df.groupby(['prio', 'root', 'purpose']).size())
    elif what == 'signals':
        from foundation.signals import signal_plan
        df = signal_plan()
        df.to_parquet(os.path.join(DATA, 'plan_signals.parquet'))
        print(df.groupby(['root', 'purpose']).size())


if __name__ == '__main__':
    main()
