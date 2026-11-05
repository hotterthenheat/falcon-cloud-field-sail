"""Run the three pre-registered baselines (ledger @ 6e280f9) on the stored DEV sessions, plus the null calibration.

    python3 -m baselines.run [--sessions @data/sessions_dev20.txt] [--nulls 100] [--synth 20]

Writes baselines/BASELINES.md (numbers) and baselines/trades.csv.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd

from baselines.strategies import BASELINES, bracket
from data.splits import assert_split
from data.store import Session, list_sessions
from eval.metrics import classify_session, fmt_report, ledger_trials, passes_bar, summarize
from eval.nulls import entries_from_trades, pass_rates, shuffled_runs, synthetic_runs
from eval.report import md_table
from sim.engine import Engine, SimConfig, fmt_ms

HERE = os.path.dirname(os.path.abspath(__file__))


def rep_row(name, tr, days, N, regimes):
    out = []
    for ret, lab in (('ret_net', 'net of $0.65/contract/side'), ('ret_gross', 'no fee (spread only)')):
        r = summarize(tr, days, ret=ret, n_trials=N, regimes=regimes)
        if not r.get('n'):
            out.append({'baseline': name, 'costs': lab, 'n': 0})
            continue
        out.append({'baseline': name, 'costs': lab, 'n': r['n'], 'expectancy': f"{r['expectancy']*100:+.1f}%",
                    '95% CI (session bootstrap)': f"[{r['ci_expectancy'][0]*100:+.1f}, {r['ci_expectancy'][1]*100:+.1f}]",
                    'win': f"{r['win_rate']*100:.0f}%", 'payoff': f"{r['payoff']:.2f}",
                    '$/trade': f"{(r['pnl_net_per_trade'] if ret == 'ret_net' else r['pnl_gross_per_trade']):+.0f}",
                    'Sharpe/trade': f"{r['sharpe_trade']:.2f}", 'Sharpe/day': f"{r['sharpe_day']:.2f}",
                    'maxDD $': f"{r['max_dd_dollars']:.0f}", 'DSR': f"{r['dsr_dsr']:.2f}",
                    'bar': 'PASS' if passes_bar(r)['pass'] else 'fail'})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sessions', default='@' + os.path.join(os.path.dirname(HERE), 'data', 'sessions_dev20.txt'))
    ap.add_argument('--nulls', type=int, default=100)
    ap.add_argument('--synth', type=int, default=20)
    a = ap.parse_args()
    days = open(a.sessions[1:]).read().split() if a.sessions.startswith('@') else a.sessions.split(',')
    days = [d for d in days if d in set(list_sessions())]
    assert_split(days, 'DEV')
    N = ledger_trials()
    t0 = time.time()
    trades, regimes = [], []
    for d in days:
        s = Session(d)
        regimes.append(classify_session(s))
        for name, cls in BASELINES.items():
            for r in Engine(s, cls(), SimConfig()).run():
                r['baseline'] = name
                trades.append(r)
        del s
        print(d, 'done', f'{time.time()-t0:.0f}s', flush=True)
    tr = pd.DataFrame(trades)
    reg = pd.DataFrame(regimes)
    tr.drop(columns=['meta']).to_csv(os.path.join(HERE, 'trades.csv'), index=False)

    rows, by_reg = [], []
    for name in BASELINES:
        t = tr[tr.baseline == name]
        rows += rep_row(name, t, days, N, reg)
        r = summarize(t, days, ret='ret_net', n_trials=N, regimes=reg)
        for k, v in (r.get('by_year') or {}).items():
            by_reg.append({'baseline': name, 'split': f'year {k}', 'n': v['n'], 'expectancy': f"{v['expectancy']*100:+.1f}%",
                           'win': f"{v['win_rate']*100:.0f}%"})
        for k, v in (r.get('by_regime') or {}).items():
            by_reg.append({'baseline': name, 'split': f'day {k}', 'n': v['n'], 'expectancy': f"{v['expectancy']*100:+.1f}%",
                           'win': f"{v['win_rate']*100:.0f}%"})
        by_root = t.assign(root=t.legs.str.split().str[0]).groupby('root').ret_net.agg(['count', 'mean'])
        for k, v in by_root.iterrows():
            by_reg.append({'baseline': name, 'split': f'root {k}', 'n': int(v['count']), 'expectancy': f"{v['mean']*100:+.1f}%",
                           'win': f"{(t[t.legs.str.startswith(k + ' ')].ret_net > 0).mean()*100:.0f}%"})
    cost = tr.assign(spread_pct=(tr.entry_ask - tr.entry_bid) / ((tr.entry_ask + tr.entry_bid) / 2),
                     fee_pct=tr.fees / (tr.entry_px * tr.qty * 100))
    reasons = tr.groupby(['baseline', 'reason']).size().unstack(fill_value=0)

    # ---- null calibration
    print('nulls...', flush=True)
    nulls = {}
    seeds = list(range(a.nulls))
    b3 = tr[tr.baseline == 'B3_first15_side']
    ent = entries_from_trades(b3)
    sh = shuffled_runs(Session, days, ent, bracket, seeds, mode='keep_times')
    nulls['shuffled side, B3 times kept'] = pass_rates(sh, days, N, candidate_expectancy=b3.ret_net.mean())
    sh2 = shuffled_runs(Session, days, ent, bracket, seeds, mode='resample_times')
    nulls['shuffled side, B3 times resampled'] = pass_rates(sh2, days, N, candidate_expectancy=b3.ret_net.mean())
    print('synthetic...', flush=True)
    syn = synthetic_runs(Session, days, BASELINES, list(range(a.synth)), iv_mode='rv')
    for name in BASELINES:
        nulls[f'synthetic zero-drift (fair IV), {name}'] = pass_rates({k: v for k, v in syn.items() if k[0] == name}, days, N,
                                                                      candidate_expectancy=tr[tr.baseline == name].ret_net.mean())
    nulls['synthetic zero-drift (fair IV), all three'] = pass_rates(syn, days, N)

    L = ['# Baselines: what "no edge" looks like after real costs', '',
         f'Pre-registered in the ledger (FOUNDATION, compass-v2/baselines/strategies.py @ 6e280f9). {len(days)} DEV sessions '
         f'({min(days)}..{max(days)}), roots SPXW/SPY/QQQ, 0DTE only (a root with no same-day expiry that session is skipped). '
         'Execution: decision -> +2 s latency -> ask in force (capped at displayed size); exits at the bid in force 2 s after '
         'the trigger; fee $0.65/contract/side. Trial count for the deflated Sharpe: '
         f'{N} (ledger).', '',
         md_table(pd.DataFrame(rows)), '',
         '**Splits (net returns)**', '', md_table(pd.DataFrame(by_reg)), '',
         '**Exit reasons**', '', md_table(reasons.reset_index()), '',
         '**Cost at entry** (median): ' + ', '.join(
             f"{n}: spread {g.spread_pct.median()*100:.1f}% of mid, fee {g.fee_pct.median()*100:.1f}% of premium"
             for n, g in cost.groupby('baseline')), '',
         '**Session labels** (eval.metrics.classify_session, fixed rules): ' + ', '.join(
             f"{r.session} {r.label}" for r in reg.itertuples()), '',
         '## Null calibration (protocol rule 11)', '',
         f'Each null run is scored exactly like a candidate (same summarize/passes_bar, N={N}). "stat bar" = the protocol bar '
         'without the >=150-trade and 2-regime tests (which no 20-session run can meet); "CI only" = the session-bootstrap '
         '95% CI of the expectancy excludes 0 (one-sided ~2.5% expected under the null). The pipeline is valid if <= 5% of '
         'null runs pass.', '']
    nt = []
    for k, v in nulls.items():
        nt.append({'null': k, 'runs': v['n_runs'], 'pass full bar': f"{v['pass_rate_full_bar']*100:.1f}%",
                   'pass stat bar': f"{v['pass_rate_stat_bar']*100:.1f}%", 'CI>0 only': f"{v['pass_rate_ci_only']*100:.1f}%",
                   'null expectancy mean [p5, p95]': f"{v['null_expectancy_mean']*100:+.1f}% [{v['null_expectancy_p5']*100:+.1f}, {v['null_expectancy_p95']*100:+.1f}]",
                   'real baseline beats': (f"{v['candidate_beats_share']*100:.0f}% of nulls" if 'candidate_beats_share' in v else ''),
                   'valid': 'yes' if v['valid_pipeline'] else 'NO'})
    L += [md_table(pd.DataFrame(nt)), '']
    L += [f'Run time {time.time()-t0:.0f}s.']
    open(os.path.join(HERE, 'BASELINES.md'), 'w').write('\n'.join(L) + '\n')
    json.dump({k: {kk: vv for kk, vv in v.items()} for k, v in nulls.items()}, open(os.path.join(HERE, 'nulls.json'), 'w'), indent=1)
    print('\n'.join(L))


if __name__ == '__main__':
    sys.exit(main())
