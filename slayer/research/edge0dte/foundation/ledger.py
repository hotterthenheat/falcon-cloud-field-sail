"""FOUNDATION task 6: append the hurdle and every baseline run to research-v2-ledger.md (family EDGE0DTE).

  python3 -m foundation.ledger   (appends; run once)
Format: date | worker | id | set | n | result | note.
"""
import datetime
import os

import numpy as np
import pandas as pd

from lib.config import DATA

LEDGER = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'research-v2-ledger.md')


def pct(x):
    return '-' if x is None or not np.isfinite(x) else f'{100 * x:+.1f}%'


def main():
    day = datetime.date.today().isoformat()
    lines = []
    h = pd.read_parquet(os.path.join(DATA, 'hurdle.parquet'))
    for root in ('SPXW', 'SPY', 'QQQ', 'IWM'):
        a = h[(h.root == root) & (h.bucket == 'all')].set_index('h')
        if not len(a):
            continue
        parts = []
        for hh in ('15', '30', '60', 'close'):
            if hh in a.index:
                r = a.loc[hh]
                parts.append(f"h{hh}: cost 0.30d {100 * r.cost_single_med:.1f}% / straddle {100 * r.cost_straddle_med:.1f}% (median), "
                             f"E[za]* {r.hz:+.2f}, E[V]-1* long {r.hv_long:+.2f} / short below {r.hv_short:+.2f}")
        n = int(a.n_single.max() + a.n_straddle.max()) if len(a) else 0
        lines.append(f"{day} | EDGE0DTE | FOUNDATION HURDLE {root} (0.30d call/put + ATM straddle, 1-s NBBO ask-in/bid-out, $0.65) | DISCOVERY | "
                     f"{int(a.times.max())} times | {'; '.join(parts)} | edge0dte/results/HURDLE.md (by bucket); not a hypothesis test")
    b = pd.read_parquet(os.path.join(DATA, 'baselines.parquet'))
    for _, r in b.iterrows():
        if r.baseline == 'no-trade':
            res = 'expectancy 0 (by definition)'
        else:
            res = (f"exp {pct(r.exp)} [{pct(r.exp_lo)}, {pct(r.exp_hi)}], win {100 * r.win:.1f}%, PF {r.pf:.2f}, "
                   f"Sharpe/tr {r.sharpe_trade:+.3f}, maxDD ${r.maxdd_usd:,.0f}, skips {int(r.skips)}")
        lines.append(f"{day} | EDGE0DTE | BASELINE {r.root} {r.baseline} exit {r.h} | {r.split} | {int(r.trades)} tr / {int(r.sessions)} sess | "
                     f"{res} | edge0dte/results/BASELINES.md; baseline, not in the FDR family")
    with open(LEDGER, 'a') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print(len(lines), 'lines appended to', os.path.abspath(LEDGER))


if __name__ == '__main__':
    main()
