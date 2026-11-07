"""Write results/stage1/D.md from results/stage1/D.parquet (family D, Stage 1, DISCOVERY only). Raw report: no FDR,
no pass/fail."""
import json
import os

import numpy as np
import pandas as pd

from lib.config import DATA, ROOTS

HORD = {'15': 0, '30': 1, '60': 2, 'close': 3}
YRS = ('2020-21', '2022', '2023')


def f(x, nd=3):
    return '-' if x is None or not np.isfinite(x) else f'{x:+.{nd}f}'


def fp(x):
    if x is None or not np.isfinite(x):
        return '-'
    return f'{x:.4f}' if x < 0.001 else f'{x:.3f}'


def ci(r, a, lo, hi, nd=3):
    return f'{f(r[a], nd)} [{f(r[lo], nd)}, {f(r[hi], nd)}]'


def yrs(r):
    return ' / '.join(f"{f(r[f'eff_{y}'], 3)} ({int(r[f'sess_{y}'])})" for y in YRS)


def flag(r):
    s = []
    if r.ci_excludes_0:
        s.append('CI!0')
    if r.beyond_hurdle_point:
        s.append('>H')
    if r.beyond_hurdle_ci:
        s.append('>H(CI)')
    if r.get('z2_beyond_long_suppl') is True and r.econ_side in ('long', 'both'):
        s.append('Z2>H')
    return ' '.join(s) or '-'


def hurdle_txt(r):
    if r.outcome == 'Z':
        return f"|E[za]|* {f(r.hurdle_z, 2)}"
    return (f"long {f(r.hv_long, 2)} / short-below {f(r.hv_short, 2)} / Z2 {f(r.hz2_long, 2)}")


def thin(r):
    t = r.get('hurdle_times', np.nan)
    return ' ~' if np.isfinite(t) and t < 100 else ''


def sort(d):
    return d.assign(_h=d.horizon.map(HORD)).sort_values(['row_id', 'arm', 'param_kind', 'param', '_h'])


def main_table(d):
    L = ['| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | '
         'E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |',
         '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|']
    for _, r in sort(d).iterrows():
        L.append(f"| {r.row_id} | {r.arm} | {r.horizon} | {r.param} | {int(r.n_obs)} / {int(r.n_sessions)} | "
                 f"{ci(r, 'effect', 'ci_lo', 'ci_hi')} | {fp(r.p_value)} | {fp(r.get('perm_p', np.nan))} | "
                 f"{ci(r, 'ic', 'ic_lo', 'ic_hi')} | {ci(r, 'ev_m1', 'ev_m1_lo', 'ev_m1_hi', 2)} ({f(r.ev_m1_uncond, 2)}) | "
                 f"{f(r.ez2_m1, 2)} | {hurdle_txt(r)} | {yrs(r)} | {flag(r)} |")
    return L


def level_table(d):
    L = ['| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | '
         'E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |',
         '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|']
    for _, r in d.assign(_h=d.horizon.map(HORD)).sort_values(['arm', '_h']).iterrows():
        if not r.n_obs:
            L.append(f"| {r.arm} | {r.horizon} | 0 | N/A ({r.get('na_reason', '')}) | | | | | | | | | | |")
            continue
        L.append(f"| {r.arm} | {r.horizon} | {int(r.n_obs)} / {int(r.n_sessions)} | {ci(r, 'effect', 'ci_lo', 'ci_hi')} | "
                 f"{fp(r.p_value)} | {ci(r, 'ev_m1', 'ev_m1_lo', 'ev_m1_hi', 2)} | {r.median_V:.2f} | {100 * r.frac_V_below_1:.0f}% | "
                 f"{f(r.ez2_m1, 2)} | {f(r.hv_long, 2)}{thin(r)} | {f(r.hv_short, 2)}{thin(r)} | {f(r.hz2_long, 2)}{thin(r)} | {yrs(r)} | {flag(r)} |")
    return L


def write(df, res):
    D = os.path.join(DATA, 'stage1')
    L = ['# EDGE0DTE Stage 1, family D (volatility): D1-D6, DISCOVERY only', '',
         'Raw results: no FDR applied and no pass/fail declared (the aggregator applies BH-FDR across every family). '
         'Machine-readable: `results/stage1/D.parquet` / `D.csv` (one row per row_id x arm x root x outcome x horizon x '
         'parameter); frozen tercile/quintile cutoffs for the CALIBRATION look: `results/stage1/D_cutoffs.json`. Code: '
         '`families/d_vol.py` (features), `families/d_stage1.py` (tests), `families/test_d_leakage.py` (leakage test), '
         '`families/d_report.py` (this file).', '',
         '## Scope and data', '',
         '* Universe U1: SPXW (primary, the only root in the FDR family), SPY / QQQ / IWM (replication, reported only). '
         'Sessions: DISCOVERY (2020-02-18 .. 2023-12-31) with a same-day expiry; the panel is read with a '
         '`split == DISCOVERY` filter, so no 2024 (CALIBRATION), 2025 (HOLDOUT) or 2026 outcome was read or computed.',
         '* Decision times: the 5-minute grid 09:45-15:30 (lib.panel.grid; early-close days stop at 12:30). Horizons 15, 30, 60 '
         'min and close.',
         '* Labels: 1-minute bars (SPX index for SPXW, the ETF for SPY/QQQ/IWM) OBS; option board mids OBS; IV_atm, RV, '
         'features d_rv30_rel / d_semivar60 / d_iv_rv60, Z, V CALC; hurdles CALC from OBS fills (HURDLE.md). No MODEL input '
         'is used by any D row. Nothing is INTERP.',
         '* No ThetaData request was made (all inputs on disk).', '',
         '## Features (registry definition, primary parameter P, grid G)', '',
         '| row | feature | definition | first defined | P | G |', '|---|---|---|---|---|---|',
         '| D1 | d_rv30_rel | RV(t-30m,t) / median of RV over the same clock window in the prior 20 NYSE sessions (>= 10 valid) | 10:05 | > 2 | > 1.5, > 3 |',
         '| D2 | d_rv30_rel | same ratio | 10:05 | < 0.5 | < 0.4, < 0.67 |',
         '| D3 | d_semivar60 | (RS+ - RS-) / RV over the last 60 min | 10:35 | top / bottom tercile (pooled DISCOVERY cutoffs) | quintile |',
         '| D4 | d_iv_rv60 | IV_atm(t)^2 / annualised RV of the last 60 min | 10:35 | lowest / highest tercile | quintile |',
         '| D5 | bucket | 30-min time-of-day bucket (09:30 = 09:45-09:55 ... 15:30 = 15:30) | - | 30-min | 60-min |',
         '| D6 | time | the 09:45 decision, h = close | - | 09:45 | 10:00, 10:30, 12:00 |', '',
         'RV = sum of squared 1-minute log returns of bar closes; endpoints required, <= 10% interior closes missing '
         '(a missing close is spanned, never filled).', '',
         '## Statistics', '',
         '* D1-D4 (conditional): effect = mean over the condition of d (y - mu_t), y = ln V (D1, D2, D4) or Z (D3), '
         'mu_t = the unconditional DISCOVERY mean of y at the same 5-minute grid time, d = +1 / -1 the registry direction '
         '(D3 is sign-aligned: top tercile short, bottom tercile long). 95% CI and two-sided p: day-clustered bootstrap '
         '(2,000 resamples of days, mu_t re-estimated inside each resample). IC: Spearman of the feature vs y - mu_t with a '
         'day-clustered CI (one per feature x h; for D1/D2 it is the same IC of ln ratio).',
         '* D5, D6 (level): effect = mean ln V vs 0 (subtracting the same-time mean would be identically zero); '
         'day-clustered bootstrap (lib.stats.boot_mean).',
         '* Per period: the same statistic inside 2020-21, 2022, 2023 (mu_t re-estimated within the period), with sessions.',
         '* Economic size: the effects above are in ln V (or Z) units; the hurdles are in E[V]-1 units, so every V row also '
         'carries E[V]-1 inside the condition (day-clustered CI) and E[Z^2]-1 (terminal move, the supplementary hurdle). '
         'Long side clears when E[V]-1 > "E[V]-1 long"; short side when E[V]-1 < "short below" (a short straddle / iron-fly '
         'proxy, before the wing cost, makes money only below it). D1-D4 rows use the pooled ("all") bucket hurdle of '
         'their root/h; the `*_mix` columns in the parquet weight the 30-min bucket hurdles by the condition\'s own '
         'time-of-day composition. D5 uses its own bucket, D6 the bucket of its time.',
         '* Flags (descriptive only): CI!0 = effect CI excludes 0; >H = point estimate beyond the hurdle (Z rows: effect >= '
         '|E[za]|*; V rows: E[V]-1 beyond the side\'s hurdle); >H(CI) = the whole CI beyond it; Z2>H = E[Z^2]-1 > the '
         'supplementary long Z^2 hurdle.',
         '* Null calibration (V2 house rule 11): day-permutation null (1,000 permutations of whole days\' condition '
         'vectors at the same grid times) -> perm p; pipeline false-positive rate below.', '']

    # headline (computed; descriptive, not a verdict)
    L += ['## Headline (raw, DISCOVERY; descriptive only)', '']
    for root in ROOTS:
        x = df[(df.root == root) & (df.param_kind == 'P') & df.primary_arm & df.ci_excludes_0 & df.beyond_hurdle_ci]
        x = x.assign(_h=x.horizon.map(HORD)).sort_values(['row_id', 'arm', '_h'])
        cells = '; '.join(f"{r.row_id} {r.arm} h{r.horizon} (E[V]-1 {r.ev_m1:+.2f} [{r.ev_m1_lo:+.2f}, {r.ev_m1_hi:+.2f}] vs "
                          f"{'short-below' if r.ev_m1 < 0 else 'long'} {(r.hv_short_used if r.ev_m1 < 0 else r.hv_long_used):+.2f}"
                          f"{', pooled fallback' if r.hurdle_source.startswith('all (fallback') else ''})" if r.outcome == 'V'
                          else f"{r.row_id} {r.arm} h{r.horizon} (effect {r.effect:+.3f} vs {r.hz_used:+.2f})" for r in x.itertuples())
        prim = df[(df.root == root) & (df.param_kind == 'P') & df.primary_arm & df.effect.notna()]
        L.append(f"* {root}: effect CI excludes 0 in {int(prim.ci_excludes_0.sum())}/{len(prim)} primary cells; effect CI "
                 f"excludes 0 AND the whole economic CI is beyond the hurdle in {len(x)}: {cells or 'none'}.")
    L += ['* No long-gamma cell (D1 expansion, D4 low, any D5 bucket on the long side) comes near its long hurdle on SPXW: '
          'E[V]-1 stays at or below 0 even where ln V is significantly above its same-time mean; the conditional '
          'information is real in ln V units but far too small for a long straddle after costs.',
          '* D3 has the OPPOSITE sign to the registry (both arms), |effect| <= 0.05 against |E[za]|* 0.10-0.18; IWM null.',
          '* The short-side cells that clear (D2 compression and D4 high IV/RV at h = 60 on SPXW/SPY/QQQ, and at close on '
          'SPY/QQQ/IWM) clear the short hurdle "before the wing cost" of an iron fly; D2 and D4-high overlap (low trailing '
          'RV relative to history ~ high IV/RV). HURDLE.md has no short-side Z^2 hurdle; E[Z^2]-1 in those cells is '
          'close to E[V]-1 at h = 60 but near 0 at close, i.e. the terminal move a short straddle to the close pays for '
          'is not as cheap as V says.',
          '* Replication D5 flags at late buckets use the pooled fallback hurdle (their own bucket cells have 30 times); '
          'on SPXW, where every bucket hurdle rests on >= 198 times, no D5 bucket clears its own short hurdle with its CI.',
          '']

    # leakage / cross-check
    L += ['## Leakage tests and bulk cross-check', '']
    leak = os.path.join(res, 'D_leakage.txt')
    if os.path.exists(leak):
        L += ['```'] + [x.rstrip() for x in open(leak) if x.startswith(('PASS', 'FAIL', 'TOTAL', 'targeted'))] + ['```', '']
    for root in ROOTS:
        fcc = os.path.join(D, f'D_crosscheck_{root}.json')
        if os.path.exists(fcc):
            c = json.load(open(fcc))
            L.append(f"* {root}: bulk vs registered features on {c['rows']} rows / {c['days']} sessions: " + ', '.join(
                f"{k} {c[k]['equal']}/{c['rows']} equal ({c[k]['finite']} finite)" for k in ('d_rv30_rel', 'd_semivar60', 'd_iv_rv60')))
    L.append('')

    # headline for the short-premium question
    L += ['## V hurdles both ways (the short-premium question)', '',
          'For each V row with its primary parameter: E[V]-1 inside the condition vs the long hurdle (E[V]-1 a long straddle '
          'needs) and the short hurdle (E[V]-1 below which a short straddle / iron fly makes money before wings), and '
          'E[Z^2]-1 vs the supplementary Z^2 long hurdle (V only partly drives straddle P&L: corr(V, Z^2) is 0.44-0.63 in '
          'HURDLE.md). HURDLE.md has no short-side Z^2 hurdle.', '',
          '| root | row | arm | h | E[V]-1 [95% CI] | long hurdle | short below | long clears? | short clears? | E[Z^2]-1 [95% CI] | Z^2 long hurdle |',
          '|---|---|---|---|---:|---:|---:|---|---|---:|---:|']
    v = df[(df.outcome == 'V') & (df.param_kind == 'P') & (df.n_obs > 0) & df.primary_arm]
    for _, r in v.assign(_h=v.horizon.map(HORD), _r=v.root.map({x: i for i, x in enumerate(ROOTS)})).sort_values(
            ['_r', 'row_id', 'arm', '_h']).iterrows():
        hl, hs = r.hv_long_used, r.hv_short_used
        lc = 'yes (CI)' if r.ev_m1_lo > hl else ('point' if r.ev_m1 > hl else 'no')
        sc = 'yes (CI)' if r.ev_m1_hi < hs else ('point' if r.ev_m1 < hs else 'no')
        if not np.isfinite(hl):
            lc = 'n/a'
        if not np.isfinite(hs):
            sc = 'n/a'
        fb = ' (pooled)' if r.hurdle_source.startswith('all (fallback') else ''
        L.append(f"| {r.root} | {r.row_id} | {r.arm} | {r.horizon} | {ci(r, 'ev_m1', 'ev_m1_lo', 'ev_m1_hi', 2)} | "
                 f"{f(hl, 2)}{fb} | {f(hs, 2)}{fb} | {lc} | {sc} | {ci(r, 'ez2_m1', 'ez2_m1_lo', 'ez2_m1_hi', 2)} | {f(r.hz2_long_used, 2)}{fb} |")
    L.append('')

    for root in ROOTS:
        d = df[df.root == root]
        if not len(d):
            continue
        tag = 'primary (FDR family)' if root == 'SPXW' else 'replication (reported, not in the FDR family)'
        L += [f'## {root}: {tag}', '', '### D1-D4, primary parameter', '']
        L += main_table(d[(d.param_kind == 'P') & d.row_id.isin(['D1', 'D2', 'D3', 'D4'])]) + ['']
        L += ['### D5 seasonality, 30-min buckets (P; each bucket its own two-sided test)', '']
        L += level_table(d[(d.row_id == 'D5') & (d.param_kind == 'P')]) + ['']
        L += ['### D6 unconditional variance premium, h = close', '']
        L += level_table(d[d.row_id == 'D6']) + ['']
        L += ['### Grid sensitivity (G; reported, never used to choose)', '']
        L += main_table(d[(d.param_kind == 'G') & d.row_id.isin(['D1', 'D2', 'D3', 'D4'])]) + ['']
        L += ['D5 60-min buckets (G):', '']
        L += level_table(d[(d.row_id == 'D5') & (d.param_kind == 'G')]) + ['']

    # null calibration
    nul = df[df.null_boot_p.fillna('').str.len() > 0] if 'null_boot_p' in df else df.iloc[:0]
    ps = np.concatenate([np.array(json.loads(x), float) for x in nul.null_boot_p]) if len(nul) else np.array([])
    cond = df[df.row_id.isin(['D1', 'D2', 'D3', 'D4']) & df.perm_p.notna()]
    L += ['## Null calibration', '',
          f'* Pipeline false-positive rate: the day-clustered bootstrap test run on {len(ps)} day-permuted nulls '
          f'({len(nul)} SPXW primary conditional cells x {len(ps) // max(len(nul), 1)} permutations, 500 resamples each): '
          f'share with p < 0.05 = {100 * np.mean(ps < 0.05):.1f}%, p < 0.10 = {100 * np.mean(ps < 0.10):.1f}% '
          '(a calibrated test gives about 5% and 10%).' if len(ps) else '* no null runs',
          f'* Permutation p vs bootstrap p (D1-D4, all roots and parameters, {len(cond)} cells): bootstrap p < 0.05 in '
          f'{int((cond.p_value < 0.05).sum())}, permutation p < 0.05 in {int((cond.perm_p < 0.05).sum())}, both in '
          f'{int(((cond.p_value < 0.05) & (cond.perm_p < 0.05)).sum())}.',
          '* D5 and D6 test a level (ln V vs 0), not an association, so a permutation null does not apply; a synthetic '
          '"V = 1 world" would need a price model and was not built.', '']

    # N/A
    na = df[(df.n_obs == 0) | df.effect.isna()]
    L += ['## N/A rows and why', '']
    if len(na):
        for _, r in na.iterrows():
            L.append(f"* {r.root} {r.row_id} {r.arm} h={r.horizon} {r.param_kind} {r.param}: "
                     f"{r.get('na_reason') if isinstance(r.get('na_reason'), str) else 'no observation in the condition'}")
    L += ['* Hurdle cells marked "-" in HURDLE.md (fewer than 30 round trips, or a non-positive fitted slope) leave the '
          'hurdle column empty for that bucket (mostly SPY/QQQ/IWM off-grid buckets, sampled with 30 times only).',
          '* Flags use hurdle_source: the row\'s own hurdle cell when it rests on >= 100 decision times, else the root\'s '
          'pooled ("all") hurdle at the same h (the thin bucket value is still shown, marked "~").',
          '* "~" after a hurdle: the HURDLE.md cell rests on fewer than 100 decision times (SPY/QQQ/IWM buckets other than '
          '10:00/12:00/14:00 have 30), so that hurdle is noisy; compare with the root\'s pooled hurdle.',
          '* X7 and X9 (conditional tests on D4 / D1 by GEX sign) are registered as X rows, not D rows, and are not '
          'computed here.', '']

    L += ['## Mechanism notes', '',
          '* D1/D2: volatility clusters; if the 0DTE board under-reacts to a burst (or to calm), realized over the next '
          'h beats (lags) the implied rate. The ratio uses the underlying\'s own same-clock history, so the U-shape of '
          'intraday volatility is removed from the feature.',
          '* D3: Bollerslev-Li-Zhao (2020): positive semivariance dominance predicts lower returns (sign-aligned so a '
          'positive effect = as predicted).',
          '* D4: IV^2 / RV_60 is the reciprocal of the trailing V; low = implied cheap relative to what was just realized. '
          'Because IV_atm of a 0DTE option is a forward-looking rate and RV_60 is backward-looking, the feature mixes the '
          'variance premium with plain mean reversion of intraday volatility.',
          '* D5/D6: E[ln V] < ln E[V] (Jensen; V is right-skewed), so mean ln V < 0 does not by itself mean a short '
          'straddle earns money: the economic columns (E[V]-1, P(V<1), E[Z^2]-1) and the short hurdle decide that.', '']
    open(os.path.join(res, 'D.md'), 'w').write('\n'.join(L) + '\n')
    print('wrote', os.path.join(res, 'D.md'), len(L), 'lines')
