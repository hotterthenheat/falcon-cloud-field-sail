"""EDGE-G triggers (PREREG "Leads and variants"), from the history book (book.py) and closed 1-minute bars only.

  python3 signals_g.py      -> v2data/edge-g/events_DEV.parquet (one row per trigger: rule family, root, day, t, side, ...)

Families: R1A (flip cross), R1B (flip ahead), BASE (trend marks; R2-CLEAR / R2-BLOCKED / R3 are flags on BASE rows).
Reads no option outcome.
"""
import math, os, sys
import numpy as np
import pandas as pd
from common import OUT, ROOTS, YEAR_MIN, assert_open, dev_sessions, has_chain
import book as B

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'edge'))
import sim  # noqa: E402

MARKS = B.MARKS
R1A_FROM, R1A_TO = 9 * 3600 + 46 * 60, 15 * 3600
B_FRAC = 0.10
STICK = 0.004


def em(S, atm, minutes):
    return S * atm * math.sqrt(minutes / YEAR_MIN)


def load_book(root, day):
    f = os.path.join(B.BOOK, root, f'{day}.npz')
    if not os.path.exists(f):
        return None
    z = dict(np.load(f))
    return z if int(z['ok']) == 1 and len(z.get('t', [])) else None


def spot_before(bars, t):
    """close of the last bar closed by t (start <= t - 60)."""
    x = bars[bars.m <= t // 60 - 1]
    return float(x.c.iloc[-1]) if len(x) else np.nan


def rv_so_far(bars, t):
    """scan_build.realized(): sample stdev of 1-minute log returns of closed-bar closes from the 09:30 bar, annualised."""
    x = bars[(bars.m >= 570) & (bars.m <= t // 60 - 1)].c.values
    if len(x) < 6:
        return np.nan
    lr = np.diff(np.log(x))
    if len(lr) < 5:
        return np.nan
    return float(np.std(lr, ddof=1) * math.sqrt(YEAR_MIN))


def r1a(z):
    """First crossing of the held flip by >= b into the dealer-short side (house net > 0)."""
    last, last_f = 0, np.nan
    for i, t in enumerate(z['t']):
        if t < R1A_FROM or t > R1A_TO:
            continue
        S, F, atm = z['S'][i], z['flip'][i], z['atm'][i]
        if not np.isfinite(F) or not (atm > 0):
            continue
        b = B_FRAC * em(S, atm, 60)
        if abs(S - F) < b:
            continue
        cur = 1 if S > F else -1
        if last != 0 and cur != last and abs(F - last_f) <= STICK * S and z['net_all'][i] > 0:
            return {'t': int(t), 'side': cur, 'S': float(S), 'atm': float(atm), 'flip': float(F), 'b': float(b),
                    'front_short': int(z['net_front'][i] > 0), 'net_all': float(z['net_all'][i])}
        last, last_f = cur, F
    return None


def r1b(z):
    for t in MARKS:
        i = np.flatnonzero(z['t'] == t)
        if not len(i):
            continue
        i = int(i[0])
        S, F, atm = z['S'][i], z['flip'][i], z['atm'][i]
        if not np.isfinite(F) or not (atm > 0):
            continue
        d = F - S
        e1 = em(S, atm, 60)
        if 0.25 * e1 <= abs(d) <= 1.50 * e1:
            return {'t': int(t), 'side': 1 if d > 0 else -1, 'S': float(S), 'atm': float(atm), 'flip': float(F),
                    'flip_dist_em': float(abs(d) / e1), 'front_short': int(z['net_front'][i] > 0),
                    'all_short': int(z['net_all'][i] > 0)}
    return None


def base(z, bars):
    out = []
    for t in MARKS:
        i = np.flatnonzero(z['t'] == t)
        if not len(i):
            continue
        i = int(i[0])
        S, atm = float(z['S'][i]), float(z['atm'][i])
        if not (atm > 0):
            continue
        S30 = spot_before(bars, t - 30 * 60)
        if not np.isfinite(S30):
            continue
        r30 = math.log(S / S30)
        thr = atm * math.sqrt(30 / YEAR_MIN)
        if abs(r30) < 1.0 * thr:
            continue
        side = 1 if r30 > 0 else -1
        W = z.get(f'm{t}_wall_up' if side > 0 else f'm{t}_wall_dn')
        W = float(W) if W is not None and np.isfinite(W) else np.nan
        e1 = em(S, atm, 60)
        dW = abs(W - S) if np.isfinite(W) else np.inf
        rv = rv_so_far(bars, t)
        ratio = rv / atm if np.isfinite(rv) else np.nan
        out.append({'t': int(t), 'side': side, 'S': S, 'atm': atm, 'r30_z': r30 / thr, 'wall': W,
                    'wall_dist_em': float(dW / e1) if np.isfinite(dW) else np.inf,
                    'r2_clear': int(dW >= 1.0 * e1), 'r2_blocked': int(dW < 0.5 * e1),
                    'rv': rv, 'rv_iv': ratio, 'r3': int(np.isfinite(ratio) and ratio >= 1.25),
                    'front_short': int(z['net_front'][i] > 0), 'all_short': int(z['net_all'][i] > 0)})
    return out


def events_for(root, day):
    assert_open(day)
    z = load_book(root, day)
    if z is None:
        return []
    bars = sim.day_bars(root, day)
    ev = []
    a = r1a(z)
    if a:
        ev.append({'fam': 'R1A', **a})
    b = r1b(z)
    if b:
        ev.append({'fam': 'R1B', **b})
    for e in base(z, bars):
        ev.append({'fam': 'BASE', **e})
    for e in ev:
        e['root'], e['day'] = root, day
    return ev


def main():
    rows, missing = [], 0
    for d in dev_sessions():
        for r in ROOTS:
            if not has_chain(r, d):
                continue
            if not os.path.exists(os.path.join(B.BOOK, r, f'{d}.npz')):
                missing += 1
                continue
            rows += events_for(r, d)
    df = pd.DataFrame(rows)
    df['id'] = df.fam + '|' + df.root + '|' + df.day + '|' + df.t.astype(str)
    f = os.path.join(OUT, 'events_DEV.parquet')
    df.to_parquet(f + '.tmp', index=False)
    os.replace(f + '.tmp', f)
    print('missing books', missing)
    print(df.groupby(['fam', 'root']).size().unstack(fill_value=0))
    bs = df[df.fam == 'BASE']
    print('BASE', len(bs), 'R2-CLEAR', int(bs.r2_clear.sum()), 'R2-BLOCKED', int(bs.r2_blocked.sum()), 'R3', int(bs.r3.sum()))
    print('sides', df.groupby('fam').side.mean().round(2).to_dict())


if __name__ == '__main__':
    main()
