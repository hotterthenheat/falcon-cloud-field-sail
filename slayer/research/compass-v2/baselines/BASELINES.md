# Baselines: what "no edge" looks like after real costs

Pre-registered in the ledger (FOUNDATION, compass-v2/baselines/strategies.py @ 6e280f9). 7 DEV sessions (20240417..20210512), roots SPXW/SPY/QQQ, 0DTE only (a root with no same-day expiry that session is skipped). Execution: decision -> +2 s latency -> ask in force (capped at displayed size); exits at the bid in force 2 s after the trigger; fee $0.65/contract/side. Trial count for the deflated Sharpe: 199 (ledger).

| baseline | costs | n | expectancy | 95% CI (session bootstrap) | win | payoff | $/trade | Sharpe/trade | Sharpe/day | maxDD $ | DSR | bar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1_random_side_30d | net of $0.65/contract/side | 14 | -12.0% | [-51.6, +22.9] | 43% | 0.86 | -69 | -0.21 | -0.23 | -1313 | 0.00 | fail |
| B1_random_side_30d | no fee (spread only) | 14 | -10.9% | [-50.7, +24.4] | 43% | 0.90 | -68 | -0.19 | -0.21 | -1313 | 0.00 | fail |
| B2_open_straddle | net of $0.65/contract/side | 15 | +10.7% | [-36.3, +44.9] | 60% | 0.99 | -119 | 0.18 | 0.16 | -6220 | 0.02 | fail |
| B2_open_straddle | no fee (spread only) | 15 | +11.2% | [-35.9, +45.5] | 60% | 1.01 | -117 | 0.19 | 0.17 | -6220 | 0.03 | fail |
| B3_first15_side | net of $0.65/contract/side | 14 | -17.3% | [-47.5, +10.5] | 36% | 1.02 | -37 | -0.27 | -0.41 | -1216 | 0.00 | fail |
| B3_first15_side | no fee (spread only) | 14 | -16.3% | [-46.6, +11.6] | 36% | 1.06 | -36 | -0.25 | -0.39 | -1216 | 0.00 | fail |

**Splits (net returns)**

| baseline | split | n | expectancy | win |
|---|---|---|---|---|
| B1_random_side_30d | year 2020 | 6 | -22.5% | 33% |
| B1_random_side_30d | year 2021 | 5 | -32.3% | 20% |
| B1_random_side_30d | year 2024 | 3 | +42.6% | 100% |
| B1_random_side_30d | day flat | 6 | -12.2% | 50% |
| B1_random_side_30d | day high_vol | 3 | +21.9% | 67% |
| B1_random_side_30d | day trend | 5 | -32.3% | 20% |
| B1_random_side_30d | root QQQ | 3 | +58.9% | 100% |
| B1_random_side_30d | root SPXW | 4 | -31.4% | 25% |
| B1_random_side_30d | root SPY | 7 | -31.3% | 29% |
| B2_open_straddle | year 2020 | 7 | -11.5% | 43% |
| B2_open_straddle | year 2021 | 5 | +18.4% | 60% |
| B2_open_straddle | year 2024 | 3 | +49.5% | 100% |
| B2_open_straddle | day flat | 7 | -16.4% | 43% |
| B2_open_straddle | day high_vol | 3 | +60.9% | 100% |
| B2_open_straddle | day trend | 5 | +18.4% | 60% |
| B2_open_straddle | root QQQ | 3 | +47.7% | 100% |
| B2_open_straddle | root SPXW | 6 | -4.0% | 50% |
| B2_open_straddle | root SPY | 6 | +6.8% | 50% |
| B3_first15_side | year 2020 | 6 | -14.0% | 33% |
| B3_first15_side | year 2021 | 5 | -43.5% | 20% |
| B3_first15_side | year 2024 | 3 | +19.7% | 67% |
| B3_first15_side | day flat | 7 | +17.0% | 57% |
| B3_first15_side | day high_vol | 2 | -72.1% | 0% |
| B3_first15_side | day trend | 5 | -43.5% | 20% |
| B3_first15_side | root QQQ | 3 | -33.4% | 33% |
| B3_first15_side | root SPXW | 5 | +1.4% | 40% |
| B3_first15_side | root SPY | 6 | -24.9% | 33% |

**Exit reasons**

| baseline | clock | vol_sl | vol_tp |
|---|---|---|---|
| B1_random_side_30d | 0 | 8 | 6 |
| B2_open_straddle | 5 | 2 | 8 |
| B3_first15_side | 0 | 9 | 5 |

**Cost at entry** (median): B1_random_side_30d: spread 4.1% of mid, fee 1.4% of premium, B2_open_straddle: spread 3.2% of mid, fee 0.6% of premium, B3_first15_side: spread 3.4% of mid, fee 1.4% of premium

**Session labels** (eval.metrics.classify_session, fixed rules): 20240417 flat, 20200224 flat, 20200316 high_vol, 20200612 high_vol, 20201104 flat, 20210127 trend, 20210512 trend

## Null calibration (protocol rule 11)

Each null run is scored exactly like a candidate (same summarize/passes_bar, N=199). "stat bar" = the protocol bar without the >=150-trade and 2-regime tests (which no 20-session run can meet); "CI only" = the session-bootstrap 95% CI of the expectancy excludes 0 (one-sided ~2.5% expected under the null). The pipeline is valid if <= 5% of null runs pass.

| null | runs | pass full bar | pass stat bar | CI>0 only | null expectancy mean [p5, p95] | real baseline beats | valid |
|---|---|---|---|---|---|---|---|
| shuffled side, B3 times kept | 4 | 0.0% | 0.0% | 0.0% | +0.9% [-7.6, +16.0] | 0% of nulls | yes |
| shuffled side, B3 times resampled | 4 | 0.0% | 0.0% | 0.0% | +2.4% [-3.1, +13.7] | 0% of nulls | yes |
| synthetic zero-drift (fair IV), B1_random_side_30d | 1 | 0.0% | 0.0% | 0.0% | -13.2% [-13.2, -13.2] | 100% of nulls | yes |
| synthetic zero-drift (fair IV), B2_open_straddle | 1 | 0.0% | 0.0% | 0.0% | -5.0% [-5.0, -5.0] | 100% of nulls | yes |
| synthetic zero-drift (fair IV), B3_first15_side | 1 | 0.0% | 0.0% | 0.0% | +9.1% [+9.1, +9.1] | 0% of nulls | yes |
| synthetic zero-drift (fair IV), all three | 3 | 0.0% | 0.0% | 0.0% | -3.0% [-12.3, +7.7] |  | yes |

Run time 281s.
