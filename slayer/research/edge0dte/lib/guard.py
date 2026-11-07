"""HOLDOUT guard. Every outcome or P&L function calls check(day) first.

* day < 2025-01-01: allowed.
* 2025 (HOLDOUT): allowed only when env EDGE0DTE_HOLDOUT equals a sha256 that is present in
  v2data/locked_looks.jsonl (the frozen spec was ledgered before the look).
* 2026+ (LOCKED): always refused.
Features (data available at t) are not guarded; only forward outcomes and fills are.
"""
import json
import os

from .config import LOCKED_LOOKS


class HoldoutError(RuntimeError):
    pass


def _registered(sha):
    if not sha or len(sha) != 64 or not os.path.exists(LOCKED_LOOKS):
        return False
    with open(LOCKED_LOOKS) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                if json.loads(line).get('sha256') == sha:
                    return True
            except ValueError:
                continue
    return False


def check(day):
    day = str(day)[:10]
    if day < '2025-01-01':
        return True
    if day >= '2026-01-01':
        raise HoldoutError(f'{day} is LOCKED (2026): never opened in EDGE0DTE')
    sha = os.environ.get('EDGE0DTE_HOLDOUT', '')
    if _registered(sha):
        return True
    raise HoldoutError(f'{day} is HOLDOUT: set EDGE0DTE_HOLDOUT to a frozen spec sha256 present in {LOCKED_LOOKS}')
