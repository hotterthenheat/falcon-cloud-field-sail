# Stage 3 — walk-forward, PBO, DSR and the §7 DEV bar (S2C family)

Pre-registered: PREREG §6–§7 (frozen 7d1c06d), selection rule fixed in amendment A3 item 10. Code `stage3/wf.py` (selection on the Stage-2 trade logs: the OOS trades ARE Stage-2 trades of the chosen variant in the test month, same simulator), `stage3/robust.py` (sensitivity, ablation). OOS trade log: `v2data/ema/results/stage3/wf_S2C_oos.parquet`.

## Walk-forward folds (anchored, ≥ 2 train months, 1-session embargo)

| fold | test_month | chosen | train_exp | n_train_sessions | n_test_sessions | test_n | test_exp |
|---|---|---|---|---|---|---|---|
| 0 | 202205 | S2C-exit8 (exit 8 fixed -20/+40) | -0.50% | 42 | 21 | 829 | -3.23% |
| 1 | 202403 | S2C-mtfB (MTF B HTF-first (5,15)) | -0.33% | 63 | 20 | 360 | -2.66% |
| 2 | 202404 | S2C-mtfD (MTF D weighted (1..60)) | -0.62% | 83 | 22 | 400 | -3.98% |
| 3 | 202405 | S2C-exit4 (exit 4 9/20 cross) | -1.00% | 105 | 22 | 1303 | -0.90% |

## Concatenated out-of-sample result

n = 2892, expectancy net **-2.21%** [-4.8, +0.9] (gross -1.8%, mid-to-mid -0.4%), win 26% [+22, +31], avg win +24.4%, avg loss -11.5%, profit factor 0.67, net $-101,211, return on premium -1.79%, max DD $-117,891, Sharpe/day ann. -2.54, Sortino ann. -4.20, hold 73/40 min (mean/median), max losing streak 105, mean entry spread 1.33% of mid, spread cost $22.05/trade, fees $1.58/trade.

OOS by ticker: IWM -2.6% n=667 [-4.7, -0.4]; QQQ -2.1% n=702 [-5.8, +2.7]; SPXW -2.2% n=799 [-5.2, +1.7]; SPY -2.0% n=724 [-4.9, +1.9]

OOS by DTE: 0 -2.7% n=402 [-14.8, +13.3]; 1-7 -3.1% n=775 [-5.7, -0.1]; 31-90 -1.4% n=569 [-2.6, -0.1]; 8-30 -2.4% n=593 [-4.3, -0.3]; 91-200 -1.3% n=553 [-2.0, -0.5]

OOS by call/put: call -1.4% n=1409 [-5.0, +3.1]; put -3.0% n=1483 [-6.1, +1.0]

OOS by day type: flat -3.0% n=2064 [-6.0, +1.2]; high_vol -4.8% n=415 [-9.6, +0.1]; trend +4.3% n=413 [-2.7, +10.9]

OOS by block: A -1.8% n=2063 [-4.9, +2.5]; B -3.2% n=829 [-7.5, +1.5]

**PBO** (CSCV, 16 blocks, sessions × S2C variants): 0.12. **DSR** of the OOS per-trade Sharpe at N = 1208 ledger trials: 0.000 (benchmark SR0 0.062, observed -0.068).

## §7 DEV promotion bar

| test | result |
|---|---|
| n_ge_150 | PASS |
| ci_gt_0 | fail |
| win_or_payoff | fail |
| dsr_ge_0.95 | fail |
| pbo_lt_0.3 | PASS |
| both_blocks_gt_0 | fail |
| ge2_daytypes_gt_0 | fail |
| pass | fail |

## Sensitivity and ablation

DIAGNOSTIC (PREREG amendment A4): no candidate passed the section-7 DEV-WF bar; these three non-candidate variants cover every component section 6 names. Nothing here can promote a variant.

### S2C-entryF (entry F B + VWAP) — base expectancy -0.92% (n=7745)

| look | n | expectancy net | 95% CI | Δ vs base (paired, pp) [CI] | neighbour |
|---|---|---|---|---|---|
| lat_L0 | 7746 | -0.70% | [-2.5, +1.8] | +0.22% [+0.2, +0.2] |  |
| lat_L60 | 7732 | -0.24% | [-2.2, +2.5] | +0.68% [+0.4, +1.0] |  |
| slip1 | 7745 | -1.72% | [-3.5, +0.8] | -0.80% [-0.9, -0.7] |  |
| fee065 | 7745 | -0.91% | [-2.8, +1.6] | +0.01% [+0.0, +0.0] |  |
| fee165 | 7745 | -0.93% | [-2.8, +1.6] | -0.01% [-0.0, -0.0] |  |
| delta030 | 7742 | -0.99% | [-2.9, +1.7] | -0.07% [-0.2, +0.1] | yes |
| delta050 | 7727 | -0.85% | [-2.6, +1.6] | +0.07% [-0.1, +0.2] | yes |
| ema_5_21 | 9352 | -1.17% | [-3.0, +1.3] | -0.25% [-0.7, +0.2] | yes |
| ema_15_21 | 6643 | -1.03% | [-2.9, +1.4] | -0.11% [-0.8, +0.6] | yes |
| ema_9_20 | 7862 | -1.09% | [-2.9, +1.4] | -0.17% [-0.4, +0.0] | yes |
| ema_9_50 | 5817 | -1.31% | [-2.7, +0.5] | -0.39% [-1.5, +0.6] | yes |
| strict | 7687 | -0.90% | [-2.8, +1.6] | +0.02% [-0.0, +0.0] | yes |
| trade | 4570 | -0.76% | [-3.9, +3.6] | +0.16% [-1.2, +2.0] | yes |
| exit_ema5 | 7937 | -1.27% | [-2.9, +1.1] | -0.35% [-1.0, +0.2] | yes |
| exit_ema15 | 7626 | -0.89% | [-2.9, +1.7] | +0.03% [-0.4, +0.5] | yes |
| ablation:no_vwap | 9227 | -1.25% | [-2.8, +0.9] | -0.33% [-0.8, +0.0] |  |
| ablation:no_und_ema21 | 7777 | -0.94% | [-2.8, +1.6] | -0.02% [-0.1, +0.0] |  |
| ablation:no_und_legs | 9269 | -1.30% | [-2.9, +0.8] | -0.38% [-0.9, -0.0] |  |
| ablation:underlying_only | 5521 | -1.13% | [-3.4, +2.0] | -0.21% [-1.6, +1.1] |  |

Survival rule: slip1 > 0 False, L60 > 0 False, neighbours positive 0% (≥ 70% needed) → **does not survive**.

### S2C-mtfD (MTF D weighted (1..60)) — base expectancy -1.02% (n=1814)

| look | n | expectancy net | 95% CI | Δ vs base (paired, pp) [CI] | neighbour |
|---|---|---|---|---|---|
| lat_L0 | 1815 | -0.79% | [-2.1, +0.8] | +0.23% [+0.2, +0.3] |  |
| lat_L60 | 1813 | -0.79% | [-2.1, +0.8] | +0.23% [-0.1, +0.5] |  |
| slip1 | 1814 | -1.48% | [-2.8, +0.1] | -0.46% [-0.5, -0.4] |  |
| fee065 | 1814 | -1.02% | [-2.3, +0.5] | +0.01% [+0.0, +0.0] |  |
| fee165 | 1814 | -1.03% | [-2.3, +0.5] | -0.01% [-0.0, -0.0] |  |
| delta030 | 1815 | -1.11% | [-2.5, +0.4] | -0.09% [-0.2, -0.0] | yes |
| delta050 | 1812 | -0.92% | [-2.2, +0.6] | +0.10% [-0.0, +0.2] | yes |
| ema_5_21 | 2302 | -1.05% | [-2.2, +0.3] | -0.03% [-0.5, +0.4] | yes |
| ema_15_21 | 1285 | -1.80% | [-3.0, -0.6] | -0.78% [-1.8, +0.0] | yes |
| ema_9_20 | 1846 | -0.96% | [-2.3, +0.6] | +0.06% [-0.1, +0.2] | yes |
| ema_9_50 | 823 | -2.54% | [-3.8, -1.2] | -1.52% [-2.7, -0.4] | yes |
| strict | 1811 | -1.02% | [-2.3, +0.5] | -0.00% [-0.0, +0.0] | yes |
| trade | 794 | -1.09% | [-3.2, +1.5] | -0.07% [-1.0, +1.1] | yes |
| exit_ema5 | 1820 | -1.10% | [-2.1, +0.1] | -0.08% [-0.6, +0.4] | yes |
| exit_ema15 | 1815 | -0.75% | [-2.3, +1.1] | +0.27% [-0.2, +0.9] | yes |
| ablation:no_1m | 1814 | -1.02% | [-2.3, +0.5] | +0.00% [-0.0, +0.0] |  |
| ablation:no_5m | 1787 | -1.09% | [-2.4, +0.5] | -0.07% [-0.1, -0.0] |  |
| ablation:no_15m | 1545 | -1.18% | [-2.5, +0.5] | -0.16% [-1.0, +0.5] |  |
| ablation:no_30m | 1548 | -1.16% | [-2.5, +0.4] | -0.14% [-0.9, +0.5] |  |
| ablation:no_60m | 2611 | -1.19% | [-2.5, +0.3] | -0.17% [-0.9, +0.8] |  |
| ablation:no_mtf | 9269 | -1.30% | [-2.9, +0.8] | -0.27% [-1.8, +1.7] |  |

Survival rule: slip1 > 0 False, L60 > 0 False, neighbours positive 0% (≥ 70% needed) → **does not survive**.

### S2C-entryG (entry G B + GEX) — base expectancy -2.01% (n=5377)

| look | n | expectancy net | 95% CI | Δ vs base (paired, pp) [CI] | neighbour |
|---|---|---|---|---|---|
| lat_L0 | 5379 | -1.79% | [-3.0, -0.5] | +0.22% [+0.2, +0.2] |  |
| lat_L60 | 5365 | -1.52% | [-2.8, -0.1] | +0.49% [+0.2, +0.8] |  |
| slip1 | 5377 | -2.68% | [-3.9, -1.4] | -0.68% [-0.7, -0.6] |  |
| fee065 | 5377 | -2.00% | [-3.2, -0.7] | +0.01% [+0.0, +0.0] |  |
| fee165 | 5377 | -2.01% | [-3.2, -0.7] | -0.01% [-0.0, -0.0] |  |
| delta030 | 5373 | -2.07% | [-3.3, -0.6] | -0.06% [-0.2, +0.1] | yes |
| delta050 | 5360 | -1.82% | [-3.0, -0.5] | +0.19% [+0.1, +0.3] | yes |
| ema_5_21 | 6757 | -2.18% | [-3.3, -1.1] | -0.18% [-0.8, +0.4] | yes |
| ema_15_21 | 4460 | -1.83% | [-3.4, +0.1] | +0.17% [-0.7, +1.1] | yes |
| ema_9_20 | 5491 | -2.20% | [-3.3, -1.1] | -0.20% [-0.6, +0.1] | yes |
| ema_9_50 | 3825 | -1.72% | [-2.9, -0.5] | +0.29% [-0.6, +1.2] | yes |
| strict | 5349 | -2.00% | [-3.2, -0.7] | +0.01% [-0.0, +0.0] | yes |
| trade | 3045 | -2.49% | [-4.5, -0.2] | -0.49% [-1.4, +0.5] | yes |
| exit_ema5 | 5525 | -2.30% | [-3.2, -1.3] | -0.29% [-1.0, +0.3] | yes |
| exit_ema15 | 5276 | -2.11% | [-3.5, -0.6] | -0.10% [-0.5, +0.4] | yes |
| ablation:no_gex | 6871 | -1.03% | [-2.9, +1.7] | +0.98% [-0.4, +3.4] |  |
| ablation:no_wall | 6982 | -1.95% | [-3.1, -0.6] | +0.06% [-0.3, +0.4] |  |
| ablation:no_positioning | 9269 | -1.30% | [-2.9, +0.8] | +0.71% [-0.5, +2.7] |  |
| ablation:underlying_only | 4277 | -2.52% | [-4.1, -0.9] | -0.51% [-2.0, +1.0] |  |

Survival rule: slip1 > 0 False, L60 > 0 False, neighbours positive 0% (≥ 70% needed) → **does not survive**.

