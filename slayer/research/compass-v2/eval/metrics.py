"""Evaluation of a trade log (sim.engine output): expectancy, win rate, payoff, session-clustered bootstrap CIs,
Sharpe per trade / per day, drawdown, PBO (CSCV), deflated Sharpe, regime splits, and the V2 protocol bar.

    from eval.metrics import summarize, passes_bar
    rep = summarize(trades, sessions=all_session_days, ret='ret_net')

Conventions: one row per trade; `ret` is the per-trade return on premium (ret_net after fees by default); `session`
is the cluster for every interval (trades on the same day are not independent). Sessions with no trade count as
zero-P&L days in the per-day series when the list of sessions is given.
"""
from __future__ import annotations

import itertools
import math
import os
import re

import numpy as np
import pandas as pd
from scipy import stats

LEDGER = os.environ.get('V2_LEDGER', '/home/user/falcon-cloud-field-sail/research-v2-ledger.md')


# ----------------------------------------------------------------------------- basic stats
def basic(r: np.ndarray) -> dict:
    r = np.asarray(r, float)
    r = r[~np.isnan(r)]
    n = len(r)
    if n == 0:
        return {'n': 0}
    w, l = r[r > 0], r[r <= 0]
    sd = r.std(ddof=1) if n > 1 else float('nan')
    return {
        'n': n, 'expectancy': r.mean(), 'median': float(np.median(r)), 'win_rate': len(w) / n,
        'avg_win': w.mean() if len(w) else 0.0, 'avg_loss': l.mean() if len(l) else 0.0,
        'payoff': (w.mean() / -l.mean()) if len(w) and len(l) and l.mean() < 0 else float('inf') if len(w) else 0.0,
        'sd': sd, 'sharpe_trade': r.mean() / sd if sd and sd > 0 else float('nan'),
        'skew': float(stats.skew(r)) if n > 2 else 0.0, 'kurt': float(stats.kurtosis(r, fisher=False)) if n > 3 else 3.0,
    }


def per_session(trades: pd.DataFrame, col: str, sessions=None) -> pd.Series:
    s = trades.groupby('session')[col].sum() if len(trades) else pd.Series(dtype=float)
    if sessions is not None:
        s = s.reindex(sorted(set(map(str, sessions)) | set(s.index)), fill_value=0.0)
    return s


def max_drawdown(x: np.ndarray) -> float:
    """Largest peak-to-trough fall of the cumulative sum of x (same units as x; <= 0)."""
    c = np.cumsum(np.r_[0.0, np.asarray(x, float)])
    return float((c - np.maximum.accumulate(c)).min())


def cluster_bootstrap(trades: pd.DataFrame, stat, n_boot=4000, seed=7, sessions=None) -> tuple:
    """95% CI of stat(df) resampling whole sessions with replacement (sessions with no trades included if given)."""
    rng = np.random.default_rng(seed)
    groups = {k: g for k, g in trades.groupby('session')}
    keys = sorted(set(groups) | set(map(str, sessions or [])))
    if not keys:
        return (float('nan'), float('nan'))
    empty = trades.iloc[:0]
    vals = []
    for _ in range(n_boot):
        pick = rng.integers(0, len(keys), len(keys))
        parts = [groups.get(keys[i], empty) for i in pick]
        d = pd.concat(parts) if parts else empty
        v = stat(d) if len(d) else float('nan')
        if not (isinstance(v, float) and math.isnan(v)):
            vals.append(v)
    if not vals:
        return (float('nan'), float('nan'))
    return (float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5)))


def cluster_ci_mean(values, clusters, n_boot=4000, seed=7, extra_clusters=()) -> tuple:
    """Fast 95% CI of a pooled mean (sum of values / count) resampling whole clusters (sessions) with replacement.
    extra_clusters: sessions with no trades (they add 0 to both sums; they still change the resampled weights)."""
    v = np.asarray(values, float)
    cl = np.asarray(clusters).astype(str)
    keys, inv = np.unique(cl, return_inverse=True)
    sums = np.bincount(inv, weights=v, minlength=len(keys))
    cnts = np.bincount(inv, minlength=len(keys)).astype(float)
    extra = [k for k in set(map(str, extra_clusters)) if k not in set(keys)]
    sums, cnts = np.r_[sums, np.zeros(len(extra))], np.r_[cnts, np.zeros(len(extra))]
    K = len(sums)
    if K == 0:
        return (float('nan'), float('nan'))
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, K, (n_boot, K))
    S, N = sums[pick].sum(1), cnts[pick].sum(1)
    m = S[N > 0] / N[N > 0]
    return (float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))) if len(m) else (float('nan'), float('nan'))


# ----------------------------------------------------------------------------- overfitting
def deflated_sharpe(sr: float, n_obs: int, n_trials: int, sr_var_trials: float | None = None,
                    skew: float = 0.0, kurt: float = 3.0) -> dict:
    """Bailey & Lopez de Prado (2014). sr: the candidate's (non-annualized, per-observation) Sharpe; n_obs the number of
    observations it is computed on; n_trials the total trials tried (the ledger's count); sr_var_trials the variance
    of the trials' Sharpes (if unknown, the null variance 1/(n_obs-1) is used: the expected max of N noise strategies).
    Returns the expected-max-Sharpe benchmark SR0 and DSR = P(true SR > SR0)."""
    if n_obs < 3 or not np.isfinite(sr):
        return {'sr0': float('nan'), 'dsr': float('nan')}
    g = 0.5772156649
    v = sr_var_trials if sr_var_trials is not None and sr_var_trials > 0 else 1.0 / (n_obs - 1)
    N = max(int(n_trials), 1)
    if N == 1:
        sr0 = 0.0
    else:
        sr0 = math.sqrt(v) * ((1 - g) * stats.norm.ppf(1 - 1 / N) + g * stats.norm.ppf(1 - 1 / (N * math.e)))
    den = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    z = (sr - sr0) * math.sqrt(n_obs - 1) / den
    return {'sr0': sr0, 'dsr': float(stats.norm.cdf(z)), 'n_trials': N}


def pbo_cscv(M: np.ndarray, n_blocks: int = 16, metric=None, max_splits: int = 20000, seed: int = 3) -> dict:
    """Probability of backtest overfitting (Bailey, Borwein, Lopez de Prado, Zhu 2015), CSCV.
    M: T x N matrix, rows = time-ordered observations (e.g. per-session P&L), columns = the N configurations tried.
    metric(sub_matrix) -> per-column score (default: mean / std, a Sharpe). Returns pbo and the logits."""
    M = np.asarray(M, float)
    T, N = M.shape
    if N < 2 or T < n_blocks:
        return {'pbo': float('nan'), 'n_splits': 0}
    metric = metric or (lambda X: np.nanmean(X, 0) / (np.nanstd(X, 0, ddof=1) + 1e-12))
    blocks = np.array_split(np.arange(T), n_blocks)
    combos = list(itertools.combinations(range(n_blocks), n_blocks // 2))
    if len(combos) > max_splits:
        rng = np.random.default_rng(seed)
        combos = [combos[i] for i in rng.choice(len(combos), max_splits, replace=False)]
    logits = []
    for cmb in combos:
        ins = np.concatenate([blocks[i] for i in cmb])
        oos = np.concatenate([blocks[i] for i in range(n_blocks) if i not in cmb])
        s_in, s_out = metric(M[ins]), metric(M[oos])
        best = int(np.nanargmax(s_in))
        rank = stats.rankdata(s_out)[best] / (N + 1)        # relative rank in (0,1)
        logits.append(math.log(rank / (1 - rank)))
    logits = np.array(logits)
    return {'pbo': float((logits <= 0).mean()), 'n_splits': len(combos), 'logit_median': float(np.median(logits))}


# ----------------------------------------------------------------------------- ledger
def ledger_trials(path: str = LEDGER, detail: bool = False):
    """Total trials in the global ledger (format: `date | worker | id | set | n | result | note`, one line per
    hypothesis / variant / look). Counted as: the largest `prior trials N` mentioned (the v1 research's count, 155)
    + for every PREREG line the variants it registers (`(N looks)` if given, else `N variants`; `0 trials` /
    NOT TESTABLE count 0) + 1 for any other result line whose set is not `spec` and that is not a re-run of a
    registered id. A `TOTAL_TRIALS: N` line, if larger, wins. detail=True returns the breakdown."""
    if not os.path.exists(path):
        return {'total': 0} if detail else 0
    prior, reg, other, explicit, lines = 0, 0, 0, 0, 0
    for line in open(path, encoding='utf8'):
        m = re.match(r'^\s*TOTAL_TRIALS:\s*(\d+)', line)
        if m:
            explicit = max(explicit, int(m.group(1)))
            continue
        f = [x.strip() for x in line.split('|')]
        if len(f) < 6 or not re.match(r'\d{4}-\d{2}-\d{2}', f[0]):
            continue
        lines += 1
        txt = ' '.join(f[3:])
        for m in re.finditer(r'prior trials\s*(\d+)', line, re.I):
            prior = max(prior, int(m.group(1)))
        if 'PREREG' in f[2].upper():
            if re.search(r'NOT TESTABLE|\b0 trials', txt, re.I):
                continue
            m = re.search(r'\((\d+)\s*looks?\)', txt) or re.search(r'(\d+)\s*variants?', txt)
            reg += int(m.group(1)) if m else 1
        elif f[3].lower() != 'spec' and not re.search(r'reproduction|re-run|rerun|baseline', txt, re.I):
            other += 1
    total = max(prior + reg + other, explicit)
    return {'total': total, 'prior': prior, 'registered_variants': reg, 'other_results': other, 'lines': lines,
            'explicit': explicit} if detail else total


# ----------------------------------------------------------------------------- regimes
def classify_session(session) -> dict:
    """Fixed (untuned) day labels from the underlying's 1-second path (SPX if the session has it, else SPY):
    high_vol if realized vol (09:35-15:55, 1-minute returns, annualized) >= 25%; else trend if |open->close| >= 0.6%
    and the close sits in the outer 25% of the day's range in the move's direction; else flat."""
    sym = 'SPX' if 'SPXW' in session.manifest.get('roots', {}) else 'SPY'
    u = session.underlying(sym)
    ms, px = u['ms'], u['px']
    t = np.arange(34_500_000, 57_300_001, 60_000)
    i = np.clip(np.searchsorted(ms, t, side='right') - 1, 0, len(px) - 1)
    p = px[i]
    p = p[np.isfinite(p) & (p > 0)]
    r = np.diff(np.log(p))
    rv = float(np.sqrt(np.sum(r * r) * 252)) if len(r) else float('nan')
    o, c, hi, lo = p[0], p[-1], p.max(), p.min()
    ret = c / o - 1
    pos = (c - lo) / (hi - lo) if hi > lo else 0.5
    if rv >= 0.25:
        lab = 'high_vol'
    elif abs(ret) >= 0.006 and ((ret > 0 and pos >= 0.75) or (ret < 0 and pos <= 0.25)):
        lab = 'trend'
    else:
        lab = 'flat'
    return {'session': session.day, 'year': session.day[:4], 'label': lab, 'rv': rv, 'ret': ret}


# ----------------------------------------------------------------------------- summary & the bar
def summarize(trades: pd.DataFrame, sessions=None, ret: str = 'ret_net', n_trials: int | None = None,
              sr_var_trials: float | None = None, regimes: pd.DataFrame | None = None, n_boot: int = 4000) -> dict:
    """Everything the protocol asks for, on one trade log. regimes: DataFrame(session, year, label) from classify_session."""
    sessions = sorted(map(str, sessions)) if sessions is not None else sorted(trades.session.unique()) if len(trades) else []
    out = {'n_sessions': len(sessions)}
    if len(trades) == 0:
        out.update(n=0)
        return out
    r = trades[ret].to_numpy(float)
    out.update(basic(r))
    out['gross_expectancy'] = trades['ret_gross'].mean() if 'ret_gross' in trades else float('nan')
    out['pnl_net_per_trade'] = trades['pnl_net'].mean()
    out['pnl_gross_per_trade'] = trades['pnl_gross'].mean()
    ses = trades.session.astype(str).to_numpy()
    out['ci_expectancy'] = cluster_ci_mean(r, ses, n_boot)
    out['ci_win_rate'] = cluster_ci_mean((r > 0).astype(float), ses, n_boot)
    out['ci_pnl_net'] = cluster_ci_mean(trades['pnl_net'].to_numpy(float), ses, n_boot)
    day = per_session(trades, ret, sessions)
    dpnl = per_session(trades, 'pnl_net', sessions)
    sd = day.std(ddof=1)
    out['sharpe_day'] = day.mean() / sd if sd > 0 else float('nan')
    out['sharpe_day_ann'] = out['sharpe_day'] * math.sqrt(252) if np.isfinite(out['sharpe_day']) else float('nan')
    out['max_dd_ret_units'] = max_drawdown(trades.sort_values(['session', 'entry_ms'])[ret].to_numpy())
    out['max_dd_dollars'] = max_drawdown(dpnl.to_numpy())
    out['hold_s_median'] = float(trades['hold_s'].median()) if 'hold_s' in trades else float('nan')
    N = n_trials if n_trials is not None else ledger_trials()
    out['n_trials'] = N
    out.update({f'dsr_{k}': v for k, v in deflated_sharpe(out['sharpe_trade'], out['n'], max(N, 1), sr_var_trials,
                                                          out['skew'], out['kurt']).items()})
    if regimes is not None and len(regimes):
        m = trades.merge(regimes[['session', 'year', 'label']], on='session', how='left')
        out['by_year'] = {k: _small(g[ret]) for k, g in m.groupby('year')}
        out['by_regime'] = {k: _small(g[ret]) for k, g in m.groupby('label')}
    return out


def _small(x) -> dict:
    x = np.asarray(x, float)
    return {'n': len(x), 'expectancy': float(x.mean()) if len(x) else float('nan'),
            'win_rate': float((x > 0).mean()) if len(x) else float('nan')}


def passes_bar(rep: dict, pbo: float | None = None, require_count: bool = True) -> dict:
    """V2_PROTOCOL rule 7. Returns each test and 'pass'. require_count=False drops the >=150-trades and the
    2-regime tests (used to measure the statistical false-positive rate on small null samples)."""
    lo = rep.get('ci_expectancy', (float('nan'),))[0]
    t = {
        'expectancy_ci_above_0': bool(lo > 0),
        'win_or_payoff': bool(rep.get('win_rate', 0) >= 0.55 or rep.get('expectancy', -1) >= 0.10),
        'dsr_ge_0.95': bool(rep.get('dsr_dsr', 0) >= 0.95),
        'pbo_lt_0.3': bool(pbo is None or pbo < 0.3),
    }
    if require_count:
        t['n_ge_150'] = rep.get('n', 0) >= 150
        regs = rep.get('by_regime') or rep.get('by_year') or {}
        t['regimes_ge_2_positive'] = sum(1 for v in regs.values() if v['n'] >= 10 and v['expectancy'] > 0) >= 2
    t['pass'] = all(t.values())
    return t


def fmt_report(rep: dict) -> str:
    def f(x, pct=True):
        if isinstance(x, tuple):
            return '[' + ', '.join(f(v, pct) for v in x) + ']'
        if x is None or (isinstance(x, float) and not np.isfinite(x)):
            return 'n/a'
        return f'{x * 100:+.1f}%' if pct else f'{x:.3g}'
    if not rep.get('n'):
        return 'no trades'
    s = (f"n={rep['n']} sessions={rep['n_sessions']} | expectancy {f(rep['expectancy'])} {f(rep['ci_expectancy'])} "
         f"(gross {f(rep['gross_expectancy'])}) | win {rep['win_rate']*100:.0f}% {f(rep['ci_win_rate'])} | payoff "
         f"{f(rep['payoff'], False)} | $/trade net {rep['pnl_net_per_trade']:+.1f} | Sharpe/trade {f(rep['sharpe_trade'], False)} "
         f"| Sharpe/day {f(rep['sharpe_day'], False)} | maxDD ${rep['max_dd_dollars']:.0f} | DSR {f(rep['dsr_dsr'], False)} "
         f"(N={rep['n_trials']})")
    return s
