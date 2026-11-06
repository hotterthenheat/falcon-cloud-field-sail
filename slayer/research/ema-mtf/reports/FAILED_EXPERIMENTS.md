# Failed experiments — every test and variant that did not pass, with its numbers

Nothing here was dropped from the record: every Stage-1 test, every Stage-2 variant (winners and losers, every trade in its log), and every Stage-3 look is listed with its result and its ledger line (research-v2-ledger.md, worker EMA). Trade logs and event tables: `v2data/ema/results/` (stage1/, stage2/trades*, stage2/nulls, stage3/).

## Stage 1 — S1A features that failed (40 tests)

| feature @ tf | δ Y30 (pp) | 95% CI | Holm p | rules failed | reprice δ* |
|---|---|---|---|---|---|
| S @ 1m | +0.30% | [-0.37, +1.00] | 1 | ci_gt_0, holm_lt_0.05 | +0.47% |
| A @ 1m | -0.43% | [-1.06, +0.17] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, block_B_gt_0, h15_h60_gt_0, beats_random | -0.27% |
| B @ 1m | -0.19% | [-1.21, +0.79] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, h15_h60_gt_0 | -0.07% |
| C @ 1m | +0.49% | [-0.41, +1.53] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +0.31% |
| D @ 1m | +0.11% | [-0.75, +0.96] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, h15_h60_gt_0 | -0.01% |
| H @ 1m | -0.29% | [-1.36, +0.84] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0, beats_random | -0.88% |
| L50 @ 1m | +1.11% | [+0.11, +2.03] | 0.68 | holm_lt_0.05 | +0.49% |
| L200 @ 1m | +0.78% | [-0.18, +1.67] | 1 | ci_gt_0, holm_lt_0.05 | +0.32% |
| S @ 5m | -0.09% | [-0.93, +0.75] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | -0.29% |
| A @ 5m | +0.16% | [-0.44, +0.76] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, h15_h60_gt_0 | +0.47% |
| B @ 5m | -0.03% | [-1.18, +1.22] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | -0.27% |
| C @ 5m | -0.41% | [-1.06, +0.20] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, block_B_gt_0, h15_h60_gt_0 | -0.61% |
| D @ 5m | +0.35% | [-0.71, +1.60] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | +0.48% |
| H @ 5m | -1.05% | [-2.15, +0.13] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, block_B_gt_0, h15_h60_gt_0, beats_random | -0.42% |
| L50 @ 5m | +0.19% | [-0.65, +0.97] | 1 | ci_gt_0, holm_lt_0.05 | +0.44% |
| L200 @ 5m | +0.11% | [-0.62, +0.79] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, h15_h60_gt_0 | -0.37% |
| S @ 15m | -0.03% | [-0.74, +0.63] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | -0.06% |
| A @ 15m | +0.13% | [-0.92, +1.34] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | -0.07% |
| B @ 15m | +0.86% | [-0.42, +2.10] | 1 | ci_gt_0, holm_lt_0.05 | +0.65% |
| C @ 15m | +0.28% | [-0.44, +0.97] | 1 | ci_gt_0, holm_lt_0.05 | -0.03% |
| D @ 15m | +0.39% | [-0.74, +1.46] | 1 | ci_gt_0, holm_lt_0.05 | -0.28% |
| H @ 15m | +0.18% | [-1.69, +2.42] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +0.44% |
| L50 @ 15m | -0.01% | [-0.73, +0.65] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | -0.74% |
| L200 @ 15m | -0.04% | [-0.64, +0.56] | 1 | ci_gt_0, holm_lt_0.05, block_A_gt_0, h15_h60_gt_0 | +0.34% |
| S @ 30m | +0.01% | [-0.61, +0.61] | 1 | ci_gt_0, holm_lt_0.05, h15_h60_gt_0 | -0.68% |
| A @ 30m | +0.44% | [-0.75, +1.72] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +0.30% |
| B @ 30m | +0.42% | [-0.60, +1.45] | 1 | ci_gt_0, holm_lt_0.05 | +0.22% |
| C @ 30m | +0.37% | [-0.76, +1.45] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +0.73% |
| D @ 30m | +0.05% | [-0.76, +0.83] | 1 | ci_gt_0, holm_lt_0.05, h15_h60_gt_0 | -0.45% |
| H @ 30m | +1.58% | [-1.09, +4.39] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +1.39% |
| L50 @ 30m | +0.00% | [-0.60, +0.60] | 1 | ci_gt_0, holm_lt_0.05, h15_h60_gt_0 | -0.30% |
| L200 @ 30m | +0.26% | [-0.25, +0.82] | 1 | ci_gt_0, holm_lt_0.05 | +0.10% |
| S @ 60m | -0.09% | [-0.92, +0.81] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0, h15_h60_gt_0 | -0.19% |
| A @ 60m | +0.42% | [-0.56, +1.31] | 1 | ci_gt_0, holm_lt_0.05 | -0.31% |
| B @ 60m | +0.48% | [-0.47, +1.39] | 1 | ci_gt_0, holm_lt_0.05, block_B_gt_0 | +0.45% |
| C @ 60m | +0.06% | [-1.43, +1.37] | 1 | ci_gt_0, holm_lt_0.05, h15_h60_gt_0 | -0.29% |
| D @ 60m | +0.97% | [-0.33, +2.38] | 1 | ci_gt_0, holm_lt_0.05 | +0.81% |
| H @ 60m | +0.60% | [-1.14, +2.22] | 1 | ci_gt_0, holm_lt_0.05 | -1.30% |
| L50 @ 60m | -0.01% | [-0.72, +0.73] | 1 | ci_gt_0, holm_lt_0.05, h15_h60_gt_0 | +0.30% |
| L200 @ 60m | +0.46% | [-0.07, +1.02] | 1 | ci_gt_0, holm_lt_0.05 | +0.24% |

## Stage 1 — S1B timeframe coefficients

* option 1m state: β -0.205%/unit, one-sided p 0.775, Holm 1 → FAIL
* option 5m state: β +0.297%/unit, one-sided p 0.235, Holm 1 → FAIL
* option 15m state: β -0.369%/unit, one-sided p 0.83, Holm 1 → FAIL
* option 30m state: β -0.108%/unit, one-sided p 0.632, Holm 1 → FAIL
* option 60m state: β -0.358%/unit, one-sided p 0.842, Holm 1 → FAIL

## Stage 1 — S1C confirmations that failed (14 tests)

| confirmation | δ Y30 (pp) | 95% CI | Holm p | rules failed |
|---|---|---|---|---|
| VWAP side | +3.79% | [+0.38, +7.31] | 0.22 | holm_lt_0.05 |
| underlying 5m state +1 | +1.59% | [-0.56, +4.22] | 1 | ci_gt_0, holm_lt_0.05 |
| RSI14(5m und) > 50 (trade dir.) | -2.67% | [-4.94, +0.36] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| cumulative RVOL > 1.5 | -1.43% | [-5.05, +3.28] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| 15-min opening-range break | +2.49% | [-0.48, +5.60] | 0.705 | ci_gt_0, holm_lt_0.05 |
| PDH/PDL break | -2.50% | [-6.22, +0.73] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| premarket H/L break | +1.00% | [-2.33, +4.33] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| 5m BOS within 3 bars | -0.13% | [-3.34, +2.38] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| net GEX < 0 (inferred) | -2.90% | [-10.12, +1.71] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| no wall against within 0.3% (inferred) | +0.14% | [-2.09, +2.69] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| P/C OI ratio > 20-session median (obs.) | -1.69% | [-4.47, +0.55] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| ATM IV up over 60 min (obs.) | -1.08% | [-3.80, +1.60] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| contract RVOL > 2 (obs.) | +3.76% | [-2.05, +7.11] | 1 | ci_gt_0, holm_lt_0.05, each_block_gt_0 |
| UW ask-side flow, trade dir., 15 min (obs.) | +1.61% | [-3.60, +6.59] | 1 | ci_gt_0, holm_lt_0.05 |

## Stage 2-C — variants (none is a candidate unless its CI is > 0; all are listed)

| variant | n | expectancy net | 95% CI | win | L60 | null-time pct | null-side pct | status |
|---|---|---|---|---|---|---|---|---|
| centre: B 5m, no MTF, exit 3 | 9269 | -1.30% | [-2.9, +0.8] | 26% | -0.69% | 100% | 95% | FAILED: CI includes or is below 0 |
| entry A reclaim E9 | 24144 | -1.89% | [-2.8, -0.8] | 21% | -1.42% | 100% | 60% | FAILED: CI includes or is below 0 |
| entry C alignment | 6952 | -1.93% | [-2.8, -1.0] | 29% | -1.41% | 0% | 0% | FAILED: CI includes or is below 0 |
| entry D compression breakout | 8389 | -1.50% | [-2.6, -0.1] | 28% | -0.93% | 95% | 60% | FAILED: CI includes or is below 0 |
| entry E MTF pullback 5->15 | 4620 | -1.65% | [-2.5, -0.6] | 21% | -1.25% | 60% | 40% | FAILED: CI includes or is below 0 |
| entry F B + VWAP | 7745 | -0.92% | [-2.8, +1.6] | 27% | -0.24% | 100% | 100% | FAILED: CI includes or is below 0 |
| entry G B + GEX | 5377 | -2.01% | [-3.2, -0.7] | 26% | -1.52% | 70% | 35% | FAILED: CI includes or is below 0 |
| entry H early transition | 7186 | -2.11% | [-3.1, -1.0] | 17% | -1.48% | 50% | 0% | FAILED: CI includes or is below 0 |
| MTF A sequential (5,15) | 513 | -3.65% | [-5.5, -1.8] | 27% | -3.01% | 0% | 0% | FAILED: CI includes or is below 0 |
| MTF B HTF-first (5,15) | 2409 | -1.46% | [-2.7, -0.0] | 28% | -1.03% | 80% | 55% | FAILED: CI includes or is below 0 |
| MTF C full alignment (5,15,60) | 1095 | -1.50% | [-2.8, -0.0] | 25% | -1.47% | 60% | 45% | FAILED: CI includes or is below 0 |
| MTF D weighted (1..60) | 1814 | -1.02% | [-2.3, +0.5] | 27% | -0.79% | 95% | 95% | FAILED: CI includes or is below 0 |
| MTF E partial (1..60) | 2932 | -1.38% | [-2.6, -0.0] | 28% | -0.97% | 75% | 70% | FAILED: CI includes or is below 0 |
| MTF F transition (H; 5,15) | 477 | -1.37% | [-4.0, +2.3] | 18% | -1.00% | 95% | 100% | FAILED: CI includes or is below 0 |
| exit 1 next EMA | 9909 | -1.93% | [-2.5, -1.4] | 30% | -1.72% | 100% | 100% | FAILED: CI includes or is below 0 |
| exit 2 partials | 8663 | -1.95% | [-2.7, -1.2] | 20% | -1.68% | 95% | 100% | FAILED: CI includes or is below 0 |
| exit 4 9/20 cross | 7379 | -0.92% | [-3.4, +2.1] | 28% | -0.68% | 100% | 100% | FAILED: CI includes or is below 0 |
| exit 5 1m structure | 9849 | -1.77% | [-2.5, -1.0] | 28% | -1.48% | 65% | 70% | FAILED: CI includes or is below 0 |
| exit 6 HTF loss | 9269 | -1.30% | [-2.9, +0.8] | 26% | -0.69% | 100% | 85% | FAILED: CI includes or is below 0 |
| exit 7 ATR bracket | 8439 | -1.69% | [-2.6, -0.8] | 35% | -1.45% | 95% | 100% | FAILED: CI includes or is below 0 |
| exit 8 fixed -20/+40 | 4183 | -2.47% | [-4.2, -0.7] | 37% | -2.46% | 95% | 90% | FAILED: CI includes or is below 0 |
| exit 9 ATR trail | 8750 | -1.69% | [-2.8, -0.3] | 30% | -1.41% | 95% | 75% | FAILED: CI includes or is below 0 |
| exit 10 combination | 9486 | -1.17% | [-2.7, +0.9] | 25% | -0.58% | 100% | 90% | FAILED: CI includes or is below 0 |
| reference: BL3 underlying cross, exit 3 | 7322 | -1.60% | [-3.5, +0.8] | 23% | -0.83% | nan% | nan% | reference |

## Stage 3 — the walk-forward result against the §7 bar

Failed tests: ci_gt_0, win_or_payoff, dsr_ge_0.95, both_blocks_gt_0, ge2_daytypes_gt_0.

