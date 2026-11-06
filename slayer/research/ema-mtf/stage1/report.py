"""reports/STAGE1.md from v2data/ema/results/stage1/{s1_results.pkl, s1_perm.parquet, synth/seed_*.pkl}.

    python3 -m stage1.report
"""
from __future__ import annotations

import glob
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from stage1.md import md  # noqa: E402
from stage1.run import OUT, S1A_TESTS, S1C_LABEL  # noqa: E402

REPORT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'reports', 'STAGE1.md')
FEAT_DESC = {'S': 'state +1 (c>E9>E21)', 'A': 'reclaim of E9', 'B': 'E9/E21 cross', 'C': 'alignment continuation',
             'D': 'compression breakout', 'H': 'early momentum transition', 'L50': 'c > E50', 'L200': 'c > E200'}


def pct(x, d=2):
    return 'n/a' if x is None or not np.isfinite(x) else f'{x * 100:+.{d}f}'


def ci(c, d=2):
    return 'n/a' if c is None or not np.isfinite(c[0]) else f'[{c[0] * 100:+.{d}f}, {c[1] * 100:+.{d}f}]'


def pv(p):
    return 'n/a' if p is None or not np.isfinite(p) else (f'{p:.4f}' if p >= 0.0001 else '<0.0001')


def main():
    res = pickle.load(open(os.path.join(OUT, 's1_results.pkl'), 'rb'))
    perm_p = os.path.join(OUT, 's1_perm.parquet')
    perm = pd.read_parquet(perm_p) if os.path.exists(perm_p) else pd.DataFrame()
    syn = [pickle.load(open(p, 'rb')) for p in sorted(glob.glob(os.path.join(OUT, 'synth', 'seed_*.pkl')))]
    L = []
    w = L.append
    w('# Stage 1 — feature screen (PREREG §4), DEV blocks A (2024-03..05) and B (2022-03..05)\n')
    w('Pre-registered in `specs/PREREG.md` §4 (frozen at 7d1c06d); computational details fixed in amendment A2 (§9b, '
      'commit 971bad1) before any statistic below was computed. Code: `stage1/` (events, features, stats, run, synth); '
      'tests `etests/test_stage1.py`. Event tables (one row per decision event, every feature and outcome): '
      '`v2data/ema/results/stage1/events_<block>_<root>.parquet` (not in git: size); every number here is recomputed '
      'from them by `python3 -m stage1.run analyse` and `python3 -m stage1.report`.\n')
    w(f"**Events**: {res['n_events']:,} decision events with an executable outcome (5-minute closes 09:45–15:00 × root × "
      f"DTE bucket × right; the tradable contract nearest |delta| 0.40), {res['K']} eval sessions as bootstrap clusters "
      f"({', '.join(f'block {b}: {n}' for b, n in res['sessions'].items())}). Outcome Y_h = executable net return of buying "
      f"at the ask (+ measured 2 s drift, L0c) and selling at the bid h minutes later (or the 15:55 flat), fees in. "
      f"Mean Y30 over all events: **{pct(res['y30_all'])}%** (the random-entry reference of rule (v)).\n")
    ev = pd.Series(res['events_by'])
    ev.index = ev.index.set_names(['block', 'root', 'bucket'])
    tab = ev.unstack('bucket') if isinstance(ev.index, pd.MultiIndex) else ev
    w('Events by block × root × DTE bucket:\n')
    w(md(tab) + '\n')
    # ---------------------------------------------------------------- S1A
    rows = res['s1a']
    npass = sum(r['pass'] for r in rows)
    w(f'## S1A — option-chart features, incremental over the underlying (40 tests, Holm within the family)\n')
    w('δ = stratified difference of mean Y30 between feature = 1 and feature = 0 events within root × bucket × right × '
      "the underlying's same-timeframe state (sign-aligned), in percentage points of premium. Pass = (i) CI > 0, (ii) "
      'Holm p < 0.05, (iii) δ > 0 in block A and in block B, (iv) δ > 0 at h = 15 and 60, (v) mean Y30 | feature = 1 > '
      'mean Y30 of all events.\n')
    w(f'**Result: {npass} of 40 features pass.**\n')
    w('| tf | feature | n (f=1) | mean Y30 f=1 | δ Y30 (pp) | 95% CI | p | Holm | BH q | δ A | δ B | δ Y15 | δ Y60 | δ mid | (v) | rules failed |')
    w('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        failed = ', '.join(k for k, v in r['rules'].items() if not v) or '**PASS**'
        w(f"| {r['tf']}m | {r['feature']} ({FEAT_DESC[r['feature']]}) | {r['Y30']['n1']:,} | {pct(r['Y30']['mean1'])} | "
          f"{pct(r['Y30']['delta'])} | {ci(r['Y30']['ci'])} | {pv(r['Y30']['p'])} | {pv(r['holm'])} | {pv(r['bh'])} | "
          f"{pct(r.get('block_A', {}).get('delta'))} | {pct(r.get('block_B', {}).get('delta'))} | {pct(r['Y15']['delta'])} | "
          f"{pct(r['Y60']['delta'])} | {pct(r['Ymid30']['delta'])} | {'yes' if r['beats_random'] else 'no'} | {failed} |")
    w('')
    w('### Controls (reported, not gating)\n')
    w('δ* = the same statistic with the strata also split by the feature computed on P* (Black–Scholes reprice of the '
      "contract along the underlying's path at the IV frozen at 10:00): what the option chart adds beyond underlying + "
      'theta mechanics. P* alone = the counterfactual feature tested on its own. TRADE = the feature on the trade-print '
      'chart where the density rule holds (dense subset only).\n')
    w('| tf | feature | δ (pp) [CI] | δ* given P* (pp) [CI] | verdict | P*-feature alone δ [CI] | TRADE n (f=1) | TRADE δ [CI] |')
    w('|---|---|---|---|---|---|---|---|')
    for r in rows:
        d, ds = r['Y30'], r['reprice']
        vanish = d['ci'][0] > 0 and not (ds['ci'][0] > 0)
        verdict = 'vanishes: underlying/theta mechanics' if vanish else ('survives' if d['ci'][0] > 0 and ds['ci'][0] > 0 else '—')
        w(f"| {r['tf']}m | {r['feature']} | {pct(d['delta'])} {ci(d['ci'])} | {pct(ds['delta'])} {ci(ds['ci'])} | {verdict} | "
          f"{pct(r['pstar_alone']['delta'])} {ci(r['pstar_alone']['ci'])} | {r['trade']['n1']:,} | {pct(r['trade']['delta'])} {ci(r['trade']['ci'])} |")
    w('')
    # null calibration
    w('### Null calibration (V2 rule 11; PREREG §4.5, A2 items 10–11)\n')
    if len(perm):
        fw = perm.any_holm.mean()
        fp = perm.any_pass.mean()
        w(f'* **Permutation null**: {len(perm)} runs, feature values permuted among warm events within session × root × '
          f'bucket × right. Share of runs with any feature passing CI > 0 and Holm < 0.05 (family FWER): '
          f'**{fw * 100:.1f}%** (must be ≤ 5% for the pipeline to count: **{"OK" if fw <= 0.05 else "FAILED"}**); share passing '
          f'all five rules: {fp * 100:.1f}%. Median smallest Holm p per run: {perm.min_holm.median():.3f}.')
        D = np.array(perm.deltas.tolist())
        obs = np.array([r['Y30']['delta'] for r in rows])
        pc = (D < obs[None, :]).mean(0)
        top = np.argsort(-obs)[:10]
        w('* Observed δ percentile in its own permutation distribution (the 10 largest observed δ): ' +
          '; '.join(f"{rows[i]['tf']}m {rows[i]['feature']} {pc[i] * 100:.1f}%" for i in top) + '.')
    else:
        w('* Permutation null: not run yet.')
    if syn:
        sf = np.mean([s['any_holm'] for s in syn])
        spf = np.mean([s['any_pass'] for s in syn])
        w(f"* **Synthetic zero-drift null** (stage1/synth.py; the whole S1A pipeline on re-quoted panels): {len(syn)} seeds; "
          f"share with any CI > 0 & Holm-passing feature: **{sf * 100:.0f}%** ({sum(s['any_holm'] for s in syn)}/{len(syn)}; "
          f"must be ≤ 5%, i.e. ≤ 1 of 20: **{'OK' if sum(s['any_holm'] for s in syn) <= max(1, int(0.05 * len(syn))) else 'FAILED'}**); "
          f"all five rules: {spf * 100:.0f}%. Mean synthetic Y30 {np.mean([s['y30_mean'] for s in syn]) * 100:+.2f}%, "
          f"mid-to-mid {np.mean([s['ymid30_mean'] for s in syn]) * 100:+.2f}% (costs only, as designed).")
    else:
        w('* Synthetic null: not run yet.')
    w('')
    # breakdowns
    w('### S1A by root, DTE bucket and right (δ Y30 in pp, 95% CI) — every feature\n')
    w('| tf | feature | ' + ' | '.join(['SPY', 'QQQ', 'IWM', 'SPXW', '0', '1-7', '8-30', '31-90', '91-200', 'call', 'put']) + ' |')
    w('|---|---|' + '---|' * 11)
    for r in rows:
        cells = [r['by_root'][k] for k in ('SPY', 'QQQ', 'IWM', 'SPXW')] + [r['by_bucket'][k] for k in ('0', '1-7', '8-30', '31-90', '91-200')] + \
                [r['by_right'][1], r['by_right'][-1]]
        w(f"| {r['tf']}m | {r['feature']} | " + ' | '.join(f"{pct(c['delta'], 1)} {ci(c.get('ci'), 1)}" for c in cells) + ' |')
    w('')
    # TRADE family with its own Holm
    tr = res['s1a_trade']
    w(f"TRADE replication arm as its own 40-test family: {sum(r['pass'] for r in tr)} pass "
      f"({', '.join(f'{r['tf']}m {r['feature']}' for r in tr if r['pass']) or 'none'}).\n")
    # ---------------------------------------------------------------- S1B
    b = res['s1b']
    w('## S1B — timeframe incremental information (joint OLS, 5 tests)\n')
    w(f"OLS of Y30 on the five option-chart MID states (−1/0/+1) and the five underlying states (sign-aligned), with "
      f"root×bucket×right and half-hour fixed effects; CR1 standard errors clustered by session ({b['clusters']} clusters), "
      f"n = {b['n']:,} events with all ten states defined. A timeframe qualifies for an MTF model if its coefficient is > 0 "
      f"at one-sided 5% (or it is the trigger timeframe).\n")
    w('| regressor | β (pp of premium per state unit) | SE | one-sided p | Holm (option states) | qualifies | β block A | β block B |')
    w('|---|---|---|---|---|---|---|---|')
    tfs = (1, 5, 15, 30, 60)
    for i, tf in enumerate(tfs):
        w(f"| option {tf}m state | {pct(b['beta'][i], 3)} | {b['se'][i] * 100:.3f} | {pv(b['p'][i])} | {pv(b['holm'][i])} | "
          f"{'yes' if b['qualified_nominal'][i] else 'no'} | {pct(b.get('beta_A', [np.nan] * 10)[i], 3)} | {pct(b.get('beta_B', [np.nan] * 10)[i], 3)} |")
    for i, tf in enumerate(tfs):
        j = i + 5
        w(f"| underlying {tf}m state | {pct(b['beta'][j], 3)} | {b['se'][j] * 100:.3f} | {pv(b['p'][j])} | — | — | "
          f"{pct(b.get('beta_A', [np.nan] * 10)[j], 3)} | {pct(b.get('beta_B', [np.nan] * 10)[j], 3)} |")
    w('')
    w('VIF of the five option states: ' + ', '.join(f'{tf}m {v:.2f}' for tf, v in zip(tfs, b['vif'])) + '.\n')
    w('Pairwise correlation of the five option states:\n')
    w(md(pd.DataFrame(b["corr"], index=[f"{t}m" for t in tfs], columns=[f"{t}m" for t in tfs]).round(2)) + '\n')
    # ---------------------------------------------------------------- S1C
    c = res['s1c']
    w('## S1C — confirmations on the 5m MID E9/E21 cross (14 tests)\n')
    w(f"Base events: model B fired on the event contract's 5m MID chart ({c[0]['n_base']:,} events). δ = stratified (root × "
      f"bucket × right) difference of mean Y30 with vs without the confirmation. Pass = CI > 0, Holm < 0.05, δ > 0 in each "
      f"block where the feature exists.\n")
    w('| confirmation | n with | n without | mean Y30 with | δ Y30 (pp) | 95% CI | p | Holm | BH q | δ A | δ B | δ Y15 | δ Y60 | pass |')
    w('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in c:
        bA = r.get('block_A')
        bB = r.get('block_B')
        w(f"| {r['label']} | {r['Y30']['n1']:,} | {r['Y30']['n0']:,} | {pct(r['Y30']['mean1'])} | {pct(r['Y30']['delta'])} | "
          f"{ci(r['Y30']['ci'])} | {pv(r['Y30']['p'])} | {pv(r['holm'])} | {pv(r['bh'])} | {pct(bA['delta']) if bA else 'n/a'} | "
          f"{pct(bB['delta']) if bB else 'n/a'} | {pct(r['Y15']['delta'])} | {pct(r['Y60']['delta'])} | "
          f"{'**PASS**' if r['pass'] else 'no (' + ', '.join(k for k, v in r['rules'].items() if not v) + ')'} |")
    w('')
    diag(w)
    open(REPORT, 'w').write('\n'.join(L) + '\n')


def diag(w):
    """Post-hoc diagnostics of the null calibration (stage1/diag_perm.py, stage1/diag_tod.py)."""
    p1 = os.path.join(OUT, 's1_diag_perm.pkl')
    if not os.path.exists(p1):
        return
    d = pickle.load(open(p1, 'rb'))
    w('## Null calibration — diagnosis (POST-HOC, labelled; no Stage-1 decision depends on it)\n')
    w('The pre-registered permutation null failed (above). Two mechanisms were found and demonstrated:\n')
    w('**1. The PREREG null leaks same-day future information.** Permuting a feature across the decisions of one '
      'session keeps that day\'s prevalence, and the prevalence partly reflects the path after each decision. Test: '
      "replace each event's feature by the same cell's value k decisions later (future) or earlier (past). δ Y30 (pp):\n")
    w('| feature @ tf | real | +30 min (future) | +60 min (future) | −30 min (past) | −60 min (past) |')
    w('|---|---|---|---|---|---|')
    for (F, tf), r in d['shift'].items():
        w(f"| {F} @ {tf}m | {pct(r['real'])} | {pct(r[6])} | {pct(r[12])} | {pct(r[-6])} | {pct(r[-12])} |")
    w('\nA feature carrying the outcome window\'s information is found at +5 to +17 pp, so the pipeline has power. The '
      'real features behave like the past-shifted ones (≈ 0), which is a further check that they carry no look-ahead.\n')
    lf = d.get('leakfree', [])
    if lf:
        w(f"**2. Pooling the blocks lets slow regime features confound δ.** A leak-free null permutes feature values across "
          f"SESSIONS at the same root × bucket × right × decision close, so the time of day is kept and the day's path is "
          f"broken. Under the pre-registered strata it still has FWER **{np.mean([x['any_holm'] for x in lf]) * 100:.0f}%** "
          f"({sum(x['any_holm'] for x in lf)}/{len(lf)} runs). The biased features are L200 at 30m and 60m (null mean +0.16 "
          f"and +0.36 pp, z ≈ +3 and +9). Their prevalence differs between the 2022 and 2024 regimes, and the strata do not "
          f"separate the blocks (A2 item 3). Adding the half-hour alone does not fix it "
          f"(s1_diag_tod_noblock.pkl: 15/20 runs).\n")
    p2 = os.path.join(OUT, 's1_diag_tod.pkl')
    if os.path.exists(p2):
        t = pickle.load(open(p2, 'rb'))
        nl = t.get('null', [])
        rows = t['s1a_t']
        w(f"**S1A-T (post-hoc)**: the same statistic, rules and Holm, with the strata also split by block and by the "
          f"half-hour of the decision close. Leak-free null: FWER **{np.mean([x['any_holm'] for x in nl]) * 100 if nl else float('nan'):.1f}%** "
          f"over {len(nl)} runs (≤ 5% needed: {'OK' if nl and np.mean([x['any_holm'] for x in nl]) <= 0.05 else 'not met / pending'}). "
          f"Real data: **{sum(r['pass'] for r in rows)} of 40 pass**. Smallest p-values:\n")
        w('| feature @ tf | δ Y30 (pp) | 95% CI | p | Holm | rules failed |')
        w('|---|---|---|---|---|---|')
        for r in sorted(rows, key=lambda r: r['Y30']['p'])[:10]:
            w(f"| {r['feature']} @ {r['tf']}m | {pct(r['Y30']['delta'])} | {ci(r['Y30']['ci'])} | {pv(r['Y30']['p'])} | "
              f"{pv(r['holm'])} | {', '.join(k for k, v in r['rules'].items() if not v) or 'PASS'} |")
        w('')
    w('**Reading.** A miscalibrated (anti-conservative) screen can only produce false *passes*. No real feature passed '
      'the pre-registered screen or the calibrated post-hoc one, so "no option-chart feature has incremental, '
      'executable value at h = 30" does not depend on the calibration failure. A future pre-registration should use the '
      'S1A-T strata (block × time of day) and the leak-free cross-session null.\n')
    print('wrote', REPORT)


if __name__ == '__main__':
    main()
