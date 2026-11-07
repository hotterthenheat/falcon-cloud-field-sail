# EDGE0DTE Stage 1, family D (volatility): D1-D6, DISCOVERY only

Raw results: no FDR applied and no pass/fail declared (the aggregator applies BH-FDR across every family). Machine-readable: `results/stage1/D.parquet` / `D.csv` (one row per row_id x arm x root x outcome x horizon x parameter); frozen tercile/quintile cutoffs for the CALIBRATION look: `results/stage1/D_cutoffs.json`. Code: `families/d_vol.py` (features), `families/d_stage1.py` (tests), `families/test_d_leakage.py` (leakage test), `families/d_report.py` (this file).

## Scope and data

* Universe U1: SPXW (primary, the only root in the FDR family), SPY / QQQ / IWM (replication, reported only). Sessions: DISCOVERY (2020-02-18 .. 2023-12-31) with a same-day expiry; the panel is read with a `split == DISCOVERY` filter, so no 2024 (CALIBRATION), 2025 (HOLDOUT) or 2026 outcome was read or computed.
* Decision times: the 5-minute grid 09:45-15:30 (lib.panel.grid; early-close days stop at 12:30). Horizons 15, 30, 60 min and close.
* Labels: 1-minute bars (SPX index for SPXW, the ETF for SPY/QQQ/IWM) OBS; option board mids OBS; IV_atm, RV, features d_rv30_rel / d_semivar60 / d_iv_rv60, Z, V CALC; hurdles CALC from OBS fills (HURDLE.md). No MODEL input is used by any D row. Nothing is INTERP.
* No ThetaData request was made (all inputs on disk).

## Features (registry definition, primary parameter P, grid G)

| row | feature | definition | first defined | P | G |
|---|---|---|---|---|---|
| D1 | d_rv30_rel | RV(t-30m,t) / median of RV over the same clock window in the prior 20 NYSE sessions (>= 10 valid) | 10:05 | > 2 | > 1.5, > 3 |
| D2 | d_rv30_rel | same ratio | 10:05 | < 0.5 | < 0.4, < 0.67 |
| D3 | d_semivar60 | (RS+ - RS-) / RV over the last 60 min | 10:35 | top / bottom tercile (pooled DISCOVERY cutoffs) | quintile |
| D4 | d_iv_rv60 | IV_atm(t)^2 / annualised RV of the last 60 min | 10:35 | lowest / highest tercile | quintile |
| D5 | bucket | 30-min time-of-day bucket (09:30 = 09:45-09:55 ... 15:30 = 15:30) | - | 30-min | 60-min |
| D6 | time | the 09:45 decision, h = close | - | 09:45 | 10:00, 10:30, 12:00 |

RV = sum of squared 1-minute log returns of bar closes; endpoints required, <= 10% interior closes missing (a missing close is spanned, never filled).

## Statistics

* D1-D4 (conditional): effect = mean over the condition of d (y - mu_t), y = ln V (D1, D2, D4) or Z (D3), mu_t = the unconditional DISCOVERY mean of y at the same 5-minute grid time, d = +1 / -1 the registry direction (D3 is sign-aligned: top tercile short, bottom tercile long). 95% CI and two-sided p: day-clustered bootstrap (2,000 resamples of days, mu_t re-estimated inside each resample). IC: Spearman of the feature vs y - mu_t with a day-clustered CI (one per feature x h; for D1/D2 it is the same IC of ln ratio).
* D5, D6 (level): effect = mean ln V vs 0 (subtracting the same-time mean would be identically zero); day-clustered bootstrap (lib.stats.boot_mean).
* Per period: the same statistic inside 2020-21, 2022, 2023 (mu_t re-estimated within the period), with sessions.
* Economic size: the effects above are in ln V (or Z) units; the hurdles are in E[V]-1 units, so every V row also carries E[V]-1 inside the condition (day-clustered CI) and E[Z^2]-1 (terminal move, the supplementary hurdle). Long side clears when E[V]-1 > "E[V]-1 long"; short side when E[V]-1 < "short below" (a short straddle / iron-fly proxy, before the wing cost, makes money only below it). D1-D4 rows use the pooled ("all") bucket hurdle of their root/h; the `*_mix` columns in the parquet weight the 30-min bucket hurdles by the condition's own time-of-day composition. D5 uses its own bucket, D6 the bucket of its time.
* Flags (descriptive only): CI!0 = effect CI excludes 0; >H = point estimate beyond the hurdle (Z rows: effect >= |E[za]|*; V rows: E[V]-1 beyond the side's hurdle); >H(CI) = the whole CI beyond it; Z2>H = E[Z^2]-1 > the supplementary long Z^2 hurdle.
* Null calibration (V2 house rule 11): day-permutation null (1,000 permutations of whole days' condition vectors at the same grid times) -> perm p; pipeline false-positive rate below.

## Headline (raw, DISCOVERY; descriptive only)

* SPXW: effect CI excludes 0 in 71/72 primary cells; effect CI excludes 0 AND the whole economic CI is beyond the hurdle in 2: D2 compression h60 (E[V]-1 -0.46 [-0.49, -0.44] vs short-below -0.36); D4 high h60 (E[V]-1 -0.50 [-0.52, -0.48] vs short-below -0.36).
* SPY: effect CI excludes 0 in 72/72 primary cells; effect CI excludes 0 AND the whole economic CI is beyond the hurdle in 11: D2 compression h60 (E[V]-1 -0.50 [-0.52, -0.47] vs short-below -0.36); D2 compression hclose (E[V]-1 -0.36 [-0.40, -0.32] vs short-below -0.25); D4 high h60 (E[V]-1 -0.55 [-0.57, -0.53] vs short-below -0.36); D4 high hclose (E[V]-1 -0.38 [-0.40, -0.34] vs short-below -0.25); D5 12:30 h60 (E[V]-1 -0.41 [-0.44, -0.38] vs short-below -0.36, pooled fallback); D5 13:00 h60 (E[V]-1 -0.40 [-0.43, -0.37] vs short-below -0.36, pooled fallback); D5 13:30 h60 (E[V]-1 -0.40 [-0.43, -0.37] vs short-below -0.36, pooled fallback); D5 14:30 h60 (E[V]-1 -0.44 [-0.46, -0.42] vs short-below -0.36, pooled fallback); D5 14:30 hclose (E[V]-1 -0.34 [-0.36, -0.32] vs short-below -0.25, pooled fallback); D5 15:00 hclose (E[V]-1 -0.39 [-0.41, -0.37] vs short-below -0.25, pooled fallback); D5 15:30 hclose (E[V]-1 -0.43 [-0.45, -0.41] vs short-below -0.25, pooled fallback).
* QQQ: effect CI excludes 0 in 70/72 primary cells; effect CI excludes 0 AND the whole economic CI is beyond the hurdle in 9: D2 compression h60 (E[V]-1 -0.46 [-0.49, -0.43] vs short-below -0.34); D2 compression hclose (E[V]-1 -0.41 [-0.44, -0.36] vs short-below -0.27); D4 high h60 (E[V]-1 -0.53 [-0.55, -0.51] vs short-below -0.34); D4 high hclose (E[V]-1 -0.42 [-0.44, -0.39] vs short-below -0.27); D5 14:30 h60 (E[V]-1 -0.43 [-0.45, -0.40] vs short-below -0.34, pooled fallback); D5 14:30 hclose (E[V]-1 -0.36 [-0.38, -0.34] vs short-below -0.27, pooled fallback); D5 15:00 h60 (E[V]-1 -0.38 [-0.40, -0.36] vs short-below -0.34, pooled fallback); D5 15:00 hclose (E[V]-1 -0.40 [-0.42, -0.38] vs short-below -0.27, pooled fallback); D5 15:30 hclose (E[V]-1 -0.43 [-0.45, -0.41] vs short-below -0.27, pooled fallback).
* IWM: effect CI excludes 0 in 67/72 primary cells; effect CI excludes 0 AND the whole economic CI is beyond the hurdle in 5: D2 compression hclose (E[V]-1 -0.42 [-0.45, -0.38] vs short-below -0.29); D4 high hclose (E[V]-1 -0.45 [-0.47, -0.42] vs short-below -0.29); D5 14:30 hclose (E[V]-1 -0.41 [-0.44, -0.38] vs short-below -0.29, pooled fallback); D5 15:00 hclose (E[V]-1 -0.48 [-0.50, -0.46] vs short-below -0.29, pooled fallback); D5 15:30 hclose (E[V]-1 -0.52 [-0.54, -0.50] vs short-below -0.29, pooled fallback).
* No long-gamma cell (D1 expansion, D4 low, any D5 bucket on the long side) comes near its long hurdle on SPXW: E[V]-1 stays at or below 0 even where ln V is significantly above its same-time mean; the conditional information is real in ln V units but far too small for a long straddle after costs.
* D3 has the OPPOSITE sign to the registry (both arms), |effect| <= 0.05 against |E[za]|* 0.10-0.18; IWM null.
* The short-side cells that clear (D2 compression and D4 high IV/RV at h = 60 on SPXW/SPY/QQQ, and at close on SPY/QQQ/IWM) clear the short hurdle "before the wing cost" of an iron fly; D2 and D4-high overlap (low trailing RV relative to history ~ high IV/RV). HURDLE.md has no short-side Z^2 hurdle; E[Z^2]-1 in those cells is close to E[V]-1 at h = 60 but near 0 at close, i.e. the terminal move a short straddle to the close pays for is not as cheap as V says.
* Replication D5 flags at late buckets use the pooled fallback hurdle (their own bucket cells have 30 times); on SPXW, where every bucket hurdle rests on >= 198 times, no D5 bucket clears its own short hurdle with its CI.

## Leakage tests and bulk cross-check

```
PASS  D future-bar invariance d_iv_rv60: 320/320
PASS  D future-bar invariance d_rv30_rel: 320/320
PASS  D future-bar invariance d_semivar60: 320/320
PASS  D past-bar sensitivity d_rv30_rel: 320/320
PASS  D past-bar sensitivity d_semivar60: 320/320
PASS  D targeted leak d_iv_rv60: 320/320
PASS  D targeted leak d_rv30_rel: 320/320
PASS  D targeted leak d_semivar60: 320/320
PASS  canary leak detected: 1/1
PASS  fills refuse: 3/3
PASS  guard allows 2024: 1/1
PASS  guard refuses: 3/3
PASS  guard refuses 2026: 1/1
PASS  guard refuses unregistered sha: 1/1
PASS  leak bars_upto: 160/160
PASS  leak board: 160/160
PASS  leak exposures_G7: 160/160
PASS  leak exposures_P: 160/160
PASS  leak feature:d_iv_rv60: 160/160
PASS  leak feature:d_rv30_rel: 160/160
PASS  leak feature:d_semivar60: 160/160
PASS  leak feature:etf_vol_ratio30: 160/160
PASS  leak feature:gex_total: 160/160
PASS  leak feature:rv_ratio30: 160/160
PASS  leak feature:vix: 160/160
PASS  leak feature:vix1d: 160/160
PASS  leak feature:z_prev30: 160/160
PASS  leak iv_atm: 160/160
PASS  leak select_atm: 160/160
PASS  leak select_call: 160/160
PASS  leak select_put: 160/160
PASS  leak sigma_15: 160/160
PASS  leak sigma_30: 160/160
PASS  leak sigma_60: 160/160
PASS  leak sigma_close: 160/160
PASS  leak smile: 160/160
PASS  leak spot: 160/160
PASS  outcome endpoint 15: 160/160
PASS  outcome endpoint 30: 160/160
PASS  outcome endpoint 60: 139/139
PASS  outcome endpoint close: 160/160
PASS  outcome horizon 15: 160/160
PASS  outcome horizon 30: 160/160
PASS  outcome horizon 60: 139/139
PASS  outcome horizon close: 160/160
targeted D times: 320 finite values per feature: {'d_rv30_rel': 320, 'd_semivar60': 320, 'd_iv_rv60': 319}
TOTAL PASS 7488 checks, 0 failures
```

* SPXW: bulk vs registered features on 1750 rows / 25 sessions: d_rv30_rel 1750/1750 equal (1650 finite), d_semivar60 1750/1750 equal (1500 finite), d_iv_rv60 1750/1750 equal (1500 finite)
* SPY: bulk vs registered features on 1750 rows / 25 sessions: d_rv30_rel 1750/1750 equal (1650 finite), d_semivar60 1750/1750 equal (1500 finite), d_iv_rv60 1750/1750 equal (1500 finite)
* QQQ: bulk vs registered features on 1750 rows / 25 sessions: d_rv30_rel 1750/1750 equal (1650 finite), d_semivar60 1750/1750 equal (1500 finite), d_iv_rv60 1750/1750 equal (1500 finite)
* IWM: bulk vs registered features on 1750 rows / 25 sessions: d_rv30_rel 1750/1750 equal (1650 finite), d_semivar60 1750/1750 equal (1500 finite), d_iv_rv60 1750/1750 equal (1498 finite)

## V hurdles both ways (the short-premium question)

For each V row with its primary parameter: E[V]-1 inside the condition vs the long hurdle (E[V]-1 a long straddle needs) and the short hurdle (E[V]-1 below which a short straddle / iron fly makes money before wings), and E[Z^2]-1 vs the supplementary Z^2 long hurdle (V only partly drives straddle P&L: corr(V, Z^2) is 0.44-0.63 in HURDLE.md). HURDLE.md has no short-side Z^2 hurdle.

| root | row | arm | h | E[V]-1 [95% CI] | long hurdle | short below | long clears? | short clears? | E[Z^2]-1 [95% CI] | Z^2 long hurdle |
|---|---|---|---|---:|---:|---:|---|---|---:|---:|
| SPXW | D1 | expansion | 15 | -0.07 [-0.11, -0.04] | +1.58 | -1.06 | no | no | -0.02 [-0.08, +0.04] | +1.31 |
| SPXW | D1 | expansion | 30 | -0.09 [-0.13, -0.06] | +0.70 | -0.64 | no | no | -0.02 [-0.09, +0.05] | +0.65 |
| SPXW | D1 | expansion | 60 | -0.12 [-0.16, -0.09] | +0.16 | -0.36 | no | no | -0.05 [-0.14, +0.04] | +0.40 |
| SPXW | D1 | expansion | close | -0.12 [-0.15, -0.08] | -0.04 | -0.30 | no | no | +0.16 [-0.04, +0.43] | +0.47 |
| SPXW | D2 | compression | 15 | -0.49 [-0.51, -0.46] | +1.58 | -1.06 | no | no | -0.45 [-0.49, -0.41] | +1.31 |
| SPXW | D2 | compression | 30 | -0.48 [-0.50, -0.45] | +0.70 | -0.64 | no | no | -0.42 [-0.47, -0.37] | +0.65 |
| SPXW | D2 | compression | 60 | -0.46 [-0.49, -0.44] | +0.16 | -0.36 | no | yes (CI) | -0.38 [-0.44, -0.32] | +0.40 |
| SPXW | D2 | compression | close | -0.30 [-0.34, -0.26] | -0.04 | -0.30 | no | point | +0.06 [-0.14, +0.31] | +0.47 |
| SPXW | D4 | high | 15 | -0.57 [-0.58, -0.55] | +1.58 | -1.06 | no | no | -0.52 [-0.55, -0.49] | +1.31 |
| SPXW | D4 | high | 30 | -0.53 [-0.55, -0.52] | +0.70 | -0.64 | no | no | -0.47 [-0.51, -0.42] | +0.65 |
| SPXW | D4 | high | 60 | -0.50 [-0.52, -0.48] | +0.16 | -0.36 | no | yes (CI) | -0.40 [-0.46, -0.32] | +0.40 |
| SPXW | D4 | high | close | -0.28 [-0.31, -0.26] | -0.04 | -0.30 | no | no | +0.03 [-0.12, +0.21] | +0.47 |
| SPXW | D4 | low | 15 | -0.04 [-0.07, -0.02] | +1.58 | -1.06 | no | no | +0.01 [-0.04, +0.07] | +1.31 |
| SPXW | D4 | low | 30 | -0.07 [-0.10, -0.05] | +0.70 | -0.64 | no | no | -0.01 [-0.07, +0.06] | +0.65 |
| SPXW | D4 | low | 60 | -0.13 [-0.16, -0.11] | +0.16 | -0.36 | no | no | -0.07 [-0.13, +0.00] | +0.40 |
| SPXW | D4 | low | close | -0.15 [-0.18, -0.12] | -0.04 | -0.30 | no | no | +0.15 [-0.03, +0.35] | +0.47 |
| SPXW | D5 | 09:30 | 15 | +0.55 [+0.49, +0.61] | +2.24 | -0.38 | no | no | +0.57 [+0.46, +0.70] | +2.44 |
| SPXW | D5 | 09:30 | 30 | +0.47 [+0.42, +0.52] | +1.22 | -0.06 | no | no | +0.55 [+0.42, +0.70] | +1.38 |
| SPXW | D5 | 09:30 | 60 | +0.28 [+0.23, +0.32] | +0.59 | +0.05 | no | no | +0.40 [+0.25, +0.58] | +1.03 |
| SPXW | D5 | 09:30 | close | -0.19 [-0.22, -0.17] | -0.13 | -0.39 | no | no | +0.05 [-0.07, +0.17] | +0.20 |
| SPXW | D5 | 10:00 | 15 | +0.36 [+0.31, +0.40] | +5.71 | -1.39 | no | no | +0.47 [+0.37, +0.59] | +3.03 |
| SPXW | D5 | 10:00 | 30 | +0.26 [+0.22, +0.30] | +1.49 | -0.36 | no | no | +0.42 [+0.30, +0.56] | +1.76 |
| SPXW | D5 | 10:00 | 60 | +0.12 [+0.08, +0.17] | +0.76 | -0.09 | no | no | +0.29 [+0.15, +0.44] | +1.15 |
| SPXW | D5 | 10:00 | close | -0.19 [-0.22, -0.16] | -0.03 | -0.33 | no | no | +0.06 [-0.06, +0.19] | +0.31 |
| SPXW | D5 | 10:30 | 15 | +0.06 [+0.02, +0.11] | +0.81 | -0.45 | no | no | +0.19 [+0.07, +0.35] | +1.37 |
| SPXW | D5 | 10:30 | 30 | +0.02 [-0.02, +0.08] | +0.31 | -0.24 | no | no | +0.17 [+0.02, +0.35] | +0.71 |
| SPXW | D5 | 10:30 | 60 | -0.05 [-0.10, -0.00] | +0.19 | -0.21 | no | no | +0.06 [-0.06, +0.18] | +0.43 |
| SPXW | D5 | 10:30 | close | -0.19 [-0.22, -0.16] | -0.14 | -0.30 | no | no | +0.07 [-0.06, +0.22] | +0.30 |
| SPXW | D5 | 11:00 | 15 | -0.09 [-0.12, -0.05] | +0.56 | -0.54 | no | no | -0.04 [-0.12, +0.03] | +1.12 |
| SPXW | D5 | 11:00 | 30 | -0.12 [-0.16, -0.08] | +0.37 | -0.39 | no | no | -0.06 [-0.15, +0.03] | +0.55 |
| SPXW | D5 | 11:00 | 60 | -0.19 [-0.23, -0.16] | +0.29 | -0.25 | no | no | -0.12 [-0.21, -0.02] | +0.27 |
| SPXW | D5 | 11:00 | close | -0.20 [-0.22, -0.17] | -0.03 | -0.30 | no | no | +0.09 [-0.06, +0.25] | +0.27 |
| SPXW | D5 | 11:30 | 15 | -0.24 [-0.27, -0.20] | +0.26 | -0.60 | no | no | -0.18 [-0.24, -0.11] | +0.84 |
| SPXW | D5 | 11:30 | 30 | -0.26 [-0.29, -0.23] | +0.20 | -0.50 | no | no | -0.23 [-0.30, -0.15] | +0.47 |
| SPXW | D5 | 11:30 | 60 | -0.31 [-0.34, -0.28] | -0.02 | -0.49 | no | no | -0.32 [-0.38, -0.25] | +0.18 |
| SPXW | D5 | 11:30 | close | -0.20 [-0.23, -0.17] | -0.04 | -0.30 | no | no | +0.08 [-0.07, +0.26] | +0.33 |
| SPXW | D5 | 12:00 | 15 | -0.35 [-0.37, -0.32] | +0.55 | -0.94 | no | no | -0.31 [-0.36, -0.25] | +0.83 |
| SPXW | D5 | 12:00 | 30 | -0.37 [-0.40, -0.35] | +0.32 | -0.71 | no | no | -0.33 [-0.39, -0.27] | +0.29 |
| SPXW | D5 | 12:00 | 60 | -0.38 [-0.41, -0.36] | +0.07 | -0.51 | no | no | -0.31 [-0.38, -0.24] | +0.02 |
| SPXW | D5 | 12:00 | close | -0.19 [-0.22, -0.16] | -0.04 | -0.26 | no | no | +0.09 [-0.07, +0.28] | +0.47 |
| SPXW | D5 | 12:30 | 15 | -0.43 [-0.45, -0.40] | -0.00 | -0.77 | no | no | -0.38 [-0.42, -0.32] | +0.50 |
| SPXW | D5 | 12:30 | 30 | -0.41 [-0.43, -0.38] | -0.09 | -0.60 | no | no | -0.34 [-0.41, -0.27] | +0.13 |
| SPXW | D5 | 12:30 | 60 | -0.40 [-0.42, -0.37] | -0.26 | -0.55 | no | no | -0.28 [-0.36, -0.19] | -0.07 |
| SPXW | D5 | 12:30 | close | -0.19 [-0.22, -0.16] | +0.01 | -0.26 | no | no | +0.14 [-0.03, +0.34] | +0.41 |
| SPXW | D5 | 13:00 | 15 | -0.41 [-0.44, -0.38] | -0.11 | -0.74 | no | no | -0.33 [-0.39, -0.26] | +0.36 |
| SPXW | D5 | 13:00 | 30 | -0.42 [-0.45, -0.39] | -0.08 | -0.76 | no | no | -0.31 [-0.39, -0.23] | +0.07 |
| SPXW | D5 | 13:00 | 60 | -0.38 [-0.41, -0.36] | -0.24 | -0.50 | no | no | -0.30 [-0.37, -0.21] | +0.03 |
| SPXW | D5 | 13:00 | close | -0.19 [-0.22, -0.16] | -0.14 | -0.32 | no | no | +0.16 [-0.03, +0.40] | +0.44 |
| SPXW | D5 | 13:30 | 15 | -0.45 [-0.47, -0.42] | +0.46 | -0.94 | no | no | -0.43 [-0.47, -0.38] | +0.42 |
| SPXW | D5 | 13:30 | 30 | -0.40 [-0.43, -0.38] | +0.02 | -0.66 | no | no | -0.39 [-0.44, -0.32] | +0.07 |
| SPXW | D5 | 13:30 | 60 | -0.38 [-0.40, -0.35] | -0.22 | -0.44 | no | no | -0.30 [-0.39, -0.20] | +0.01 |
| SPXW | D5 | 13:30 | close | -0.21 [-0.24, -0.17] | +0.02 | -0.28 | no | no | +0.12 [-0.06, +0.37] | +0.40 |
| SPXW | D5 | 14:00 | 15 | -0.40 [-0.43, -0.37] | +1.24 | -0.98 | no | no | -0.34 [-0.40, -0.29] | +0.66 |
| SPXW | D5 | 14:00 | 30 | -0.40 [-0.43, -0.37] | +0.15 | -0.67 | no | no | -0.31 [-0.38, -0.23] | +0.18 |
| SPXW | D5 | 14:00 | 60 | -0.36 [-0.39, -0.33] | -0.16 | -0.46 | no | no | -0.25 [-0.35, -0.09] | +0.18 |
| SPXW | D5 | 14:00 | close | -0.22 [-0.24, -0.18] | -0.05 | -0.31 | no | no | +0.07 [-0.08, +0.27] | +0.69 |
| SPXW | D5 | 14:30 | 15 | -0.42 [-0.45, -0.40] | -0.12 | -0.59 | no | no | -0.37 [-0.42, -0.31] | +0.31 |
| SPXW | D5 | 14:30 | 30 | -0.40 [-0.43, -0.38] | -0.08 | -0.46 | no | no | -0.35 [-0.42, -0.26] | +0.06 |
| SPXW | D5 | 14:30 | 60 | -0.35 [-0.37, -0.33] | -0.12 | -0.35 | no | point | -0.29 [-0.36, -0.20] | +0.22 |
| SPXW | D5 | 14:30 | close | -0.24 [-0.26, -0.21] | +0.09 | -0.24 | no | no | +0.02 [-0.11, +0.15] | +0.45 |
| SPXW | D5 | 15:00 | 15 | -0.42 [-0.44, -0.41] | -0.13 | -0.66 | no | no | -0.42 [-0.46, -0.38] | +0.03 |
| SPXW | D5 | 15:00 | 30 | -0.39 [-0.40, -0.37] | -0.22 | -0.52 | no | no | -0.34 [-0.40, -0.27] | +0.14 |
| SPXW | D5 | 15:00 | 60 | -0.23 [-0.26, -0.21] | -0.18 | -0.31 | no | no | +0.00 [-0.13, +0.17] | +1.16 |
| SPXW | D5 | 15:00 | close | -0.23 [-0.25, -0.21] | -0.10 | -0.31 | no | no | +0.02 [-0.12, +0.19] | +0.90 |
| SPXW | D5 | 15:30 | 15 | -0.44 [-0.46, -0.41] | -0.05 | -0.60 | no | no | -0.42 [-0.48, -0.35] | -0.08 |
| SPXW | D5 | 15:30 | 30 | -0.22 [-0.25, -0.19] | +0.56 | -0.51 | no | no | -0.01 [-0.14, +0.15] | +0.50 |
| SPXW | D5 | 15:30 | close | -0.22 [-0.25, -0.19] | +0.56 | -0.51 | no | no | -0.01 [-0.14, +0.15] | +0.50 |
| SPXW | D6 | 09:45 | close | -0.19 [-0.22, -0.16] | -0.13 | -0.39 | no | no | +0.04 [-0.07, +0.16] | +0.20 |
| SPY | D1 | expansion | 15 | -0.11 [-0.14, -0.07] | +1.84 | -1.25 | no | no | -0.15 [-0.21, -0.10] | +1.16 |
| SPY | D1 | expansion | 30 | -0.13 [-0.17, -0.10] | +0.74 | -0.68 | no | no | -0.18 [-0.24, -0.12] | +0.59 |
| SPY | D1 | expansion | 60 | -0.15 [-0.18, -0.12] | +0.24 | -0.36 | no | no | -0.19 [-0.26, -0.12] | +0.31 |
| SPY | D1 | expansion | close | -0.17 [-0.20, -0.14] | -0.10 | -0.25 | no | no | -0.00 [-0.19, +0.22] | +0.26 |
| SPY | D2 | compression | 15 | -0.53 [-0.55, -0.50] | +1.84 | -1.25 | no | no | -0.55 [-0.58, -0.52] | +1.16 |
| SPY | D2 | compression | 30 | -0.52 [-0.54, -0.50] | +0.74 | -0.68 | no | no | -0.53 [-0.57, -0.48] | +0.59 |
| SPY | D2 | compression | 60 | -0.50 [-0.52, -0.47] | +0.24 | -0.36 | no | yes (CI) | -0.49 [-0.54, -0.44] | +0.31 |
| SPY | D2 | compression | close | -0.36 [-0.40, -0.32] | -0.10 | -0.25 | no | yes (CI) | -0.10 [-0.29, +0.17] | +0.26 |
| SPY | D4 | high | 15 | -0.62 [-0.63, -0.61] | +1.84 | -1.25 | no | no | -0.63 [-0.65, -0.61] | +1.16 |
| SPY | D4 | high | 30 | -0.59 [-0.61, -0.58] | +0.74 | -0.68 | no | no | -0.59 [-0.62, -0.55] | +0.59 |
| SPY | D4 | high | 60 | -0.55 [-0.57, -0.53] | +0.24 | -0.36 | no | yes (CI) | -0.53 [-0.58, -0.45] | +0.31 |
| SPY | D4 | high | close | -0.38 [-0.40, -0.34] | -0.10 | -0.25 | no | yes (CI) | -0.16 [-0.31, +0.03] | +0.26 |
| SPY | D4 | low | 15 | -0.06 [-0.09, -0.04] | +1.84 | -1.25 | no | no | -0.12 [-0.17, -0.07] | +1.16 |
| SPY | D4 | low | 30 | -0.10 [-0.12, -0.07] | +0.74 | -0.68 | no | no | -0.15 [-0.21, -0.09] | +0.59 |
| SPY | D4 | low | 60 | -0.15 [-0.17, -0.12] | +0.24 | -0.36 | no | no | -0.20 [-0.26, -0.14] | +0.31 |
| SPY | D4 | low | close | -0.17 [-0.20, -0.14] | -0.10 | -0.25 | no | no | -0.01 [-0.16, +0.16] | +0.26 |
| SPY | D5 | 09:30 | 15 | +0.47 [+0.41, +0.54] | +1.84 (pooled) | -1.25 (pooled) | no | no | +0.35 [+0.24, +0.46] | +1.16 (pooled) |
| SPY | D5 | 09:30 | 30 | +0.41 [+0.36, +0.47] | +0.74 (pooled) | -0.68 (pooled) | no | no | +0.36 [+0.23, +0.50] | +0.59 (pooled) |
| SPY | D5 | 09:30 | 60 | +0.24 [+0.20, +0.29] | +0.24 (pooled) | -0.36 (pooled) | point | no | +0.22 [+0.08, +0.38] | +0.31 (pooled) |
| SPY | D5 | 09:30 | close | -0.20 [-0.22, -0.17] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.08 [-0.18, +0.03] | +0.26 (pooled) |
| SPY | D5 | 10:00 | 15 | +0.32 [+0.27, +0.37] | +3.09 | -0.91 | no | no | +0.30 [+0.21, +0.41] | +2.03 |
| SPY | D5 | 10:00 | 30 | +0.23 [+0.18, +0.27] | +1.13 | -0.21 | no | no | +0.25 [+0.13, +0.37] | +1.27 |
| SPY | D5 | 10:00 | 60 | +0.10 [+0.05, +0.14] | +0.62 | -0.03 | no | no | +0.11 [-0.02, +0.25] | +0.75 |
| SPY | D5 | 10:00 | close | -0.20 [-0.22, -0.17] | -0.03 | -0.23 | no | no | -0.08 [-0.19, +0.05] | +0.15 |
| SPY | D5 | 10:30 | 15 | +0.04 [-0.01, +0.08] | +1.84 (pooled) | -1.25 (pooled) | no | no | +0.01 [-0.09, +0.15] | +1.16 (pooled) |
| SPY | D5 | 10:30 | 30 | -0.00 [-0.05, +0.05] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.01 [-0.14, +0.15] | +0.59 (pooled) |
| SPY | D5 | 10:30 | 60 | -0.08 [-0.12, -0.03] | +0.24 (pooled) | -0.36 (pooled) | no | no | -0.12 [-0.22, -0.02] | +0.31 (pooled) |
| SPY | D5 | 10:30 | close | -0.20 [-0.23, -0.17] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.07 [-0.19, +0.07] | +0.26 (pooled) |
| SPY | D5 | 11:00 | 15 | -0.11 [-0.15, -0.07] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.18 [-0.24, -0.11] | +1.16 (pooled) |
| SPY | D5 | 11:00 | 30 | -0.15 [-0.18, -0.11] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.22 [-0.29, -0.14] | +0.59 (pooled) |
| SPY | D5 | 11:00 | 60 | -0.21 [-0.24, -0.18] | +0.24 (pooled) | -0.36 (pooled) | no | no | -0.27 [-0.35, -0.18] | +0.31 (pooled) |
| SPY | D5 | 11:00 | close | -0.21 [-0.23, -0.18] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.05 [-0.19, +0.11] | +0.26 (pooled) |
| SPY | D5 | 11:30 | 15 | -0.26 [-0.29, -0.22] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.29 [-0.35, -0.22] | +1.16 (pooled) |
| SPY | D5 | 11:30 | 30 | -0.28 [-0.31, -0.25] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.34 [-0.40, -0.26] | +0.59 (pooled) |
| SPY | D5 | 11:30 | 60 | -0.32 [-0.35, -0.29] | +0.24 (pooled) | -0.36 (pooled) | no | no | -0.41 [-0.46, -0.35] | +0.31 (pooled) |
| SPY | D5 | 11:30 | close | -0.22 [-0.24, -0.19] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.05 [-0.19, +0.11] | +0.26 (pooled) |
| SPY | D5 | 12:00 | 15 | -0.36 [-0.39, -0.33] | +0.83 | -1.19 | no | no | -0.41 [-0.45, -0.35] | +0.58 |
| SPY | D5 | 12:00 | 30 | -0.38 [-0.41, -0.35] | +0.43 | -0.78 | no | no | -0.43 [-0.49, -0.37] | +0.14 |
| SPY | D5 | 12:00 | 60 | -0.39 [-0.41, -0.36] | +0.04 | -0.51 | no | no | -0.40 [-0.47, -0.33] | -0.10 |
| SPY | D5 | 12:00 | close | -0.22 [-0.25, -0.19] | -0.10 | -0.22 | no | no | -0.05 [-0.19, +0.12] | +0.27 |
| SPY | D5 | 12:30 | 15 | -0.43 [-0.45, -0.40] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.45 [-0.50, -0.40] | +1.16 (pooled) |
| SPY | D5 | 12:30 | 30 | -0.41 [-0.44, -0.38] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.43 [-0.49, -0.36] | +0.59 (pooled) |
| SPY | D5 | 12:30 | 60 | -0.41 [-0.44, -0.38] | +0.24 (pooled) | -0.36 (pooled) | no | yes (CI) | -0.38 [-0.46, -0.29] | +0.31 (pooled) |
| SPY | D5 | 12:30 | close | -0.23 [-0.25, -0.19] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.02 [-0.18, +0.16] | +0.26 (pooled) |
| SPY | D5 | 13:00 | 15 | -0.43 [-0.46, -0.40] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.44 [-0.49, -0.38] | +1.16 (pooled) |
| SPY | D5 | 13:00 | 30 | -0.44 [-0.47, -0.41] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.43 [-0.49, -0.36] | +0.59 (pooled) |
| SPY | D5 | 13:00 | 60 | -0.40 [-0.43, -0.37] | +0.24 (pooled) | -0.36 (pooled) | no | yes (CI) | -0.42 [-0.48, -0.35] | +0.31 (pooled) |
| SPY | D5 | 13:00 | close | -0.24 [-0.27, -0.21] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.03 [-0.19, +0.18] | +0.26 (pooled) |
| SPY | D5 | 13:30 | 15 | -0.47 [-0.49, -0.44] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.51 [-0.55, -0.46] | +1.16 (pooled) |
| SPY | D5 | 13:30 | 30 | -0.42 [-0.45, -0.40] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.48 [-0.53, -0.42] | +0.59 (pooled) |
| SPY | D5 | 13:30 | 60 | -0.40 [-0.43, -0.37] | +0.24 (pooled) | -0.36 (pooled) | no | yes (CI) | -0.41 [-0.49, -0.33] | +0.31 (pooled) |
| SPY | D5 | 13:30 | close | -0.27 [-0.29, -0.23] | -0.10 (pooled) | -0.25 (pooled) | no | point | -0.06 [-0.22, +0.15] | +0.26 (pooled) |
| SPY | D5 | 14:00 | 15 | -0.44 [-0.46, -0.41] | +0.80 | -0.97 | no | no | -0.45 [-0.50, -0.41] | +0.39 |
| SPY | D5 | 14:00 | 30 | -0.44 [-0.46, -0.41] | +0.10 | -0.69 | no | no | -0.44 [-0.50, -0.38] | +0.01 |
| SPY | D5 | 14:00 | 60 | -0.41 [-0.44, -0.38] | -0.16 | -0.48 | no | no | -0.39 [-0.48, -0.25] | +0.06 |
| SPY | D5 | 14:00 | close | -0.30 [-0.32, -0.27] | -0.15 | -0.30 | no | point | -0.12 [-0.26, +0.04] | +0.37 |
| SPY | D5 | 14:30 | 15 | -0.49 [-0.52, -0.47] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.52 [-0.56, -0.47] | +1.16 (pooled) |
| SPY | D5 | 14:30 | 30 | -0.47 [-0.50, -0.45] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.49 [-0.55, -0.42] | +0.59 (pooled) |
| SPY | D5 | 14:30 | 60 | -0.44 [-0.46, -0.42] | +0.24 (pooled) | -0.36 (pooled) | no | yes (CI) | -0.44 [-0.50, -0.37] | +0.31 (pooled) |
| SPY | D5 | 14:30 | close | -0.34 [-0.36, -0.32] | -0.10 (pooled) | -0.25 (pooled) | no | yes (CI) | -0.20 [-0.30, -0.09] | +0.26 (pooled) |
| SPY | D5 | 15:00 | 15 | -0.53 [-0.55, -0.51] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.56 [-0.59, -0.53] | +1.16 (pooled) |
| SPY | D5 | 15:00 | 30 | -0.51 [-0.52, -0.49] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.51 [-0.56, -0.46] | +0.59 (pooled) |
| SPY | D5 | 15:00 | 60 | -0.36 [-0.38, -0.34] | +0.24 (pooled) | -0.36 (pooled) | no | point | -0.24 [-0.35, -0.12] | +0.31 (pooled) |
| SPY | D5 | 15:00 | close | -0.39 [-0.41, -0.37] | -0.10 (pooled) | -0.25 (pooled) | no | yes (CI) | -0.25 [-0.35, -0.13] | +0.26 (pooled) |
| SPY | D5 | 15:30 | 15 | -0.58 [-0.60, -0.57] | +1.84 (pooled) | -1.25 (pooled) | no | no | -0.59 [-0.63, -0.54] | +1.16 (pooled) |
| SPY | D5 | 15:30 | 30 | -0.43 [-0.45, -0.41] | +0.74 (pooled) | -0.68 (pooled) | no | no | -0.31 [-0.40, -0.22] | +0.59 (pooled) |
| SPY | D5 | 15:30 | close | -0.43 [-0.45, -0.41] | -0.10 (pooled) | -0.25 (pooled) | no | yes (CI) | -0.31 [-0.40, -0.22] | +0.26 (pooled) |
| SPY | D6 | 09:45 | close | -0.19 [-0.22, -0.16] | -0.10 (pooled) | -0.25 (pooled) | no | no | -0.09 [-0.20, +0.01] | +0.26 (pooled) |
| QQQ | D1 | expansion | 15 | +0.05 [+0.01, +0.10] | +3.69 | -1.83 | no | no | +0.04 [-0.02, +0.12] | +2.12 |
| QQQ | D1 | expansion | 30 | +0.02 [-0.03, +0.06] | +1.38 | -0.79 | no | no | +0.00 [-0.07, +0.08] | +0.97 |
| QQQ | D1 | expansion | 60 | -0.01 [-0.05, +0.03] | +0.52 | -0.34 | no | no | -0.08 [-0.16, +0.01] | +0.55 |
| QQQ | D1 | expansion | close | -0.12 [-0.16, -0.08] | -0.09 | -0.27 | no | no | +0.01 [-0.20, +0.29] | +0.27 |
| QQQ | D2 | compression | 15 | -0.47 [-0.50, -0.44] | +3.69 | -1.83 | no | no | -0.48 [-0.52, -0.43] | +2.12 |
| QQQ | D2 | compression | 30 | -0.47 [-0.50, -0.44] | +1.38 | -0.79 | no | no | -0.46 [-0.52, -0.41] | +0.97 |
| QQQ | D2 | compression | 60 | -0.46 [-0.49, -0.43] | +0.52 | -0.34 | no | yes (CI) | -0.40 [-0.48, -0.32] | +0.55 |
| QQQ | D2 | compression | close | -0.41 [-0.44, -0.36] | -0.09 | -0.27 | no | yes (CI) | -0.18 [-0.35, +0.05] | +0.27 |
| QQQ | D4 | high | 15 | -0.58 [-0.60, -0.57] | +3.69 | -1.83 | no | no | -0.60 [-0.62, -0.58] | +2.12 |
| QQQ | D4 | high | 30 | -0.56 [-0.58, -0.54] | +1.38 | -0.79 | no | no | -0.57 [-0.60, -0.53] | +0.97 |
| QQQ | D4 | high | 60 | -0.53 [-0.55, -0.51] | +0.52 | -0.34 | no | yes (CI) | -0.51 [-0.57, -0.43] | +0.55 |
| QQQ | D4 | high | close | -0.42 [-0.44, -0.39] | -0.09 | -0.27 | no | yes (CI) | -0.29 [-0.39, -0.17] | +0.27 |
| QQQ | D4 | low | 15 | +0.08 [+0.06, +0.11] | +3.69 | -1.83 | no | no | +0.06 [+0.02, +0.11] | +2.12 |
| QQQ | D4 | low | 30 | +0.04 [+0.01, +0.06] | +1.38 | -0.79 | no | no | +0.01 [-0.04, +0.07] | +0.97 |
| QQQ | D4 | low | 60 | -0.04 [-0.06, -0.01] | +0.52 | -0.34 | no | no | -0.08 [-0.15, -0.01] | +0.55 |
| QQQ | D4 | low | close | -0.17 [-0.20, -0.14] | -0.09 | -0.27 | no | no | -0.04 [-0.19, +0.15] | +0.27 |
| QQQ | D5 | 09:30 | 15 | +0.82 [+0.75, +0.89] | +3.69 (pooled) | -1.83 (pooled) | no | no | +0.74 [+0.59, +0.89] | +2.12 (pooled) |
| QQQ | D5 | 09:30 | 30 | +0.71 [+0.65, +0.78] | +1.38 (pooled) | -0.79 (pooled) | no | no | +0.72 [+0.56, +0.89] | +0.97 (pooled) |
| QQQ | D5 | 09:30 | 60 | +0.47 [+0.42, +0.51] | +0.52 (pooled) | -0.34 (pooled) | no | no | +0.44 [+0.28, +0.61] | +0.55 (pooled) |
| QQQ | D5 | 09:30 | close | -0.20 [-0.23, -0.18] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.09 [-0.19, +0.02] | +0.27 (pooled) |
| QQQ | D5 | 10:00 | 15 | +0.59 [+0.53, +0.65] | +6.27 | -1.30 | no | no | +0.62 [+0.50, +0.74] | +3.50 |
| QQQ | D5 | 10:00 | 30 | +0.46 [+0.41, +0.51] | +2.73 | -0.48 | no | no | +0.49 [+0.35, +0.63] | +2.11 |
| QQQ | D5 | 10:00 | 60 | +0.27 [+0.22, +0.32] | +1.34 | -0.04 | no | no | +0.28 [+0.15, +0.42] | +1.23 |
| QQQ | D5 | 10:00 | close | -0.20 [-0.23, -0.18] | -0.06 | -0.28 | no | no | -0.09 [-0.20, +0.04] | +0.14 |
| QQQ | D5 | 10:30 | 15 | +0.22 [+0.18, +0.27] | +3.69 (pooled) | -1.83 (pooled) | no | no | +0.21 [+0.13, +0.30] | +2.12 (pooled) |
| QQQ | D5 | 10:30 | 30 | +0.16 [+0.11, +0.20] | +1.38 (pooled) | -0.79 (pooled) | no | no | +0.15 [+0.04, +0.26] | +0.97 (pooled) |
| QQQ | D5 | 10:30 | 60 | +0.04 [+0.01, +0.08] | +0.52 (pooled) | -0.34 (pooled) | no | no | +0.02 [-0.10, +0.15] | +0.55 (pooled) |
| QQQ | D5 | 10:30 | close | -0.21 [-0.24, -0.18] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.10 [-0.23, +0.03] | +0.27 (pooled) |
| QQQ | D5 | 11:00 | 15 | +0.02 [-0.02, +0.06] | +3.69 (pooled) | -1.83 (pooled) | no | no | +0.00 [-0.08, +0.08] | +2.12 (pooled) |
| QQQ | D5 | 11:00 | 30 | -0.03 [-0.07, +0.01] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.07 [-0.16, +0.02] | +0.97 (pooled) |
| QQQ | D5 | 11:00 | 60 | -0.11 [-0.14, -0.07] | +0.52 (pooled) | -0.34 (pooled) | no | no | -0.16 [-0.26, -0.04] | +0.55 (pooled) |
| QQQ | D5 | 11:00 | close | -0.22 [-0.25, -0.19] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.10 [-0.22, +0.05] | +0.27 (pooled) |
| QQQ | D5 | 11:30 | 15 | -0.13 [-0.17, -0.09] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.13 [-0.21, -0.05] | +2.12 (pooled) |
| QQQ | D5 | 11:30 | 30 | -0.16 [-0.20, -0.12] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.20 [-0.28, -0.12] | +0.97 (pooled) |
| QQQ | D5 | 11:30 | 60 | -0.22 [-0.26, -0.19] | +0.52 (pooled) | -0.34 (pooled) | no | no | -0.31 [-0.38, -0.23] | +0.55 (pooled) |
| QQQ | D5 | 11:30 | close | -0.22 [-0.25, -0.19] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.10 [-0.24, +0.05] | +0.27 (pooled) |
| QQQ | D5 | 12:00 | 15 | -0.26 [-0.29, -0.22] | +0.96 | -1.27 | no | no | -0.29 [-0.35, -0.22] | +0.89 |
| QQQ | D5 | 12:00 | 30 | -0.29 [-0.32, -0.26] | +0.42 | -0.76 | no | no | -0.33 [-0.40, -0.26] | +0.38 |
| QQQ | D5 | 12:00 | 60 | -0.30 [-0.33, -0.27] | +0.21 | -0.48 | no | no | -0.32 [-0.40, -0.23] | +0.12 |
| QQQ | D5 | 12:00 | close | -0.23 [-0.26, -0.20] | -0.04 | -0.21 | no | point | -0.10 [-0.24, +0.05] | +0.23 |
| QQQ | D5 | 12:30 | 15 | -0.35 [-0.38, -0.32] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.37 [-0.43, -0.31] | +2.12 (pooled) |
| QQQ | D5 | 12:30 | 30 | -0.33 [-0.36, -0.29] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.33 [-0.42, -0.25] | +0.97 (pooled) |
| QQQ | D5 | 12:30 | 60 | -0.33 [-0.37, -0.30] | +0.52 (pooled) | -0.34 (pooled) | no | no | -0.30 [-0.39, -0.19] | +0.55 (pooled) |
| QQQ | D5 | 12:30 | close | -0.25 [-0.28, -0.22] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.11 [-0.25, +0.05] | +0.27 (pooled) |
| QQQ | D5 | 13:00 | 15 | -0.34 [-0.38, -0.30] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.33 [-0.39, -0.27] | +2.12 (pooled) |
| QQQ | D5 | 13:00 | 30 | -0.36 [-0.40, -0.33] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.33 [-0.40, -0.24] | +0.97 (pooled) |
| QQQ | D5 | 13:00 | 60 | -0.34 [-0.37, -0.31] | +0.52 (pooled) | -0.34 (pooled) | no | point | -0.35 [-0.42, -0.27] | +0.55 (pooled) |
| QQQ | D5 | 13:00 | close | -0.26 [-0.29, -0.23] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.12 [-0.26, +0.07] | +0.27 (pooled) |
| QQQ | D5 | 13:30 | 15 | -0.40 [-0.43, -0.38] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.44 [-0.49, -0.39] | +2.12 (pooled) |
| QQQ | D5 | 13:30 | 30 | -0.37 [-0.40, -0.34] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.43 [-0.49, -0.37] | +0.97 (pooled) |
| QQQ | D5 | 13:30 | 60 | -0.36 [-0.39, -0.33] | +0.52 (pooled) | -0.34 (pooled) | no | point | -0.39 [-0.47, -0.30] | +0.55 (pooled) |
| QQQ | D5 | 13:30 | close | -0.29 [-0.32, -0.26] | -0.09 (pooled) | -0.27 (pooled) | no | point | -0.14 [-0.29, +0.05] | +0.27 (pooled) |
| QQQ | D5 | 14:00 | 15 | -0.38 [-0.42, -0.35] | +2.27 | -1.35 | no | no | -0.41 [-0.46, -0.36] | +0.93 |
| QQQ | D5 | 14:00 | 30 | -0.39 [-0.42, -0.37] | +0.33 | -0.64 | no | no | -0.41 [-0.47, -0.34] | +0.22 |
| QQQ | D5 | 14:00 | 60 | -0.38 [-0.41, -0.35] | -0.12 | -0.44 | no | no | -0.35 [-0.45, -0.19] | +0.35 |
| QQQ | D5 | 14:00 | close | -0.32 [-0.35, -0.29] | -0.14 | -0.33 | no | no | -0.17 [-0.29, -0.00] | +0.43 |
| QQQ | D5 | 14:30 | 15 | -0.45 [-0.47, -0.42] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.46 [-0.51, -0.40] | +2.12 (pooled) |
| QQQ | D5 | 14:30 | 30 | -0.43 [-0.46, -0.40] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.43 [-0.50, -0.33] | +0.97 (pooled) |
| QQQ | D5 | 14:30 | 60 | -0.43 [-0.45, -0.40] | +0.52 (pooled) | -0.34 (pooled) | no | yes (CI) | -0.42 [-0.50, -0.34] | +0.55 (pooled) |
| QQQ | D5 | 14:30 | close | -0.36 [-0.38, -0.34] | -0.09 (pooled) | -0.27 (pooled) | no | yes (CI) | -0.21 [-0.32, -0.09] | +0.27 (pooled) |
| QQQ | D5 | 15:00 | 15 | -0.50 [-0.52, -0.48] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.53 [-0.57, -0.49] | +2.12 (pooled) |
| QQQ | D5 | 15:00 | 30 | -0.49 [-0.51, -0.48] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.51 [-0.56, -0.45] | +0.97 (pooled) |
| QQQ | D5 | 15:00 | 60 | -0.38 [-0.40, -0.36] | +0.52 (pooled) | -0.34 (pooled) | no | yes (CI) | -0.27 [-0.37, -0.16] | +0.55 (pooled) |
| QQQ | D5 | 15:00 | close | -0.40 [-0.42, -0.38] | -0.09 (pooled) | -0.27 (pooled) | no | yes (CI) | -0.27 [-0.37, -0.16] | +0.27 (pooled) |
| QQQ | D5 | 15:30 | 15 | -0.58 [-0.60, -0.56] | +3.69 (pooled) | -1.83 (pooled) | no | no | -0.61 [-0.65, -0.56] | +2.12 (pooled) |
| QQQ | D5 | 15:30 | 30 | -0.43 [-0.45, -0.41] | +1.38 (pooled) | -0.79 (pooled) | no | no | -0.33 [-0.42, -0.23] | +0.97 (pooled) |
| QQQ | D5 | 15:30 | close | -0.43 [-0.45, -0.41] | -0.09 (pooled) | -0.27 (pooled) | no | yes (CI) | -0.33 [-0.42, -0.23] | +0.27 (pooled) |
| QQQ | D6 | 09:45 | close | -0.20 [-0.22, -0.17] | -0.09 (pooled) | -0.27 (pooled) | no | no | -0.11 [-0.20, -0.00] | +0.27 (pooled) |
| IWM | D1 | expansion | 15 | -0.01 [-0.07, +0.05] | +11.74 | -4.57 | no | no | +0.02 [-0.06, +0.11] | +3.69 |
| IWM | D1 | expansion | 30 | -0.05 [-0.10, +0.02] | +2.86 | -1.74 | no | no | +0.04 [-0.08, +0.17] | +1.85 |
| IWM | D1 | expansion | 60 | -0.05 [-0.11, +0.01] | +1.20 | -0.65 | no | no | +0.06 [-0.10, +0.25] | +0.83 |
| IWM | D1 | expansion | close | -0.18 [-0.23, -0.12] | +0.00 | -0.29 | no | no | -0.02 [-0.25, +0.29] | +0.58 |
| IWM | D2 | compression | 15 | -0.45 [-0.49, -0.41] | +11.74 | -4.57 | no | no | -0.45 [-0.51, -0.38] | +3.69 |
| IWM | D2 | compression | 30 | -0.46 [-0.49, -0.42] | +2.86 | -1.74 | no | no | -0.45 [-0.53, -0.36] | +1.85 |
| IWM | D2 | compression | 60 | -0.44 [-0.47, -0.40] | +1.20 | -0.65 | no | no | -0.40 [-0.48, -0.31] | +0.83 |
| IWM | D2 | compression | close | -0.42 [-0.45, -0.38] | +0.00 | -0.29 | no | yes (CI) | -0.35 [-0.49, -0.18] | +0.58 |
| IWM | D4 | high | 15 | -0.59 [-0.61, -0.58] | +11.74 | -4.57 | no | no | -0.62 [-0.64, -0.59] | +3.69 |
| IWM | D4 | high | 30 | -0.57 [-0.59, -0.56] | +2.86 | -1.74 | no | no | -0.59 [-0.62, -0.56] | +1.85 |
| IWM | D4 | high | 60 | -0.54 [-0.56, -0.52] | +1.20 | -0.65 | no | no | -0.54 [-0.59, -0.48] | +0.83 |
| IWM | D4 | high | close | -0.45 [-0.47, -0.42] | +0.00 | -0.29 | no | yes (CI) | -0.37 [-0.48, -0.24] | +0.58 |
| IWM | D4 | low | 15 | +0.08 [+0.05, +0.10] | +11.74 | -4.57 | no | no | +0.05 [+0.00, +0.11] | +3.69 |
| IWM | D4 | low | 30 | +0.02 [-0.00, +0.05] | +2.86 | -1.74 | no | no | -0.00 [-0.07, +0.07] | +1.85 |
| IWM | D4 | low | 60 | -0.05 [-0.08, -0.03] | +1.20 | -0.65 | no | no | -0.10 [-0.18, -0.00] | +0.83 |
| IWM | D4 | low | close | -0.21 [-0.24, -0.17] | +0.00 | -0.29 | no | no | -0.17 [-0.35, +0.04] | +0.58 |
| IWM | D5 | 09:30 | 15 | +1.03 [+0.93, +1.14] | +11.74 (pooled) | -4.57 (pooled) | no | no | +1.00 [+0.78, +1.25] | +3.69 (pooled) |
| IWM | D5 | 09:30 | 30 | +0.86 [+0.78, +0.96] | +2.86 (pooled) | -1.74 (pooled) | no | no | +0.86 [+0.66, +1.07] | +1.85 (pooled) |
| IWM | D5 | 09:30 | 60 | +0.58 [+0.51, +0.65] | +1.20 (pooled) | -0.65 (pooled) | no | no | +0.54 [+0.34, +0.75] | +0.83 (pooled) |
| IWM | D5 | 09:30 | close | -0.22 [-0.24, -0.19] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.22 [-0.33, -0.09] | +0.58 (pooled) |
| IWM | D5 | 10:00 | 15 | +0.71 [+0.63, +0.79] | +1009.67 | -3.63 | no | no | +0.71 [+0.59, +0.85] | +5.46 |
| IWM | D5 | 10:00 | 30 | +0.56 [+0.49, +0.63] | +4.71 | -1.13 | no | no | +0.59 [+0.44, +0.76] | +3.17 |
| IWM | D5 | 10:00 | 60 | +0.32 [+0.27, +0.38] | +4.65 | -0.50 | no | no | +0.27 [+0.12, +0.43] | +1.79 |
| IWM | D5 | 10:00 | close | -0.23 [-0.26, -0.20] | +0.14 | -0.26 | no | no | -0.18 [-0.32, -0.02] | +0.29 |
| IWM | D5 | 10:30 | 15 | +0.27 [+0.22, +0.34] | +11.74 (pooled) | -4.57 (pooled) | no | no | +0.21 [+0.11, +0.33] | +3.69 (pooled) |
| IWM | D5 | 10:30 | 30 | +0.18 [+0.13, +0.24] | +2.86 (pooled) | -1.74 (pooled) | no | no | +0.12 [+0.00, +0.25] | +1.85 (pooled) |
| IWM | D5 | 10:30 | 60 | +0.06 [+0.01, +0.10] | +1.20 (pooled) | -0.65 (pooled) | no | no | +0.01 [-0.13, +0.15] | +0.83 (pooled) |
| IWM | D5 | 10:30 | close | -0.24 [-0.27, -0.21] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.21 [-0.36, -0.04] | +0.58 (pooled) |
| IWM | D5 | 11:00 | 15 | +0.03 [-0.01, +0.08] | +11.74 (pooled) | -4.57 (pooled) | no | no | +0.05 [-0.05, +0.16] | +3.69 (pooled) |
| IWM | D5 | 11:00 | 30 | -0.01 [-0.06, +0.03] | +2.86 (pooled) | -1.74 (pooled) | no | no | +0.02 [-0.11, +0.18] | +1.85 (pooled) |
| IWM | D5 | 11:00 | 60 | -0.10 [-0.14, -0.06] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.11 [-0.23, +0.02] | +0.83 (pooled) |
| IWM | D5 | 11:00 | close | -0.24 [-0.27, -0.21] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.18 [-0.34, +0.00] | +0.58 (pooled) |
| IWM | D5 | 11:30 | 15 | -0.13 [-0.17, -0.08] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.15 [-0.23, -0.07] | +3.69 (pooled) |
| IWM | D5 | 11:30 | 30 | -0.17 [-0.21, -0.12] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.24 [-0.33, -0.15] | +1.85 (pooled) |
| IWM | D5 | 11:30 | 60 | -0.23 [-0.26, -0.19] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.32 [-0.40, -0.24] | +0.83 (pooled) |
| IWM | D5 | 11:30 | close | -0.25 [-0.28, -0.22] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.21 [-0.37, -0.01] | +0.58 (pooled) |
| IWM | D5 | 12:00 | 15 | -0.26 [-0.29, -0.22] | +5.97 | -3.50 | no | no | -0.29 [-0.35, -0.23] | +1.82 |
| IWM | D5 | 12:00 | 30 | -0.29 [-0.32, -0.25] | +1.57 | -1.29 | no | no | -0.29 [-0.37, -0.21] | +0.98 |
| IWM | D5 | 12:00 | 60 | -0.31 [-0.34, -0.28] | +0.57 | -0.66 | no | no | -0.31 [-0.40, -0.20] | +0.32 |
| IWM | D5 | 12:00 | close | -0.26 [-0.30, -0.23] | -0.01 | -0.23 | no | point | -0.21 [-0.38, +0.00] | +0.60 |
| IWM | D5 | 12:30 | 15 | -0.36 [-0.39, -0.32] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.36 [-0.42, -0.30] | +3.69 (pooled) |
| IWM | D5 | 12:30 | 30 | -0.36 [-0.39, -0.33] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.35 [-0.43, -0.27] | +1.85 (pooled) |
| IWM | D5 | 12:30 | 60 | -0.38 [-0.41, -0.34] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.34 [-0.43, -0.25] | +0.83 (pooled) |
| IWM | D5 | 12:30 | close | -0.28 [-0.32, -0.24] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.20 [-0.38, +0.03] | +0.58 (pooled) |
| IWM | D5 | 13:00 | 15 | -0.40 [-0.43, -0.37] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.40 [-0.45, -0.35] | +3.69 (pooled) |
| IWM | D5 | 13:00 | 30 | -0.42 [-0.45, -0.39] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.42 [-0.48, -0.35] | +1.85 (pooled) |
| IWM | D5 | 13:00 | 60 | -0.40 [-0.42, -0.37] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.43 [-0.51, -0.36] | +0.83 (pooled) |
| IWM | D5 | 13:00 | close | -0.31 [-0.34, -0.27] | +0.00 (pooled) | -0.29 (pooled) | no | point | -0.25 [-0.41, -0.02] | +0.58 (pooled) |
| IWM | D5 | 13:30 | 15 | -0.46 [-0.48, -0.43] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.47 [-0.53, -0.41] | +3.69 (pooled) |
| IWM | D5 | 13:30 | 30 | -0.42 [-0.45, -0.39] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.47 [-0.54, -0.40] | +1.85 (pooled) |
| IWM | D5 | 13:30 | 60 | -0.40 [-0.43, -0.37] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.41 [-0.50, -0.30] | +0.83 (pooled) |
| IWM | D5 | 13:30 | close | -0.33 [-0.37, -0.29] | +0.00 (pooled) | -0.29 (pooled) | no | point | -0.24 [-0.42, +0.02] | +0.58 (pooled) |
| IWM | D5 | 14:00 | 15 | -0.42 [-0.46, -0.39] | +4.34 | -1.91 | no | no | -0.43 [-0.49, -0.37] | +1.74 |
| IWM | D5 | 14:00 | 30 | -0.43 [-0.46, -0.39] | +0.51 | -0.93 | no | no | -0.42 [-0.50, -0.33] | +0.58 |
| IWM | D5 | 14:00 | 60 | -0.41 [-0.45, -0.36] | -0.09 | -0.57 | no | no | -0.34 [-0.48, -0.17] | +0.42 |
| IWM | D5 | 14:00 | close | -0.36 [-0.40, -0.31] | -0.08 | -0.38 | no | no | -0.26 [-0.44, -0.01] | +0.84 |
| IWM | D5 | 14:30 | 15 | -0.49 [-0.52, -0.45] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.47 [-0.54, -0.38] | +3.69 (pooled) |
| IWM | D5 | 14:30 | 30 | -0.47 [-0.51, -0.43] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.44 [-0.54, -0.31] | +1.85 (pooled) |
| IWM | D5 | 14:30 | 60 | -0.46 [-0.49, -0.42] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.46 [-0.55, -0.34] | +0.83 (pooled) |
| IWM | D5 | 14:30 | close | -0.41 [-0.44, -0.38] | +0.00 (pooled) | -0.29 (pooled) | no | yes (CI) | -0.34 [-0.46, -0.18] | +0.58 (pooled) |
| IWM | D5 | 15:00 | 15 | -0.54 [-0.57, -0.52] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.58 [-0.62, -0.54] | +3.69 (pooled) |
| IWM | D5 | 15:00 | 30 | -0.54 [-0.56, -0.52] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.58 [-0.62, -0.53] | +1.85 (pooled) |
| IWM | D5 | 15:00 | 60 | -0.44 [-0.47, -0.42] | +1.20 (pooled) | -0.65 (pooled) | no | no | -0.43 [-0.51, -0.34] | +0.83 (pooled) |
| IWM | D5 | 15:00 | close | -0.48 [-0.50, -0.46] | +0.00 (pooled) | -0.29 (pooled) | no | yes (CI) | -0.43 [-0.51, -0.35] | +0.58 (pooled) |
| IWM | D5 | 15:30 | 15 | -0.63 [-0.65, -0.61] | +11.74 (pooled) | -4.57 (pooled) | no | no | -0.65 [-0.70, -0.59] | +3.69 (pooled) |
| IWM | D5 | 15:30 | 30 | -0.52 [-0.54, -0.50] | +2.86 (pooled) | -1.74 (pooled) | no | no | -0.45 [-0.53, -0.37] | +1.85 (pooled) |
| IWM | D5 | 15:30 | close | -0.52 [-0.54, -0.50] | +0.00 (pooled) | -0.29 (pooled) | no | yes (CI) | -0.45 [-0.53, -0.37] | +0.58 (pooled) |
| IWM | D6 | 09:45 | close | -0.21 [-0.24, -0.18] | +0.00 (pooled) | -0.29 (pooled) | no | no | -0.22 [-0.34, -0.10] | +0.58 (pooled) |

## SPXW: primary (FDR family)

### D1-D4, primary parameter

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 2.0 | 10446 / 477 | +0.320 [+0.280, +0.360] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.07 [-0.11, -0.04] (-0.29) | -0.02 | long +1.58 / short-below -1.06 / Z2 +1.31 | +0.374 (181) / +0.339 (140) / +0.304 (156) | CI!0 |
| D1 | expansion | 30 | 2.0 | 10443 / 477 | +0.294 [+0.256, +0.331] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.09 [-0.13, -0.06] (-0.29) | -0.02 | long +0.70 / short-below -0.64 / Z2 +0.65 | +0.346 (181) / +0.316 (140) / +0.271 (156) | CI!0 |
| D1 | expansion | 60 | 2.0 | 9419 / 472 | +0.261 [+0.225, +0.296] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.12 [-0.16, -0.09] (-0.29) | -0.05 | long +0.16 / short-below -0.36 / Z2 +0.40 | +0.320 (180) / +0.281 (140) / +0.221 (152) | CI!0 |
| D1 | expansion | close | 2.0 | 10449 / 477 | +0.130 [+0.101, +0.159] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.12 [-0.15, -0.08] (-0.21) | +0.16 | long -0.04 / short-below -0.30 / Z2 +0.47 | +0.171 (181) / +0.155 (140) / +0.056 (156) | CI!0 |
| D2 | compression | 15 | 0.5 | 11372 / 501 | -0.371 [-0.419, -0.326] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.49 [-0.51, -0.46] (-0.28) | -0.45 | long +1.58 / short-below -1.06 / Z2 +1.31 | -0.331 (202) / -0.437 (132) / -0.291 (167) | CI!0 |
| D2 | compression | 30 | 0.5 | 11372 / 501 | -0.344 [-0.388, -0.300] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.48 [-0.50, -0.45] (-0.29) | -0.42 | long +0.70 / short-below -0.64 / Z2 +0.65 | -0.312 (202) / -0.401 (132) / -0.263 (167) | CI!0 |
| D2 | compression | 60 | 0.5 | 10292 / 495 | -0.320 [-0.363, -0.277] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.46 [-0.49, -0.44] (-0.29) | -0.38 | long +0.16 / short-below -0.36 / Z2 +0.40 | -0.301 (200) / -0.362 (129) / -0.231 (166) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.5 | 11372 / 501 | -0.139 [-0.174, -0.107] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.30 [-0.34, -0.26] (-0.21) | +0.06 | long -0.04 / short-below -0.30 / Z2 +0.47 | -0.154 (202) / -0.154 (132) / -0.072 (167) | CI!0 >H |
| D3 | bottom | 15 | tercile | 15287 / 766 | -0.027 [-0.045, -0.009] | 0.003 | 0.004 | +0.014 [-0.001, +0.029] | -0.25 [-0.28, -0.23] (-0.32) | -0.18 | |E[za]|* +0.18 | -0.009 (299) / -0.036 (219) / -0.038 (248) | CI!0 |
| D3 | bottom | 30 | tercile | 15287 / 766 | -0.040 [-0.064, -0.017] | 0.0005 | 0.003 | +0.026 [+0.006, +0.046] | -0.25 [-0.28, -0.23] (-0.32) | -0.18 | |E[za]|* +0.14 | -0.015 (299) / -0.038 (219) / -0.065 (248) | CI!0 |
| D3 | bottom | 60 | tercile | 13919 / 762 | -0.050 [-0.081, -0.021] | 0.001 | 0.002 | +0.033 [+0.008, +0.059] | -0.25 [-0.28, -0.23] (-0.32) | -0.14 | |E[za]|* +0.11 | -0.010 (298) / -0.055 (218) / -0.086 (246) | CI!0 |
| D3 | bottom | close | tercile | 15288 / 766 | -0.049 [-0.085, -0.013] | 0.007 | 0.007 | +0.034 [+0.005, +0.062] | -0.18 [-0.21, -0.15] (-0.21) | +0.15 | |E[za]|* +0.10 | -0.031 (299) / -0.074 (219) / -0.049 (248) | CI!0 |
| D3 | top | 15 | tercile | 15300 / 759 | -0.031 [-0.048, -0.014] | 0.0005 | 0.0010 | +0.014 [-0.001, +0.029] | -0.37 [-0.40, -0.35] (-0.33) | -0.33 | |E[za]|* +0.18 | -0.023 (297) / -0.030 (216) / -0.043 (246) | CI!0 |
| D3 | top | 30 | tercile | 15300 / 759 | -0.034 [-0.056, -0.013] | 0.0005 | 0.005 | +0.026 [+0.006, +0.046] | -0.37 [-0.39, -0.34] (-0.32) | -0.30 | |E[za]|* +0.14 | -0.031 (297) / -0.030 (216) / -0.041 (246) | CI!0 |
| D3 | top | 60 | tercile | 13635 / 756 | -0.032 [-0.060, -0.004] | 0.023 | 0.034 | +0.033 [+0.008, +0.059] | -0.36 [-0.38, -0.34] (-0.32) | -0.28 | |E[za]|* +0.11 | -0.012 (296) / -0.035 (214) / -0.056 (246) | CI!0 |
| D3 | top | close | tercile | 15300 / 759 | -0.037 [-0.074, -0.004] | 0.026 | 0.041 | +0.034 [+0.005, +0.062] | -0.23 [-0.25, -0.20] (-0.21) | +0.05 | |E[za]|* +0.10 | -0.015 (297) / -0.103 (216) / -0.011 (246) | CI!0 |
| D3 | top-bottom | 15 | tercile | 30587 / 770 | -0.029 [-0.044, -0.013] | 0.0005 | 0.002 | +0.014 [-0.001, +0.029] | -0.31 [-0.33, -0.29] (-0.32) | -0.26 | |E[za]|* +0.18 | -0.017 (300) / -0.033 (220) / -0.040 (250) | CI!0 |
| D3 | top-bottom | 30 | tercile | 30587 / 770 | -0.037 [-0.057, -0.016] | 0.0005 | 0.002 | +0.026 [+0.006, +0.046] | -0.31 [-0.33, -0.29] (-0.32) | -0.24 | |E[za]|* +0.14 | -0.024 (300) / -0.034 (220) / -0.054 (250) | CI!0 |
| D3 | top-bottom | 60 | tercile | 27554 / 770 | -0.041 [-0.067, -0.015] | 0.002 | 0.005 | +0.033 [+0.008, +0.059] | -0.31 [-0.33, -0.29] (-0.32) | -0.21 | |E[za]|* +0.11 | -0.011 (300) / -0.045 (220) / -0.072 (250) | CI!0 |
| D3 | top-bottom | close | tercile | 30588 / 770 | -0.043 [-0.078, -0.012] | 0.008 | 0.014 | +0.034 [+0.005, +0.062] | -0.20 [-0.23, -0.18] (-0.21) | +0.10 | |E[za]|* +0.10 | -0.023 (300) / -0.088 (220) / -0.031 (250) | CI!0 |
| D4 | high | 15 | tercile | 15295 / 676 | -0.363 [-0.404, -0.322] | 0.0005 | 0.0010 | -0.411 [-0.434, -0.386] | -0.57 [-0.58, -0.55] (-0.40) | -0.52 | long +1.58 / short-below -1.06 / Z2 +1.31 | -0.261 (286) / -0.344 (195) / -0.423 (195) | CI!0 |
| D4 | high | 30 | tercile | 15295 / 676 | -0.332 [-0.371, -0.294] | 0.0005 | 0.0010 | -0.433 [-0.457, -0.408] | -0.53 [-0.55, -0.52] (-0.38) | -0.47 | long +0.70 / short-below -0.64 / Z2 +0.65 | -0.244 (286) / -0.313 (195) / -0.374 (195) | CI!0 |
| D4 | high | 60 | tercile | 12714 / 648 | -0.311 [-0.350, -0.273] | 0.0005 | 0.0010 | -0.419 [-0.446, -0.391] | -0.50 [-0.52, -0.48] (-0.36) | -0.40 | long +0.16 / short-below -0.36 / Z2 +0.40 | -0.241 (279) / -0.288 (191) / -0.328 (178) | CI!0 >H >H(CI) |
| D4 | high | close | tercile | 15295 / 676 | -0.100 [-0.121, -0.080] | 0.0005 | 0.0010 | -0.207 [-0.242, -0.169] | -0.28 [-0.31, -0.26] (-0.21) | +0.03 | long -0.04 / short-below -0.30 / Z2 +0.47 | -0.100 (286) / -0.064 (195) / -0.084 (195) | CI!0 |
| D4 | low | 15 | tercile | 15295 / 749 | +0.267 [+0.235, +0.299] | 0.0005 | 0.0010 | -0.411 [-0.434, -0.386] | -0.04 [-0.07, -0.02] (-0.20) | +0.01 | long +1.58 / short-below -1.06 / Z2 +1.31 | +0.294 (283) / +0.260 (218) / +0.194 (248) | CI!0 |
| D4 | low | 30 | tercile | 15295 / 749 | +0.247 [+0.217, +0.277] | 0.0005 | 0.0010 | -0.433 [-0.457, -0.408] | -0.07 [-0.10, -0.05] (-0.22) | -0.01 | long +0.70 / short-below -0.64 / Z2 +0.65 | +0.274 (283) / +0.240 (218) / +0.176 (248) | CI!0 |
| D4 | low | 60 | tercile | 14750 / 749 | +0.217 [+0.188, +0.245] | 0.0005 | 0.0010 | -0.419 [-0.446, -0.391] | -0.13 [-0.16, -0.11] (-0.25) | -0.07 | long +0.16 / short-below -0.36 / Z2 +0.40 | +0.242 (283) / +0.207 (218) / +0.153 (248) | CI!0 |
| D4 | low | close | tercile | 15295 / 749 | +0.073 [+0.056, +0.089] | 0.0005 | 0.0010 | -0.207 [-0.242, -0.169] | -0.15 [-0.18, -0.12] (-0.20) | +0.15 | long -0.04 / short-below -0.30 / Z2 +0.47 | +0.095 (283) / +0.055 (218) / +0.046 (248) | CI!0 |

### D5 seasonality, 30-min buckets (P; each bucket its own two-sided test)

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 2302 / 768 | +0.245 [+0.205, +0.286] | 0.0005 | +0.55 [+0.49, +0.61] | 1.29 | 32% | +0.57 | +2.24 | -0.38 | +2.44 | +0.232 (299) / +0.274 (219) / +0.237 (250) | CI!0 |
| 09:30 | 30 | 2302 / 768 | +0.246 [+0.208, +0.284] | 0.0005 | +0.47 [+0.42, +0.52] | 1.30 | 28% | +0.55 | +1.22 | -0.06 | +1.38 | +0.187 (299) / +0.272 (219) / +0.295 (250) | CI!0 |
| 09:30 | 60 | 2302 / 768 | +0.126 [+0.089, +0.161] | 0.0005 | +0.28 [+0.23, +0.32] | 1.16 | 37% | +0.40 | +0.59 | +0.05 | +1.03 | +0.074 (299) / +0.121 (219) / +0.191 (250) | CI!0 |
| 09:30 | close | 2302 / 768 | -0.298 [-0.327, -0.268] | 0.0005 | -0.19 [-0.22, -0.17] | 0.72 | 79% | +0.05 | -0.13 | -0.39 | +0.20 | -0.337 (299) / -0.312 (219) / -0.239 (250) | CI!0 |
| 10:00 | 15 | 4609 / 769 | +0.110 [+0.071, +0.144] | 0.0005 | +0.36 [+0.31, +0.40] | 1.16 | 41% | +0.47 | +5.71 | -1.39 | +3.03 | +0.018 (300) / +0.140 (219) / +0.193 (250) | CI!0 |
| 10:00 | 30 | 4609 / 769 | +0.076 [+0.038, +0.113] | 0.0005 | +0.26 [+0.22, +0.30] | 1.13 | 41% | +0.42 | +1.49 | -0.36 | +1.76 | +0.003 (300) / +0.078 (219) / +0.162 (250) | CI!0 |
| 10:00 | 60 | 4609 / 769 | -0.027 [-0.064, +0.009] | 0.142 | +0.12 [+0.08, +0.17] | 0.99 | 51% | +0.29 | +0.76 | -0.09 | +1.15 | -0.080 (300) / -0.041 (219) / +0.050 (250) | - |
| 10:00 | close | 4609 / 769 | -0.298 [-0.326, -0.269] | 0.0005 | -0.19 [-0.22, -0.16] | 0.73 | 79% | +0.06 | -0.03 | -0.33 | +0.31 | -0.337 (300) / -0.308 (219) / -0.242 (250) | CI!0 |
| 10:30 | 15 | 4614 / 769 | -0.146 [-0.185, -0.105] | 0.0005 | +0.06 [+0.02, +0.11] | 0.89 | 58% | +0.19 | +0.81 | -0.45 | +1.37 | -0.204 (300) / -0.176 (219) / -0.048 (250) | CI!0 |
| 10:30 | 30 | 4614 / 769 | -0.147 [-0.187, -0.107] | 0.0005 | +0.02 [-0.02, +0.08] | 0.88 | 60% | +0.17 | +0.31 | -0.24 | +0.71 | -0.208 (300) / -0.157 (219) / -0.066 (250) | CI!0 |
| 10:30 | 60 | 4614 / 769 | -0.211 [-0.248, -0.173] | 0.0005 | -0.05 [-0.10, -0.00] | 0.82 | 65% | +0.06 | +0.19 | -0.21 | +0.43 | -0.271 (300) / -0.212 (219) / -0.137 (250) | CI!0 |
| 10:30 | close | 4614 / 769 | -0.302 [-0.332, -0.274] | 0.0005 | -0.19 [-0.22, -0.16] | 0.73 | 80% | +0.07 | -0.14 | -0.30 | +0.30 | -0.352 (300) / -0.302 (219) / -0.243 (250) | CI!0 |
| 11:00 | 15 | 4614 / 769 | -0.311 [-0.351, -0.271] | 0.0005 | -0.09 [-0.12, -0.05] | 0.75 | 69% | -0.04 | +0.56 | -0.54 | +1.12 | -0.391 (300) / -0.282 (219) / -0.239 (250) | CI!0 |
| 11:00 | 30 | 4614 / 769 | -0.312 [-0.353, -0.272] | 0.0005 | -0.12 [-0.16, -0.08] | 0.75 | 71% | -0.06 | +0.37 | -0.39 | +0.55 | -0.387 (300) / -0.292 (219) / -0.239 (250) | CI!0 |
| 11:00 | 60 | 4614 / 769 | -0.373 [-0.413, -0.331] | 0.0005 | -0.19 [-0.23, -0.16] | 0.71 | 76% | -0.12 | +0.29 | -0.25 | +0.27 | -0.457 (300) / -0.347 (219) / -0.295 (250) | CI!0 |
| 11:00 | close | 4614 / 769 | -0.308 [-0.337, -0.280] | 0.0005 | -0.20 [-0.22, -0.17] | 0.72 | 81% | +0.09 | -0.03 | -0.30 | +0.27 | -0.365 (300) / -0.306 (219) / -0.243 (250) | CI!0 |
| 11:30 | 15 | 4617 / 770 | -0.510 [-0.554, -0.465] | 0.0005 | -0.24 [-0.27, -0.20] | 0.62 | 78% | -0.18 | +0.26 | -0.60 | +0.84 | -0.612 (300) / -0.482 (220) / -0.413 (250) | CI!0 |
| 11:30 | 30 | 4617 / 770 | -0.497 [-0.541, -0.451] | 0.0005 | -0.26 [-0.29, -0.23] | 0.64 | 81% | -0.23 | +0.20 | -0.50 | +0.47 | -0.608 (300) / -0.452 (220) / -0.402 (250) | CI!0 |
| 11:30 | 60 | 4617 / 770 | -0.544 [-0.586, -0.500] | 0.0005 | -0.31 [-0.34, -0.28] | 0.60 | 86% | -0.32 | -0.02 | -0.49 | +0.18 | -0.676 (300) / -0.495 (220) / -0.430 (250) | CI!0 |
| 11:30 | close | 4617 / 770 | -0.314 [-0.344, -0.284] | 0.0005 | -0.20 [-0.23, -0.17] | 0.72 | 81% | +0.08 | -0.04 | -0.30 | +0.33 | -0.375 (300) / -0.313 (220) / -0.242 (250) | CI!0 |
| 12:00 | 15 | 4616 / 770 | -0.671 [-0.716, -0.624] | 0.0005 | -0.35 [-0.37, -0.32] | 0.54 | 84% | -0.31 | +0.55 | -0.94 | +0.83 | -0.831 (300) / -0.610 (220) / -0.533 (250) | CI!0 |
| 12:00 | 30 | 4616 / 770 | -0.664 [-0.707, -0.620] | 0.0005 | -0.37 [-0.40, -0.35] | 0.54 | 88% | -0.33 | +0.32 | -0.71 | +0.29 | -0.826 (300) / -0.614 (220) / -0.514 (250) | CI!0 |
| 12:00 | 60 | 4580 / 769 | -0.652 [-0.698, -0.612] | 0.0005 | -0.38 [-0.41, -0.36] | 0.55 | 90% | -0.31 | +0.07 | -0.51 | +0.02 | -0.834 (299) / -0.620 (220) / -0.464 (250) | CI!0 |
| 12:00 | close | 4616 / 770 | -0.310 [-0.340, -0.279] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 81% | +0.09 | -0.04 | -0.26 | +0.47 | -0.366 (300) / -0.329 (220) / -0.227 (250) | CI!0 |
| 12:30 | 15 | 4583 / 770 | -0.816 [-0.862, -0.770] | 0.0005 | -0.43 [-0.45, -0.40] | 0.46 | 89% | -0.38 | -0.00 | -0.77 | +0.50 | -0.983 (300) / -0.791 (220) / -0.637 (250) | CI!0 |
| 12:30 | 30 | 4580 / 769 | -0.737 [-0.784, -0.691] | 0.0005 | -0.41 [-0.43, -0.38] | 0.50 | 89% | -0.34 | -0.09 | -0.60 | +0.13 | -0.927 (299) / -0.722 (220) / -0.524 (250) | CI!0 |
| 12:30 | 60 | 4574 / 763 | -0.702 [-0.748, -0.657] | 0.0005 | -0.40 [-0.42, -0.37] | 0.52 | 89% | -0.28 | -0.26 | -0.55 | -0.07 | -0.896 (296) / -0.701 (219) / -0.472 (248) | CI!0 |
| 12:30 | close | 4586 / 770 | -0.309 [-0.338, -0.280] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 81% | +0.14 | +0.01 | -0.26 | +0.41 | -0.351 (300) / -0.344 (220) / -0.227 (250) | CI!0 |
| 13:00 | 15 | 4575 / 763 | -0.820 [-0.870, -0.771] | 0.0005 | -0.41 [-0.44, -0.38] | 0.46 | 88% | -0.33 | -0.11 | -0.74 | +0.36 | -1.028 (297) / -0.807 (218) / -0.581 (248) | CI!0 |
| 13:00 | 30 | 4575 / 763 | -0.782 [-0.831, -0.734] | 0.0005 | -0.42 [-0.45, -0.39] | 0.47 | 90% | -0.31 | -0.08 | -0.76 | +0.07 | -0.971 (297) / -0.794 (218) / -0.547 (248) | CI!0 |
| 13:00 | 60 | 4575 / 763 | -0.642 [-0.677, -0.604] | 0.0005 | -0.38 [-0.41, -0.36] | 0.53 | 89% | -0.30 | -0.24 | -0.50 | +0.03 | -0.792 (297) / -0.647 (218) / -0.458 (248) | CI!0 |
| 13:00 | close | 4575 / 763 | -0.309 [-0.336, -0.279] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 82% | +0.16 | -0.14 | -0.32 | +0.44 | -0.330 (297) / -0.352 (218) / -0.245 (248) | CI!0 |
| 13:30 | 15 | 4578 / 763 | -0.857 [-0.894, -0.817] | 0.0005 | -0.45 [-0.47, -0.42] | 0.43 | 89% | -0.43 | +0.46 | -0.94 | +0.42 | -0.992 (297) / -0.888 (218) / -0.667 (248) | CI!0 |
| 13:30 | 30 | 4578 / 763 | -0.705 [-0.741, -0.668] | 0.0005 | -0.40 [-0.43, -0.38] | 0.49 | 89% | -0.39 | +0.02 | -0.66 | +0.07 | -0.832 (297) / -0.721 (218) / -0.538 (248) | CI!0 |
| 13:30 | 60 | 4578 / 763 | -0.624 [-0.662, -0.587] | 0.0005 | -0.38 [-0.40, -0.35] | 0.53 | 88% | -0.30 | -0.22 | -0.44 | +0.01 | -0.761 (297) / -0.632 (218) / -0.454 (248) | CI!0 |
| 13:30 | close | 4578 / 763 | -0.323 [-0.350, -0.294] | 0.0005 | -0.21 [-0.24, -0.17] | 0.71 | 83% | +0.12 | +0.02 | -0.28 | +0.40 | -0.334 (297) / -0.378 (218) / -0.262 (248) | CI!0 |
| 14:00 | 15 | 4575 / 763 | -0.764 [-0.804, -0.724] | 0.0005 | -0.40 [-0.43, -0.37] | 0.47 | 88% | -0.34 | +1.24 | -0.98 | +0.66 | -0.944 (297) / -0.760 (218) / -0.552 (248) | CI!0 |
| 14:00 | 30 | 4575 / 763 | -0.697 [-0.735, -0.659] | 0.0005 | -0.40 [-0.43, -0.37] | 0.50 | 89% | -0.31 | +0.15 | -0.67 | +0.18 | -0.880 (297) / -0.689 (218) / -0.485 (248) | CI!0 |
| 14:00 | 60 | 4575 / 763 | -0.596 [-0.632, -0.561] | 0.0005 | -0.36 [-0.39, -0.33] | 0.55 | 89% | -0.25 | -0.16 | -0.46 | +0.18 | -0.752 (297) / -0.581 (218) / -0.423 (248) | CI!0 |
| 14:00 | close | 4575 / 763 | -0.331 [-0.358, -0.303] | 0.0005 | -0.22 [-0.24, -0.18] | 0.70 | 83% | +0.07 | -0.05 | -0.31 | +0.69 | -0.349 (297) / -0.391 (218) / -0.256 (248) | CI!0 |
| 14:30 | 15 | 4571 / 763 | -0.770 [-0.807, -0.730] | 0.0005 | -0.42 [-0.45, -0.40] | 0.47 | 89% | -0.37 | -0.12 | -0.59 | +0.31 | -0.968 (297) / -0.706 (218) / -0.587 (248) | CI!0 |
| 14:30 | 30 | 4571 / 763 | -0.660 [-0.694, -0.625] | 0.0005 | -0.40 [-0.43, -0.38] | 0.53 | 90% | -0.35 | -0.08 | -0.46 | +0.06 | -0.836 (297) / -0.606 (218) / -0.497 (248) | CI!0 |
| 14:30 | 60 | 4571 / 763 | -0.530 [-0.558, -0.503] | 0.0005 | -0.35 [-0.37, -0.33] | 0.60 | 91% | -0.29 | -0.12 | -0.35 | +0.22 | -0.625 (297) / -0.521 (218) / -0.424 (248) | CI!0 >H |
| 14:30 | close | 4571 / 763 | -0.340 [-0.364, -0.315] | 0.0005 | -0.24 [-0.26, -0.21] | 0.71 | 84% | +0.02 | +0.09 | -0.24 | +0.45 | -0.355 (297) / -0.391 (218) / -0.276 (248) | CI!0 |
| 15:00 | 15 | 4564 / 762 | -0.707 [-0.739, -0.676] | 0.0005 | -0.42 [-0.44, -0.41] | 0.50 | 91% | -0.42 | -0.13 | -0.66 | +0.03 | -0.871 (297) / -0.688 (217) / -0.526 (248) | CI!0 |
| 15:00 | 30 | 4564 / 762 | -0.589 [-0.616, -0.561] | 0.0005 | -0.39 [-0.40, -0.37] | 0.56 | 91% | -0.34 | -0.22 | -0.52 | +0.14 | -0.697 (297) / -0.603 (217) / -0.448 (248) | CI!0 |
| 15:00 | 60 | 761 / 761 | -0.334 [-0.362, -0.309] | 0.0005 | -0.23 [-0.26, -0.21] | 0.72 | 83% | +0.00 | -0.18 | -0.31 | +1.16 | -0.357 (297) / -0.410 (216) / -0.242 (248) | CI!0 |
| 15:00 | close | 4564 / 762 | -0.337 [-0.362, -0.311] | 0.0005 | -0.23 [-0.25, -0.21] | 0.70 | 82% | +0.02 | -0.10 | -0.31 | +0.90 | -0.363 (297) / -0.422 (217) / -0.231 (248) | CI!0 |
| 15:30 | 15 | 761 / 761 | -0.704 [-0.741, -0.666] | 0.0005 | -0.44 [-0.46, -0.41] | 0.49 | 91% | -0.42 | -0.05 | -0.60 | -0.08 | -0.787 (297) / -0.712 (216) / -0.597 (248) | CI!0 |
| 15:30 | 30 | 761 / 761 | -0.336 [-0.365, -0.306] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 79% | -0.01 | +0.56 | -0.51 | +0.50 | -0.363 (297) / -0.433 (216) / -0.219 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 761 / 761 | -0.336 [-0.365, -0.306] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 79% | -0.01 | +0.56 | -0.51 | +0.50 | -0.363 (297) / -0.433 (216) / -0.219 (248) | CI!0 |

### D6 unconditional variance premium, h = close

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:45 | close | 766 / 766 | -0.296 [-0.325, -0.267] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 78% | +0.04 | -0.13 | -0.39 | +0.20 | -0.332 (297) / -0.314 (219) / -0.238 (250) | CI!0 |
| 10:00 | close | 768 / 768 | -0.288 [-0.317, -0.259] | 0.0005 | -0.18 [-0.21, -0.16] | 0.73 | 78% | +0.06 | -0.03 | -0.33 | +0.31 | -0.328 (299) / -0.296 (219) / -0.232 (250) | CI!0 |
| 10:30 | close | 769 / 769 | -0.301 [-0.330, -0.271] | 0.0005 | -0.19 [-0.22, -0.16] | 0.73 | 80% | +0.06 | -0.14 | -0.30 | +0.30 | -0.345 (300) / -0.309 (219) / -0.240 (250) | CI!0 |
| 12:00 | close | 770 / 770 | -0.304 [-0.335, -0.273] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 80% | +0.06 | -0.04 | -0.26 | +0.47 | -0.364 (300) / -0.307 (220) / -0.230 (250) | CI!0 |

### Grid sensitivity (G; reported, never used to choose)

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 1.5 | 15035 / 566 | +0.274 [+0.240, +0.306] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.10 [-0.13, -0.07] (-0.28) | -0.04 | long +1.58 / short-below -1.06 / Z2 +1.31 | +0.327 (202) / +0.274 (170) / +0.235 (194) | CI!0 |
| D1 | expansion | 30 | 1.5 | 15032 / 566 | +0.255 [+0.224, +0.285] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.12 [-0.15, -0.09] (-0.28) | -0.05 | long +0.70 / short-below -0.64 / Z2 +0.65 | +0.308 (202) / +0.258 (170) / +0.213 (194) | CI!0 |
| D1 | expansion | 60 | 1.5 | 13644 / 563 | +0.229 [+0.199, +0.258] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.14 [-0.17, -0.11] (-0.28) | -0.07 | long +0.16 / short-below -0.36 / Z2 +0.40 | +0.286 (201) / +0.231 (170) / +0.180 (192) | CI!0 |
| D1 | expansion | close | 1.5 | 15038 / 566 | +0.112 [+0.088, +0.136] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.13 [-0.16, -0.10] (-0.20) | +0.12 | long -0.04 / short-below -0.30 / Z2 +0.47 | +0.154 (202) / +0.125 (170) / +0.051 (194) | CI!0 |
| D1 | expansion | 15 | 3.0 | 6113 / 325 | +0.372 [+0.324, +0.420] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.04 [-0.09, +0.01] (-0.30) | +0.05 | long +1.58 / short-below -1.06 / Z2 +1.31 | +0.420 (141) / +0.449 (92) / +0.374 (92) | CI!0 |
| D1 | expansion | 30 | 3.0 | 6110 / 325 | +0.338 [+0.292, +0.383] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.07 [-0.12, -0.03] (-0.30) | +0.02 | long +0.70 / short-below -0.64 / Z2 +0.65 | +0.386 (141) / +0.411 (92) / +0.335 (92) | CI!0 |
| D1 | expansion | 60 | 3.0 | 5427 / 321 | +0.303 [+0.257, +0.348] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.10 [-0.14, -0.06] (-0.30) | -0.02 | long +0.16 / short-below -0.36 / Z2 +0.40 | +0.355 (139) / +0.376 (92) / +0.286 (90) | CI!0 |
| D1 | expansion | close | 3.0 | 6115 / 325 | +0.159 [+0.123, +0.195] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.10 [-0.14, -0.06] (-0.21) | +0.23 | long -0.04 / short-below -0.30 / Z2 +0.47 | +0.189 (141) / +0.211 (92) / +0.083 (92) | CI!0 |
| D2 | compression | 15 | 0.4 | 7682 / 395 | -0.429 [-0.488, -0.373] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.52 [-0.54, -0.49] (-0.29) | -0.50 | long +1.58 / short-below -1.06 / Z2 +1.31 | -0.362 (171) / -0.514 (104) / -0.336 (120) | CI!0 |
| D2 | compression | 30 | 0.4 | 7682 / 395 | -0.397 [-0.452, -0.343] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.51 [-0.53, -0.48] (-0.29) | -0.46 | long +0.70 / short-below -0.64 / Z2 +0.65 | -0.338 (171) / -0.466 (104) / -0.308 (120) | CI!0 |
| D2 | compression | 60 | 0.4 | 6908 / 385 | -0.374 [-0.427, -0.322] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.50 [-0.52, -0.47] (-0.29) | -0.40 | long +0.16 / short-below -0.36 / Z2 +0.40 | -0.323 (170) / -0.428 (98) / -0.284 (117) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.4 | 7682 / 395 | -0.152 [-0.196, -0.109] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.31 [-0.35, -0.26] (-0.21) | +0.04 | long -0.04 / short-below -0.30 / Z2 +0.47 | -0.164 (171) / -0.159 (104) / -0.066 (120) | CI!0 >H |
| D2 | compression | 15 | 0.67 | 17296 / 595 | -0.296 [-0.332, -0.262] | 0.0005 | 0.0010 | +0.368 [+0.340, +0.395] | -0.44 [-0.46, -0.42] (-0.27) | -0.40 | long +1.58 / short-below -1.06 / Z2 +1.31 | -0.293 (223) / -0.322 (163) / -0.237 (209) | CI!0 |
| D2 | compression | 30 | 0.67 | 17296 / 595 | -0.279 [-0.314, -0.246] | 0.0005 | 0.0010 | +0.397 [+0.365, +0.427] | -0.44 [-0.46, -0.42] (-0.28) | -0.37 | long +0.70 / short-below -0.64 / Z2 +0.65 | -0.279 (223) / -0.305 (163) / -0.216 (209) | CI!0 |
| D2 | compression | 60 | 0.67 | 15641 / 588 | -0.261 [-0.294, -0.229] | 0.0005 | 0.0010 | +0.399 [+0.364, +0.432] | -0.43 [-0.45, -0.41] (-0.28) | -0.33 | long +0.16 / short-below -0.36 / Z2 +0.40 | -0.271 (221) / -0.276 (161) / -0.194 (206) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.67 | 17296 / 595 | -0.115 [-0.142, -0.091] | 0.0005 | 0.0010 | +0.274 [+0.227, +0.319] | -0.28 [-0.32, -0.25] (-0.20) | +0.09 | long -0.04 / short-below -0.30 / Z2 +0.47 | -0.141 (223) / -0.121 (163) / -0.061 (209) | CI!0 |
| D3 | bottom | 15 | quintile | 9172 / 720 | -0.042 [-0.069, -0.015] | 0.001 | 0.002 | +0.014 [-0.001, +0.029] | -0.21 [-0.24, -0.18] (-0.32) | -0.14 | |E[za]|* +0.18 | -0.027 (283) / -0.034 (210) / -0.062 (227) | CI!0 |
| D3 | bottom | 30 | quintile | 9172 / 720 | -0.068 [-0.104, -0.034] | 0.0005 | 0.002 | +0.026 [+0.006, +0.046] | -0.22 [-0.25, -0.19] (-0.32) | -0.15 | |E[za]|* +0.14 | -0.041 (283) / -0.036 (210) / -0.121 (227) | CI!0 |
| D3 | bottom | 60 | quintile | 8327 / 707 | -0.095 [-0.140, -0.052] | 0.0005 | 0.0010 | +0.033 [+0.008, +0.059] | -0.22 [-0.26, -0.19] (-0.32) | -0.09 | |E[za]|* +0.11 | -0.061 (278) / -0.065 (206) / -0.154 (223) | CI!0 |
| D3 | bottom | close | quintile | 9173 / 720 | -0.080 [-0.131, -0.031] | 0.002 | 0.004 | +0.034 [+0.005, +0.062] | -0.17 [-0.20, -0.14] (-0.20) | +0.19 | |E[za]|* +0.10 | -0.078 (283) / -0.071 (210) / -0.092 (227) | CI!0 |
| D3 | top | 15 | quintile | 9181 / 728 | -0.022 [-0.044, +0.001] | 0.058 | 0.082 | +0.014 [-0.001, +0.029] | -0.37 [-0.39, -0.34] (-0.33) | -0.34 | |E[za]|* +0.18 | -0.003 (290) / -0.023 (205) / -0.047 (233) | - |
| D3 | top | 30 | quintile | 9181 / 728 | -0.029 [-0.057, +0.000] | 0.055 | 0.076 | +0.026 [+0.006, +0.046] | -0.37 [-0.39, -0.34] (-0.32) | -0.30 | |E[za]|* +0.14 | -0.009 (290) / -0.029 (205) / -0.054 (233) | - |
| D3 | top | 60 | quintile | 8197 / 715 | -0.029 [-0.066, +0.010] | 0.138 | 0.146 | +0.033 [+0.008, +0.059] | -0.36 [-0.38, -0.33] (-0.32) | -0.27 | |E[za]|* +0.11 | -0.016 (285) / -0.020 (202) / -0.054 (228) | - |
| D3 | top | close | quintile | 9181 / 728 | -0.047 [-0.097, -0.000] | 0.049 | 0.083 | +0.034 [+0.005, +0.062] | -0.23 [-0.26, -0.20] (-0.21) | +0.05 | |E[za]|* +0.10 | -0.021 (290) / -0.118 (205) / -0.023 (233) | CI!0 |
| D3 | top-bottom | 15 | quintile | 18353 / 769 | -0.032 [-0.052, -0.013] | 0.004 | 0.002 | +0.014 [-0.001, +0.029] | -0.29 [-0.31, -0.27] (-0.32) | -0.24 | |E[za]|* +0.18 | -0.014 (300) / -0.029 (220) / -0.055 (249) | CI!0 |
| D3 | top-bottom | 30 | quintile | 18353 / 769 | -0.048 [-0.076, -0.022] | 0.0005 | 0.0010 | +0.026 [+0.006, +0.046] | -0.29 [-0.32, -0.27] (-0.32) | -0.22 | |E[za]|* +0.14 | -0.023 (300) / -0.033 (220) / -0.089 (249) | CI!0 |
| D3 | top-bottom | 60 | quintile | 16524 / 769 | -0.062 [-0.096, -0.028] | 0.0005 | 0.0010 | +0.033 [+0.008, +0.059] | -0.29 [-0.31, -0.27] (-0.32) | -0.18 | |E[za]|* +0.11 | -0.036 (300) / -0.044 (220) / -0.107 (249) | CI!0 |
| D3 | top-bottom | close | quintile | 18354 / 769 | -0.063 [-0.107, -0.022] | 0.002 | 0.003 | +0.034 [+0.005, +0.062] | -0.20 [-0.23, -0.17] (-0.21) | +0.12 | |E[za]|* +0.10 | -0.047 (300) / -0.093 (220) / -0.059 (249) | CI!0 |
| D4 | high | 15 | quintile | 9177 / 525 | -0.550 [-0.613, -0.486] | 0.0005 | 0.0010 | -0.411 [-0.434, -0.386] | -0.63 [-0.64, -0.61] (-0.40) | -0.59 | long +1.58 / short-below -1.06 / Z2 +1.31 | -0.374 (251) / -0.576 (151) / -0.746 (123) | CI!0 |
| D4 | high | 30 | quintile | 9177 / 525 | -0.494 [-0.555, -0.434] | 0.0005 | 0.0010 | -0.433 [-0.457, -0.408] | -0.59 [-0.60, -0.57] (-0.38) | -0.53 | long +0.70 / short-below -0.64 / Z2 +0.65 | -0.339 (251) / -0.511 (151) / -0.663 (123) | CI!0 |
| D4 | high | 60 | quintile | 7474 / 491 | -0.458 [-0.519, -0.399] | 0.0005 | 0.0010 | -0.419 [-0.446, -0.391] | -0.55 [-0.57, -0.53] (-0.36) | -0.48 | long +0.16 / short-below -0.36 / Z2 +0.40 | -0.328 (239) / -0.452 (144) / -0.604 (108) | CI!0 >H >H(CI) |
| D4 | high | close | quintile | 9177 / 525 | -0.137 [-0.169, -0.106] | 0.0005 | 0.0010 | -0.207 [-0.242, -0.169] | -0.31 [-0.34, -0.28] (-0.21) | -0.03 | long -0.04 / short-below -0.30 / Z2 +0.47 | -0.131 (251) / -0.094 (151) / -0.122 (123) | CI!0 >H |
| D4 | low | 15 | quintile | 9177 / 687 | +0.318 [+0.281, +0.354] | 0.0005 | 0.0010 | -0.411 [-0.434, -0.386] | +0.07 [+0.04, +0.11] (-0.16) | +0.15 | long +1.58 / short-below -1.06 / Z2 +1.31 | +0.358 (251) / +0.306 (203) / +0.247 (233) | CI!0 |
| D4 | low | 30 | quintile | 9177 / 687 | +0.299 [+0.263, +0.332] | 0.0005 | 0.0010 | -0.433 [-0.457, -0.408] | +0.03 [-0.00, +0.07] (-0.18) | +0.10 | long +0.70 / short-below -0.64 / Z2 +0.65 | +0.339 (251) / +0.285 (203) / +0.229 (233) | CI!0 |
| D4 | low | 60 | quintile | 8931 / 682 | +0.266 [+0.232, +0.299] | 0.0005 | 0.0010 | -0.419 [-0.446, -0.391] | -0.05 [-0.08, -0.02] (-0.22) | +0.02 | long +0.16 / short-below -0.36 / Z2 +0.40 | +0.302 (250) / +0.247 (202) / +0.206 (230) | CI!0 |
| D4 | low | close | quintile | 9177 / 687 | +0.086 [+0.064, +0.108] | 0.0005 | 0.0010 | -0.207 [-0.242, -0.169] | -0.14 [-0.17, -0.11] (-0.20) | +0.15 | long -0.04 / short-below -0.30 / Z2 +0.47 | +0.112 (251) / +0.065 (203) / +0.059 (233) | CI!0 |

D5 60-min buckets (G):

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 6911 / 769 | +0.155 [+0.119, +0.188] | 0.0005 | +0.42 [+0.38, +0.47] | 1.20 | 38% | +0.50 | +4.55 | -1.05 | +2.83 | +0.089 (300) / +0.184 (219) / +0.208 (250) | CI!0 |
| 09:30 | 30 | 6911 / 769 | +0.133 [+0.097, +0.167] | 0.0005 | +0.33 [+0.29, +0.37] | 1.18 | 37% | +0.47 | +1.40 | -0.26 | +1.63 | +0.064 (300) / +0.142 (219) / +0.206 (250) | CI!0 |
| 09:30 | 60 | 6911 / 769 | +0.024 [-0.013, +0.059] | 0.210 | +0.17 [+0.14, +0.22] | 1.04 | 46% | +0.32 | +0.70 | -0.05 | +1.11 | -0.029 (300) / +0.013 (219) / +0.097 (250) | - |
| 09:30 | close | 6911 / 769 | -0.298 [-0.326, -0.270] | 0.0005 | -0.19 [-0.22, -0.16] | 0.73 | 79% | +0.05 | -0.06 | -0.35 | +0.28 | -0.337 (300) / -0.309 (219) / -0.241 (250) | CI!0 |
| 10:30 | 15 | 9228 / 769 | -0.228 [-0.265, -0.192] | 0.0005 | -0.01 [-0.05, +0.03] | 0.82 | 63% | +0.07 | +0.68 | -0.49 | +1.24 | -0.297 (300) / -0.229 (219) / -0.144 (250) | CI!0 |
| 10:30 | 30 | 9228 / 769 | -0.230 [-0.266, -0.193] | 0.0005 | -0.05 [-0.09, -0.01] | 0.82 | 65% | +0.05 | +0.34 | -0.31 | +0.63 | -0.298 (300) / -0.225 (219) / -0.152 (250) | CI!0 |
| 10:30 | 60 | 9228 / 769 | -0.292 [-0.330, -0.254] | 0.0005 | -0.12 [-0.16, -0.09] | 0.77 | 71% | -0.03 | +0.24 | -0.23 | +0.35 | -0.364 (300) / -0.280 (219) / -0.216 (250) | CI!0 |
| 10:30 | close | 9228 / 769 | -0.305 [-0.335, -0.277] | 0.0005 | -0.19 [-0.22, -0.17] | 0.73 | 81% | +0.08 | -0.09 | -0.30 | +0.29 | -0.359 (300) / -0.304 (219) / -0.243 (250) | CI!0 |
| 11:30 | 15 | 9233 / 770 | -0.591 [-0.631, -0.546] | 0.0005 | -0.29 [-0.32, -0.26] | 0.58 | 81% | -0.24 | +0.41 | -0.77 | +0.83 | -0.722 (300) / -0.546 (220) / -0.473 (250) | CI!0 |
| 11:30 | 30 | 9233 / 770 | -0.580 [-0.622, -0.536] | 0.0005 | -0.32 [-0.34, -0.29] | 0.59 | 85% | -0.28 | +0.26 | -0.60 | +0.38 | -0.717 (300) / -0.533 (220) / -0.458 (250) | CI!0 |
| 11:30 | 60 | 9197 / 770 | -0.598 [-0.640, -0.555] | 0.0005 | -0.35 [-0.37, -0.32] | 0.58 | 88% | -0.32 | +0.02 | -0.50 | +0.10 | -0.754 (300) / -0.557 (220) / -0.447 (250) | CI!0 |
| 11:30 | close | 9233 / 770 | -0.312 [-0.342, -0.282] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 81% | +0.09 | -0.04 | -0.28 | +0.40 | -0.370 (300) / -0.321 (220) / -0.234 (250) | CI!0 |
| 12:30 | 15 | 9158 / 770 | -0.818 [-0.863, -0.773] | 0.0005 | -0.42 [-0.44, -0.39] | 0.46 | 89% | -0.35 | -0.05 | -0.76 | +0.43 | -1.005 (300) / -0.799 (220) / -0.609 (250) | CI!0 |
| 12:30 | 30 | 9155 / 770 | -0.760 [-0.805, -0.715] | 0.0005 | -0.41 [-0.44, -0.39] | 0.49 | 89% | -0.33 | -0.08 | -0.68 | +0.10 | -0.949 (300) / -0.758 (220) / -0.535 (250) | CI!0 |
| 12:30 | 60 | 9149 / 764 | -0.672 [-0.710, -0.635] | 0.0005 | -0.39 [-0.42, -0.36] | 0.52 | 89% | -0.29 | -0.25 | -0.52 | -0.02 | -0.844 (297) / -0.674 (219) / -0.465 (248) | CI!0 |
| 12:30 | close | 9161 / 770 | -0.309 [-0.338, -0.280] | 0.0005 | -0.19 [-0.22, -0.16] | 0.72 | 82% | +0.15 | -0.07 | -0.29 | +0.42 | -0.340 (300) / -0.348 (220) / -0.236 (250) | CI!0 |
| 13:30 | 15 | 9153 / 763 | -0.810 [-0.845, -0.776] | 0.0005 | -0.42 [-0.45, -0.40] | 0.45 | 89% | -0.38 | +0.85 | -0.96 | +0.54 | -0.968 (297) / -0.824 (218) / -0.609 (248) | CI!0 |
| 13:30 | 30 | 9153 / 763 | -0.701 [-0.737, -0.666] | 0.0005 | -0.40 [-0.43, -0.38] | 0.49 | 89% | -0.35 | +0.09 | -0.66 | +0.13 | -0.856 (297) / -0.705 (218) / -0.512 (248) | CI!0 |
| 13:30 | 60 | 9153 / 763 | -0.610 [-0.645, -0.575] | 0.0005 | -0.37 [-0.40, -0.34] | 0.54 | 89% | -0.28 | -0.19 | -0.45 | +0.09 | -0.757 (297) / -0.607 (218) / -0.439 (248) | CI!0 |
| 13:30 | close | 9153 / 763 | -0.327 [-0.353, -0.299] | 0.0005 | -0.21 [-0.24, -0.18] | 0.70 | 83% | +0.10 | -0.02 | -0.29 | +0.55 | -0.342 (297) / -0.384 (218) / -0.259 (248) | CI!0 |
| 14:30 | 15 | 9135 / 763 | -0.738 [-0.769, -0.707] | 0.0005 | -0.42 [-0.44, -0.40] | 0.49 | 90% | -0.39 | -0.12 | -0.63 | +0.17 | -0.920 (297) / -0.697 (218) / -0.557 (248) | CI!0 |
| 14:30 | 30 | 9135 / 763 | -0.625 [-0.653, -0.597] | 0.0005 | -0.39 [-0.41, -0.38] | 0.54 | 91% | -0.34 | -0.15 | -0.49 | +0.10 | -0.767 (297) / -0.604 (218) / -0.473 (248) | CI!0 |
| 14:30 | 60 | 5332 / 763 | -0.502 [-0.529, -0.476] | 0.0005 | -0.34 [-0.36, -0.32] | 0.61 | 90% | -0.24 | -0.13 | -0.35 | +0.36 | -0.587 (297) / -0.506 (218) / -0.398 (248) | CI!0 |
| 14:30 | close | 9135 / 763 | -0.338 [-0.363, -0.314] | 0.0005 | -0.23 [-0.25, -0.21] | 0.71 | 83% | +0.02 | -0.01 | -0.27 | +0.68 | -0.359 (297) / -0.407 (218) / -0.253 (248) | CI!0 |
| 15:30 | 15 | 761 / 761 | -0.704 [-0.741, -0.666] | 0.0005 | -0.44 [-0.46, -0.41] | 0.49 | 91% | -0.42 | -0.05 | -0.60 | -0.08 | -0.787 (297) / -0.712 (216) / -0.597 (248) | CI!0 |
| 15:30 | 30 | 761 / 761 | -0.336 [-0.365, -0.306] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 79% | -0.01 | +0.56 | -0.51 | +0.50 | -0.363 (297) / -0.433 (216) / -0.219 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 761 / 761 | -0.336 [-0.365, -0.306] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 79% | -0.01 | +0.56 | -0.51 | +0.50 | -0.363 (297) / -0.433 (216) / -0.219 (248) | CI!0 |

## SPY: replication (reported, not in the FDR family)

### D1-D4, primary parameter

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 2.0 | 9731 / 436 | +0.337 [+0.295, +0.380] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.11 [-0.14, -0.07] (-0.32) | -0.15 | long +1.84 / short-below -1.25 / Z2 +1.16 | +0.392 (178) / +0.354 (109) / +0.340 (149) | CI!0 |
| D1 | expansion | 30 | 2.0 | 9728 / 436 | +0.310 [+0.270, +0.350] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.13 [-0.17, -0.10] (-0.32) | -0.18 | long +0.74 / short-below -0.68 / Z2 +0.59 | +0.365 (178) / +0.324 (109) / +0.310 (149) | CI!0 |
| D1 | expansion | 60 | 2.0 | 8769 / 430 | +0.274 [+0.235, +0.312] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.15 [-0.18, -0.12] (-0.32) | -0.19 | long +0.24 / short-below -0.36 / Z2 +0.31 | +0.336 (176) / +0.285 (108) / +0.263 (146) | CI!0 |
| D1 | expansion | close | 2.0 | 9734 / 436 | +0.147 [+0.118, +0.178] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.17 [-0.20, -0.14] (-0.26) | -0.00 | long -0.10 / short-below -0.25 / Z2 +0.26 | +0.196 (178) / +0.151 (109) / +0.105 (149) | CI!0 |
| D2 | compression | 15 | 0.5 | 10657 / 459 | -0.401 [-0.448, -0.355] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.53 [-0.55, -0.50] (-0.32) | -0.55 | long +1.84 / short-below -1.25 / Z2 +1.16 | -0.342 (197) / -0.459 (100) / -0.337 (162) | CI!0 |
| D2 | compression | 30 | 0.5 | 10657 / 459 | -0.373 [-0.418, -0.329] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.52 [-0.54, -0.50] (-0.32) | -0.53 | long +0.74 / short-below -0.68 / Z2 +0.59 | -0.320 (197) / -0.423 (100) / -0.310 (162) | CI!0 |
| D2 | compression | 60 | 0.5 | 9649 / 456 | -0.347 [-0.392, -0.304] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.50 [-0.52, -0.47] (-0.31) | -0.49 | long +0.24 / short-below -0.36 / Z2 +0.31 | -0.308 (196) / -0.384 (100) / -0.272 (160) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.5 | 10657 / 459 | -0.165 [-0.201, -0.128] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.36 [-0.40, -0.32] (-0.26) | -0.10 | long -0.10 / short-below -0.25 / Z2 +0.26 | -0.162 (197) / -0.153 (100) / -0.112 (162) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | tercile | 14252 / 710 | -0.023 [-0.039, -0.006] | 0.012 | 0.007 | +0.015 [-0.000, +0.029] | -0.28 [-0.30, -0.26] (-0.35) | -0.31 | |E[za]|* +0.22 | -0.011 (294) / -0.025 (170) / -0.031 (246) | CI!0 |
| D3 | bottom | 30 | tercile | 14251 / 710 | -0.037 [-0.058, -0.016] | 0.0005 | 0.0010 | +0.029 [+0.010, +0.048] | -0.29 [-0.31, -0.26] (-0.35) | -0.32 | |E[za]|* +0.17 | -0.020 (294) / -0.030 (170) / -0.059 (246) | CI!0 |
| D3 | bottom | 60 | tercile | 12942 / 708 | -0.048 [-0.075, -0.021] | 0.001 | 0.0010 | +0.036 [+0.011, +0.062] | -0.28 [-0.30, -0.25] (-0.34) | -0.27 | |E[za]|* +0.14 | -0.020 (293) / -0.042 (169) / -0.080 (246) | CI!0 |
| D3 | bottom | close | tercile | 14253 / 710 | -0.050 [-0.086, -0.016] | 0.005 | 0.004 | +0.036 [+0.007, +0.066] | -0.23 [-0.25, -0.20] (-0.26) | -0.03 | |E[za]|* +0.11 | -0.043 (294) / -0.070 (170) / -0.046 (246) | CI!0 |
| D3 | top | 15 | tercile | 14251 / 711 | -0.026 [-0.041, -0.011] | 0.0005 | 0.002 | +0.015 [-0.000, +0.029] | -0.41 [-0.43, -0.39] (-0.36) | -0.44 | |E[za]|* +0.22 | -0.018 (293) / -0.028 (169) / -0.034 (249) | CI!0 |
| D3 | top | 30 | tercile | 14251 / 711 | -0.028 [-0.048, -0.008] | 0.003 | 0.005 | +0.029 [+0.010, +0.048] | -0.41 [-0.43, -0.39] (-0.36) | -0.42 | |E[za]|* +0.17 | -0.019 (293) / -0.031 (169) / -0.037 (249) | CI!0 |
| D3 | top | 60 | tercile | 12740 / 709 | -0.029 [-0.053, -0.004] | 0.024 | 0.038 | +0.036 [+0.011, +0.062] | -0.39 [-0.42, -0.37] (-0.35) | -0.41 | |E[za]|* +0.14 | -0.012 (293) / -0.034 (168) / -0.043 (248) | CI!0 |
| D3 | top | close | tercile | 14253 / 711 | -0.031 [-0.065, +0.001] | 0.060 | 0.079 | +0.036 [+0.007, +0.066] | -0.29 [-0.31, -0.26] (-0.27) | -0.12 | |E[za]|* +0.11 | -0.019 (293) / -0.094 (169) / -0.006 (249) | - |
| D3 | top-bottom | 15 | tercile | 28503 / 717 | -0.024 [-0.038, -0.010] | 0.0005 | 0.0010 | +0.015 [-0.000, +0.029] | -0.35 [-0.37, -0.33] (-0.36) | -0.38 | |E[za]|* +0.22 | -0.015 (297) / -0.027 (170) / -0.033 (250) | CI!0 |
| D3 | top-bottom | 30 | tercile | 28502 / 717 | -0.033 [-0.051, -0.014] | 0.0005 | 0.0010 | +0.029 [+0.010, +0.048] | -0.35 [-0.37, -0.33] (-0.36) | -0.37 | |E[za]|* +0.17 | -0.019 (297) / -0.030 (170) / -0.049 (250) | CI!0 |
| D3 | top-bottom | 60 | tercile | 25682 / 717 | -0.039 [-0.063, -0.015] | 0.001 | 0.004 | +0.036 [+0.011, +0.062] | -0.33 [-0.36, -0.31] (-0.35) | -0.34 | |E[za]|* +0.14 | -0.016 (297) / -0.038 (170) / -0.063 (250) | CI!0 |
| D3 | top-bottom | close | tercile | 28506 / 717 | -0.040 [-0.074, -0.010] | 0.011 | 0.020 | +0.036 [+0.007, +0.066] | -0.26 [-0.28, -0.23] (-0.26) | -0.07 | |E[za]|* +0.11 | -0.030 (297) / -0.081 (170) / -0.027 (250) | CI!0 |
| D4 | high | 15 | tercile | 14255 / 641 | -0.394 [-0.435, -0.352] | 0.0005 | 0.0010 | -0.439 [-0.464, -0.413] | -0.62 [-0.63, -0.61] (-0.45) | -0.63 | long +1.84 / short-below -1.25 / Z2 +1.16 | -0.251 (290) / -0.420 (151) / -0.474 (200) | CI!0 |
| D4 | high | 30 | tercile | 14255 / 641 | -0.364 [-0.402, -0.325] | 0.0005 | 0.0010 | -0.461 [-0.486, -0.436] | -0.59 [-0.61, -0.58] (-0.44) | -0.59 | long +0.74 / short-below -0.68 / Z2 +0.59 | -0.236 (290) / -0.379 (151) / -0.428 (200) | CI!0 |
| D4 | high | 60 | tercile | 11462 / 596 | -0.356 [-0.396, -0.317] | 0.0005 | 0.0010 | -0.452 [-0.480, -0.423] | -0.55 [-0.57, -0.53] (-0.40) | -0.53 | long +0.24 / short-below -0.36 / Z2 +0.31 | -0.242 (279) / -0.352 (143) / -0.412 (174) | CI!0 >H >H(CI) |
| D4 | high | close | tercile | 14255 / 641 | -0.124 [-0.147, -0.102] | 0.0005 | 0.0010 | -0.244 [-0.280, -0.205] | -0.38 [-0.40, -0.34] (-0.30) | -0.16 | long -0.10 / short-below -0.25 / Z2 +0.26 | -0.101 (290) / -0.069 (151) / -0.140 (200) | CI!0 >H >H(CI) |
| D4 | low | 15 | tercile | 14252 / 692 | +0.290 [+0.257, +0.324] | 0.0005 | 0.0010 | -0.439 [-0.464, -0.413] | -0.06 [-0.09, -0.04] (-0.23) | -0.12 | long +1.84 / short-below -1.25 / Z2 +1.16 | +0.303 (275) / +0.272 (169) / +0.215 (248) | CI!0 |
| D4 | low | 30 | tercile | 14249 / 692 | +0.269 [+0.239, +0.301] | 0.0005 | 0.0010 | -0.461 [-0.486, -0.436] | -0.10 [-0.12, -0.07] (-0.25) | -0.15 | long +0.74 / short-below -0.68 / Z2 +0.59 | +0.282 (275) / +0.250 (169) / +0.196 (248) | CI!0 |
| D4 | low | 60 | tercile | 13925 / 692 | +0.240 [+0.212, +0.269] | 0.0005 | 0.0010 | -0.452 [-0.480, -0.423] | -0.15 [-0.17, -0.12] (-0.27) | -0.20 | long +0.24 / short-below -0.36 / Z2 +0.31 | +0.252 (275) / +0.218 (169) / +0.169 (248) | CI!0 |
| D4 | low | close | tercile | 14255 / 692 | +0.090 [+0.072, +0.107] | 0.0005 | 0.0010 | -0.244 [-0.280, -0.205] | -0.17 [-0.20, -0.14] (-0.23) | -0.01 | long -0.10 / short-below -0.25 / Z2 +0.26 | +0.101 (275) / +0.052 (169) / +0.068 (248) | CI!0 |

### D5 seasonality, 30-min buckets (P; each bucket its own two-sided test)

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 2136 / 714 | +0.187 [+0.145, +0.232] | 0.0005 | +0.47 [+0.41, +0.54] | 1.22 | 36% | +0.35 | +1.70 ~ | +0.30 ~ | +1.45 ~ | +0.152 (296) / +0.237 (169) / +0.196 (249) | CI!0 |
| 09:30 | 30 | 2136 / 714 | +0.197 [+0.156, +0.239] | 0.0005 | +0.41 [+0.36, +0.47] | 1.24 | 32% | +0.36 | +0.78 ~ | -0.36 ~ | +1.10 ~ | +0.116 (296) / +0.253 (169) / +0.253 (249) | CI!0 |
| 09:30 | 60 | 2138 / 715 | +0.091 [+0.052, +0.132] | 0.0005 | +0.24 [+0.20, +0.29] | 1.12 | 40% | +0.22 | +0.47 ~ | +0.27 ~ | +1.04 ~ | +0.020 (296) / +0.112 (169) / +0.160 (250) | CI!0 >H |
| 09:30 | close | 2138 / 715 | -0.303 [-0.332, -0.272] | 0.0005 | -0.20 [-0.22, -0.17] | 0.73 | 78% | -0.08 | -0.09 ~ | -0.21 ~ | +0.32 ~ | -0.370 (296) / -0.281 (169) / -0.240 (250) | CI!0 |
| 10:00 | 15 | 4291 / 717 | +0.073 [+0.033, +0.113] | 0.002 | +0.32 [+0.27, +0.37] | 1.12 | 42% | +0.30 | +3.09 | -0.91 | +2.03 | -0.042 (297) / +0.139 (170) / +0.166 (250) | CI!0 |
| 10:00 | 30 | 4291 / 717 | +0.044 [+0.004, +0.084] | 0.033 | +0.23 [+0.18, +0.27] | 1.08 | 44% | +0.25 | +1.13 | -0.21 | +1.27 | -0.052 (297) / +0.077 (170) / +0.136 (250) | CI!0 |
| 10:00 | 60 | 4291 / 717 | -0.054 [-0.093, -0.015] | 0.008 | +0.10 [+0.05, +0.14] | 0.97 | 52% | +0.11 | +0.62 | -0.03 | +0.75 | -0.134 (297) / -0.045 (170) / +0.034 (250) | CI!0 |
| 10:00 | close | 4291 / 717 | -0.306 [-0.335, -0.275] | 0.0005 | -0.20 [-0.22, -0.17] | 0.74 | 79% | -0.08 | -0.03 | -0.23 | +0.15 | -0.378 (297) / -0.275 (170) / -0.240 (250) | CI!0 |
| 10:30 | 15 | 4301 / 717 | -0.174 [-0.216, -0.131] | 0.0005 | +0.04 [-0.01, +0.08] | 0.87 | 60% | +0.01 | +0.41 ~ | -0.37 ~ | +1.62 ~ | -0.263 (297) / -0.181 (170) / -0.062 (250) | CI!0 |
| 10:30 | 30 | 4301 / 717 | -0.175 [-0.217, -0.135] | 0.0005 | -0.00 [-0.05, +0.05] | 0.86 | 62% | -0.01 | +1.46 ~ | +0.11 ~ | +0.99 ~ | -0.268 (297) / -0.165 (170) / -0.072 (250) | CI!0 |
| 10:30 | 60 | 4300 / 717 | -0.232 [-0.272, -0.192] | 0.0005 | -0.08 [-0.12, -0.03] | 0.81 | 67% | -0.12 | +0.23 ~ | -0.10 ~ | +0.52 ~ | -0.323 (297) / -0.216 (170) / -0.136 (250) | CI!0 |
| 10:30 | close | 4301 / 717 | -0.314 [-0.344, -0.282] | 0.0005 | -0.20 [-0.23, -0.17] | 0.73 | 80% | -0.07 | +0.30 ~ | +0.16 ~ | +0.15 ~ | -0.401 (297) / -0.268 (170) / -0.241 (250) | CI!0 |
| 11:00 | 15 | 4297 / 717 | -0.334 [-0.375, -0.290] | 0.0005 | -0.11 [-0.15, -0.07] | 0.74 | 69% | -0.18 | - ~ | - ~ | +0.62 ~ | -0.450 (297) / -0.285 (170) / -0.230 (250) | CI!0 |
| 11:00 | 30 | 4294 / 716 | -0.334 [-0.377, -0.291] | 0.0005 | -0.15 [-0.18, -0.11] | 0.74 | 72% | -0.22 | - ~ | - ~ | +0.06 ~ | -0.442 (296) / -0.294 (170) / -0.233 (250) | CI!0 |
| 11:00 | 60 | 4300 / 717 | -0.395 [-0.436, -0.352] | 0.0005 | -0.21 [-0.24, -0.18] | 0.71 | 77% | -0.27 | +0.11 ~ | -0.23 ~ | +0.47 ~ | -0.509 (297) / -0.348 (170) / -0.292 (250) | CI!0 |
| 11:00 | close | 4300 / 717 | -0.326 [-0.356, -0.294] | 0.0005 | -0.21 [-0.23, -0.18] | 0.72 | 81% | -0.05 | +0.09 ~ | -0.01 ~ | +0.74 ~ | -0.423 (297) / -0.274 (170) / -0.247 (250) | CI!0 |
| 11:30 | 15 | 4298 / 717 | -0.542 [-0.587, -0.495] | 0.0005 | -0.26 [-0.29, -0.22] | 0.61 | 79% | -0.29 | +2.11 ~ | -2.29 ~ | +0.95 ~ | -0.677 (297) / -0.485 (170) / -0.421 (250) | CI!0 |
| 11:30 | 30 | 4298 / 717 | -0.527 [-0.572, -0.481] | 0.0005 | -0.28 [-0.31, -0.25] | 0.62 | 81% | -0.34 | +0.25 ~ | -0.50 ~ | +0.33 ~ | -0.669 (297) / -0.456 (170) / -0.408 (250) | CI!0 |
| 11:30 | 60 | 4298 / 717 | -0.565 [-0.608, -0.520] | 0.0005 | -0.32 [-0.35, -0.29] | 0.60 | 85% | -0.41 | -0.20 ~ | -0.69 ~ | -0.12 ~ | -0.726 (297) / -0.487 (170) / -0.427 (250) | CI!0 |
| 11:30 | close | 4298 / 717 | -0.341 [-0.372, -0.308] | 0.0005 | -0.22 [-0.24, -0.19] | 0.71 | 81% | -0.05 | -0.36 ~ | -0.43 ~ | +0.01 ~ | -0.444 (297) / -0.283 (170) / -0.257 (250) | CI!0 |
| 12:00 | 15 | 4296 / 717 | -0.694 [-0.742, -0.645] | 0.0005 | -0.36 [-0.39, -0.33] | 0.53 | 85% | -0.41 | +0.83 | -1.19 | +0.58 | -0.879 (297) / -0.608 (170) / -0.532 (250) | CI!0 |
| 12:00 | 30 | 4296 / 717 | -0.682 [-0.728, -0.635] | 0.0005 | -0.38 [-0.41, -0.35] | 0.54 | 88% | -0.43 | +0.43 | -0.78 | +0.14 | -0.873 (297) / -0.600 (170) / -0.512 (250) | CI!0 |
| 12:00 | 60 | 4260 / 716 | -0.669 [-0.715, -0.623] | 0.0005 | -0.39 [-0.41, -0.36] | 0.55 | 89% | -0.40 | +0.04 | -0.51 | -0.10 | -0.880 (296) / -0.606 (170) / -0.462 (250) | CI!0 |
| 12:00 | close | 4296 / 717 | -0.347 [-0.379, -0.315] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 82% | -0.05 | -0.10 | -0.22 | +0.27 | -0.449 (297) / -0.307 (170) / -0.254 (250) | CI!0 |
| 12:30 | 15 | 4266 / 717 | -0.827 [-0.876, -0.778] | 0.0005 | -0.43 [-0.45, -0.40] | 0.46 | 89% | -0.45 | +0.38 ~ | -1.59 ~ | +0.21 ~ | -1.034 (297) / -0.763 (170) / -0.625 (250) | CI!0 |
| 12:30 | 30 | 4263 / 716 | -0.760 [-0.809, -0.711] | 0.0005 | -0.41 [-0.44, -0.38] | 0.49 | 89% | -0.43 | +0.61 ~ | -1.26 ~ | -0.23 ~ | -0.983 (296) / -0.718 (170) / -0.524 (250) | CI!0 |
| 12:30 | 60 | 4257 / 710 | -0.731 [-0.779, -0.681] | 0.0005 | -0.41 [-0.44, -0.38] | 0.51 | 89% | -0.38 | +0.21 ~ | -0.43 ~ | -0.37 ~ | -0.961 (293) / -0.706 (169) / -0.477 (248) | CI!0 >H >H(CI) |
| 12:30 | close | 4269 / 717 | -0.355 [-0.387, -0.323] | 0.0005 | -0.23 [-0.25, -0.19] | 0.69 | 83% | -0.02 | -0.13 ~ | -0.41 ~ | -0.10 ~ | -0.448 (297) / -0.332 (170) / -0.261 (250) | CI!0 |
| 13:00 | 15 | 4263 / 711 | -0.862 [-0.913, -0.808] | 0.0005 | -0.43 [-0.46, -0.40] | 0.44 | 89% | -0.44 | -0.08 ~ | -0.87 ~ | +0.09 ~ | -1.105 (294) / -0.831 (169) / -0.596 (248) | CI!0 |
| 13:00 | 30 | 4263 / 711 | -0.824 [-0.872, -0.771] | 0.0005 | -0.44 [-0.47, -0.41] | 0.46 | 90% | -0.43 | +0.25 ~ | -0.74 ~ | -0.21 ~ | -1.053 (294) / -0.808 (169) / -0.563 (248) | CI!0 |
| 13:00 | 60 | 4263 / 711 | -0.676 [-0.712, -0.636] | 0.0005 | -0.40 [-0.43, -0.37] | 0.51 | 89% | -0.42 | - ~ | - ~ | -0.47 ~ | -0.876 (294) / -0.623 (169) / -0.476 (248) | CI!0 >H >H(CI) |
| 13:00 | close | 4263 / 711 | -0.369 [-0.398, -0.338] | 0.0005 | -0.24 [-0.27, -0.21] | 0.68 | 85% | -0.03 | - ~ | - ~ | -0.05 ~ | -0.443 (294) / -0.349 (169) / -0.295 (248) | CI!0 |
| 13:30 | 15 | 4266 / 711 | -0.895 [-0.931, -0.851] | 0.0005 | -0.47 [-0.49, -0.44] | 0.42 | 91% | -0.51 | +0.07 ~ | -1.58 ~ | -0.20 ~ | -1.080 (294) / -0.870 (169) / -0.692 (248) | CI!0 |
| 13:30 | 30 | 4266 / 711 | -0.743 [-0.780, -0.702] | 0.0005 | -0.42 [-0.45, -0.40] | 0.48 | 90% | -0.48 | +2.09 ~ | -2.39 ~ | -0.26 ~ | -0.923 (294) / -0.684 (169) / -0.569 (248) | CI!0 |
| 13:30 | 60 | 4266 / 711 | -0.668 [-0.705, -0.629] | 0.0005 | -0.40 [-0.43, -0.37] | 0.51 | 89% | -0.41 | +0.55 ~ | -0.08 ~ | -0.26 ~ | -0.856 (294) / -0.595 (169) / -0.495 (248) | CI!0 >H >H(CI) |
| 13:30 | close | 4266 / 711 | -0.401 [-0.430, -0.370] | 0.0005 | -0.27 [-0.29, -0.23] | 0.65 | 86% | -0.06 | -0.12 ~ | -0.22 ~ | +0.28 ~ | -0.464 (294) / -0.387 (169) / -0.336 (248) | CI!0 >H |
| 14:00 | 15 | 4266 / 711 | -0.825 [-0.865, -0.783] | 0.0005 | -0.44 [-0.46, -0.41] | 0.44 | 90% | -0.45 | +0.80 | -0.97 | +0.39 | -1.058 (294) / -0.723 (169) / -0.617 (248) | CI!0 |
| 14:00 | 30 | 4266 / 711 | -0.769 [-0.808, -0.728] | 0.0005 | -0.44 [-0.46, -0.41] | 0.47 | 91% | -0.44 | +0.10 | -0.69 | +0.01 | -0.996 (294) / -0.677 (169) / -0.562 (248) | CI!0 |
| 14:00 | 60 | 4266 / 711 | -0.683 [-0.718, -0.646] | 0.0005 | -0.41 [-0.44, -0.38] | 0.51 | 92% | -0.39 | -0.16 | -0.48 | +0.06 | -0.875 (294) / -0.593 (169) / -0.515 (248) | CI!0 |
| 14:00 | close | 4266 / 711 | -0.441 [-0.470, -0.413] | 0.0005 | -0.30 [-0.32, -0.27] | 0.64 | 88% | -0.12 | -0.15 | -0.30 | +0.37 | -0.507 (294) / -0.433 (169) / -0.369 (248) | CI!0 >H |
| 14:30 | 15 | 4265 / 711 | -0.897 [-0.936, -0.858] | 0.0005 | -0.49 [-0.52, -0.47] | 0.42 | 92% | -0.52 | - ~ | - ~ | - ~ | -1.117 (294) / -0.770 (169) / -0.724 (248) | CI!0 |
| 14:30 | 30 | 4265 / 711 | -0.794 [-0.830, -0.758] | 0.0005 | -0.47 [-0.50, -0.45] | 0.46 | 94% | -0.49 | - ~ | - ~ | - ~ | -0.995 (294) / -0.665 (169) / -0.643 (248) | CI!0 |
| 14:30 | 60 | 4265 / 711 | -0.676 [-0.706, -0.647] | 0.0005 | -0.44 [-0.46, -0.42] | 0.52 | 95% | -0.44 | - ~ | - ~ | - ~ | -0.804 (294) / -0.593 (169) / -0.581 (248) | CI!0 >H >H(CI) |
| 14:30 | close | 4265 / 711 | -0.497 [-0.523, -0.470] | 0.0005 | -0.34 [-0.36, -0.32] | 0.61 | 91% | -0.20 | - ~ | - ~ | - ~ | -0.555 (294) / -0.476 (169) / -0.443 (248) | CI!0 >H >H(CI) |
| 15:00 | 15 | 4266 / 711 | -0.919 [-0.953, -0.885] | 0.0005 | -0.53 [-0.55, -0.51] | 0.41 | 95% | -0.56 | -0.01 ~ | -0.72 ~ | -0.21 ~ | -1.109 (294) / -0.794 (169) / -0.778 (248) | CI!0 |
| 15:00 | 30 | 4266 / 711 | -0.814 [-0.843, -0.785] | 0.0005 | -0.51 [-0.52, -0.49] | 0.45 | 96% | -0.51 | -0.44 ~ | -0.64 ~ | -0.25 ~ | -0.950 (294) / -0.730 (169) / -0.710 (248) | CI!0 |
| 15:00 | 60 | 711 / 711 | -0.529 [-0.556, -0.501] | 0.0005 | -0.36 [-0.38, -0.34] | 0.59 | 92% | -0.24 | - ~ | - ~ | - ~ | -0.591 (294) / -0.521 (169) / -0.460 (248) | CI!0 >H |
| 15:00 | close | 4266 / 711 | -0.575 [-0.603, -0.547] | 0.0005 | -0.39 [-0.41, -0.37] | 0.56 | 93% | -0.25 | -0.05 ~ | -0.38 ~ | +0.07 ~ | -0.639 (294) / -0.567 (169) / -0.505 (248) | CI!0 >H >H(CI) |
| 15:30 | 15 | 711 / 711 | -1.008 [-1.046, -0.971] | 0.0005 | -0.58 [-0.60, -0.57] | 0.38 | 98% | -0.59 | +0.52 ~ | -0.78 ~ | -0.28 ~ | -1.113 (294) / -0.926 (169) / -0.940 (248) | CI!0 |
| 15:30 | 30 | 711 / 711 | -0.658 [-0.688, -0.627] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 94% | -0.31 | -0.01 ~ | -0.49 ~ | +0.03 ~ | -0.720 (294) / -0.661 (169) / -0.582 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 711 / 711 | -0.658 [-0.688, -0.627] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 94% | -0.31 | -0.01 ~ | -0.49 ~ | +0.03 ~ | -0.720 (294) / -0.661 (169) / -0.582 (248) | CI!0 >H >H(CI) |

### D6 unconditional variance premium, h = close

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:45 | close | 711 / 711 | -0.299 [-0.329, -0.269] | 0.0005 | -0.19 [-0.22, -0.16] | 0.73 | 77% | -0.09 | -0.09 ~ | -0.21 ~ | +0.32 ~ | -0.360 (292) / -0.286 (169) / -0.238 (250) | CI!0 |
| 10:00 | close | 716 / 716 | -0.297 [-0.326, -0.267] | 0.0005 | -0.19 [-0.22, -0.16] | 0.74 | 78% | -0.07 | -0.03 | -0.23 | +0.15 | -0.367 (296) / -0.268 (170) / -0.234 (250) | CI!0 |
| 10:30 | close | 717 / 717 | -0.309 [-0.341, -0.278] | 0.0005 | -0.20 [-0.22, -0.17] | 0.73 | 80% | -0.08 | +0.30 ~ | +0.16 ~ | +0.15 ~ | -0.391 (297) / -0.273 (170) / -0.237 (250) | CI!0 |
| 12:00 | close | 716 / 716 | -0.338 [-0.370, -0.306] | 0.0005 | -0.21 [-0.24, -0.18] | 0.70 | 81% | -0.07 | -0.10 | -0.22 | +0.27 | -0.441 (296) / -0.286 (170) / -0.252 (250) | CI!0 |

### Grid sensitivity (G; reported, never used to choose)

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 1.5 | 13858 / 523 | +0.297 [+0.261, +0.332] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.13 [-0.16, -0.10] (-0.31) | -0.17 | long +1.84 / short-below -1.25 / Z2 +1.16 | +0.347 (203) / +0.299 (128) / +0.272 (192) | CI!0 |
| D1 | expansion | 30 | 1.5 | 13855 / 523 | +0.274 [+0.239, +0.307] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.15 [-0.18, -0.13] (-0.32) | -0.19 | long +0.74 / short-below -0.68 / Z2 +0.59 | +0.325 (203) / +0.276 (128) / +0.247 (192) | CI!0 |
| D1 | expansion | 60 | 1.5 | 12560 / 520 | +0.245 [+0.213, +0.278] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.17 [-0.20, -0.14] (-0.31) | -0.20 | long +0.24 / short-below -0.36 / Z2 +0.31 | +0.302 (202) / +0.246 (128) / +0.212 (190) | CI!0 |
| D1 | expansion | close | 1.5 | 13861 / 523 | +0.127 [+0.101, +0.153] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.18 [-0.21, -0.15] (-0.26) | -0.04 | long -0.10 / short-below -0.25 / Z2 +0.26 | +0.174 (203) / +0.117 (128) / +0.088 (192) | CI!0 |
| D1 | expansion | 15 | 3.0 | 5789 / 302 | +0.392 [+0.342, +0.446] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.08 [-0.13, -0.04] (-0.34) | -0.09 | long +1.84 / short-below -1.25 / Z2 +1.16 | +0.443 (136) / +0.473 (75) / +0.427 (91) | CI!0 |
| D1 | expansion | 30 | 3.0 | 5786 / 302 | +0.360 [+0.313, +0.411] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.11 [-0.15, -0.07] (-0.34) | -0.13 | long +0.74 / short-below -0.68 / Z2 +0.59 | +0.414 (136) / +0.435 (75) / +0.383 (91) | CI!0 |
| D1 | expansion | 60 | 3.0 | 5153 / 298 | +0.322 [+0.276, +0.369] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.13 [-0.17, -0.09] (-0.33) | -0.16 | long +0.24 / short-below -0.36 / Z2 +0.31 | +0.385 (135) / +0.389 (75) / +0.333 (88) | CI!0 |
| D1 | expansion | close | 3.0 | 5792 / 302 | +0.174 [+0.138, +0.211] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.16 [-0.19, -0.12] (-0.27) | +0.05 | long -0.10 / short-below -0.25 / Z2 +0.26 | +0.217 (136) / +0.212 (75) / +0.143 (91) | CI!0 |
| D2 | compression | 15 | 0.4 | 7197 / 373 | -0.463 [-0.523, -0.408] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.56 [-0.58, -0.53] (-0.33) | -0.59 | long +1.84 / short-below -1.25 / Z2 +1.16 | -0.375 (176) / -0.564 (77) / -0.374 (120) | CI!0 |
| D2 | compression | 30 | 0.4 | 7197 / 373 | -0.427 [-0.484, -0.373] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.55 [-0.57, -0.52] (-0.33) | -0.55 | long +0.74 / short-below -0.68 / Z2 +0.59 | -0.344 (176) / -0.513 (77) / -0.348 (120) | CI!0 |
| D2 | compression | 60 | 0.4 | 6492 / 366 | -0.400 [-0.454, -0.347] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.53 [-0.55, -0.50] (-0.32) | -0.51 | long +0.24 / short-below -0.36 / Z2 +0.31 | -0.327 (174) / -0.471 (74) / -0.313 (118) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.4 | 7197 / 373 | -0.182 [-0.226, -0.136] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.38 [-0.41, -0.33] (-0.26) | -0.12 | long -0.10 / short-below -0.25 / Z2 +0.26 | -0.173 (176) / -0.161 (77) / -0.108 (120) | CI!0 >H >H(CI) |
| D2 | compression | 15 | 0.67 | 16269 / 557 | -0.310 [-0.346, -0.275] | 0.0005 | 0.0010 | +0.386 [+0.356, +0.415] | -0.48 [-0.50, -0.46] (-0.31) | -0.49 | long +1.84 / short-below -1.25 / Z2 +1.16 | -0.296 (220) / -0.335 (126) / -0.259 (211) | CI!0 |
| D2 | compression | 30 | 0.67 | 16269 / 557 | -0.292 [-0.325, -0.258] | 0.0005 | 0.0010 | +0.413 [+0.380, +0.445] | -0.47 [-0.49, -0.45] (-0.31) | -0.47 | long +0.74 / short-below -0.68 / Z2 +0.59 | -0.283 (220) / -0.318 (126) / -0.234 (211) | CI!0 |
| D2 | compression | 60 | 0.67 | 14728 / 550 | -0.273 [-0.306, -0.240] | 0.0005 | 0.0010 | +0.412 [+0.376, +0.449] | -0.46 [-0.48, -0.43] (-0.31) | -0.45 | long +0.24 / short-below -0.36 / Z2 +0.31 | -0.274 (216) / -0.293 (125) / -0.209 (209) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.67 | 16269 / 557 | -0.133 [-0.159, -0.106] | 0.0005 | 0.0010 | +0.302 [+0.255, +0.346] | -0.34 [-0.37, -0.31] (-0.26) | -0.10 | long -0.10 / short-below -0.25 / Z2 +0.26 | -0.150 (220) / -0.120 (126) / -0.088 (211) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | quintile | 8550 / 667 | -0.040 [-0.063, -0.016] | 0.002 | 0.002 | +0.015 [-0.000, +0.029] | -0.24 [-0.27, -0.21] (-0.35) | -0.26 | |E[za]|* +0.22 | -0.031 (279) / -0.019 (162) / -0.061 (226) | CI!0 |
| D3 | bottom | 30 | quintile | 8549 / 667 | -0.062 [-0.092, -0.031] | 0.0005 | 0.0010 | +0.029 [+0.010, +0.048] | -0.25 [-0.28, -0.22] (-0.35) | -0.28 | |E[za]|* +0.17 | -0.042 (279) / -0.016 (162) / -0.109 (226) | CI!0 |
| D3 | bottom | 60 | quintile | 7744 / 653 | -0.089 [-0.129, -0.049] | 0.0005 | 0.0010 | +0.036 [+0.011, +0.062] | -0.24 [-0.27, -0.21] (-0.34) | -0.22 | |E[za]|* +0.14 | -0.060 (273) / -0.052 (159) / -0.139 (221) | CI!0 |
| D3 | bottom | close | quintile | 8551 / 667 | -0.083 [-0.135, -0.034] | 0.0005 | 0.002 | +0.036 [+0.007, +0.066] | -0.21 [-0.24, -0.18] (-0.26) | +0.02 | |E[za]|* +0.11 | -0.087 (279) / -0.078 (162) / -0.085 (226) | CI!0 |
| D3 | top | 15 | quintile | 8549 / 679 | -0.024 [-0.044, -0.004] | 0.025 | 0.040 | +0.015 [-0.000, +0.029] | -0.42 [-0.44, -0.39] (-0.36) | -0.46 | |E[za]|* +0.22 | -0.008 (289) / -0.037 (158) / -0.035 (232) | CI!0 |
| D3 | top | 30 | quintile | 8549 / 679 | -0.035 [-0.060, -0.009] | 0.004 | 0.017 | +0.029 [+0.010, +0.048] | -0.41 [-0.43, -0.39] (-0.36) | -0.43 | |E[za]|* +0.17 | -0.013 (289) / -0.057 (158) / -0.045 (232) | CI!0 |
| D3 | top | 60 | quintile | 7636 / 667 | -0.034 [-0.066, -0.001] | 0.044 | 0.073 | +0.036 [+0.011, +0.062] | -0.40 [-0.42, -0.37] (-0.35) | -0.41 | |E[za]|* +0.14 | -0.018 (285) / -0.043 (152) / -0.044 (230) | CI!0 |
| D3 | top | close | quintile | 8550 / 679 | -0.040 [-0.086, +0.004] | 0.077 | 0.100 | +0.036 [+0.007, +0.066] | -0.30 [-0.32, -0.27] (-0.27) | -0.13 | |E[za]|* +0.11 | -0.030 (289) / -0.126 (158) / +0.003 (232) | - |
| D3 | top-bottom | 15 | quintile | 17099 / 715 | -0.032 [-0.049, -0.014] | 0.001 | 0.002 | +0.015 [-0.000, +0.029] | -0.33 [-0.35, -0.31] (-0.36) | -0.36 | |E[za]|* +0.22 | -0.018 (297) / -0.027 (170) / -0.049 (248) | CI!0 |
| D3 | top-bottom | 30 | quintile | 17098 / 715 | -0.048 [-0.071, -0.025] | 0.0005 | 0.0010 | +0.029 [+0.010, +0.048] | -0.33 [-0.35, -0.31] (-0.36) | -0.36 | |E[za]|* +0.17 | -0.026 (297) / -0.035 (170) / -0.079 (248) | CI!0 |
| D3 | top-bottom | 60 | quintile | 15380 / 715 | -0.062 [-0.092, -0.030] | 0.0005 | 0.0010 | +0.036 [+0.011, +0.062] | -0.32 [-0.34, -0.29] (-0.34) | -0.31 | |E[za]|* +0.14 | -0.037 (297) / -0.048 (170) / -0.095 (248) | CI!0 |
| D3 | top-bottom | close | quintile | 17101 / 715 | -0.061 [-0.103, -0.021] | 0.0005 | 0.005 | +0.036 [+0.007, +0.066] | -0.25 [-0.28, -0.23] (-0.26) | -0.06 | |E[za]|* +0.11 | -0.056 (297) / -0.100 (170) / -0.044 (248) | CI!0 |
| D4 | high | 15 | quintile | 8553 / 498 | -0.587 [-0.648, -0.525] | 0.0005 | 0.0010 | -0.439 [-0.464, -0.413] | -0.68 [-0.69, -0.66] (-0.45) | -0.69 | long +1.84 / short-below -1.25 / Z2 +1.16 | -0.372 (259) / -0.701 (111) / -0.770 (128) | CI!0 |
| D4 | high | 30 | quintile | 8553 / 498 | -0.530 [-0.587, -0.472] | 0.0005 | 0.0010 | -0.461 [-0.486, -0.436] | -0.64 [-0.66, -0.63] (-0.44) | -0.65 | long +0.74 / short-below -0.68 / Z2 +0.59 | -0.339 (259) / -0.624 (111) / -0.690 (128) | CI!0 |
| D4 | high | 60 | quintile | 6684 / 433 | -0.506 [-0.564, -0.445] | 0.0005 | 0.0010 | -0.452 [-0.480, -0.423] | -0.60 [-0.62, -0.58] (-0.40) | -0.60 | long +0.24 / short-below -0.36 / Z2 +0.31 | -0.335 (242) / -0.557 (97) / -0.668 (94) | CI!0 >H >H(CI) |
| D4 | high | close | quintile | 8553 / 498 | -0.167 [-0.202, -0.134] | 0.0005 | 0.0010 | -0.244 [-0.280, -0.205] | -0.41 [-0.44, -0.37] (-0.31) | -0.25 | long -0.10 / short-below -0.25 / Z2 +0.26 | -0.138 (259) / -0.078 (111) / -0.209 (128) | CI!0 >H >H(CI) |
| D4 | low | 15 | quintile | 8552 / 625 | +0.348 [+0.309, +0.388] | 0.0005 | 0.0010 | -0.439 [-0.464, -0.413] | +0.05 [+0.03, +0.08] (-0.18) | -0.00 | long +1.84 / short-below -1.25 / Z2 +1.16 | +0.360 (244) / +0.333 (158) / +0.278 (223) | CI!0 |
| D4 | low | 30 | quintile | 8550 / 625 | +0.327 [+0.290, +0.365] | 0.0005 | 0.0010 | -0.461 [-0.486, -0.436] | +0.01 [-0.02, +0.04] (-0.20) | -0.05 | long +0.74 / short-below -0.68 / Z2 +0.59 | +0.338 (244) / +0.304 (158) / +0.264 (223) | CI!0 |
| D4 | low | 60 | quintile | 8402 / 624 | +0.295 [+0.261, +0.329] | 0.0005 | 0.0010 | -0.452 [-0.480, -0.423] | -0.06 [-0.09, -0.03] (-0.24) | -0.11 | long +0.24 / short-below -0.36 / Z2 +0.31 | +0.305 (244) / +0.262 (158) / +0.238 (222) | CI!0 |
| D4 | low | close | quintile | 8553 / 625 | +0.108 [+0.084, +0.130] | 0.0005 | 0.0010 | -0.244 [-0.280, -0.205] | -0.15 [-0.18, -0.13] (-0.22) | +0.00 | long -0.10 / short-below -0.25 / Z2 +0.26 | +0.114 (244) / +0.066 (158) / +0.090 (223) | CI!0 |

D5 60-min buckets (G):

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 6427 / 717 | +0.111 [+0.073, +0.150] | 0.0005 | +0.37 [+0.32, +0.42] | 1.15 | 40% | +0.32 | +2.63 | -0.51 | +1.84 | +0.022 (297) / +0.172 (170) / +0.176 (250) | CI!0 |
| 09:30 | 30 | 6427 / 717 | +0.095 [+0.057, +0.133] | 0.0005 | +0.29 [+0.24, +0.34] | 1.14 | 40% | +0.29 | +1.01 | -0.26 | +1.21 | +0.003 (297) / +0.136 (170) / +0.175 (250) | CI!0 |
| 09:30 | 60 | 6429 / 717 | -0.006 [-0.043, +0.032] | 0.772 | +0.15 [+0.10, +0.19] | 1.02 | 48% | +0.15 | +0.57 | +0.07 | +0.85 | -0.083 (297) / +0.007 (170) / +0.076 (250) | - |
| 09:30 | close | 6429 / 717 | -0.305 [-0.334, -0.274] | 0.0005 | -0.20 [-0.22, -0.17] | 0.73 | 79% | -0.08 | -0.05 | -0.22 | +0.21 | -0.376 (297) / -0.277 (170) / -0.240 (250) | CI!0 |
| 10:30 | 15 | 8598 / 717 | -0.254 [-0.292, -0.214] | 0.0005 | -0.04 [-0.07, +0.00] | 0.81 | 64% | -0.08 | - | - | +1.12 | -0.357 (297) / -0.233 (170) / -0.146 (250) | CI!0 |
| 10:30 | 30 | 8595 / 717 | -0.254 [-0.293, -0.214] | 0.0005 | -0.07 [-0.11, -0.03] | 0.80 | 67% | -0.11 | - | - | +0.53 | -0.355 (297) / -0.230 (170) / -0.152 (250) | CI!0 |
| 10:30 | 60 | 8600 / 717 | -0.314 [-0.353, -0.273] | 0.0005 | -0.14 [-0.18, -0.11] | 0.76 | 72% | -0.20 | +0.17 | -0.16 | +0.50 | -0.416 (297) / -0.282 (170) / -0.214 (250) | CI!0 |
| 10:30 | close | 8601 / 717 | -0.320 [-0.349, -0.288] | 0.0005 | -0.20 [-0.23, -0.18] | 0.72 | 81% | -0.06 | +0.20 | +0.07 | +0.45 | -0.412 (297) / -0.271 (170) / -0.244 (250) | CI!0 |
| 11:30 | 15 | 8594 / 717 | -0.618 [-0.662, -0.573] | 0.0005 | -0.31 [-0.33, -0.28] | 0.57 | 82% | -0.35 | +1.47 | -1.74 | +0.77 | -0.778 (297) / -0.546 (170) / -0.476 (250) | CI!0 |
| 11:30 | 30 | 8594 / 717 | -0.605 [-0.648, -0.561] | 0.0005 | -0.33 [-0.36, -0.30] | 0.58 | 85% | -0.38 | +0.34 | -0.64 | +0.23 | -0.771 (297) / -0.528 (170) / -0.460 (250) | CI!0 |
| 11:30 | 60 | 8558 / 717 | -0.617 [-0.660, -0.573] | 0.0005 | -0.35 [-0.38, -0.33] | 0.57 | 87% | -0.41 | -0.08 | -0.60 | -0.11 | -0.803 (297) / -0.546 (170) / -0.444 (250) | CI!0 |
| 11:30 | close | 8594 / 717 | -0.344 [-0.375, -0.312] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 82% | -0.05 | -0.23 | -0.33 | +0.14 | -0.447 (297) / -0.295 (170) / -0.255 (250) | CI!0 |
| 12:30 | 15 | 8529 / 717 | -0.845 [-0.893, -0.796] | 0.0005 | -0.43 [-0.46, -0.40] | 0.45 | 89% | -0.45 | +0.15 | -1.23 | +0.15 | -1.070 (297) / -0.797 (170) / -0.610 (250) | CI!0 |
| 12:30 | 30 | 8526 / 717 | -0.792 [-0.841, -0.743] | 0.0005 | -0.43 [-0.45, -0.40] | 0.48 | 90% | -0.43 | +0.43 | -1.00 | -0.22 | -1.018 (297) / -0.763 (170) / -0.544 (250) | CI!0 |
| 12:30 | 60 | 8520 / 711 | -0.704 [-0.740, -0.662] | 0.0005 | -0.41 [-0.43, -0.38] | 0.51 | 89% | -0.40 | - | - | -0.42 | -0.918 (294) / -0.665 (169) / -0.476 (248) | CI!0 >H >H(CI) |
| 12:30 | close | 8532 / 717 | -0.362 [-0.393, -0.331] | 0.0005 | -0.23 [-0.26, -0.20] | 0.69 | 84% | -0.02 | - | - | -0.07 | -0.446 (297) / -0.341 (170) / -0.278 (250) | CI!0 |
| 13:30 | 15 | 8532 / 711 | -0.860 [-0.893, -0.823] | 0.0005 | -0.45 [-0.47, -0.43] | 0.43 | 90% | -0.48 | +0.44 | -1.27 | +0.10 | -1.069 (294) / -0.797 (169) / -0.655 (248) | CI!0 |
| 13:30 | 30 | 8532 / 711 | -0.756 [-0.791, -0.718] | 0.0005 | -0.43 [-0.45, -0.41] | 0.47 | 90% | -0.46 | +1.10 | -1.54 | -0.12 | -0.960 (294) / -0.681 (169) / -0.565 (248) | CI!0 |
| 13:30 | 60 | 8532 / 711 | -0.675 [-0.711, -0.639] | 0.0005 | -0.41 [-0.43, -0.38] | 0.51 | 91% | -0.40 | +0.19 | -0.28 | -0.10 | -0.866 (294) / -0.594 (169) / -0.505 (248) | CI!0 >H >H(CI) |
| 13:30 | close | 8532 / 711 | -0.421 [-0.449, -0.392] | 0.0005 | -0.28 [-0.31, -0.25] | 0.64 | 87% | -0.09 | -0.14 | -0.26 | +0.33 | -0.485 (294) / -0.410 (169) / -0.352 (248) | CI!0 >H >H(CI) |
| 14:30 | 15 | 8531 / 711 | -0.908 [-0.941, -0.875] | 0.0005 | -0.51 [-0.53, -0.49] | 0.41 | 94% | -0.54 | - | - | - | -1.113 (294) / -0.782 (169) / -0.751 (248) | CI!0 |
| 14:30 | 30 | 8531 / 711 | -0.804 [-0.834, -0.775] | 0.0005 | -0.49 [-0.51, -0.47] | 0.46 | 95% | -0.50 | - | - | - | -0.972 (294) / -0.698 (169) / -0.676 (248) | CI!0 |
| 14:30 | 60 | 4976 / 711 | -0.655 [-0.684, -0.627] | 0.0005 | -0.43 [-0.45, -0.41] | 0.53 | 94% | -0.41 | - | - | - | -0.773 (294) / -0.583 (169) / -0.564 (248) | CI!0 >H >H(CI) |
| 14:30 | close | 8531 / 711 | -0.536 [-0.562, -0.510] | 0.0005 | -0.37 [-0.38, -0.35] | 0.59 | 92% | -0.22 | - | - | - | -0.597 (294) / -0.522 (169) / -0.474 (248) | CI!0 >H >H(CI) |
| 15:30 | 15 | 711 / 711 | -1.008 [-1.046, -0.971] | 0.0005 | -0.58 [-0.60, -0.57] | 0.38 | 98% | -0.59 | +0.52 | -0.78 | -0.28 | -1.113 (294) / -0.926 (169) / -0.940 (248) | CI!0 |
| 15:30 | 30 | 711 / 711 | -0.658 [-0.688, -0.627] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 94% | -0.31 | -0.01 | -0.49 | +0.03 | -0.720 (294) / -0.661 (169) / -0.582 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 711 / 711 | -0.658 [-0.688, -0.627] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 94% | -0.31 | -0.01 | -0.49 | +0.03 | -0.720 (294) / -0.661 (169) / -0.582 (248) | CI!0 >H >H(CI) |

## QQQ: replication (reported, not in the FDR family)

### D1-D4, primary parameter

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 2.0 | 6725 / 349 | +0.384 [+0.340, +0.429] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | +0.05 [+0.01, +0.10] (-0.24) | +0.04 | long +3.69 / short-below -1.83 / Z2 +2.12 | +0.426 (96) / +0.390 (104) / +0.384 (149) | CI!0 |
| D1 | expansion | 30 | 2.0 | 6725 / 349 | +0.362 [+0.320, +0.404] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | +0.02 [-0.03, +0.06] (-0.25) | +0.00 | long +1.38 / short-below -0.79 / Z2 +0.97 | +0.409 (96) / +0.365 (104) / +0.359 (149) | CI!0 |
| D1 | expansion | 60 | 2.0 | 6021 / 345 | +0.334 [+0.293, +0.375] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | -0.01 [-0.05, +0.03] (-0.25) | -0.08 | long +0.52 / short-below -0.34 / Z2 +0.55 | +0.389 (94) / +0.334 (104) / +0.321 (147) | CI!0 |
| D1 | expansion | close | 2.0 | 6725 / 349 | +0.225 [+0.187, +0.263] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.12 [-0.16, -0.08] (-0.28) | +0.01 | long -0.09 / short-below -0.27 / Z2 +0.27 | +0.325 (96) / +0.171 (104) / +0.184 (149) | CI!0 |
| D2 | compression | 15 | 0.5 | 7005 / 361 | -0.400 [-0.463, -0.344] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | -0.47 [-0.50, -0.44] (-0.24) | -0.48 | long +3.69 / short-below -1.83 / Z2 +2.12 | -0.363 (110) / -0.479 (99) / -0.334 (152) | CI!0 |
| D2 | compression | 30 | 0.5 | 7005 / 361 | -0.376 [-0.434, -0.323] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | -0.47 [-0.50, -0.44] (-0.26) | -0.46 | long +1.38 / short-below -0.79 / Z2 +0.97 | -0.352 (110) / -0.445 (99) / -0.304 (152) | CI!0 |
| D2 | compression | 60 | 0.5 | 6288 / 359 | -0.349 [-0.403, -0.298] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | -0.46 [-0.49, -0.43] (-0.26) | -0.40 | long +0.52 / short-below -0.34 / Z2 +0.55 | -0.340 (110) / -0.410 (98) / -0.271 (151) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.5 | 7005 / 361 | -0.200 [-0.243, -0.159] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.41 [-0.44, -0.36] (-0.28) | -0.18 | long -0.09 / short-below -0.27 / Z2 +0.27 | -0.245 (110) / -0.164 (99) / -0.137 (152) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | tercile | 11782 / 586 | -0.026 [-0.046, -0.007] | 0.005 | 0.009 | +0.008 [-0.008, +0.025] | -0.20 [-0.23, -0.17] (-0.26) | -0.19 | |E[za]|* +0.26 | -0.038 (171) / -0.018 (169) / -0.024 (246) | CI!0 |
| D3 | bottom | 30 | tercile | 11782 / 586 | -0.040 [-0.065, -0.016] | 0.0005 | 0.0010 | +0.025 [+0.003, +0.047] | -0.21 [-0.24, -0.18] (-0.27) | -0.21 | |E[za]|* +0.20 | -0.043 (171) / -0.024 (169) / -0.049 (246) | CI!0 |
| D3 | bottom | 60 | tercile | 10738 / 583 | -0.048 [-0.080, -0.017] | 0.0005 | 0.003 | +0.035 [+0.007, +0.064] | -0.21 [-0.24, -0.18] (-0.27) | -0.21 | |E[za]|* +0.15 | -0.023 (170) / -0.028 (169) / -0.079 (244) | CI!0 |
| D3 | bottom | close | tercile | 11782 / 586 | -0.056 [-0.094, -0.021] | 0.001 | 0.0010 | +0.049 [+0.018, +0.079] | -0.24 [-0.27, -0.21] (-0.28) | -0.10 | |E[za]|* +0.13 | -0.076 (171) / -0.060 (169) / -0.041 (246) | CI!0 |
| D3 | top | 15 | tercile | 11773 / 589 | -0.018 [-0.037, +0.001] | 0.061 | 0.089 | +0.008 [-0.008, +0.025] | -0.31 [-0.33, -0.29] (-0.28) | -0.35 | |E[za]|* +0.26 | +0.001 (173) / -0.018 (168) / -0.032 (248) | - |
| D3 | top | 30 | tercile | 11773 / 589 | -0.025 [-0.049, -0.002] | 0.038 | 0.055 | +0.025 [+0.003, +0.047] | -0.32 [-0.34, -0.29] (-0.28) | -0.35 | |E[za]|* +0.20 | -0.015 (173) / -0.022 (168) / -0.035 (248) | CI!0 |
| D3 | top | 60 | tercile | 10508 / 584 | -0.028 [-0.057, +0.001] | 0.058 | 0.079 | +0.035 [+0.007, +0.064] | -0.31 [-0.34, -0.29] (-0.28) | -0.34 | |E[za]|* +0.15 | -0.011 (170) / -0.023 (167) / -0.046 (247) | - |
| D3 | top | close | tercile | 11773 / 589 | -0.038 [-0.072, -0.006] | 0.020 | 0.048 | +0.049 [+0.018, +0.079] | -0.30 [-0.33, -0.28] (-0.28) | -0.18 | |E[za]|* +0.13 | -0.029 (173) / -0.072 (168) / -0.023 (248) | CI!0 |
| D3 | top-bottom | 15 | tercile | 23555 / 593 | -0.022 [-0.040, -0.005] | 0.008 | 0.015 | +0.008 [-0.008, +0.025] | -0.25 [-0.28, -0.23] (-0.27) | -0.27 | |E[za]|* +0.26 | -0.017 (173) / -0.018 (170) / -0.028 (250) | CI!0 |
| D3 | top-bottom | 30 | tercile | 23555 / 593 | -0.032 [-0.056, -0.011] | 0.003 | 0.007 | +0.025 [+0.003, +0.047] | -0.26 [-0.29, -0.24] (-0.28) | -0.28 | |E[za]|* +0.20 | -0.028 (173) / -0.023 (170) / -0.042 (250) | CI!0 |
| D3 | top-bottom | 60 | tercile | 21246 / 593 | -0.038 [-0.067, -0.011] | 0.007 | 0.010 | +0.035 [+0.007, +0.064] | -0.26 [-0.29, -0.24] (-0.28) | -0.27 | |E[za]|* +0.15 | -0.017 (173) / -0.026 (170) / -0.063 (250) | CI!0 |
| D3 | top-bottom | close | tercile | 23555 / 593 | -0.047 [-0.080, -0.016] | 0.006 | 0.008 | +0.049 [+0.018, +0.079] | -0.27 [-0.30, -0.25] (-0.28) | -0.14 | |E[za]|* +0.13 | -0.051 (173) / -0.066 (170) / -0.032 (250) | CI!0 |
| D4 | high | 15 | tercile | 11778 / 537 | -0.390 [-0.440, -0.343] | 0.0005 | 0.0010 | -0.425 [-0.453, -0.396] | -0.58 [-0.60, -0.57] (-0.40) | -0.60 | long +3.69 / short-below -1.83 / Z2 +2.12 | -0.283 (166) / -0.367 (156) / -0.461 (215) | CI!0 |
| D4 | high | 30 | tercile | 11778 / 537 | -0.362 [-0.409, -0.317] | 0.0005 | 0.0010 | -0.450 [-0.478, -0.419] | -0.56 [-0.58, -0.54] (-0.39) | -0.57 | long +1.38 / short-below -0.79 / Z2 +0.97 | -0.265 (166) / -0.336 (156) / -0.429 (215) | CI!0 |
| D4 | high | 60 | tercile | 9415 / 496 | -0.358 [-0.406, -0.314] | 0.0005 | 0.0010 | -0.446 [-0.477, -0.412] | -0.53 [-0.55, -0.51] (-0.36) | -0.51 | long +0.52 / short-below -0.34 / Z2 +0.55 | -0.273 (157) / -0.311 (150) / -0.436 (189) | CI!0 >H >H(CI) |
| D4 | high | close | tercile | 11778 / 537 | -0.159 [-0.185, -0.134] | 0.0005 | 0.0010 | -0.267 [-0.304, -0.225] | -0.42 [-0.44, -0.39] (-0.32) | -0.29 | long -0.09 / short-below -0.27 / Z2 +0.27 | -0.146 (166) / -0.080 (156) / -0.217 (215) | CI!0 >H >H(CI) |
| D4 | low | 15 | tercile | 11778 / 580 | +0.271 [+0.235, +0.310] | 0.0005 | 0.0010 | -0.425 [-0.453, -0.396] | +0.08 [+0.06, +0.11] (-0.10) | +0.06 | long +3.69 / short-below -1.83 / Z2 +2.12 | +0.288 (167) / +0.287 (168) / +0.237 (245) | CI!0 |
| D4 | low | 30 | tercile | 11778 / 580 | +0.258 [+0.223, +0.295] | 0.0005 | 0.0010 | -0.450 [-0.478, -0.419] | +0.04 [+0.01, +0.06] (-0.13) | +0.01 | long +1.38 / short-below -0.79 / Z2 +0.97 | +0.276 (167) / +0.271 (168) / +0.224 (245) | CI!0 |
| D4 | low | 60 | tercile | 11543 / 580 | +0.230 [+0.198, +0.263] | 0.0005 | 0.0010 | -0.446 [-0.477, -0.412] | -0.04 [-0.06, -0.01] (-0.18) | -0.08 | long +0.52 / short-below -0.34 / Z2 +0.55 | +0.249 (167) / +0.241 (168) / +0.200 (245) | CI!0 |
| D4 | low | close | tercile | 11778 / 580 | +0.104 [+0.085, +0.124] | 0.0005 | 0.0010 | -0.267 [-0.304, -0.225] | -0.17 [-0.20, -0.14] (-0.24) | -0.04 | long -0.09 / short-below -0.27 / Z2 +0.27 | +0.144 (167) / +0.071 (168) / +0.092 (245) | CI!0 |

### D5 seasonality, 30-min buckets (P; each bucket its own two-sided test)

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 1773 / 591 | +0.429 [+0.386, +0.472] | 0.0005 | +0.82 [+0.75, +0.89] | 1.57 | 20% | +0.74 | - ~ | - ~ | +2.70 ~ | +0.462 (171) / +0.425 (170) / +0.409 (250) | CI!0 |
| 09:30 | 30 | 1773 / 591 | +0.413 [+0.372, +0.454] | 0.0005 | +0.71 [+0.65, +0.78] | 1.55 | 17% | +0.72 | - ~ | -4.85 ~ | +1.73 ~ | +0.410 (171) / +0.414 (170) / +0.415 (250) | CI!0 |
| 09:30 | 60 | 1773 / 591 | +0.276 [+0.238, +0.314] | 0.0005 | +0.47 [+0.42, +0.51] | 1.35 | 22% | +0.44 | - ~ | - ~ | +1.30 ~ | +0.274 (171) / +0.255 (170) / +0.293 (250) | CI!0 |
| 09:30 | close | 1773 / 591 | -0.290 [-0.317, -0.263] | 0.0005 | -0.20 [-0.23, -0.18] | 0.73 | 81% | -0.09 | +0.34 ~ | +0.12 ~ | +0.20 ~ | -0.318 (171) / -0.281 (170) / -0.277 (250) | CI!0 |
| 10:00 | 15 | 3542 / 593 | +0.289 [+0.247, +0.332] | 0.0005 | +0.59 [+0.53, +0.65] | 1.41 | 28% | +0.62 | +6.27 | -1.30 | +3.50 | +0.256 (173) / +0.277 (170) / +0.321 (250) | CI!0 |
| 10:00 | 30 | 3542 / 593 | +0.243 [+0.201, +0.285] | 0.0005 | +0.46 [+0.41, +0.51] | 1.33 | 28% | +0.49 | +2.73 | -0.48 | +2.11 | +0.220 (173) / +0.212 (170) / +0.280 (250) | CI!0 |
| 10:00 | 60 | 3542 / 593 | +0.122 [+0.081, +0.163] | 0.0005 | +0.27 [+0.22, +0.32] | 1.17 | 35% | +0.28 | +1.34 | -0.04 | +1.23 | +0.112 (173) / +0.078 (170) / +0.158 (250) | CI!0 |
| 10:00 | close | 3542 / 593 | -0.296 [-0.325, -0.268] | 0.0005 | -0.20 [-0.23, -0.18] | 0.74 | 81% | -0.09 | -0.06 | -0.28 | +0.14 | -0.334 (173) / -0.288 (170) / -0.274 (250) | CI!0 |
| 10:30 | 15 | 3556 / 593 | +0.023 [-0.021, +0.067] | 0.319 | +0.22 [+0.18, +0.27] | 1.06 | 45% | +0.21 | +33.77 ~ | -50.83 ~ | +1.49 ~ | +0.013 (173) / -0.041 (170) / +0.073 (250) | - |
| 10:30 | 30 | 3556 / 593 | +0.007 [-0.036, +0.051] | 0.745 | +0.16 [+0.11, +0.20] | 1.05 | 46% | +0.15 | +4.52 ~ | +0.71 ~ | +0.74 ~ | -0.007 (173) / -0.042 (170) / +0.050 (250) | - |
| 10:30 | 60 | 3556 / 593 | -0.082 [-0.124, -0.038] | 0.0005 | +0.04 [+0.01, +0.08] | 0.97 | 52% | +0.02 | +1.80 ~ | +0.74 ~ | +0.67 ~ | -0.094 (173) / -0.122 (170) / -0.047 (250) | CI!0 |
| 10:30 | close | 3556 / 593 | -0.314 [-0.344, -0.284] | 0.0005 | -0.21 [-0.24, -0.18] | 0.73 | 81% | -0.10 | -0.08 ~ | -0.16 ~ | +0.39 ~ | -0.368 (173) / -0.298 (170) / -0.287 (250) | CI!0 |
| 11:00 | 15 | 3558 / 593 | -0.173 [-0.221, -0.125] | 0.0005 | +0.02 [-0.02, +0.06] | 0.88 | 58% | +0.00 | +0.97 ~ | -0.64 ~ | +0.90 ~ | -0.209 (173) / -0.183 (170) / -0.140 (250) | CI!0 |
| 11:00 | 30 | 3558 / 593 | -0.190 [-0.238, -0.143] | 0.0005 | -0.03 [-0.07, +0.01] | 0.86 | 61% | -0.07 | +0.71 ~ | -0.62 ~ | +0.76 ~ | -0.215 (173) / -0.211 (170) / -0.158 (250) | CI!0 |
| 11:00 | 60 | 3558 / 593 | -0.256 [-0.304, -0.211] | 0.0005 | -0.11 [-0.14, -0.07] | 0.81 | 67% | -0.16 | +0.38 ~ | -0.26 ~ | +0.50 ~ | -0.286 (173) / -0.279 (170) / -0.220 (250) | CI!0 |
| 11:00 | close | 3558 / 593 | -0.332 [-0.363, -0.301] | 0.0005 | -0.22 [-0.25, -0.19] | 0.71 | 81% | -0.10 | -0.11 ~ | -0.20 ~ | +0.46 ~ | -0.403 (173) / -0.307 (170) / -0.299 (250) | CI!0 |
| 11:30 | 15 | 3558 / 593 | -0.361 [-0.412, -0.312] | 0.0005 | -0.13 [-0.17, -0.09] | 0.72 | 72% | -0.13 | +1.11 ~ | -0.92 ~ | +2.47 ~ | -0.389 (173) / -0.404 (170) / -0.313 (250) | CI!0 |
| 11:30 | 30 | 3558 / 593 | -0.355 [-0.405, -0.305] | 0.0005 | -0.16 [-0.20, -0.12] | 0.73 | 73% | -0.20 | +0.03 ~ | -0.56 ~ | +0.80 ~ | -0.398 (173) / -0.381 (170) / -0.307 (250) | CI!0 |
| 11:30 | 60 | 3558 / 593 | -0.410 [-0.458, -0.362] | 0.0005 | -0.22 [-0.26, -0.19] | 0.70 | 79% | -0.31 | +0.05 ~ | -0.55 ~ | +0.24 ~ | -0.470 (173) / -0.430 (170) / -0.354 (250) | CI!0 |
| 11:30 | close | 3558 / 593 | -0.340 [-0.372, -0.308] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 81% | -0.10 | -0.19 ~ | -0.36 ~ | -0.06 ~ | -0.416 (173) / -0.316 (170) / -0.303 (250) | CI!0 |
| 12:00 | 15 | 3554 / 593 | -0.527 [-0.577, -0.477] | 0.0005 | -0.26 [-0.29, -0.22] | 0.62 | 79% | -0.29 | +0.96 | -1.27 | +0.89 | -0.612 (173) / -0.540 (170) / -0.460 (250) | CI!0 |
| 12:00 | 30 | 3554 / 593 | -0.529 [-0.579, -0.478] | 0.0005 | -0.29 [-0.32, -0.26] | 0.62 | 82% | -0.33 | +0.42 | -0.76 | +0.38 | -0.618 (173) / -0.546 (170) / -0.455 (250) | CI!0 |
| 12:00 | 60 | 3524 / 593 | -0.523 [-0.572, -0.474] | 0.0005 | -0.30 [-0.33, -0.27] | 0.64 | 84% | -0.32 | +0.21 | -0.48 | +0.12 | -0.612 (173) / -0.565 (170) / -0.432 (250) | CI!0 |
| 12:00 | close | 3554 / 593 | -0.358 [-0.391, -0.326] | 0.0005 | -0.23 [-0.26, -0.20] | 0.69 | 81% | -0.10 | -0.04 | -0.21 | +0.23 | -0.442 (173) / -0.341 (170) / -0.312 (250) | CI!0 >H |
| 12:30 | 15 | 3528 / 593 | -0.683 [-0.738, -0.632] | 0.0005 | -0.35 [-0.38, -0.32] | 0.54 | 85% | -0.37 | +4.46 ~ | -2.68 ~ | +0.57 ~ | -0.769 (173) / -0.730 (170) / -0.592 (250) | CI!0 |
| 12:30 | 30 | 3528 / 593 | -0.612 [-0.668, -0.559] | 0.0005 | -0.33 [-0.36, -0.29] | 0.58 | 86% | -0.33 | -0.23 ~ | -0.74 ~ | +0.03 ~ | -0.699 (173) / -0.683 (170) / -0.503 (250) | CI!0 |
| 12:30 | 60 | 3522 / 587 | -0.592 [-0.644, -0.540] | 0.0005 | -0.33 [-0.37, -0.30] | 0.58 | 86% | -0.30 | - ~ | - ~ | - ~ | -0.699 (170) / -0.676 (169) / -0.462 (248) | CI!0 |
| 12:30 | close | 3528 / 593 | -0.381 [-0.413, -0.348] | 0.0005 | -0.25 [-0.28, -0.22] | 0.68 | 83% | -0.11 | -0.01 ~ | -0.18 ~ | +0.17 ~ | -0.470 (173) / -0.371 (170) / -0.325 (250) | CI!0 |
| 13:00 | 15 | 3522 / 587 | -0.702 [-0.758, -0.646] | 0.0005 | -0.34 [-0.38, -0.30] | 0.52 | 84% | -0.33 | +0.46 ~ | -0.92 ~ | +0.31 ~ | -0.822 (170) / -0.799 (169) / -0.553 (248) | CI!0 |
| 13:00 | 30 | 3522 / 587 | -0.679 [-0.736, -0.624] | 0.0005 | -0.36 [-0.40, -0.33] | 0.54 | 87% | -0.33 | +1.16 ~ | -1.36 ~ | +0.02 ~ | -0.810 (170) / -0.773 (169) / -0.526 (248) | CI!0 |
| 13:00 | 60 | 3522 / 587 | -0.570 [-0.610, -0.529] | 0.0005 | -0.34 [-0.37, -0.31] | 0.57 | 86% | -0.35 | +0.22 ~ | -0.74 ~ | -0.02 ~ | -0.712 (170) / -0.594 (169) / -0.456 (248) | CI!0 >H |
| 13:00 | close | 3522 / 587 | -0.404 [-0.436, -0.370] | 0.0005 | -0.26 [-0.29, -0.23] | 0.67 | 84% | -0.12 | -0.13 ~ | -0.41 ~ | +0.05 ~ | -0.495 (170) / -0.391 (169) / -0.351 (248) | CI!0 |
| 13:30 | 15 | 3521 / 587 | -0.776 [-0.821, -0.731] | 0.0005 | -0.40 [-0.43, -0.38] | 0.48 | 87% | -0.44 | +0.83 ~ | -1.88 ~ | +0.89 ~ | -0.917 (170) / -0.814 (169) / -0.652 (248) | CI!0 |
| 13:30 | 30 | 3521 / 587 | -0.644 [-0.686, -0.602] | 0.0005 | -0.37 [-0.40, -0.34] | 0.52 | 87% | -0.43 | +0.05 ~ | -0.61 ~ | +0.38 ~ | -0.800 (170) / -0.638 (169) / -0.541 (248) | CI!0 |
| 13:30 | 60 | 3521 / 587 | -0.590 [-0.632, -0.549] | 0.0005 | -0.36 [-0.39, -0.33] | 0.54 | 86% | -0.39 | +0.01 ~ | -0.33 ~ | +0.19 ~ | -0.768 (170) / -0.562 (169) / -0.488 (248) | CI!0 >H |
| 13:30 | close | 3521 / 587 | -0.439 [-0.471, -0.406] | 0.0005 | -0.29 [-0.32, -0.26] | 0.64 | 86% | -0.14 | -0.06 ~ | -0.24 ~ | +0.12 ~ | -0.530 (170) / -0.416 (169) / -0.392 (248) | CI!0 >H |
| 14:00 | 15 | 3520 / 587 | -0.725 [-0.770, -0.680] | 0.0005 | -0.38 [-0.42, -0.35] | 0.48 | 87% | -0.41 | +2.27 | -1.35 | +0.93 | -0.951 (170) / -0.679 (169) / -0.603 (248) | CI!0 |
| 14:00 | 30 | 3520 / 587 | -0.680 [-0.724, -0.636] | 0.0005 | -0.39 [-0.42, -0.37] | 0.50 | 89% | -0.41 | +0.33 | -0.64 | +0.22 | -0.905 (170) / -0.635 (169) / -0.558 (248) | CI!0 |
| 14:00 | 60 | 3520 / 587 | -0.620 [-0.660, -0.581] | 0.0005 | -0.38 [-0.41, -0.35] | 0.54 | 90% | -0.35 | -0.12 | -0.44 | +0.35 | -0.824 (170) / -0.568 (169) / -0.516 (248) | CI!0 |
| 14:00 | close | 3520 / 587 | -0.480 [-0.513, -0.447] | 0.0005 | -0.32 [-0.35, -0.29] | 0.62 | 88% | -0.17 | -0.14 | -0.33 | +0.43 | -0.578 (170) / -0.454 (169) / -0.431 (248) | CI!0 |
| 14:30 | 15 | 3518 / 587 | -0.806 [-0.850, -0.763] | 0.0005 | -0.45 [-0.47, -0.42] | 0.46 | 90% | -0.46 | -0.16 ~ | -0.82 ~ | +0.10 ~ | -1.038 (170) / -0.729 (169) / -0.701 (248) | CI!0 |
| 14:30 | 30 | 3518 / 587 | -0.719 [-0.760, -0.679] | 0.0005 | -0.43 [-0.46, -0.40] | 0.50 | 92% | -0.43 | -0.03 ~ | -0.69 ~ | +0.08 ~ | -0.940 (170) / -0.636 (169) / -0.625 (248) | CI!0 |
| 14:30 | 60 | 3518 / 587 | -0.666 [-0.703, -0.631] | 0.0005 | -0.43 [-0.45, -0.40] | 0.52 | 94% | -0.42 | -0.28 ~ | -0.56 ~ | +0.05 ~ | -0.828 (170) / -0.593 (169) / -0.606 (248) | CI!0 >H >H(CI) |
| 14:30 | close | 3518 / 587 | -0.538 [-0.571, -0.504] | 0.0005 | -0.36 [-0.38, -0.34] | 0.59 | 91% | -0.21 | -0.32 ~ | -0.42 ~ | +0.34 ~ | -0.624 (170) / -0.498 (169) / -0.505 (248) | CI!0 >H >H(CI) |
| 15:00 | 15 | 3507 / 586 | -0.878 [-0.922, -0.838] | 0.0005 | -0.50 [-0.52, -0.48] | 0.43 | 94% | -0.53 | +0.04 ~ | -0.66 ~ | -0.23 ~ | -1.092 (169) / -0.787 (169) / -0.796 (248) | CI!0 |
| 15:00 | 30 | 3507 / 586 | -0.810 [-0.851, -0.772] | 0.0005 | -0.49 [-0.51, -0.48] | 0.47 | 96% | -0.51 | -0.14 ~ | -0.48 ~ | +0.00 ~ | -0.960 (169) / -0.738 (169) / -0.757 (248) | CI!0 |
| 15:00 | 60 | 585 / 585 | -0.571 [-0.609, -0.535] | 0.0005 | -0.38 [-0.40, -0.36] | 0.58 | 92% | -0.27 | - ~ | - ~ | - ~ | -0.648 (168) / -0.540 (169) / -0.540 (248) | CI!0 >H >H(CI) |
| 15:00 | close | 3507 / 586 | -0.618 [-0.658, -0.580] | 0.0005 | -0.40 [-0.42, -0.38] | 0.56 | 93% | -0.27 | -0.24 ~ | -0.35 ~ | +0.42 ~ | -0.679 (169) / -0.598 (169) / -0.591 (248) | CI!0 >H >H(CI) |
| 15:30 | 15 | 585 / 585 | -1.019 [-1.068, -0.971] | 0.0005 | -0.58 [-0.60, -0.56] | 0.37 | 98% | -0.61 | -0.38 ~ | -0.76 ~ | -0.27 ~ | -1.109 (168) / -0.942 (169) / -1.010 (248) | CI!0 |
| 15:30 | 30 | 585 / 585 | -0.689 [-0.734, -0.647] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 93% | -0.33 | -0.33 ~ | -0.43 ~ | +0.45 ~ | -0.721 (168) / -0.685 (169) / -0.669 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 585 / 585 | -0.689 [-0.734, -0.647] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 93% | -0.33 | -0.33 ~ | -0.43 ~ | +0.45 ~ | -0.721 (168) / -0.685 (169) / -0.669 (248) | CI!0 >H >H(CI) |

### D6 unconditional variance premium, h = close

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:45 | close | 591 / 591 | -0.284 [-0.312, -0.258] | 0.0005 | -0.20 [-0.22, -0.17] | 0.73 | 80% | -0.11 | +0.34 ~ | +0.12 ~ | +0.20 ~ | -0.301 (171) / -0.283 (170) / -0.273 (250) | CI!0 |
| 10:00 | close | 592 / 592 | -0.283 [-0.312, -0.255] | 0.0005 | -0.19 [-0.22, -0.17] | 0.74 | 80% | -0.06 | -0.06 | -0.28 | +0.14 | -0.319 (172) / -0.271 (170) / -0.267 (250) | CI!0 |
| 10:30 | close | 593 / 593 | -0.304 [-0.335, -0.275] | 0.0005 | -0.20 [-0.23, -0.18] | 0.73 | 80% | -0.11 | -0.08 ~ | -0.16 ~ | +0.39 ~ | -0.343 (173) / -0.296 (170) / -0.283 (250) | CI!0 |
| 12:00 | close | 593 / 593 | -0.337 [-0.371, -0.305] | 0.0005 | -0.22 [-0.25, -0.19] | 0.70 | 79% | -0.12 | -0.04 | -0.21 | +0.23 | -0.424 (173) / -0.316 (170) / -0.292 (250) | CI!0 >H |

### Grid sensitivity (G; reported, never used to choose)

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 1.5 | 10580 / 439 | +0.323 [+0.284, +0.360] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | +0.02 [-0.02, +0.06] (-0.22) | +0.00 | long +3.69 / short-below -1.83 / Z2 +2.12 | +0.366 (120) / +0.323 (127) / +0.304 (192) | CI!0 |
| D1 | expansion | 30 | 1.5 | 10580 / 439 | +0.304 [+0.268, +0.340] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | -0.01 [-0.05, +0.02] (-0.24) | -0.02 | long +1.38 / short-below -0.79 / Z2 +0.97 | +0.353 (120) / +0.298 (127) / +0.286 (192) | CI!0 |
| D1 | expansion | 60 | 1.5 | 9549 / 437 | +0.281 [+0.246, +0.314] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | -0.04 [-0.08, -0.01] (-0.24) | -0.10 | long +0.52 / short-below -0.34 / Z2 +0.55 | +0.340 (120) / +0.271 (127) / +0.255 (190) | CI!0 |
| D1 | expansion | close | 1.5 | 10580 / 439 | +0.179 [+0.149, +0.211] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.15 [-0.19, -0.12] (-0.28) | -0.05 | long -0.09 / short-below -0.27 / Z2 +0.27 | +0.278 (120) / +0.134 (127) / +0.138 (192) | CI!0 |
| D1 | expansion | 15 | 3.0 | 3555 / 217 | +0.464 [+0.407, +0.523] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | +0.08 [+0.02, +0.15] (-0.27) | +0.07 | long +3.69 / short-below -1.83 / Z2 +2.12 | +0.492 (73) / +0.502 (64) / +0.505 (80) | CI!0 |
| D1 | expansion | 30 | 3.0 | 3555 / 217 | +0.429 [+0.376, +0.485] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | +0.04 [-0.02, +0.10] (-0.28) | +0.02 | long +1.38 / short-below -0.79 / Z2 +0.97 | +0.468 (73) / +0.463 (64) / +0.452 (80) | CI!0 |
| D1 | expansion | 60 | 3.0 | 3116 / 215 | +0.383 [+0.330, +0.435] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | +0.00 [-0.05, +0.06] (-0.27) | -0.05 | long +0.52 / short-below -0.34 / Z2 +0.55 | +0.431 (73) / +0.426 (64) / +0.380 (78) | CI!0 |
| D1 | expansion | close | 3.0 | 3555 / 217 | +0.258 [+0.206, +0.308] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.10 [-0.15, -0.06] (-0.29) | +0.07 | long -0.09 / short-below -0.27 / Z2 +0.27 | +0.350 (73) / +0.227 (64) / +0.202 (80) | CI!0 |
| D2 | compression | 15 | 0.4 | 4227 / 281 | -0.476 [-0.556, -0.405] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | -0.53 [-0.56, -0.50] (-0.27) | -0.54 | long +3.69 / short-below -1.83 / Z2 +2.12 | -0.396 (94) / -0.616 (74) / -0.383 (113) | CI!0 |
| D2 | compression | 30 | 0.4 | 4227 / 281 | -0.446 [-0.520, -0.378] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | -0.52 [-0.55, -0.49] (-0.28) | -0.51 | long +1.38 / short-below -0.79 / Z2 +0.97 | -0.379 (94) / -0.558 (74) / -0.360 (113) | CI!0 |
| D2 | compression | 60 | 0.4 | 3757 / 272 | -0.417 [-0.484, -0.351] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | -0.51 [-0.54, -0.47] (-0.27) | -0.44 | long +0.52 / short-below -0.34 / Z2 +0.55 | -0.362 (92) / -0.514 (71) / -0.328 (109) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.4 | 4227 / 281 | -0.239 [-0.295, -0.186] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.44 [-0.47, -0.40] (-0.28) | -0.22 | long -0.09 / short-below -0.27 / Z2 +0.27 | -0.269 (94) / -0.185 (74) / -0.167 (113) | CI!0 >H >H(CI) |
| D2 | compression | 15 | 0.67 | 12093 / 459 | -0.314 [-0.359, -0.274] | 0.0005 | 0.0010 | +0.392 [+0.361, +0.422] | -0.41 [-0.44, -0.39] (-0.22) | -0.42 | long +3.69 / short-below -1.83 / Z2 +2.12 | -0.319 (120) / -0.329 (132) / -0.278 (207) | CI!0 |
| D2 | compression | 30 | 0.67 | 12093 / 459 | -0.298 [-0.340, -0.260] | 0.0005 | 0.0010 | +0.429 [+0.394, +0.462] | -0.42 [-0.44, -0.39] (-0.24) | -0.42 | long +1.38 / short-below -0.79 / Z2 +0.97 | -0.313 (120) / -0.314 (132) / -0.253 (207) | CI!0 |
| D2 | compression | 60 | 0.67 | 10883 / 451 | -0.278 [-0.320, -0.240] | 0.0005 | 0.0010 | +0.433 [+0.395, +0.470] | -0.41 [-0.43, -0.38] (-0.24) | -0.39 | long +0.52 / short-below -0.34 / Z2 +0.55 | -0.298 (120) / -0.296 (130) / -0.229 (201) | CI!0 >H >H(CI) |
| D2 | compression | close | 0.67 | 12093 / 459 | -0.157 [-0.188, -0.128] | 0.0005 | 0.0010 | +0.353 [+0.304, +0.399] | -0.38 [-0.41, -0.34] (-0.28) | -0.17 | long -0.09 / short-below -0.27 / Z2 +0.27 | -0.219 (120) / -0.125 (132) / -0.109 (207) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | quintile | 7070 / 547 | -0.035 [-0.063, -0.007] | 0.009 | 0.012 | +0.008 [-0.008, +0.025] | -0.15 [-0.19, -0.11] (-0.26) | -0.14 | |E[za]|* +0.26 | -0.027 (159) / -0.023 (162) / -0.049 (226) | CI!0 |
| D3 | bottom | 30 | quintile | 7070 / 547 | -0.054 [-0.090, -0.020] | 0.002 | 0.002 | +0.025 [+0.003, +0.047] | -0.17 [-0.21, -0.13] (-0.27) | -0.17 | |E[za]|* +0.20 | -0.030 (159) / -0.021 (162) / -0.091 (226) | CI!0 |
| D3 | bottom | 60 | quintile | 6431 / 543 | -0.074 [-0.118, -0.030] | 0.0005 | 0.0010 | +0.035 [+0.007, +0.064] | -0.18 [-0.22, -0.14] (-0.27) | -0.16 | |E[za]|* +0.15 | -0.009 (157) / -0.045 (161) / -0.136 (225) | CI!0 |
| D3 | bottom | close | quintile | 7070 / 547 | -0.082 [-0.135, -0.033] | 0.002 | 0.002 | +0.049 [+0.018, +0.079] | -0.22 [-0.25, -0.19] (-0.28) | -0.06 | |E[za]|* +0.13 | -0.089 (159) / -0.082 (162) / -0.077 (226) | CI!0 |
| D3 | top | 15 | quintile | 7061 / 565 | -0.012 [-0.038, +0.015] | 0.369 | 0.374 | +0.008 [-0.008, +0.025] | -0.31 [-0.33, -0.28] (-0.28) | -0.35 | |E[za]|* +0.26 | +0.018 (172) / -0.013 (159) / -0.035 (234) | - |
| D3 | top | 30 | quintile | 7061 / 565 | -0.031 [-0.063, +0.000] | 0.052 | 0.070 | +0.025 [+0.003, +0.047] | -0.31 [-0.34, -0.29] (-0.29) | -0.33 | |E[za]|* +0.20 | -0.005 (172) / -0.026 (159) / -0.054 (234) | - |
| D3 | top | 60 | quintile | 6259 / 550 | -0.039 [-0.078, -0.001] | 0.043 | 0.074 | +0.035 [+0.007, +0.064] | -0.31 [-0.33, -0.28] (-0.28) | -0.34 | |E[za]|* +0.15 | -0.025 (167) / -0.017 (154) / -0.062 (229) | CI!0 |
| D3 | top | close | quintile | 7061 / 565 | -0.053 [-0.100, -0.010] | 0.021 | 0.043 | +0.049 [+0.018, +0.079] | -0.30 [-0.33, -0.27] (-0.28) | -0.15 | |E[za]|* +0.13 | -0.020 (172) / -0.099 (159) / -0.047 (234) | CI!0 |
| D3 | top-bottom | 15 | quintile | 14131 / 593 | -0.024 [-0.045, -0.002] | 0.031 | 0.035 | +0.008 [-0.008, +0.025] | -0.23 [-0.26, -0.20] (-0.27) | -0.25 | |E[za]|* +0.26 | -0.002 (173) / -0.018 (170) / -0.042 (250) | CI!0 |
| D3 | top-bottom | 30 | quintile | 14131 / 593 | -0.043 [-0.071, -0.015] | 0.003 | 0.005 | +0.025 [+0.003, +0.047] | -0.24 [-0.27, -0.21] (-0.28) | -0.25 | |E[za]|* +0.20 | -0.016 (173) / -0.024 (170) / -0.073 (250) | CI!0 |
| D3 | top-bottom | 60 | quintile | 12690 / 593 | -0.057 [-0.092, -0.023] | 0.0005 | 0.003 | +0.035 [+0.007, +0.064] | -0.24 [-0.27, -0.21] (-0.28) | -0.24 | |E[za]|* +0.15 | -0.018 (173) / -0.032 (170) / -0.100 (250) | CI!0 |
| D3 | top-bottom | close | quintile | 14131 / 593 | -0.068 [-0.111, -0.027] | 0.003 | 0.002 | +0.049 [+0.018, +0.079] | -0.26 [-0.29, -0.24] (-0.28) | -0.10 | |E[za]|* +0.13 | -0.051 (173) / -0.090 (170) / -0.062 (250) | CI!0 |
| D4 | high | 15 | quintile | 7067 / 415 | -0.582 [-0.652, -0.511] | 0.0005 | 0.0010 | -0.425 [-0.453, -0.396] | -0.64 [-0.66, -0.63] (-0.40) | -0.66 | long +3.69 / short-below -1.83 / Z2 +2.12 | -0.382 (146) / -0.585 (124) / -0.734 (145) | CI!0 |
| D4 | high | 30 | quintile | 7067 / 415 | -0.540 [-0.604, -0.474] | 0.0005 | 0.0010 | -0.450 [-0.478, -0.419] | -0.62 [-0.64, -0.60] (-0.39) | -0.63 | long +1.38 / short-below -0.79 / Z2 +0.97 | -0.360 (146) / -0.534 (124) / -0.683 (145) | CI!0 |
| D4 | high | 60 | quintile | 5481 / 364 | -0.524 [-0.591, -0.456] | 0.0005 | 0.0010 | -0.446 [-0.477, -0.412] | -0.58 [-0.60, -0.56] (-0.36) | -0.57 | long +0.52 / short-below -0.34 / Z2 +0.55 | -0.366 (129) / -0.485 (113) / -0.672 (122) | CI!0 >H >H(CI) |
| D4 | high | close | quintile | 7067 / 415 | -0.237 [-0.277, -0.196] | 0.0005 | 0.0010 | -0.267 [-0.304, -0.225] | -0.46 [-0.49, -0.43] (-0.33) | -0.34 | long -0.09 / short-below -0.27 / Z2 +0.27 | -0.200 (146) / -0.122 (124) / -0.343 (145) | CI!0 >H >H(CI) |
| D4 | low | 15 | quintile | 7067 / 546 | +0.319 [+0.277, +0.362] | 0.0005 | 0.0010 | -0.425 [-0.453, -0.396] | +0.22 [+0.18, +0.25] (-0.03) | +0.19 | long +3.69 / short-below -1.83 / Z2 +2.12 | +0.334 (153) / +0.345 (159) / +0.281 (234) | CI!0 |
| D4 | low | 30 | quintile | 7067 / 546 | +0.301 [+0.261, +0.342] | 0.0005 | 0.0010 | -0.450 [-0.478, -0.419] | +0.15 [+0.12, +0.18] (-0.07) | +0.11 | long +1.38 / short-below -0.79 / Z2 +0.97 | +0.324 (153) / +0.325 (159) / +0.263 (234) | CI!0 |
| D4 | low | 60 | quintile | 6968 / 544 | +0.274 [+0.238, +0.314] | 0.0005 | 0.0010 | -0.446 [-0.477, -0.412] | +0.06 [+0.03, +0.09] (-0.13) | -0.02 | long +0.52 / short-below -0.34 / Z2 +0.55 | +0.299 (153) / +0.292 (159) / +0.238 (232) | CI!0 |
| D4 | low | close | quintile | 7067 / 546 | +0.120 [+0.096, +0.145] | 0.0005 | 0.0010 | -0.267 [-0.304, -0.225] | -0.15 [-0.18, -0.11] (-0.23) | -0.01 | long -0.09 / short-below -0.27 / Z2 +0.27 | +0.158 (153) / +0.087 (159) / +0.110 (234) | CI!0 |

D5 60-min buckets (G):

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 5315 / 593 | +0.336 [+0.297, +0.376] | 0.0005 | +0.67 [+0.61, +0.72] | 1.45 | 26% | +0.66 | - | - | +3.23 | +0.324 (173) / +0.327 (170) / +0.350 (250) | CI!0 |
| 09:30 | 30 | 5315 / 593 | +0.300 [+0.260, +0.340] | 0.0005 | +0.54 [+0.49, +0.60] | 1.41 | 24% | +0.57 | - | -1.94 | +1.99 | +0.283 (173) / +0.280 (170) / +0.325 (250) | CI!0 |
| 09:30 | 60 | 5315 / 593 | +0.173 [+0.134, +0.214] | 0.0005 | +0.33 [+0.29, +0.38] | 1.23 | 31% | +0.33 | - | - | +1.25 | +0.166 (173) / +0.137 (170) / +0.203 (250) | CI!0 |
| 09:30 | close | 5315 / 593 | -0.294 [-0.323, -0.266] | 0.0005 | -0.20 [-0.23, -0.18] | 0.74 | 81% | -0.09 | +0.08 | -0.14 | +0.16 | -0.329 (173) / -0.286 (170) / -0.275 (250) | CI!0 |
| 10:30 | 15 | 7114 / 593 | -0.075 [-0.118, -0.031] | 0.0005 | +0.12 [+0.08, +0.16] | 0.97 | 52% | +0.11 | +17.36 | -25.73 | +1.20 | -0.098 (173) / -0.112 (170) / -0.034 (250) | CI!0 |
| 10:30 | 30 | 7114 / 593 | -0.091 [-0.135, -0.047] | 0.0005 | +0.06 [+0.03, +0.10] | 0.95 | 54% | +0.04 | +2.62 | +0.05 | +0.75 | -0.111 (173) / -0.126 (170) / -0.054 (250) | CI!0 |
| 10:30 | 60 | 7114 / 593 | -0.169 [-0.213, -0.126] | 0.0005 | -0.03 [-0.07, +0.01] | 0.89 | 60% | -0.07 | +1.09 | +0.24 | +0.59 | -0.190 (173) / -0.200 (170) / -0.134 (250) | CI!0 |
| 10:30 | close | 7114 / 593 | -0.323 [-0.353, -0.293] | 0.0005 | -0.21 [-0.24, -0.19] | 0.72 | 81% | -0.10 | -0.09 | -0.18 | +0.43 | -0.385 (173) / -0.303 (170) / -0.293 (250) | CI!0 |
| 11:30 | 15 | 7112 / 593 | -0.444 [-0.491, -0.397] | 0.0005 | -0.19 [-0.23, -0.16] | 0.67 | 75% | -0.21 | +1.03 | -1.09 | +1.68 | -0.500 (173) / -0.472 (170) / -0.386 (250) | CI!0 |
| 11:30 | 30 | 7112 / 593 | -0.442 [-0.489, -0.395] | 0.0005 | -0.23 [-0.26, -0.19] | 0.68 | 78% | -0.27 | +0.22 | -0.66 | +0.59 | -0.508 (173) / -0.464 (170) / -0.381 (250) | CI!0 |
| 11:30 | 60 | 7082 / 593 | -0.466 [-0.514, -0.420] | 0.0005 | -0.26 [-0.29, -0.23] | 0.67 | 81% | -0.31 | +0.13 | -0.52 | +0.18 | -0.540 (173) / -0.498 (170) / -0.393 (250) | CI!0 |
| 11:30 | close | 7112 / 593 | -0.349 [-0.381, -0.317] | 0.0005 | -0.23 [-0.25, -0.20] | 0.69 | 81% | -0.10 | -0.12 | -0.28 | +0.08 | -0.429 (173) / -0.328 (170) / -0.308 (250) | CI!0 |
| 12:30 | 15 | 7050 / 593 | -0.692 [-0.747, -0.642] | 0.0005 | -0.35 [-0.38, -0.31] | 0.53 | 85% | -0.35 | +2.46 | -1.80 | +0.44 | -0.795 (173) / -0.764 (170) / -0.572 (250) | CI!0 |
| 12:30 | 30 | 7050 / 593 | -0.645 [-0.700, -0.594] | 0.0005 | -0.35 [-0.38, -0.31] | 0.56 | 86% | -0.33 | +0.47 | -1.05 | +0.02 | -0.754 (173) / -0.728 (170) / -0.515 (250) | CI!0 |
| 12:30 | 60 | 7044 / 587 | -0.581 [-0.625, -0.537] | 0.0005 | -0.34 [-0.37, -0.31] | 0.57 | 86% | -0.33 | - | - | - | -0.706 (170) / -0.635 (169) / -0.459 (248) | CI!0 |
| 12:30 | close | 7050 / 593 | -0.392 [-0.425, -0.360] | 0.0005 | -0.26 [-0.28, -0.23] | 0.67 | 84% | -0.11 | -0.07 | -0.29 | +0.11 | -0.483 (173) / -0.381 (170) / -0.338 (250) | CI!0 |
| 13:30 | 15 | 7041 / 587 | -0.751 [-0.788, -0.711] | 0.0005 | -0.39 [-0.42, -0.37] | 0.48 | 87% | -0.43 | +1.55 | -1.62 | +0.91 | -0.934 (170) / -0.747 (169) / -0.627 (248) | CI!0 |
| 13:30 | 30 | 7041 / 587 | -0.662 [-0.701, -0.623] | 0.0005 | -0.38 [-0.41, -0.35] | 0.51 | 88% | -0.42 | +0.19 | -0.63 | +0.30 | -0.852 (170) / -0.636 (169) / -0.549 (248) | CI!0 |
| 13:30 | 60 | 7041 / 587 | -0.605 [-0.645, -0.566] | 0.0005 | -0.37 [-0.40, -0.34] | 0.54 | 88% | -0.37 | -0.06 | -0.38 | +0.27 | -0.796 (170) / -0.565 (169) / -0.502 (248) | CI!0 >H >H(CI) |
| 13:30 | close | 7041 / 587 | -0.459 [-0.492, -0.427] | 0.0005 | -0.31 [-0.33, -0.28] | 0.63 | 87% | -0.15 | -0.10 | -0.28 | +0.27 | -0.554 (170) / -0.435 (169) / -0.411 (248) | CI!0 >H >H(CI) |
| 14:30 | 15 | 7025 / 587 | -0.842 [-0.882, -0.803] | 0.0005 | -0.47 [-0.49, -0.45] | 0.45 | 92% | -0.49 | -0.06 | -0.74 | -0.06 | -1.065 (170) / -0.758 (169) / -0.748 (248) | CI!0 |
| 14:30 | 30 | 7025 / 587 | -0.764 [-0.802, -0.728] | 0.0005 | -0.46 [-0.48, -0.44] | 0.48 | 94% | -0.47 | -0.08 | -0.59 | +0.04 | -0.950 (170) / -0.687 (169) / -0.691 (248) | CI!0 |
| 14:30 | 60 | 4103 / 587 | -0.653 [-0.689, -0.618] | 0.0005 | -0.42 [-0.44, -0.40] | 0.53 | 94% | -0.40 | - | - | - | -0.803 (170) / -0.585 (169) / -0.596 (248) | CI!0 >H >H(CI) |
| 14:30 | close | 7025 / 587 | -0.578 [-0.613, -0.543] | 0.0005 | -0.38 [-0.40, -0.36] | 0.57 | 92% | -0.24 | -0.28 | -0.39 | +0.38 | -0.651 (170) / -0.548 (169) / -0.548 (248) | CI!0 >H >H(CI) |
| 15:30 | 15 | 585 / 585 | -1.019 [-1.068, -0.971] | 0.0005 | -0.58 [-0.60, -0.56] | 0.37 | 98% | -0.61 | -0.38 | -0.76 | -0.27 | -1.109 (168) / -0.942 (169) / -1.010 (248) | CI!0 |
| 15:30 | 30 | 585 / 585 | -0.689 [-0.734, -0.647] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 93% | -0.33 | -0.33 | -0.43 | +0.45 | -0.721 (168) / -0.685 (169) / -0.669 (248) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 585 / 585 | -0.689 [-0.734, -0.647] | 0.0005 | -0.43 [-0.45, -0.41] | 0.52 | 93% | -0.33 | -0.33 | -0.43 | +0.45 | -0.721 (168) / -0.685 (169) / -0.669 (248) | CI!0 >H >H(CI) |

## IWM: replication (reported, not in the FDR family)

### D1-D4, primary parameter

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 2.0 | 4722 / 244 | +0.362 [+0.313, +0.413] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | -0.01 [-0.07, +0.05] (-0.27) | +0.02 | long +11.74 / short-below -4.57 / Z2 +3.69 | +0.384 (66) / +0.394 (90) / +0.328 (88) | CI!0 |
| D1 | expansion | 30 | 2.0 | 4722 / 244 | +0.334 [+0.287, +0.383] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.05 [-0.10, +0.02] (-0.29) | +0.04 | long +2.86 / short-below -1.74 / Z2 +1.85 | +0.364 (66) / +0.365 (90) / +0.294 (88) | CI!0 |
| D1 | expansion | 60 | 2.0 | 4164 / 238 | +0.311 [+0.265, +0.358] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.05 [-0.11, +0.01] (-0.28) | +0.06 | long +1.20 / short-below -0.65 / Z2 +0.83 | +0.350 (64) / +0.339 (90) / +0.262 (84) | CI!0 |
| D1 | expansion | close | 2.0 | 4722 / 244 | +0.209 [+0.167, +0.249] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.18 [-0.23, -0.12] (-0.33) | -0.02 | long +0.00 / short-below -0.29 / Z2 +0.58 | +0.276 (66) / +0.201 (90) / +0.153 (88) | CI!0 |
| D2 | compression | 15 | 0.5 | 4505 / 289 | -0.345 [-0.418, -0.276] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | -0.45 [-0.49, -0.41] (-0.26) | -0.45 | long +11.74 / short-below -4.57 / Z2 +3.69 | -0.270 (88) / -0.410 (100) / -0.311 (101) | CI!0 |
| D2 | compression | 30 | 0.5 | 4505 / 289 | -0.327 [-0.399, -0.258] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.46 [-0.49, -0.42] (-0.28) | -0.45 | long +2.86 / short-below -1.74 / Z2 +1.85 | -0.259 (88) / -0.385 (100) / -0.299 (101) | CI!0 |
| D2 | compression | 60 | 0.5 | 4033 / 288 | -0.295 [-0.365, -0.227] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.44 [-0.47, -0.40] (-0.28) | -0.40 | long +1.20 / short-below -0.65 / Z2 +0.83 | -0.241 (88) / -0.350 (100) / -0.258 (100) | CI!0 |
| D2 | compression | close | 0.5 | 4505 / 289 | -0.141 [-0.188, -0.096] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.42 [-0.45, -0.38] (-0.32) | -0.35 | long +0.00 / short-below -0.29 / Z2 +0.58 | -0.172 (88) / -0.120 (100) / -0.100 (101) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | tercile | 8703 / 436 | -0.002 [-0.024, +0.021] | 0.845 | 0.843 | +0.000 [-0.020, +0.019] | -0.24 [-0.27, -0.21] (-0.29) | -0.25 | |E[za]|* +0.41 | +0.004 (125) / -0.016 (157) / +0.003 (154) | - |
| D3 | bottom | 30 | tercile | 8703 / 436 | -0.013 [-0.040, +0.017] | 0.378 | 0.368 | +0.004 [-0.022, +0.030] | -0.26 [-0.29, -0.23] (-0.30) | -0.28 | |E[za]|* +0.28 | -0.009 (125) / -0.026 (157) / -0.006 (154) | - |
| D3 | bottom | 60 | tercile | 7927 / 435 | -0.022 [-0.057, +0.014] | 0.230 | 0.196 | +0.012 [-0.023, +0.045] | -0.26 [-0.29, -0.23] (-0.30) | -0.25 | |E[za]|* +0.23 | +0.019 (125) / -0.060 (156) / -0.018 (154) | - |
| D3 | bottom | close | tercile | 8703 / 436 | -0.010 [-0.051, +0.030] | 0.621 | 0.617 | +0.002 [-0.036, +0.035] | -0.29 [-0.33, -0.26] (-0.32) | -0.23 | |E[za]|* +0.22 | +0.006 (125) / -0.062 (157) / +0.031 (154) | - |
| D3 | top | 15 | tercile | 8733 / 437 | -0.005 [-0.025, +0.015] | 0.654 | 0.665 | +0.000 [-0.020, +0.019] | -0.32 [-0.35, -0.30] (-0.30) | -0.35 | |E[za]|* +0.41 | +0.021 (127) / -0.004 (155) / -0.031 (155) | - |
| D3 | top | 30 | tercile | 8733 / 437 | -0.006 [-0.032, +0.020] | 0.661 | 0.660 | +0.004 [-0.022, +0.030] | -0.34 [-0.36, -0.31] (-0.31) | -0.35 | |E[za]|* +0.28 | +0.019 (127) / -0.008 (155) / -0.029 (155) | - |
| D3 | top | 60 | tercile | 7747 / 435 | -0.010 [-0.045, +0.025] | 0.599 | 0.568 | +0.012 [-0.023, +0.045] | -0.33 [-0.35, -0.30] (-0.31) | -0.37 | |E[za]|* +0.23 | +0.016 (126) / -0.018 (155) / -0.026 (154) | - |
| D3 | top | close | tercile | 8733 / 437 | +0.000 [-0.040, +0.038] | 0.973 | 0.986 | +0.002 [-0.036, +0.035] | -0.34 [-0.37, -0.31] (-0.32) | -0.33 | |E[za]|* +0.22 | +0.027 (127) / -0.066 (155) / +0.047 (155) | - |
| D3 | top-bottom | 15 | tercile | 17436 / 441 | -0.004 [-0.023, +0.016] | 0.727 | 0.721 | +0.000 [-0.020, +0.019] | -0.28 [-0.31, -0.26] (-0.30) | -0.30 | |E[za]|* +0.41 | +0.013 (127) / -0.010 (158) / -0.013 (156) | - |
| D3 | top-bottom | 30 | tercile | 17436 / 441 | -0.009 [-0.035, +0.015] | 0.456 | 0.459 | +0.004 [-0.022, +0.030] | -0.30 [-0.32, -0.28] (-0.31) | -0.32 | |E[za]|* +0.28 | +0.006 (127) / -0.017 (158) / -0.017 (156) | - |
| D3 | top-bottom | 60 | tercile | 15674 / 441 | -0.016 [-0.048, +0.018] | 0.343 | 0.328 | +0.012 [-0.023, +0.045] | -0.30 [-0.32, -0.27] (-0.30) | -0.31 | |E[za]|* +0.23 | +0.018 (127) / -0.039 (158) / -0.022 (156) | - |
| D3 | top-bottom | close | tercile | 17436 / 441 | -0.005 [-0.041, +0.032] | 0.818 | 0.784 | +0.002 [-0.036, +0.035] | -0.32 [-0.34, -0.29] (-0.32) | -0.28 | |E[za]|* +0.22 | +0.017 (127) / -0.064 (158) / +0.039 (156) | - |
| D4 | high | 15 | tercile | 8719 / 426 | -0.322 [-0.375, -0.268] | 0.0005 | 0.0010 | -0.364 [-0.394, -0.332] | -0.59 [-0.61, -0.58] (-0.45) | -0.62 | long +11.74 / short-below -4.57 / Z2 +3.69 | -0.236 (120) / -0.360 (156) / -0.343 (150) | CI!0 |
| D4 | high | 30 | tercile | 8719 / 426 | -0.295 [-0.344, -0.245] | 0.0005 | 0.0010 | -0.386 [-0.416, -0.351] | -0.57 [-0.59, -0.56] (-0.44) | -0.59 | long +2.86 / short-below -1.74 / Z2 +1.85 | -0.216 (120) / -0.331 (156) / -0.310 (150) | CI!0 |
| D4 | high | 60 | tercile | 6760 / 394 | -0.300 [-0.351, -0.247] | 0.0005 | 0.0010 | -0.384 [-0.419, -0.345] | -0.54 [-0.56, -0.52] (-0.40) | -0.54 | long +1.20 / short-below -0.65 / Z2 +0.83 | -0.223 (116) / -0.334 (143) / -0.314 (135) | CI!0 |
| D4 | high | close | tercile | 8719 / 426 | -0.106 [-0.132, -0.082] | 0.0005 | 0.0010 | -0.205 [-0.246, -0.162] | -0.45 [-0.47, -0.42] (-0.38) | -0.37 | long +0.00 / short-below -0.29 / Z2 +0.58 | -0.138 (120) / -0.085 (156) / -0.079 (150) | CI!0 >H >H(CI) |
| D4 | low | 15 | tercile | 8719 / 437 | +0.233 [+0.193, +0.274] | 0.0005 | 0.0010 | -0.364 [-0.394, -0.332] | +0.08 [+0.05, +0.10] (-0.07) | +0.05 | long +11.74 / short-below -4.57 / Z2 +3.69 | +0.223 (125) / +0.261 (157) / +0.198 (155) | CI!0 |
| D4 | low | 30 | tercile | 8719 / 437 | +0.219 [+0.181, +0.258] | 0.0005 | 0.0010 | -0.386 [-0.416, -0.351] | +0.02 [-0.00, +0.05] (-0.11) | -0.00 | long +2.86 / short-below -1.74 / Z2 +1.85 | +0.210 (125) / +0.244 (157) / +0.187 (155) | CI!0 |
| D4 | low | 60 | tercile | 8589 / 436 | +0.196 [+0.160, +0.232] | 0.0005 | 0.0010 | -0.384 [-0.419, -0.345] | -0.05 [-0.08, -0.03] (-0.17) | -0.10 | long +1.20 / short-below -0.65 / Z2 +0.83 | +0.182 (125) / +0.221 (157) / +0.169 (154) | CI!0 |
| D4 | low | close | tercile | 8719 / 437 | +0.079 [+0.062, +0.097] | 0.0005 | 0.0010 | -0.205 [-0.246, -0.162] | -0.21 [-0.24, -0.17] (-0.26) | -0.17 | long +0.00 / short-below -0.29 / Z2 +0.58 | +0.116 (125) / +0.068 (157) / +0.059 (155) | CI!0 |

### D5 seasonality, 30-min buckets (P; each bucket its own two-sided test)

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 1317 / 439 | +0.539 [+0.490, +0.588] | 0.0005 | +1.03 [+0.93, +1.14] | 1.75 | 16% | +1.00 | +9.69 ~ | -1.99 ~ | +5.29 ~ | +0.509 (126) / +0.451 (158) / +0.652 (155) | CI!0 |
| 09:30 | 30 | 1317 / 439 | +0.495 [+0.447, +0.542] | 0.0005 | +0.86 [+0.78, +0.96] | 1.66 | 15% | +0.86 | +6.42 ~ | -0.41 ~ | +3.67 ~ | +0.423 (126) / +0.422 (158) / +0.627 (155) | CI!0 |
| 09:30 | 60 | 1319 / 440 | +0.350 [+0.307, +0.395] | 0.0005 | +0.58 [+0.51, +0.65] | 1.46 | 19% | +0.54 | +8.94 ~ | +1.89 ~ | +1.82 ~ | +0.302 (126) / +0.267 (158) / +0.474 (156) | CI!0 |
| 09:30 | close | 1319 / 440 | -0.305 [-0.336, -0.274] | 0.0005 | -0.22 [-0.24, -0.19] | 0.73 | 84% | -0.22 | +12.90 ~ | +10.37 ~ | +0.24 ~ | -0.334 (126) / -0.320 (158) / -0.267 (156) | CI!0 |
| 10:00 | 15 | 2635 / 441 | +0.358 [+0.311, +0.410] | 0.0005 | +0.71 [+0.63, +0.79] | 1.48 | 24% | +0.71 | +1009.67 | -3.63 | +5.46 | +0.259 (127) / +0.300 (158) / +0.498 (156) | CI!0 |
| 10:00 | 30 | 2635 / 441 | +0.309 [+0.260, +0.357] | 0.0005 | +0.56 [+0.49, +0.63] | 1.41 | 23% | +0.59 | +4.71 | -1.13 | +3.17 | +0.241 (127) / +0.232 (158) / +0.440 (156) | CI!0 |
| 10:00 | 60 | 2635 / 441 | +0.167 [+0.121, +0.213] | 0.0005 | +0.32 [+0.27, +0.38] | 1.23 | 31% | +0.27 | +4.65 | -0.50 | +1.79 | +0.135 (127) / +0.075 (158) / +0.286 (156) | CI!0 |
| 10:00 | close | 2635 / 441 | -0.321 [-0.352, -0.288] | 0.0005 | -0.23 [-0.26, -0.20] | 0.72 | 85% | -0.18 | +0.14 | -0.26 | +0.29 | -0.351 (127) / -0.328 (158) / -0.289 (156) | CI!0 |
| 10:30 | 15 | 2645 / 441 | +0.064 [+0.013, +0.115] | 0.015 | +0.27 [+0.22, +0.34] | 1.11 | 41% | +0.21 | +6.62 ~ | -7.04 ~ | +3.28 ~ | +0.053 (127) / -0.056 (158) / +0.195 (156) | CI!0 |
| 10:30 | 30 | 2645 / 441 | +0.033 [-0.016, +0.081] | 0.200 | +0.18 [+0.13, +0.24] | 1.07 | 44% | +0.12 | +4.09 ~ | -1.57 ~ | +1.87 ~ | +0.012 (127) / -0.062 (158) / +0.145 (156) | - |
| 10:30 | 60 | 2645 / 441 | -0.061 [-0.107, -0.013] | 0.012 | +0.06 [+0.01, +0.10] | 0.99 | 51% | +0.01 | +0.36 ~ | -0.10 ~ | +0.59 ~ | -0.088 (127) / -0.125 (158) / +0.027 (156) | CI!0 |
| 10:30 | close | 2645 / 441 | -0.341 [-0.374, -0.307] | 0.0005 | -0.24 [-0.27, -0.21] | 0.71 | 86% | -0.21 | - ~ | - ~ | -0.01 ~ | -0.382 (127) / -0.332 (158) / -0.317 (156) | CI!0 |
| 11:00 | 15 | 2646 / 441 | -0.157 [-0.209, -0.103] | 0.0005 | +0.03 [-0.01, +0.08] | 0.90 | 58% | +0.05 | +4.09 ~ | -2.47 ~ | +3.08 ~ | -0.214 (127) / -0.180 (158) / -0.086 (156) | CI!0 |
| 11:00 | 30 | 2646 / 441 | -0.161 [-0.212, -0.108] | 0.0005 | -0.01 [-0.06, +0.03] | 0.89 | 60% | +0.02 | +4.61 ~ | -0.89 ~ | +1.78 ~ | -0.207 (127) / -0.190 (158) / -0.095 (156) | CI!0 |
| 11:00 | 60 | 2646 / 441 | -0.234 [-0.284, -0.185] | 0.0005 | -0.10 [-0.14, -0.06] | 0.83 | 67% | -0.11 | +0.28 ~ | -0.35 ~ | +0.49 ~ | -0.279 (127) / -0.263 (158) / -0.170 (156) | CI!0 |
| 11:00 | close | 2646 / 441 | -0.350 [-0.384, -0.315] | 0.0005 | -0.24 [-0.27, -0.21] | 0.69 | 84% | -0.18 | +1.36 ~ | +0.00 ~ | -0.22 ~ | -0.396 (127) / -0.333 (158) / -0.330 (156) | CI!0 |
| 11:30 | 15 | 2641 / 441 | -0.351 [-0.405, -0.294] | 0.0005 | -0.13 [-0.17, -0.08] | 0.74 | 70% | -0.15 | +1.91 ~ | -1.63 ~ | +6.53 ~ | -0.414 (127) / -0.388 (158) / -0.262 (156) | CI!0 |
| 11:30 | 30 | 2641 / 441 | -0.348 [-0.403, -0.293] | 0.0005 | -0.17 [-0.21, -0.12] | 0.73 | 73% | -0.24 | +0.09 ~ | -0.40 ~ | +1.42 ~ | -0.415 (127) / -0.370 (158) / -0.273 (156) | CI!0 |
| 11:30 | 60 | 2641 / 441 | -0.394 [-0.448, -0.342] | 0.0005 | -0.23 [-0.26, -0.19] | 0.70 | 79% | -0.32 | +0.23 ~ | -0.37 ~ | +0.83 ~ | -0.457 (127) / -0.406 (158) / -0.332 (156) | CI!0 |
| 11:30 | close | 2641 / 441 | -0.370 [-0.405, -0.334] | 0.0005 | -0.25 [-0.28, -0.22] | 0.68 | 85% | -0.21 | +0.40 ~ | -0.12 ~ | +0.13 ~ | -0.427 (127) / -0.347 (158) / -0.348 (156) | CI!0 |
| 12:00 | 15 | 2640 / 441 | -0.500 [-0.555, -0.446] | 0.0005 | -0.26 [-0.29, -0.22] | 0.63 | 79% | -0.29 | +5.97 | -3.50 | +1.82 | -0.557 (127) / -0.512 (158) / -0.443 (156) | CI!0 |
| 12:00 | 30 | 2640 / 441 | -0.498 [-0.553, -0.443] | 0.0005 | -0.29 [-0.32, -0.25] | 0.64 | 82% | -0.29 | +1.57 | -1.29 | +0.98 | -0.567 (127) / -0.506 (158) / -0.435 (156) | CI!0 |
| 12:00 | 60 | 2611 / 440 | -0.515 [-0.567, -0.458] | 0.0005 | -0.31 [-0.34, -0.28] | 0.63 | 85% | -0.31 | +0.57 | -0.66 | +0.32 | -0.582 (127) / -0.526 (157) / -0.450 (156) | CI!0 |
| 12:00 | close | 2640 / 441 | -0.393 [-0.430, -0.355] | 0.0005 | -0.26 [-0.30, -0.23] | 0.67 | 86% | -0.21 | -0.01 | -0.23 | +0.60 | -0.455 (127) / -0.373 (158) / -0.363 (156) | CI!0 >H |
| 12:30 | 15 | 2615 / 440 | -0.662 [-0.719, -0.600] | 0.0005 | -0.36 [-0.39, -0.32] | 0.55 | 84% | -0.36 | +0.59 ~ | -1.46 ~ | +0.41 ~ | -0.757 (127) / -0.671 (157) / -0.575 (156) | CI!0 |
| 12:30 | 30 | 2615 / 440 | -0.623 [-0.681, -0.564] | 0.0005 | -0.36 [-0.39, -0.33] | 0.57 | 86% | -0.35 | +0.00 ~ | -0.68 ~ | +0.60 ~ | -0.701 (127) / -0.648 (157) / -0.535 (156) | CI!0 |
| 12:30 | 60 | 2610 / 435 | -0.629 [-0.685, -0.572] | 0.0005 | -0.38 [-0.41, -0.34] | 0.57 | 88% | -0.34 | - ~ | - ~ | - ~ | -0.688 (124) / -0.661 (157) / -0.549 (154) | CI!0 |
| 12:30 | close | 2615 / 440 | -0.427 [-0.466, -0.387] | 0.0005 | -0.28 [-0.32, -0.24] | 0.65 | 87% | -0.20 | -0.23 ~ | -0.38 ~ | +0.20 ~ | -0.484 (127) / -0.418 (157) / -0.388 (156) | CI!0 |
| 13:00 | 15 | 2609 / 435 | -0.766 [-0.827, -0.704] | 0.0005 | -0.40 [-0.43, -0.37] | 0.49 | 87% | -0.40 | - ~ | - ~ | - ~ | -0.835 (124) / -0.804 (157) / -0.671 (154) | CI!0 |
| 13:00 | 30 | 2609 / 435 | -0.739 [-0.800, -0.677] | 0.0005 | -0.42 [-0.45, -0.39] | 0.51 | 89% | -0.42 | - ~ | - ~ | - ~ | -0.797 (124) / -0.780 (157) / -0.652 (154) | CI!0 |
| 13:00 | 60 | 2609 / 435 | -0.632 [-0.674, -0.588] | 0.0005 | -0.40 [-0.42, -0.37] | 0.55 | 90% | -0.43 | - ~ | - ~ | - ~ | -0.730 (124) / -0.628 (157) / -0.556 (154) | CI!0 |
| 13:00 | close | 2609 / 435 | -0.458 [-0.495, -0.421] | 0.0005 | -0.31 [-0.34, -0.27] | 0.64 | 90% | -0.25 | - ~ | - ~ | - ~ | -0.511 (124) / -0.451 (157) / -0.421 (154) | CI!0 >H |
| 13:30 | 15 | 2606 / 435 | -0.843 [-0.891, -0.794] | 0.0005 | -0.46 [-0.48, -0.43] | 0.45 | 91% | -0.47 | -0.03 ~ | -1.02 ~ | +0.30 ~ | -0.900 (124) / -0.859 (157) / -0.781 (154) | CI!0 |
| 13:30 | 30 | 2606 / 435 | -0.708 [-0.753, -0.663] | 0.0005 | -0.42 [-0.45, -0.39] | 0.50 | 90% | -0.47 | +0.05 ~ | -0.91 ~ | +0.26 ~ | -0.812 (124) / -0.693 (157) / -0.638 (154) | CI!0 |
| 13:30 | 60 | 2606 / 435 | -0.642 [-0.687, -0.597] | 0.0005 | -0.40 [-0.43, -0.37] | 0.52 | 91% | -0.41 | +0.43 ~ | -0.86 ~ | +0.22 ~ | -0.758 (124) / -0.622 (157) / -0.569 (154) | CI!0 |
| 13:30 | close | 2606 / 435 | -0.494 [-0.530, -0.458] | 0.0005 | -0.33 [-0.37, -0.29] | 0.61 | 92% | -0.24 | +3.19 ~ | -2.07 ~ | +0.00 ~ | -0.538 (124) / -0.494 (157) / -0.458 (154) | CI!0 >H |
| 14:00 | 15 | 2610 / 435 | -0.771 [-0.822, -0.722] | 0.0005 | -0.42 [-0.46, -0.39] | 0.46 | 90% | -0.43 | +4.34 | -1.91 | +1.74 | -0.922 (124) / -0.728 (157) / -0.694 (154) | CI!0 |
| 14:00 | 30 | 2610 / 435 | -0.731 [-0.778, -0.684] | 0.0005 | -0.43 [-0.46, -0.39] | 0.48 | 91% | -0.42 | +0.51 | -0.93 | +0.58 | -0.869 (124) / -0.704 (157) / -0.649 (154) | CI!0 |
| 14:00 | 60 | 2610 / 435 | -0.678 [-0.723, -0.634] | 0.0005 | -0.41 [-0.45, -0.36] | 0.50 | 91% | -0.34 | -0.09 | -0.57 | +0.42 | -0.802 (124) / -0.652 (157) / -0.605 (154) | CI!0 |
| 14:00 | close | 2610 / 435 | -0.540 [-0.575, -0.505] | 0.0005 | -0.36 [-0.40, -0.31] | 0.58 | 93% | -0.26 | -0.08 | -0.38 | +0.84 | -0.592 (124) / -0.540 (157) / -0.497 (154) | CI!0 |
| 14:30 | 15 | 2601 / 435 | -0.892 [-0.940, -0.843] | 0.0005 | -0.49 [-0.52, -0.45] | 0.41 | 92% | -0.47 | - ~ | - ~ | - ~ | -1.003 (124) / -0.856 (157) / -0.839 (154) | CI!0 |
| 14:30 | 30 | 2601 / 435 | -0.800 [-0.848, -0.754] | 0.0005 | -0.47 [-0.51, -0.43] | 0.45 | 94% | -0.44 | - ~ | - ~ | - ~ | -0.915 (124) / -0.759 (157) / -0.750 (154) | CI!0 |
| 14:30 | 60 | 2601 / 435 | -0.728 [-0.768, -0.687] | 0.0005 | -0.46 [-0.49, -0.42] | 0.49 | 96% | -0.46 | - ~ | - ~ | - ~ | -0.803 (124) / -0.717 (157) / -0.678 (154) | CI!0 |
| 14:30 | close | 2601 / 435 | -0.616 [-0.652, -0.580] | 0.0005 | -0.41 [-0.44, -0.38] | 0.54 | 95% | -0.34 | - ~ | - ~ | - ~ | -0.650 (124) / -0.613 (157) / -0.592 (154) | CI!0 >H >H(CI) |
| 15:00 | 15 | 2566 / 432 | -0.953 [-0.998, -0.908] | 0.0005 | -0.54 [-0.57, -0.52] | 0.39 | 96% | -0.58 | - ~ | - ~ | +0.22 ~ | -1.059 (124) / -0.946 (157) / -0.871 (151) | CI!0 |
| 15:00 | 30 | 2566 / 432 | -0.887 [-0.928, -0.849] | 0.0005 | -0.54 [-0.56, -0.52] | 0.42 | 97% | -0.58 | -0.26 ~ | -0.70 ~ | +0.13 ~ | -0.960 (124) / -0.892 (157) / -0.820 (151) | CI!0 |
| 15:00 | 60 | 432 / 432 | -0.663 [-0.701, -0.628] | 0.0005 | -0.44 [-0.47, -0.42] | 0.53 | 97% | -0.43 | - ~ | - ~ | - ~ | -0.701 (124) / -0.660 (157) / -0.635 (151) | CI!0 |
| 15:00 | close | 2566 / 432 | -0.729 [-0.767, -0.694] | 0.0005 | -0.48 [-0.50, -0.46] | 0.49 | 97% | -0.43 | -0.29 ~ | -0.51 ~ | +0.33 ~ | -0.758 (124) / -0.736 (157) / -0.698 (151) | CI!0 >H >H(CI) |
| 15:30 | 15 | 419 / 419 | -1.127 [-1.178, -1.079] | 0.0005 | -0.63 [-0.65, -0.61] | 0.33 | 99% | -0.65 | - ~ | - ~ | - ~ | -1.183 (124) / -1.122 (157) / -1.082 (138) | CI!0 |
| 15:30 | 30 | 419 / 419 | -0.829 [-0.872, -0.788] | 0.0005 | -0.52 [-0.54, -0.50] | 0.44 | 98% | -0.45 | - ~ | - ~ | - ~ | -0.860 (124) / -0.833 (157) / -0.798 (138) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 419 / 419 | -0.829 [-0.872, -0.788] | 0.0005 | -0.52 [-0.54, -0.50] | 0.44 | 98% | -0.45 | - ~ | - ~ | - ~ | -0.860 (124) / -0.833 (157) / -0.798 (138) | CI!0 >H >H(CI) |

### D6 unconditional variance premium, h = close

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:45 | close | 440 / 440 | -0.294 [-0.325, -0.262] | 0.0005 | -0.21 [-0.24, -0.18] | 0.74 | 83% | -0.22 | +12.90 ~ | +10.37 ~ | +0.24 ~ | -0.318 (126) / -0.319 (158) / -0.251 (156) | CI!0 |
| 10:00 | close | 440 / 440 | -0.309 [-0.339, -0.276] | 0.0005 | -0.22 [-0.25, -0.19] | 0.73 | 84% | -0.19 | +0.14 | -0.26 | +0.29 | -0.346 (126) / -0.313 (158) / -0.275 (156) | CI!0 |
| 10:30 | close | 441 / 441 | -0.337 [-0.369, -0.303] | 0.0005 | -0.24 [-0.27, -0.21] | 0.71 | 86% | -0.21 | - ~ | - ~ | -0.01 ~ | -0.367 (127) / -0.338 (158) / -0.310 (156) | CI!0 |
| 12:00 | close | 440 / 440 | -0.375 [-0.410, -0.339] | 0.0005 | -0.26 [-0.29, -0.22] | 0.67 | 85% | -0.22 | -0.01 | -0.23 | +0.60 | -0.441 (127) / -0.350 (157) / -0.347 (156) | CI!0 >H |

### Grid sensitivity (G; reported, never used to choose)

| row | arm | h | P | n obs / sess | effect [95% CI] | p (boot) | perm p | IC [95% CI] | E[V]-1 in cond [95% CI] (matched uncond) | E[Z^2]-1 | hurdle (bucket all) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| D1 | expansion | 15 | 1.5 | 7316 / 335 | +0.290 [+0.249, +0.332] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | -0.03 [-0.07, +0.02] (-0.24) | -0.02 | long +11.74 / short-below -4.57 / Z2 +3.69 | +0.324 (87) / +0.309 (121) / +0.248 (127) | CI!0 |
| D1 | expansion | 30 | 1.5 | 7316 / 335 | +0.268 [+0.230, +0.308] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.07 [-0.11, -0.02] (-0.26) | -0.03 | long +2.86 / short-below -1.74 / Z2 +1.85 | +0.307 (87) / +0.285 (121) / +0.224 (127) | CI!0 |
| D1 | expansion | 60 | 1.5 | 6544 / 333 | +0.245 [+0.207, +0.283] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.09 [-0.13, -0.04] (-0.26) | -0.05 | long +1.20 / short-below -0.65 / Z2 +0.83 | +0.286 (87) / +0.263 (121) / +0.199 (125) | CI!0 |
| D1 | expansion | close | 1.5 | 7316 / 335 | +0.151 [+0.118, +0.182] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.22 [-0.26, -0.17] (-0.32) | -0.10 | long +0.00 / short-below -0.29 / Z2 +0.58 | +0.217 (87) / +0.140 (121) / +0.107 (127) | CI!0 |
| D1 | expansion | 15 | 3.0 | 2563 / 146 | +0.437 [+0.367, +0.505] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | +0.00 [-0.08, +0.10] (-0.32) | +0.09 | long +11.74 / short-below -4.57 / Z2 +3.69 | +0.462 (48) / +0.499 (56) / +0.385 (42) | CI!0 |
| D1 | expansion | 30 | 3.0 | 2563 / 146 | +0.404 [+0.338, +0.468] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.03 [-0.11, +0.06] (-0.33) | +0.06 | long +2.86 / short-below -1.74 / Z2 +1.85 | +0.428 (48) / +0.468 (56) / +0.342 (42) | CI!0 |
| D1 | expansion | 60 | 3.0 | 2212 / 144 | +0.374 [+0.310, +0.439] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.04 [-0.12, +0.05] (-0.32) | +0.08 | long +1.20 / short-below -0.65 / Z2 +0.83 | +0.420 (48) / +0.424 (55) / +0.297 (41) | CI!0 |
| D1 | expansion | close | 3.0 | 2563 / 146 | +0.257 [+0.204, +0.311] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.16 [-0.21, -0.10] (-0.34) | +0.05 | long +0.00 / short-below -0.29 / Z2 +0.58 | +0.327 (48) / +0.270 (56) / +0.158 (42) | CI!0 |
| D2 | compression | 15 | 0.4 | 2457 / 218 | -0.416 [-0.518, -0.321] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | -0.48 [-0.53, -0.43] (-0.27) | -0.47 | long +11.74 / short-below -4.57 / Z2 +3.69 | -0.298 (72) / -0.500 (73) / -0.402 (73) | CI!0 |
| D2 | compression | 30 | 0.4 | 2457 / 218 | -0.391 [-0.495, -0.297] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.48 [-0.53, -0.44] (-0.29) | -0.48 | long +2.86 / short-below -1.74 / Z2 +1.85 | -0.270 (72) / -0.479 (73) / -0.387 (73) | CI!0 |
| D2 | compression | 60 | 0.4 | 2177 / 212 | -0.358 [-0.454, -0.264] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.46 [-0.51, -0.41] (-0.28) | -0.42 | long +1.20 / short-below -0.65 / Z2 +0.83 | -0.241 (72) / -0.454 (70) / -0.346 (70) | CI!0 |
| D2 | compression | close | 0.4 | 2457 / 218 | -0.157 [-0.220, -0.099] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.43 [-0.47, -0.39] (-0.33) | -0.35 | long +0.00 / short-below -0.29 / Z2 +0.58 | -0.165 (72) / -0.134 (73) / -0.135 (73) | CI!0 >H >H(CI) |
| D2 | compression | 15 | 0.67 | 8612 / 366 | -0.257 [-0.303, -0.212] | 0.0005 | 0.0010 | +0.332 [+0.296, +0.367] | -0.40 [-0.42, -0.37] (-0.24) | -0.40 | long +11.74 / short-below -4.57 / Z2 +3.69 | -0.232 (105) / -0.286 (131) / -0.228 (130) | CI!0 |
| D2 | compression | 30 | 0.67 | 8612 / 366 | -0.237 [-0.281, -0.193] | 0.0005 | 0.0010 | +0.358 [+0.316, +0.397] | -0.40 [-0.43, -0.38] (-0.26) | -0.40 | long +2.86 / short-below -1.74 / Z2 +1.85 | -0.216 (105) / -0.267 (131) / -0.204 (130) | CI!0 |
| D2 | compression | 60 | 0.67 | 7766 / 362 | -0.216 [-0.260, -0.174] | 0.0005 | 0.0010 | +0.357 [+0.310, +0.401] | -0.39 [-0.42, -0.36] (-0.27) | -0.39 | long +1.20 / short-below -0.65 / Z2 +0.83 | -0.202 (105) / -0.242 (129) / -0.184 (128) | CI!0 |
| D2 | compression | close | 0.67 | 8612 / 366 | -0.106 [-0.139, -0.073] | 0.0005 | 0.0010 | +0.270 [+0.210, +0.327] | -0.39 [-0.42, -0.36] (-0.32) | -0.33 | long +0.00 / short-below -0.29 / Z2 +0.58 | -0.141 (105) / -0.095 (131) / -0.071 (130) | CI!0 >H >H(CI) |
| D3 | bottom | 15 | quintile | 5211 / 416 | -0.020 [-0.053, +0.009] | 0.188 | 0.178 | +0.000 [-0.020, +0.019] | -0.21 [-0.25, -0.18] (-0.30) | -0.22 | |E[za]|* +0.41 | -0.040 (118) / -0.017 (150) / -0.012 (148) | - |
| D3 | bottom | 30 | quintile | 5211 / 416 | -0.026 [-0.066, +0.014] | 0.169 | 0.172 | +0.004 [-0.022, +0.030] | -0.24 [-0.27, -0.20] (-0.31) | -0.25 | |E[za]|* +0.28 | -0.048 (118) / -0.020 (150) / -0.019 (148) | - |
| D3 | bottom | 60 | quintile | 4735 / 408 | -0.047 [-0.094, +0.002] | 0.063 | 0.057 | +0.012 [-0.023, +0.045] | -0.24 [-0.28, -0.20] (-0.31) | -0.23 | |E[za]|* +0.23 | -0.001 (116) / -0.073 (148) / -0.051 (144) | - |
| D3 | bottom | close | quintile | 5211 / 416 | -0.024 [-0.077, +0.030] | 0.376 | 0.374 | +0.002 [-0.036, +0.035] | -0.29 [-0.32, -0.25] (-0.32) | -0.22 | |E[za]|* +0.22 | -0.023 (118) / -0.077 (150) / +0.034 (148) | - |
| D3 | top | 15 | quintile | 5245 / 426 | +0.000 [-0.030, +0.029] | 0.979 | 0.998 | +0.000 [-0.020, +0.019] | -0.31 [-0.34, -0.27] (-0.31) | -0.32 | |E[za]|* +0.41 | +0.010 (125) / +0.012 (151) / -0.026 (150) | - |
| D3 | top | 30 | quintile | 5245 / 426 | -0.010 [-0.047, +0.025] | 0.620 | 0.608 | +0.004 [-0.022, +0.030] | -0.33 [-0.36, -0.29] (-0.32) | -0.33 | |E[za]|* +0.28 | -0.014 (125) / +0.012 (151) / -0.032 (150) | - |
| D3 | top | 60 | quintile | 4630 / 420 | -0.008 [-0.056, +0.041] | 0.757 | 0.714 | +0.012 [-0.023, +0.045] | -0.32 [-0.35, -0.28] (-0.31) | -0.34 | |E[za]|* +0.23 | -0.024 (124) / +0.027 (149) / -0.032 (147) | - |
| D3 | top | close | quintile | 5245 / 426 | -0.015 [-0.066, +0.032] | 0.557 | 0.607 | +0.002 [-0.036, +0.035] | -0.34 [-0.37, -0.31] (-0.33) | -0.33 | |E[za]|* +0.22 | +0.001 (125) / -0.063 (151) / +0.021 (150) | - |
| D3 | top-bottom | 15 | quintile | 10456 / 441 | -0.010 [-0.034, +0.014] | 0.400 | 0.426 | +0.000 [-0.020, +0.019] | -0.26 [-0.29, -0.23] (-0.30) | -0.27 | |E[za]|* +0.41 | -0.013 (127) / -0.003 (158) / -0.019 (156) | - |
| D3 | top-bottom | 30 | quintile | 10456 / 441 | -0.018 [-0.049, +0.013] | 0.269 | 0.260 | +0.004 [-0.022, +0.030] | -0.28 [-0.31, -0.25] (-0.31) | -0.29 | |E[za]|* +0.28 | -0.029 (127) / -0.004 (158) / -0.025 (156) | - |
| D3 | top-bottom | 60 | quintile | 9365 / 441 | -0.028 [-0.067, +0.013] | 0.201 | 0.180 | +0.012 [-0.023, +0.045] | -0.28 [-0.31, -0.25] (-0.31) | -0.28 | |E[za]|* +0.23 | -0.013 (127) / -0.026 (158) / -0.042 (156) | - |
| D3 | top-bottom | close | quintile | 10456 / 441 | -0.019 [-0.064, +0.025] | 0.399 | 0.423 | +0.002 [-0.036, +0.035] | -0.32 [-0.34, -0.28] (-0.32) | -0.27 | |E[za]|* +0.22 | -0.010 (127) / -0.070 (158) / +0.028 (156) | - |
| D4 | high | 15 | quintile | 5232 / 354 | -0.497 [-0.576, -0.413] | 0.0005 | 0.0010 | -0.364 [-0.394, -0.332] | -0.65 [-0.67, -0.63] (-0.45) | -0.66 | long +11.74 / short-below -4.57 / Z2 +3.69 | -0.332 (110) / -0.566 (124) / -0.576 (120) | CI!0 |
| D4 | high | 30 | quintile | 5232 / 354 | -0.450 [-0.523, -0.371] | 0.0005 | 0.0010 | -0.386 [-0.416, -0.351] | -0.62 [-0.64, -0.60] (-0.44) | -0.63 | long +2.86 / short-below -1.74 / Z2 +1.85 | -0.305 (110) / -0.511 (124) / -0.511 (120) | CI!0 |
| D4 | high | 60 | quintile | 3809 / 290 | -0.461 [-0.541, -0.376] | 0.0005 | 0.0010 | -0.384 [-0.419, -0.345] | -0.59 [-0.61, -0.56] (-0.40) | -0.56 | long +1.20 / short-below -0.65 / Z2 +0.83 | -0.330 (98) / -0.506 (100) / -0.524 (92) | CI!0 |
| D4 | high | close | quintile | 5232 / 354 | -0.163 [-0.201, -0.126] | 0.0005 | 0.0010 | -0.205 [-0.246, -0.162] | -0.48 [-0.51, -0.45] (-0.39) | -0.37 | long +0.00 / short-below -0.29 / Z2 +0.58 | -0.192 (110) / -0.143 (124) / -0.122 (120) | CI!0 >H >H(CI) |
| D4 | low | 15 | quintile | 5232 / 411 | +0.251 [+0.204, +0.296] | 0.0005 | 0.0010 | -0.364 [-0.394, -0.332] | +0.20 [+0.16, +0.23] (+0.01) | +0.17 | long +11.74 / short-below -4.57 / Z2 +3.69 | +0.246 (115) / +0.287 (148) / +0.203 (148) | CI!0 |
| D4 | low | 30 | quintile | 5232 / 411 | +0.237 [+0.193, +0.280] | 0.0005 | 0.0010 | -0.386 [-0.416, -0.351] | +0.13 [+0.09, +0.16] (-0.04) | +0.08 | long +2.86 / short-below -1.74 / Z2 +1.85 | +0.238 (115) / +0.272 (148) / +0.189 (148) | CI!0 |
| D4 | low | 60 | quintile | 5175 / 411 | +0.214 [+0.174, +0.255] | 0.0005 | 0.0010 | -0.384 [-0.419, -0.345] | +0.03 [-0.01, +0.06] (-0.11) | -0.05 | long +1.20 / short-below -0.65 / Z2 +0.83 | +0.214 (115) / +0.243 (148) / +0.176 (148) | CI!0 |
| D4 | low | close | quintile | 5232 / 411 | +0.081 [+0.058, +0.104] | 0.0005 | 0.0010 | -0.205 [-0.246, -0.162] | -0.20 [-0.23, -0.15] (-0.25) | -0.16 | long +0.00 / short-below -0.29 / Z2 +0.58 | +0.130 (115) / +0.067 (148) / +0.057 (148) | CI!0 |

D5 60-min buckets (G):

| bucket / time | h | n obs / sess | mean ln V [95% CI] | p (boot) | E[V]-1 [95% CI] | median V | P(V<1) | E[Z^2]-1 | hurdle E[V]-1 long | short below | Z2 long (suppl.) | per period 2020-21 / 2022 / 2023 (sess) | flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 09:30 | 15 | 3952 / 441 | +0.418 [+0.374, +0.464] | 0.0005 | +0.81 [+0.74, +0.90] | 1.57 | 21% | +0.81 | +676.43 | -3.08 | +5.40 | +0.342 (127) / +0.350 (158) / +0.549 (156) | CI!0 |
| 09:30 | 30 | 3952 / 441 | +0.371 [+0.326, +0.417] | 0.0005 | +0.66 [+0.59, +0.73] | 1.50 | 20% | +0.68 | +5.28 | -0.89 | +3.34 | +0.302 (127) / +0.296 (158) / +0.502 (156) | CI!0 |
| 09:30 | 60 | 3954 / 441 | +0.228 [+0.184, +0.273] | 0.0005 | +0.41 [+0.35, +0.47] | 1.30 | 27% | +0.36 | +6.08 | +0.30 | +1.80 | +0.190 (127) / +0.139 (158) / +0.349 (156) | CI!0 |
| 09:30 | close | 3954 / 441 | -0.316 [-0.346, -0.283] | 0.0005 | -0.22 [-0.25, -0.19] | 0.72 | 85% | -0.19 | +4.40 | +3.29 | +0.28 | -0.345 (127) / -0.325 (158) / -0.282 (156) | CI!0 |
| 10:30 | 15 | 5291 / 441 | -0.046 [-0.093, +0.002] | 0.062 | +0.15 [+0.11, +0.20] | 1.01 | 49% | +0.13 | +5.35 | -4.76 | +3.18 | -0.080 (127) / -0.118 (158) / +0.055 (156) | - |
| 10:30 | 30 | 5291 / 441 | -0.064 [-0.111, -0.017] | 0.005 | +0.09 [+0.04, +0.13] | 0.98 | 52% | +0.07 | +4.35 | -1.23 | +1.82 | -0.098 (127) / -0.126 (158) / +0.025 (156) | CI!0 |
| 10:30 | 60 | 5291 / 441 | -0.148 [-0.193, -0.100] | 0.0005 | -0.02 [-0.06, +0.02] | 0.90 | 59% | -0.05 | +0.32 | -0.22 | +0.54 | -0.183 (127) / -0.194 (158) / -0.071 (156) | CI!0 |
| 10:30 | close | 5291 / 441 | -0.346 [-0.379, -0.311] | 0.0005 | -0.24 [-0.27, -0.21] | 0.70 | 85% | -0.20 | - | - | -0.12 | -0.389 (127) / -0.332 (158) / -0.324 (156) | CI!0 |
| 11:30 | 15 | 5281 / 441 | -0.425 [-0.478, -0.373] | 0.0005 | -0.19 [-0.23, -0.16] | 0.68 | 75% | -0.22 | +3.94 | -2.56 | +4.18 | -0.485 (127) / -0.450 (158) / -0.352 (156) | CI!0 |
| 11:30 | 30 | 5281 / 441 | -0.423 [-0.476, -0.371] | 0.0005 | -0.23 [-0.26, -0.19] | 0.68 | 77% | -0.27 | +0.83 | -0.84 | +1.20 | -0.491 (127) / -0.438 (158) / -0.354 (156) | CI!0 |
| 11:30 | 60 | 5252 / 441 | -0.454 [-0.505, -0.403] | 0.0005 | -0.27 [-0.30, -0.24] | 0.67 | 82% | -0.31 | +0.40 | -0.52 | +0.58 | -0.519 (127) / -0.466 (158) / -0.391 (156) | CI!0 |
| 11:30 | close | 5281 / 441 | -0.381 [-0.417, -0.345] | 0.0005 | -0.26 [-0.29, -0.22] | 0.67 | 86% | -0.21 | +0.19 | -0.18 | +0.36 | -0.441 (127) / -0.360 (158) / -0.355 (156) | CI!0 |
| 12:30 | 15 | 5224 / 440 | -0.714 [-0.771, -0.654] | 0.0005 | -0.38 [-0.41, -0.35] | 0.53 | 86% | -0.38 | - | - | - | -0.796 (127) / -0.738 (157) / -0.623 (156) | CI!0 |
| 12:30 | 30 | 5224 / 440 | -0.681 [-0.738, -0.623] | 0.0005 | -0.39 [-0.42, -0.36] | 0.54 | 88% | -0.39 | - | - | - | -0.749 (127) / -0.714 (157) / -0.593 (156) | CI!0 |
| 12:30 | 60 | 5219 / 435 | -0.630 [-0.676, -0.582] | 0.0005 | -0.39 [-0.41, -0.36] | 0.56 | 89% | -0.39 | - | - | - | -0.709 (124) / -0.645 (157) / -0.552 (154) | CI!0 |
| 12:30 | close | 5224 / 440 | -0.442 [-0.481, -0.404] | 0.0005 | -0.29 [-0.33, -0.25] | 0.65 | 88% | -0.22 | - | - | - | -0.498 (127) / -0.435 (157) / -0.405 (156) | CI!0 |
| 13:30 | 15 | 5216 / 435 | -0.807 [-0.849, -0.767] | 0.0005 | -0.44 [-0.47, -0.41] | 0.45 | 90% | -0.45 | +2.15 | -1.47 | +1.02 | -0.911 (124) / -0.793 (157) / -0.737 (154) | CI!0 |
| 13:30 | 30 | 5216 / 435 | -0.720 [-0.762, -0.678] | 0.0005 | -0.43 [-0.45, -0.40] | 0.49 | 91% | -0.44 | +0.28 | -0.92 | +0.42 | -0.841 (124) / -0.698 (157) / -0.643 (154) | CI!0 |
| 13:30 | 60 | 5216 / 435 | -0.660 [-0.702, -0.618] | 0.0005 | -0.41 [-0.44, -0.37] | 0.51 | 91% | -0.38 | +0.17 | -0.72 | +0.32 | -0.780 (124) / -0.637 (157) / -0.587 (154) | CI!0 |
| 13:30 | close | 5216 / 435 | -0.517 [-0.553, -0.482] | 0.0005 | -0.35 [-0.38, -0.30] | 0.60 | 93% | -0.25 | +1.56 | -1.23 | +0.42 | -0.565 (124) / -0.517 (157) / -0.477 (154) | CI!0 >H >H(CI) |
| 14:30 | 15 | 5167 / 435 | -0.922 [-0.967, -0.879] | 0.0005 | -0.52 [-0.54, -0.49] | 0.40 | 94% | -0.53 | - | - | - | -1.031 (124) / -0.901 (157) / -0.854 (154) | CI!0 |
| 14:30 | 30 | 5167 / 435 | -0.843 [-0.884, -0.804] | 0.0005 | -0.51 [-0.53, -0.47] | 0.44 | 96% | -0.51 | - | - | - | -0.937 (124) / -0.826 (157) / -0.784 (154) | CI!0 |
| 14:30 | 60 | 3033 / 435 | -0.719 [-0.758, -0.680] | 0.0005 | -0.46 [-0.49, -0.42] | 0.49 | 96% | -0.45 | - | - | - | -0.788 (124) / -0.709 (157) / -0.672 (154) | CI!0 |
| 14:30 | close | 5167 / 435 | -0.672 [-0.707, -0.637] | 0.0005 | -0.44 [-0.47, -0.42] | 0.52 | 96% | -0.38 | - | - | - | -0.704 (124) / -0.675 (157) / -0.644 (154) | CI!0 >H >H(CI) |
| 15:30 | 15 | 419 / 419 | -1.127 [-1.178, -1.079] | 0.0005 | -0.63 [-0.65, -0.61] | 0.33 | 99% | -0.65 | - | - | - | -1.183 (124) / -1.122 (157) / -1.082 (138) | CI!0 |
| 15:30 | 30 | 419 / 419 | -0.829 [-0.872, -0.788] | 0.0005 | -0.52 [-0.54, -0.50] | 0.44 | 98% | -0.45 | - | - | - | -0.860 (124) / -0.833 (157) / -0.798 (138) | CI!0 |
| 15:30 | 60 | 0 | N/A (no finite ln V for this time/horizon (horizon passes the close)) | | | | | | | | | | |
| 15:30 | close | 419 / 419 | -0.829 [-0.872, -0.788] | 0.0005 | -0.52 [-0.54, -0.50] | 0.44 | 98% | -0.45 | - | - | - | -0.860 (124) / -0.833 (157) / -0.798 (138) | CI!0 >H >H(CI) |

## Null calibration

* Pipeline false-positive rate: the day-clustered bootstrap test run on 2000 day-permuted nulls (20 SPXW primary conditional cells x 100 permutations, 500 resamples each): share with p < 0.05 = 4.6%, p < 0.10 = 9.8% (a calibrated test gives about 5% and 10%).
* Permutation p vs bootstrap p (D1-D4, all roots and parameters, 256 cells): bootstrap p < 0.05 in 223, permutation p < 0.05 in 219, both in 219.
* D5 and D6 test a level (ln V vs 0), not an association, so a permutation null does not apply; a synthetic "V = 1 world" would need a price model and was not built.

## N/A rows and why

* SPXW D5 15:30 h=60 P 30-min: no finite ln V for this time/horizon (horizon passes the close)
* SPXW D5 15:30 h=60 G 60-min: no finite ln V for this time/horizon (horizon passes the close)
* SPY D5 15:30 h=60 P 30-min: no finite ln V for this time/horizon (horizon passes the close)
* SPY D5 15:30 h=60 G 60-min: no finite ln V for this time/horizon (horizon passes the close)
* QQQ D5 15:30 h=60 P 30-min: no finite ln V for this time/horizon (horizon passes the close)
* QQQ D5 15:30 h=60 G 60-min: no finite ln V for this time/horizon (horizon passes the close)
* IWM D5 15:30 h=60 P 30-min: no finite ln V for this time/horizon (horizon passes the close)
* IWM D5 15:30 h=60 G 60-min: no finite ln V for this time/horizon (horizon passes the close)
* Hurdle cells marked "-" in HURDLE.md (fewer than 30 round trips, or a non-positive fitted slope) leave the hurdle column empty for that bucket (mostly SPY/QQQ/IWM off-grid buckets, sampled with 30 times only).
* Flags use hurdle_source: the row's own hurdle cell when it rests on >= 100 decision times, else the root's pooled ("all") hurdle at the same h (the thin bucket value is still shown, marked "~").
* "~" after a hurdle: the HURDLE.md cell rests on fewer than 100 decision times (SPY/QQQ/IWM buckets other than 10:00/12:00/14:00 have 30), so that hurdle is noisy; compare with the root's pooled hurdle.
* X7 and X9 (conditional tests on D4 / D1 by GEX sign) are registered as X rows, not D rows, and are not computed here.

## Mechanism notes

* D1/D2: volatility clusters; if the 0DTE board under-reacts to a burst (or to calm), realized over the next h beats (lags) the implied rate. The ratio uses the underlying's own same-clock history, so the U-shape of intraday volatility is removed from the feature.
* D3: Bollerslev-Li-Zhao (2020): positive semivariance dominance predicts lower returns (sign-aligned so a positive effect = as predicted).
* D4: IV^2 / RV_60 is the reciprocal of the trailing V; low = implied cheap relative to what was just realized. Because IV_atm of a 0DTE option is a forward-looking rate and RV_60 is backward-looking, the feature mixes the variance premium with plain mean reversion of intraday volatility.
* D5/D6: E[ln V] < ln E[V] (Jensen; V is right-skewed), so mean ln V < 0 does not by itself mean a short straddle earns money: the economic columns (E[V]-1, P(V<1), E[Z^2]-1) and the short hurdle decide that.

