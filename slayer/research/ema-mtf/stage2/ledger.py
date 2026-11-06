"""Ledger result lines (research-v2-ledger.md, worker EMA) for every executed Stage-1 test and Stage-2 variant, pass
or fail. Prints them; `--append` writes them to the worktree ledger and the global ledger (append only).

    python3 -m stage2.ledger --what s1 [--append]
    python3 -m stage2.ledger --what s2c [--append]
"""
from __future__ import annotations

import argparse
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402

DATE = '2026-11-06'
LEDGERS = ('/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a9935b1f871a90567/research-v2-ledger.md',
           '/home/user/falcon-cloud-field-sail/research-v2-ledger.md')
SET = 'DEV blocks A+B (2024-03..05, 2022-03..05; 128 sessions; SPY/QQQ/IWM/SPXW; 5 DTE buckets)'


def p(x, d=2):
    return 'n/a' if x is None or not np.isfinite(x) else f'{x * 100:+.{d}f}%'


def s1_lines() -> list:
    res = pickle.load(open(os.path.join(EMA_DATA, 'results', 'stage1', 's1_results.pkl'), 'rb'))
    out = []
    for r in res['s1a']:
        d = r['Y30']
        out.append(f"{DATE} | EMA | EMA-S1A {r['feature']}@{r['tf']}m option MID chart, incremental over underlying state | {SET} | "
                   f"{d['n1']} | delta Y30 {p(d['delta'])} [{p(d['ci'][0])},{p(d['ci'][1])}], Holm p {r['holm']:.3g} | "
                   f"{'PASS' if r['pass'] else 'FAIL'} ({', '.join(k for k, v in r['rules'].items() if not v) or 'all rules'}); "
                   f"reprice delta* {p(r['reprice']['delta'])}; ema-mtf/reports/STAGE1.md")
    b = res['s1b']
    for i, tf in enumerate((1, 5, 15, 30, 60)):
        out.append(f"{DATE} | EMA | EMA-S1B option {tf}m MID state coefficient (joint OLS) | {SET} | {b['n']} | "
                   f"beta {p(b['beta'][i], 3)}/state, one-sided p {b['p'][i]:.3g}, Holm {b['holm'][i]:.3g} | "
                   f"{'PASS' if b['holm'][i] < 0.05 and b['beta'][i] > 0 else 'FAIL'}; qualifies(nominal) "
                   f"{'yes' if b['qualified_nominal'][i] else 'no'}; ema-mtf/reports/STAGE1.md")
    for r in res['s1c']:
        d = r['Y30']
        out.append(f"{DATE} | EMA | EMA-S1C {r['label']} on 5m MID B cross | {SET} | {d['n1']} | delta Y30 {p(d['delta'])} "
                   f"[{p(d['ci'][0])},{p(d['ci'][1])}], Holm p {r['holm']:.3g} | {'PASS' if r['pass'] else 'FAIL'}; "
                   f"ema-mtf/reports/STAGE1.md")
    return out


def s2_lines(fam='S2C') -> list:
    s = pd.read_parquet(os.path.join(EMA_DATA, 'results', 'stage2', f'{fam}_summary.parquet'))
    out = []
    for _, r in s.iterrows():
        ref = r.variant.startswith('REF')
        out.append(f"{DATE} | EMA | EMA-{r.variant} | {SET}, L0c | {int(r.n)} | exp {p(r.expectancy)} [{p(r.ci_lo)},{p(r.ci_hi)}] net, "
                   f"win {r.win_rate * 100:.0f}%, L60 {p(r.exp_L60)}, null-time pct {r.null_time_pct * 100 if r.null_time_pct == r.null_time_pct else float('nan'):.0f}% | "
                   f"{'underlying-only reference look (counted)' if ref else ('CI>0' if r.ci_lo > 0 else 'FAIL (CI includes/below 0)')}; "
                   f"ema-mtf/reports/STAGE2.md")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--what', required=True)
    ap.add_argument('--append', action='store_true')
    a = ap.parse_args()
    lines = s1_lines() if a.what == 's1' else s2_lines(a.what.upper() if a.what != 's2c' else 'S2C')
    for l in lines:
        print(l)
    if a.append:
        for path in LEDGERS:
            with open(path, 'a', encoding='utf8') as f:
                f.write('\n'.join(lines) + '\n')
        print(f'appended {len(lines)} lines to {len(LEDGERS)} ledgers', file=sys.stderr)


if __name__ == '__main__':
    main()
