"""Simple-signal baselines (PROTOCOL section 6), defined from underlying 1-minute bars only (OBS -> CALC):

5-minute bars: 1-minute bars grouped by floor((m - 570)/5); the 5-minute bar starting at minute b closes at b + 5 and is
usable from then. EMA(n) on 5-minute closes, alpha = 2/(n+1), run continuously over the regular-session 5-minute bars
of all sessions in order (seeded from the first bar of 2019-12; prior sessions only ever feed later ones).

EMA 9/21 crossover: at a 5-minute bar close tau, sign(EMA9 - EMA21) differs from its sign at the previous bar close
-> long 0.30-delta call (up-cross) or put (down-cross); decision t = tau, kept if 09:45 <= t <= 15:30 (the decision
grid). Every crossover is a trade (positions may overlap).
30-minute opening-range breakout: OR = high/low of the 1-minute bars 09:30-09:59 (known at 10:00). The first
5-minute bar (starting 10:00 or later) whose close is above the OR high (call) or below the OR low (put); decision t =
that bar's close, kept if <= 15:30. At most one trade per session.
"""
import numpy as np
import pandas as pd

from lib import cal
from lib.config import UNDER
from lib.data import bars as load_bars


def five_min(b):
    if not len(b):
        return pd.DataFrame(columns=['b', 'o', 'h', 'l', 'c', 'n'])
    g = (b.m.values.astype(np.int64) - 570) // 5
    df = pd.DataFrame({'g': g, 'o': b.o.values, 'h': b.h.values, 'l': b.l.values, 'c': b.c.values})
    a = df.groupby('g').agg(o=('o', 'first'), h=('h', 'max'), l=('l', 'min'), c=('c', 'last'), n=('c', 'size'))
    a['b'] = 570 + a.index.values.astype(np.int64) * 5
    return a.reset_index(drop=True)


def ema_signals(root, days):
    """Returns list of (day, t, side). EMA state carried across sessions in order (including non-expiry sessions)."""
    sym = UNDER[root]
    want = set(days)
    allsess = cal.sessions('2019-12-02', max(days))
    e9 = e21 = None
    a9, a21 = 2 / 10, 2 / 22
    prev = None
    out = []
    for d in allsess:
        f = five_min(load_bars(sym, d))
        for b, c in zip(f.b.values, f.c.values):
            if e9 is None:
                e9 = e21 = float(c)
            else:
                e9 = a9 * c + (1 - a9) * e9
                e21 = a21 * c + (1 - a21) * e21
            s = np.sign(e9 - e21)
            t = int((b + 5) * 60)
            if d in want and prev is not None and s != 0 and s != prev and 35100 <= t <= cal.close_min(d) * 60 - 1800:
                out.append((d, t, 'call' if s > 0 else 'put'))
            if s != 0:
                prev = s
    return out


def orb_signals(root, days):
    sym = UNDER[root]
    out = []
    for d in days:
        b = load_bars(sym, d)
        orb = b[(b.m >= 570) & (b.m < 600)]
        if len(orb) < 25:
            continue
        hi, lo = float(orb.h.max()), float(orb.l.min())
        f = five_min(b)
        f = f[f.b >= 600]
        for bb, c in zip(f.b.values, f.c.values):
            t = int((bb + 5) * 60)
            if t > cal.close_min(d) * 60 - 1800:
                break
            if c > hi:
                out.append((d, t, 'call'))
                break
            if c < lo:
                out.append((d, t, 'put'))
                break
    return out


def signal_plan(roots=('SPXW',)):
    rows = []
    for root in roots:
        days = cal.expiry_sessions(root, '2020-02-18', '2024-12-31')
        for d, t, s in ema_signals(root, days):
            rows.append((root, d, t, 5, 'ema', s))
        for d, t, s in orb_signals(root, days):
            rows.append((root, d, t, 5, 'orb', s))
    return pd.DataFrame(rows, columns=['root', 'day', 't', 'prio', 'purpose', 'side']).sort_values(['root', 'day', 't'])
