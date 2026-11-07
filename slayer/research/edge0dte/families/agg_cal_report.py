"""Formats the ONE CALIBRATION look (results/stage1/STAGE1_CALIBRATION*.parquet, written by families.agg_calibration run)
into results/STAGE1_CALIBRATION.md. No statistic is computed here.

  python3 -m families.agg_cal_report
"""
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, 'results')
S1 = os.path.join(RES, 'stage1')
LOOKS = '/home/user/falcon-cloud-field-sail/v2data/locked_looks.jsonl'


def f3(x):
    return '-' if x is None or not np.isfinite(x) else f'{x:+.3f}'


def nm(cid):
    return cid.replace('|', ' ')


def fp(x):
    return '-' if x is None or not np.isfinite(x) else f'{x:.4f}'


def main():
    df = pd.read_parquet(os.path.join(S1, 'STAGE1_CALIBRATION.parquet'))
    V = pd.read_parquet(os.path.join(S1, 'STAGE1_CALIBRATION_verdict.parquet')).set_index('cell')
    disc = pd.read_parquet(os.path.join(S1, 'STAGE1_DISCOVERY.parquet'))
    sha = df.spec_sha256.iloc[0]
    look = [json.loads(x) for x in open(LOOKS) if sha in x][0]
    L = ['# EDGE0DTE Stage 1: the ONE CALIBRATION (2024) look\n']
    L.append(f'Frozen spec `frozen/STAGE1_CALIBRATION_SPEC.md` (sha256 `{sha}`), committed in {look["commit"]} and '
             f'registered in `v2data/locked_looks.jsonl` and `research-v2-ledger.md` before any 2024 outcome was computed. '
             f'Sessions: 2024 expiry sessions of each root (SPXW 252, SPY 252, QQQ 252, IWM 224). Code: '
             f'`families/agg_calibration.py` (look) reusing `d_stage1` / `d_vol` / `bf_stage1` / `bf` with only the split '
             f'filter moved by a parameter; this report: `families/agg_cal_report.py`. Machine-readable: '
             f'`results/stage1/STAGE1_CALIBRATION.parquet` (every cell x root) and `STAGE1_CALIBRATION_verdict.parquet`. '
             f'Each cell was looked at once; nothing was re-run. No 2025 or 2026 data was read (HOLDOUT guard on).\n')
    L.append('Labels: bars, board mids OBS; IV_atm, RV, Z, V, d_rv30_rel, d_iv_rv60 CALC; VIX OBS; hurdles CALC from '
             'DISCOVERY OBS fills (HURDLE.md, frozen). Same-time (D) / same-bucket (BF) means are re-estimated inside 2024.\n')
    # ---------------- survivors
    L.append('## (a) DISCOVERY survivors: PROTOCOL section 4 rule\n')
    L.append('Rule: FAIL on a sign flip of the 2024 SPXW effect, or when its 95% CI includes -d/2 (d = the DISCOVERY '
             'SPXW effect: the wrong-sign value of half the discovery effect). Everything else in the table is reported, '
             'not part of the rule.\n')
    L.append('| cell | DISCOVERY d [95% CI] | 2024 SPXW n obs / sess | 2024 effect [95% CI] | p | -d/2 | sign flip | CI incl. -d/2 | CI excl. 0 | CI beyond d/2 | 2024 E[V]-1 [95% CI] | short hurdle (below) | clears | SPY / QQQ / IWM 2024 | VERDICT |')
    L.append('|---|---|---:|---|---:|---:|:-:|:-:|:-:|:-:|---|---|:-:|---|:-:|')
    for cid in [c for c in V.index if V.loc[c, 'rule'] == 'PROTOCOL s4']:
        v = V.loc[cid]
        r = df[(df.cell == cid) & (df.root == 'SPXW')].iloc[0]
        L.append(f'| {nm(cid)} | {f3(v.disc_effect)} [{f3(v.disc_ci_lo)}, {f3(v.disc_ci_hi)}] | {int(r.n_obs)} / {int(r.n_sess)} | '
                 f'{f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | {fp(r.p_value)} | {f3(v.wrong_half)} | '
                 f'{"yes" if v.sign_flip else "no"} | {"yes" if v.ci_includes_wrong_half else "no"} | '
                 f'{"yes" if v.ci_excludes_0 else "no"} | {"yes" if v.ci_beyond_half else "no"} | '
                 f'{f3(r.econ)} [{f3(r.econ_lo)}, {f3(r.econ_hi)}] | {f3(r.hurdle_short)} | {"yes" if v.hurdle_info else "no"} | '
                 f'{f3(v.rep_SPY)} / {f3(v.rep_QQQ)} / {f3(v.rep_IWM)} ({int(v.rep_same)}/3 same sign) | '
                 f'**{"PASS" if v.passed else "FAIL"}** |')
    L.append('')
    L.append('Replication detail (2024, same cell, each root its own frozen DISCOVERY cut and hurdle cell):\n')
    L.append('| cell | root | n obs / sess | effect [95% CI] | p | E[V]-1 [95% CI] | short hurdle |')
    L.append('|---|---|---:|---|---:|---|---|')
    for cid in [c for c in V.index if V.loc[c, 'rule'] == 'PROTOCOL s4']:
        for _, r in df[(df.cell == cid)].iterrows():
            L.append(f'| {nm(cid)} | {r.root} | {int(r.n_obs)} / {int(r.n_sess)} | {f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | '
                     f'{fp(r.p_value)} | {f3(r.econ)} [{f3(r.econ_lo)}, {f3(r.econ_hi)}] | {f3(r.hurdle_short)} |')
    L.append('')
    # ---------------- addendum 3
    L.append('## (b) REGISTRY_ADDENDUM_3 rows: Holm over 4 at 0.05, hurdle, replication\n')
    L.append('Rule: Holm-adjusted p <= 0.05 over the four SPXW tests AND effect > 0 with its 95% CI excluding 0 AND '
             'effect >= the HURDLE.md |E[za]|* (event-weighted SPXW bucket hurdles; X12R: low-VIX events) AND the 2024 '
             'effect > 0 on >= 2 of SPY / QQQ / IWM. DISCOVERY numbers are shown for orientation only (they suggested '
             'these rows and are not evidence).\n')
    L.append('| cell | DISCOVERY (contaminated) | 2024 SPXW n obs / sess | 2024 effect [95% CI] | p | Holm p | raw E[za] | hurdle | effect >= hurdle | SPY / QQQ / IWM 2024 | VERDICT |')
    L.append('|---|---|---:|---|---:|---:|---:|---:|:-:|---|:-:|')
    for cid in [c for c in V.index if V.loc[c, 'rule'] == 'ADDENDUM 3']:
        v = V.loc[cid]
        r = df[(df.cell == cid) & (df.root == 'SPXW')].iloc[0]
        row, h = cid.split('|')
        base = 'B8' if row == 'B8R' else 'X12'
        q = disc[(disc.row_id == base) & (disc.horizon == h)]
        dtxt = f'{f3(-q.effect.iloc[0])} [{f3(-q.ci_hi.iloc[0])}, {f3(-q.ci_lo.iloc[0])}]' if len(q) else '-'
        extra = f' (low {int(r.n_low)} / high {int(r.n_high)} events)' if row == 'X12R' else ''
        L.append(f'| {nm(cid)} | {dtxt} | {int(r.n_obs)} / {int(r.n_sess)}{extra} | {f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | '
                 f'{fp(r.p_value)} | {fp(v.p_holm)} | {f3(r.econ)} | {f3(r.hurdle_z)} | {"yes" if v.hurdle_pass else "no"} | '
                 f'{f3(v.rep_SPY)} / {f3(v.rep_QQQ)} / {f3(v.rep_IWM)} ({int(v.rep_same)}/3 > 0) | **{"PASS" if v.passed else "FAIL"}** |')
    L.append('')
    L.append('Replication detail (2024):\n')
    L.append('| cell | root | n obs / sess | effect [95% CI] | p | raw E[za] | hurdle |')
    L.append('|---|---|---:|---|---:|---:|---:|')
    for cid in [c for c in V.index if V.loc[c, 'rule'] == 'ADDENDUM 3']:
        for _, r in df[(df.cell == cid)].iterrows():
            L.append(f'| {nm(cid)} | {r.root} | {int(r.n_obs)} / {int(r.n_sess)} | {f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | '
                     f'{fp(r.p_value)} | {f3(r.econ)} | {f3(r.hurdle_z)} |')
    L.append('')
    passed = [c for c in V.index if V.loc[c, 'passed']]
    L.append('## Outcome\n')
    L.append(f'Passed CALIBRATION: {len(passed)} of {len(V)} looked-at cells' + (': ' + ', '.join(map(nm, passed)) if passed else '') + '.')
    s4 = [c for c in V.index if V.loc[c, 'rule'] == 'PROTOCOL s4']
    nh = [c for c in s4 if not V.loc[c, 'hurdle_info']]
    if nh:
        L.append(f'\n**Read with the pass:** the PROTOCOL rule has no hurdle term at CALIBRATION, and in 2024 none of '
                 f'{", ".join(nm(c) for c in nh)} keeps its conditional E[V]-1 below the frozen DISCOVERY short hurdle '
                 f'(table above, column "clears"). The variance premium inside these conditions was smaller in 2024 '
                 f'than in DISCOVERY, so the information survived but the economic size did not reach the round-trip '
                 f'cost of a short straddle/iron-fly proxy at aggressive fills. Stage 2 (executable P&L, including '
                 f'the passive-fill M1/M2 version) is where this is decided; this note is not a verdict.\n')
    L.append('Passing Stage 1 is not an edge: it only earns the pre-registered Stage-2 executable test '
             '(`results/STAGE2_QUEUE.md`) and, if that passes, one blind HOLDOUT look (PROTOCOL section 7).\n')
    open(os.path.join(RES, 'STAGE1_CALIBRATION.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
