"""How much does the NBBO move in the 2 s between a 1-minute bar close and the order's arrival?  (no terminal reads)

    python3 -m edata.latency_cal      -> markdown table (reports/DATA_COVERAGE.md section 6)

Source: the compass-v2 100 ms store (v2data/sessions: 20 DEV sessions, SPY/QQQ/SPXW, the first two expirations,
contracts with |delta| 0.10-0.60). For every contract and every minute end T in 09:45..15:50 with a two-sided
quote: buy cost change (ask(T+2s) - ask(T)) / mid(T) and sell change (bid(T) - bid(T+2s)) / mid(T) (positive =
worse for us), unconditionally and conditional on the contract's 5-minute MID move into T (premium up: the case of
a bullish premium trigger; premium down).
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import edata.common  # noqa: E402,F401
from data.store import Session, list_sessions  # noqa: E402

M0 = 9 * 60 + 30


def main():
    rows = []
    for D in list_sessions():
        s = Session(D)
        for root in s.roots:
            for c in s.contracts(root):
                q = s.quotes(c)
                ms, b, a = q['ms'], q['bid'].astype(float), q['ask'].astype(float)
                T = (M0 + np.arange(15, 381)) * 60_000
                i0 = np.searchsorted(ms, T, side='right') - 1
                i2 = np.searchsorted(ms, T + 2000, side='right') - 1
                i5 = np.searchsorted(ms, T - 300_000, side='right') - 1
                ok = (i0 >= 0) & (i5 >= 0)
                b0, a0, b2, a2, b5, a5 = (x[np.clip(i, 0, None)] for x, i in ((b, i0), (a, i0), (b, i2), (a, i2), (b, i5), (a, i5)))
                ok &= (b0 > 0) & (a0 >= b0) & (b2 > 0) & (a2 >= b2) & (b5 > 0) & (a5 >= b5)
                m0 = (a0 + b0) / 2
                mv = np.sign((a0 + b0) / 2 - (a5 + b5) / 2)
                rows.append(pd.DataFrame({'root': root, 'session': D, 'dte': 0 if c.exp == int(D) else 1,
                                          'buy': ((a2 - a0) / m0)[ok], 'sell': ((b0 - b2) / m0)[ok], 'spread': ((a0 - b0) / m0)[ok],
                                          'mv': mv[ok], 'px': (m0 / 100)[ok]}))
    df = pd.concat(rows, ignore_index=True)
    df = df[df.px >= 0.10]
    print(f'{len(df):,} contract-minutes, {df.session.nunique()} sessions\n')
    print('| subset | n | mean buy cost change (% of mid) | mean sell cost change | share ask unchanged | share bid unchanged | median spread |')
    print('|---|---|---|---|---|---|---|')
    for lab, x in [('all', df)] + [(f'{r}', g) for r, g in df.groupby('root')] + \
            [(f'DTE {d}', g) for d, g in df.groupby('dte')] + [('premium up over 5 min', df[df.mv > 0]),
                                                                ('premium down over 5 min', df[df.mv < 0])]:
        print(f'| {lab} | {len(x):,} | {100 * x.buy.mean():+.3f}% | {100 * x.sell.mean():+.3f}% | '
              f'{100 * (x.buy == 0).mean():.0f}% | {100 * (x.sell == 0).mean():.0f}% | {100 * x.spread.median():.2f}% |')
    print('\nRound trip (buy + sell) mean: '
          f'{100 * (df.buy.mean() + df.sell.mean()):+.3f}% of mid; premium-up entries: {100 * df[df.mv > 0].buy.mean():+.3f}% on the buy')


if __name__ == '__main__':
    main()
