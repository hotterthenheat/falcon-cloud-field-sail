"""reports/STAGE3.md (walk-forward, PBO, DSR, the section-7 DEV bar, and any sensitivity/ablation run) and
reports/FAILED_EXPERIMENTS.md (every Stage-1 test and Stage-2/3 variant that failed, with its numbers).

    python3 -m stage3.report
"""
from __future__ import annotations

import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from edata.common import EMA_DATA  # noqa: E402
from stage2.metrics import by, metrics, with_labels  # noqa: E402
from stage1.md import md  # noqa: E402
from stage2.report import DESC, f, fci  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S3 = os.path.join(EMA_DATA, 'results', 'stage3')


def stage3_md(fam='S2C') -> str:
    w = []
    W = w.append
    R = pickle.load(open(os.path.join(S3, f'wf_{fam}.pkl'), 'rb'))
    oos = with_labels(pd.read_parquet(os.path.join(S3, f'wf_{fam}_oos.parquet')))
    days = R['test_days']
    bar = R['bar']
    m = bar['metrics']
    W(f'# Stage 3 — walk-forward, PBO, DSR and the §7 DEV bar ({fam} family)\n')
    W('Pre-registered: PREREG §6–§7 (frozen 7d1c06d), selection rule fixed in amendment A3 item 10. Code '
      '`stage3/wf.py` (selection on the Stage-2 trade logs: the OOS trades ARE Stage-2 trades of the chosen variant in '
      'the test month, same simulator), `stage3/robust.py` (sensitivity, ablation). OOS trade log: '
      f'`v2data/ema/results/stage3/wf_{fam}_oos.parquet`.\n')
    W('## Walk-forward folds (anchored, ≥ 2 train months, 1-session embargo)\n')
    W(md(R['chosen'].assign(chosen=R['chosen'].chosen.map(lambda x: f'{x} ({DESC.get(x, x)})'),
                         train_exp=R['chosen'].train_exp.map(lambda x: f(x, 2)),
                         test_exp=R['chosen'].test_exp.map(lambda x: f(x, 2))), index=False) + '\n')
    W('## Concatenated out-of-sample result\n')
    if m.get('n'):
        W(f"n = {m['n']}, expectancy net **{f(m['expectancy'], 2)}** {fci(m['ci'])} (gross {f(m['gross_expectancy'])}, mid-to-mid "
          f"{f(m['mid_expectancy'])}), win {m['win_rate'] * 100:.0f}% {fci(m['ci_win'], 0)}, avg win {f(m['avg_win'])}, avg loss "
          f"{f(m['avg_loss'])}, profit factor {m['profit_factor']:.2f}, net ${m['net_profit']:,.0f}, return on premium {f(m['roc'], 2)}, "
          f"max DD ${m['max_dd']:,.0f}, Sharpe/day ann. {m['sharpe_ann']:+.2f}, Sortino ann. {m['sortino_ann']:+.2f}, hold "
          f"{m['hold_mean']:.0f}/{m['hold_median']:.0f} min (mean/median), max losing streak {m['max_losing_streak']}, mean entry "
          f"spread {m['entry_spread'] * 100:.2f}% of mid, spread cost ${m['spread_cost']:.2f}/trade, fees ${oos.fees.mean():.2f}/trade.\n")
        for col, title in (('root', 'ticker'), ('bucket', 'DTE'), ('side', 'call/put'), ('regime', 'day type'), ('block', 'block')):
            W(f'OOS by {title}: ' + '; '.join(f"{k} {f(v['expectancy'])} n={v['n']} {fci(v.get('ci'))}" for k, v in by(oos, col, days).items()) + '\n')
    W(f"**PBO** (CSCV, 16 blocks, sessions × {fam} variants): {R['pbo'].get('pbo', float('nan')):.2f}. "
      f"**DSR** of the OOS per-trade Sharpe at N = {R['n_trials']} ledger trials: {bar['dsr'].get('dsr', float('nan')):.3f} "
      f"(benchmark SR0 {bar['dsr'].get('sr0', float('nan')):.3f}, observed {m.get('sharpe_trade', float('nan')):.3f}).\n")
    W('## §7 DEV promotion bar\n')
    W('| test | result |')
    W('|---|---|')
    for k, v in bar['tests'].items():
        W(f'| {k} | {"PASS" if v else "fail"} |')
    W('')
    extra = os.path.join(S3, f'robust_{fam}.json')
    if os.path.exists(extra):
        rob = json.load(open(extra))
        W('## Sensitivity and ablation\n')
        W(rob.get('note', '') + '\n')
        for vid, block in rob.get('variants', {}).items():
            W(f"### {vid} ({DESC.get(vid, vid)}) — base expectancy {f(block['base'], 2)} (n={block['base_n']})\n")
            W('| look | n | expectancy net | 95% CI | Δ vs base (paired, pp) [CI] | neighbour |')
            W('|---|---|---|---|---|---|')
            for k, s in block['looks'].items():
                W(f"| {k} | {s['n']} | {f(s['exp'], 2)} | {fci(s.get('ci'))} | {f(s.get('delta'), 2)} {fci(s.get('delta_ci'))} | "
                  f"{'yes' if s.get('neighbour') else ''} |")
            sv = block.get('survival', {})
            W(f"\nSurvival rule: slip1 > 0 {sv.get('slip1_gt_0')}, L60 > 0 {sv.get('L60_gt_0')}, neighbours positive "
              f"{sv.get('neighbours_pos_share', float('nan')) * 100:.0f}% (≥ 70% needed) → **{'survives' if sv.get('survives') else 'does not survive'}**.\n")
    return '\n'.join(w) + '\n'


def failed_md() -> str:
    w = []
    W = w.append
    W('# Failed experiments — every test and variant that did not pass, with its numbers\n')
    W('Nothing here was dropped from the record: every Stage-1 test, every Stage-2 variant (winners and losers, every '
      'trade in its log), and every Stage-3 look is listed with its result and its ledger line (research-v2-ledger.md, '
      'worker EMA). Trade logs and event tables: `v2data/ema/results/` (stage1/, stage2/trades*, stage2/nulls, stage3/).\n')
    p1 = os.path.join(EMA_DATA, 'results', 'stage1', 's1_results.pkl')
    if os.path.exists(p1):
        res = pickle.load(open(p1, 'rb'))
        W('## Stage 1 — S1A features that failed (40 tests)\n')
        W('| feature @ tf | δ Y30 (pp) | 95% CI | Holm p | rules failed | reprice δ* |')
        W('|---|---|---|---|---|---|')
        for r in res['s1a']:
            if not r['pass']:
                W(f"| {r['feature']} @ {r['tf']}m | {f(r['Y30']['delta'], 2)} | {fci(r['Y30']['ci'], 2)} | {r['holm']:.3g} | "
                  f"{', '.join(k for k, v in r['rules'].items() if not v)} | {f(r['reprice']['delta'], 2)} |")
        W('\n## Stage 1 — S1B timeframe coefficients\n')
        b = res['s1b']
        for i, tf in enumerate((1, 5, 15, 30, 60)):
            W(f"* option {tf}m state: β {f(b['beta'][i], 3)}/unit, one-sided p {b['p'][i]:.3g}, Holm {b['holm'][i]:.3g} → "
              f"{'pass' if (b['holm'][i] < 0.05 and b['beta'][i] > 0) else 'FAIL'}")
        W('\n## Stage 1 — S1C confirmations that failed (14 tests)\n')
        W('| confirmation | δ Y30 (pp) | 95% CI | Holm p | rules failed |')
        W('|---|---|---|---|---|')
        for r in res['s1c']:
            if not r['pass']:
                W(f"| {r['label']} | {f(r['Y30']['delta'], 2)} | {fci(r['Y30']['ci'], 2)} | {r['holm']:.3g} | "
                  f"{', '.join(k for k, v in r['rules'].items() if not v)} |")
    p2 = os.path.join(EMA_DATA, 'results', 'stage2', 'S2C_summary.parquet')
    if os.path.exists(p2):
        s = pd.read_parquet(p2)
        W('\n## Stage 2-C — variants (none is a candidate unless its CI is > 0; all are listed)\n')
        W('| variant | n | expectancy net | 95% CI | win | L60 | null-time pct | null-side pct | status |')
        W('|---|---|---|---|---|---|---|---|---|')
        for _, r in s.iterrows():
            st = 'reference' if r.variant.startswith('REF') else ('CI > 0 (goes to Stage 3 selection)' if r.ci_lo > 0 else 'FAILED: CI includes or is below 0')
            W(f"| {DESC.get(r.variant, r.variant)} | {int(r.n)} | {f(r.expectancy, 2)} | [{r.ci_lo * 100:+.1f}, {r.ci_hi * 100:+.1f}] | "
              f"{r.win_rate * 100:.0f}% | {f(r.exp_L60, 2)} | {r.null_time_pct * 100 if r.null_time_pct == r.null_time_pct else float('nan'):.0f}% | "
              f"{r.null_side_pct * 100 if r.null_side_pct == r.null_side_pct else float('nan'):.0f}% | {st} |")
    p3 = os.path.join(S3, 'wf_S2C.pkl')
    if os.path.exists(p3):
        R = pickle.load(open(p3, 'rb'))
        t = R['bar']['tests']
        W('\n## Stage 3 — the walk-forward result against the §7 bar\n')
        W('Failed tests: ' + (', '.join(k for k, v in t.items() if not v and k != 'pass') or 'none') + '.\n')
    return '\n'.join(w) + '\n'


def main():
    if os.path.exists(os.path.join(S3, 'wf_S2C.pkl')):
        open(os.path.join(HERE, 'reports', 'STAGE3.md'), 'w').write(stage3_md())
    open(os.path.join(HERE, 'reports', 'FAILED_EXPERIMENTS.md'), 'w').write(failed_md())
    print('wrote reports')


if __name__ == '__main__':
    main()
