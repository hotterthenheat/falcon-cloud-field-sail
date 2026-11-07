# EDGE0DTE baselines (PROTOCOL section 6, reporting set of section 8)

Contract rule (all option baselines): same-day expiry, 0.30-delta (|delta| nearest 0.30 within [0.15, 0.50], Black-76
on the board mid at t), ATM straddle = strike nearest the parity forward. Unconditional baselines enter at 10:00, 12:00
and 14:00 (14:00 dropped on 13:00-close days); signal baselines at their decision time. Headline exits: the 60-minute
time stop and the close (15:58 decision); the 15- and 30-minute stops are in the sensitivity grid.
Fills: ask in / bid out at the first valid 1-second NBBO >= decision + 2 s, $0.65/contract/side/leg (lib.fills).

  no-trade         0 every session
  long call        0.30-delta call, every time
  long put         0.30-delta put, every time
  ATM straddle     ATM call + put, every time
  random side      call or put by coin flip per (session, time); 1,000 shuffles (seed 0..999); the full report is for
                   shuffle 0 and the shuffle distribution of expectancy / win / PF is given
  underlying B&H   long the underlying from S(t) to S(exit decision) (SPX index return for SPXW, no cost, labelled;
                   ETF share return, no cost), $1,000 notional per trade
  EMA 9/21         5-minute EMA9/EMA21 crossover -> 0.30-delta call (up) / put (down) at the cross (foundation/signals.py)
  ORB-30           first 5-minute close beyond the 09:30-10:00 range -> 0.30-delta call / put
  (EMA and ORB are also reported as underlying trades in the signal direction.)

Equity convention: each trade risks $1,000 of premium (fractional lots), P&L$ = ret * 1000; equity starts at $25,000;
max drawdown on that equity path (trades in time order); total return = sum P&L / 25,000; costs paid = (half-spreads in
and out + fees) at that scale. Sharpe per trade = mean/sd of ret; daily Sharpe = mean/sd of daily P&L over all
expiry sessions of the split (no-trade days = 0) * sqrt(252). Win = net ret > 0. $/lot = mean net P&L of one lot.
Significance: p = day-clustered bootstrap (2,000) two-sided p of mean net return != 0; FDR q: baselines are NOT in
the Stage-1 FDR family (REGISTRY "Counting"), so q is not applicable; DSR = deflated Sharpe (Bailey & Lopez de Prado)
of the per-trade Sharpe against the expected maximum of N unskilled trials, N = the ledger's prior trial count (1,305,
PROTOCOL.md) + the baseline runs of this file, trial-Sharpe variance = variance of the per-trade Sharpe across these
baseline runs.
Regimes (fixed ex ante): GEX sign = total GEX at 09:45 (MODEL, same-day OI); VIX tercile = VIX at 09:45 vs the
DISCOVERY terciles of that series; trend/flat = |ln(S(09:45) / prior close)| > 0.5 * IV_atm(09:45) * sqrt(1/252)
("trend") else "flat" (the open's displacement relative to the board's one-day move).

Data period: DISCOVERY = expiry sessions 2020-02-18 .. 2023-12-31, CALIBRATION = 2024 (each reported separately; CALIBRATION is the out-of-sample check of DISCOVERY; HOLDOUT 2025 and LOCKED 2026 are not touched). Labels: fills, bars, board OBS; returns, signals, Sharpe, drawdown CALC; GEX regime MODEL. Deflated Sharpe trial count N = 1341, trial-Sharpe variance 0.00355.

## Hypotheses and mechanisms (all baselines are expected to lose after costs; they are references, not candidates)

- **no-trade**: the zero line: any candidate must beat doing nothing after costs
- **long call 0.30d**: unconditional long 0DTE call: pays only if upside moves beat the implied move plus costs (drift + variance premium + spread)
- **long put 0.30d**: unconditional long 0DTE put: crash-protection demand makes puts rich; pays only if downside beats implied + costs
- **ATM straddle**: unconditional long gamma: pays when realized variance beats implied (V > 1) by more than the round-trip cost
- **random side (shuffle 0)**: direction by coin flip: the no-information reference a directional signal must beat
- **underlying B&H (no cost)**: equity drift over the same windows (index / ETF), no option, no cost: the underlying reference
- **EMA option 0.30d**: trend following: 5-min EMA9/21 cross = persistent order imbalance; bought as a 0.30-delta option
- **EMA underlying (no cost)**: the same EMA9/21 signal traded in the underlying, no cost
- **ORB option 0.30d**: opening-range breakout: late information / order splitting continues past the 30-min range
- **ORB underlying (no cost)**: the same ORB-30 signal traded in the underlying, no cost

## Headline

Expectancy = mean net return per trade as % of premium (underlying rows: % of notional), day-clustered bootstrap 95% CI (2,000 resamples). PF = profit factor. Max DD on the $25,000 / $1,000-per-trade equity path (drawdown % is of the running peak; above 100% means the $25,000 account would have been ruined; the path is continued for comparison). q (FDR): n/a, baselines are outside the FDR family. $/lot is "-" for underlying rows (no option lot).

### DISCOVERY

| root | baseline | exit | sessions | trades | skips | win | avg win | avg loss | expectancy [95%] | p | $/lot | PF | Sharpe/trade | Sharpe daily | DSR | max DD $ (%) | total return | costs $ | exp @ $1.30 fee | exp @ +1 tick |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SPXW | no-trade | 60 | 770 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | 60 | 770 | 2301 | 0 | 35.0% | +74.1% | -50.8% | -7.1% [-10.0%, -3.9%] | 0.001 | -42.9 | 0.79 | -0.091 | -2.55 | 0.000 | 168,453 (618%) | -653% | 144,533 | -7.4% | -10.9% |
| SPXW | long put 0.30d | 60 | 770 | 2302 | 0 | 29.3% | +90.4% | -52.5% | -10.6% [-14.4%, -6.8%] | 0.001 | -57.1 | 0.71 | -0.110 | -3.13 | 0.000 | 263,300 (1040%) | -980% | 141,541 | -11.0% | -14.1% |
| SPXW | ATM straddle | 60 | 770 | 2302 | 0 | 25.8% | +22.2% | -15.8% | -6.0% [-7.0%, -4.9%] | 0.001 | -138.3 | 0.49 | -0.241 | -6.49 | 0.000 | 141,945 (562%) | -553% | 108,737 | -6.2% | -8.2% |
| SPXW | random side (shuffle 0) | 60 | 770 | 2301 | 0 | 33.4% | +85.9% | -51.2% | -5.4% [-9.2%, -1.4%] | 0.009 | -37.6 | 0.84 | -0.057 | -1.57 | 0.000 | 173,396 (658%) | -497% | 143,345 | -5.7% | -9.1% |
| SPXW | underlying B&H (no cost) | 60 | 770 | 2300 | 0 | 53.4% | +0.239% | -0.259% | +0.007% [-0.006%, +0.021%] | 0.325 | - | 1.06 | +0.019 | +0.56 | 0.000 | 160 (1%) | +0.649% | 0 | - | - |
| SPXW | EMA option 0.30d | 60 | 770 | 2001 | 6 | 31.2% | +111.4% | -59.0% | -5.8% [-11.0%, -0.102%] | 0.040 | -25.4 | 0.86 | -0.048 | -1.16 | 0.000 | 137,871 (517%) | -468% | 138,237 | -6.2% | -9.7% |
| SPXW | EMA underlying (no cost) | 60 | 770 | 2007 | 0 | 51.9% | +0.254% | -0.255% | +0.009% [-0.006%, +0.024%] | 0.242 | - | 1.07 | +0.022 | +0.67 | 0.000 | 113 (0%) | +0.711% | 0 | - | - |
| SPXW | ORB option 0.30d | 60 | 770 | 751 | 2 | 36.6% | +81.0% | -47.7% | -0.556% [-6.7%, +5.7%] | 0.830 | -27.0 | 0.98 | -0.006 | -0.10 | 0.000 | 18,884 (70%) | -17% | 33,131 | -0.826% | -4.0% |
| SPXW | ORB underlying (no cost) | 60 | 770 | 753 | 0 | 53.9% | +0.255% | -0.285% | +0.006% [-0.021%, +0.031%] | 0.659 | - | 1.05 | +0.016 | +0.26 | 0.000 | 113 (0%) | +0.185% | 0 | - | - |
| SPXW | no-trade | close | 770 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | close | 770 | 2301 | 0 | 23.4% | +242.3% | -91.8% | -13.5% [-23.8%, -3.1%] | 0.016 | -62.8 | 0.81 | -0.077 | -1.45 | 0.000 | 336,414 (1028%) | -1243% | 280,889 | -13.8% | -16.2% |
| SPXW | long put 0.30d | close | 770 | 2302 | 0 | 18.5% | +331.6% | -93.5% | -15.0% [-29.2%, -0.075%] | 0.050 | -109.1 | 0.80 | -0.065 | -1.16 | 0.000 | 404,013 (1616%) | -1385% | 250,708 | -15.3% | -17.5% |
| SPXW | ATM straddle | close | 770 | 2302 | 0 | 33.8% | +69.2% | -52.6% | -11.5% [-15.9%, -6.9%] | 0.001 | -257.2 | 0.67 | -0.153 | -2.88 | 0.000 | 278,190 (1113%) | -1060% | 228,905 | -11.6% | -13.2% |
| SPXW | random side (shuffle 0) | close | 770 | 2301 | 0 | 22.0% | +295.8% | -92.5% | -6.9% [-18.5%, +5.6%] | 0.255 | -75.4 | 0.90 | -0.031 | -0.65 | 0.000 | 242,066 (960%) | -636% | 281,948 | -7.2% | -9.8% |
| SPXW | underlying B&H (no cost) | close | 770 | 2301 | 0 | 54.1% | +0.488% | -0.534% | +0.018% [-0.029%, +0.067%] | 0.443 | - | 1.07 | +0.024 | +0.43 | 0.000 | 290 (1%) | +2% | 0 | - | - |
| SPXW | EMA option 0.30d | close | 770 | 2001 | 6 | 21.7% | +291.6% | -92.1% | -8.9% [-19.4%, +2.6%] | 0.119 | -50.2 | 0.88 | -0.039 | -0.89 | 0.000 | 229,827 (919%) | -709% | 234,087 | -9.2% | -11.9% |
| SPXW | EMA underlying (no cost) | close | 770 | 2007 | 0 | 50.0% | +0.461% | -0.438% | +0.012% [-0.004%, +0.028%] | 0.141 | - | 1.05 | +0.016 | +0.84 | 0.000 | 141 (1%) | +0.929% | 0 | - | - |
| SPXW | ORB option 0.30d | close | 770 | 750 | 3 | 23.2% | +284.6% | -92.1% | -4.7% [-18.5%, +9.3%] | 0.512 | -66.7 | 0.93 | -0.024 | -0.37 | 0.000 | 70,862 (283%) | -141% | 74,821 | -4.9% | -7.3% |
| SPXW | ORB underlying (no cost) | close | 770 | 753 | 0 | 53.9% | +0.562% | -0.646% | +0.005% [-0.058%, +0.066%] | 0.873 | - | 1.02 | +0.006 | +0.10 | 0.000 | 387 (2%) | +0.160% | 0 | - | - |

### CALIBRATION

| root | baseline | exit | sessions | trades | skips | win | avg win | avg loss | expectancy [95%] | p | $/lot | PF | Sharpe/trade | Sharpe daily | DSR | max DD $ (%) | total return | costs $ | exp @ $1.30 fee | exp @ +1 tick |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SPXW | no-trade | 60 | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | 60 | 252 | 752 | 0 | 32.2% | +86.1% | -52.6% | -8.0% [-14.2%, -1.1%] | 0.020 | -36.2 | 0.78 | -0.090 | -2.38 | 0.000 | 82,429 (211%) | -241% | 30,780 | -8.4% | -11.9% |
| SPXW | long put 0.30d | 60 | 252 | 753 | 0 | 29.9% | +110.0% | -51.1% | -2.9% [-10.1%, +4.7%] | 0.441 | -8.4 | 0.92 | -0.027 | -0.75 | 0.000 | 34,950 (124%) | -89% | 30,652 | -3.3% | -6.7% |
| SPXW | ATM straddle | 60 | 252 | 753 | 0 | 31.2% | +25.4% | -16.6% | -3.5% [-5.4%, -1.4%] | 0.002 | -69.7 | 0.69 | -0.115 | -3.28 | 0.000 | 31,476 (117%) | -106% | 23,028 | -3.7% | -5.8% |
| SPXW | random side (shuffle 0) | 60 | 252 | 752 | 0 | 30.7% | +94.0% | -52.7% | -7.6% [-14.4%, -1.1%] | 0.019 | -30.0 | 0.79 | -0.083 | -2.19 | 0.000 | 57,377 (230%) | -229% | 30,166 | -8.0% | -11.4% |
| SPXW | underlying B&H (no cost) | 60 | 252 | 751 | 0 | 53.0% | +0.155% | -0.188% | -0.006% [-0.024%, +0.011%] | 0.514 | - | 0.93 | -0.025 | -0.66 | 0.000 | 98 (0%) | -0.181% | 0 | - | - |
| SPXW | EMA option 0.30d | 60 | 252 | 669 | 5 | 29.3% | +121.5% | -60.7% | -7.3% [-16.0%, +3.3%] | 0.164 | -16.4 | 0.83 | -0.054 | -1.39 | 0.000 | 68,875 (153%) | -195% | 28,777 | -7.7% | -11.3% |
| SPXW | EMA underlying (no cost) | 60 | 252 | 674 | 0 | 48.8% | +0.168% | -0.148% | +0.006% [-0.007%, +0.020%] | 0.381 | - | 1.08 | +0.027 | +0.87 | 0.000 | 27 (0%) | +0.162% | 0 | - | - |
| SPXW | ORB option 0.30d | 60 | 252 | 248 | 3 | 37.9% | +80.0% | -48.2% | +0.421% [-9.8%, +11.1%] | 0.955 | +9.8 | 1.01 | +0.005 | +0.08 | 0.001 | 10,705 (43%) | +4% | 7,297 | +0.141% | -3.2% |
| SPXW | ORB underlying (no cost) | 60 | 252 | 250 | 0 | 51.2% | +0.195% | -0.181% | +0.011% [-0.022%, +0.044%] | 0.483 | - | 1.13 | +0.043 | +0.68 | 0.007 | 35 (0%) | +0.112% | 0 | - | - |
| SPXW | no-trade | close | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | close | 252 | 752 | 0 | 22.9% | +306.4% | -93.2% | -1.8% [-24.1%, +22.6%] | 0.858 | -46.7 | 0.97 | -0.008 | -0.15 | 0.000 | 106,126 (99%) | -54% | 46,292 | -2.1% | -5.0% |
| SPXW | long put 0.30d | close | 252 | 753 | 0 | 19.9% | +366.8% | -95.5% | -3.4% [-30.4%, +30.2%] | 0.758 | -10.0 | 0.96 | -0.012 | -0.22 | 0.000 | 110,737 (284%) | -102% | 42,326 | -3.6% | -6.2% |
| SPXW | ATM straddle | close | 252 | 753 | 0 | 36.3% | +82.3% | -54.1% | -4.7% [-14.1%, +6.3%] | 0.350 | -131.8 | 0.86 | -0.051 | -0.94 | 0.000 | 56,523 (189%) | -140% | 34,454 | -4.8% | -6.6% |
| SPXW | random side (shuffle 0) | close | 252 | 752 | 0 | 22.1% | +332.7% | -95.3% | -0.858% [-22.5%, +22.6%] | 0.901 | -35.2 | 0.99 | -0.003 | -0.08 | 0.000 | 86,110 (145%) | -26% | 43,576 | -1.1% | -3.9% |
| SPXW | underlying B&H (no cost) | close | 252 | 752 | 0 | 52.5% | +0.302% | -0.346% | -0.006% [-0.061%, +0.043%] | 0.843 | - | 0.97 | -0.012 | -0.21 | 0.000 | 231 (1%) | -0.168% | 0 | - | - |
| SPXW | EMA option 0.30d | close | 252 | 669 | 5 | 20.9% | +334.2% | -93.3% | -3.9% [-25.4%, +20.0%] | 0.734 | -6.7 | 0.95 | -0.014 | -0.32 | 0.000 | 82,064 (190%) | -103% | 40,012 | -4.2% | -7.0% |
| SPXW | EMA underlying (no cost) | close | 252 | 674 | 0 | 48.2% | +0.298% | -0.267% | +0.005% [-0.012%, +0.027%] | 0.630 | - | 1.04 | +0.013 | +0.54 | 0.000 | 49 (0%) | +0.142% | 0 | - | - |
| SPXW | ORB option 0.30d | close | 252 | 247 | 4 | 25.1% | +330.5% | -93.8% | +12.7% [-17.7%, +50.8%] | 0.440 | -2.9 | 1.18 | +0.049 | +0.76 | 0.004 | 22,466 (47%) | +125% | 12,027 | +12.5% | +9.5% |
| SPXW | ORB underlying (no cost) | close | 252 | 251 | 0 | 50.6% | +0.401% | -0.404% | +0.004% [-0.063%, +0.072%] | 0.908 | - | 1.02 | +0.006 | +0.10 | 0.001 | 58 (0%) | +0.036% | 0 | - | - |

## Out-of-sample: DISCOVERY vs CALIBRATION expectancy (same rule, same costs)

| root | baseline | exit | DISCOVERY [95%] | CALIBRATION [95%] | same sign |
|---|---|---|---:|---:|---|
| SPXW | long call 0.30d | 60 | -7.1% [-10.0%, -3.9%] | -8.0% [-14.2%, -1.1%] | yes |
| SPXW | long put 0.30d | 60 | -10.6% [-14.4%, -6.8%] | -2.9% [-10.1%, +4.7%] | yes |
| SPXW | ATM straddle | 60 | -6.0% [-7.0%, -4.9%] | -3.5% [-5.4%, -1.4%] | yes |
| SPXW | random side (shuffle 0) | 60 | -5.4% [-9.2%, -1.4%] | -7.6% [-14.4%, -1.1%] | yes |
| SPXW | underlying B&H (no cost) | 60 | +0.007% [-0.006%, +0.021%] | -0.006% [-0.024%, +0.011%] | no |
| SPXW | EMA option 0.30d | 60 | -5.8% [-11.0%, -0.102%] | -7.3% [-16.0%, +3.3%] | yes |
| SPXW | EMA underlying (no cost) | 60 | +0.009% [-0.006%, +0.024%] | +0.006% [-0.007%, +0.020%] | yes |
| SPXW | ORB option 0.30d | 60 | -0.556% [-6.7%, +5.7%] | +0.421% [-9.8%, +11.1%] | no |
| SPXW | ORB underlying (no cost) | 60 | +0.006% [-0.021%, +0.031%] | +0.011% [-0.022%, +0.044%] | yes |
| SPXW | long call 0.30d | close | -13.5% [-23.8%, -3.1%] | -1.8% [-24.1%, +22.6%] | yes |
| SPXW | long put 0.30d | close | -15.0% [-29.2%, -0.075%] | -3.4% [-30.4%, +30.2%] | yes |
| SPXW | ATM straddle | close | -11.5% [-15.9%, -6.9%] | -4.7% [-14.1%, +6.3%] | yes |
| SPXW | random side (shuffle 0) | close | -6.9% [-18.5%, +5.6%] | -0.858% [-22.5%, +22.6%] | yes |
| SPXW | underlying B&H (no cost) | close | +0.018% [-0.029%, +0.067%] | -0.006% [-0.061%, +0.043%] | no |
| SPXW | EMA option 0.30d | close | -8.9% [-19.4%, +2.6%] | -3.9% [-25.4%, +20.0%] | yes |
| SPXW | EMA underlying (no cost) | close | +0.012% [-0.004%, +0.028%] | +0.005% [-0.012%, +0.027%] | yes |
| SPXW | ORB option 0.30d | close | -4.7% [-18.5%, +9.3%] | +12.7% [-17.7%, +50.8%] | no |
| SPXW | ORB underlying (no cost) | close | +0.005% [-0.058%, +0.066%] | +0.004% [-0.063%, +0.072%] | yes |

## Random side: 1,000 shuffles

| root | split | exit | mean expectancy | 2.5% .. 97.5% of shuffles | mean win | mean PF |
|---|---|---|---:|---:|---:|---:|
| SPXW | DISCOVERY | 60 | -8.9% | -12.0% .. -5.6% | 32.1% | 0.75 |
| SPXW | DISCOVERY | close | -14.2% | -20.6% .. -7.7% | 21.0% | 0.81 |
| SPXW | CALIBRATION | 60 | -5.4% | -11.5% .. +0.841% | 31.1% | 0.85 |
| SPXW | CALIBRATION | close | -2.6% | -16.3% .. +10.6% | 21.3% | 0.97 |

## Parameter sensitivity grid (mean net expectancy per trade; exit horizon x cost assumption)

Rows: every baseline x exit (15, 30, 60 min time stop, close). Columns: mid-to-mid (no spread, no fee: the gross information), ask/bid without fee, $0.65 fee (base), $1.30 fee, +1 tick each side.

| root | split | baseline | exit | n | mid-to-mid | ask/bid no fee | net $0.65 | net $1.30 | net +1 tick |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| SPXW | CALIBRATION | ATM straddle | 15 | 753 | +0.343% | -2.3% | -2.5% | -2.6% | -4.9% |
| SPXW | CALIBRATION | ATM straddle | 30 | 753 | -0.019% | -2.8% | -2.9% | -3.1% | -5.3% |
| SPXW | CALIBRATION | ATM straddle | 60 | 753 | -0.419% | -3.4% | -3.5% | -3.7% | -5.8% |
| SPXW | CALIBRATION | ATM straddle | close | 753 | -0.017% | -4.5% | -4.7% | -4.8% | -6.6% |
| SPXW | CALIBRATION | EMA option 0.30d | 15 | 669 | -5.0% | -8.4% | -8.8% | -9.2% | -13.0% |
| SPXW | CALIBRATION | EMA option 0.30d | 30 | 669 | -6.2% | -9.6% | -10.0% | -10.4% | -14.1% |
| SPXW | CALIBRATION | EMA option 0.30d | 60 | 669 | -3.1% | -6.9% | -7.3% | -7.7% | -11.3% |
| SPXW | CALIBRATION | EMA option 0.30d | close | 669 | +2.1% | -3.6% | -3.9% | -4.2% | -7.0% |
| SPXW | CALIBRATION | EMA underlying (no cost) | 15 | 674 | - | - | -0.009% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | 30 | 674 | - | - | -0.003% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | 60 | 674 | - | - | +0.006% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | close | 674 | - | - | +0.005% | - | - |
| SPXW | CALIBRATION | ORB option 0.30d | 15 | 248 | -1.1% | -3.8% | -4.1% | -4.4% | -7.8% |
| SPXW | CALIBRATION | ORB option 0.30d | 30 | 248 | +2.5% | -0.351% | -0.631% | -0.911% | -4.4% |
| SPXW | CALIBRATION | ORB option 0.30d | 60 | 248 | +3.4% | +0.700% | +0.421% | +0.141% | -3.2% |
| SPXW | CALIBRATION | ORB option 0.30d | close | 247 | +18.1% | +12.9% | +12.7% | +12.5% | +9.5% |
| SPXW | CALIBRATION | ORB underlying (no cost) | 15 | 251 | - | - | -0.002% | - | - |
| SPXW | CALIBRATION | ORB underlying (no cost) | 30 | 250 | - | - | +0.008% | - | - |
| SPXW | CALIBRATION | ORB underlying (no cost) | 60 | 250 | - | - | +0.011% | - | - |
| SPXW | CALIBRATION | ORB underlying (no cost) | close | 251 | - | - | +0.004% | - | - |
| SPXW | CALIBRATION | long call 0.30d | 15 | 752 | -5.5% | -9.0% | -9.3% | -9.7% | -13.3% |
| SPXW | CALIBRATION | long call 0.30d | 30 | 752 | -3.9% | -7.4% | -7.8% | -8.1% | -11.7% |
| SPXW | CALIBRATION | long call 0.30d | 60 | 752 | -4.1% | -7.6% | -8.0% | -8.4% | -11.9% |
| SPXW | CALIBRATION | long call 0.30d | close | 752 | +4.4% | -1.5% | -1.8% | -2.1% | -5.0% |
| SPXW | CALIBRATION | long put 0.30d | 15 | 753 | +6.0% | +2.0% | +1.7% | +1.4% | -2.4% |
| SPXW | CALIBRATION | long put 0.30d | 30 | 753 | +2.8% | -0.979% | -1.3% | -1.6% | -5.2% |
| SPXW | CALIBRATION | long put 0.30d | 60 | 753 | +1.4% | -2.6% | -2.9% | -3.3% | -6.7% |
| SPXW | CALIBRATION | long put 0.30d | close | 753 | +2.5% | -3.2% | -3.4% | -3.6% | -6.2% |
| SPXW | CALIBRATION | random side (shuffle 0) | 15 | 752 | -2.9% | -6.4% | -6.7% | -7.1% | -10.7% |
| SPXW | CALIBRATION | random side (shuffle 0) | 30 | 752 | -3.0% | -6.5% | -6.8% | -7.2% | -10.7% |
| SPXW | CALIBRATION | random side (shuffle 0) | 60 | 752 | -3.8% | -7.3% | -7.6% | -8.0% | -11.4% |
| SPXW | CALIBRATION | random side (shuffle 0) | close | 752 | +4.7% | -0.603% | -0.858% | -1.1% | -3.9% |
| SPXW | CALIBRATION | underlying B&H (no cost) | 15 | 752 | - | - | -0.013% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | 30 | 752 | - | - | -0.006% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | 60 | 751 | - | - | -0.006% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | close | 752 | - | - | -0.006% | - | - |
| SPXW | DISCOVERY | ATM straddle | 15 | 2302 | -0.346% | -4.6% | -4.7% | -4.9% | -7.0% |
| SPXW | DISCOVERY | ATM straddle | 30 | 2302 | -0.364% | -4.7% | -4.9% | -5.1% | -7.1% |
| SPXW | DISCOVERY | ATM straddle | 60 | 2302 | -1.3% | -5.9% | -6.0% | -6.2% | -8.2% |
| SPXW | DISCOVERY | ATM straddle | close | 2302 | -1.6% | -11.4% | -11.5% | -11.6% | -13.2% |
| SPXW | DISCOVERY | EMA option 0.30d | 15 | 2002 | -0.924% | -6.1% | -6.5% | -6.9% | -10.6% |
| SPXW | DISCOVERY | EMA option 0.30d | 30 | 2002 | -1.5% | -7.1% | -7.5% | -7.9% | -11.5% |
| SPXW | DISCOVERY | EMA option 0.30d | 60 | 2001 | +1.2% | -5.5% | -5.8% | -6.2% | -9.7% |
| SPXW | DISCOVERY | EMA option 0.30d | close | 2001 | +3.0% | -8.6% | -8.9% | -9.2% | -11.9% |
| SPXW | DISCOVERY | EMA underlying (no cost) | 15 | 2007 | - | - | -0.002% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | 30 | 2007 | - | - | -0.002% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | 60 | 2007 | - | - | +0.009% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | close | 2007 | - | - | +0.012% | - | - |
| SPXW | DISCOVERY | ORB option 0.30d | 15 | 751 | -0.630% | -4.8% | -5.1% | -5.4% | -8.5% |
| SPXW | DISCOVERY | ORB option 0.30d | 30 | 751 | -0.188% | -4.3% | -4.6% | -4.9% | -8.0% |
| SPXW | DISCOVERY | ORB option 0.30d | 60 | 751 | +4.0% | -0.285% | -0.556% | -0.826% | -4.0% |
| SPXW | DISCOVERY | ORB option 0.30d | close | 750 | +5.4% | -4.5% | -4.7% | -4.9% | -7.3% |
| SPXW | DISCOVERY | ORB underlying (no cost) | 15 | 753 | - | - | +0.001% | - | - |
| SPXW | DISCOVERY | ORB underlying (no cost) | 30 | 753 | - | - | +0.000% | - | - |
| SPXW | DISCOVERY | ORB underlying (no cost) | 60 | 753 | - | - | +0.006% | - | - |
| SPXW | DISCOVERY | ORB underlying (no cost) | close | 753 | - | - | +0.005% | - | - |
| SPXW | DISCOVERY | long call 0.30d | 15 | 2301 | -2.3% | -8.0% | -8.3% | -8.7% | -12.2% |
| SPXW | DISCOVERY | long call 0.30d | 30 | 2301 | -1.1% | -6.9% | -7.2% | -7.6% | -11.1% |
| SPXW | DISCOVERY | long call 0.30d | 60 | 2301 | -0.725% | -6.7% | -7.1% | -7.4% | -10.9% |
| SPXW | DISCOVERY | long call 0.30d | close | 2301 | -1.2% | -13.2% | -13.5% | -13.8% | -16.2% |
| SPXW | DISCOVERY | long put 0.30d | 15 | 2302 | +0.832% | -4.9% | -5.2% | -5.5% | -8.9% |
| SPXW | DISCOVERY | long put 0.30d | 30 | 2302 | -0.799% | -6.6% | -6.9% | -7.2% | -10.5% |
| SPXW | DISCOVERY | long put 0.30d | 60 | 2302 | -4.7% | -10.3% | -10.6% | -11.0% | -14.1% |
| SPXW | DISCOVERY | long put 0.30d | close | 2302 | -4.6% | -14.8% | -15.0% | -15.3% | -17.5% |
| SPXW | DISCOVERY | random side (shuffle 0) | 15 | 2301 | +0.409% | -5.4% | -5.8% | -6.1% | -9.5% |
| SPXW | DISCOVERY | random side (shuffle 0) | 30 | 2301 | +1.4% | -4.5% | -4.9% | -5.2% | -8.6% |
| SPXW | DISCOVERY | random side (shuffle 0) | 60 | 2301 | +0.990% | -5.1% | -5.4% | -5.7% | -9.1% |
| SPXW | DISCOVERY | random side (shuffle 0) | close | 2301 | +5.5% | -6.7% | -6.9% | -7.2% | -9.8% |
| SPXW | DISCOVERY | underlying B&H (no cost) | 15 | 2301 | - | - | -0.009% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | 30 | 2301 | - | - | -0.003% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | 60 | 2300 | - | - | +0.007% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | close | 2301 | - | - | +0.018% | - | - |

## Breakdowns (expectancy [95% CI], trades, win)

### SPXW DISCOVERY long call 0.30d exit 60

- year: 2020: -6.2% [-12.4%, +0.892%] n=420 win 37%; 2021: -6.0% [-11.9%, -0.138%] n=476 win 35%; 2022: -11.8% [-17.5%, -5.6%] n=657 win 33%; 2023: -4.1% [-10.3%, +1.8%] n=748 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -10.1% [-14.6%, -5.4%] n=1012 win 33%; GEX>0: -4.8% [-9.0%, -0.552%] n=1279 win 37%; n/a: -2.2% [-34.1%, +54.7%] n=10 win 50%
- VIX tercile at 09:45: VIX high: -7.2% [-12.5%, -2.1%] n=755 win 36%; VIX low: -4.0% [-9.7%, +1.5%] n=757 win 36%; VIX mid: -9.5% [-14.6%, -3.8%] n=756 win 33%; n/a: -22.3% [-35.9%, -8.6%] n=33 win 27%
- trend/flat by the open: flat: -7.8% [-12.5%, -2.6%] n=1080 win 35%; n/a: -2.2% [-34.1%, +54.7%] n=10 win 50%; trend: -6.5% [-10.6%, -2.5%] n=1211 win 35%
- time bucket: 10:00: -12.1% [-16.8%, -7.3%] n=768 win 32%; 12:00: -4.4% [-9.0%, +0.356%] n=770 win 37%; 14:00: -4.7% [-11.3%, +2.0%] n=763 win 36%

### SPXW DISCOVERY long put 0.30d exit 60

- year: 2020: -17.7% [-24.7%, -10.6%] n=420 win 25%; 2021: -18.3% [-25.2%, -11.1%] n=476 win 25%; 2022: -5.4% [-11.7%, +1.8%] n=658 win 33%; 2023: -6.4% [-14.0%, +2.4%] n=748 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -5.3% [-10.4%, +0.143%] n=1013 win 34%; GEX>0: -14.7% [-19.7%, -9.3%] n=1279 win 26%; n/a: -22.9% [-33.4%, -13.1%] n=10 win 30%
- VIX tercile at 09:45: VIX high: -11.8% [-17.0%, -6.5%] n=756 win 29%; VIX low: -9.0% [-16.6%, -0.936%] n=757 win 28%; VIX mid: -11.0% [-16.7%, -5.7%] n=756 win 31%; n/a: -11.9% [-27.0%, +5.3%] n=33 win 27%
- trend/flat by the open: flat: -11.5% [-16.9%, -4.8%] n=1080 win 29%; n/a: -22.9% [-33.4%, -13.1%] n=10 win 30%; trend: -9.8% [-14.5%, -4.3%] n=1212 win 29%
- time bucket: 10:00: -4.9% [-10.5%, +1.3%] n=768 win 32%; 12:00: -11.3% [-15.8%, -6.4%] n=770 win 31%; 14:00: -15.7% [-23.7%, -6.2%] n=764 win 25%

### SPXW DISCOVERY ATM straddle exit 60

- year: 2020: -8.7% [-10.5%, -6.8%] n=420 win 23%; 2021: -8.3% [-10.1%, -6.3%] n=476 win 22%; 2022: -5.3% [-6.7%, -3.7%] n=658 win 27%; 2023: -3.7% [-5.9%, -1.1%] n=748 win 28%
- GEX sign at 09:45 (MODEL): GEX<0: -5.2% [-6.6%, -3.7%] n=1013 win 28%; GEX>0: -6.6% [-8.1%, -5.0%] n=1279 win 24%; n/a: -9.5% [-18.6%, +7.4%] n=10 win 10%
- VIX tercile at 09:45: VIX high: -6.6% [-8.1%, -5.1%] n=756 win 27%; VIX low: -4.4% [-6.6%, -2.0%] n=757 win 27%; VIX mid: -6.8% [-8.3%, -5.3%] n=756 win 24%; n/a: -10.8% [-14.2%, -7.3%] n=33 win 18%
- trend/flat by the open: flat: -6.3% [-7.8%, -4.6%] n=1080 win 24%; n/a: -9.5% [-18.6%, +7.4%] n=10 win 10%; trend: -5.7% [-7.1%, -4.4%] n=1212 win 28%
- time bucket: 10:00: -5.7% [-7.1%, -4.3%] n=768 win 25%; 12:00: -5.3% [-6.3%, -4.2%] n=770 win 26%; 14:00: -7.0% [-9.2%, -4.3%] n=764 win 27%

### SPXW DISCOVERY random side (shuffle 0) exit 60

- year: 2020: -7.0% [-14.2%, +0.875%] n=420 win 32%; 2021: -12.6% [-19.1%, -6.1%] n=476 win 29%; 2022: -12.1% [-18.2%, -6.4%] n=657 win 32%; 2023: +5.9% [-2.5%, +15.1%] n=748 win 38%
- GEX sign at 09:45 (MODEL): GEX<0: -4.1% [-9.3%, +1.4%] n=1012 win 34%; GEX>0: -6.4% [-11.8%, -0.993%] n=1279 win 33%; n/a: -13.7% [-31.4%, -0.469%] n=10 win 40%
- VIX tercile at 09:45: VIX high: -11.9% [-17.1%, -6.6%] n=755 win 31%; VIX low: +2.1% [-5.2%, +10.1%] n=757 win 35%; VIX mid: -6.7% [-12.4%, -0.633%] n=756 win 33%; n/a: -0.063% [-18.9%, +21.0%] n=33 win 36%
- trend/flat by the open: flat: -6.1% [-12.3%, +0.402%] n=1080 win 33%; n/a: -13.7% [-31.4%, -0.469%] n=10 win 40%; trend: -4.7% [-9.5%, +0.012%] n=1211 win 33%
- time bucket: 10:00: -4.4% [-9.9%, +1.9%] n=768 win 34%; 12:00: -5.1% [-10.1%, -0.360%] n=770 win 35%; 14:00: -6.6% [-15.0%, +2.4%] n=763 win 31%

### SPXW DISCOVERY underlying B&H (no cost) exit 60

- year: 2020: +0.036% [-0.005%, +0.079%] n=419 win 56%; 2021: +0.016% [-0.005%, +0.037%] n=476 win 57%; 2022: -0.017% [-0.053%, +0.017%] n=657 win 49%; 2023: +0.007% [-0.011%, +0.024%] n=748 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.014% [-0.039%, +0.009%] n=1011 win 50%; GEX>0: +0.024% [+0.008%, +0.041%] n=1279 win 56%; n/a: +0.016% [-0.280%, +0.247%] n=10 win 50%
- VIX tercile at 09:45: VIX high: +0.012% [-0.023%, +0.045%] n=755 win 54%; VIX low: +0.007% [-0.008%, +0.021%] n=757 win 55%; VIX mid: +0.001% [-0.018%, +0.023%] n=756 win 52%; n/a: +0.025% [-0.092%, +0.143%] n=32 win 38%
- trend/flat by the open: flat: +0.011% [-0.009%, +0.032%] n=1080 win 53%; n/a: +0.016% [-0.280%, +0.247%] n=10 win 50%; trend: +0.003% [-0.017%, +0.024%] n=1210 win 54%
- time bucket: 10:00: -0.012% [-0.042%, +0.017%] n=768 win 49%; 12:00: +0.011% [-0.010%, +0.033%] n=769 win 54%; 14:00: +0.023% [-0.001%, +0.046%] n=763 win 57%

### SPXW DISCOVERY EMA option 0.30d exit 60

- year: 2020: -16.8% [-25.8%, -8.1%] n=355 win 26%; 2021: -1.6% [-13.2%, +13.0%] n=401 win 34%; 2022: -7.5% [-16.7%, +2.0%] n=589 win 32%; 2023: -1.0% [-11.4%, +11.4%] n=656 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -4.2% [-11.5%, +4.7%] n=881 win 33%; GEX>0: -6.8% [-14.1%, +1.2%] n=1112 win 29%; n/a: -60.5% [-79.4%, -52.4%] n=8 win 12%
- VIX tercile at 09:45: VIX high: -7.4% [-15.5%, +1.4%] n=663 win 32%; VIX low: -4.8% [-14.0%, +6.6%] n=673 win 32%; VIX mid: -3.5% [-12.8%, +7.0%] n=642 win 31%; n/a: -57.7% [-70.2%, -43.8%] n=23 win 9%
- trend/flat by the open: flat: -6.4% [-13.1%, +1.3%] n=1074 win 30%; n/a: -60.5% [-79.4%, -52.4%] n=8 win 12%; trend: -4.8% [-12.9%, +3.7%] n=919 win 33%
- time bucket: 09:30: -5.9% [-22.9%, +15.3%] n=86 win 33%; 10:00: -11.3% [-23.6%, +3.8%] n=116 win 33%; 10:30: +12.0% [-3.1%, +29.9%] n=139 win 38%; 11:00: -12.6% [-23.2%, -1.7%] n=150 win 31%; 11:30: -13.3% [-23.0%, -3.3%] n=154 win 34%; 12:00: -4.6% [-14.5%, +6.6%] n=166 win 36%; 12:30: +0.125% [-13.0%, +14.0%] n=164 win 36%; 13:00: -2.6% [-15.1%, +10.8%] n=179 win 34%; 13:30: +7.5% [-13.5%, +34.4%] n=200 win 32%; 14:00: +1.3% [-15.1%, +17.0%] n=200 win 33%; 14:30: -20.2% [-37.4%, -1.4%] n=206 win 24%; 15:00: -16.9% [-41.1%, +9.5%] n=210 win 19%; 15:30: -14.4% [-59.9%, +33.7%] n=31 win 29%

### SPXW DISCOVERY EMA underlying (no cost) exit 60

- year: 2020: -0.007% [-0.058%, +0.044%] n=355 win 51%; 2021: +0.018% [-0.001%, +0.040%] n=401 win 54%; 2022: +0.004% [-0.026%, +0.034%] n=590 win 50%; 2023: +0.016% [-0.001%, +0.035%] n=661 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: +0.013% [-0.011%, +0.040%] n=884 win 52%; GEX>0: +0.012% [-0.002%, +0.027%] n=1115 win 52%; n/a: -0.922% [-1.8%, -0.180%] n=8 win 25%
- VIX tercile at 09:45: VIX high: +0.020% [-0.013%, +0.054%] n=664 win 52%; VIX low: +0.011% [-0.002%, +0.024%] n=676 win 53%; VIX mid: +0.008% [-0.013%, +0.030%] n=644 win 51%; n/a: -0.346% [-0.882%, -0.015%] n=23 win 35%
- trend/flat by the open: flat: +0.003% [-0.013%, +0.019%] n=1080 win 50%; n/a: -0.922% [-1.8%, -0.180%] n=8 win 25%; trend: +0.024% [+0.000%, +0.049%] n=919 win 54%
- time bucket: 09:30: -0.054% [-0.185%, +0.060%] n=87 win 51%; 10:00: +0.001% [-0.064%, +0.075%] n=116 win 48%; 10:30: +0.054% [-0.011%, +0.119%] n=141 win 57%; 11:00: -0.006% [-0.065%, +0.054%] n=151 win 52%; 11:30: -0.013% [-0.056%, +0.027%] n=155 win 48%; 12:00: +0.001% [-0.048%, +0.053%] n=166 win 53%; 12:30: +0.037% [-0.005%, +0.084%] n=164 win 55%; 13:00: +0.002% [-0.043%, +0.050%] n=180 win 51%; 13:30: +0.024% [-0.021%, +0.068%] n=200 win 52%; 14:00: +0.018% [-0.025%, +0.061%] n=200 win 54%; 14:30: -0.042% [-0.093%, +0.005%] n=206 win 46%; 15:00: +0.051% [-0.001%, +0.113%] n=210 win 55%; 15:30: +0.021% [-0.101%, +0.132%] n=31 win 52%

### SPXW DISCOVERY ORB option 0.30d exit 60

- year: 2020: -10.5% [-21.1%, +0.723%] n=138 win 30%; 2021: +7.1% [-8.4%, +24.9%] n=153 win 35%; 2022: -4.4% [-13.3%, +5.8%] n=214 win 37%; 2023: +3.6% [-8.2%, +15.9%] n=246 win 40%
- GEX sign at 09:45 (MODEL): GEX<0: -3.0% [-11.6%, +6.5%] n=332 win 37%; GEX>0: +1.4% [-6.6%, +10.7%] n=418 win 37%; n/a: -14.3% [-14.3%, -14.3%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -2.9% [-12.6%, +7.2%] n=248 win 35%; VIX low: +8.7% [-2.8%, +21.7%] n=244 win 40%; VIX mid: -6.3% [-15.6%, +3.7%] n=250 win 35%; n/a: -26.4% [-53.2%, +6.0%] n=9 win 33%
- trend/flat by the open: flat: -4.3% [-13.4%, +4.4%] n=354 win 34%; n/a: -14.3% [-14.3%, -14.3%] n=1 win 0%; trend: +2.9% [-5.9%, +11.9%] n=396 win 39%
- time bucket: 10:00: -2.2% [-10.2%, +5.4%] n=486 win 37%; 10:30: -1.6% [-13.9%, +13.6%] n=148 win 34%; 11:00: -6.2% [-22.1%, +12.9%] n=53 win 32%; 11:30: +18.3% [-13.8%, +50.1%] n=23 win 52%; 12:00: +22.8% [-29.8%, +99.6%] n=13 win 54%; 12:30: +64.8% [-26.7%, +194.4%] n=6 win 50%; 13:00: +11.3% [-48.6%, +106.6%] n=10 win 30%; 13:30: -39.8% [-94.6%, +58.6%] n=3 win 33%; 14:00: +16.7% [-70.0%, +108.5%] n=5 win 40%; 14:30: +40.9% [-100.2%, +179.1%] n=3 win 67%; 15:00: -93.9% [-93.9%, -93.9%] n=1 win 0%

### SPXW DISCOVERY ORB underlying (no cost) exit 60

- year: 2020: -0.039% [-0.126%, +0.046%] n=138 win 48%; 2021: +0.016% [-0.037%, +0.068%] n=153 win 55%; 2022: +0.013% [-0.041%, +0.069%] n=214 win 56%; 2023: +0.019% [-0.015%, +0.055%] n=248 win 55%
- GEX sign at 09:45 (MODEL): GEX<0: -0.013% [-0.062%, +0.033%] n=332 win 54%; GEX>0: +0.021% [-0.008%, +0.051%] n=420 win 54%; n/a: +0.085% [+0.085%, +0.085%] n=1 win 100%
- VIX tercile at 09:45: VIX high: +0.007% [-0.053%, +0.070%] n=248 win 52%; VIX low: +0.026% [-0.003%, +0.054%] n=246 win 57%; VIX mid: -0.003% [-0.043%, +0.038%] n=250 win 54%; n/a: -0.316% [-0.839%, +0.041%] n=9 win 33%
- trend/flat by the open: flat: -0.015% [-0.056%, +0.025%] n=355 win 50%; n/a: +0.085% [+0.085%, +0.085%] n=1 win 100%; trend: +0.025% [-0.013%, +0.065%] n=397 win 57%
- time bucket: 10:00: +0.004% [-0.032%, +0.037%] n=488 win 54%; 10:30: -0.001% [-0.061%, +0.056%] n=148 win 51%; 11:00: -0.013% [-0.094%, +0.071%] n=53 win 55%; 11:30: +0.056% [-0.064%, +0.174%] n=23 win 65%; 12:00: +0.003% [-0.162%, +0.138%] n=13 win 54%; 12:30: +0.193% [-0.081%, +0.487%] n=6 win 67%; 13:00: +0.075% [-0.069%, +0.260%] n=10 win 60%; 13:30: -0.117% [-0.342%, +0.253%] n=3 win 33%; 14:00: +0.050% [-0.200%, +0.274%] n=5 win 60%; 14:30: +0.178% [-0.228%, +0.589%] n=3 win 67%; 15:00: -0.051% [-0.051%, -0.051%] n=1 win 0%

### SPXW DISCOVERY long call 0.30d exit close

- year: 2020: -19.4% [-39.9%, +1.5%] n=420 win 24%; 2021: -10.0% [-32.3%, +12.8%] n=476 win 26%; 2022: -15.3% [-35.3%, +5.5%] n=657 win 21%; 2023: -10.9% [-28.5%, +6.6%] n=748 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -18.2% [-33.3%, -2.8%] n=1012 win 22%; GEX>0: -9.1% [-22.6%, +5.8%] n=1279 win 25%; n/a: -97.0% [-100.0%, -90.4%] n=10 win 0%
- VIX tercile at 09:45: VIX high: -12.1% [-29.3%, +6.3%] n=755 win 24%; VIX low: -18.2% [-34.8%, +0.151%] n=757 win 22%; VIX mid: -8.7% [-26.3%, +9.7%] n=756 win 25%; n/a: -47.8% [-96.8%, +39.5%] n=33 win 15%
- trend/flat by the open: flat: -4.5% [-21.4%, +11.7%] n=1080 win 25%; n/a: -97.0% [-100.0%, -90.4%] n=10 win 0%; trend: -20.8% [-34.4%, -7.2%] n=1211 win 22%
- time bucket: 10:00: -8.9% [-21.3%, +4.4%] n=768 win 23%; 12:00: -14.0% [-25.6%, -0.478%] n=770 win 24%; 14:00: -17.6% [-29.2%, -5.2%] n=763 win 23%

### SPXW DISCOVERY long put 0.30d exit close

- year: 2020: -30.7% [-59.6%, +3.8%] n=420 win 15%; 2021: -22.8% [-49.0%, +8.0%] n=476 win 16%; 2022: -9.7% [-32.5%, +17.8%] n=658 win 21%; 2023: -6.0% [-32.3%, +25.8%] n=748 win 20%
- GEX sign at 09:45 (MODEL): GEX<0: -11.5% [-29.6%, +9.1%] n=1013 win 21%; GEX>0: -17.7% [-38.4%, +4.7%] n=1279 win 17%; n/a: -30.8% [-94.4%, +57.8%] n=10 win 20%
- VIX tercile at 09:45: VIX high: -26.6% [-46.9%, -3.2%] n=756 win 18%; VIX low: +1.7% [-26.7%, +35.7%] n=757 win 20%; VIX mid: -18.2% [-39.9%, +5.6%] n=756 win 18%; n/a: -63.3% [-92.1%, -23.4%] n=33 win 9%
- trend/flat by the open: flat: -13.6% [-34.7%, +10.7%] n=1080 win 19%; n/a: -30.8% [-94.4%, +57.8%] n=10 win 20%; trend: -16.2% [-34.7%, +4.5%] n=1212 win 18%
- time bucket: 10:00: -10.7% [-26.5%, +5.4%] n=768 win 19%; 12:00: -18.1% [-33.4%, -1.2%] n=770 win 17%; 14:00: -16.3% [-31.7%, +0.952%] n=764 win 19%

### SPXW DISCOVERY ATM straddle exit close

- year: 2020: -21.4% [-31.4%, -11.1%] n=420 win 29%; 2021: -12.7% [-21.6%, -4.1%] n=476 win 31%; 2022: -9.6% [-17.3%, -1.2%] n=658 win 36%; 2023: -6.9% [-14.8%, +1.5%] n=748 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -11.6% [-17.4%, -5.4%] n=1013 win 35%; GEX>0: -11.3% [-17.4%, -4.6%] n=1279 win 33%; n/a: -39.3% [-64.3%, -10.4%] n=10 win 20%
- VIX tercile at 09:45: VIX high: -15.0% [-21.7%, -8.0%] n=756 win 33%; VIX low: -7.3% [-15.8%, +2.0%] n=757 win 34%; VIX mid: -11.0% [-18.0%, -3.8%] n=756 win 35%; n/a: -39.9% [-60.8%, -11.0%] n=33 win 21%
- trend/flat by the open: flat: -7.9% [-15.1%, -0.911%] n=1080 win 36%; n/a: -39.3% [-64.3%, -10.4%] n=10 win 20%; trend: -14.5% [-20.3%, -8.3%] n=1212 win 32%
- time bucket: 10:00: -9.5% [-14.4%, -4.6%] n=768 win 35%; 12:00: -12.1% [-17.3%, -6.6%] n=770 win 32%; 14:00: -13.0% [-18.2%, -7.5%] n=764 win 34%

### SPXW DISCOVERY random side (shuffle 0) exit close

- year: 2020: -14.5% [-39.3%, +18.6%] n=420 win 21%; 2021: -18.6% [-37.1%, +0.963%] n=476 win 21%; 2022: -9.9% [-29.8%, +13.5%] n=657 win 21%; 2023: +7.4% [-14.4%, +33.1%] n=748 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -15.4% [-28.6%, -0.430%] n=1012 win 22%; GEX>0: +0.035% [-16.7%, +19.5%] n=1279 win 22%; n/a: -32.0% [-94.4%, +54.4%] n=10 win 20%
- VIX tercile at 09:45: VIX high: -13.4% [-30.0%, +7.4%] n=755 win 21%; VIX low: +11.8% [-12.8%, +37.4%] n=757 win 24%; VIX mid: -17.7% [-31.6%, -2.8%] n=756 win 21%; n/a: -42.4% [-74.8%, -5.2%] n=33 win 18%
- trend/flat by the open: flat: -1.7% [-18.6%, +19.6%] n=1080 win 23%; n/a: -32.0% [-94.4%, +54.4%] n=10 win 20%; trend: -11.3% [-25.3%, +5.5%] n=1211 win 21%
- time bucket: 10:00: -3.7% [-19.1%, +12.0%] n=768 win 21%; 12:00: -9.2% [-24.2%, +6.4%] n=770 win 22%; 14:00: -7.9% [-23.5%, +8.2%] n=763 win 23%

### SPXW DISCOVERY underlying B&H (no cost) exit close

- year: 2020: +0.072% [-0.090%, +0.227%] n=420 win 59%; 2021: +0.024% [-0.045%, +0.092%] n=476 win 55%; 2022: -0.016% [-0.122%, +0.086%] n=657 win 51%; 2023: +0.014% [-0.041%, +0.068%] n=748 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.007% [-0.085%, +0.073%] n=1012 win 50%; GEX>0: +0.051% [+0.002%, +0.104%] n=1279 win 57%; n/a: -1.6% [-3.3%, -0.059%] n=10 win 30%
- VIX tercile at 09:45: VIX high: +0.071% [-0.042%, +0.182%] n=755 win 56%; VIX low: -0.016% [-0.064%, +0.030%] n=757 win 54%; VIX mid: +0.021% [-0.047%, +0.091%] n=756 win 53%; n/a: -0.475% [-1.2%, +0.057%] n=33 win 42%
- trend/flat by the open: flat: +0.027% [-0.040%, +0.098%] n=1080 win 54%; n/a: -1.6% [-3.3%, -0.059%] n=10 win 30%; trend: +0.024% [-0.039%, +0.083%] n=1211 win 54%
- time bucket: 10:00: +0.023% [-0.040%, +0.091%] n=768 win 54%; 12:00: +0.013% [-0.039%, +0.067%] n=770 win 55%; 14:00: +0.019% [-0.025%, +0.060%] n=763 win 53%

### SPXW DISCOVERY EMA option 0.30d exit close

- year: 2020: -28.3% [-44.9%, -8.1%] n=355 win 21%; 2021: +2.9% [-21.3%, +29.6%] n=401 win 22%; 2022: -12.8% [-29.8%, +5.7%] n=589 win 21%; 2023: -1.9% [-22.0%, +25.2%] n=656 win 22%
- GEX sign at 09:45 (MODEL): GEX<0: -8.9% [-23.9%, +6.7%] n=881 win 22%; GEX>0: -8.3% [-23.5%, +7.3%] n=1112 win 21%; n/a: -71.0% [-100.2%, -38.7%] n=8 win 12%
- VIX tercile at 09:45: VIX high: -16.8% [-31.6%, -0.914%] n=663 win 22%; VIX low: -3.1% [-24.7%, +24.1%] n=672 win 21%; VIX mid: -4.0% [-20.0%, +15.1%] n=643 win 22%; n/a: -86.2% [-97.9%, -68.9%] n=23 win 4%
- trend/flat by the open: flat: -2.6% [-18.1%, +14.6%] n=1074 win 23%; n/a: -71.0% [-100.2%, -38.7%] n=8 win 12%; trend: -15.7% [-29.8%, -0.992%] n=919 win 20%
- time bucket: 09:30: +9.6% [-32.3%, +51.2%] n=86 win 26%; 10:00: -17.4% [-44.3%, +14.4%] n=115 win 24%; 10:30: +5.3% [-27.1%, +41.9%] n=140 win 26%; 11:00: -27.3% [-54.1%, +2.1%] n=150 win 19%; 11:30: -3.1% [-37.5%, +35.1%] n=154 win 23%; 12:00: -22.2% [-44.6%, +1.5%] n=166 win 25%; 12:30: +9.7% [-27.8%, +53.5%] n=164 win 20%; 13:00: -16.6% [-43.3%, +14.1%] n=179 win 17%; 13:30: +13.6% [-28.6%, +77.2%] n=200 win 22%; 14:00: -11.9% [-35.1%, +12.7%] n=200 win 24%; 14:30: -19.5% [-46.3%, +9.8%] n=206 win 19%; 15:00: -16.9% [-41.1%, +9.5%] n=210 win 19%; 15:30: -14.4% [-59.9%, +33.7%] n=31 win 29%

### SPXW DISCOVERY EMA underlying (no cost) exit close

- year: 2020: +0.005% [-0.038%, +0.053%] n=355 win 53%; 2021: +0.005% [-0.017%, +0.031%] n=401 win 51%; 2022: +0.016% [-0.020%, +0.056%] n=590 win 48%; 2023: +0.015% [-0.003%, +0.038%] n=661 win 50%
- GEX sign at 09:45 (MODEL): GEX<0: +0.007% [-0.018%, +0.036%] n=884 win 50%; GEX>0: +0.018% [+0.001%, +0.036%] n=1115 win 50%; n/a: -0.343% [-0.413%, -0.275%] n=8 win 38%
- VIX tercile at 09:45: VIX high: +0.019% [-0.015%, +0.056%] n=664 win 50%; VIX low: +0.010% [-0.004%, +0.026%] n=676 win 50%; VIX mid: +0.011% [-0.012%, +0.036%] n=644 win 50%; n/a: -0.128% [-0.294%, +0.033%] n=23 win 35%
- trend/flat by the open: flat: +0.003% [-0.015%, +0.023%] n=1080 win 49%; n/a: -0.343% [-0.413%, -0.275%] n=8 win 38%; trend: +0.024% [-0.000%, +0.050%] n=919 win 51%
- time bucket: 09:30: +0.135% [-0.044%, +0.320%] n=87 win 57%; 10:00: -0.004% [-0.159%, +0.139%] n=116 win 53%; 10:30: +0.003% [-0.139%, +0.144%] n=141 win 47%; 11:00: -0.071% [-0.233%, +0.084%] n=151 win 46%; 11:30: +0.020% [-0.070%, +0.111%] n=155 win 49%; 12:00: +0.019% [-0.104%, +0.155%] n=166 win 51%; 12:30: +0.095% [-0.012%, +0.199%] n=164 win 52%; 13:00: +0.002% [-0.074%, +0.086%] n=180 win 44%; 13:30: -0.028% [-0.109%, +0.056%] n=200 win 48%; 14:00: +0.030% [-0.031%, +0.093%] n=200 win 51%; 14:30: -0.057% [-0.132%, +0.008%] n=206 win 49%; 15:00: +0.051% [-0.001%, +0.113%] n=210 win 55%; 15:30: +0.021% [-0.101%, +0.132%] n=31 win 52%

### SPXW DISCOVERY ORB option 0.30d exit close

- year: 2020: -36.7% [-61.6%, -8.5%] n=138 win 14%; 2021: -9.2% [-36.1%, +22.6%] n=153 win 24%; 2022: +5.4% [-21.3%, +33.8%] n=214 win 26%; 2023: +7.3% [-17.4%, +35.4%] n=245 win 26%
- GEX sign at 09:45 (MODEL): GEX<0: -15.6% [-34.1%, +3.6%] n=331 win 23%; GEX>0: +3.9% [-17.5%, +24.2%] n=418 win 24%; n/a: -5.5% [-5.5%, -5.5%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -3.4% [-31.2%, +23.8%] n=248 win 21%; VIX low: +4.6% [-18.7%, +30.2%] n=243 win 25%; VIX mid: -14.9% [-36.6%, +8.9%] n=250 win 24%; n/a: -9.3% [-95.3%, +97.3%] n=9 win 33%
- trend/flat by the open: flat: -3.6% [-22.3%, +17.5%] n=353 win 24%; n/a: -5.5% [-5.5%, -5.5%] n=1 win 0%; trend: -5.6% [-24.4%, +15.2%] n=396 win 23%
- time bucket: 10:00: -2.1% [-18.4%, +14.4%] n=485 win 25%; 10:30: -26.1% [-50.1%, -1.7%] n=148 win 18%; 11:00: -5.2% [-54.3%, +53.8%] n=53 win 23%; 11:30: +57.3% [-54.9%, +218.1%] n=23 win 30%; 12:00: -54.6% [-94.3%, +3.7%] n=13 win 15%; 12:30: -21.2% [-99.3%, +120.6%] n=6 win 17%; 13:00: +44.6% [-99.0%, +291.0%] n=10 win 20%; 13:30: +229.2% [-100.3%, +888.0%] n=3 win 33%; 14:00: +40.5% [-76.6%, +171.8%] n=5 win 60%; 14:30: -24.9% [-100.2%, +119.1%] n=3 win 33%; 15:00: -93.9% [-93.9%, -93.9%] n=1 win 0%

### SPXW DISCOVERY ORB underlying (no cost) exit close

- year: 2020: -0.191% [-0.403%, +0.008%] n=138 win 50%; 2021: -0.040% [-0.137%, +0.052%] n=153 win 53%; 2022: +0.103% [-0.024%, +0.240%] n=214 win 57%; 2023: +0.058% [-0.017%, +0.134%] n=248 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.058% [-0.175%, +0.050%] n=332 win 50%; GEX>0: +0.053% [-0.015%, +0.117%] n=420 win 57%; n/a: +0.854% [+0.854%, +0.854%] n=1 win 100%
- VIX tercile at 09:45: VIX high: -0.023% [-0.175%, +0.132%] n=248 win 54%; VIX low: +0.054% [+0.002%, +0.110%] n=246 win 54%; VIX mid: -0.001% [-0.090%, +0.088%] n=250 win 53%; n/a: -0.349% [-1.2%, +0.235%] n=9 win 56%
- trend/flat by the open: flat: -0.016% [-0.119%, +0.072%] n=355 win 52%; n/a: +0.854% [+0.854%, +0.854%] n=1 win 100%; trend: +0.022% [-0.066%, +0.103%] n=397 win 56%
- time bucket: 10:00: +0.046% [-0.028%, +0.119%] n=488 win 56%; 10:30: -0.075% [-0.229%, +0.070%] n=148 win 53%; 11:00: -0.168% [-0.459%, +0.099%] n=53 win 47%; 11:30: +0.072% [-0.225%, +0.377%] n=23 win 61%; 12:00: -0.157% [-0.348%, +0.051%] n=13 win 23%; 12:30: -0.072% [-0.580%, +0.357%] n=6 win 50%; 13:00: +0.069% [-0.343%, +0.563%] n=10 win 40%; 13:30: +0.404% [-0.247%, +1.6%] n=3 win 33%; 14:00: +0.079% [-0.310%, +0.388%] n=5 win 60%; 14:30: +0.083% [-0.195%, +0.276%] n=3 win 67%; 15:00: -0.051% [-0.051%, -0.051%] n=1 win 0%

### SPXW CALIBRATION long call 0.30d exit 60

- year: 2024: -8.0% [-14.4%, -1.0%] n=752 win 32%
- GEX sign at 09:45 (MODEL): GEX<0: -11.6% [-20.1%, -3.7%] n=308 win 32%; GEX>0: -5.4% [-14.7%, +4.4%] n=441 win 32%; n/a: -31.6% [-31.6%, -31.6%] n=3 win 33%
- VIX tercile at 09:45: VIX high: -10.1% [-64.9%, +26.1%] n=9 win 33%; VIX low: -6.8% [-14.0%, +1.0%] n=618 win 32%; VIX mid: -13.0% [-26.9%, +2.7%] n=107 win 36%; n/a: -18.2% [-44.7%, +12.6%] n=18 win 28%
- trend/flat by the open: flat: -0.601% [-10.5%, +9.8%] n=358 win 35%; n/a: -31.6% [-31.6%, -31.6%] n=3 win 33%; trend: -14.6% [-22.4%, -5.0%] n=391 win 29%
- time bucket: 10:00: -9.1% [-17.7%, -0.387%] n=252 win 34%; 12:00: +2.2% [-8.4%, +13.6%] n=251 win 37%; 14:00: -17.2% [-30.5%, -4.5%] n=249 win 25%

### SPXW CALIBRATION long put 0.30d exit 60

- year: 2024: -2.9% [-10.2%, +4.8%] n=753 win 30%
- GEX sign at 09:45 (MODEL): GEX<0: +1.9% [-9.2%, +14.4%] n=309 win 35%; GEX>0: -6.2% [-16.4%, +4.5%] n=441 win 26%; n/a: -21.4% [-21.4%, -21.4%] n=3 win 33%
- VIX tercile at 09:45: VIX high: -19.4% [-44.9%, +22.8%] n=9 win 33%; VIX low: -2.4% [-10.3%, +6.6%] n=618 win 29%; VIX mid: -3.1% [-22.2%, +20.3%] n=108 win 34%; n/a: -12.4% [-35.9%, +11.3%] n=18 win 33%
- trend/flat by the open: flat: -8.4% [-17.9%, +2.4%] n=359 win 27%; n/a: -21.4% [-21.4%, -21.4%] n=3 win 33%; trend: +2.2% [-8.7%, +14.4%] n=391 win 32%
- time bucket: 10:00: -0.414% [-11.1%, +11.8%] n=252 win 31%; 12:00: -4.0% [-11.9%, +4.9%] n=252 win 33%; 14:00: -4.5% [-21.9%, +17.4%] n=249 win 26%

### SPXW CALIBRATION ATM straddle exit 60

- year: 2024: -3.5% [-5.4%, -1.6%] n=753 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -2.4% [-5.1%, +0.696%] n=309 win 34%; GEX>0: -4.3% [-7.0%, -1.4%] n=441 win 29%; n/a: -12.5% [-12.5%, -12.5%] n=3 win 33%
- VIX tercile at 09:45: VIX high: -9.4% [-13.1%, -6.8%] n=9 win 22%; VIX low: -3.1% [-5.6%, -0.693%] n=618 win 32%; VIX mid: -4.9% [-8.9%, +0.226%] n=108 win 28%; n/a: -7.2% [-11.9%, -2.7%] n=18 win 33%
- trend/flat by the open: flat: -2.7% [-5.7%, +0.643%] n=359 win 33%; n/a: -12.5% [-12.5%, -12.5%] n=3 win 33%; trend: -4.2% [-6.8%, -1.1%] n=391 win 30%
- time bucket: 10:00: -3.2% [-5.8%, -0.517%] n=252 win 32%; 12:00: -0.510% [-2.8%, +2.0%] n=252 win 35%; 14:00: -6.9% [-12.0%, -0.739%] n=249 win 26%

### SPXW CALIBRATION random side (shuffle 0) exit 60

- year: 2024: -7.6% [-14.5%, -1.3%] n=752 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -5.9% [-16.2%, +4.4%] n=308 win 34%; GEX>0: -8.6% [-17.2%, +0.913%] n=441 win 29%; n/a: -42.2% [-42.2%, -42.2%] n=3 win 33%
- VIX tercile at 09:45: VIX high: +5.4% [-32.7%, +26.1%] n=9 win 44%; VIX low: -7.4% [-14.8%, +1.0%] n=618 win 29%; VIX mid: -6.6% [-22.5%, +12.3%] n=107 win 41%; n/a: -29.0% [-55.8%, +0.880%] n=18 win 17%
- trend/flat by the open: flat: -1.2% [-12.4%, +10.2%] n=358 win 33%; n/a: -42.2% [-42.2%, -42.2%] n=3 win 33%; trend: -13.2% [-20.8%, -4.9%] n=391 win 29%
- time bucket: 10:00: -6.2% [-16.5%, +3.4%] n=252 win 31%; 12:00: -0.739% [-10.3%, +9.7%] n=251 win 36%; 14:00: -16.0% [-29.1%, -1.5%] n=249 win 26%

### SPXW CALIBRATION underlying B&H (no cost) exit 60

- year: 2024: -0.006% [-0.025%, +0.012%] n=751 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.015% [-0.045%, +0.015%] n=307 win 50%; GEX>0: -0.000% [-0.023%, +0.022%] n=441 win 55%; n/a: +0.022% [+0.022%, +0.022%] n=3 win 67%
- VIX tercile at 09:45: VIX high: +0.097% [-0.243%, +0.333%] n=9 win 56%; VIX low: -0.006% [-0.025%, +0.013%] n=617 win 53%; VIX mid: -0.013% [-0.067%, +0.045%] n=107 win 52%; n/a: -0.018% [-0.073%, +0.035%] n=18 win 50%
- trend/flat by the open: flat: +0.017% [-0.008%, +0.041%] n=358 win 56%; n/a: +0.022% [+0.022%, +0.022%] n=3 win 67%; trend: -0.027% [-0.053%, -0.001%] n=390 win 50%
- time bucket: 10:00: -0.010% [-0.043%, +0.025%] n=251 win 55%; 12:00: +0.002% [-0.023%, +0.024%] n=251 win 53%; 14:00: -0.011% [-0.040%, +0.017%] n=249 win 50%

### SPXW CALIBRATION EMA option 0.30d exit 60

- year: 2024: -7.3% [-16.2%, +3.1%] n=669 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -10.2% [-21.2%, +1.0%] n=279 win 29%; GEX>0: -5.1% [-18.8%, +13.0%] n=385 win 29%; n/a: -16.3% [-16.3%, -16.3%] n=5 win 60%
- VIX tercile at 09:45: VIX high: +18.7% [-31.8%, +119.8%] n=3 win 33%; VIX low: -6.4% [-17.1%, +6.1%] n=547 win 30%; VIX mid: -17.0% [-32.1%, -1.1%] n=108 win 26%; n/a: +37.4% [-6.8%, +125.2%] n=11 win 45%
- trend/flat by the open: flat: -9.2% [-19.8%, +4.8%] n=328 win 30%; n/a: -16.3% [-16.3%, -16.3%] n=5 win 60%; trend: -5.4% [-19.8%, +13.1%] n=336 win 28%
- time bucket: 09:30: -7.2% [-41.5%, +29.8%] n=23 win 17%; 10:00: +25.9% [-2.3%, +60.5%] n=38 win 47%; 10:30: -3.9% [-24.7%, +21.7%] n=48 win 31%; 11:00: +4.6% [-15.4%, +27.9%] n=45 win 40%; 11:30: +7.8% [-9.2%, +26.6%] n=62 win 44%; 12:00: -2.8% [-19.9%, +18.2%] n=50 win 36%; 12:30: +0.315% [-19.9%, +24.5%] n=63 win 33%; 13:00: -16.6% [-30.5%, +1.3%] n=54 win 35%; 13:30: +53.0% [-10.2%, +147.8%] n=63 win 27%; 14:00: -16.4% [-36.4%, +7.9%] n=64 win 27%; 14:30: -28.2% [-57.3%, +5.4%] n=71 win 17%; 15:00: -71.0% [-84.8%, -52.6%] n=77 win 10%; 15:30: -1.2% [-97.4%, +174.7%] n=11 win 18%

### SPXW CALIBRATION EMA underlying (no cost) exit 60

- year: 2024: +0.006% [-0.007%, +0.020%] n=674 win 49%
- GEX sign at 09:45 (MODEL): GEX<0: +0.009% [-0.016%, +0.034%] n=283 win 49%; GEX>0: +0.004% [-0.012%, +0.021%] n=386 win 49%; n/a: +0.027% [+0.027%, +0.027%] n=5 win 60%
- VIX tercile at 09:45: VIX high: +0.255% [+0.062%, +0.639%] n=3 win 67%; VIX low: +0.008% [-0.007%, +0.024%] n=550 win 49%; VIX mid: -0.013% [-0.045%, +0.023%] n=110 win 45%; n/a: +0.049% [+0.000%, +0.166%] n=11 win 64%
- trend/flat by the open: flat: +0.005% [-0.013%, +0.027%] n=332 win 48%; n/a: +0.027% [+0.027%, +0.027%] n=5 win 60%; trend: +0.007% [-0.011%, +0.028%] n=337 win 49%
- time bucket: 09:30: -0.066% [-0.162%, +0.035%] n=23 win 35%; 10:00: +0.085% [+0.014%, +0.161%] n=38 win 71%; 10:30: +0.014% [-0.054%, +0.098%] n=48 win 42%; 11:00: -0.001% [-0.068%, +0.070%] n=45 win 51%; 11:30: +0.047% [+0.004%, +0.091%] n=63 win 51%; 12:00: +0.009% [-0.035%, +0.058%] n=50 win 52%; 12:30: +0.011% [-0.023%, +0.051%] n=64 win 52%; 13:00: -0.005% [-0.042%, +0.033%] n=55 win 53%; 13:30: +0.059% [-0.007%, +0.132%] n=64 win 58%; 14:00: +0.003% [-0.038%, +0.047%] n=64 win 48%; 14:30: -0.028% [-0.077%, +0.011%] n=72 win 38%; 15:00: -0.043% [-0.082%, -0.002%] n=77 win 40%; 15:30: -0.070% [-0.216%, +0.070%] n=11 win 45%

### SPXW CALIBRATION ORB option 0.30d exit 60

- year: 2024: +0.421% [-9.7%, +10.9%] n=248 win 38%
- GEX sign at 09:45 (MODEL): GEX<0: +6.2% [-11.3%, +24.9%] n=102 win 36%; GEX>0: -3.9% [-16.0%, +9.3%] n=145 win 39%; n/a: +42.3% [+42.3%, +42.3%] n=1 win 100%
- VIX tercile at 09:45: VIX high: -4.9% [-73.3%, +40.4%] n=3 win 67%; VIX low: -0.222% [-10.8%, +12.1%] n=203 win 38%; VIX mid: +10.0% [-19.0%, +48.2%] n=36 win 39%; n/a: -32.5% [-63.8%, +1.5%] n=6 win 17%
- trend/flat by the open: flat: +1.4% [-14.9%, +18.8%] n=118 win 36%; n/a: +42.3% [+42.3%, +42.3%] n=1 win 100%; trend: -0.827% [-14.8%, +13.6%] n=129 win 39%
- time bucket: 10:00: +1.8% [-10.5%, +14.8%] n=169 win 38%; 10:30: +8.9% [-13.8%, +35.8%] n=46 win 41%; 11:00: -13.7% [-47.0%, +28.4%] n=14 win 36%; 11:30: -27.3% [-46.5%, +1.3%] n=8 win 12%; 12:00: +19.8% [-50.4%, +69.9%] n=3 win 67%; 12:30: +1.7% [+1.7%, +1.7%] n=1 win 100%; 13:00: -58.9% [-59.6%, -58.1%] n=2 win 0%; 13:30: +23.7% [-64.6%, +112.1%] n=2 win 50%; 14:00: -53.1% [-53.1%, -53.1%] n=1 win 0%; 14:30: -66.2% [-91.7%, -40.7%] n=2 win 0%

### SPXW CALIBRATION ORB underlying (no cost) exit 60

- year: 2024: +0.011% [-0.023%, +0.043%] n=250 win 51%
- GEX sign at 09:45 (MODEL): GEX<0: +0.031% [-0.026%, +0.090%] n=102 win 52%; GEX>0: -0.003% [-0.039%, +0.030%] n=147 win 50%; n/a: +0.118% [+0.118%, +0.118%] n=1 win 100%
- VIX tercile at 09:45: VIX high: +0.108% [-0.516%, +0.522%] n=3 win 67%; VIX low: +0.004% [-0.027%, +0.033%] n=205 win 51%; VIX mid: +0.061% [-0.046%, +0.183%] n=36 win 53%; n/a: -0.098% [-0.231%, +0.014%] n=6 win 33%
- trend/flat by the open: flat: -0.005% [-0.053%, +0.043%] n=120 win 50%; n/a: +0.118% [+0.118%, +0.118%] n=1 win 100%; trend: +0.025% [-0.021%, +0.067%] n=129 win 52%
- time bucket: 10:00: +0.015% [-0.029%, +0.059%] n=171 win 53%; 10:30: +0.011% [-0.056%, +0.073%] n=46 win 54%; 11:00: -0.024% [-0.119%, +0.067%] n=14 win 43%; 11:30: -0.022% [-0.070%, +0.037%] n=8 win 25%; 12:00: +0.118% [-0.043%, +0.245%] n=3 win 67%; 12:30: +0.029% [+0.029%, +0.029%] n=1 win 100%; 13:00: -0.070% [-0.118%, -0.023%] n=2 win 0%; 13:30: +0.076% [-0.063%, +0.216%] n=2 win 50%; 14:00: -0.008% [-0.008%, -0.008%] n=1 win 0%; 14:30: -0.026% [-0.074%, +0.021%] n=2 win 50%

### SPXW CALIBRATION long call 0.30d exit close

- year: 2024: -1.8% [-24.1%, +22.6%] n=752 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -22.7% [-53.7%, +12.4%] n=308 win 19%; GEX>0: +13.5% [-17.8%, +49.0%] n=441 win 25%; n/a: -97.7% [-97.7%, -97.7%] n=3 win 0%
- VIX tercile at 09:45: VIX high: -87.5% [-100.1%, -62.2%] n=9 win 11%; VIX low: +0.852% [-26.1%, +28.4%] n=618 win 23%; VIX mid: -9.8% [-60.0%, +63.4%] n=107 win 21%; n/a: -2.2% [-100.2%, +118.6%] n=18 win 28%
- trend/flat by the open: flat: -8.9% [-39.6%, +28.0%] n=358 win 22%; n/a: -97.7% [-97.7%, -97.7%] n=3 win 0%; trend: +5.5% [-26.0%, +41.1%] n=391 win 24%
- time bucket: 10:00: -4.1% [-27.3%, +20.4%] n=252 win 25%; 12:00: +7.2% [-19.3%, +34.5%] n=251 win 25%; 14:00: -8.5% [-36.7%, +22.7%] n=249 win 19%

### SPXW CALIBRATION long put 0.30d exit close

- year: 2024: -3.4% [-31.2%, +31.0%] n=753 win 20%
- GEX sign at 09:45 (MODEL): GEX<0: +6.7% [-30.4%, +58.6%] n=309 win 25%; GEX>0: -9.8% [-47.0%, +37.4%] n=441 win 16%; n/a: -98.0% [-98.0%, -98.0%] n=3 win 0%
- VIX tercile at 09:45: VIX high: -18.7% [-99.6%, +125.1%] n=9 win 11%; VIX low: -5.7% [-36.4%, +34.9%] n=618 win 18%; VIX mid: -11.4% [-58.6%, +46.0%] n=108 win 23%; n/a: +130.4% [-28.4%, +305.7%] n=18 win 61%
- trend/flat by the open: flat: -3.1% [-38.3%, +40.4%] n=359 win 20%; n/a: -98.0% [-98.0%, -98.0%] n=3 win 0%; trend: -2.9% [-39.4%, +46.1%] n=391 win 20%
- time bucket: 10:00: +1.3% [-32.4%, +39.2%] n=252 win 21%; 12:00: -2.6% [-35.1%, +34.4%] n=252 win 20%; 14:00: -9.0% [-37.5%, +25.1%] n=249 win 19%

### SPXW CALIBRATION ATM straddle exit close

- year: 2024: -4.7% [-14.1%, +5.8%] n=753 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -5.0% [-17.9%, +11.1%] n=309 win 37%; GEX>0: -4.1% [-15.5%, +9.0%] n=441 win 36%; n/a: -50.6% [-50.6%, -50.6%] n=3 win 0%
- VIX tercile at 09:45: VIX high: -26.8% [-46.0%, +8.8%] n=9 win 11%; VIX low: -5.0% [-15.8%, +7.1%] n=618 win 36%; VIX mid: -8.2% [-26.6%, +16.0%] n=108 win 36%; n/a: +38.7% [+8.0%, +73.9%] n=18 win 61%
- trend/flat by the open: flat: -6.9% [-19.5%, +7.3%] n=359 win 34%; n/a: -50.6% [-50.6%, -50.6%] n=3 win 0%; trend: -2.2% [-15.1%, +13.0%] n=391 win 39%
- time bucket: 10:00: -2.4% [-12.8%, +8.3%] n=252 win 38%; 12:00: -1.6% [-13.6%, +10.7%] n=252 win 37%; 14:00: -10.0% [-20.6%, +1.5%] n=249 win 33%

### SPXW CALIBRATION random side (shuffle 0) exit close

- year: 2024: -0.858% [-22.8%, +22.1%] n=752 win 22%
- GEX sign at 09:45 (MODEL): GEX<0: +0.043% [-32.0%, +41.2%] n=308 win 23%; GEX>0: -0.813% [-25.1%, +27.4%] n=441 win 21%; n/a: -99.9% [-99.9%, -99.9%] n=3 win 0%
- VIX tercile at 09:45: VIX high: -92.6% [-100.1%, -81.5%] n=9 win 0%; VIX low: -0.053% [-24.4%, +25.2%] n=618 win 21%; VIX mid: -9.7% [-48.8%, +43.3%] n=107 win 24%; n/a: +69.8% [-34.2%, +172.2%] n=18 win 44%
- trend/flat by the open: flat: +10.1% [-23.4%, +49.7%] n=358 win 23%; n/a: -99.9% [-99.9%, -99.9%] n=3 win 0%; trend: -10.1% [-34.2%, +17.1%] n=391 win 21%
- time bucket: 10:00: +2.4% [-29.2%, +38.7%] n=252 win 24%; 12:00: +14.6% [-15.3%, +47.6%] n=251 win 25%; 14:00: -19.7% [-45.0%, +8.4%] n=249 win 18%

### SPXW CALIBRATION underlying B&H (no cost) exit close

- year: 2024: -0.006% [-0.065%, +0.043%] n=752 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.046% [-0.144%, +0.037%] n=308 win 48%; GEX>0: +0.023% [-0.045%, +0.084%] n=441 win 56%; n/a: -0.034% [-0.034%, -0.034%] n=3 win 67%
- VIX tercile at 09:45: VIX high: -0.146% [-0.480%, +0.381%] n=9 win 44%; VIX low: +0.002% [-0.054%, +0.055%] n=618 win 54%; VIX mid: -0.005% [-0.159%, +0.157%] n=107 win 50%; n/a: -0.214% [-0.474%, +0.066%] n=18 win 33%
- trend/flat by the open: flat: -0.016% [-0.099%, +0.056%] n=358 win 53%; n/a: -0.034% [-0.034%, -0.034%] n=3 win 67%; trend: +0.004% [-0.069%, +0.076%] n=391 win 52%
- time bucket: 10:00: +0.003% [-0.069%, +0.071%] n=252 win 55%; 12:00: +0.002% [-0.056%, +0.057%] n=251 win 53%; 14:00: -0.021% [-0.065%, +0.021%] n=249 win 49%

### SPXW CALIBRATION EMA option 0.30d exit close

- year: 2024: -3.9% [-26.2%, +20.3%] n=669 win 21%
- GEX sign at 09:45 (MODEL): GEX<0: -2.7% [-29.4%, +31.0%] n=280 win 25%; GEX>0: -3.5% [-34.3%, +36.1%] n=384 win 18%; n/a: -98.0% [-98.0%, -98.0%] n=5 win 0%
- VIX tercile at 09:45: VIX high: -24.3% [-96.4%, +119.8%] n=3 win 33%; VIX low: -5.6% [-30.0%, +23.4%] n=547 win 20%; VIX mid: -8.1% [-48.1%, +38.0%] n=108 win 22%; n/a: +131.6% [+64.1%, +294.3%] n=11 win 64%
- trend/flat by the open: flat: -15.6% [-42.8%, +16.8%] n=328 win 19%; n/a: -98.0% [-98.0%, -98.0%] n=5 win 0%; trend: +9.0% [-22.8%, +48.0%] n=336 win 23%
- time bucket: 09:30: +40.5% [-51.7%, +139.8%] n=23 win 26%; 10:00: +5.5% [-61.2%, +88.7%] n=38 win 26%; 10:30: +3.7% [-50.8%, +75.3%] n=48 win 27%; 11:00: -24.4% [-67.1%, +27.4%] n=45 win 18%; 11:30: +27.7% [-30.0%, +97.1%] n=62 win 29%; 12:00: -44.0% [-79.4%, +0.602%] n=50 win 12%; 12:30: +18.8% [-25.5%, +71.7%] n=64 win 34%; 13:00: +3.7% [-67.9%, +119.0%] n=54 win 15%; 13:30: +58.7% [-40.1%, +228.2%] n=63 win 22%; 14:00: -6.0% [-52.4%, +55.7%] n=62 win 21%; 14:30: -21.9% [-61.9%, +23.6%] n=72 win 17%; 15:00: -71.0% [-84.8%, -52.6%] n=77 win 10%; 15:30: -1.2% [-97.4%, +174.7%] n=11 win 18%

### SPXW CALIBRATION EMA underlying (no cost) exit close

- year: 2024: +0.005% [-0.012%, +0.026%] n=674 win 48%
- GEX sign at 09:45 (MODEL): GEX<0: +0.015% [-0.017%, +0.053%] n=283 win 52%; GEX>0: -0.001% [-0.021%, +0.022%] n=386 win 46%; n/a: -0.032% [-0.032%, -0.032%] n=5 win 40%
- VIX tercile at 09:45: VIX high: +0.149% [-0.096%, +0.639%] n=3 win 67%; VIX low: +0.006% [-0.012%, +0.027%] n=550 win 48%; VIX mid: -0.018% [-0.065%, +0.047%] n=110 win 47%; n/a: +0.159% [+0.053%, +0.387%] n=11 win 73%
- trend/flat by the open: flat: -0.006% [-0.028%, +0.022%] n=332 win 47%; n/a: -0.032% [-0.032%, -0.032%] n=5 win 40%; trend: +0.017% [-0.010%, +0.048%] n=337 win 49%
- time bucket: 09:30: -0.083% [-0.379%, +0.143%] n=23 win 57%; 10:00: -0.051% [-0.188%, +0.088%] n=38 win 53%; 10:30: +0.045% [-0.085%, +0.188%] n=48 win 48%; 11:00: -0.022% [-0.131%, +0.078%] n=45 win 53%; 11:30: +0.110% [+0.007%, +0.229%] n=63 win 57%; 12:00: -0.103% [-0.192%, -0.011%] n=50 win 38%; 12:30: +0.076% [+0.016%, +0.146%] n=64 win 55%; 13:00: +0.013% [-0.109%, +0.167%] n=55 win 45%; 13:30: +0.078% [-0.002%, +0.175%] n=64 win 55%; 14:00: -0.006% [-0.061%, +0.057%] n=64 win 44%; 14:30: -0.023% [-0.075%, +0.024%] n=72 win 43%; 15:00: -0.043% [-0.082%, -0.002%] n=77 win 40%; 15:30: -0.070% [-0.216%, +0.070%] n=11 win 45%

### SPXW CALIBRATION ORB option 0.30d exit close

- year: 2024: +12.7% [-16.7%, +47.2%] n=247 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -21.1% [-49.5%, +11.3%] n=101 win 25%; GEX>0: +37.0% [-9.6%, +93.7%] n=145 win 26%; n/a: -100.1% [-100.1%, -100.1%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -90.9% [-100.0%, -72.6%] n=3 win 0%; VIX low: +18.3% [-16.9%, +59.5%] n=203 win 25%; VIX mid: -10.1% [-60.5%, +48.7%] n=35 win 29%; n/a: +6.1% [-75.5%, +89.9%] n=6 win 33%
- trend/flat by the open: flat: -2.0% [-35.6%, +37.2%] n=117 win 21%; n/a: -100.1% [-100.1%, -100.1%] n=1 win 0%; trend: +26.9% [-19.0%, +83.8%] n=129 win 29%
- time bucket: 10:00: +14.7% [-22.9%, +59.2%] n=169 win 25%; 10:30: -13.5% [-61.7%, +43.2%] n=45 win 22%; 11:00: +114.9% [-25.9%, +304.4%] n=14 win 43%; 11:30: -99.7% [-100.2%, -98.7%] n=8 win 0%; 12:00: +63.8% [-100.2%, +178.4%] n=3 win 67%; 12:30: -100.3% [-100.3%, -100.3%] n=1 win 0%; 13:00: +424.5% [-100.1%, +949.1%] n=2 win 50%; 13:30: -100.2% [-100.2%, -100.2%] n=2 win 0%; 14:00: -93.4% [-93.4%, -93.4%] n=1 win 0%; 14:30: -100.3% [-100.4%, -100.2%] n=2 win 0%

### SPXW CALIBRATION ORB underlying (no cost) exit close

- year: 2024: +0.004% [-0.059%, +0.074%] n=251 win 51%
- GEX sign at 09:45 (MODEL): GEX<0: -0.034% [-0.153%, +0.081%] n=103 win 50%; GEX>0: +0.031% [-0.044%, +0.111%] n=147 win 52%; n/a: -0.135% [-0.135%, -0.135%] n=1 win 0%
- VIX tercile at 09:45: VIX high: +0.034% [-0.522%, +0.635%] n=3 win 33%; VIX low: +0.015% [-0.063%, +0.085%] n=206 win 50%; VIX mid: -0.050% [-0.304%, +0.168%] n=36 win 56%; n/a: -0.078% [-0.480%, +0.283%] n=6 win 67%
- trend/flat by the open: flat: -0.057% [-0.156%, +0.040%] n=120 win 42%; n/a: -0.135% [-0.135%, -0.135%] n=1 win 0%; trend: +0.060% [-0.037%, +0.158%] n=130 win 58%
- time bucket: 10:00: -0.004% [-0.106%, +0.090%] n=172 win 55%; 10:30: -0.008% [-0.115%, +0.096%] n=46 win 41%; 11:00: +0.187% [-0.032%, +0.456%] n=14 win 57%; 11:30: -0.138% [-0.277%, -0.027%] n=8 win 12%; 12:00: +0.189% [-0.331%, +0.527%] n=3 win 67%; 12:30: +0.006% [+0.006%, +0.006%] n=1 win 100%; 13:00: +0.185% [-0.071%, +0.440%] n=2 win 50%; 13:30: -0.138% [-0.211%, -0.065%] n=2 win 0%; 14:00: +0.045% [+0.045%, +0.045%] n=1 win 100%; 14:30: -0.157% [-0.169%, -0.145%] n=2 win 0%

## Execution assumptions

- Entry: decision t; fill at the first valid 1-second NBBO at or after t + 2 s (buy at the ask; quote must have bid > 0, ask > bid, ask size > 0), walking forward up to 60 s; otherwise SKIPPED (counted in "skips").
- Exit: time stop decision min(t + h, close - 2 min); sell at the bid of the first valid quote >= decision + 2 s; a zero bid closes the leg at 0 with no exit fee.
- Fees $0.65 per contract per side per leg; sensitivities $1.30 and +1 tick (SPXW 0.05 below $3, 0.10 above; ETF options 0.01). No mid fills. Size: 1 lot (displayed size > 0 required on the entry side).
- Underlying rows: bar-close to bar-close returns (OBS bars), no cost; SPX index return is not tradeable directly (labelled).

