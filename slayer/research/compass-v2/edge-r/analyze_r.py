"""EDGE-R analysis: R0/R1/R2 tables, shuffle null, synthetic null (from synth_r.py), PBO/DSR -> results/DEV.md, summary.json."""
import glob
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from eval.metrics import basic, cluster_ci_mean, deflated_sharpe, ledger_trials, pbo_cscv  # noqa: E402
import rmodel as M  # noqa: E402

RES = os.path.join(M.OUT, 'res')
OUTD = os.path.join(HERE, 'results')
VARS = ('R0', 'R1', 'R2')


def load():
    rows, days = [], []
    for f in sorted(glob.glob(os.path.join(RES, '*.json'))):
        r = json.load(open(f))
        if M.F.is_locked(r['day']) or r['day'] >= '2025-01-01':
            raise AssertionError('non-DEV day in results')
        o, c = r.get('spx_o'), r.get('spx_c')
        mv = (c / o - 1) if (o and c) else np.nan
        days.append({'day': r['day'], 'spx_move': mv, 'src_spy': r['src'].get('SPY')})
        for t in r['trades']:
            t['spx_move'] = mv
            rows.append(t)
    return pd.DataFrame(rows), pd.DataFrame(days)


def daytype(mv):
    a = abs(mv)
    if not np.isfinite(a):
        return 'na'
    return '<0.5%' if a < 0.005 else ('0.5-1.5%' if a <= 0.015 else '>1.5%')


def stats_of(x, days, col='leg_ret_net'):
    b = basic(x[col].values)
    if b['n'] == 0:
        return {'n': 0}
    lo, hi = cluster_ci_mean(x[col].values, x['day'].values, extra_clusters=days)
    g = basic(x['leg_ret_gross'].values)
    return {'n': b['n'], 'win': b['win_rate'], 'exp': b['expectancy'], 'lo': lo, 'hi': hi, 'gross': g['expectancy'],
            'payoff': b['payoff'], 'usd': float(x['leg_pnl_net'].sum()), 'usd_gross': float(x['leg_pnl_gross'].sum()),
            'median': b['median'], 'sharpe': b['sharpe_trade'], 'skew': b['skew'], 'kurt': b['kurt']}


def fmt(s):
    if not s or s.get('n', 0) == 0:
        return '| 0 | | | | | | |'
    return (f"| {s['n']} | {s['win']*100:.0f}% | {s['exp']*100:+.1f}% [{s['lo']*100:+.1f}, {s['hi']*100:+.1f}] | "
            f"{s['gross']*100:+.1f}% | {s['payoff']:.2f} | ${s['usd']:,.0f} |")


def shuffle_null(x, days, n=200, seed=11):
    """Same entries and exit instants, side by coin; the opposite side priced on its own quotes. Trades whose
    opposite pick or fill is missing keep their real side in every draw (reported)."""
    have = x['opp_ret_net'].notna().values if 'opp_ret_net' in x else np.zeros(len(x), bool)
    real = x['leg_ret_net'].values
    opp = np.where(have, x['opp_ret_net'].values if 'opp_ret_net' in x else real, real)
    rng = np.random.default_rng(seed)
    means, passes = [], 0
    for _ in range(n):
        flip = rng.random(len(x)) < 0.5
        r = np.where(flip & have, opp, real)
        means.append(r.mean())
        lo, _ = cluster_ci_mean(r, x['day'].values, n_boot=500, extra_clusters=days)
        passes += lo > 0
    means = np.array(means)
    return {'beats': float((real.mean() > means).mean()), 'null_mean': float(means.mean()),
            'null_p95': float(np.percentile(means, 95)), 'fdr': passes / n, 'opp_share': float(have.mean())}


def main():
    df, dd = load()
    days = list(dd.day)
    os.makedirs(OUTD, exist_ok=True)
    df['year'] = df.day.str[:4]
    df['dtype'] = df.spx_move.map(daytype)
    dd['dtype'] = dd.spx_move.map(daytype)
    df['pre'] = df.dec_s < M.OPEN_S + 60
    tr = df[df.leg_ret_net.notna()].copy()
    syn = json.load(open(os.path.join(OUTD, 'synthetic_null.json'))) if os.path.exists(os.path.join(OUTD, 'synthetic_null.json')) else {}
    N = ledger_trials()
    out = {'sessions': len(days), 'ledger_trials': N, 'variants': {}}
    L = [f'# EDGE-R DEV results ({len(days)} sessions, seeded random order of {len(M.dev_days())} DEV sessions)', '',
         'Net of $0.65/side; 95% session-clustered bootstrap CI (sessions with no trade included). win = net return > 0.',
         f'SPY/QQQ bar source: {dict(dd.src_spy.value_counts())}', '',
         '| variant | n | win | exp net [95%] | gross | payoff | $ net (1 lot) | shuffle beats / FDR | synthetic beats / FDR | DSR |',
         '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    permat = {}
    for v in VARS:
        x = tr[tr.variant == v]
        s = stats_of(x, days)
        sh = shuffle_null(x, days) if len(x) else {}
        sy = syn.get(v, {})
        if s.get('n'):
            sy_beats = (s['exp'] > np.array(sy['means'])).mean() if sy.get('means') else float('nan')
            ds = deflated_sharpe(s['sharpe'], s['n'], N, skew=s['skew'], kurt=s['kurt'])
        else:
            sy_beats, ds = float('nan'), {'dsr': float('nan')}
        out['variants'][v] = {**s, 'shuffle': sh, 'synthetic': {k: sy.get(k) for k in ('mean', 'p95', 'fdr', 'runs')},
                              'synthetic_beats': sy_beats, 'dsr': ds['dsr'], 'n_tickets': int((df.variant == v).sum()),
                              'skips': {str(k): int(c) for k, c in df[df.variant == v].leg_skip.value_counts().items()}
                              if 'leg_skip' in df else {}}
        L.append(f'| {v} ' + fmt(s) + f" {sh.get('beats', float('nan'))*100:.0f}% / {sh.get('fdr', float('nan'))*100:.1f}% | "
                 f"{sy_beats*100:.0f}% / {(sy.get('fdr') or float('nan'))*100:.1f}% | {ds['dsr']:.3f} |")
        permat[v] = x.groupby('day').leg_ret_net.mean().reindex(sorted(days)).fillna(0.0)
    Mx = np.column_stack([permat[v].values for v in VARS])
    pb = pbo_cscv(Mx, 16)
    out['pbo'] = pb.get('pbo')
    L += ['', f"PBO (CSCV, 16 blocks, R0/R1/R2 per-session mean net return): {pb.get('pbo'):.2f}. DSR at N = {N} ledger trials.", '']
    for v in VARS:
        x = tr[tr.variant == v]
        L += [f'## {v}', '', '| cut | n | win | exp net [95%] | gross | payoff | $ net |', '|---|---:|---:|---:|---:|---:|---:|']
        for name, col in (('year', 'year'), ('SPX day move', 'dtype'), ('ticker', 'tk'), ('book', 'book'), ('side', 'side'),
                          ('exit', 'leg_why'), ('pre-open decision', 'pre')):
            for key, g in x.groupby(col):
                dsub = list(dd[dd.dtype == key].day) if col == 'dtype' else (
                    [d for d in days if d[:4] == key] if col == 'year' else days)
                L.append(f'| {name}: {key} ' + fmt(stats_of(g, dsub)))
        out['variants'][v]['by_year'] = {k: stats_of(g, [d for d in days if d[:4] == k]) for k, g in x.groupby('year')}
        out['variants'][v]['by_daytype'] = {k: stats_of(g, list(dd[dd.dtype == k].day)) for k, g in x.groupby('dtype')}
        out['variants'][v]['by_tk'] = {k: stats_of(g, days) for k, g in x.groupby('tk')}
        out['variants'][v]['by_side'] = {k: stats_of(g, days) for k, g in x.groupby('side')}
        out['variants'][v]['by_why'] = {k: stats_of(g, days) for k, g in x.groupby('leg_why')}
        out['variants'][v]['by_book'] = {k: stats_of(g, days) for k, g in x.groupby('book')}
        out['variants'][v]['by_pre'] = {str(k): stats_of(g, days) for k, g in x.groupby('pre')}
        L.append('')
    # live accounting vs real fills (R0)
    x = tr[(tr.variant == 'R0') & tr.leg_live_exit.notna()] if 'leg_live_exit' in tr else tr.iloc[:0]
    if len(x):
        live = (x.leg_live_exit - x.board_ask) / x.board_ask
        real = x.leg_ret_gross
        gap = live - real
        lo, hi = cluster_ci_mean(gap.values, x.day.values)
        out['live_gap'] = {'n': len(x), 'live_gross': float(live.mean()), 'real_gross': float(real.mean()),
                           'gap': float(gap.mean()), 'lo': lo, 'hi': hi,
                           'entry_slip': float(((x.leg_fill - x.board_ask) / x.board_ask).mean())}
        L += ['## Live accounting vs real fills (R0, gross)', '',
              f'Live ledger pricing (board ask at the decision, bid at the START of the exit bar) vs ask at +2 s / bid at '
              f'exit decision +2 s: n {len(x)}, live {live.mean()*100:+.1f}% vs real {real.mean()*100:+.1f}% per trade; '
              f'gap {gap.mean()*100:+.1f} pts [{lo*100:+.1f}, {hi*100:+.1f}]; entry slip (ask +2 s vs board ask) '
              f'{out["live_gap"]["entry_slip"]*100:+.2f}%.', '']
    # trades per session and seat use
    for v in VARS:
        c = df[df.variant == v].groupby('day').size().reindex(days, fill_value=0)
        out['variants'][v]['per_session'] = {'mean': float(c.mean()), 'max': int(c.max()), 'zero': int((c == 0).sum())}
    L += ['## Tickets per session', ''] + [f"- {v}: mean {out['variants'][v]['per_session']['mean']:.1f}, max "
                                           f"{out['variants'][v]['per_session']['max']}, zero-ticket sessions "
                                           f"{out['variants'][v]['per_session']['zero']}" for v in VARS] + ['']
    open(os.path.join(OUTD, 'DEV.md'), 'w').write('\n'.join(L) + '\n')
    json.dump(out, open(os.path.join(OUTD, 'summary.json'), 'w'), indent=1, default=float)
    print('\n'.join(L[:16]))


if __name__ == '__main__':
    main()
