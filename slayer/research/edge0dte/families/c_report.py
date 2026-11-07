"""Write results/stage1/C.md from C.parquet and append the family's ledger lines (EDGE0DTE-S1).

  cd slayer/research/edge0dte && python3 -m families.c_report [--ledger] [--leak LOGFILE]
"""
import json
import os
import sys

import numpy as np
import pandas as pd

from families import c_micro

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTD = os.path.join(HERE, 'results', 'stage1')
LEDGER = os.path.join(HERE, '..', '..', '..', 'research-v2-ledger.md')

MECH = {
    'C1': 'unusual 0DTE call vs put volume (last 15 min / 20-session same-minute median): informed demand shows up in volume before price; Z toward the heavier side > 0',
    'C2': 'aggressive delta flow (quote-rule signed single-leg volume x delta x 100, last 15 min, standardised): buy-initiated delta forces dealers to hedge the same way / carries information; Z in flow direction > 0',
    'C3': 'near-ATM (|delta| 0.2-0.5) board size imbalance, calls minus puts: resting liquidity imbalance precedes quote moves; Z toward the imbalance > 0 at h = 15',
    'C4': 'residual ATM IV change (15-min change minus the prior-20-session spot-vol fit): option-led information; Z < 0 and ln V > 0 when the residual is up',
    'C5': '15-min change of 25-delta put minus call IV: crash-protection demand leads the index; Z < 0 when skew rises',
    'C6': 'OI_D - OI_D-1 of puts minus calls within +/-2% of the open (pre-open data): new positioning carried overnight; put build -> Z > 0 to the close (hedged dealers)',
    'C7': 'near-ATM spread/mid vs its 20-session same-minute median: wide spreads = market makers see risk; ln V > 0 when the ratio > 1.5',
    'X3': 'C2 flow incremental over prior return (z_prev30), ETF volume (ln ratio), prior RV (ln ratio) and time-of-day bucket FE: coefficient > 0',
    'X11': 'C1 unusual volume (signed event) incremental over B6 momentum (z5 and the B6 signal), ETF volume, prior return, prior RV and bucket FE: coefficient > 0',
}


def f(x, n=3, sign=True):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return '-'
    return f'{x:+.{n}f}' if sign else f'{x:.{n}f}'


def nev(r):
    """Number of signalled observations (X11: rows with a C1 event)."""
    ne = r.get('n_events', np.nan)
    return int(ne) if np.isfinite(ne) else int(r.n_obs)


def beyond(r):
    """CI excludes 0 AND the size clears the hurdle AND >= 30 signalled observations (information only)."""
    ci0 = r.ci_lo > 0 or r.ci_hi < 0
    if not ci0 or nev(r) < 30:
        return False
    if r.outcome == 'Z':
        size = r.effect_za_equiv if r.row_id in ('X3', 'X11') else r.effect
        return np.isfinite(r.hurdle_z) and abs(size) > r.hurdle_z
    cv = r.get('cond_V_minus1', np.nan)
    if not np.isfinite(cv):
        return False
    return (np.isfinite(r.hurdle_v_long) and cv > r.hurdle_v_long) or (np.isfinite(r.hurdle_v_short) and cv < r.hurdle_v_short)


def table(d):
    lines = ['| row | root | out | h | param | n obs | sess | effect | 95% CI | p | IC [95%] | exp | sign | n ev | 2020-21 (n) | 2022 (n) | 2023 (n) | hurdle | beyond |',
             '|---|---|---|---|---|---:|---:|---:|---|---:|---|---:|---|---:|---|---|---|---|---|']
    for _, r in d.iterrows():
        hur = (f'hz {f(r.hurdle_z, 2, False)}' if r.outcome == 'Z' else
               f'V-1 > {f(r.hurdle_v_long, 2)} / < {f(r.hurdle_v_short, 2)}; cond {f(r.get("cond_V_minus1", np.nan), 2)}'
               f' (uncond {f(r.get("uncond_V_minus1", np.nan), 2)})')
        if r.row_id in ('X3', 'X11'):
            hur += f'; za-eq {f(r.effect_za_equiv)}'
        ic = f'{f(r.get("ic", np.nan))} [{f(r.get("ic_lo", np.nan))}, {f(r.get("ic_hi", np.nan))}]' if np.isfinite(r.get('ic', np.nan)) else '-'
        yr = ' | '.join(f'{f(r[f"eff_{y}"])} ({int(r[f"n_{y}"])})' for y in ('2020_21', '2022', '2023'))
        lines.append(f'| {r.row_id} | {r.root} | {r.outcome} | {r.horizon} | {r.param_kind} {r.param} | {int(r.n_obs)} | '
                     f'{int(r.n_sessions)} | {f(r.effect)} | [{f(r.ci_lo)}, {f(r.ci_hi)}] | {f(r.p_value, 4, False)} | {ic} | '
                     f'{"+" if r.expected_sign > 0 else "-"} | {"as registered" if np.sign(r.effect) == r.expected_sign else "OPPOSITE"} | '
                     f'{nev(r)}{" thin" if nev(r) < 30 else ""} | {yr} | {hur} | {"YES" if beyond(r) else ""} |')
    return '\n'.join(lines)


def main():
    out = pd.read_parquet(os.path.join(OUTD, 'C.parquet'))
    sess = json.load(open(os.path.join(OUTD, 'C_sessions.json')))
    leak = ''
    if '--leak' in sys.argv:
        leak = open(sys.argv[sys.argv.index('--leak') + 1]).read().strip().splitlines()
        leak = '\n'.join(x for x in leak if x.startswith(('PASS', 'FAIL', '  ')))
    flow_sess = {}
    for r in ('SPXW', 'SPY'):
        d = sorted(x[:10] for x in os.listdir(os.path.join(c_micro.FLOW, r)) if x[:10] <= '2023-12-31')
        flow_sess[r] = d
    P = out[out.param_kind == 'P']
    G = out[out.param_kind == 'G']
    md = ['# EDGE0DTE Stage 1, family C (options microstructure): C1-C7, X3, X11 - DISCOVERY only', '',
          'Raw results. No FDR is applied here and nothing is declared passed or failed: the aggregator applies BH-FDR '
          '(q = 0.10) across all families on the SPXW primary cells. DISCOVERY = sessions <= 2023-12-31; no 2024+ outcome '
          'was computed or read (the panel rows of CALIBRATION are dropped on load). Code: `families/c_micro.py` '
          '(features, definitions in its docstring), `c_build.py`, `c_stats.py`, `c_test_leakage.py`, `c_report.py`; '
          f'definitions committed before any outcome (commit e3a39e6).', '',
          '## Statistic', '',
          '* Sign-aligned rows: value = d * (y - mu_t), y = Z_h or ln V_h, d = the registry direction (+1/-1), mu_t = mean '
          'of y at the same decision time over the rows where the feature is observable (the unconditional same-time mean). '
          'effect = mean value over signalled rows; 95% CI and two-sided p from a day-clustered bootstrap (2,000 resamples of '
          'days, lib.stats.boot_mean). `exp` = the registry sign of effect (C4/C5 Z rows predict a NEGATIVE effect).',
          '* C7 (unsigned V row): value = ln V - mu_t over event rows.',
          '* IC: Spearman rank correlation of the continuous feature with y - mu_t over the observable rows, day-clustered '
          'bootstrap CI (2,000). C1 IC uses ln(rc/rp); C6 IC uses the normalised OI change.',
          '* X3, X11: OLS of Z_h on the feature + controls with CR1 day-clustered errors (lib.stats.ols_cluster); effect = '
          'coefficient, CI = coef +/- t(G-1) se, p from the clustered t. `za-eq` = coefficient x mean |feature| (X3) or '
          'the coefficient per event (X11), the size compared with the hurdle.',
          '* Hurdle: results/HURDLE.md, root x h, bucket "all" (hz = |E[za]| for Z; E[V]-1 long / short-below for V; for V '
          'rows `cond` = mean V - 1 of the predicted-high group, compared with the hurdle). `beyond` = CI excludes 0 AND the '
          'size clears the hurdle (information only); cells with < 30 signalled observations (`n ev`, marked `thin`) are '
          'never flagged. `sign` says whether the effect has the registry sign. For V rows `uncond` = mean V - 1 over all '
          'observable rows: when it already sits beyond the short hurdle (the unconditional variance premium), a V flag '
          'mostly restates that premium rather than the feature.',
          '* Per-year columns: mean value (OLS rows: coefficient, if >= 30 sessions) and n obs, 2020-21 pooled, 2022, 2023.',
          '', '## Data and labels', '',
          '* Z, V, controls: the FOUNDATION panel (CALC). Board (1-minute NBBO snapshot with sizes): OBS; IV, delta, '
          'skew, spreads: CALC. OI: OBS (published before the open; lib.data.oi drops rows stamped >= 09:30). Flow: '
          'OBS prints, aggressor side CALC (quote rule).',
          '* C1 uses ALL kept prints (`volume`: single-leg, multi-leg, late, bad-quote). C2/X3 use the classified '
          'single-leg subset only: `vol_buy - vol_sell` (strict quote rule; at-mid prints, the Lee-Ready tick test, '
          'multi-leg (35-45% of SPXW, ~8% of SPY volume), late and bad-quote prints are excluded).',
          '* C2 delta: Black-76 from the board snapshot stamped at the END of the print\'s minute (usable at t >= that '
          'minute + 60 s, i.e. <= t for every window minute), parity call-equivalent IV interpolated in strike (flat '
          'outside the quoted band), that snapshot\'s forward and T. No look-ahead (leakage-tested).',
          f'* Flow sessions on disk and used (DISCOVERY): SPXW {len(flow_sess["SPXW"])} '
          f'({flow_sess["SPXW"][0]} .. {flow_sess["SPXW"][-1]}; 2022-05..12 and 2023; SPXW 2023-10-18 missing: the flow fetch '
          f'failed with a terminal HTTP 500), SPY {len(flow_sess["SPY"])} ({flow_sess["SPY"][0]} .. {flow_sess["SPY"][-1]}, '
          'all expected). Features that need 20 prior sessions start once >= 10 prior flow sessions exist (mid-May 2022).',
          '* "Prior 20 sessions" (C1, C2 standardisation, C4 fit, C7) = the root\'s 20 most recent earlier same-day-expiry '
          'sessions (with flow, for C1/C2), >= 10 required.',
          '', '## Mechanisms', ''] + [f'* **{k}**: {v}' for k, v in MECH.items()] + [
          '', '## Primary parameter (P) cells', '', table(P), '',
          '## Grid (G) cells - sensitivity only, never used to choose', '', table(G), '']
    hits = out[[beyond(r) for _, r in out.iterrows()]]
    md += ['## Cells with CI excluding 0 and size beyond the hurdle (DISCOVERY, raw, before FDR)', '']
    if len(hits):
        md += [table(hits), '']
    else:
        md += ['None.', '']
    md += ['## Reading (written after the results; observations, not new tests)', '',
           '* SPXW (the FDR family): no P or G cell has a CI that excludes 0 together with a size beyond its hurdle in '
           'the registered direction, apart from X11 G (C1 ratio > 5) at the close, which rests on 7 events (`thin`). '
           'SPXW cells with a CI that excludes 0 in the registered direction: C2 h = 60 (+0.020 sign-aligned Z, P; hurdle '
           '0.11) and C7 (wide spreads -> higher ln V at every horizon). The C7 conditional V - 1 stays far below the '
           'long-straddle hurdle (it lifts V from about 0.78 to about 1.00 at h = 15), so no long-gamma edge follows.',
           '* C4 V has the OPPOSITE sign on all four roots at h = 15/30/60: after an unexplained IV rise, realised '
           'variance relative to IV_atm(t)^2 is LOWER. This is at least partly mechanical: V divides by IV_atm(t)^2, so an '
           'IV jump that is not followed by realised movement lowers V (the board over-reacts and mean-reverts). It does '
           'not support the registered "option-led information" mechanism.',
           '* C2/X3 on SPY have the OPPOSITE sign at every horizon (aggressive single-leg delta buying is followed by '
           'small reversals, about -0.02 sign-aligned Z, an order of magnitude below the hurdle). SPXW C2 is positive but '
           'equally small. C1 on SPY at ratio > 2 (G) is also opposite (-0.145 at the close).',
           '* C7 on SPY is opposite at h = 15-60, driven by 2020-21; 2022 and 2023 have the registered sign.',
           '* C3, C5 and C6 show no effect on SPXW; IWM C3 is opposite (-0.019).', '']
    md += ['## N/A rows and why', '',
           '* C1, C2, X3, X11 for QQQ and IWM: no trade-flow data exists for these roots (the flow download covers SPXW '
           'and SPY only). Not imputed.',
           '* C1, C2, X3, X11 for 2020-02..2022-04 (both roots): the flow data starts 2022-05-02; the 2020-21 per-year '
           'cells are therefore empty for these rows. SPXW 2023-10-18: flow missing (fetch error).',
           '* C6 requires the D expiry\'s OI in the file published on the previous NYSE session (strict OI_{D-1}). Before '
           'daily expiries, that session usually had no OI file (OI files exist for expiry sessions only), so most '
           '2020-21 (and SPY/QQQ/IWM 2022 Tue/Thu) sessions are N/A; the counts are in the n columns.',
           '* C3 is tested at h = 15 only and C6 at h = close only (as registered). C4 and C5 need IV at t - L, so the '
           '09:45 (L = 15) and 09:45-10:00 (L = 30) decision times are N/A (the 09:30 board snapshot is empty).',
           '* X3/X11 drop decision times before 10:01 (z_prev30 needs 30 minutes of bars).', '']
    if leak:
        md += ['## Leakage test (`python3 -m families.c_test_leakage`)', '', '```', leak, '```', '']
    md += ['## Sessions used per cell (first / last / count)', '', '```', json.dumps(sess, indent=0)[:6000], '```', '']
    open(os.path.join(OUTD, 'C.md'), 'w').write('\n'.join(md))

    if '--ledger' in sys.argv:
        lines = []
        for rid in ('C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'X3', 'X11'):
            d = P[(P.row_id == rid)]
            if not len(d):
                continue
            parts = []
            for _, r in d[d.root == 'SPXW'].iterrows():
                parts.append(f'{r.outcome}{r.horizon} {f(r.effect)} [{f(r.ci_lo)}, {f(r.ci_hi)}] p {r.p_value:.3f}')
            rep = []
            for root in ('SPY', 'QQQ', 'IWM'):
                x = d[d.root == root]
                if len(x):
                    rep.append(f'{root} same sign as expected {int((np.sign(x.effect) == x.expected_sign).sum())}/{len(x)}')
            sp = d[d.root == 'SPXW']
            n = f'{int(sp.n_obs.max())} obs / {int(sp.n_sessions.max())} sess (SPXW)' if len(sp) else '-'
            lines.append(f'2026-11-07 | EDGE0DTE-S1 | {rid} (family C, P {d.param.iloc[0]}) | DISCOVERY | {n} | '
                         f'SPXW {"; ".join(parts)}; {"; ".join(rep) or "no replication root"} | '
                         f'edge0dte/results/stage1/C.md; raw, FDR by the Stage-1 aggregator; {len(d)} P cells, '
                         f'{len(out[(out.row_id == rid) & (out.param_kind == "G")])} G cells\n')
        with open(LEDGER, 'a') as fh:
            fh.writelines(lines)
        print(''.join(lines))


if __name__ == '__main__':
    main()
