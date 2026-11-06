"""NOV5 candidate rules (PREREG.md), computed identically on the study days and on DEV history.

A Day gives, at a decision minute t (seconds of the ET day, t = m*60), only data stamped before t:
  bars      SPX 1-minute bars with start <= t-60 (S_t = close of the last closed bar)
  board     the 0DTE chain's 1-minute NBBO stamped (t-60)//60 -> IV_atm (EDGE convention)
  book(t)   the point-in-time gamma book read at t (EDGE-G definitions): net (house sign; > 0 = dealers short gamma),
            wall_dn / wall_up = the strike with the largest |net dealer gamma| below / above S_t within 10%
Rules return events {rule, t, side (+1 call / -1 put), S, atm, rv, target}; they never read an option outcome.
"""
import math, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import sim as esim  # noqa: E402

YEAR_MIN = 390.0 * 252
WIN_FROM, WIN_TO = 10 * 3600, 14 * 3600 + 30 * 60


def em(S, iv, minutes):
    return S * iv * math.sqrt(minutes / YEAR_MIN)


class Day:
    """bars: DataFrame m,o,h,l,c (SPX); board: DataFrame m,k,r,bid,ask (0DTE); book: DataFrame t,S,atm,net_all,wall_up,wall_dn."""

    def __init__(self, day, bars, board, book):
        self.day, self.bars, self.board = day, bars.sort_values('m').reset_index(drop=True), board
        self.book = book.set_index('t') if 't' in book.columns else book
        self._c = dict(zip(self.bars.m.values, self.bars.c.values))
        self._o = dict(zip(self.bars.m.values, self.bars.o.values))
        self.open = float(self.bars.o.iloc[0])
        self._bar = {int(m): (o, h, l, c) for m, o, h, l, c in zip(self.bars.m, self.bars.o, self.bars.h, self.bars.l, self.bars.c)}

    def S(self, t):
        return self._c.get(t // 60 - 1, np.nan)

    def ohlc(self, t):
        m = t // 60 - 1
        x = self._bar.get(m)
        return x if x is not None else (np.nan,) * 4

    def bar(self, t):
        """the last closed bar (start = t//60 - 1): (open, close)."""
        m = t // 60 - 1
        return self._o.get(m, np.nan), self._c.get(m, np.nan)

    def rv(self, t):
        x = self.bars[(self.bars.m >= 570) & (self.bars.m <= t // 60 - 1)].c.values
        if len(x) < 6:
            return np.nan
        return float(np.std(np.diff(np.log(x)), ddof=1) * math.sqrt(YEAR_MIN))

    def bk(self, t):
        if t not in self.book.index:
            return None
        r = self.book.loc[t]
        return r if np.isfinite(r.atm) and r.atm > 0 else None


def n1_drive(d, k=2.0, t=10 * 3600):
    """N1 SHORT-GAMMA DRIVE: at 10:00, dealers short gamma and |ln(S/open)| >= k x the 30-minute implied move -> trend side."""
    r = d.bk(t)
    S = d.S(t)
    if r is None or not np.isfinite(S):
        return []
    mv = math.log(S / d.open)
    e = em(S, r.atm, 30) / S
    if r.net_all > 0 and abs(mv) >= k * e:
        side = 1 if mv > 0 else -1
        tgt = r.wall_up if side > 0 else r.wall_dn
        return [{'rule': 'N1', 't': t, 'side': side, 'S': S, 'atm': float(r.atm), 'rv': d.rv(t), 'target': float(tgt),
                 'x': abs(mv) / e}]
    return []


REFRACTORY = 3600


def n2_break(d, bfrac=0.10):
    """N2 WALL BREAK: every minute in 10:00-14:30 where, with dealers short gamma at t, S_t closes beyond the previous
    read's wall by >= 0.10 EM_1h in the direction of the 30-minute move (below wall_dn(t-60) with S_t < S_t-30 -> put;
    above wall_up(t-60) with S_t > S_t-30 -> call); after an event the rule sleeps 60 minutes. target = the next wall
    in the trade's direction at t."""
    out, nxt = [], 0
    for t in range(WIN_FROM, WIN_TO + 1, 60):
        if t < nxt:
            continue
        r, p = d.bk(t), d.bk(t - 60)
        S, S30 = d.S(t), d.S(t - 1800)
        if r is None or p is None or not np.isfinite(S) or not np.isfinite(S30) or not r.net_all > 0:
            continue
        b = bfrac * em(S, r.atm, 60)
        ev = None
        if np.isfinite(p.wall_dn) and S <= p.wall_dn - b and S < S30:
            ev = {'side': -1, 'wall': float(p.wall_dn), 'target': float(r.wall_dn)}
        elif np.isfinite(p.wall_up) and S >= p.wall_up + b and S > S30:
            ev = {'side': 1, 'wall': float(p.wall_up), 'target': float(r.wall_up)}
        if ev:
            out.append({'rule': 'N2', 't': t, 'S': S, 'atm': float(r.atm), 'rv': d.rv(t), **ev})
            nxt = t + REFRACTORY
    return out


def n3_exhaust(d, kmove=1.5):
    """N3 WALL REJECTION (bottom / top tick): every minute in 10:00-14:30 where (a) the 30-minute move
    |ln(S_t/S_t-30)| >= 1.5 x the 30-minute implied move, and (b) the last closed bar pierced the previous read's wall
    in the move's direction and closed back on the near side (after a fall: bar low <= wall_dn(t-60) < bar close; after a
    rise: bar high >= wall_up(t-60) > bar close) -> buy the reversal side (call after a fall, put after a rise); after an
    event the rule sleeps 60 minutes. No gamma-sign condition."""
    out, nxt = [], 0
    for t in range(WIN_FROM, WIN_TO + 1, 60):
        if t < nxt:
            continue
        r, p = d.bk(t), d.bk(t - 60)
        S, S30 = d.S(t), d.S(t - 1800)
        if r is None or p is None or not np.isfinite(S) or not np.isfinite(S30):
            continue
        mv = math.log(S / S30)
        if abs(mv) < kmove * em(S, r.atm, 30) / S:
            continue
        dirn = 1 if mv > 0 else -1
        o, h, l, c = d.ohlc(t)
        if not np.isfinite(c):
            continue
        if dirn < 0:
            W = p.wall_dn
            hit = np.isfinite(W) and l <= W < c
        else:
            W = p.wall_up
            hit = np.isfinite(W) and h >= W > c
        if not hit:
            continue
        out.append({'rule': 'N3', 't': t, 'side': -dirn, 'S': S, 'atm': float(r.atm), 'rv': d.rv(t), 'wall': float(W),
                    'target': np.nan})
        nxt = t + REFRACTORY
    return out


RULES = {'N1': n1_drive, 'N2': n2_break, 'N3': n3_exhaust}


def events(d):
    out = []
    for name, fn in RULES.items():
        out += fn(d)
    return out
