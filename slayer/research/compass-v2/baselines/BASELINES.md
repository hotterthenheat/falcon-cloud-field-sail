# Baselines: what "no edge" looks like after real costs

Pre-registered in the ledger (FOUNDATION, compass-v2/baselines/strategies.py @ 6e280f9). 3 DEV sessions (20240417..20200316), roots SPXW/SPY/QQQ, 0DTE only (a root with no same-day expiry that session is skipped). Execution: decision -> +2 s latency -> ask in force (capped at displayed size); exits at the bid in force 2 s after the trigger; fee $0.65/contract/side. Trial count for the deflated Sharpe: 194 (ledger).

| baseline | costs | n | expectancy | 95% CI (session bootstrap) | win | payoff | $/trade | Sharpe/trade | Sharpe/day | maxDD $ | DSR | bar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1_random_side_30d | net of $0.65/contract/side | 6 | -9.2% | [-69.6, +42.6] | 50% | 0.70 | -34 | -0.16 | -0.14 | -552 | 0.00 | fail |
| B1_random_side_30d | no fee (spread only) | 6 | -8.1% | [-68.8, +44.0] | 50% | 0.73 | -33 | -0.14 | -0.12 | -552 | 0.00 | fail |
| B2_open_straddle | net of $0.65/contract/side | 5 | +0.5% | [-73.0, +49.5] | 60% | 0.68 | -215 | 0.01 | 0.01 | -2907 | 0.00 | fail |
| B2_open_straddle | no fee (spread only) | 5 | +1.1% | [-72.7, +50.2] | 60% | 0.69 | -212 | 0.02 | 0.01 | -2907 | 0.00 | fail |
| B3_first15_side | net of $0.65/contract/side | 5 | +14.3% | [+6.3, +19.7] | 60% | 1.09 | +67 | 0.21 | 0.77 | -245 | 0.01 | fail |
| B3_first15_side | no fee (spread only) | 5 | +15.6% | [+7.1, +21.2] | 60% | 1.13 | +69 | 0.23 | 0.78 | -245 | 0.01 | fail |

**Splits (net returns)**

| baseline | split | n | expectancy | win |
|---|---|---|---|---|
| B1_random_side_30d | year 2020 | 3 | -61.0% | 0% |
| B1_random_side_30d | year 2024 | 3 | +42.6% | 100% |
| B1_random_side_30d | day flat | 5 | -2.3% | 60% |
| B1_random_side_30d | day high_vol | 1 | -43.8% | 0% |
| B1_random_side_30d | root QQQ | 1 | +50.4% | 100% |
| B1_random_side_30d | root SPXW | 2 | -16.1% | 50% |
| B1_random_side_30d | root SPY | 3 | -24.5% | 33% |
| B2_open_straddle | year 2020 | 2 | -73.0% | 0% |
| B2_open_straddle | year 2024 | 3 | +49.5% | 100% |
| B2_open_straddle | day flat | 5 | +0.5% | 60% |
| B2_open_straddle | root QQQ | 1 | +52.1% | 100% |
| B2_open_straddle | root SPXW | 2 | -20.3% | 50% |
| B2_open_straddle | root SPY | 2 | -4.5% | 50% |
| B3_first15_side | year 2020 | 2 | +6.3% | 50% |
| B3_first15_side | year 2024 | 3 | +19.7% | 67% |
| B3_first15_side | day flat | 5 | +14.3% | 60% |
| B3_first15_side | root QQQ | 1 | +60.2% | 100% |
| B3_first15_side | root SPXW | 2 | +17.3% | 50% |
| B3_first15_side | root SPY | 2 | -11.6% | 50% |

**Exit reasons**

| baseline | clock | vol_sl | vol_tp |
|---|---|---|---|
| B1_random_side_30d | 0 | 3 | 3 |
| B2_open_straddle | 1 | 1 | 3 |
| B3_first15_side | 0 | 2 | 3 |

**Cost at entry** (median): B1_random_side_30d: spread 3.2% of mid, fee 1.1% of premium, B2_open_straddle: spread 1.0% of mid, fee 0.8% of premium, B3_first15_side: spread 2.9% of mid, fee 1.5% of premium

**Session labels** (eval.metrics.classify_session, fixed rules): 20240417 flat, 20200224 flat, 20200316 high_vol

## Null calibration (protocol rule 11)

Each null run is scored exactly like a candidate (same summarize/passes_bar, N=194). "stat bar" = the protocol bar without the >=150-trade and 2-regime tests (which no 20-session run can meet); "CI only" = the session-bootstrap 95% CI of the expectancy excludes 0 (one-sided ~2.5% expected under the null). The pipeline is valid if <= 5% of null runs pass.

| null | runs | pass full bar | pass stat bar | CI>0 only | null expectancy mean [p5, p95] | real baseline beats | valid |
|---|---|---|---|---|---|---|---|
| shuffled side, B3 times kept | 3 | 0.0% | 0.0% | 33.3% | +3.4% [-18.9, +28.3] | 67% of nulls | yes |
| shuffled side, B3 times resampled | 3 | 0.0% | 0.0% | 0.0% | +5.9% [-4.3, +20.6] | 67% of nulls | yes |
| synthetic zero-drift (fair IV), B1_random_side_30d | 1 | 0.0% | 0.0% | 0.0% | -18.5% [-18.5, -18.5] | 100% of nulls | yes |
| synthetic zero-drift (fair IV), B2_open_straddle | 1 | 0.0% | 0.0% | 0.0% | -5.5% [-5.5, -5.5] | 100% of nulls | yes |
| synthetic zero-drift (fair IV), B3_first15_side | 1 | 0.0% | 0.0% | 0.0% | +18.1% [+18.1, +18.1] | 0% of nulls | yes |
| synthetic zero-drift (fair IV), all three | 3 | 0.0% | 0.0% | 0.0% | -2.0% [-17.2, +15.8] |  | yes |

Run time 71s.
