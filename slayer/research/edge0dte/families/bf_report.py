"""BF.md report and ledger lines from results/stage1/BF.parquet.

  python3 -m families.bf_report [extra_markdown_file]      # writes results/stage1/BF.md
  python3 -m families.bf_report --ledger                    # appends one line per registry row to research-v2-ledger.md
"""
import datetime
import os
import sys

import numpy as np
import pandas as pd

from families.bf_stage1 import OUT_RES, ROOTS

LEDGER = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'research-v2-ledger.md')

DESC = {
    'B1': 'opening-range breakout: first 5-min close beyond the 30-min OR (P OR30; G OR15, OR60); one event per session',
    'B2': 'failed breakout: every fresh 5-min close beyond the OR30 (previous close inside), then a 5-min close back inside within W min (P 30; G 15, 60); dir = toward the opposite OR side',
    'B3a': 'VWAP acceptance: N consecutive 5-min closes beyond session VWAP, the first of them the crossing close (P 3; G 2, 4)',
    'B3b': 'VWAP rejection: previous 5-min close on one side, bar low/high within tol x sigma_30 of VWAP, close beyond the band (P 0.1; G 0.05, 0.2); dir = away from VWAP',
    'B4': 'EMA alignment: last complete bar close > EMA9 > EMA21 on all of 1/5/15/30/60-min (or all inverted), EMAs warmed on 10 prior sessions; state at every grid time (P 5 of 5; G >= 4, >= 3 of 5 with none opposite)',
    'B5': 'trend exhaustion: |ln(S/open 09:30)| > k x IV_atm(t) sqrt(minutes since open) and last-15-min return opposite; state on the grid (P 1.5; G 1.0, 2.0); dir = against the day',
    'B6': 'momentum acceleration: |Z_5min| > k, 5-min and 15-min returns same sign, |r5|/5 > |r15|/15 (per minute); state on the grid (P 2; G 1.5, 2.5)',
    'B7': 'intraday momentum: sign of ln(S(10:00)/prior close) (P, with gap) or ln(S(10:00)/09:30 open) (G); event at close - 30 min, outcome Z to the close; IC = Spearman(return, Z_close)',
    'B8': 'intraday reversal: |Z over the last 60 min| > k, dir = against it (P 2; G 1.5, 2.5); state on the grid; IC = Spearman(-Z_last60, excess Z) over all grid times',
    'F1': 'structure: last 2 confirmed swing highs AND lows strictly rising (HH+HL) or falling (LH+LL); state at every 5-min close (P 2 swings; G 3)',
    'F2': 'break of structure: first 5-min close (P) / wick (G) beyond the last confirmed swing in the F1 trend direction (trend and swing as known at the previous close)',
    'F3': 'change of character: first 5-min close (P) / wick (G) beyond the last confirmed swing AGAINST the prevailing F1 trend; dir = new direction',
    'F4': 'displacement: 5-min range > m x ATR(14 five-min bars before it, prior session included) and close in the outer 20% (P 2; G 1.5, 3)',
    'F5': 'liquidity sweep: previous 5-min close inside, wick beyond prior-day high/low or the last confirmed swing, close back inside (P PDH/PDL + swings; G PDH/PDL only); dir = back into range',
    'F6': 'failed auction: new session high/low, then n consecutive 5-min closes back inside the prior range with no new extreme (P 3 = 15 min; G 2, 6); dir = away from the extreme',
    'F7': 'order block: F4(P) displacement whose close is the first close beyond the last confirmed swing in its direction; block = last opposite-colour 5-min bar before it; event = first 1-min bar trading back into the body (P), wick range (G wick1), first two retests (G body2)',
    'F8': 'fair value gap: bar1.high < bar3.low (bull) / bar1.low > bar3.high (bear), size >= g x sigma_15 at the bar-3 close (P 0.25; G 0.1, 0.5); event = first 1-min bar trading back into the gap; dir = gap direction',
    'F9': 'inverse FVG: first 5-min close (P) / 5-min wick (G) through an F8(P) gap against its direction; dir = closing direction',
    'X1': 'B4(P) alignment effect when GEX(t) < 0 minus when GEX(t) > 0 (G: GEX at 09:45)',
    'X2': 'B2(P) failed-breakout effect when GEX(t) > 0 minus GEX(t) < 0 (G: GEX at 09:45)',
    'X5': 'F5(P) sweep effect when a swept level is within 0.25 sigma_30 of the A4 wall on its side (call wall for high sweeps, put wall for low sweeps) minus elsewhere',
    'X6': 'B3b(P) VWAP-rejection effect when GEX(t) > 0 minus GEX(t) < 0 (G: GEX at 09:45)',
    'X12': "B1(P) OR-breakout effect when VIX(t) is in the top trailing tercile minus the bottom tercile (cut points from the prior 252 sessions' VIX closes)",
}


def f2(x, s='+.3f'):
    try:
        return '-' if x is None or not np.isfinite(x) else format(x, s)
    except TypeError:
        return '-'


def load():
    df = pd.read_parquet(os.path.join(OUT_RES, 'BF.parquet'))
    order = list(DESC)
    df['_o'] = df.row_id.map(order.index)
    df['_h'] = df.horizon.map({'15': 0, '30': 1, '60': 2, 'close': 3})
    return df.sort_values(['_o', '_h', 'param_role'], ascending=[True, True, False])


def report(extra=''):
    df = load()
    L = []
    L.append('# EDGE0DTE Stage 1 - family BF (intraday price behaviour, market structure, price delivery, conditional tests)\n')
    L.append('DISCOVERY only (expiry sessions 2020-02-18 .. 2023-12-31). No 2024/2025/2026 outcome was computed. Raw results: no FDR and '
             'no pass/fail here (the aggregator applies BH-FDR across all families). Files: `BF.parquet` / `BF.csv` (one row per row_id x root x '
             'horizon x parameter); event tables `v2data/edge0dte/stage1/BF_events_<root>.parquet` (not in git); code `families/bf.py` (features, '
             'leakage-registered), `families/bf_stage1.py` (events + statistics), `families/bf_report.py`, `families/test_bf_leakage.py`.\n')
    L.append('## Definitions\n')
    L.append('* Bars: 1-minute OBS bars (SPX index for SPXW, the ETF otherwise); 5-minute bars aligned at 09:30, usable when their last minute has '
             'closed. Swing (REGISTRY F): a 5-min high strictly above the 2 highs on each side (low mirrored), within the session; CONFIRMED at the '
             'close of bar i+2 and never used before (tested). Structural decisions at bar k use swings confirmed by the close of bar k-1.')
    L.append('* Decision time t = the close of the event bar (5-min boundary; F7/F8 retests = the close of the 1-minute bar that traded into the '
             'zone). Only events with 09:45 <= t <= close - 30 min (the Stage-1 grid window) are tested; events of one (row, param) at the same '
             '(day, t) are merged (opposite directions dropped). State rows (B4, B5, B6, B8, F1) are evaluated at every grid time where the state holds.')
    L.append('* Outcome Z(t,h) = ln(S(t+h)/S(t)) / (IV_atm(t) sqrt(h)) (CALC, lib.outcomes). effect = mean over events of dir x (Z - mu), mu = '
             'the unconditional DISCOVERY mean of Z_h of the same root over all grid times of the same 30-minute bucket; `mean_za_raw` (parquet) = '
             'the same without mu. CI/p: day-clustered bootstrap, 2,000 resamples (lib.stats.boot_mean); X rows: difference between regimes '
             '(lib.stats.boot_diff). Per-year columns: 2020-21 pooled, 2022, 2023 with n events and sessions.')
    L.append("* Hurdle: HURDLE.md hz (the |E[za]| a long 0.30-delta option needs) for the root, the event's 30-min bucket and h, averaged over the "
             "events (missing cell -> pooled cell); X rows use the predicted-stronger regime's events. expected_sign = +1 for every cell (dir is the "
             "registry's predicted direction; X: predicted-stronger regime minus the other).")
    L.append('* Labels: bars, ETF volume, VIX = OBS; VWAP, EMAs, swings, ATR, Z = CALC; GEX sign and call/put walls = MODEL (lib.dealer.exposures, '
             'same-day OI, REGISTRY dealer convention: dealers long calls / short puts). **SPXW B3a/B3b use SPY\'s session VWAP and SPY\'s 5-minute '
             'closes (SPX has no volume): labelled "SPY VWAP proxy"**; the band uses the SPXW board\'s sigma_30 (a log distance, so unit-free). '
             "VIX tercile: VIX 1-min close at t vs the 1/3, 2/3 quantiles of the prior 252 sessions' daily VIX closes (point-in-time, >= 40 prior closes).\n")
    for r, d in DESC.items():
        L.append(f'* **{r}** {d}')
    L.append('')
    L.append('## Summary: P cells with the 95% CI excluding 0 AND |effect| beyond the hurdle (descriptive; FDR, year and replication checks are the aggregator\'s)\n')
    P = df[df.param_role == 'P']
    for root in ROOTS:
        s = P[(P.root == root) & P.ci_excludes_0 & P.effect_beyond_hurdle]
        items = [f'{r.row_id} h{r.horizon} {r.effect:+.3f} [{r.ci_lo:+.3f},{r.ci_hi:+.3f}] (hurdle {r.hurdle:.2f}, n {r.n_obs})' for r in s.itertuples()]
        L.append(f'* {root}: ' + ('; '.join(items) if items else 'none'))
    L.append('\nP cells with the CI excluding 0 but |effect| below the hurdle:\n')
    for root in ROOTS:
        s = P[(P.root == root) & P.ci_excludes_0 & ~P.effect_beyond_hurdle]
        items = [f'{r.row_id} h{r.horizon} {r.effect:+.3f} (hurdle {r.hurdle:.2f})' for r in s.itertuples()]
        L.append(f'* {root}: ' + ('; '.join(items) if items else 'none'))
    L.append('')
    L.append('## SPXW, primary parameters (the FDR-family cells)\n')
    L.append('Year columns: effect (sessions). `**` = CI excludes 0 and |effect| > hurdle.\n')
    L.append('| row | h | n | sess | effect [95% CI] | p | hurdle | 2020-21 | 2022 | 2023 | IC [95% CI] |')
    L.append('|---|---|---:|---:|---|---:|---:|---|---|---|---|')
    for r in P[P.root == 'SPXW'].itertuples():
        ys = []
        for y in ('2020-21', '2022', '2023'):
            e, n = df.loc[r.Index, f'effect_{y}'], df.loc[r.Index, f'nsess_{y}']
            ys.append(f'{f2(e)} ({0 if not np.isfinite(n) else int(n)})')
        ic = '' if not np.isfinite(df.loc[r.Index, 'ic']) else f"{r.ic:+.3f} [{r.ic_lo:+.3f}, {r.ic_hi:+.3f}]"
        mark = ' **' if (r.ci_excludes_0 and r.effect_beyond_hurdle) else ''
        L.append(f'| {r.row_id}{mark} | {r.horizon} | {r.n_obs} | {r.n_sessions} | {f2(r.effect)} [{f2(r.ci_lo)}, {f2(r.ci_hi)}] | '
                 f'{f2(r.p_value, ".4f")} | {f2(r.hurdle, ".2f")} | {" | ".join(ys)} | {ic} |')
    L.append('')
    L.append('### Conditional tests by root: regime effects (a = predicted-stronger regime, b = the other)\n')
    L.append('| row | root | variant | h | n a / b | effect a | effect b | diff [95% CI] | p |')
    L.append('|---|---|---|---|---|---|---|---|---:|')
    for r in df[df.row_id.str.startswith('X')].sort_values(['_o', 'root', 'param_role', '_h'], ascending=[True, True, False, True]).itertuples():
        L.append(f'| {r.row_id} | {r.root} | {r.param_role} {r.param} | {r.horizon} | {f2(r.n_a, ".0f")} / {f2(r.n_b, ".0f")} | {f2(r.effect_a)} | '
                 f'{f2(r.effect_b)} | {f2(r.effect)} [{f2(r.ci_lo)}, {f2(r.ci_hi)}] | {f2(r.p_value, ".4f")} |')
    L.append('')
    L.append('## Replication (P): effect [95% CI] n by root\n')
    L.append('| row | h | SPXW | SPY | QQQ | IWM | ETFs with the SPXW sign |')
    L.append('|---|---|---|---|---|---|---:|')
    for (row, h), g in P.groupby(['row_id', 'horizon'], sort=False):
        g = g.set_index('root')
        cells, signs = [], []
        for root in ROOTS:
            if root in g.index and np.isfinite(g.loc[root, 'effect']):
                r = g.loc[root]
                star = '*' if r.ci_excludes_0 else ''
                cells.append(f'{r.effect:+.3f}{star} [{r.ci_lo:+.3f},{r.ci_hi:+.3f}] n{int(r.n_obs)}')
                signs.append(np.sign(r.effect))
            else:
                cells.append('-')
                signs.append(np.nan)
        same = sum(1 for s in signs[1:] if np.isfinite(s) and s == signs[0]) if np.isfinite(signs[0]) else 0
        L.append(f'| {row} | {h} | ' + ' | '.join(cells) + f' | {same}/3 |')
    L.append('\n`*` = CI excludes 0.\n')
    L.append('## SPXW grid (G) sensitivity - reported, never used to choose\n')
    L.append('| row | param | h | n | effect [95% CI] | p | hurdle |')
    L.append('|---|---|---|---:|---|---:|---:|')
    for r in df[(df.root == 'SPXW') & (df.param_role == 'G')].itertuples():
        L.append(f'| {r.row_id} | {r.param} | {r.horizon} | {r.n_obs} | {f2(r.effect)} [{f2(r.ci_lo)}, {f2(r.ci_hi)}] | {f2(r.p_value, ".4f")} | {f2(r.hurdle, ".2f")} |')
    L.append('')
    L.append('## N/A cells\n')
    na = df[df.effect.isna()]
    if len(na):
        for r in na.itertuples():
            L.append(f'* {r.row_id} {r.root} h{r.horizon} {r.param_role} {r.param}: n = {r.n_obs}'
                     + (f' (regime a {f2(r.n_a, ".0f")} / b {f2(r.n_b, ".0f")})' if r.row_id.startswith('X') else '') + ': too few events')
    else:
        L.append('* none: every registered row x root x horizon x parameter cell has data.')
    L.append('')
    with open(os.path.join(OUT_RES, 'BF.md'), 'w') as f:
        f.write('\n'.join(L) + '\n' + extra)
    print('\n'.join(L))


def ledger():
    df = load()
    day = datetime.date.today().isoformat()
    lines = []
    for row in DESC:
        g = df[(df.row_id == row) & (df.param_role == 'P')]
        sp = g[g.root == 'SPXW']
        parts = []
        for r in sp.itertuples():
            parts.append(f'h{r.horizon} {f2(r.effect)} [{f2(r.ci_lo)},{f2(r.ci_hi)}] p{f2(r.p_value, ".3f")} hurdle {f2(r.hurdle, ".2f")}')
        rep = []
        for root in ROOTS[1:]:
            q = g[g.root == root]
            rep.append(f"{root} " + '/'.join(f2(x, '+.2f') for x in q.effect))
        n = int(sp.n_obs.max()) if len(sp) else 0
        ns = int(sp.n_sessions.max()) if len(sp) else 0
        lines.append(f'{day} | EDGE0DTE-S1 | BF {row} SPXW P (sign-aligned excess Z vs same-bucket mean) | DISCOVERY | {n} ev / {ns} sess | '
                     f"{'; '.join(parts)}; replication {'; '.join(rep)} | raw, no FDR (aggregator); edge0dte/results/stage1/BF.md")
    with open(LEDGER, 'a') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print(len(lines), 'lines ->', os.path.abspath(LEDGER))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--ledger':
        ledger()
    else:
        report(open(sys.argv[1]).read() if len(sys.argv) > 1 else '')
