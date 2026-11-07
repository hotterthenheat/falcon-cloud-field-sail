# EDGE0DTE hurdle (PROTOCOL section 5) - DISCOVERY only

Input: trades.parquet (foundation.trades): executable round trips (1-second NBBO, ask in / bid out at the first valid
quote >= t + 2 s, $0.65/contract/side) of the 0.30-delta call, the 0.30-delta put and the ATM straddle, held to h.

Per root x 30-min bucket x h (and pooled over buckets):
  cost       round-trip cost / premium = (entry half-spread + exit half-spread + fees) / premium (median, mean)
  direction  OLS over single options (calls and puts pooled), day-clustered:
                 ret_net = a + b * za + c * (V - 1)          za = sign-aligned Z (call +Z, put -Z)
             hurdle E[za]* = -(a + c * (mean V - 1)) / b : the sign-aligned mean Z a long 0.30-delta option needs for
             zero expected net P&L when realized variance stays at its average for that cell
  volatility OLS over straddles:  ret_net = a + c * (V - 1);  long hurdle (E[V] - 1)* = -a / c
             short-premium (iron-fly proxy): OLS ret_mid = a_m + c_m (V - 1); a short straddle pays the same
             round-trip cost, so it breaks even at (E[V] - 1)* = -(a_m + mean cost) / c_m (V must be BELOW 1 + this)
  CIs: day-clustered bootstrap (500 resamples of days) of each hurdle.

Sample (fixed before any fill was seen, foundation/q1s_plan.py): SPXW every DISCOVERY expiry session at 10:00, 12:00 and 14:00 plus 100 sessions per other 30-min bucket at a random grid time; SPY/QQQ/IWM 30 sessions per bucket. Bucket "09:30" holds the 09:45-09:55 decision times. Exit decision min(t + h, close - 2 min); "close" = 15:58:00 decision (the Stage-1 Z/V at h=close run to 16:00). Labels: fills OBS; returns, Z, V, hurdles CALC.

Reading: hz = sign-aligned E[Z] a Stage-1 directional effect must reach before a long 0.30-delta option can make money after costs; hv_long = E[V]-1 a long straddle needs; hv_short = E[V]-1 below which a short straddle (iron-fly proxy, before the wing cost) makes money. A Stage-1 effect smaller than its hurdle cannot be an option edge.

## Sample

| root | decision times | sessions | single-option round trips | straddle round trips | skipped |
|---|---:|---:|---:|---:|---:|
| SPXW | 175 | 42 | 1400 | 700 | 0 (0.0%) |

Skip reasons: 

## SPXW

| bucket | h | times | cost 0.30d (median / mean) | cost straddle (median / mean) | net ret 0.30d | hurdle E[za] [95%] | b (ret per Z) | net ret straddle | hurdle E[V]-1 long [95%] | E[V]-1 short below [95%] |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 09:30 | 15 | 6 | - / - | - / - | - | - | - | - | - | - |
| 09:30 | 30 | 6 | - / - | - / - | - | - | - | - | - | - |
| 09:30 | 60 | 6 | - / - | - / - | - | - | - | - | - | - |
| 09:30 | close | 6 | - / - | - / - | - | - | - | - | - | - |
| 10:00 | 15 | 42 | 8.2% / 10.8% | 5.8% / 7.6% | -15.2% | +0.56 [+0.45, +0.68] | 27.2% | -10.0% | +7.29 [+2.04, +38.68] | -3.20 [-14.69, -0.77] |
| 10:00 | 30 | 42 | 8.2% / 11.0% | 6.7% / 8.0% | -16.1% | +0.40 [+0.29, +0.52] | 40.1% | -10.4% | +2.22 [+1.11, +7.71] | -0.72 [-3.07, -0.26] |
| 10:00 | 60 | 42 | 7.9% / 10.6% | 6.0% / 7.9% | -21.0% | +0.38 [+0.24, +0.55] | 55.3% | -12.9% | +1.02 [+0.33, +6.98] | -0.17 [-0.51, +0.54] |
| 10:00 | close | 42 | 8.1% / 18.1% | 14.3% / 15.6% | -25.7% | +0.18 [-0.10, +0.63] | 140.1% | -20.3% | -0.09 [-0.22, +5.57] | -0.32 [-0.82, -0.03] |
| 10:30 | 15 | 5 | - / - | - / - | - | - | - | - | - | - |
| 10:30 | 30 | 5 | - / - | - / - | - | - | - | - | - | - |
| 10:30 | 60 | 5 | - / - | - / - | - | - | - | - | - | - |
| 10:30 | close | 5 | - / - | - / - | - | - | - | - | - | - |
| 11:00 | 15 | 7 | - / - | - / - | - | - | - | - | - | - |
| 11:00 | 30 | 7 | - / - | - / - | - | - | - | - | - | - |
| 11:00 | 60 | 7 | - / - | - / - | - | - | - | - | - | - |
| 11:00 | close | 7 | - / - | - / - | - | - | - | - | - | - |
| 11:30 | 15 | 3 | - / - | - / - | - | - | - | - | - | - |
| 11:30 | 30 | 3 | - / - | - / - | - | - | - | - | - | - |
| 11:30 | 60 | 3 | - / - | - / - | - | - | - | - | - | - |
| 11:30 | close | 3 | - / - | - / - | - | - | - | - | - | - |
| 12:00 | 15 | 42 | 7.5% / 7.6% | 5.2% / 5.2% | -8.0% | +0.23 [+0.16, +0.29] | 35.7% | -5.6% | +1.01 [+0.57, +5.57] | -1.31 [-10.08, -0.94] |
| 12:00 | 30 | 42 | 7.7% / 7.6% | 5.3% / 5.4% | -7.6% | +0.15 [+0.09, +0.22] | 49.9% | -5.5% | - | -2.91 [-33.92, -0.85] |
| 12:00 | 60 | 42 | 7.3% / 7.8% | 5.6% / 5.6% | -8.8% | +0.12 [+0.03, +0.22] | 70.8% | -5.9% | - | - |
| 12:00 | close | 42 | 5.6% / 17.7% | 13.8% / 15.9% | -1.6% | +0.01 [-0.29, +0.38] | 151.0% | -7.3% | -0.12 [-0.25, +1.30] | -0.33 [-1.23, -0.16] |
| 12:30 | 15 | 4 | - / - | - / - | - | - | - | - | - | - |
| 12:30 | 30 | 4 | - / - | - / - | - | - | - | - | - | - |
| 12:30 | 60 | 4 | - / - | - / - | - | - | - | - | - | - |
| 12:30 | close | 4 | - / - | - / - | - | - | - | - | - | - |
| 13:00 | 15 | 4 | - / - | - / - | - | - | - | - | - | - |
| 13:00 | 30 | 4 | - / - | - / - | - | - | - | - | - | - |
| 13:00 | 60 | 4 | - / - | - / - | - | - | - | - | - | - |
| 13:00 | close | 4 | - / - | - / - | - | - | - | - | - | - |
| 13:30 | 15 | 5 | - / - | - / - | - | - | - | - | - | - |
| 13:30 | 30 | 5 | - / - | - / - | - | - | - | - | - | - |
| 13:30 | 60 | 5 | - / - | - / - | - | - | - | - | - | - |
| 13:30 | close | 5 | - / - | - / - | - | - | - | - | - | - |
| 14:00 | 15 | 42 | 9.0% / 9.7% | 6.5% / 6.8% | -9.2% | +0.19 [+0.12, +0.29] | 48.2% | -6.1% | +0.32 [-0.09, +6.62] | -1.20 [-4.76, -0.92] |
| 14:00 | 30 | 42 | 9.0% / 10.2% | 6.7% / 7.7% | -9.4% | +0.13 [+0.01, +0.23] | 72.1% | -7.0% | -0.04 [-0.35, +4.12] | -0.90 [-2.52, -0.68] |
| 14:00 | 60 | 42 | 9.4% / 11.0% | 7.9% / 8.9% | -6.3% | +0.06 [-0.10, +0.21] | 103.1% | -6.0% | -0.33 [-0.46, +4.79] | -0.65 [-2.73, -0.54] |
| 14:00 | close | 42 | 6.3% / 20.6% | 15.3% / 18.2% | -20.2% | +0.16 [-0.13, +0.52] | 122.7% | -17.7% | -0.08 [-0.18, +0.18] | -0.29 [-0.41, -0.18] |
| 14:30 | 15 | 3 | - / - | - / - | - | - | - | - | - | - |
| 14:30 | 30 | 3 | - / - | - / - | - | - | - | - | - | - |
| 14:30 | 60 | 3 | - / - | - / - | - | - | - | - | - | - |
| 14:30 | close | 3 | - / - | - / - | - | - | - | - | - | - |
| 15:00 | 15 | 7 | - / - | - / - | - | - | - | - | - | - |
| 15:00 | 30 | 7 | - / - | - / - | - | - | - | - | - | - |
| 15:00 | 60 | 7 | - / - | - / - | - | - | - | - | - | - |
| 15:00 | close | 7 | - / - | - / - | - | - | - | - | - | - |
| 15:30 | 15 | 5 | - / - | - / - | - | - | - | - | - | - |
| 15:30 | 30 | 5 | - / - | - / - | - | - | - | - | - | - |
| 15:30 | 60 | 5 | - / - | - / - | - | - | - | - | - | - |
| 15:30 | close | 5 | - / - | - / - | - | - | - | - | - | - |
| all | 15 | 175 | 8.3% / 9.6% | 5.9% / 6.9% | -12.6% | +0.34 [+0.29, +0.41] | 36.9% | -8.2% | +8.85 [+1.49, +106.81] | -2.71 [-11.69, -1.32] |
| all | 30 | 175 | 8.2% / 10.7% | 6.1% / 7.7% | -10.8% | +0.18 [+0.10, +0.28] | 58.9% | -7.9% | +1.39 [+0.40, +7.12] | -1.29 [-2.53, -0.82] |
| all | 60 | 175 | 8.0% / 9.5% | 6.2% / 7.3% | -13.2% | +0.18 [+0.10, +0.26] | 73.7% | -9.0% | +0.52 [-0.09, +7.04] | -0.74 [-3.57, -0.49] |
| all | close | 175 | 6.4% / 19.4% | 14.5% / 16.9% | -17.1% | +0.13 [-0.12, +0.45] | 134.4% | -16.6% | -0.09 [-0.19, +0.40] | -0.31 [-0.54, -0.19] |

## Summary: pooled over buckets

| root | h | cost 0.30d median | cost straddle median | hurdle E[za] | hurdle E[V]-1 long | E[V]-1 short below |
|---|---|---:|---:|---:|---:|---:|
| SPXW | 15 | 8.3% | 5.9% | +0.34 [+0.29, +0.41] | +8.85 [+1.49, +106.81] | -2.71 [-11.69, -1.32] |
| SPXW | 30 | 8.2% | 6.1% | +0.18 [+0.10, +0.28] | +1.39 [+0.40, +7.12] | -1.29 [-2.53, -0.82] |
| SPXW | 60 | 8.0% | 6.2% | +0.18 [+0.10, +0.26] | +0.52 [-0.09, +7.04] | -0.74 [-3.57, -0.49] |
| SPXW | close | 6.4% | 14.5% | +0.13 [-0.12, +0.45] | -0.09 [-0.19, +0.40] | -0.31 [-0.54, -0.19] |
