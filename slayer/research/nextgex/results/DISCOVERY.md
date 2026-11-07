# NEXTGEX: DISCOVERY numbers (written down before the CALIBRATION look)

Source: `RESULTS_DISC_ONLY.json` (`NEXTGEX_PHASE=DISC python3 -I analyze.py`), sessions 2020-02-18 .. 2023-12-29.
In this file the "CALIBRATION" slots of the JSON repeat DISCOVERY and are not a look; the H1.3 Brier figure is
in-sample. SPXW is primary.

| test | SPXW DISCOVERY | verdict at this stage |
|---|---|---|
| H1.1 two-tail |z|=1, realised / priced | R = 0.954 [0.877, 1.031], one-sided p = 0.12, 764 days; years 0.953 / 0.987 / 0.927, all CIs cover 1 | **FAIL** (CI covers 1) |
| H2.1 fly excess on OI z-score, 14:00 | beta = +0.0024 [-0.0021, +0.0075], p = 0.16; floor 0.0102; 2023 sign negative; permutation p95 0.0045 (real below it) | **FAIL** |

Secondary (descriptive):
* H1.2 tail by tail (SPXW): R(z) = 1.29 / 0.98 / 0.92 / 0.94 / 0.96 at z = -2.5..-0.5 and 1.01 / 0.97 / 0.96 /
  **0.85 / 0.36 [0.13, 0.67]** at z = +0.5..+2.5. Far upside is overpriced; the left tail is not.
* H1.5 payoff per $1 of mid (SPXW OTM): puts 0.91 / 0.93 / 0.88 / 0.88 / 0.94 (z -2.5..-0.5); calls 1.01 / 1.00 /
  0.89 / **0.43 [0.23, 0.67] / 0.17 [0.03, 0.39]** (z +0.5..+2.5).
* H1.4 PIT: outer two deciles 18.3% (20% if calibrated); quoted range covers the close 98.4% of session-times.
* App-style smile sensitivity: R = 0.924 [0.852, 1.000]: the app's quadratic smile prices the ±1 sd tails at 15.6%
  vs the board's own 15.1% (realised 14.4%).
* Null (closes drawn from the priced distribution): R mean 1.002, CI covered 1 in 97.5% of runs: pipeline unbiased.
* H2.2 the largest-OI strike within 1 sd: closes within half a strike of it 13.9% vs 11.2% priced (ratio 1.24
  [1.03, 1.45]); vs flies in the same distance cell +0.0165 [-0.0022, +0.0353].
* Replication H1.1: SPY 0.845 [0.744, 0.956], QQQ 0.838 [0.744, 0.938], IWM 0.626 [0.517, 0.738]. ETF far-OTM
  mids sit on the $0.01 tick (ask/2 rule), which inflates priced tails; read with that caveat.
* Replication H2.1: SPY -0.0119 [-0.023, -0.0011], QQQ -0.0032 [-0.017, +0.010], IWM -0.0241 [-0.050, -0.0006]:
  if anything, closes avoid the large-OI strikes on the ETFs.
