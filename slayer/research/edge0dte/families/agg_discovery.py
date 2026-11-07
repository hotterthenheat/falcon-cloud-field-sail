"""EDGE0DTE Stage-1 aggregator, step 1: BH-FDR and the PROTOCOL section-4 pass rule on DISCOVERY.

No new outcome is computed: this reads the four family result tables (results/stage1/{AE,BF,C,D}.parquet) only.

FDR family = every SPXW cell at its primary parameter P across the four families (AE `in_fdr_family`, BF
param_role P, C kind primary + param_kind P, D `in_fdr_family`). Grid, diagnostic and replication rows are excluded.
Cells with no finite p (N/A: no observation) are listed and left out of the BH count.

Criteria (all required, PROTOCOL section 4 + aggregator brief):
  sign   effect has the registered sign (expected_sign; D5 is registered two-sided, so its direction = sign(effect))
  fdr    BH q <= 0.10 (lib.stats.bh_fdr over the whole FDR family)
  years  >= 2 of the discovery periods (2020-21 pooled, 2022, 2023) that have >= 30 sessions show the direction
  hurdle economic size clears the HURDLE.md hurdle at that horizon (point estimate):
           Z rows  raw sign-aligned conditional mean E[za] of the events >= |E[za]|*
           V rows  conditional E[V]-1 > long hurdle (direction +) or < "short profits only below" (direction -)
         composition-matched hurdle where the family supplied one, else the pooled (bucket "all") hurdle;
         a bucket hurdle resting on < 100 times falls back to the pooled one (D family rule).
  rep    same direction (point estimate) on >= 2 of SPY/QQQ/IWM for the identical cell; an N/A replication cell
         counts as not replicated.

Run:  python3 -m families.agg_discovery   (from slayer/research/edge0dte)
"""
import json
import os

import numpy as np
import pandas as pd

from lib.stats import bh_fdr

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S1 = os.path.join(HERE, 'results', 'stage1')
REP = ('SPY', 'QQQ', 'IWM')
PER = ('2020-21', '2022', '2023')


def _sgn(x):
    return 0 if not np.isfinite(x) or x == 0 else int(np.sign(x))


def load_ae():
    a = pd.read_parquet(os.path.join(S1, 'AE.parquet'))
    a = a[a.param_role == 'P'].copy()
    out = []
    for _, r in a.iterrows():
        v = r.outcome == 'V'
        e = int(r.expected_sign)
        if v:
            econ = r.cond_raw
            kind = 'E[V]-1 (predicted group)' if r.row_id in ('A1', 'X7', 'X9') else 'E[V]-1'
            if e > 0:
                hm, hp, side = r.hv_long_bucket, r.hv_long_all, 'long'
            else:
                hm, hp, side = r.hv_short_bucket, r.hv_short_all, 'short'
        else:
            econ = r.cond_raw
            kind = 'raw E[za] (predicted group)' if r.row_id.startswith('X') else 'raw E[za]'
            hm, hp, side = r.hz_bucket, r.hz_all, 'dir'
        out.append(dict(
            family='AE', row_id=r.row_id, arm='', root=r.root, outcome=r.outcome, horizon=str(r.horizon),
            param=r.param, label=r.label, desc=r.desc, n_obs=r.n_obs, n_sess=r.n_sessions, effect=r.effect,
            ci_lo=r.ci_lo, ci_hi=r.ci_hi, p=r.p_value, p_method=r.p_method, expected_sign=e,
            econ=econ, econ_kind=kind, side=side, hurdle_matched=hm, hurdle_pooled=hp,
            hurdle_src='AE bucket hurdle (median over events)',
            **{f'eff_{p}': r[f'eff_{p}'] for p in PER}, **{f'sess_{p}': r[f'sess_{p}'] for p in PER},
            fdr_member=bool(r.in_fdr_family)))
    return pd.DataFrame(out)


def load_bf():
    b = pd.read_parquet(os.path.join(S1, 'BF.parquet'))
    b = b[b.param_role == 'P'].copy()
    out = []
    for _, r in b.iterrows():
        x = r.row_id.startswith('X')
        out.append(dict(
            family='BF', row_id=r.row_id, arm='', root=r.root, outcome=r.outcome, horizon=str(r.horizon),
            param=r.param, label=r.label, desc='', n_obs=r.n_obs, n_sess=r.n_sessions, effect=r.effect,
            ci_lo=r.ci_lo, ci_hi=r.ci_hi, p=r.p_value, p_method='boot2000_day', expected_sign=int(r.expected_sign),
            econ=(r.effect_a if x else r.mean_za_raw),
            econ_kind=('E[za] predicted regime (bucket-demeaned; raw not supplied)' if x else 'raw E[za]'),
            side='dir', hurdle_matched=r.hurdle, hurdle_pooled=r.hurdle_all,
            hurdle_src='BF event-weighted bucket hurdle',
            **{f'eff_{p}': r[f'effect_{p}'] for p in PER}, **{f'sess_{p}': r[f'nsess_{p}'] for p in PER},
            fdr_member=(r.root == 'SPXW')))
    return pd.DataFrame(out)


def load_c():
    c = pd.read_parquet(os.path.join(S1, 'C.parquet'))
    c = c[c.param_kind == 'P'].copy()
    out = []
    for _, r in c.iterrows():
        e = int(r.expected_sign)
        if r.outcome == 'V':
            econ, kind = r.cond_V_minus1, 'E[V]-1'
            hp, side = (r.hurdle_v_long, 'long') if e > 0 else (r.hurdle_v_short, 'short')
        elif r.row_id in ('X3', 'X11'):
            econ, kind, hp, side = r.effect_za_equiv, 'za-equivalent of OLS coefficient', r.hurdle_z, 'dir'
        else:
            econ, kind, hp, side = r.cond_mean_raw, 'raw E[za]', r.hurdle_z, 'dir'
        out.append(dict(
            family='C', row_id=r.row_id, arm='', root=r.root, outcome=r.outcome, horizon=str(r.horizon),
            param=r.param, label=r.label, desc=r.test, n_obs=r.n_obs, n_sess=r.n_sessions, effect=r.effect,
            ci_lo=r.ci_lo, ci_hi=r.ci_hi, p=r.p_value, p_method=r.p_source, expected_sign=e,
            econ=econ, econ_kind=kind, side=side, hurdle_matched=np.nan, hurdle_pooled=hp,
            hurdle_src='C pooled (bucket all); no composition-matched hurdle supplied',
            **{f'eff_{p}': r[f'eff_{p.replace("-", "_")}'] for p in PER},
            **{f'sess_{p}': r[f'sess_{p.replace("-", "_")}'] for p in PER},
            fdr_member=(r.root == 'SPXW' and r.kind == 'primary')))
    return pd.DataFrame(out)


def load_d():
    d = pd.read_parquet(os.path.join(S1, 'D.parquet'))
    d = d[d.param_kind == 'P'].copy()
    out = []
    for _, r in d.iterrows():
        e = int(r.expected_sign)
        direction = e if e != 0 else _sgn(r.effect)
        bucket_row = r.row_id in ('D5', 'D6')
        if r.outcome == 'V':
            econ, kind = r.ev_m1, 'E[V]-1'
            side = 'long' if direction > 0 else 'short'
            if bucket_row:      # own bucket (hv_*_used already applies the < 100 times fallback)
                hm = np.nan
                hp = r.hv_long_used if side == 'long' else r.hv_short_used
                src = f'D own bucket {r.hurdle_bucket} ({r.hurdle_source}, {r.hurdle_times:.0f} times)'
            else:
                hm = r.hv_long_mix if side == 'long' else r.hv_short_mix
                hp = r.hv_long_used if side == 'long' else r.hv_short_used
                src = 'D composition-matched (*_mix)'
        else:
            econ, kind, side = r.cond_mean, 'raw E[za]', 'dir'
            hm, hp, src = r.hurdle_z_mix, r.hz_used, 'D composition-matched (*_mix)'
        out.append(dict(
            family='D', row_id=r.row_id, arm=r.arm, root=r.root, outcome=r.outcome, horizon=str(r.horizon),
            param=str(r.param), label='CALC', desc=r.effect_kind, n_obs=r.n_obs, n_sess=r.n_sessions,
            effect=r.effect, ci_lo=r.ci_lo, ci_hi=r.ci_hi, p=r.p_value, p_method=r.p_method, expected_sign=e,
            econ=econ, econ_kind=kind, side=side, hurdle_matched=hm, hurdle_pooled=hp, hurdle_src=src,
            econ_lo=r.ev_m1_lo if r.outcome == 'V' else np.nan, econ_hi=r.ev_m1_hi if r.outcome == 'V' else np.nan,
            **{f'eff_{p}': r[f'eff_{p}'] for p in PER}, **{f'sess_{p}': r[f'sess_{p}'] for p in PER},
            fdr_member=bool(r.in_fdr_family)))
    return pd.DataFrame(out)


KEY = ['family', 'row_id', 'arm', 'outcome', 'horizon', 'param']


def clears(econ, h, side):
    if not (np.isfinite(econ) and np.isfinite(h)):
        return False
    if side == 'short':
        return econ < h
    return econ >= h if side == 'dir' else econ > h


def build():
    allc = pd.concat([load_ae(), load_bf(), load_c(), load_d()], ignore_index=True)
    fam = allc[allc.fdr_member & (allc.root == 'SPXW')].copy().reset_index(drop=True)
    na = fam[~np.isfinite(fam.p.astype(float))]
    fam = fam[np.isfinite(fam.p.astype(float))].reset_index(drop=True)
    q, _ = bh_fdr(fam.p.values, q=0.10)
    fam['q'] = q
    rep = allc[allc.root.isin(REP)].set_index(KEY + ['root']).effect
    rows = []
    for _, r in fam.iterrows():
        e = r.expected_sign
        dirn = e if e != 0 else _sgn(r.effect)
        c_sign = (e == 0 and dirn != 0) or (_sgn(r.effect) == e)
        c_fdr = r.q <= 0.10
        npq, nok = 0, 0
        for p in PER:
            if r[f'sess_{p}'] >= 30 and np.isfinite(r[f'eff_{p}']):
                npq += 1
                nok += _sgn(r[f'eff_{p}']) == dirn
        c_years = nok >= 2
        hused = r.hurdle_matched if np.isfinite(r.hurdle_matched) else r.hurdle_pooled
        hsrc = r.hurdle_src if np.isfinite(r.hurdle_matched) or r.family in ('C',) or r.row_id in ('D5', 'D6') \
            else r.hurdle_src + ' -> pooled (matched missing)'
        c_h = clears(r.econ, hused, r.side) and c_sign
        c_hp = clears(r.econ, r.hurdle_pooled, r.side) and c_sign
        reps = {}
        for rt in REP:
            k = tuple(r[c] for c in KEY) + (rt,)
            reps[rt] = rep.get(k, np.nan) if k in rep.index else np.nan
        nrep = sum(_sgn(v) == dirn for v in reps.values() if np.isfinite(v))
        c_rep = nrep >= 2
        d = r.to_dict()
        d.update(direction=dirn, c_sign=bool(c_sign), c_fdr=bool(c_fdr), periods_n30=npq, periods_same=nok,
                 c_years=bool(c_years), hurdle_used=hused, hurdle_used_src=hsrc, c_hurdle=bool(c_h),
                 c_hurdle_pooled=bool(c_hp), rep_SPY=reps['SPY'], rep_QQQ=reps['QQQ'], rep_IWM=reps['IWM'],
                 rep_same=nrep, c_rep=bool(c_rep))
        d['survivor'] = bool(c_sign and c_fdr and c_years and c_h and c_rep)
        rows.append(d)
    return pd.DataFrame(rows), na


def f3(x, s=True):
    if x is None or not np.isfinite(x):
        return '-'
    return f'{x:+.3f}' if s else f'{x:.3f}'


def fp(x):
    return '-' if not np.isfinite(x) else (f'{x:.4f}' if x >= 0.0001 else f'{x:.1e}')


def yn(b):
    return 'PASS' if b else 'fail'


def report(t, na):
    t = t.sort_values(['family', 'row_id', 'arm', 'outcome', 'horizon']).reset_index(drop=True)
    n = len(t)
    L = []
    L.append('# EDGE0DTE Stage 1: DISCOVERY aggregation (BH-FDR and the PROTOCOL section-4 pass rule)\n')
    L.append('Step 1 of the Stage-1 aggregator. **No new outcome was computed**: every number below is read from the four '
             'family tables `results/stage1/{AE,BF,C,D}.parquet` (DISCOVERY, 2020-02-18 .. 2023-12-31, sessions with a '
             'same-day expiry). Code: `families/agg_discovery.py`; machine-readable: `results/stage1/STAGE1_DISCOVERY.parquet` '
             '(+ `.csv`). No 2024, 2025 or 2026 data was read.\n')
    L.append('## The FDR family\n')
    L.append(f'* Every SPXW cell at its primary parameter P, across the four families: AE `in_fdr_family` (51), BF '
             f'param_role P on SPXW (77), C kind primary + param P on SPXW (34), D `in_fdr_family` (73). Excluded: grid '
             f'(G) cells, AE diagnostic rows, D3 single arms (D registered the top-minus-bottom arm as the test), '
             f'replication roots, baselines, and the Addendum-3 rows B8R / X12R (no DISCOVERY evidence by design).')
    for _, r in na.iterrows():
        L.append(f'* N/A, not counted: {r.family} {r.row_id} {r.arm} {r.outcome} h={r.horizon} (no finite p: '
                 f'{int(r.n_obs)} observations; the horizon passes the close).')
    L.append(f'* **FDR family size m = {n}** cells with a finite p. Benjamini-Hochberg at q = 0.10 with '
             f'`lib.stats.bh_fdr` over all {n}. Bootstrap p-values floor at 0.0005 (2,000 day resamples); E3 p is the '
             f'day-clustered OLS p, X3/X11 the clustered OLS t p (as registered).\n')
    L.append('## Criteria (all required)\n')
    L.append('| # | criterion | exact rule used |')
    L.append('|---|---|---|')
    L.append('| 0 | registered sign | effect has the REGISTRY sign (`expected_sign`). Wrong-sign cells never pass. D5 was registered two-sided (ln V != 0 per bucket), so its direction is the sign of its effect and the hurdle side follows it. |')
    L.append('| 1 | FDR | BH q <= 0.10 over the m cells. |')
    L.append('| 2 | years | among 2020-21 (pooled), 2022, 2023, the periods with >= 30 sessions in the cell; >= 2 of them have the per-period effect in the registered direction (fewer than 2 such periods = fail). |')
    L.append('| 3 | hurdle | point estimate vs `results/HURDLE.md` at that horizon. Z rows: the raw sign-aligned conditional mean E[za] of the events (what a long 0.30-delta option is paid on; X rows: the predicted-stronger group; BF X rows only supply the bucket-demeaned group mean; C X3/X11: the za-equivalent of the OLS coefficient) >= |E[za]|*. V rows: conditional E[V]-1 > the long hurdle (registered ln V > 0) or < "short profits only below" (registered ln V < 0). Hurdle used: the composition-matched one where the family supplied it (AE: median of the bucket hurdles over the events; BF: event-weighted bucket hurdle; D1-D4: `*_mix`, bucket hurdles weighted by the condition\'s time-of-day mix); D5/D6: their own 30-min bucket; C: pooled (bucket "all", none supplied). Thin-cell rule (D family): a bucket hurdle resting on < 100 times falls back to the pooled one (no SPXW bucket is thin: every SPXW bucket hurdle rests on >= 198 times). The pooled-hurdle verdict is also shown (`H pooled`); it changes no survivor verdict unless noted. |')
    L.append('| 4 | replication | the identical cell (row, arm, outcome, h, P) on SPY, QQQ, IWM: >= 2 of 3 point estimates in the registered direction. A replication cell that does not exist (C1/C2/X3/X11 need trade flow: SPY only) counts as not replicated. |')
    L.append('')
    c0 = t.c_sign; c1 = t.c_fdr; c2 = t.c_years; c3 = t.c_hurdle; c4 = t.c_rep
    L.append('## Filter counts\n')
    L.append('| filter | cells passing it alone | cumulative (in this order) |')
    L.append('|---|---:|---:|')
    cum = np.ones(n, bool)
    for name, c in [('registered sign', c0), ('BH q <= 0.10', c1), ('years (>= 2 periods, n >= 30)', c2),
                    ('hurdle', c3), ('replication (>= 2 of 3)', c4)]:
        cum &= c.values
        L.append(f'| {name} | {int(c.sum())} / {n} | {int(cum.sum())} |')
    L.append('')
    L.append(f'By family (cells / FDR-significant with the registered sign / survivors): ' + '; '.join(
        f'{f} {int((t.family == f).sum())} / {int(((t.family == f) & c0 & c1).sum())} / {int(((t.family == f) & t.survivor).sum())}'
        for f in ('AE', 'BF', 'C', 'D')) + '.\n')
    sig_wrong = t[c1 & ~c0]
    L.append(f'FDR-significant cells with the WRONG sign (never pass; reported): {len(sig_wrong)}: ' +
             ', '.join(f'{r.row_id}{(" " + r.arm) if r.arm else ""} {r.outcome} h{r.horizon} ({f3(r.effect)})'
                       for _, r in sig_wrong.iterrows()) + '.\n')
    s = t[t.survivor]
    L.append('## Survivors\n')
    if len(s) == 0:
        L.append('None.\n')
    else:
        L.append('| family | row | arm | out | h | n obs / sess | effect [95% CI] | p | q | per period 2020-21 / 2022 / 2023 (sess) | econ | hurdle used (pooled) | SPY / QQQ / IWM |')
        L.append('|---|---|---|---|---|---:|---|---:|---:|---|---|---|---|')
        for _, r in s.iterrows():
            ec = f3(r.econ)
            if np.isfinite(r.get('econ_lo', np.nan)):
                ec += f' [{f3(r.econ_lo)}, {f3(r.econ_hi)}]'
            L.append(f'| {r.family} | {r.row_id} | {r.arm} | {r.outcome} | {r.horizon} | {int(r.n_obs)} / {int(r.n_sess)} | '
                     f'{f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | {fp(r.p)} | {fp(r.q)} | '
                     f'{f3(r["eff_2020-21"])} ({int(r["sess_2020-21"])}) / {f3(r.eff_2022)} ({int(r.sess_2022)}) / {f3(r.eff_2023)} ({int(r.sess_2023)}) | '
                     f'{r.econ_kind} {ec} | {r.side} {f3(r.hurdle_used)} ({f3(r.hurdle_pooled)}) | '
                     f'{f3(r.rep_SPY)} / {f3(r.rep_QQQ)} / {f3(r.rep_IWM)} |')
        L.append('')
    near = t[c0 & c1 & c2 & c4 & ~c3]
    L.append('## Near misses: every criterion except the hurdle\n')
    L.append(f'{len(near)} cells are FDR-significant with the registered sign, consistent across periods and replicated, '
             f'but too small to pay for the option round trip. Largest economic sizes relative to the hurdle:\n')
    if len(near):
        near = near.assign(gap=np.where(near.side == 'short', near.hurdle_used - near.econ, near.econ - near.hurdle_used))
        L.append('| family | row | arm | out | h | effect | q | econ | hurdle used | gap (positive = clears) |')
        L.append('|---|---|---|---|---|---|---:|---|---|---:|')
        for _, r in near.sort_values('gap', ascending=False).head(20).iterrows():
            L.append(f'| {r.family} | {r.row_id} | {r.arm} | {r.outcome} | {r.horizon} | {f3(r.effect)} | {fp(r.q)} | '
                     f'{r.econ_kind} {f3(r.econ)} | {r.side} {f3(r.hurdle_used)} | {f3(r.gap)} |')
        L.append('')
    L.append('## Full table: every FDR-family cell\n')
    L.append('`dir` = registered direction (D5: sign of its effect, registered two-sided). `econ` = the economic-size '
             'measure of criterion 3 (Z rows: raw sign-aligned E[za]; V rows: conditional E[V]-1). `H` = hurdle used '
             '(side long / short-below / dir), `H pooled` = verdict against the pooled hurdle. Period columns: effect '
             '(sessions). Replication: point effect on SPY / QQQ / IWM ("-" = cell does not exist).\n')
    L.append('| family | row | arm | out | h | n obs / sess | effect [95% CI] | dir | p | q | sign | FDR | 2020-21 / 2022 / 2023 | years | econ | H used | hurdle | H pooled | SPY / QQQ / IWM | rep | SURVIVES |')
    L.append('|---|---|---|---|---|---:|---|:-:|---:|---:|:-:|:-:|---|:-:|---:|---|:-:|:-:|---|:-:|:-:|')
    for _, r in t.iterrows():
        L.append(f'| {r.family} | {r.row_id} | {r.arm} | {r.outcome} | {r.horizon} | {int(r.n_obs)} / {int(r.n_sess)} | '
                 f'{f3(r.effect)} [{f3(r.ci_lo)}, {f3(r.ci_hi)}] | {"+" if r.direction > 0 else "-"} | {fp(r.p)} | {fp(r.q)} | '
                 f'{yn(r.c_sign)} | {yn(r.c_fdr)} | '
                 f'{f3(r["eff_2020-21"])} ({int(r["sess_2020-21"])}) / {f3(r.eff_2022)} ({int(r.sess_2022)}) / {f3(r.eff_2023)} ({int(r.sess_2023)}) | '
                 f'{yn(r.c_years)} {r.periods_same}/{r.periods_n30} | {f3(r.econ)} | {r.side} {f3(r.hurdle_used)} | {yn(r.c_hurdle)} | '
                 f'{yn(r.c_hurdle_pooled)} | {f3(r.rep_SPY)} / {f3(r.rep_QQQ)} / {f3(r.rep_IWM)} | {yn(r.c_rep)} {r.rep_same}/3 | '
                 f'{"**YES**" if r.survivor else "no"} |')
    L.append('')
    L.append('## Not in the FDR family\n')
    L.append('* REGISTRY_ADDENDUM_3 rows B8R (one-hour-shock momentum, h = 30, 60) and X12R (OR breakout low-VIX minus '
             'high-VIX tercile, h = 60, close): suggested by DISCOVERY (they are the opposite sign of B8 and X12), so their '
             'DISCOVERY numbers are contaminated and are not evidence. They go to the one CALIBRATION look with their own '
             'rule (Holm over 4 tests, hurdle, replication), see `STAGE1_CALIBRATION.md`.')
    L.append('* Grid (G) and diagnostic rows and SPY/QQQ/IWM cells: sensitivity / replication only (family reports).')
    return '\n'.join(L) + '\n'


def main():
    t, na = build()
    t.to_parquet(os.path.join(S1, 'STAGE1_DISCOVERY.parquet'), index=False)
    t.to_csv(os.path.join(S1, 'STAGE1_DISCOVERY.csv'), index=False)
    with open(os.path.join(HERE, 'results', 'STAGE1_DISCOVERY.md'), 'w') as f:
        f.write(report(t, na))
    s = t[t.survivor]
    print('m =', len(t), 'N/A =', len(na))
    print('sign', int(t.c_sign.sum()), 'fdr', int(t.c_fdr.sum()), 'sign&fdr', int((t.c_sign & t.c_fdr).sum()),
          'years', int(t.c_years.sum()), 'hurdle', int(t.c_hurdle.sum()), 'rep', int(t.c_rep.sum()))
    print(s[['family', 'row_id', 'arm', 'outcome', 'horizon', 'effect', 'q', 'econ', 'hurdle_used', 'hurdle_pooled',
             'c_hurdle_pooled', 'rep_same']].to_string())
    json.dump(s[KEY].to_dict('records'), open(os.path.join(S1, 'STAGE1_SURVIVORS.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
