# Baselines: what "no edge" looks like after real costs

Pre-registered in the ledger (FOUNDATION, compass-v2/baselines/strategies.py @ 6e280f9). 20 DEV sessions (20200224..20241218; deliberately rich in event days: 5 high-vol, 9 trend, 6 flat by the ex-post labels), roots SPXW/SPY/QQQ, 0DTE only (a root with no same-day expiry that session is skipped). Execution: decision -> +2 s latency -> ask in force (capped at displayed size); exits at the bid in force 2 s after the trigger; fee $0.65/contract/side. Trial count for the deflated Sharpe: 230 (ledger).

| baseline | costs | n | expectancy | 95% CI (session bootstrap) | win | payoff | $/trade | Sharpe/trade | Sharpe/day | maxDD $ | DSR | bar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1_random_side_30d | net of $0.65/contract/side | 52 | -15.9% | [-32.3, +0.6] | 37% | 0.92 | -68 | -0.30 | -0.42 | -4077 | 0.00 | fail |
| B1_random_side_30d | no fee (spread only) | 52 | -14.8% | [-31.5, +1.8] | 37% | 0.96 | -67 | -0.28 | -0.39 | -4077 | 0.00 | fail |
| B2_open_straddle | net of $0.65/contract/side | 54 | +10.6% | [-9.3, +29.6] | 56% | 1.26 | +85 | 0.21 | 0.23 | -6220 | 0.10 | fail |
| B2_open_straddle | no fee (spread only) | 54 | +11.1% | [-8.8, +30.2] | 56% | 1.29 | +88 | 0.22 | 0.24 | -6220 | 0.12 | fail |
| B3_first15_side | net of $0.65/contract/side | 53 | +1.0% | [-19.1, +20.6] | 55% | 0.86 | +21 | 0.02 | 0.02 | -1804 | 0.00 | fail |
| B3_first15_side | no fee (spread only) | 53 | +2.0% | [-18.1, +21.8] | 55% | 0.89 | +23 | 0.03 | 0.04 | -1804 | 0.01 | fail |

**Splits (net returns)**

| baseline | split | n | expectancy | win |
|---|---|---|---|---|
| B1_random_side_30d | year 2020 | 6 | -22.5% | 33% |
| B1_random_side_30d | year 2021 | 8 | -44.9% | 12% |
| B1_random_side_30d | year 2022 | 12 | -35.5% | 17% |
| B1_random_side_30d | year 2023 | 11 | +6.2% | 45% |
| B1_random_side_30d | year 2024 | 15 | +1.7% | 60% |
| B1_random_side_30d | day flat | 18 | -14.7% | 44% |
| B1_random_side_30d | day high_vol | 9 | +1.7% | 44% |
| B1_random_side_30d | day trend | 25 | -23.1% | 28% |
| B1_random_side_30d | root QQQ | 16 | +1.2% | 50% |
| B1_random_side_30d | root SPXW | 16 | -25.3% | 25% |
| B1_random_side_30d | root SPY | 20 | -22.0% | 35% |
| B2_open_straddle | year 2020 | 7 | -11.5% | 43% |
| B2_open_straddle | year 2021 | 8 | +11.6% | 50% |
| B2_open_straddle | year 2022 | 12 | +25.8% | 67% |
| B2_open_straddle | year 2023 | 12 | +0.9% | 42% |
| B2_open_straddle | year 2024 | 15 | +15.9% | 67% |
| B2_open_straddle | day flat | 19 | -14.9% | 32% |
| B2_open_straddle | day high_vol | 9 | +47.0% | 78% |
| B2_open_straddle | day trend | 26 | +16.6% | 65% |
| B2_open_straddle | root QQQ | 16 | +11.5% | 56% |
| B2_open_straddle | root SPXW | 19 | +4.2% | 47% |
| B2_open_straddle | root SPY | 19 | +16.1% | 63% |
| B3_first15_side | year 2020 | 6 | -14.0% | 33% |
| B3_first15_side | year 2021 | 8 | -24.3% | 38% |
| B3_first15_side | year 2022 | 12 | +37.8% | 83% |
| B3_first15_side | year 2023 | 12 | -35.3% | 25% |
| B3_first15_side | year 2024 | 15 | +20.0% | 73% |
| B3_first15_side | day flat | 19 | +20.1% | 74% |
| B3_first15_side | day high_vol | 8 | -13.1% | 38% |
| B3_first15_side | day trend | 26 | -8.7% | 46% |
| B3_first15_side | root QQQ | 16 | -0.3% | 56% |
| B3_first15_side | root SPXW | 18 | +6.7% | 56% |
| B3_first15_side | root SPY | 19 | -3.3% | 53% |

**Exit reasons**

| baseline | clock | vol_sl | vol_tp |
|---|---|---|---|
| B1_random_side_30d | 0 | 33 | 19 |
| B2_open_straddle | 15 | 13 | 26 |
| B3_first15_side | 0 | 24 | 29 |

**Cost at entry** (median): B1_random_side_30d: spread 2.6% of mid, fee 1.2% of premium, B2_open_straddle: spread 1.4% of mid, fee 0.6% of premium, B3_first15_side: spread 2.7% of mid, fee 1.2% of premium

**Session labels** (eval.metrics.classify_session, fixed rules): 20240417 flat, 20200224 flat, 20200316 high_vol, 20200612 high_vol, 20201104 flat, 20210127 trend, 20210512 trend, 20210818 trend, 20220124 high_vol, 20220518 trend, 20221116 flat, 20221213 flat, 20230313 high_vol, 20230614 flat, 20230816 trend, 20231027 trend, 20240131 trend, 20240724 trend, 20240918 flat, 20241218 trend

## Null calibration (protocol rule 11)

Each null run is scored exactly like a candidate (same summarize/passes_bar, N=230). "stat bar" = the protocol bar without the >=150-trade and 2-regime tests (which no 20-session run can meet); "CI only" = the session-bootstrap 95% CI of the expectancy excludes 0 (one-sided ~2.5% expected under the null). The pipeline is valid if <= 5% of null runs pass.

| null | runs | pass full bar | pass stat bar | CI>0 only | null expectancy mean [p5, p95] | real baseline beats | valid |
|---|---|---|---|---|---|---|---|
| shuffled side, B3 times kept | 100 | 0.0% | 0.0% | 0.0% | -10.6% [-24.6, +1.5] | 94% of nulls | yes |
| shuffled side, B3 times resampled | 100 | 0.0% | 0.0% | 0.0% | -9.8% [-22.3, +3.9] | 90% of nulls | yes |
| synthetic zero-drift (fair IV), B1_random_side_30d | 15 | 0.0% | 0.0% | 0.0% | -12.8% [-23.7, -0.4] | 47% of nulls | yes |
| synthetic zero-drift (fair IV), B2_open_straddle | 15 | 0.0% | 0.0% | 0.0% | -10.1% [-19.4, +2.2] | 100% of nulls | yes |
| synthetic zero-drift (fair IV), B3_first15_side | 15 | 0.0% | 0.0% | 0.0% | -9.1% [-19.7, +6.5] | 80% of nulls | yes |
| synthetic zero-drift (fair IV), all three | 45 | 0.0% | 0.0% | 0.0% | -10.7% [-22.3, +4.2] |  | yes |

Run time 2790s.

## Reading

- **No baseline passes; none is distinguishable from zero.** B1 (coin-flip side) loses 15.9% a trade net (CI just
  touches 0); B3 (momentum side) +1.0% [-19, +21]; B2 (open straddle) +10.6% [-9, +30]. Fees are small next to the
  spread on these contracts (fee ~1% of premium, spread ~2.6% of mid at entry: a round trip costs ~4-5% before any move).
- B2's positive point estimate is the session sample, not an edge: these 20 days were chosen to span regimes and are
  rich in event days (5 high-vol, 9 trend by the ex-post labels); straddles win on those (+47% high-vol, +17% trend)
  and lose on flat days (-15%). The labels use the whole day's path: report-only, never a filter.
- **Null calibration: valid.** 245 null runs (100+100 shuffled-side, 45 synthetic zero-drift): 0 pass the protocol
  bar or its statistical part. The nulls' own mean is about -10% a trade (costs + selling at the bid), so their 0%
  "CI>0" rate is the easy case; the zero-mean false-positive rate of the session-bootstrap CI is measured separately
  (tests/test_eval.py, 1,000 sims of skewed option-like returns): 2.2% at 20 sessions, 2.6% at 60, 1.7% at 200
  (nominal 2.5%).
- B3's side choice beats 94% of its own shuffled-side nulls (times kept): close to, not at, the 95% bar. Any
  candidate built on "the side of the opening move" must clear this shuffled null, not zero.
