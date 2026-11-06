"""NOV5-BROAD rules (PREREG.md): triggers computed from closed 1-minute bars and the first expiry's 1-minute board only,
the same code on the study day, the out-of-sample days and DEV. Decision at t = m*60 (minute m): the last closed bar is
m-1 (S_t = its close), the last visible board stamp is m-1 (its IV solved against the close of bar m-2).

sig[j] = ATM implied vol of the board stamped j: the strike nearest S_q (= close of bar j-1) among strikes with both
sides quoted (bid > 0, ask > bid); the mean of the call and put IVs solved at the mid (EDGE solver), trading clock
T = (960 - j + 390 x) / (390 x 252), x = whole sessions from the day to the expiry.
"""
import math
import numpy as np
import pandas as pd
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'compass-v2', 'edge'))
import sim as esim  # noqa: E402

YEAR_MIN = 390.0 * 252
M0, M1 = 570, 959
REFRACT = 60


def em(S, sig, h):
    return S * sig * math.sqrt(h / YEAR_MIN)


class Day:
    """bars: m,o,h,l,c (closed 1-minute bars); board: m,k,r,bid,ask (first expiry); x: sessions to that expiry;
    volix: {minute: value} of the root's 30-day vol index (VIX / VXN / RVX) stamped at the minute; flow: UW alerts
    (s, type, prem, chase) or None; news: headlines (s, headline) or None."""

    def __init__(self, root, day, bars, board, x=0, volix=None, flow=None, news=None, sig=None):
        self.root, self.day, self.x = root, day, x
        self.bars = bars.sort_values('m').reset_index(drop=True)
        self.board = board
        self.volix, self.flow, self.news = volix or {}, flow, news
        n = M1 - M0 + 2
        self.o = np.full(n, np.nan); self.h = np.full(n, np.nan); self.l = np.full(n, np.nan); self.c = np.full(n, np.nan)
        for r in self.bars.itertuples():
            if M0 <= r.m <= M1:
                i = int(r.m) - M0
                self.o[i], self.h[i], self.l[i], self.c[i] = r.o, r.h, r.l, r.c
        self.c = pd.Series(self.c).ffill().values
        self.open = float(self.bars.o.iloc[0])
        self.sig = self._sig() if sig is None else sig     # sig given: bnullsyn.py's flat-smile synthetic IV

    def _sig(self):
        b = self.board[(self.board.bid > 0) & (self.board.ask > self.board.bid)]
        sig = np.full(M1 - M0 + 2, np.nan)
        for m, g in b.groupby('m'):
            m = int(m)
            if not (M0 + 1 <= m <= M1) or not np.isfinite(self.c[m - 1 - M0]):
                continue
            S = self.c[m - 1 - M0]
            both = g.groupby('k').r.nunique()
            ks = both[both == 2].index.values.astype(float)
            if not len(ks):
                continue
            k = ks[np.argmin(np.abs(ks - S))]
            a = g[g.k == k]
            T = (max(960 - m, 1) + 390.0 * self.x) / YEAR_MIN
            iv = esim.implied_vol((a.bid.values + a.ask.values) / 2, S, a.k.values.astype(float), T, a.r.values == 1)
            iv = iv[np.isfinite(iv)]
            if len(iv):
                sig[m - M0] = float(np.mean(iv))
        return sig

    # accessors by minute (absolute minute of day)
    def S(self, m):           # decision at minute m: close of bar m-1
        return self.c[m - 1 - M0]

    def s(self, j):           # sig of board stamp j
        return self.sig[j - M0] if M0 <= j <= M1 else np.nan

    def win(self, arr, a, b):  # values of arr for minutes a..b inclusive (clipped)
        a, b = max(a, M0), min(b, M1)
        return arr[a - M0:b - M0 + 1] if b >= a else np.zeros(0)


def rv_so_far(d, m):
    c = d.win(d.c, M0, m - 1)
    c = c[np.isfinite(c)]
    if len(c) < 6:
        return np.nan
    return float(np.std(np.diff(np.log(c)), ddof=1) * math.sqrt(YEAR_MIN))


def r1_events(d, m_from=630, m_to=900):
    """R1 VOL-SPIKE RELEASE -> call."""
    out, last = [], -10 ** 9
    for m in range(m_from, m_to + 1):
        if m - last < REFRACT:
            continue
        S, s_now = d.S(m), d.s(m - 1)
        if not (np.isfinite(S) and np.isfinite(s_now)):
            continue
        pk_w = d.win(d.sig, m - 30, m - 1)
        ref_w = d.win(d.sig, max(M0 + 1, m - 90), m - 61)
        ref_w = ref_w[np.isfinite(ref_w)]
        if len(ref_w) < 10 or not np.isfinite(pk_w).any():
            continue
        s_pk, s_ref = float(np.nanmax(pk_w)), float(np.median(ref_w))
        S_ref = d.c[max(M0, m - 91) - M0]
        lo30 = float(np.nanmin(d.win(d.l, m - 30, m - 1)))
        if not (s_pk >= 1.25 * s_ref):
            continue
        if not (math.log(lo30 / S_ref) <= -2.0 * em(S_ref, s_ref, 60) / S_ref):
            continue
        if not (s_now <= 0.90 * s_pk and S >= lo30 + 0.5 * em(S, s_now, 30)):
            continue
        out.append({'rule': 'R1', 't': m * 60, 'side': 1, 'S': S, 'atm': s_now, 'rv': rv_so_far(d, m),
                    'sig_pk': s_pk, 'sig_ref': s_ref, 'lo30': lo30})
        last = m
    return out


def r2_events(d, m_from=630, m_to=900):
    """R2 VOL RE-IGNITION after a relief rally on a down day -> put."""
    out, last = [], -10 ** 9
    o_w = d.win(d.sig, M0 + 1, M0 + 5)
    o_w = o_w[np.isfinite(o_w)]
    if not len(o_w):
        return out
    em_day0 = em(d.open, float(np.median(o_w)), 390)
    for m in range(m_from, m_to + 1):
        if m - last < REFRACT:
            continue
        S, s_now = d.S(m), d.s(m - 1)
        if not (np.isfinite(S) and np.isfinite(s_now)):
            continue
        if not (math.log(S / d.open) <= -1.5 * em_day0 / d.open):
            continue
        tr_w = d.win(d.sig, m - 30, m - 1)
        pk_w = d.win(d.sig, max(M0 + 1, m - 90), m - 31)
        if not (np.isfinite(tr_w).any() and np.isfinite(pk_w).any()):
            continue
        s_tr, s_pk = float(np.nanmin(tr_w)), float(np.nanmax(pk_w))
        hi30 = float(np.nanmax(d.win(d.h, m - 30, m - 1)))
        lo_prev = float(np.nanmin(d.win(d.l, max(M0, m - 90), m - 31)))
        if not (s_tr <= 0.80 * s_pk and s_now >= 1.05 * s_tr):
            continue
        if not (hi30 - lo_prev >= em(S, s_now, 60) and S <= hi30 - 0.5 * em(S, s_now, 30)):
            continue
        out.append({'rule': 'R2', 't': m * 60, 'side': -1, 'S': S, 'atm': s_now, 'rv': rv_so_far(d, m),
                    'sig_tr': s_tr, 'sig_pk': s_pk, 'hi30': hi30})
        last = m
    return out


def r3_events(d):
    """R3 CHEAP OPEN 0DTE VOL -> ATM straddle at 09:36 (same-day expiry only)."""
    if d.x != 0:
        return []
    m = 576
    s0, S = d.s(m - 1), d.S(m)
    v = d.volix.get(m - 1)
    if not (np.isfinite(s0) and np.isfinite(S) and v and v > 0):
        return []
    rho = s0 / (v / 100.0)
    if rho <= 0.60:
        return [{'rule': 'R3', 't': m * 60, 'side': 0, 'S': S, 'atm': s0, 'rv': np.nan, 'rho': rho}]
    return []


def r4_events(d, m_from=630, m_to=900):
    """R4 CHASE-FLOW EXHAUSTION -> the side against the crowd's chase (UW alerts, publication time)."""
    out, last = [], -10 ** 9
    f = d.flow
    if f is None or not len(f):
        return out
    f = f[f.chase]
    fs = f.s.values.astype(float)
    fput = (f.type.values == 'put')
    fprem = f.prem.values.astype(float)

    def psum(a, b, put):                       # chase premium published in [a, b) of one type
        sel = (fs >= a) & (fs < b) & (fput if put else ~fput)
        return float(fprem[sel].sum())

    for m in range(m_from, m_to + 1):
        if m - last < REFRACT:
            continue
        T = m * 60
        S, s_now = d.S(m), d.s(m - 1)
        if not (np.isfinite(S) and np.isfinite(s_now)):
            continue
        S30 = d.c[m - 31 - M0]
        r30 = math.log(S / S30)
        e30 = em(S, s_now, 30) / S
        nwin = max((T - 900 - 9.5 * 3600) / 900.0, 1.0)
        for side, tp_chase, cond in ((1, 'put', r30 <= -1.5 * e30), (-1, 'call', r30 >= 1.5 * e30)):
            if not cond:
                continue
            P = psum(T - 900, T, tp_chase == 'put')
            Q = psum(T - 900, T, tp_chase != 'put')
            base = psum(9.5 * 3600, T - 900, tp_chase == 'put') / nwin
            if P >= 3.0 * max(Q, 1.0) and P >= 3.0 * base and P >= 5e5:
                out.append({'rule': 'R4', 't': T, 'side': side, 'S': S, 'atm': s_now, 'rv': rv_so_far(d, m),
                            'chase': P, 'other': Q, 'base15': base,
                            'lo30': float(np.nanmin(d.win(d.l, m - 30, m - 1))),
                            'hi30': float(np.nanmax(d.win(d.h, m - 30, m - 1)))})
                last = m
                break
    return out


RELIEF = (r'\b(?:eas(?:e|ed|es|ing)|de-?escalat\w*|cease-?fire|truce|peace (?:deal|talks|plan|proposal)|'
          r'nuclear proposal|end(?:s|ing)? (?:the |a )?war|(?:risk|threat|fears?) of .{0,40}(?:eased|recede[sd]?|fad(?:e|ed|es)))\b')
MACRO = (r'\b(?:iran\w*|israel\w*|russia\w*|ukrain\w*|china|chinese|tariff\w*|war|hormuz|missile\w*|sanction\w*|'
         r'fed|powell|trump|white house|oil|opec|gaza|hezbollah|houthi\w*|qatar)\b')


def r5_events(d, m_from=600, m_to=900):
    """R5 RELIEF-HEADLINE FADE on a down day -> put, 10 minutes after the headline's publication."""
    out, last = [], -10 ** 9
    n = d.news
    if n is None or not len(n):
        return out
    o_w = d.win(d.sig, M0 + 1, M0 + 5)
    o_w = o_w[np.isfinite(o_w)]
    if not len(o_w):
        return out
    em_day0 = em(d.open, float(np.median(o_w)), 390)
    hl = n[n.headline.str.contains(RELIEF, case=False, regex=True) & n.headline.str.contains(MACRO, case=False, regex=True)]
    for r in hl.itertuples():
        m = int(math.ceil((r.s + 600) / 60.0))
        if not (m_from <= m <= m_to) or m - last < REFRACT:
            continue
        S, s_now = d.S(m), d.s(m - 1)
        if not (np.isfinite(S) and np.isfinite(s_now)):
            continue
        if not (math.log(S / d.open) <= -1.5 * em_day0 / d.open):
            continue
        out.append({'rule': 'R5', 't': m * 60, 'side': -1, 'S': S, 'atm': s_now, 'rv': rv_so_far(d, m),
                    'headline': r.headline[:120], 'h_s': r.s})
        last = m
    return out


def events(d, rules=('R1', 'R2', 'R3', 'R4', 'R5')):
    fn = {'R1': r1_events, 'R2': r2_events, 'R3': r3_events, 'R4': r4_events, 'R5': r5_events}
    ev = []
    for r in rules:
        ev += fn[r](d)
    return ev
