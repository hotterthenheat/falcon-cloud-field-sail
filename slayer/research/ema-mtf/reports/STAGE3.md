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

