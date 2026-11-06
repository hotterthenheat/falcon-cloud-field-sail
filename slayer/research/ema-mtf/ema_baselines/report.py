"""reports/BASELINES.md from results/baselines_*.parquet (ema_baselines/run.py)."""
from __future__ import annotations

import glob
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import edata.common  # noqa: E402,F401  (puts compass-v2 on the path)
from eval.metrics import summarize, cluster_ci_mean  # noqa: E402

LEDGER = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), 'research-v2-ledger.md')
NAMES = {'BL1': 'BL1 buy-and-hold grid', 'BL2': 'BL2 random entries', 'BL3': 'BL3 underlying-only EMA',
         'BL4': 'BL4 option-only EMA', 'BL5': 'BL5 combined', 'BL6': 'BL6 plain directional'}


def load():
    fs = sorted(glob.glob(os.path.join(HERE, 'results', 'baselines_*.parquet')))
    return pd.concat([pd.read_parquet(f) for f in fs], ignore_index=True) if fs else pd.DataFrame()


def pct(x):
    return 'n/a' if x is None or not np.isfinite(x) else f'{100 * x:+.1f}%'


def ci(t):
    return f'[{100 * t[0]:+.1f}, {100 * t[1]:+.1f}]'


def main():
    from eval.metrics import ledger_trials
    df = load()
    fall = df[df.status == 'filled'].copy()
    fall['session'] = fall.session.astype(str)
    fall['entry_ms'] = (570 + fall.decision_m + 1) * 60_000 + 2000
    f = fall[fall.latency == 'L0c'].copy()
    f['session'] = f.session.astype(str)
    f['entry_ms'] = (570 + f.decision_m + 1) * 60_000 + 2000
    sessions = sorted(df.session.astype(str).unique())
    N = ledger_trials(LEDGER)
    out = []
    w = out.append
    w('# Baselines (Phase 1, DEV) — what "no edge" looks like for long premium on these contracts\n')
    w('Pre-registered in `specs/STRATEGY_SPEC.md` §14 and the ledger before this run; references, not candidates; '
      'nothing was tuned on them. Executable simulator (`engine/execution.py`): decision at a 1-minute bar close; buy '
      'at the ask, sell at the bid, never the mid; displayed size; fees $0.65/contract/side (SPXW $1.15). Main tables: '
      'fill model **L0c** = the NBBO at the bar close moved against us by the measured mean 2-second drift (+0.17% of '
      'mid on buys, +0.05% on sells; PREREG A1); the latency table adds L0 (no latency), L60 (60 s) and exact **L2** '
      '(1-second NBBO 2 s after the decision) where it was run. '
      f'Sessions: {len(sessions)} DEV eval sessions ({sessions[0]}..{sessions[-1]}), blocks {sorted(df.block.unique())}, '
      f'roots {sorted(df.root.unique())}. DSR trial count {N} (ledger).\n')
    w('Contract: |delta| nearest 0.40 in [0.30, 0.50] of the bucket\'s representative expiration(s), spread ≤ 8% of mid. '
      'XT30 = hold 30 minutes (or the 15:55 flat); X3S = sell at the first completed 5m MID close below the contract\'s '
      'own 5m EMA9, or when the MID falls to 70% of the entry fill.\n')
    for xname in ('XT30', 'X3S'):
        w(f'\n## Exit {xname}: all roots and buckets pooled\n')
        w('| baseline | n | expectancy net | 95% CI (session bootstrap) | gross | mid-to-mid | win | payoff | median | $/trade net | Sharpe/day | maxDD $ | DSR |')
        w('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
        for bl in NAMES:
            t = f[(f.baseline == bl) & (f.exit == xname)]
            if not len(t):
                continue
            r = summarize(t, sessions=sessions, n_trials=N, n_boot=2000)
            w(f"| {NAMES[bl]} | {r['n']} | {pct(r['expectancy'])} | {ci(r['ci_expectancy'])} | {pct(r['gross_expectancy'])} | "
              f"{pct(t.ret_mid.mean())} | {100 * r['win_rate']:.0f}% | {r['payoff']:.2f} | {pct(r['median'])} | {r['pnl_net_per_trade']:+.1f} | "
              f"{r['sharpe_day']:.2f} | {r['max_dd_dollars']:.0f} | {r['dsr_dsr']:.2f} |")
        w(f'\n### {xname} by DTE bucket (net expectancy [95% CI], n)\n')
        bks = ['0', '1-7', '8-30', '31-90', '91-200']
        w('| baseline | ' + ' | '.join(bks) + ' |')
        w('|---|' + '---|' * len(bks))
        for bl in NAMES:
            cells = []
            for b in bks:
                t = f[(f.baseline == bl) & (f.exit == xname) & (f.bucket == b)]
                if len(t) < 5:
                    cells.append(f'n={len(t)}')
                    continue
                lo, hi = cluster_ci_mean(t.ret_net.to_numpy(), t.session.to_numpy(), 2000)
                cells.append(f'{pct(t.ret_net.mean())} [{100 * lo:+.0f},{100 * hi:+.0f}] n={len(t)}')
            w(f'| {bl} | ' + ' | '.join(cells) + ' |')
        w(f'\n### {xname} by root and by block (net expectancy, n)\n')
        roots = sorted(f.root.unique())
        blocks = sorted(f.block.unique())
        w('| baseline | ' + ' | '.join(roots + [f'block {b}' for b in blocks]) + ' |')
        w('|---|' + '---|' * (len(roots) + len(blocks)))
        for bl in NAMES:
            cells = []
            for rt in roots:
                t = f[(f.baseline == bl) & (f.exit == xname) & (f.root == rt)]
                cells.append(f'{pct(t.ret_net.mean())} n={len(t)}' if len(t) else '-')
            for bk in blocks:
                t = f[(f.baseline == bl) & (f.exit == xname) & (f.block == bk)]
                cells.append(f'{pct(t.ret_net.mean())} n={len(t)}' if len(t) else '-')
            w(f'| {bl} | ' + ' | '.join(cells) + ' |')
    w('\n## Costs at entry (all filled baseline trades, XT30)\n')
    t = fall[(fall.exit == 'XT30') & (fall.latency == 'L0')]
    g = t.assign(fee_frac=t.fees / 2 / (t.entry_px * 100)).groupby(['root', 'bucket'])
    w('| root | bucket | n | median spread (% of mid) | median premium $ | median fee (% of premium, one side) | rejected at arrival |')
    w('|---|---|---|---|---|---|---|')
    rej = df[(df.status == 'rejected') & (df.exit == 'XT30') & (df.latency == 'L0')].groupby(['root', 'bucket']).size()
    for (rt, b), x in g:
        w(f'| {rt} | {b} | {len(x)} | {100 * x.entry_spread_frac.median():.2f}% | {100 * x.entry_px.median():.0f} | '
          f'{100 * x.fee_frac.median():.2f}% | {int(rej.get((rt, b), 0))} |')
    w('\n## Latency: net expectancy by fill model (pooled; L0 = bar-end NBBO, no latency, optimistic; L0c = L0 + measured '
      '2 s drift, the screening model; L60 = NBBO 60 s after the bar end; L2 = exact 1-second NBBO 2 s after, where run)\n')
    lats = [x for x in ('L0', 'L0c', 'L2', 'L60') if x in set(fall.latency)]
    w('| baseline | exit | ' + ' | '.join(lats) + ' |')
    w('|---|---|' + '---|' * len(lats))
    for bl in NAMES:
        for xname in ('XT30', 'X3S'):
            cells = []
            for L in lats:
                t = fall[(fall.baseline == bl) & (fall.exit == xname) & (fall.latency == L)]
                cells.append(f'{pct(t.ret_net.mean())} (n={len(t)})' if len(t) else '-')
            w(f'| {bl} | {xname} | ' + ' | '.join(cells) + ' |')
    w('\n## Exit reasons (L0c)\n')
    w(f.groupby(['baseline', 'exit']).exit_reason.value_counts().unstack(fill_value=0).to_string().replace('\n', '\n    ').join(['    ', '']))
    w('\n## Median minutes held (L0c)\n')
    w(f.groupby(['baseline', 'exit']).bars_held.median().unstack().to_string().replace('\n', '\n    ').join(['    ', '']))
    w('\n## Reading\n')
    w('READING_PLACEHOLDER')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
