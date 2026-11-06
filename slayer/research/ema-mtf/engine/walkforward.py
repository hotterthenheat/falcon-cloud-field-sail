"""Walk-forward framework (specs/PREREG.md section 6) on top of the compass-v2 evaluation code (eval/metrics.py:
session-clustered bootstrap, PBO/CSCV, DSR, the protocol bar) and the fixed splits (data/splits.py).

  folds = monthly_folds(dev_days, min_train_months=2, embargo=1)
  res = walk_forward(folds, candidates, run_fn, score_fn)      # select on train, score on test, concatenate
  M = config_matrix(per_session_returns)                       # sessions x configurations, for pbo_cscv

Embargo: the `embargo` sessions right before each test month are dropped from its training set (the holding period
of intraday trades is < 1 session; the EMA warm-up is not a leak because it uses only earlier prices). Folds never
cross a split boundary; LOCKED sessions are refused outright.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

import numpy as np
import pandas as pd

V2 = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'compass-v2')
if V2 not in sys.path:
    sys.path.insert(0, V2)
from data.splits import split_of  # noqa: E402
from eval import metrics as M  # noqa: E402,F401  (re-exported for Phase 2: summarize, pbo_cscv, deflated_sharpe, passes_bar)


@dataclass
class Fold:
    k: int
    train: list
    test: list


def assert_not_locked(days):
    bad = [d for d in days if split_of(d) == 'LOCKED']
    if bad:
        raise ValueError(f'LOCKED sessions in a walk-forward set: {bad[:3]}')


def monthly_folds(days, min_train_months: int = 2, embargo: int = 1) -> list[Fold]:
    """Anchored (expanding) folds: test = each calendar month after the first `min_train_months` months of `days`,
    train = every earlier session minus the `embargo` sessions right before the test month."""
    days = sorted(days)
    assert_not_locked(days)
    sp = {split_of(d) for d in days}
    if len(sp) > 1:
        raise ValueError(f'folds must stay inside one split, got {sp}')
    months = sorted({d[:6] for d in days})
    out = []
    for i in range(min_train_months, len(months)):
        test = [d for d in days if d[:6] == months[i]]
        prior = [d for d in days if d[:6] < months[i]]
        train = prior[:len(prior) - embargo] if embargo else prior
        out.append(Fold(len(out), train, test))
    return out


def walk_forward(folds, candidates: list, run_fn, score_fn) -> dict:
    """run_fn(candidate, days) -> trades DataFrame (with 'session'); score_fn(trades, days) -> float (higher better).
    In each fold the best candidate on TRAIN is run on TEST; returns the concatenated OOS trades and the choices."""
    oos, chosen = [], []
    for f in folds:
        scores = [(score_fn(run_fn(c, f.train), f.train), j) for j, c in enumerate(candidates)]
        best = max(scores)[1]
        t = run_fn(candidates[best], f.test)
        t = t.assign(fold=f.k, candidate=best)
        oos.append(t)
        chosen.append({'fold': f.k, 'test_month': f.test[0][:6], 'chosen': best, 'train_score': max(scores)[0]})
    return {'trades': pd.concat(oos, ignore_index=True) if oos else pd.DataFrame(), 'chosen': pd.DataFrame(chosen)}


def config_matrix(per_session: dict, sessions) -> np.ndarray:
    """{config: pd.Series(session -> mean return)} -> sessions x configs (missing = 0: no trade that session)."""
    sess = sorted(map(str, sessions))
    cols = [per_session[k].reindex(sess).fillna(0.0).to_numpy() for k in sorted(per_session)]
    return np.c_[tuple(cols)] if cols else np.zeros((len(sess), 0))
