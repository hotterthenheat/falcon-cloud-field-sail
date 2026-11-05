"""Null calibration (V2_PROTOCOL rule 11).

(a) Shuffled signal: ShuffledSignal enters the SAME number of trades per session as the candidate, at the candidate's
    own entry times (mode='keep_times') or at times resampled from the candidate's pooled time-of-day distribution
    (mode='resample_times'), but the side (call/put) is a coin flip; the contract rule and the exit policy are the
    candidate's. Any edge left is timing/contract/exit, not the signal.
(b) Synthetic no-edge data: synthetic_session(real) keeps a real session's contract set, intraday volatility profile,
    spreads and displayed sizes, but replaces the underlying with a ZERO-DRIFT (martingale) path at the real
    5-minute realized-vol profile and prices every contract by Black-Scholes off that path. iv_mode='rv' prices at the
    path's own vol (fair options: the only edge left is minus the costs); iv_mode='real' keeps each contract's real
    median implied vol (keeps the variance risk premium buyers pay in reality).
(c) null_pass_rate: run a null many times, score each run with eval.metrics.summarize + passes_bar, report the share
    that "pass" (the pipeline's false-discovery rate; it must be <= 5%) and where the candidate sits among the nulls
    (a result only counts if it beats >= 95% of them).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.stats import norm

from data.store import Contract, UND_OF
from eval.metrics import passes_bar, summarize
from sim.engine import Engine, SimConfig, Strategy, clock
from sim.memsession import MemSession

OPEN, CLOSE = clock('09:30'), clock('16:00')


# ----------------------------------------------------------------------------- (a) shuffled signal
class ShuffledSignal(Strategy):
    """entries: list of (decision_ms, root, exp_index, target_abs_delta) for THIS session (the candidate's own trades,
    or resampled ones). Side is random; contract = ctx.pick(root, exp_index, side, target delta)."""
    timer_ms = 1000

    def __init__(self, entries, exit_factory, seed, pick_kw=None):
        self.entries = sorted(entries)
        self.exit_factory = exit_factory
        self.rng = np.random.default_rng(seed)
        self.pick_kw = pick_kw or {}
        self.i = 0

    def on_event(self, ctx, ev):
        while self.i < len(self.entries) and self.entries[self.i][0] <= ctx.now:
            _, root, ei, td = self.entries[self.i]
            self.i += 1
            side = 1 if self.rng.random() < 0.5 else -1
            c = ctx.pick(root, ei, side, td, **self.pick_kw)
            if c is not None:
                ctx.buy(c, 1, exit=self.exit_factory(), tag='null', meta={'side': side})


def entries_from_trades(trades: pd.DataFrame, default_delta=0.30) -> dict:
    """candidate trade log -> {session: [(decision_ms, root, exp_index, |delta|)]} (meta may carry 'abs_delta')."""
    out = {}
    for r in trades.itertuples():
        root = r.legs.split()[0]
        d = r.meta.get('abs_delta', default_delta) if isinstance(r.meta, dict) else default_delta
        ei = r.meta.get('exp_index', 0) if isinstance(r.meta, dict) else 0
        out.setdefault(str(r.session), []).append((int(r.decision_ms), root, ei, d))
    return out


def resample_entries(entries: dict, sessions, seed) -> dict:
    """Same count per session, times drawn from the pooled time-of-day distribution (with replacement)."""
    rng = np.random.default_rng(seed)
    pool = [e for v in entries.values() for e in v]
    out = {}
    for s in sessions:
        n = len(entries.get(str(s), []))
        if n and pool:
            picks = rng.integers(0, len(pool), n)
            out[str(s)] = [pool[i] for i in picks]
    return out


# ----------------------------------------------------------------------------- (b) synthetic zero drift
def _bs(S, K, tau, vol, right):
    tau = np.maximum(tau, 1e-9)
    sv = vol * np.sqrt(tau)
    d1 = (np.log(S / K) + 0.5 * sv * sv) / sv
    d2 = d1 - sv
    if right == 1:
        return S * norm.cdf(d1) - K * norm.cdf(d2), norm.cdf(d1)
    return K * norm.cdf(-d2) - S * norm.cdf(-d1), norm.cdf(d1) - 1


def _tick(root, px):
    if root.startswith('SPX'):
        return np.where(px >= 3.0, 0.10, 0.05)
    return np.full_like(px, 0.01)


def _tau_years(ms, day: str, exp: int):
    """Trading time to the expiry's 16:00, in years: whole sessions between (252/yr) + the fraction left today."""
    d0 = pd.Timestamp(day)
    d1 = pd.Timestamp(str(exp))
    full = max(0, len(pd.bdate_range(d0, d1)) - 1)
    left_today = (CLOSE - ms) / (CLOSE - OPEN)
    return (full + np.clip(left_today, 0, 1)) / 252


def synthetic_session(real, seed: int, iv_mode: str = 'rv', step_ms: int = 1000) -> MemSession:
    """A no-edge copy of a real data.store.Session (see module doc)."""
    rng = np.random.default_rng(seed)
    t = np.arange(OPEN, CLOSE + 1, step_ms)
    und, quotes, greeks = {}, {}, {}
    exp_map = {}
    for root in real.roots:
        sym = UND_OF[root]
        u = real.underlying(sym)
        # real per-second vol profile in 5-minute buckets
        grid = np.arange(OPEN, CLOSE + 1, 1000)
        i = np.clip(np.searchsorted(u['ms'], grid, side='right') - 1, 0, len(u['px']) - 1)
        p = pd.Series(u['px'][i]).ffill().bfill().to_numpy()
        r = np.diff(np.log(p))
        b = (np.arange(len(r)) // 300)
        sig_b = np.sqrt(pd.Series(r * r).groupby(b).mean().to_numpy())
        sig_b = np.where(np.isfinite(sig_b) & (sig_b > 0), sig_b, np.nanmedian(sig_b[sig_b > 0]) if np.any(sig_b > 0) else 1e-4)
        if sym not in und:
            n = len(t) - 1
            sig = sig_b[np.clip((np.arange(n) * step_ms) // 300_000, 0, len(sig_b) - 1)] * math.sqrt(step_ms / 1000)
            z = rng.standard_normal(n)
            logp = np.log(p[0]) + np.r_[0, np.cumsum(sig * z - 0.5 * sig * sig)]     # martingale in price
            und[sym] = {'ms': t, 'px': np.exp(logp)}
        S = und[sym]['px']
        ann_rv = float(np.sqrt(np.mean(sig_b ** 2) * 23400 * 252))
        exps = real.expirations(root)
        exp_map[root] = exps
        g = real.greeks(root)
        rows = []
        for c in real.contracts(root):
            rq = real.quotes(c)
            ok = (rq['bid'] > 0) & (rq['ask'] >= rq['bid'])
            if not ok.any():
                continue
            spread_c = int(np.median((rq['ask'] - rq['bid'])[ok]))
            bs_med, as_med = int(np.median(rq['bs'][ok])), int(np.median(rq['as'][ok]))
            if iv_mode == 'real' and len(g):
                gi = g[(g.exp == c.exp) & (g.strike == c.strike) & (g.right == c.right)]
                iv = float(np.nanmedian(gi.iv)) if len(gi) and np.isfinite(np.nanmedian(gi.iv)) and np.nanmedian(gi.iv) > 0 else ann_rv
            else:
                iv = ann_rv
            tau = _tau_years(t, real.day, c.exp)
            fair, delta = _bs(S, c.k, tau, iv, c.right)
            tk = _tick(root, fair)
            half = spread_c / 200
            bid = np.maximum(0.0, np.floor((fair - half) / tk) * tk)
            ask = np.maximum(bid + tk, np.ceil((fair + half) / tk) * tk)
            bid_c, ask_c = np.round(bid * 100).astype(np.int32), np.round(ask * 100).astype(np.int32)
            ch = np.r_[True, (bid_c[1:] != bid_c[:-1]) | (ask_c[1:] != ask_c[:-1])]
            quotes[c] = {'ms': t[ch], 'bid': bid_c[ch], 'ask': ask_c[ch], 'bs': np.full(ch.sum(), max(bs_med, 1), np.int32),
                         'as': np.full(ch.sum(), max(as_med, 1), np.int32)}
            m = (t - OPEN) % 60_000 == 0
            rows.append(pd.DataFrame({'exp': c.exp, 'strike': c.strike, 'right': c.right, 'ms': t[m], 'delta': delta[m],
                                      'iv': iv, 'und': S[m], 'bid': bid_c[m], 'ask': ask_c[m]}))
        greeks[root] = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    s = MemSession(real.day, quotes, greeks=greeks, underlying=und, expirations=exp_map)
    s.manifest = {'roots': {r: {} for r in real.roots}, 'synthetic': {'seed': seed, 'iv_mode': iv_mode}}
    return s


# ----------------------------------------------------------------------------- (c) calibration
def run_on(sessions, make_strategy, cfg=None) -> pd.DataFrame:
    rows = []
    for s in sessions:
        rows += Engine(s, make_strategy(s), cfg or SimConfig()).run()
    return pd.DataFrame(rows)


def null_pass_rate(run_null, n_runs: int, session_days, n_trials: int, candidate_expectancy: float | None = None,
                   ret: str = 'ret_net', seed0: int = 1000) -> dict:
    """run_null(seed) -> trade DataFrame. Each run is scored like a candidate; returns the share passing the bar
    (with and without the count/regime tests), the null expectancy distribution, and the candidate's percentile."""
    exps, full, stat, ci = [], 0, 0, 0
    for k in range(n_runs):
        tr = run_null(seed0 + k)
        rep = summarize(tr, session_days, ret=ret, n_trials=n_trials, n_boot=1000)
        if rep.get('n'):
            exps.append(rep['expectancy'])
            full += passes_bar(rep)['pass']
            stat += passes_bar(rep, require_count=False)['pass']
            ci += rep['ci_expectancy'][0] > 0          # the bare statistical test alone
        else:
            exps.append(float('nan'))
    exps = np.array(exps)
    out = {'n_runs': n_runs, 'pass_rate_full_bar': full / n_runs, 'pass_rate_stat_bar': stat / n_runs,
           'pass_rate_ci_only': ci / n_runs,
           'null_expectancy_mean': float(np.nanmean(exps)), 'null_expectancy_p95': float(np.nanpercentile(exps, 95)),
           'null_expectancies': exps.tolist(), 'valid_pipeline': max(stat, full) / n_runs <= 0.05}
    if candidate_expectancy is not None:
        out['candidate_beats_share'] = float(np.mean(candidate_expectancy > exps[np.isfinite(exps)]))
        out['candidate_counts'] = out['candidate_beats_share'] >= 0.95
    return out
