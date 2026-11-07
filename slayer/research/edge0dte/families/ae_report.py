"""Write results/stage1/AE.md and the ledger lines from results/stage1/AE.parquet (families.ae_stage1).

  cd slayer/research/edge0dte && python3 -m families.ae_report [--ledger]
"""
import datetime
import json
import os
import sys

import numpy as np
import pandas as pd

from families.ae_stage1 import AE, RES

LEDGER = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'research-v2-ledger.md')
ROOTS = ['SPXW', 'SPY', 'QQQ', 'IWM']
ORDER = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'E1', 'E2', 'E3', 'E4', 'X4', 'X7', 'X8', 'X9', 'X10']
HO = {'15': 0, '30': 1, '60': 2, 'close': 3}

MECH = {
    'A1': ('total GEX sign at 09:45 (same-day OI)', 'long-gamma dealers damp, short-gamma dealers amplify',
           'V: ln V(GEX<0) - ln V(GEX>0) > 0 at every grid time of the session; Z: prior-30-min direction continues '
           'when GEX<0 and reverts when GEX>0 (one test, s = sign(z_prev30) x -sign(GEX))'),
    'A2': ('|S - flip| / (S sigma_close) < 0.5', 'hedge convexity largest near the flip',
           'V: ln V above the same-bucket unconditional mean; a session time with no flip inside +/-3 sigma_close counts '
           'as far (|dist| = 3)'),
    'A3': ('5-min close on the other side of the flip than the previous 5-min close (flip recomputed at each)',
           'regime switch at the flip', 'Z in the crossing direction > 0'),
    'A4': ('within 0.5 sigma_30 of the call wall (above S) or put wall (below S); nearer wall if both',
           'hedging concentrates at the wall: approach stalls', 'Z toward the wall < 0'),
    'A5': ('Herfindahl of |GEX(K)| within +/-2 sigma_close, top tercile vs the prior 20 sessions (same bucket)',
           'concentrated long gamma pins', 'ln V < 0'),
    'A6': ('GEX(S_t) - GEX(S_09:45) with the table at t, as a fraction of gross |GEX|, scaled by its PIT RMS; < -1',
           'walking into short gamma raises RV the board has not repriced', 'ln V > 0'),
    'A7': ('t >= 14:00: direction to the largest-|GEX| strike within 1 sigma_close', 'expiry-day pinning',
           'Z_close toward it > 0'),
    'E1': ('sign of charm hedge flow t->close (shares dealers must buy), t >= 13:00', 'decaying OTM delta unwinds hedges',
           'Z_close in its sign > 0'),
    'E2': ('sign of the vanna hedge flow of the last 30-min IV_atm change', 'IV change moves dealer delta',
           'Z_30, Z_60 in its sign > 0'),
    'E3': ('sign of -Gamma_dealer x dS(15 min)', 'dealers trade with (short gamma) or against (long gamma) the move',
           'Z in its sign > 0, incremental over the prior-15-min Z (OLS, day-clustered: p from the OLS)'),
    'E4': ('sign of H = E1 + E2 + E3 (shares)', 'the sum is what dealers must trade', 'Z in sign(H) > 0; IC > 0'),
    'X4': ('B7 first-30-min return incl. gap -> last-30-min Z, by GEX(09:45) sign', 'short-gamma hedging amplifies '
           'late-day momentum', 'effect(GEX<0) - effect(GEX>0) > 0'),
    'X7': ('D4 IV^2/RV60 lowest PIT tercile, by GEX(09:45) sign', 'cheap implied + short gamma',
           'ln V(GEX<0) - ln V(GEX>0) > 0'),
    'X8': ('A7 pin, by GEX(09:45) sign', 'pinning needs long gamma', 'effect(GEX>0) - effect(GEX<0) > 0'),
    'X9': ('D1 RV30 / prior-20-session same-time median > 2, by GEX(09:45) sign', 'RV expansion persists under short '
           'gamma', 'ln V(GEX<0) - ln V(GEX>0) > 0'),
    'X10': ('E1 charm drift, by GEX(09:45) sign', 'charm unwind is a long-gamma afternoon effect',
            'effect(GEX>0) - effect(GEX<0) > 0'),
}


def f(x, k=3, sign=True):
    if x is None or not np.isfinite(x):
        return '-'
    return f'{x:+.{k}f}' if sign else f'{x:.{k}f}'


def ci(r):
    return f"{f(r.effect)} [{f(r.ci_lo)}, {f(r.ci_hi)}]"


def years(r):
    return ' / '.join(f"{f(r[f'eff_{y}'], 2)} ({int(r[f'sess_{y}']) if np.isfinite(r[f'sess_{y}']) else 0})"
                      for y in ('2020-21', '2022', '2023'))


def hurdle(r):
    if r.outcome == 'Z':
        return f"{f(r.hz_all, 2, False)} (bkt {f(r.hz_bucket, 2, False)})"
    return f"{f(r.hv_long_all, 2)} / {f(r.hv_short_all, 2)}"


def ics(r):
    if not np.isfinite(r.ic):
        return '-'
    return f"{f(r.ic)} [{f(r.ic_lo)}, {f(r.ic_hi)}] (exp {'+' if r.ic_expected_sign > 0 else '-'})"


def table(d, cols_root=True):
    lines = ['| row | out | h | param | root | n obs | sess | effect [95% CI] | p | exp | IC [95% CI] | 2020-21 / 2022 / 2023 '
             '(sess) | cond raw | hurdle | CI excl 0 | beyond hurdle |',
             '|---|---|---|---|---|---:|---:|---|---:|:-:|---|---|---:|---|:-:|:-:|']
    for _, r in d.iterrows():
        lines.append(f"| {r.row_id} | {r.outcome} | {r.horizon} | {r.param} | {r.root} | {int(r.n_obs)} | {int(r.n_sessions)} | "
                     f"{ci(r)} | {r.p_value:.4f}{' (OLS)' if r.p_method.startswith('ols') else ''} | {'+' if r.expected_sign > 0 else '-'} | "
                     f"{ics(r)} | {years(r)} | {f(r.cond_raw)} | {hurdle(r)} | {'yes' if r.ci_excl_0 else ''} | "
                     f"{'yes' if r.beyond_hurdle else ''} |")
    return '\n'.join(lines)


def sort(d):
    d = d.copy()
    d['_o'] = d.row_id.map({k: i for i, k in enumerate(ORDER)})
    d['_h'] = d.horizon.map(HO)
    d['_r'] = d.root.map({k: i for i, k in enumerate(ROOTS)})
    return d.sort_values(['_o', 'outcome', '_h', 'param', '_r']).drop(columns=['_o', '_h', '_r'])


def main():
    res = pd.read_parquet(os.path.join(RES, 'AE.parquet'))
    cov = json.load(open(os.path.join(AE, 'coverage.json')))
    P = sort(res[res.param_role == 'P'])
    G = sort(res[(res.param_role != 'P') & (res.root == 'SPXW')])
    Grep = sort(res[(res.param_role != 'P') & (res.root != 'SPXW')])
    out = []
    w = out.append
    w('# EDGE0DTE Stage 1, family AE: dealer gamma regimes (A1-A7), dealer hedging (E1-E4), GEX-conditional tests '
      '(X4, X7-X10)\n')
    w('DISCOVERY only (expiry sessions 2020-02-18 .. 2023-12-31). No CALIBRATION (2024), HOLDOUT (2025) or 2026 outcome '
      'was computed or read: the FOUNDATION panel is filtered to split == DISCOVERY on load and the feature build refuses '
      'later sessions. Raw statistics only: no FDR, no pass/fail (the aggregator applies BH-FDR across all families). '
      '`results/stage1/AE.parquet` (+ `.csv`) holds every cell; this file is its readable form.\n')
    w('**Every A, E and X result here is MODEL**: dealer positioning is not observed. REGISTRY convention: customers are '
      'net long puts and net short calls, so dealers are long call gamma and short put gamma; GEX(K) = gamma(K) x '
      '(OI_call - OI_put) x 100 x S^2 x 0.01, gamma from Black-76 on the observed board mid at t (lib.dealer). P = '
      'same-day-expiry OI; G:oi7 = all expiries <= 7 DTE (later expiries get the same strike\'s same-day IV: flat term '
      'structure, MODEL-G). OI = OI published for the day before its open (OBS). Inputs: board, bars, OI = OBS; IV, '
      'Z, V, RV, B7/D1/D4 legs = CALC; GEX, flip, walls, concentration, charm/vanna/gamma hedge flows = MODEL.\n')
    w('## Method\n')
    w('* Decision grid: every 5 min 09:45-15:30 ET (FOUNDATION panel); outcomes Z, V at h = 15, 30, 60 min and the close '
      '(PROTOCOL section 4); A3 G:1-min uses 1-minute event times with Z from lib.outcomes.zv.')
    w('* Effect, Z rows: mean over events of s x (Z - mu_b), s = the feature direction, mu_b = unconditional mean of Z in '
      'the same 30-minute bucket over all DISCOVERY grid rows of the root. V rows: mean of (ln V - mu_b). A1 and X rows '
      'are differences between the GEX regimes, oriented so that the registry prediction is a positive effect. GEX regime '
      '= sign of total GEX at 09:45 of the session (as in BASELINES regimes); "G:GEX at t" uses the sign at the decision time.')
    w('* CI and p: day-clustered bootstrap, 2000 resamples of trading days, the bucket means re-estimated in every '
      'resample. p two-sided. E3 is registered as incremental: its p_value is from OLS of (Z - mu_b) on sign(hedge flow) '
      'and the prior-15-minute Z with CR1 day-clustered errors (the bootstrap p is kept in `boot_p`).')
    w('* IC: Spearman correlation of the continuous feature with the demeaned outcome (A2: |dist|, A5: PIT percentile, '
      'A6: PIT-scaled dGEX, E1-E4: PIT-scaled flows); CI = day-clustered bootstrap (2000) of the Pearson correlation of '
      'the full-sample ranks.')
    w('* Point-in-time (PIT) scaling: A5 terciles, A6 "sd", D4 terciles (X7) and the flow scales for the IC use the same '
      'root\'s values in the same 30-minute bucket over the PRIOR 20 expiry sessions (>= 10 sessions, >= 30 values; the '
      'day itself excluded; scale = RMS about zero). The first ~10 sessions of each root have no PIT value.')
    w('* Per-year effects: same formula on 2020-21 pooled, 2022, 2023 (sessions in parentheses); bucket means from the full '
      'DISCOVERY sample.')
    w('* Hurdle (results/HURDLE.md, hurdle.parquet): Z rows |E[za]|* pooled over buckets for that root/h, and in '
      'parentheses the median of the bucket hurdles over the events; V rows E[V]-1 long hurdle / short-below hurdle '
      '(pooled). `cond raw` = raw mean sign-aligned Z (Z rows) or raw mean V - 1 (V rows) of the events (for difference '
      'tests: the group predicted stronger). `beyond hurdle` (descriptive only): Z rows |effect| > |E[za]|*; V rows '
      'cond raw > long hurdle (effect > 0) or < short-below hurdle (effect < 0). `CI excl 0` and `beyond hurdle` are '
      'NOT a pass: FDR, the year rule and replication are the aggregator\'s.')
    w('* In the FDR family: SPXW x param P (column `in_fdr_family`). SPY/QQQ/IWM = replication; G and diag rows = '
      'sensitivity, never used to choose.\n')
    w('## Coverage\n')
    w('| root | sessions | grid rows | rows with dealer table (P / G7) | rows with a flip inside +/-3 sigma_close (P) | '
      'GEX(09:45) < 0 / > 0 days (P) | GEX(09:45) < 0 days (G7) | A3 1-min crossings (P) |')
    w('|---|---:|---:|---|---:|---|---:|---:|')
    for c in cov:
        w(f"| {c['root']} | {c['sessions']} | {c['grid_rows']} | {c['feat_rows']} / {c['feat_rows_g7']} | "
          f"{100 * c['flip_found']:.1f}% | {c['gex_neg_days']} / {c['gex_pos_days']} | {c['gex_neg_days_g7']} | {c['a3m_events']} |")
    w('')
    # summary
    w('## Summary: cells with the 95% CI excluding 0 AND beyond the hurdle (descriptive, before FDR)\n')
    s = res[(res.param_role == 'P') & res.ci_excl_0 & res.beyond_hurdle]
    if len(s):
        w(table(sort(s)))
    else:
        w('None.')
    w('')
    s2 = res[(res.param_role == 'P') & res.ci_excl_0]
    w(f'P cells with the CI excluding 0 (any size): {len(s2)} of {int((res.param_role == "P").sum())}; by root: ' +
      ', '.join(f"{r} {int(((s2.root == r)).sum())} ({int(((s2.root == r) & s2.sign_as_expected).sum())} with the "
                f"registry sign)" for r in ROOTS) + '.\n')
    w('## Primary parameter (P), all roots\n')
    w(table(P))
    w('')
    w('## Sensitivity: grid (G) and diagnostic rows, SPXW\n')
    w(table(G))
    w('')
    w('## Sensitivity: grid (G) and diagnostic rows, replication roots\n')
    w(table(Grep))
    w('')
    w('## Mechanisms and exact definitions\n')
    w('| row | feature at t | mechanism | outcome, predicted sign |')
    w('|---|---|---|---|')
    for k in ORDER:
        a, b, c = MECH[k]
        w(f'| {k} | {a} | {b} | {c} |')
    w('')
    w('Implementation notes (choices the registry leaves open, fixed before any outcome was computed):')
    w('* A1/X: the regime is the 09:45 GEX of the session and applies to every grid time of that session; '
      '"|09:45 only" diag rows use the 09:45 decision alone.')
    w('* A2: flip = lib.dealer flip (re-priced on +/-3 sigma_close, crossing nearest S); no crossing -> far.')
    w('* A3 G:1-min: the flip is recomputed every 5 minutes (the latest grid time <= the minute), not every minute '
      '(cost); a crossing can come from the flip moving as well as from spot (both P and G).')
    w('* A4: distances (wall - S)/(S sigma_30) and (S - put wall)/(S sigma_30); call wall = strike above S with the '
      'largest positive GEX, put wall = strike below S with the largest |GEX| (lib.dealer).')
    w('* A6: "re-priced at t vs open" = the strike table at t (IVs and T at t) re-priced at S(09:45); the change divided '
      'by gross |GEX| at t, then by its PIT RMS.')
    w('* A7/X8: every grid time >= the start (14:00 P; 13:00, 15:00 G); strikes with |ln(K/S)| <= sigma_close; ties '
      '(S = K) skipped.')
    w('* E1/X10: every grid time >= 13:00 (12:00, 14:00 G); 13:00-close days have no such time.')
    w('* E3 G lags 5/30 use the same prior-15-minute control as P (as registered).')
    w('* E4: H = charm_flow + vanna_flow(30) + gamma_flow(15), all in shares, defined from 10:00 (vanna lag); G drops E1.')
    w('* X4: B7 = ln(S(10:00) / prior session close) (P; G: / open of the 09:30 bar); decision = close - 30 min, '
      'Z over the last 30 minutes (h = 30 = to the close).')
    w('* X7: D4 = IV_atm(t)^2 / (RV of the last 60 one-minute returns, annualised), from 10:30; lowest PIT tercile '
      '(G: quintile). X9: D1 = RV of the last 30 one-minute returns / median of the same at the same minute over the '
      'prior 20 NYSE sessions (>= 10 needed); > 2 (G 1.5, 3).')
    w('* Speed only: families/ae_dealer.py caches the OI pivot of lib.dealer.strike_table per session; the result is '
      'asserted identical to lib.dealer.strike_table value by value in the leakage test.\n')
    w('## N/A and limits\n')
    na = [
        'A7, E1, X8, X10: registered at h = close only; X4 at the last 30 minutes only; E2 at h = 30 and 60 only. Other '
        'horizons are not tests of these rows (not N/A, not computed).',
        'E1/X10 on 13:00 early-close sessions: no decision time >= 13:00 (P) - those sessions do not enter.',
        'True dealer inventory, intraday OI and customer identity: N/A (PROTOCOL section 2); the dealer side is the '
        'MODEL convention, so every A/E/X result inherits that assumption.',
        'G:oi7: boards of later expiries are not cached, so their IV is the same-day IV of the strike (flat term '
        'structure, MODEL-G).',
        'PIT features (A5, A6, X7 and the E ICs) are NaN for the first ~10 expiry sessions of each root.',
        'Per-year cells with fewer than 30 sessions are reported, not hidden (IWM and QQQ 2020-21 have few 0DTE sessions).',
    ]
    for c in cov:
        sk = os.path.join(AE, f"{c['root']}.skipped.txt")
        if os.path.exists(sk) and os.path.getsize(sk):
            na.append(f"{c['root']}: sessions not built: " + '; '.join(x.strip().replace('\t', ' ') for x in open(sk)))
    for x in na:
        w(f'* {x}')
    w('')
    w('Leakage tests: `python3 -m families.ae_leak` (see the commit message for the result).')
    open(os.path.join(RES, 'AE.md'), 'w').write('\n'.join(out) + '\n')
    print('wrote AE.md', len(out), 'lines')
    if '--ledger' in sys.argv:
        ledger(res)


def ledger(res):
    day = datetime.date.today().isoformat()
    lines = []
    for k in ORDER:
        d = sort(res[(res.row_id == k) & (res.param_role == 'P')])
        sp = d[d.root == 'SPXW']
        cells = []
        for _, r in sp.iterrows():
            rep = ''.join({1: '+', -1: '-'}.get(int(np.sign(x)), '0') if np.isfinite(x) else '.'
                          for x in [d[(d.root == q) & (d.outcome == r.outcome) & (d.horizon == r.horizon)].effect.squeeze()
                                    if len(d[(d.root == q) & (d.outcome == r.outcome) & (d.horizon == r.horizon)]) else np.nan
                                    for q in ('SPY', 'QQQ', 'IWM')])
            cells.append(f"{r.outcome}{r.horizon} {f(r.effect)} [{f(r.ci_lo)},{f(r.ci_hi)}] p={r.p_value:.3f}"
                         f"{' (OLS)' if r.p_method.startswith('ols') else ''} rep(SPY/QQQ/IWM)={rep}")
        n = int(sp.n_obs.max()) if len(sp) else 0
        ns = int(sp.n_sessions.max()) if len(sp) else 0
        lines.append(f"{day} | EDGE0DTE-S1 | AE {k} (MODEL; expected sign {'+' if (len(sp) and sp.expected_sign.iloc[0] > 0) else '-'}) "
                     f"SPXW P | DISCOVERY | {n} obs / {ns} sess | {'; '.join(cells)} | edge0dte/results/stage1/AE.md; "
                     f"raw, FDR by the aggregator")
    with open(LEDGER, 'a') as fh:
        fh.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
