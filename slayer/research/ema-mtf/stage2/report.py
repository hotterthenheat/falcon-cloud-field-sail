"""reports/STAGE2.md (+ machine-readable stage2_summary.parquet) from the Stage-2 trade logs and null summaries.

    python3 -m stage2.report [--family S2C]
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.run import eval_sessions  # noqa: E402
from stage2.metrics import metrics, with_labels  # noqa: E402
from stage2.run import OUT, family  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESC = {'S2C-centre': 'centre: B 5m, no MTF, exit 3', 'S2C-entryA': 'entry A reclaim E9', 'S2C-entryC': 'entry C alignment',
        'S2C-entryD': 'entry D compression breakout', 'S2C-entryE': 'entry E MTF pullback 5->15', 'S2C-entryF': 'entry F B + VWAP',
        'S2C-entryG': 'entry G B + GEX', 'S2C-entryH': 'entry H early transition', 'S2C-mtfA': 'MTF A sequential (5,15)',
        'S2C-mtfB': 'MTF B HTF-first (5,15)', 'S2C-mtfC': 'MTF C full alignment (5,15,60)', 'S2C-mtfD': 'MTF D weighted (1..60)',
        'S2C-mtfE': 'MTF E partial (1..60)', 'S2C-mtfF': 'MTF F transition (H; 5,15)', 'S2C-exit1': 'exit 1 next EMA',
        'S2C-exit2': 'exit 2 partials', 'S2C-exit4': 'exit 4 9/20 cross', 'S2C-exit5': 'exit 5 1m structure',
        'S2C-exit6': 'exit 6 HTF loss', 'S2C-exit7': 'exit 7 ATR bracket', 'S2C-exit8': 'exit 8 fixed -20/+40',
        'S2C-exit9': 'exit 9 ATR trail', 'S2C-exit10': 'exit 10 combination', 'REF-BL3-X3': 'reference: BL3 underlying cross, exit 3'}


def load(v, d='trades'):
    ps = sorted(glob.glob(os.path.join(OUT, d, f'{v}_*.parquet')))
    return pd.concat([pd.read_parquet(p) for p in ps], ignore_index=True) if ps else pd.DataFrame()


def null_pct(v, exp) -> dict:
    ps = sorted(glob.glob(os.path.join(OUT, 'nulls', f'{v}_*.parquet')))
    if not ps:
        return {}
    n = pd.concat([pd.read_parquet(p) for p in ps], ignore_index=True)
    out = {}
    for kind, g in n.groupby('kind'):
        agg = g.groupby('seed')[['n', 'sum_ret']].sum()
        e = agg.sum_ret / agg.n.replace(0, np.nan)
        out[kind] = {'runs': len(e), 'mean': float(e.mean()), 'p95': float(e.quantile(0.95)), 'pct': float((e < exp).mean())}
    return out


def f(x, d=1):
    return 'n/a' if x is None or not np.isfinite(x) else f'{x * 100:+.{d}f}%'


def fci(c, d=1):
    return 'n/a' if c is None or not np.isfinite(c[0]) else f'[{c[0] * 100:+.{d}f}, {c[1] * 100:+.{d}f}]'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--family', default='S2C')
    a = ap.parse_args()
    vs = family(a.family)
    ses = eval_sessions()
    days = sorted(s for v in ses.values() for s in v)
    rows, L = [], []
    w = L.append
    w(f'# Stage 2 — {a.family} strategy variants on DEV (executable simulator)\n')
    w('Pre-registered: `specs/PREREG.md` §5 (frozen 7d1c06d), execution details fixed in amendment A3 (§9c) before any run. '
      'Simulator `stage2/sim.py` (trade-by-trade equal to `engine/execution.Simulator` + `engine/signals.py` exits: '
      '`etests/test_stage2.py`). Fill model L0c (bar-end NBBO + measured 2 s drift; ask in, bid out, displayed size, fees '
      '$0.65/contract/side, SPXW $1.15); L60 beside it. DEV blocks A (2024-03..05) and B (2022-03..05), '
      f'{len(days)} sessions, SPY/QQQ/IWM/SPXW, DTE buckets 0, 1-7, 8-30, 31-90, 91-200 pooled. Trade logs (every trade, '
      'rejected entries included): `v2data/ema/results/stage2/trades/<variant>_<block>_<root>.parquet`.\n')
    w('Returns are net % of premium per trade (ret_net = (proceeds − cost − fees)/(cost + entry fee)). CI = session-'
      'clustered bootstrap 95%. Null columns: share of 20 null runs (A3 item 6) whose pooled expectancy is below the '
      "variant's (time = BL2-style random entries, same count per session/bucket, same exit; side = same times, coin-flip "
      'call/put, same exit) and the null runs\' mean expectancy.\n')
    w('## Summary\n')
    w('| variant | n | rejected | expectancy net | 95% CI | gross | mid-to-mid | win | avg win | avg loss | PF | median | Sharpe/day (ann.) | Sortino (ann.) | max DD $ | net $ | ROC | hold mean/median min | max losing streak | L60 exp. | null-time mean / pct | null-side mean / pct |')
    w('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    per = {}
    for v in vs:
        t = load(v['id'])
        if not len(t):
            continue
        rej = int((t.status != 'filled').sum())
        t = with_labels(t[t.status == 'filled'])
        per[v['id']] = t
        m = metrics(t, days)
        t60 = load(v['id'], 'trades_L60')
        e60 = float(t60[t60.status == 'filled'].ret_net.mean()) if len(t60) else np.nan
        npc = null_pct(v['id'], m['expectancy'])
        nt, ns = npc.get('time', {}), npc.get('side', {})
        rows.append({'variant': v['id'], **{k: m.get(k) for k in ('n', 'expectancy', 'gross_expectancy', 'mid_expectancy', 'win_rate',
                     'avg_win', 'avg_loss', 'profit_factor', 'median', 'sharpe_ann', 'sortino_ann', 'max_dd', 'net_profit', 'roc',
                     'hold_mean', 'hold_median', 'max_losing_streak', 'sharpe_trade')}, 'ci_lo': m['ci'][0], 'ci_hi': m['ci'][1],
                     'rejected': rej, 'exp_L60': e60, 'null_time_mean': nt.get('mean'), 'null_time_pct': nt.get('pct'),
                     'null_side_mean': ns.get('mean'), 'null_side_pct': ns.get('pct')})
        w(f"| {DESC.get(v['id'], v['id'])} | {m['n']:,} | {rej} | {f(m['expectancy'], 2)} | {fci(m['ci'])} | {f(m['gross_expectancy'])} | "
          f"{f(m['mid_expectancy'])} | {m['win_rate'] * 100:.0f}% | {f(m['avg_win'])} | {f(m['avg_loss'])} | {m['profit_factor']:.2f} | "
          f"{f(m['median'])} | {m['sharpe_ann']:+.2f} | {m['sortino_ann']:+.2f} | {m['max_dd']:,.0f} | {m['net_profit']:,.0f} | "
          f"{f(m['roc'], 2)} | {m['hold_mean']:.0f}/{m['hold_median']:.0f} | {m['max_losing_streak']} | {f(e60, 2)} | "
          f"{f(nt.get('mean'), 2)} / {nt.get('pct', np.nan) * 100:.0f}% | {f(ns.get('mean'), 2)} / {ns.get('pct', np.nan) * 100:.0f}% |")
    w('')
    for col, title in (('block', 'block (regime)'), ('regime', 'day type'), ('root', 'ticker'), ('bucket', 'DTE bucket'), ('side', 'call/put')):
        keys = sorted({k for t in per.values() for k in t[col].unique()})
        w(f'## Net expectancy by {title} (n, 95% CI)\n')
        w('| variant | ' + ' | '.join(map(str, keys)) + ' |')
        w('|---|' + '---|' * len(keys))
        for v, t in per.items():
            cells = []
            for k in keys:
                g = t[t[col] == k]
                if not len(g):
                    cells.append('—')
                    continue
                m = metrics(g, days)
                cells.append(f"{f(m['expectancy'])} n={m['n']} {fci(m['ci'])}")
            w(f'| {DESC.get(v, v)} | ' + ' | '.join(cells) + ' |')
        w('')
    w('## Exit reasons (share of trades)\n')
    for v, t in per.items():
        er = t.exit_reason.str.replace(r'\+.*', '', regex=True).value_counts(normalize=True)
        w(f"* {DESC.get(v, v)}: " + ', '.join(f'{k} {x * 100:.0f}%' for k, x in er.items()))
    w('')
    w('## Costs\n')
    w('| variant | mean entry spread (% of mid) | spread cost $/trade | fees $/trade | gross $/trade | net $/trade |')
    w('|---|---|---|---|---|---|')
    for v, t in per.items():
        m = metrics(t, days, ci=False)
        w(f"| {DESC.get(v, v)} | {m['entry_spread'] * 100:.2f}% | {m['spread_cost']:.2f} | {t.fees.mean():.2f} | "
          f"{t.pnl_gross.mean():+.2f} | {t.pnl_net.mean():+.2f} |")
    w('')
    pd.DataFrame(rows).to_parquet(os.path.join(OUT, f'{a.family}_summary.parquet'))
    open(os.path.join(HERE, 'reports', 'STAGE2.md' if a.family == 'S2C' else f'STAGE2_{a.family}.md'), 'w').write('\n'.join(L) + '\n')
    print('wrote report')


if __name__ == '__main__':
    main()
