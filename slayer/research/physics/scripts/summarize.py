"""Collect every pre-declared primary test from results/*.json, apply Holm-Bonferroni across all of them, and write
results/summary.md and results/primary_tests.csv.

  python3 scripts/summarize.py
"""
import csv, json, os
import numpy as np
from lib import RESULTS, holm


def load(name):
    p = os.path.join(RESULTS, name)
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    rows = []   # (indicator, symbol, test, effect, ci_lo, ci_hi, p, unit)
    intr = load('intraday.json') or {}
    for sym, r in intr.items():
        if sym == 'spillover':
            continue
        v = r['vol']
        for feat, label in [('pe', 'Permutation entropy'), ('sampen', 'Sample entropy'), ('lyap', 'Market Lyapunov'),
                            ('ph_R', 'Phase sync R (vol)')]:
            x = v.get(feat)
            if isinstance(x, dict):
                rows.append((label, sym, 'next-60m log RV, dR2 over intraday HAR', x['d_r2'] * 100, x['ci'][0] * 100, x['ci'][1] * 100, x['p'], 'pp R2'))
        vv = r.get('vol_with_relvol_base', {})
        for feat, label in [('amihud', 'Viscosity (Amihud)'), ('kyle', "Viscosity (Kyle lambda)")]:
            x = vv.get(feat)
            if isinstance(x, dict):
                rows.append((label, sym, 'next-60m log RV, dR2 over HAR + rel. volume', x['d_r2'] * 100, x['ci'][0] * 100, x['ci'][1] * 100, x['p'], 'pp R2'))
        c = r['cont']
        for feat, label in [('dfa', 'DFA / Hurst persistence'), ('pe', 'Permutation entropy (trend)')]:
            x = c[feat]
            rows.append((label, sym, 'momentum continuation, top-bottom tercile', x['spread'], x['ci'][0], x['ci'][1], x['p'], 'bps/30m'))
        x = c['dir_ph_RD']
        rows.append(('Phase synchronization', sym, 'next-30m return, top-bottom tercile', x['spread'], x['ci'][0], x['ci'][1], x['p'], 'bps/30m'))
        x = r['csd']['aug_ar1_vs_base']
        rows.append(('Critical transition (AR1 rise)', sym, 'large next-60m move, AUC gain over HAR', x['d_auc'], x['ci'][0], x['ci'][1], x['p'], 'AUC'))
        b = r['breakout']
        if isinstance(b, dict) and isinstance(b.get('esc'), dict):
            x = b['esc']['cont']
            rows.append(('Escape velocity', sym, 'breakout continuation, top-bottom tercile', x['spread'], x['ci'][0], x['ci'][1], x['p'], 'sigma/30m'))
    for pair, x in (intr.get('spillover') or {}).items():
        rows.append(('Grav. wave scanner (vol spillover)', pair, 'next-60m log RV, dR2 over own HAR', x['d_r2'] * 100, x['ci'][0] * 100, x['ci'][1] * 100, x['p'], 'pp R2'))
    hl = load('halflife.json') or {}
    for sym, r in hl.items():
        for k in ('AR1', 'HAR'):
            g = r[k]['gain_vs_MA20']
            scale = 100 / r['MA20']['mse']
            rows.append((f'Vol half-life ({k})', sym, 'next-day log RV, MSE cut vs 20-day RV', g['pct'], g['ci'][0] * scale, g['ci'][1] * scale, g['p'], '% MSE'))
    for sym in ('SPY', 'QQQ'):
        gr = load(f'gravity_{sym}.json')
        if not gr:
            continue
        x = gr['pin_well_close']
        rows.append(('Gravity well (pin to max-gamma strike)', sym, 'close distance to well minus to mirror strike', x['mean_pct'], x['ci'][0], x['ci'][1], x['p'], '% of spot'))
        x = gr['rv_given_book']['net_scaled']
        rows.append(('Net dealer gamma (vol)', sym, 'day log RV, dR2 over daily HAR + VIX', x['d_r2'] * 100, x['ci'][0] * 100, x['ci'][1] * 100, x['p'], 'pp R2'))
        x = gr['pull_dir_open_close']
        rows.append(('Gravity pull direction', sym, 'open-to-close return, top-bottom tercile', x['spread'], x['ci'][0], x['ci'][1], x['p'], 'bps/day'))
    # Bootstrap p-values floor at 1/n_boot, too coarse for Holm across ~75 tests; use the normal approximation
    # from the bootstrap CI (se = width / 3.92) for the adjustment, and keep the bootstrap p beside it.
    from math import erf, sqrt
    def pz(r):
        se = (r[5] - r[4]) / 3.92
        return 1.0 if se <= 0 else 2 * (1 - 0.5 * (1 + erf(abs(r[3]) / se / sqrt(2))))
    pzs = [pz(r) for r in rows]
    adj = holm(pzs) if rows else []
    with open(os.path.join(RESULTS, 'primary_tests.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['indicator', 'symbol', 'test', 'effect', 'ci_lo', 'ci_hi', 'p_boot', 'p_normal', 'p_holm', 'unit'])
        for r, a, z in zip(rows, adj, pzs):
            w.writerow([r[0], r[1], r[2], f'{r[3]:.4g}', f'{r[4]:.4g}', f'{r[5]:.4g}', f'{r[6]:.4f}', f'{z:.2e}', f'{a:.4f}', r[7]])
    with open(os.path.join(RESULTS, 'summary.md'), 'w') as f:
        f.write(f'# Primary tests ({len(rows)}), Holm-adjusted across all of them\n\n')
        f.write('p boot = day-block bootstrap (floors at 1/n); p Holm = Holm-Bonferroni on the normal-approximation p from the bootstrap CI.\n\n')
        f.write('| indicator | symbol | test | effect [95% CI] | unit | p boot | p Holm | survives |\n|---|---|---|---|---|---|---|---|\n')
        for r, a in zip(rows, adj):
            f.write(f'| {r[0]} | {r[1]} | {r[2]} | {r[3]:+.3g} [{r[4]:+.3g}, {r[5]:+.3g}] | {r[7]} | {r[6]:.3f} | {a:.3g} | {"yes" if a < 0.05 else ""} |\n')
    print(open(os.path.join(RESULTS, 'summary.md')).read())


if __name__ == '__main__':
    main()
