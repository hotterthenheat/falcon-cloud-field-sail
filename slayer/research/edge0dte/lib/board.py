"""Session view at a decision time t: spot, board, smile, IV_atm, sigma_h, contract selection. Data used <= t only.

Visibility (config.py): bar m is usable at t >= 60*(m+1); the board snapshot stamped m is usable at t >= 60*m.
  spot(t)   = close of bar t//60 - 1 (the bar that closed at t)            OBS
  board(t)  = snapshot stamped t//60 (NBBO in effect at minute boundary <= t)   OBS
A missing bar or snapshot minute is missing (NaN / None); nothing is interpolated.

IV_atm(t) (CALC), exact definition:
  1. valid quote: bid > 0, ask > bid (zero, locked and crossed quotes excluded).
  2. parity forward: for every strike with a valid call AND put, F_K = K + Cmid - Pmid; F = median of F_K over the
     3 such strikes nearest spot(t) (spot(t) only orders the strikes). If no strike has both, IV_atm = NaN.
  3. per strike with both quotes: call-equivalent price C*(K) = (Cmid + Pmid + F - K)/2 (the call mid and the
     parity-converted put mid averaged); iv(K) = Black-76 inversion of C*(K) with forward F, T = (close - t) in
     trading-years.
  4. K1 = the largest strike <= F with a finite iv, K2 = the smallest strike > F with a finite iv, both within
     2 listed strikes of F; IV_atm^2 = iv(K1)^2 + (iv(K2)^2 - iv(K1)^2) * (F - K1)/(K2 - K1)  (total variance
     interpolated linearly in strike; T is common so it cancels). If only one side exists, NaN.
  sigma_h(t) = IV_atm(t) * sqrt(h_min / (252*390)), h_min = h, or minutes from t to the session close for 'close'.
"""
import math

import numpy as np
import pandas as pd

from . import bs
from .cal import close_min
from .config import YEAR_MIN
from .data import bars as load_bars, chain as load_chain


class Session:
    """One root-session. Holds the full day's data but exposes only <= t views."""

    def __init__(self, root, day, bars=None, chain=None):
        self.root, self.day = root, day
        self.close = close_min(day)                       # minute of day of the close
        b = load_bars(root, day) if bars is None else bars
        self.bars = b
        self._bm = dict(zip(b.m.astype(int).values, b.c.astype(float).values)) if len(b) else {}
        self.chain = load_chain(root, day) if chain is None else chain
        self._bymin = {}
        if self.chain is not None and len(self.chain):
            c = self.chain
            idx = np.flatnonzero(np.r_[True, c.m.values[1:] != c.m.values[:-1], True])
            for a, z in zip(idx[:-1], idx[1:]):
                self._bymin[int(c.m.values[a])] = c.iloc[a:z]
        self._smile = {}

    def truncated(self, t):
        """A copy holding only data stamped <= t: bars that closed by t, board snapshots stamped <= t, and the same
        for any attached auxiliary series (used by the leakage tests)."""
        b = self.bars[self.bars.m.values + 1 <= t // 60] if len(self.bars) else self.bars
        c = None if self.chain is None else self.chain[self.chain.m.values <= t // 60]
        new = Session(self.root, self.day, bars=b.reset_index(drop=True), chain=c.reset_index(drop=True) if c is not None else None)
        if hasattr(self, 'aux'):
            full_aux = self.aux
            cache = {}

            def aux(sym):
                if sym not in cache:
                    a = full_aux(sym)
                    cache[sym] = a[a.m.values + 1 <= t // 60] if a is not None and len(a) else a
                return cache[sym]
            new.aux = aux
        return new

    # ------------------------------------------------------------ underlying
    def spot(self, t):
        return self._bm.get(t // 60 - 1, np.nan)

    def bars_upto(self, t):
        """Bars that have closed by t (bar m with 60*(m+1) <= t)."""
        b = self.bars
        return b[b.m.values + 1 <= t // 60] if len(b) else b

    def T(self, t):
        return max(self.close * 60 - t, 0) / 60.0 / YEAR_MIN

    # ------------------------------------------------------------ board
    def board(self, t):
        return self._bymin.get(t // 60)

    def smile(self, t):
        """Per-strike table at the snapshot <= t: k, cb, ca, pb, pa, cmid, pmid, okc, okp, F, iv (call-equivalent),
        ivc, ivp (each right inverted with forward F), Tyr. None when the snapshot is missing or no forward exists."""
        m = t // 60
        if m in self._smile:
            return self._smile[m]
        out = self._build_smile(t)
        self._smile[m] = out
        return out

    def _build_smile(self, t):
        b = self.board(t)
        S = self.spot(t)
        T = self.T(t)
        if b is None or not np.isfinite(S) or T <= 0:
            return None
        c = b[b.r.values == 1].set_index('k')[['bid', 'ask', 'bs', 'as']]
        p = b[b.r.values == 0].set_index('k')[['bid', 'ask', 'bs', 'as']]
        s = c.join(p, how='outer', lsuffix='_c', rsuffix='_p').sort_index()
        k = s.index.values.astype(float)
        cb, ca, pb, pa = (s[x].values.astype(float) for x in ('bid_c', 'ask_c', 'bid_p', 'ask_p'))
        okc = (cb > 0) & (ca > cb)
        okp = (pb > 0) & (pa > pb)
        cmid = np.where(okc, 0.5 * (cb + ca), np.nan)
        pmid = np.where(okp, 0.5 * (pb + pa), np.nan)
        both = okc & okp
        if not both.any():
            return None
        kb = k[both]
        fk = kb + cmid[both] - pmid[both]
        near = np.argsort(np.abs(kb - S), kind='stable')[:3]
        F = float(np.median(fk[near]))
        cstar = np.where(both, 0.5 * (cmid + pmid + F - k), np.nan)
        iv = bs.implied_vol(np.nan_to_num(cstar, nan=-1.0), F, k, T, True)
        iv = np.where(both, iv, np.nan)
        ivc = bs.implied_vol(np.nan_to_num(cmid, nan=-1.0), F, k, T, True)
        ivp = bs.implied_vol(np.nan_to_num(pmid, nan=-1.0), F, k, T, False)
        return pd.DataFrame({'k': k, 'cb': cb, 'ca': ca, 'pb': pb, 'pa': pa, 'cbs': s['bs_c'].values, 'cas': s['as_c'].values,
                             'pbs': s['bs_p'].values, 'pas': s['as_p'].values, 'cmid': cmid, 'pmid': pmid, 'okc': okc,
                             'okp': okp, 'iv': iv, 'ivc': ivc, 'ivp': ivp, 'F': F, 'S': S, 'Tyr': T})

    def iv_atm(self, t):
        """IV_atm(t) (definition in the module docstring). Returns float or NaN."""
        sm = self.smile(t)
        if sm is None:
            return np.nan
        F = float(sm.F.iloc[0])
        k, iv = sm.k.values, sm.iv.values
        fin = np.isfinite(iv)
        below = np.flatnonzero(fin & (k <= F))
        above = np.flatnonzero(fin & (k > F))
        if not len(below) or not len(above):
            return np.nan
        i1, i2 = below[-1], above[0]
        # within 2 listed strikes of F
        pos = np.searchsorted(k, F, 'right')               # index of first listed strike > F
        if pos - 1 - i1 > 1 or i2 - pos > 1:
            return np.nan
        k1, k2 = k[i1], k[i2]
        w = iv[i1] ** 2 + (iv[i2] ** 2 - iv[i1] ** 2) * (F - k1) / (k2 - k1)
        return float(math.sqrt(w)) if w > 0 else np.nan

    def sigma_h(self, t, h, iv=None):
        iv = self.iv_atm(t) if iv is None else iv
        hm = horizon_minutes(self, t, h)
        if not np.isfinite(iv) or hm is None or hm <= 0:
            return np.nan
        return iv * math.sqrt(hm / YEAR_MIN)

    # ------------------------------------------------------------ contract selection (board at t only)
    def select_delta(self, t, call, target=0.30, lo=0.15, hi=0.50):
        """The contract of side `call` whose |delta| (Black-76, its own-right IV from the mid at t, forward F) is
        nearest `target` within [lo, hi], valid two-sided quote at t. Returns dict or None."""
        sm = self.smile(t)
        if sm is None:
            return None
        F, T = float(sm.F.iloc[0]), float(sm.Tyr.iloc[0])
        ok = (sm.okc if call else sm.okp).values
        ivr = (sm.ivc if call else sm.ivp).values
        good = ok & np.isfinite(ivr)
        if not good.any():
            return None
        d = np.abs(bs.delta(F, sm.k.values, T, np.where(good, ivr, 0.2), call))
        cand = np.flatnonzero(good & (d >= lo) & (d <= hi))
        if not len(cand):
            return None
        i = cand[np.argmin(np.abs(d[cand] - target))]
        r = sm.iloc[i]
        return {'k': float(r.k), 'call': bool(call), 'delta': float(d[i]), 'iv': float(ivr[i]), 'F': F, 'T': T,
                'bid': float(r.cb if call else r.pb), 'ask': float(r.ca if call else r.pa)}

    def select_atm(self, t):
        """ATM straddle strike: the listed strike nearest the parity forward with valid call and put quotes."""
        sm = self.smile(t)
        if sm is None:
            return None
        both = (sm.okc & sm.okp).values
        if not both.any():
            return None
        F = float(sm.F.iloc[0])
        i = np.flatnonzero(both)[np.argmin(np.abs(sm.k.values[both] - F))]
        r = sm.iloc[i]
        return {'k': float(r.k), 'F': F, 'T': float(r['Tyr']), 'call_bid': float(r.cb), 'call_ask': float(r.ca),
                'put_bid': float(r.pb), 'put_ask': float(r.pa)}


def horizon_minutes(sess, t, h):
    """Minutes from t to the horizon end; None if the horizon passes the session close."""
    end = sess.close * 60 if h == 'close' else t + 60 * int(h)
    if end > sess.close * 60:
        return None
    return (end - t) / 60.0


def horizon_end(sess, t, h):
    end = sess.close * 60 if h == 'close' else t + 60 * int(h)
    return end if end <= sess.close * 60 else None
