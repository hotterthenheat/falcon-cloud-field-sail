"""Zero-drift synthetic panel for the Stage-1 null (V2_PROTOCOL rule 11b), the MID-bar equivalent of compass-v2
eval/nulls.py synthetic_session (which needs the 100 ms store).

Per root and seed, for every stored session D (history and eval, so EMAs warm up exactly as on the real panel):
  underlying   a martingale in price, 1-minute steps, started at D's real 09:30 open, with the real session's
               volatility profile: sigma of each 5-minute bucket = RMS of D's real 1-minute log returns in that bucket.
               log S_{m+1} = log S_m + sigma_b z - sigma_b^2 / 2   (zero drift in price). No information carries
               from the real path except the open level and the vol profile.
  options      every real q0 row (same contracts, same minutes, same tiers) is re-quoted: mid = Black-Scholes at the
               synthetic underlying with vol = the session's annualised real RV (252 basis) and compass-v2's trading-
               time clock (business days to expiry / 252 + the part of today left), so the synthetic premium is a
               (near-)martingale intraday: no feature can predict it. bid/ask = mid -/+ half the contract-session's
               median real spread, rounded out to the tick; sizes are the real displayed sizes; rows whose real quote
               was one-sided stay one-sided.
  prints       none (the TRADE arm, S1C and the reprice control are not run on synthetic data: S1A only).
Every pipeline step is the real one (stage1.events.build with this source, full=False).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from edata.store import Panel
from stage1.events import UND_SYM, Source

OPEN_M, N_M = 0, 390
TRADING_MIN = 390


def _tau_trading(session: int, m: np.ndarray, exp: np.ndarray) -> np.ndarray:
    """compass-v2 nulls._tau_years: (business days from session to expiry + share of today left) / 252."""
    s = pd.Timestamp(str(session))
    out = np.empty(len(exp))
    for e in np.unique(exp):
        bd = max(0, len(pd.bdate_range(s, pd.Timestamp(str(int(e))))) - 1)
        sel = exp == e
        left = np.clip((TRADING_MIN - (np.asarray(m)[sel] + 1)) / TRADING_MIN, 0, 1)
        out[sel] = (bd + left) / 252
    return np.maximum(out, 1 / (252 * TRADING_MIN))


def _bs(S, K, tau, vol, call):
    from scipy.special import ndtr
    sq = vol * np.sqrt(tau)
    d1 = (np.log(S / K) + 0.5 * sq * sq) / sq
    d2 = d1 - sq
    c = S * ndtr(d1) - K * ndtr(d2)
    return np.where(call, c, c - S + K)


class SynthSource(Source):
    def __init__(self, root: str, seed: int, panel: Panel | None = None):
        super().__init__(root, panel)
        self.seed = seed
        self._u: dict = {}
        self._q: dict = {}

    def _rng(self, D):
        return np.random.default_rng([self.seed, int(D), sum(map(ord, self.root))])

    def und_day(self, D):
        if D in self._u:
            return self._u[D]
        from edata.store import und_bars
        b = und_bars(self.sym, D)
        b = b[(b['mod'] >= 570) & (b['mod'] < 960)]
        if not len(b):
            self._u[D] = None
            return None
        real = pd.Series(b.c.to_numpy() / 1e4, index=b['mod'].to_numpy() - 570).reindex(np.arange(N_M)).ffill().bfill()
        r = np.diff(np.log(real.to_numpy()))
        bucket = np.arange(len(r)) // 5
        sig_b = np.sqrt(pd.Series(r * r).groupby(bucket).mean().to_numpy())
        pos = sig_b[sig_b > 0]
        sig_b = np.where(sig_b > 0, sig_b, np.median(pos) if len(pos) else 1e-4)
        sig = sig_b[np.clip(np.arange(N_M) // 5, 0, len(sig_b) - 1)]
        z = self._rng(D).standard_normal(N_M)
        o = float(b.o.iloc[0]) / 1e4
        logp = math.log(o) + np.cumsum(sig * z - 0.5 * sig * sig)       # close of minute m
        ann = float(np.sqrt(np.mean(sig_b ** 2) * TRADING_MIN * 252))
        self._u[D] = (np.exp(logp), ann)
        return self._u[D]

    def und_m1(self, days) -> pd.DataFrame:
        rows = []
        for D in days:
            u = self.und_day(D)
            if u is None:
                continue
            c = u[0]
            rows.append(pd.DataFrame({'session': int(D), 'm': np.arange(N_M), 'o': c, 'h': c, 'l': c, 'c': c, 'v': 0, 'n': 0}))
        return pd.concat(rows, ignore_index=True)

    def q0(self, D):
        if D in self._q:
            return self._q[D]
        q = self.p.q0(D)
        u = self.und_day(D)
        if not len(q) or u is None:
            return q
        S_path, vol = u
        q = q.copy()
        m = q.m.to_numpy().astype(np.int64)
        S = S_path[np.clip(m, 0, N_M - 1)]
        K = q.strike.to_numpy() / 1000
        call = q.right.to_numpy() == 1
        tau = _tau_trading(int(D), m, q.exp.to_numpy())
        fair = _bs(S, K, tau, vol, call)
        valid = (q.bid.to_numpy() > 0) & (q.ask.to_numpy() >= q.bid.to_numpy())
        spr = (q.ask - q.bid).where(valid)
        half = spr.groupby([q.exp, q.strike, q.right]).transform('median').to_numpy() / 200.0
        half = np.where(np.isfinite(half), half, 0.01)
        spx = self.root in ('SPXW', 'SPX')
        tk = np.where(spx & (fair >= 3), 0.10, np.where(spx, 0.05, 0.01))
        bid = np.maximum(0.0, np.floor((fair - half) / tk + 1e-9) * tk)
        ask = np.maximum(bid + tk, np.ceil((fair + half) / tk - 1e-9) * tk)
        bid_c = np.round(bid * 100).astype(np.int32)
        ask_c = np.round(ask * 100).astype(np.int32)
        q['bid'] = np.where(valid, bid_c, 0).astype(np.int32)
        q['ask'] = np.where(valid, ask_c, q.ask.to_numpy()).astype(np.int32)
        if len(self._q) > 3:
            self._q.clear()
        self._q[D] = q
        return q

    def tb(self, D):
        return pd.DataFrame()
