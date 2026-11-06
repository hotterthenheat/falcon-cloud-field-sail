"""Data validation for DATA_COVERAGE section 6.

    python3 -m edata.validate snap 20240417        # panel 1-minute snapshots (q0 at bar end, q2 at +2 s) vs the
                                                   # compass-v2 100 ms store (v2data/sessions): as-of NBBO equality
    python3 -m edata.validate sip SPY 20240301     # edata/sip.py bars vs the terminal's option/history/ohlc (1 request)
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import cents, csv, guard, ms_of_day, right_code  # noqa: E402
from edata.store import Panel  # noqa: E402

M0 = 9 * 60 + 30


def snap(D):
    from data.store import Session
    s = Session(D)
    out = []
    for root in ('SPY', 'QQQ', 'SPXW'):
        p = Panel(root)
        if D not in p.days():
            continue
        for name, off in (('q0', 0), ('q2', 2000)):
            g = p.q0(D) if name == 'q0' else p.q2(D)
            n = same = 0
            for c in s.contracts(root):
                x = g[(g.exp == c.exp) & (g.strike == c.strike) & (g.right == c.right) & (g.m >= 0)]
                if not len(x):
                    continue
                q = s.quotes(c)
                t = (M0 + x.m.to_numpy().astype(np.int64) + 1) * 60_000 + off
                i = np.searchsorted(q['ms'], t, side='right') - 1
                ok = i >= 0
                b = np.where(ok, q['bid'][np.clip(i, 0, None)], -1)
                a = np.where(ok, q['ask'][np.clip(i, 0, None)], -1)
                n += int(ok.sum())
                same += int(((b == x.bid.to_numpy()) & (a == x.ask.to_numpy()) & ok).sum())
            out.append((root, name, n, same))
    print(f'| root | grid | snapshots compared | identical bid & ask to the 100 ms store as-of | share |')
    print('|---|---|---|---|---|')
    for root, name, n, same in out:
        print(f'| {root} | {name} | {n} | {same} | {100 * same / max(n, 1):.2f}% |')


def sip(root, D):
    guard(D)
    p = Panel(root)
    tb = p.tb(D)
    e = int(D)
    o = csv('/option/history/ohlc', {'symbol': root, 'expiration': D, 'strike': '*', 'right': 'both', 'date': D, 'interval': '1m',
                                     'strike_range': 15})
    o = pd.DataFrame({'strike': np.round(o.strike.values * 1000).astype(int), 'right': right_code(o.right),
                      'm': ms_of_day(o.timestamp) // 60000 - M0, 'O': cents(o.open), 'H': cents(o.high), 'L': cents(o.low),
                      'C': cents(o.close), 'V': o.volume.astype(int), 'N': o['count'].astype(int)})
    o = o[o.N > 0]
    mine = tb[tb.exp == e]
    j = o.merge(mine, on=['strike', 'right', 'm'], how='outer', indicator=True)
    both = j[j._merge == 'both']
    print(f'{root} {D} 0DTE: terminal non-empty bars {len(o)}, mine {len(mine)}, both {len(both)}, '
          f'only terminal {int((j._merge == "left_only").sum())}, only mine {int((j._merge == "right_only").sum())}')
    for a, b in (('O', 'o'), ('H', 'h'), ('L', 'l'), ('C', 'c'), ('V', 'v'), ('N', 'n')):
        print(f'  {a}: identical {100 * float((both[a] == both[b]).mean()):.2f}%')


def fills(D, n=12):
    """edata/fills.py (1-second NBBO) at every bar end + 2 s vs the 100 ms store as-of, for n SPY contracts."""
    from data.store import Session
    from edata.fills import FillBook
    s = Session(D)
    fb = FillBook('SPY')
    cs = s.contracts('SPY', 0)[::max(1, len(s.contracts('SPY', 0)) // n)][:n]
    tot = same = 0
    for c in cs:
        q = s.quotes(c)
        for m in range(15, 381):
            t = (M0 + m + 1) * 60_000 + 2000
            i = int(np.searchsorted(q['ms'], t, side='right')) - 1
            f = fb.quote_at(D, (c.exp, c.strike, c.right), t)
            if i < 0 or f is None:
                continue
            tot += 1
            same += int(round(f[0] * 100) == q['bid'][i] and round(f[1] * 100) == q['ask'][i])
    print(f'1-second fill source vs 100 ms store at bar end + 2 s: {same}/{tot} identical ({100 * same / max(tot, 1):.2f}%) on {len(cs)} SPY 0DTE contracts')


if __name__ == '__main__':
    if sys.argv[1] == 'snap':
        snap(sys.argv[2])
    elif sys.argv[1] == 'fills':
        fills(sys.argv[2])
    else:
        sip(sys.argv[2], sys.argv[3])
