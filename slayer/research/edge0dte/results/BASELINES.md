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

Data period: DISCOVERY = expiry sessions 2020-02-18 .. 2023-12-31, CALIBRATION = 2024 (each reported separately; CALIBRATION is the out-of-sample check of DISCOVERY; HOLDOUT 2025 and LOCKED 2026 are not touched). Labels: fills, bars, board OBS; returns, signals, Sharpe, drawdown CALC; GEX regime MODEL. Deflated Sharpe trial count N = 1401, trial-Sharpe variance 0.01085.

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
| SPXW | random side (shuffle 0) | 60 | 770 | 2301 | 0 | 32.9% | +84.9% | -51.6% | -6.6% [-10.4%, -2.7%] | 0.002 | -39.7 | 0.81 | -0.070 | -1.92 | 0.000 | 189,872 (670%) | -609% | 144,871 | -7.0% | -10.3% |
| SPXW | underlying B&H (no cost) | 60 | 770 | 2300 | 0 | 53.4% | +0.239% | -0.259% | +0.007% [-0.006%, +0.021%] | 0.325 | - | 1.06 | +0.019 | +0.56 | 0.000 | 160 (1%) | +0.649% | 0 | - | - |
| SPXW | EMA option 0.30d | 60 | 770 | 2007 | 0 | 31.2% | +111.2% | -59.0% | -5.9% [-11.0%, -0.174%] | 0.039 | -25.4 | 0.86 | -0.049 | -1.17 | 0.000 | 138,468 (519%) | -472% | 138,456 | -6.3% | -9.8% |
| SPXW | EMA underlying (no cost) | 60 | 770 | 2007 | 0 | 51.9% | +0.254% | -0.255% | +0.009% [-0.006%, +0.024%] | 0.242 | - | 1.07 | +0.022 | +0.67 | 0.000 | 113 (0%) | +0.711% | 0 | - | - |
| SPXW | ORB option 0.30d | 60 | 770 | 753 | 0 | 36.7% | +80.7% | -47.6% | -0.566% [-6.5%, +5.6%] | 0.841 | -27.0 | 0.98 | -0.006 | -0.10 | 0.000 | 18,884 (70%) | -17% | 33,208 | -0.837% | -4.0% |
| SPXW | ORB underlying (no cost) | 60 | 770 | 753 | 0 | 53.9% | +0.255% | -0.285% | +0.006% [-0.021%, +0.031%] | 0.659 | - | 1.05 | +0.016 | +0.26 | 0.000 | 113 (0%) | +0.185% | 0 | - | - |
| SPXW | no-trade | close | 770 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | close | 770 | 2301 | 0 | 23.4% | +242.3% | -91.8% | -13.5% [-23.8%, -3.1%] | 0.016 | -62.8 | 0.81 | -0.077 | -1.45 | 0.000 | 336,414 (1028%) | -1243% | 280,889 | -13.8% | -16.2% |
| SPXW | long put 0.30d | close | 770 | 2302 | 0 | 18.5% | +331.6% | -93.5% | -15.0% [-29.2%, -0.075%] | 0.050 | -109.1 | 0.80 | -0.065 | -1.16 | 0.000 | 404,013 (1616%) | -1385% | 250,708 | -15.3% | -17.5% |
| SPXW | ATM straddle | close | 770 | 2302 | 0 | 33.8% | +69.2% | -52.6% | -11.5% [-15.9%, -6.9%] | 0.001 | -257.2 | 0.67 | -0.153 | -2.88 | 0.000 | 278,190 (1113%) | -1060% | 228,905 | -11.6% | -13.2% |
| SPXW | random side (shuffle 0) | close | 770 | 2301 | 0 | 21.4% | +294.9% | -92.5% | -9.7% [-20.6%, +3.1%] | 0.132 | -70.1 | 0.87 | -0.044 | -0.90 | 0.000 | 281,155 (1115%) | -890% | 274,692 | -9.9% | -12.4% |
| SPXW | underlying B&H (no cost) | close | 770 | 2301 | 0 | 54.1% | +0.488% | -0.534% | +0.018% [-0.029%, +0.067%] | 0.443 | - | 1.07 | +0.024 | +0.43 | 0.000 | 290 (1%) | +2% | 0 | - | - |
| SPXW | EMA option 0.30d | close | 770 | 2007 | 0 | 21.6% | +291.6% | -92.1% | -9.1% [-19.7%, +2.3%] | 0.112 | -51.6 | 0.87 | -0.041 | -0.92 | 0.000 | 235,734 (943%) | -733% | 234,221 | -9.4% | -12.2% |
| SPXW | EMA underlying (no cost) | close | 770 | 2007 | 0 | 50.0% | +0.461% | -0.438% | +0.012% [-0.004%, +0.028%] | 0.141 | - | 1.05 | +0.016 | +0.84 | 0.000 | 141 (1%) | +0.929% | 0 | - | - |
| SPXW | ORB option 0.30d | close | 770 | 753 | 0 | 23.1% | +284.6% | -92.1% | -5.1% [-19.1%, +10.1%] | 0.478 | -68.3 | 0.93 | -0.025 | -0.40 | 0.000 | 70,862 (283%) | -152% | 74,906 | -5.3% | -7.7% |
| SPXW | ORB underlying (no cost) | close | 770 | 753 | 0 | 53.9% | +0.562% | -0.646% | +0.005% [-0.058%, +0.066%] | 0.873 | - | 1.02 | +0.006 | +0.10 | 0.000 | 387 (2%) | +0.160% | 0 | - | - |
| SPY | no-trade | 60 | 717 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPY | long call 0.30d | 60 | 717 | 2129 | 0 | 34.8% | +66.9% | -49.2% | -8.8% [-11.7%, -5.9%] | 0.001 | -3.9 | 0.73 | -0.124 | -3.42 | 0.000 | 189,957 (698%) | -750% | 154,987 | -12.3% | -13.7% |
| SPY | long put 0.30d | 60 | 717 | 2131 | 0 | 29.4% | +80.9% | -50.8% | -12.1% [-16.0%, -8.1%] | 0.001 | -6.0 | 0.66 | -0.121 | -3.44 | 0.000 | 284,113 (1125%) | -1030% | 144,079 | -15.2% | -16.4% |
| SPY | ATM straddle | 60 | 717 | 2132 | 0 | 25.6% | +20.2% | -14.7% | -5.7% [-6.6%, -4.8%] | 0.001 | -12.5 | 0.47 | -0.258 | -6.91 | 0.000 | 124,818 (493%) | -489% | 85,925 | -7.2% | -7.9% |
| SPY | random side (shuffle 0) | 60 | 717 | 2128 | 0 | 32.2% | +70.0% | -49.5% | -11.0% [-14.1%, -7.9%] | 0.001 | -5.4 | 0.67 | -0.148 | -3.91 | 0.000 | 236,721 (896%) | -939% | 149,850 | -14.4% | -15.7% |
| SPY | underlying B&H (no cost) | 60 | 717 | 2128 | 0 | 53.6% | +0.238% | -0.250% | +0.011% [-0.003%, +0.026%] | 0.149 | - | 1.10 | +0.031 | +0.89 | 0.000 | 129 (1%) | +0.960% | 0 | - | - |
| SPY | no-trade | close | 717 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPY | long call 0.30d | close | 717 | 2129 | 0 | 24.0% | +221.5% | -88.5% | -14.0% [-24.0%, -3.3%] | 0.020 | -5.5 | 0.79 | -0.083 | -1.55 | 0.000 | 336,139 (628%) | -1190% | 178,925 | -16.9% | -17.6% |
| SPY | long put 0.30d | close | 717 | 2131 | 0 | 18.9% | +299.3% | -90.8% | -17.3% [-31.1%, -2.2%] | 0.024 | -11.5 | 0.77 | -0.075 | -1.34 | 0.000 | 436,346 (1745%) | -1471% | 178,496 | -20.0% | -20.7% |
| SPY | ATM straddle | close | 717 | 2132 | 0 | 33.8% | +63.2% | -47.4% | -10.0% [-14.0%, -5.9%] | 0.001 | -22.2 | 0.68 | -0.147 | -2.77 | 0.000 | 222,792 (891%) | -856% | 122,953 | -11.4% | -12.0% |
| SPY | random side (shuffle 0) | close | 717 | 2128 | 0 | 20.6% | +263.8% | -89.3% | -16.5% [-25.2%, -6.8%] | 0.001 | -8.3 | 0.77 | -0.083 | -1.95 | 0.000 | 372,970 (1483%) | -1404% | 178,970 | -19.4% | -20.0% |
| SPY | underlying B&H (no cost) | close | 717 | 2129 | 0 | 54.8% | +0.480% | -0.524% | +0.027% [-0.021%, +0.075%] | 0.272 | - | 1.11 | +0.036 | +0.63 | 0.000 | 234 (1%) | +2% | 0 | - | - |
| QQQ | no-trade | 60 | 593 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| QQQ | long call 0.30d | 60 | 593 | 1749 | 0 | 34.2% | +69.5% | -53.0% | -11.1% [-14.6%, -7.6%] | 0.001 | -5.9 | 0.68 | -0.147 | -4.02 | 0.000 | 194,226 (777%) | -776% | 151,497 | -14.4% | -15.7% |
| QQQ | long put 0.30d | 60 | 593 | 1754 | 0 | 29.6% | +84.3% | -54.1% | -13.2% [-17.4%, -8.8%] | 0.001 | -6.4 | 0.65 | -0.141 | -3.92 | 0.000 | 247,820 (979%) | -924% | 141,634 | -16.2% | -17.3% |
| QQQ | ATM straddle | 60 | 593 | 1758 | 0 | 23.4% | +20.5% | -16.0% | -7.4% [-8.5%, -6.3%] | 0.001 | -16.9 | 0.39 | -0.321 | -8.67 | 0.000 | 132,449 (530%) | -522% | 93,845 | -8.8% | -9.5% |
| QQQ | random side (shuffle 0) | 60 | 593 | 1745 | 0 | 32.7% | +78.8% | -52.6% | -9.6% [-13.2%, -5.8%] | 0.001 | -5.0 | 0.73 | -0.113 | -3.16 | 0.000 | 169,278 (677%) | -669% | 145,710 | -12.7% | -14.0% |
| QQQ | underlying B&H (no cost) | 60 | 593 | 1749 | 0 | 53.4% | +0.296% | -0.334% | +0.002% [-0.018%, +0.022%] | 0.831 | - | 1.02 | +0.006 | +0.16 | 0.000 | 162 (1%) | +0.173% | 0 | - | - |
| QQQ | no-trade | close | 593 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| QQQ | long call 0.30d | close | 593 | 1749 | 0 | 25.5% | +210.4% | -89.8% | -13.3% [-23.8%, -2.8%] | 0.017 | -5.2 | 0.80 | -0.081 | -1.56 | 0.000 | 241,006 (732%) | -928% | 178,547 | -16.0% | -16.7% |
| QQQ | long put 0.30d | close | 593 | 1754 | 0 | 18.9% | +266.3% | -91.5% | -23.8% [-36.4%, -9.7%] | 0.001 | -12.3 | 0.68 | -0.124 | -2.33 | 0.000 | 438,305 (1726%) | -1670% | 163,510 | -26.3% | -26.7% |
| QQQ | ATM straddle | close | 593 | 1758 | 0 | 34.1% | +58.4% | -47.5% | -11.4% [-15.3%, -7.2%] | 0.001 | -23.3 | 0.64 | -0.177 | -3.59 | 0.000 | 205,856 (806%) | -803% | 120,928 | -12.7% | -13.2% |
| QQQ | random side (shuffle 0) | close | 593 | 1745 | 0 | 22.6% | +236.0% | -90.2% | -16.5% [-25.9%, -6.7%] | 0.004 | -8.1 | 0.76 | -0.092 | -2.21 | 0.000 | 292,841 (992%) | -1153% | 174,266 | -19.1% | -19.7% |
| QQQ | underlying B&H (no cost) | close | 593 | 1749 | 0 | 54.8% | +0.602% | -0.639% | +0.041% [-0.023%, +0.106%] | 0.234 | - | 1.14 | +0.046 | +0.81 | 0.000 | 278 (1%) | +3% | 0 | - | - |
| IWM | no-trade | 60 | 441 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| IWM | long call 0.30d | 60 | 441 | 1269 | 0 | 29.3% | +73.7% | -55.7% | -17.7% [-22.1%, -13.2%] | 0.001 | -5.9 | 0.55 | -0.232 | -6.05 | 0.000 | 227,159 (909%) | -900% | 169,842 | -22.8% | -24.3% |
| IWM | long put 0.30d | 60 | 441 | 1279 | 0 | 28.5% | +82.1% | -55.3% | -16.1% [-21.0%, -10.3%] | 0.001 | -6.0 | 0.59 | -0.157 | -4.42 | 0.000 | 226,932 (908%) | -824% | 163,881 | -20.9% | -22.6% |
| IWM | ATM straddle | 60 | 441 | 1299 | 0 | 19.8% | +22.0% | -19.3% | -11.1% [-12.4%, -9.6%] | 0.001 | -16.8 | 0.28 | -0.464 | -12.28 | 0.000 | 147,473 (590%) | -577% | 109,574 | -13.2% | -14.1% |
| IWM | random side (shuffle 0) | 60 | 441 | 1249 | 0 | 28.0% | +73.1% | -56.1% | -19.9% [-24.3%, -15.4%] | 0.001 | -7.1 | 0.51 | -0.262 | -6.98 | 0.000 | 256,000 (1024%) | -994% | 162,439 | -24.8% | -26.2% |
| IWM | underlying B&H (no cost) | 60 | 441 | 1269 | 0 | 50.9% | +0.351% | -0.368% | -0.002% [-0.029%, +0.024%] | 0.877 | - | 0.99 | -0.004 | -0.11 | 0.000 | 174 (1%) | -0.098% | 0 | - | - |
| IWM | no-trade | close | 441 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| IWM | long call 0.30d | close | 441 | 1269 | 0 | 19.2% | +189.5% | -91.1% | -37.2% [-48.1%, -24.7%] | 0.001 | -10.2 | 0.50 | -0.256 | -4.76 | 0.000 | 489,393 (1958%) | -1887% | 195,751 | -41.1% | -40.9% |
| IWM | long put 0.30d | close | 441 | 1279 | 0 | 18.3% | +267.5% | -93.0% | -27.1% [-44.1%, -8.0%] | 0.008 | -10.5 | 0.64 | -0.123 | -2.23 | 0.000 | 420,153 (1681%) | -1386% | 185,050 | -30.8% | -31.4% |
| IWM | ATM straddle | close | 441 | 1299 | 0 | 26.7% | +60.4% | -50.7% | -21.0% [-25.8%, -16.2%] | 0.001 | -28.9 | 0.43 | -0.327 | -6.29 | 0.000 | 292,428 (1170%) | -1093% | 141,192 | -23.0% | -23.5% |
| IWM | random side (shuffle 0) | close | 441 | 1249 | 0 | 18.6% | +209.6% | -92.7% | -36.6% [-46.4%, -26.5%] | 0.001 | -11.1 | 0.52 | -0.230 | -5.42 | 0.000 | 470,224 (1881%) | -1826% | 185,538 | -40.3% | -40.2% |
| IWM | underlying B&H (no cost) | close | 441 | 1269 | 0 | 51.5% | +0.646% | -0.674% | +0.005% [-0.074%, +0.087%] | 0.906 | - | 1.02 | +0.005 | +0.09 | 0.000 | 415 (2%) | +0.261% | 0 | - | - |

### CALIBRATION

| root | baseline | exit | sessions | trades | skips | win | avg win | avg loss | expectancy [95%] | p | $/lot | PF | Sharpe/trade | Sharpe daily | DSR | max DD $ (%) | total return | costs $ | exp @ $1.30 fee | exp @ +1 tick |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SPXW | no-trade | 60 | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | 60 | 252 | 752 | 0 | 32.2% | +86.1% | -52.6% | -8.0% [-14.2%, -1.1%] | 0.020 | -36.2 | 0.78 | -0.090 | -2.38 | 0.000 | 82,429 (211%) | -241% | 30,780 | -8.4% | -11.9% |
| SPXW | long put 0.30d | 60 | 252 | 753 | 0 | 29.9% | +110.0% | -51.1% | -2.9% [-10.1%, +4.7%] | 0.441 | -8.4 | 0.92 | -0.027 | -0.75 | 0.000 | 34,950 (124%) | -89% | 30,652 | -3.3% | -6.7% |
| SPXW | ATM straddle | 60 | 252 | 753 | 0 | 31.2% | +25.4% | -16.6% | -3.5% [-5.4%, -1.4%] | 0.002 | -69.7 | 0.69 | -0.115 | -3.28 | 0.000 | 31,476 (117%) | -106% | 23,028 | -3.7% | -5.8% |
| SPXW | random side (shuffle 0) | 60 | 252 | 752 | 0 | 30.5% | +106.7% | -52.2% | -3.8% [-11.3%, +4.4%] | 0.332 | -17.3 | 0.89 | -0.036 | -0.97 | 0.000 | 58,017 (130%) | -116% | 30,710 | -4.2% | -7.7% |
| SPXW | underlying B&H (no cost) | 60 | 252 | 751 | 0 | 53.0% | +0.155% | -0.188% | -0.006% [-0.024%, +0.011%] | 0.514 | - | 0.93 | -0.025 | -0.66 | 0.000 | 98 (0%) | -0.181% | 0 | - | - |
| SPXW | EMA option 0.30d | 60 | 252 | 674 | 0 | 29.2% | +121.0% | -60.8% | -7.6% [-16.3%, +2.8%] | 0.149 | -17.5 | 0.82 | -0.057 | -1.46 | 0.000 | 70,503 (160%) | -206% | 28,974 | -8.0% | -11.6% |
| SPXW | EMA underlying (no cost) | 60 | 252 | 674 | 0 | 48.8% | +0.168% | -0.148% | +0.006% [-0.007%, +0.020%] | 0.381 | - | 1.08 | +0.027 | +0.87 | 0.000 | 27 (0%) | +0.162% | 0 | - | - |
| SPXW | ORB option 0.30d | 60 | 252 | 251 | 0 | 37.5% | +80.0% | -48.4% | -0.330% [-10.8%, +10.6%] | 0.936 | +6.3 | 0.99 | -0.004 | -0.06 | 0.000 | 10,705 (43%) | -3% | 7,361 | -0.610% | -3.9% |
| SPXW | ORB underlying (no cost) | 60 | 252 | 250 | 0 | 51.2% | +0.195% | -0.181% | +0.011% [-0.022%, +0.044%] | 0.483 | - | 1.13 | +0.043 | +0.68 | 0.000 | 35 (0%) | +0.112% | 0 | - | - |
| SPXW | no-trade | close | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPXW | long call 0.30d | close | 252 | 752 | 0 | 22.9% | +306.4% | -93.2% | -1.8% [-24.1%, +22.6%] | 0.858 | -46.7 | 0.97 | -0.008 | -0.15 | 0.000 | 106,126 (99%) | -54% | 46,292 | -2.1% | -5.0% |
| SPXW | long put 0.30d | close | 252 | 753 | 0 | 19.9% | +366.8% | -95.5% | -3.4% [-30.4%, +30.2%] | 0.758 | -10.0 | 0.96 | -0.012 | -0.22 | 0.000 | 110,737 (284%) | -102% | 42,326 | -3.6% | -6.2% |
| SPXW | ATM straddle | close | 252 | 753 | 0 | 36.3% | +82.3% | -54.1% | -4.7% [-14.1%, +6.3%] | 0.350 | -131.8 | 0.86 | -0.051 | -0.94 | 0.000 | 56,523 (189%) | -140% | 34,454 | -4.8% | -6.6% |
| SPXW | random side (shuffle 0) | close | 252 | 752 | 0 | 20.2% | +348.0% | -95.5% | -5.9% [-27.3%, +18.6%] | 0.576 | -69.3 | 0.92 | -0.024 | -0.51 | 0.000 | 123,606 (144%) | -176% | 43,204 | -6.1% | -8.8% |
| SPXW | underlying B&H (no cost) | close | 252 | 752 | 0 | 52.5% | +0.302% | -0.346% | -0.006% [-0.061%, +0.043%] | 0.843 | - | 0.97 | -0.012 | -0.21 | 0.000 | 231 (1%) | -0.168% | 0 | - | - |
| SPXW | EMA option 0.30d | close | 252 | 674 | 0 | 20.9% | +332.3% | -93.3% | -4.3% [-25.7%, +19.1%] | 0.705 | -9.0 | 0.94 | -0.016 | -0.36 | 0.000 | 84,060 (188%) | -116% | 40,231 | -4.6% | -7.5% |
| SPXW | EMA underlying (no cost) | close | 252 | 674 | 0 | 48.2% | +0.298% | -0.267% | +0.005% [-0.012%, +0.027%] | 0.630 | - | 1.04 | +0.013 | +0.54 | 0.000 | 49 (0%) | +0.142% | 0 | - | - |
| SPXW | ORB option 0.30d | close | 252 | 251 | 0 | 24.7% | +330.5% | -93.7% | +11.1% [-17.3%, +43.9%] | 0.502 | -11.1 | 1.16 | +0.043 | +0.68 | 0.000 | 24,033 (47%) | +111% | 12,139 | +10.9% | +7.9% |
| SPXW | ORB underlying (no cost) | close | 252 | 251 | 0 | 50.6% | +0.401% | -0.404% | +0.004% [-0.063%, +0.072%] | 0.908 | - | 1.02 | +0.006 | +0.10 | 0.000 | 58 (0%) | +0.036% | 0 | - | - |
| SPY | no-trade | 60 | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPY | long call 0.30d | 60 | 252 | 753 | 0 | 30.9% | +77.2% | -50.8% | -11.2% [-16.8%, -5.1%] | 0.001 | -4.8 | 0.68 | -0.139 | -3.68 | 0.000 | 99,423 (297%) | -337% | 51,723 | -14.8% | -16.1% |
| SPY | long put 0.30d | 60 | 252 | 753 | 0 | 29.6% | +97.3% | -50.0% | -6.3% [-13.1%, +0.951%] | 0.099 | -2.6 | 0.82 | -0.062 | -1.72 | 0.000 | 57,143 (206%) | -191% | 48,442 | -9.5% | -10.9% |
| SPY | ATM straddle | 60 | 252 | 753 | 0 | 27.8% | +23.0% | -15.5% | -4.8% [-6.5%, -2.8%] | 0.001 | -8.9 | 0.57 | -0.172 | -4.90 | 0.000 | 38,480 (152%) | -144% | 27,697 | -6.3% | -7.0% |
| SPY | random side (shuffle 0) | 60 | 252 | 753 | 0 | 29.1% | +85.4% | -50.9% | -11.2% [-17.5%, -4.2%] | 0.002 | -4.8 | 0.69 | -0.121 | -3.29 | 0.000 | 93,432 (374%) | -339% | 49,833 | -14.6% | -15.9% |
| SPY | underlying B&H (no cost) | 60 | 252 | 753 | 0 | 53.4% | +0.154% | -0.189% | -0.006% [-0.024%, +0.011%] | 0.526 | - | 0.93 | -0.025 | -0.66 | 0.000 | 99 (0%) | -0.180% | 0 | - | - |
| SPY | no-trade | close | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| SPY | long call 0.30d | close | 252 | 753 | 0 | 23.4% | +252.1% | -89.7% | -9.8% [-29.4%, +12.0%] | 0.370 | -7.9 | 0.86 | -0.050 | -0.91 | 0.000 | 131,361 (172%) | -295% | 64,018 | -12.8% | -14.0% |
| SPY | long put 0.30d | close | 252 | 753 | 0 | 19.9% | +309.7% | -91.6% | -11.7% [-37.4%, +20.8%] | 0.440 | -5.5 | 0.84 | -0.044 | -0.78 | 0.000 | 155,377 (532%) | -351% | 60,354 | -14.5% | -15.3% |
| SPY | ATM straddle | close | 252 | 753 | 0 | 32.7% | +71.2% | -47.9% | -9.0% [-17.0%, +0.834%] | 0.058 | -20.4 | 0.72 | -0.113 | -2.05 | 0.000 | 83,617 (319%) | -270% | 41,947 | -10.4% | -11.0% |
| SPY | random side (shuffle 0) | close | 252 | 753 | 0 | 21.1% | +278.3% | -91.0% | -13.0% [-31.1%, +7.0%] | 0.207 | -8.5 | 0.82 | -0.060 | -1.35 | 0.000 | 135,122 (369%) | -392% | 62,113 | -15.9% | -16.9% |
| SPY | underlying B&H (no cost) | close | 252 | 753 | 0 | 52.6% | +0.304% | -0.346% | -0.004% [-0.059%, +0.044%] | 0.881 | - | 0.97 | -0.009 | -0.16 | 0.000 | 226 (1%) | -0.131% | 0 | - | - |
| QQQ | no-trade | 60 | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| QQQ | long call 0.30d | 60 | 252 | 752 | 0 | 32.2% | +75.1% | -54.2% | -12.6% [-18.0%, -6.7%] | 0.001 | -6.5 | 0.66 | -0.158 | -4.35 | 0.000 | 105,735 (298%) | -378% | 50,367 | -15.6% | -16.8% |
| QQQ | long put 0.30d | 60 | 252 | 752 | 0 | 29.0% | +112.1% | -51.6% | -4.2% [-12.2%, +5.6%] | 0.350 | -2.7 | 0.89 | -0.032 | -0.91 | 0.000 | 37,490 (136%) | -125% | 50,294 | -6.9% | -8.2% |
| QQQ | ATM straddle | 60 | 252 | 753 | 0 | 26.0% | +26.5% | -16.2% | -5.1% [-6.9%, -3.0%] | 0.001 | -12.2 | 0.57 | -0.173 | -4.98 | 0.000 | 38,622 (153%) | -154% | 30,901 | -6.4% | -7.0% |
| QQQ | random side (shuffle 0) | 60 | 252 | 751 | 0 | 32.0% | +97.5% | -52.4% | -4.5% [-12.6%, +5.2%] | 0.307 | -3.2 | 0.87 | -0.036 | -0.98 | 0.000 | 53,126 (125%) | -134% | 50,757 | -7.4% | -8.8% |
| QQQ | underlying B&H (no cost) | 60 | 252 | 752 | 0 | 52.0% | +0.219% | -0.260% | -0.011% [-0.035%, +0.012%] | 0.360 | - | 0.91 | -0.033 | -0.90 | 0.000 | 165 (1%) | -0.333% | 0 | - | - |
| QQQ | no-trade | close | 252 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| QQQ | long call 0.30d | close | 252 | 752 | 0 | 22.6% | +226.1% | -89.2% | -18.0% [-34.9%, +0.762%] | 0.060 | -11.9 | 0.74 | -0.103 | -1.93 | 0.000 | 162,665 (309%) | -540% | 62,724 | -20.5% | -21.2% |
| QQQ | long put 0.30d | close | 252 | 752 | 0 | 18.8% | +328.1% | -90.7% | -12.1% [-38.3%, +22.9%] | 0.420 | -6.7 | 0.84 | -0.045 | -0.78 | 0.000 | 139,848 (362%) | -365% | 64,105 | -14.6% | -15.2% |
| QQQ | ATM straddle | close | 252 | 753 | 0 | 30.0% | +72.3% | -48.1% | -11.9% [-19.5%, -3.3%] | 0.012 | -30.9 | 0.65 | -0.154 | -2.89 | 0.000 | 96,146 (385%) | -359% | 48,645 | -13.1% | -13.6% |
| QQQ | random side (shuffle 0) | close | 252 | 751 | 0 | 21.2% | +294.2% | -91.2% | -9.6% [-29.8%, +13.2%] | 0.364 | -8.1 | 0.87 | -0.039 | -0.87 | 0.000 | 118,397 (178%) | -289% | 63,263 | -12.2% | -12.9% |
| QQQ | underlying B&H (no cost) | close | 252 | 752 | 0 | 53.2% | +0.381% | -0.455% | -0.010% [-0.078%, +0.052%] | 0.753 | - | 0.95 | -0.017 | -0.31 | 0.000 | 280 (1%) | -0.314% | 0 | - | - |
| IWM | no-trade | 60 | 224 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| IWM | long call 0.30d | 60 | 224 | 640 | 0 | 25.9% | +75.9% | -58.3% | -23.5% [-29.3%, -17.5%] | 0.001 | -6.1 | 0.46 | -0.313 | -8.10 | 0.000 | 157,629 (631%) | -602% | 90,435 | -29.6% | -30.9% |
| IWM | long put 0.30d | 60 | 224 | 657 | 0 | 27.2% | +98.4% | -58.2% | -15.6% [-22.6%, -7.9%] | 0.001 | -3.8 | 0.63 | -0.167 | -4.42 | 0.000 | 109,904 (368%) | -409% | 92,245 | -21.4% | -23.0% |
| IWM | ATM straddle | 60 | 224 | 669 | 0 | 22.9% | +25.0% | -21.9% | -11.2% [-13.1%, -9.2%] | 0.001 | -13.5 | 0.34 | -0.438 | -11.96 | 0.000 | 75,341 (296%) | -300% | 58,799 | -13.7% | -14.7% |
| IWM | random side (shuffle 0) | 60 | 224 | 628 | 0 | 27.7% | +94.5% | -58.2% | -15.9% [-22.6%, -9.1%] | 0.001 | -3.4 | 0.62 | -0.178 | -4.89 | 0.000 | 108,507 (398%) | -399% | 89,088 | -21.8% | -23.4% |
| IWM | underlying B&H (no cost) | 60 | 224 | 640 | 0 | 51.1% | +0.275% | -0.302% | -0.007% [-0.042%, +0.027%] | 0.680 | - | 0.95 | -0.018 | -0.44 | 0.000 | 134 (1%) | -0.189% | 0 | - | - |
| IWM | no-trade | close | 224 | 0 | 0 | - | - | - | 0 | - | 0 | - | - | - | - | 0 | 0 | 0 | - | - |
| IWM | long call 0.30d | close | 224 | 640 | 0 | 15.6% | +259.8% | -95.3% | -39.8% [-54.5%, -22.0%] | 0.001 | -12.1 | 0.50 | -0.252 | -5.01 | 0.000 | 284,133 (689%) | -1020% | 90,692 | -44.2% | -44.1% |
| IWM | long put 0.30d | close | 224 | 657 | 0 | 20.9% | +259.8% | -93.4% | -19.8% [-38.5%, +2.2%] | 0.082 | -3.3 | 0.73 | -0.104 | -1.93 | 0.000 | 196,280 (548%) | -519% | 97,346 | -24.2% | -24.5% |
| IWM | ATM straddle | close | 224 | 669 | 0 | 30.2% | +63.6% | -53.1% | -17.9% [-24.4%, -10.9%] | 0.001 | -23.2 | 0.52 | -0.271 | -5.52 | 0.000 | 128,914 (439%) | -479% | 67,575 | -20.1% | -20.7% |
| IWM | random side (shuffle 0) | close | 224 | 628 | 0 | 19.1% | +244.3% | -94.2% | -29.5% [-45.4%, -9.3%] | 0.006 | -5.6 | 0.61 | -0.168 | -3.51 | 0.000 | 230,267 (595%) | -742% | 91,521 | -34.0% | -33.9% |
| IWM | underlying B&H (no cost) | close | 224 | 640 | 0 | 48.4% | +0.437% | -0.530% | -0.062% [-0.146%, +0.022%] | 0.133 | - | 0.77 | -0.085 | -1.53 | 0.000 | 461 (2%) | -2% | 0 | - | - |

## Out-of-sample: DISCOVERY vs CALIBRATION expectancy (same rule, same costs)

| root | baseline | exit | DISCOVERY [95%] | CALIBRATION [95%] | same sign |
|---|---|---|---:|---:|---|
| SPXW | long call 0.30d | 60 | -7.1% [-10.0%, -3.9%] | -8.0% [-14.2%, -1.1%] | yes |
| SPXW | long put 0.30d | 60 | -10.6% [-14.4%, -6.8%] | -2.9% [-10.1%, +4.7%] | yes |
| SPXW | ATM straddle | 60 | -6.0% [-7.0%, -4.9%] | -3.5% [-5.4%, -1.4%] | yes |
| SPXW | random side (shuffle 0) | 60 | -6.6% [-10.4%, -2.7%] | -3.8% [-11.3%, +4.4%] | yes |
| SPXW | underlying B&H (no cost) | 60 | +0.007% [-0.006%, +0.021%] | -0.006% [-0.024%, +0.011%] | no |
| SPXW | EMA option 0.30d | 60 | -5.9% [-11.0%, -0.174%] | -7.6% [-16.3%, +2.8%] | yes |
| SPXW | EMA underlying (no cost) | 60 | +0.009% [-0.006%, +0.024%] | +0.006% [-0.007%, +0.020%] | yes |
| SPXW | ORB option 0.30d | 60 | -0.566% [-6.5%, +5.6%] | -0.330% [-10.8%, +10.6%] | yes |
| SPXW | ORB underlying (no cost) | 60 | +0.006% [-0.021%, +0.031%] | +0.011% [-0.022%, +0.044%] | yes |
| SPXW | long call 0.30d | close | -13.5% [-23.8%, -3.1%] | -1.8% [-24.1%, +22.6%] | yes |
| SPXW | long put 0.30d | close | -15.0% [-29.2%, -0.075%] | -3.4% [-30.4%, +30.2%] | yes |
| SPXW | ATM straddle | close | -11.5% [-15.9%, -6.9%] | -4.7% [-14.1%, +6.3%] | yes |
| SPXW | random side (shuffle 0) | close | -9.7% [-20.6%, +3.1%] | -5.9% [-27.3%, +18.6%] | yes |
| SPXW | underlying B&H (no cost) | close | +0.018% [-0.029%, +0.067%] | -0.006% [-0.061%, +0.043%] | no |
| SPXW | EMA option 0.30d | close | -9.1% [-19.7%, +2.3%] | -4.3% [-25.7%, +19.1%] | yes |
| SPXW | EMA underlying (no cost) | close | +0.012% [-0.004%, +0.028%] | +0.005% [-0.012%, +0.027%] | yes |
| SPXW | ORB option 0.30d | close | -5.1% [-19.1%, +10.1%] | +11.1% [-17.3%, +43.9%] | no |
| SPXW | ORB underlying (no cost) | close | +0.005% [-0.058%, +0.066%] | +0.004% [-0.063%, +0.072%] | yes |
| SPY | long call 0.30d | 60 | -8.8% [-11.7%, -5.9%] | -11.2% [-16.8%, -5.1%] | yes |
| SPY | long put 0.30d | 60 | -12.1% [-16.0%, -8.1%] | -6.3% [-13.1%, +0.951%] | yes |
| SPY | ATM straddle | 60 | -5.7% [-6.6%, -4.8%] | -4.8% [-6.5%, -2.8%] | yes |
| SPY | random side (shuffle 0) | 60 | -11.0% [-14.1%, -7.9%] | -11.2% [-17.5%, -4.2%] | yes |
| SPY | underlying B&H (no cost) | 60 | +0.011% [-0.003%, +0.026%] | -0.006% [-0.024%, +0.011%] | no |
| SPY | long call 0.30d | close | -14.0% [-24.0%, -3.3%] | -9.8% [-29.4%, +12.0%] | yes |
| SPY | long put 0.30d | close | -17.3% [-31.1%, -2.2%] | -11.7% [-37.4%, +20.8%] | yes |
| SPY | ATM straddle | close | -10.0% [-14.0%, -5.9%] | -9.0% [-17.0%, +0.834%] | yes |
| SPY | random side (shuffle 0) | close | -16.5% [-25.2%, -6.8%] | -13.0% [-31.1%, +7.0%] | yes |
| SPY | underlying B&H (no cost) | close | +0.027% [-0.021%, +0.075%] | -0.004% [-0.059%, +0.044%] | no |
| QQQ | long call 0.30d | 60 | -11.1% [-14.6%, -7.6%] | -12.6% [-18.0%, -6.7%] | yes |
| QQQ | long put 0.30d | 60 | -13.2% [-17.4%, -8.8%] | -4.2% [-12.2%, +5.6%] | yes |
| QQQ | ATM straddle | 60 | -7.4% [-8.5%, -6.3%] | -5.1% [-6.9%, -3.0%] | yes |
| QQQ | random side (shuffle 0) | 60 | -9.6% [-13.2%, -5.8%] | -4.5% [-12.6%, +5.2%] | yes |
| QQQ | underlying B&H (no cost) | 60 | +0.002% [-0.018%, +0.022%] | -0.011% [-0.035%, +0.012%] | no |
| QQQ | long call 0.30d | close | -13.3% [-23.8%, -2.8%] | -18.0% [-34.9%, +0.762%] | yes |
| QQQ | long put 0.30d | close | -23.8% [-36.4%, -9.7%] | -12.1% [-38.3%, +22.9%] | yes |
| QQQ | ATM straddle | close | -11.4% [-15.3%, -7.2%] | -11.9% [-19.5%, -3.3%] | yes |
| QQQ | random side (shuffle 0) | close | -16.5% [-25.9%, -6.7%] | -9.6% [-29.8%, +13.2%] | yes |
| QQQ | underlying B&H (no cost) | close | +0.041% [-0.023%, +0.106%] | -0.010% [-0.078%, +0.052%] | no |
| IWM | long call 0.30d | 60 | -17.7% [-22.1%, -13.2%] | -23.5% [-29.3%, -17.5%] | yes |
| IWM | long put 0.30d | 60 | -16.1% [-21.0%, -10.3%] | -15.6% [-22.6%, -7.9%] | yes |
| IWM | ATM straddle | 60 | -11.1% [-12.4%, -9.6%] | -11.2% [-13.1%, -9.2%] | yes |
| IWM | random side (shuffle 0) | 60 | -19.9% [-24.3%, -15.4%] | -15.9% [-22.6%, -9.1%] | yes |
| IWM | underlying B&H (no cost) | 60 | -0.002% [-0.029%, +0.024%] | -0.007% [-0.042%, +0.027%] | yes |
| IWM | long call 0.30d | close | -37.2% [-48.1%, -24.7%] | -39.8% [-54.5%, -22.0%] | yes |
| IWM | long put 0.30d | close | -27.1% [-44.1%, -8.0%] | -19.8% [-38.5%, +2.2%] | yes |
| IWM | ATM straddle | close | -21.0% [-25.8%, -16.2%] | -17.9% [-24.4%, -10.9%] | yes |
| IWM | random side (shuffle 0) | close | -36.6% [-46.4%, -26.5%] | -29.5% [-45.4%, -9.3%] | yes |
| IWM | underlying B&H (no cost) | close | +0.005% [-0.074%, +0.087%] | -0.062% [-0.146%, +0.022%] | no |

## Random side: 1,000 shuffles

| root | split | exit | mean expectancy | 2.5% .. 97.5% of shuffles | mean win | mean PF |
|---|---|---|---:|---:|---:|---:|
| SPXW | DISCOVERY | 60 | -9.0% | -12.0% .. -5.9% | 32.1% | 0.75 |
| SPXW | DISCOVERY | close | -14.2% | -20.4% .. -7.9% | 20.9% | 0.81 |
| SPXW | CALIBRATION | 60 | -5.3% | -11.0% .. +0.441% | 31.1% | 0.85 |
| SPXW | CALIBRATION | close | -2.6% | -16.2% .. +11.3% | 21.4% | 0.97 |
| SPY | DISCOVERY | 60 | -10.5% | -13.7% .. -7.2% | 32.1% | 0.69 |
| SPY | DISCOVERY | close | -15.8% | -22.4% .. -9.4% | 21.4% | 0.78 |
| SPY | CALIBRATION | 60 | -8.6% | -14.0% .. -3.1% | 30.3% | 0.76 |
| SPY | CALIBRATION | close | -10.6% | -22.7% .. +1.6% | 21.7% | 0.85 |
| QQQ | DISCOVERY | 60 | -12.2% | -16.0% .. -8.6% | 31.9% | 0.67 |
| QQQ | DISCOVERY | close | -19.0% | -25.8% .. -12.8% | 22.1% | 0.73 |
| QQQ | CALIBRATION | 60 | -8.4% | -15.4% .. -1.7% | 30.6% | 0.77 |
| QQQ | CALIBRATION | close | -15.0% | -27.5% .. -2.9% | 20.6% | 0.79 |
| IWM | DISCOVERY | 60 | -16.5% | -20.5% .. -12.3% | 29.1% | 0.58 |
| IWM | DISCOVERY | close | -31.1% | -38.6% .. -23.1% | 18.9% | 0.58 |
| IWM | CALIBRATION | 60 | -19.4% | -24.9% .. -13.5% | 26.5% | 0.55 |
| IWM | CALIBRATION | close | -29.5% | -39.8% .. -19.3% | 18.0% | 0.62 |

## Parameter sensitivity grid (mean net expectancy per trade; exit horizon x cost assumption)

Rows: every baseline x exit (15, 30, 60 min time stop, close). Columns: mid-to-mid (no spread, no fee: the gross information), ask/bid without fee, $0.65 fee (base), $1.30 fee, +1 tick each side.

| root | split | baseline | exit | n | mid-to-mid | ask/bid no fee | net $0.65 | net $1.30 | net +1 tick |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| IWM | CALIBRATION | ATM straddle | 15 | 669 | +0.643% | -5.4% | -7.9% | -10.4% | -11.5% |
| IWM | CALIBRATION | ATM straddle | 30 | 669 | +0.418% | -5.9% | -8.4% | -10.9% | -12.0% |
| IWM | CALIBRATION | ATM straddle | 60 | 669 | -2.4% | -8.7% | -11.2% | -13.7% | -14.7% |
| IWM | CALIBRATION | ATM straddle | close | 669 | -8.1% | -15.7% | -17.9% | -20.1% | -20.7% |
| IWM | CALIBRATION | long call 0.30d | 15 | 640 | -4.7% | -12.1% | -18.2% | -24.3% | -26.1% |
| IWM | CALIBRATION | long call 0.30d | 30 | 640 | -5.2% | -12.7% | -18.8% | -24.9% | -26.7% |
| IWM | CALIBRATION | long call 0.30d | 60 | 640 | -10.1% | -17.4% | -23.5% | -29.6% | -30.9% |
| IWM | CALIBRATION | long call 0.30d | close | 640 | -27.2% | -35.5% | -39.8% | -44.2% | -44.1% |
| IWM | CALIBRATION | long put 0.30d | 15 | 657 | +4.4% | -4.1% | -9.9% | -15.7% | -17.8% |
| IWM | CALIBRATION | long put 0.30d | 30 | 657 | +4.1% | -4.7% | -10.5% | -16.3% | -18.4% |
| IWM | CALIBRATION | long put 0.30d | 60 | 657 | -0.906% | -9.8% | -15.6% | -21.4% | -23.0% |
| IWM | CALIBRATION | long put 0.30d | close | 657 | -4.7% | -15.4% | -19.8% | -24.2% | -24.5% |
| IWM | CALIBRATION | random side (shuffle 0) | 15 | 628 | +1.7% | -6.8% | -12.7% | -18.6% | -20.6% |
| IWM | CALIBRATION | random side (shuffle 0) | 30 | 628 | +4.9% | -4.0% | -10.0% | -15.9% | -18.0% |
| IWM | CALIBRATION | random side (shuffle 0) | 60 | 628 | -0.922% | -10.0% | -15.9% | -21.8% | -23.4% |
| IWM | CALIBRATION | random side (shuffle 0) | close | 628 | -14.8% | -25.1% | -29.5% | -34.0% | -33.9% |
| IWM | CALIBRATION | underlying B&H (no cost) | 15 | 640 | - | - | -0.020% | - | - |
| IWM | CALIBRATION | underlying B&H (no cost) | 30 | 640 | - | - | -0.011% | - | - |
| IWM | CALIBRATION | underlying B&H (no cost) | 60 | 640 | - | - | -0.007% | - | - |
| IWM | CALIBRATION | underlying B&H (no cost) | close | 640 | - | - | -0.062% | - | - |
| IWM | DISCOVERY | ATM straddle | 15 | 1299 | -0.685% | -6.4% | -8.5% | -10.7% | -11.6% |
| IWM | DISCOVERY | ATM straddle | 30 | 1299 | -0.583% | -6.7% | -8.8% | -11.0% | -11.9% |
| IWM | DISCOVERY | ATM straddle | 60 | 1299 | -2.7% | -9.0% | -11.1% | -13.2% | -14.1% |
| IWM | DISCOVERY | ATM straddle | close | 1299 | -10.4% | -19.1% | -21.0% | -23.0% | -23.5% |
| IWM | DISCOVERY | long call 0.30d | 15 | 1268 | -2.3% | -10.2% | -15.3% | -20.4% | -22.1% |
| IWM | DISCOVERY | long call 0.30d | 30 | 1269 | -2.2% | -10.3% | -15.4% | -20.5% | -22.2% |
| IWM | DISCOVERY | long call 0.30d | 60 | 1269 | -4.5% | -12.7% | -17.7% | -22.8% | -24.3% |
| IWM | DISCOVERY | long call 0.30d | close | 1269 | -22.9% | -33.2% | -37.2% | -41.1% | -40.9% |
| IWM | DISCOVERY | long put 0.30d | 15 | 1279 | -0.250% | -8.0% | -12.7% | -17.5% | -19.2% |
| IWM | DISCOVERY | long put 0.30d | 30 | 1279 | +0.230% | -8.0% | -12.7% | -17.5% | -19.2% |
| IWM | DISCOVERY | long put 0.30d | 60 | 1279 | -3.3% | -11.3% | -16.1% | -20.9% | -22.6% |
| IWM | DISCOVERY | long put 0.30d | close | 1279 | -13.1% | -23.4% | -27.1% | -30.8% | -31.4% |
| IWM | DISCOVERY | random side (shuffle 0) | 15 | 1248 | -2.3% | -10.0% | -15.0% | -19.9% | -21.5% |
| IWM | DISCOVERY | random side (shuffle 0) | 30 | 1249 | -3.4% | -11.2% | -16.2% | -21.1% | -22.7% |
| IWM | DISCOVERY | random side (shuffle 0) | 60 | 1249 | -7.2% | -15.0% | -19.9% | -24.8% | -26.2% |
| IWM | DISCOVERY | random side (shuffle 0) | close | 1249 | -22.9% | -32.8% | -36.6% | -40.3% | -40.2% |
| IWM | DISCOVERY | underlying B&H (no cost) | 15 | 1269 | - | - | -0.009% | - | - |
| IWM | DISCOVERY | underlying B&H (no cost) | 30 | 1269 | - | - | -0.011% | - | - |
| IWM | DISCOVERY | underlying B&H (no cost) | 60 | 1269 | - | - | -0.002% | - | - |
| IWM | DISCOVERY | underlying B&H (no cost) | close | 1269 | - | - | +0.005% | - | - |
| QQQ | CALIBRATION | ATM straddle | 15 | 753 | +0.068% | -2.3% | -3.6% | -4.9% | -5.6% |
| QQQ | CALIBRATION | ATM straddle | 30 | 752 | +0.010% | -2.6% | -3.9% | -5.2% | -5.8% |
| QQQ | CALIBRATION | ATM straddle | 60 | 753 | -1.0% | -3.8% | -5.1% | -6.4% | -7.0% |
| QQQ | CALIBRATION | ATM straddle | close | 753 | -5.6% | -10.7% | -11.9% | -13.1% | -13.6% |
| QQQ | CALIBRATION | long call 0.30d | 15 | 752 | -4.1% | -7.4% | -10.5% | -13.5% | -14.7% |
| QQQ | CALIBRATION | long call 0.30d | 30 | 752 | -2.9% | -6.4% | -9.5% | -12.5% | -13.7% |
| QQQ | CALIBRATION | long call 0.30d | 60 | 752 | -6.1% | -9.6% | -12.6% | -15.6% | -16.8% |
| QQQ | CALIBRATION | long call 0.30d | close | 752 | -9.8% | -15.4% | -18.0% | -20.5% | -21.2% |
| QQQ | CALIBRATION | long put 0.30d | 15 | 752 | +4.6% | +0.884% | -1.9% | -4.6% | -5.9% |
| QQQ | CALIBRATION | long put 0.30d | 30 | 751 | +3.3% | -0.368% | -3.1% | -5.9% | -7.2% |
| QQQ | CALIBRATION | long put 0.30d | 60 | 752 | +2.6% | -1.4% | -4.2% | -6.9% | -8.2% |
| QQQ | CALIBRATION | long put 0.30d | close | 752 | -3.8% | -9.7% | -12.1% | -14.6% | -15.2% |
| QQQ | CALIBRATION | random side (shuffle 0) | 15 | 751 | +2.8% | -0.790% | -3.7% | -6.6% | -8.0% |
| QQQ | CALIBRATION | random side (shuffle 0) | 30 | 750 | +3.2% | -0.442% | -3.4% | -6.3% | -7.7% |
| QQQ | CALIBRATION | random side (shuffle 0) | 60 | 751 | +2.3% | -1.6% | -4.5% | -7.4% | -8.8% |
| QQQ | CALIBRATION | random side (shuffle 0) | close | 751 | -1.2% | -7.1% | -9.6% | -12.2% | -12.9% |
| QQQ | CALIBRATION | underlying B&H (no cost) | 15 | 752 | - | - | -0.015% | - | - |
| QQQ | CALIBRATION | underlying B&H (no cost) | 30 | 752 | - | - | -0.007% | - | - |
| QQQ | CALIBRATION | underlying B&H (no cost) | 60 | 752 | - | - | -0.011% | - | - |
| QQQ | CALIBRATION | underlying B&H (no cost) | close | 752 | - | - | -0.010% | - | - |
| QQQ | DISCOVERY | ATM straddle | 15 | 1757 | -0.383% | -3.9% | -5.4% | -6.8% | -7.5% |
| QQQ | DISCOVERY | ATM straddle | 30 | 1758 | -0.756% | -4.6% | -6.0% | -7.4% | -8.1% |
| QQQ | DISCOVERY | ATM straddle | 60 | 1758 | -2.1% | -6.0% | -7.4% | -8.8% | -9.5% |
| QQQ | DISCOVERY | ATM straddle | close | 1758 | -4.6% | -10.1% | -11.4% | -12.7% | -13.2% |
| QQQ | DISCOVERY | long call 0.30d | 15 | 1748 | -2.6% | -7.6% | -11.0% | -14.3% | -15.7% |
| QQQ | DISCOVERY | long call 0.30d | 30 | 1748 | -2.5% | -7.6% | -11.0% | -14.3% | -15.6% |
| QQQ | DISCOVERY | long call 0.30d | 60 | 1749 | -2.5% | -7.8% | -11.1% | -14.4% | -15.7% |
| QQQ | DISCOVERY | long call 0.30d | close | 1749 | -2.8% | -10.5% | -13.3% | -16.0% | -16.7% |
| QQQ | DISCOVERY | long put 0.30d | 15 | 1754 | +0.696% | -4.1% | -7.2% | -10.2% | -11.5% |
| QQQ | DISCOVERY | long put 0.30d | 30 | 1754 | -0.856% | -5.8% | -8.9% | -11.9% | -13.2% |
| QQQ | DISCOVERY | long put 0.30d | 60 | 1754 | -5.3% | -10.1% | -13.2% | -16.2% | -17.3% |
| QQQ | DISCOVERY | long put 0.30d | close | 1754 | -14.8% | -21.3% | -23.8% | -26.3% | -26.7% |
| QQQ | DISCOVERY | random side (shuffle 0) | 15 | 1745 | -0.694% | -5.6% | -8.8% | -11.9% | -13.2% |
| QQQ | DISCOVERY | random side (shuffle 0) | 30 | 1744 | -0.676% | -5.7% | -8.9% | -12.0% | -13.3% |
| QQQ | DISCOVERY | random side (shuffle 0) | 60 | 1745 | -1.2% | -6.4% | -9.6% | -12.7% | -14.0% |
| QQQ | DISCOVERY | random side (shuffle 0) | close | 1745 | -6.2% | -13.9% | -16.5% | -19.1% | -19.7% |
| QQQ | DISCOVERY | underlying B&H (no cost) | 15 | 1749 | - | - | -0.015% | - | - |
| QQQ | DISCOVERY | underlying B&H (no cost) | 30 | 1749 | - | - | -0.009% | - | - |
| QQQ | DISCOVERY | underlying B&H (no cost) | 60 | 1749 | - | - | +0.002% | - | - |
| QQQ | DISCOVERY | underlying B&H (no cost) | close | 1749 | - | - | +0.041% | - | - |
| SPXW | CALIBRATION | ATM straddle | 15 | 753 | +0.343% | -2.3% | -2.5% | -2.6% | -4.9% |
| SPXW | CALIBRATION | ATM straddle | 30 | 753 | -0.019% | -2.8% | -2.9% | -3.1% | -5.3% |
| SPXW | CALIBRATION | ATM straddle | 60 | 753 | -0.419% | -3.4% | -3.5% | -3.7% | -5.8% |
| SPXW | CALIBRATION | ATM straddle | close | 753 | -0.017% | -4.5% | -4.7% | -4.8% | -6.6% |
| SPXW | CALIBRATION | EMA option 0.30d | 15 | 674 | -5.3% | -8.6% | -9.0% | -9.4% | -13.2% |
| SPXW | CALIBRATION | EMA option 0.30d | 30 | 674 | -6.4% | -9.8% | -10.2% | -10.7% | -14.4% |
| SPXW | CALIBRATION | EMA option 0.30d | 60 | 674 | -3.4% | -7.2% | -7.6% | -8.0% | -11.6% |
| SPXW | CALIBRATION | EMA option 0.30d | close | 674 | +1.6% | -4.0% | -4.3% | -4.6% | -7.5% |
| SPXW | CALIBRATION | EMA underlying (no cost) | 15 | 674 | - | - | -0.009% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | 30 | 674 | - | - | -0.003% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | 60 | 674 | - | - | +0.006% | - | - |
| SPXW | CALIBRATION | EMA underlying (no cost) | close | 674 | - | - | +0.005% | - | - |
| SPXW | CALIBRATION | ORB option 0.30d | 15 | 251 | -1.5% | -4.2% | -4.5% | -4.8% | -8.2% |
| SPXW | CALIBRATION | ORB option 0.30d | 30 | 251 | +2.0% | -0.825% | -1.1% | -1.4% | -4.8% |
| SPXW | CALIBRATION | ORB option 0.30d | 60 | 251 | +2.7% | -0.050% | -0.330% | -0.610% | -3.9% |
| SPXW | CALIBRATION | ORB option 0.30d | close | 251 | +16.4% | +11.3% | +11.1% | +10.9% | +7.9% |
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
| SPXW | CALIBRATION | random side (shuffle 0) | 15 | 752 | +0.942% | -2.8% | -3.2% | -3.5% | -7.2% |
| SPXW | CALIBRATION | random side (shuffle 0) | 30 | 752 | -0.501% | -4.2% | -4.6% | -4.9% | -8.5% |
| SPXW | CALIBRATION | random side (shuffle 0) | 60 | 752 | +0.373% | -3.5% | -3.8% | -4.2% | -7.7% |
| SPXW | CALIBRATION | random side (shuffle 0) | close | 752 | +0.065% | -5.6% | -5.9% | -6.1% | -8.8% |
| SPXW | CALIBRATION | underlying B&H (no cost) | 15 | 752 | - | - | -0.013% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | 30 | 752 | - | - | -0.006% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | 60 | 751 | - | - | -0.006% | - | - |
| SPXW | CALIBRATION | underlying B&H (no cost) | close | 752 | - | - | -0.006% | - | - |
| SPXW | DISCOVERY | ATM straddle | 15 | 2302 | -0.346% | -4.6% | -4.7% | -4.9% | -7.0% |
| SPXW | DISCOVERY | ATM straddle | 30 | 2302 | -0.364% | -4.7% | -4.9% | -5.1% | -7.1% |
| SPXW | DISCOVERY | ATM straddle | 60 | 2302 | -1.3% | -5.9% | -6.0% | -6.2% | -8.2% |
| SPXW | DISCOVERY | ATM straddle | close | 2302 | -1.6% | -11.4% | -11.5% | -11.6% | -13.2% |
| SPXW | DISCOVERY | EMA option 0.30d | 15 | 2007 | -0.922% | -6.1% | -6.5% | -6.9% | -10.6% |
| SPXW | DISCOVERY | EMA option 0.30d | 30 | 2007 | -1.5% | -7.1% | -7.5% | -7.9% | -11.5% |
| SPXW | DISCOVERY | EMA option 0.30d | 60 | 2007 | +1.1% | -5.5% | -5.9% | -6.3% | -9.8% |
| SPXW | DISCOVERY | EMA option 0.30d | close | 2007 | +2.7% | -8.8% | -9.1% | -9.4% | -12.2% |
| SPXW | DISCOVERY | EMA underlying (no cost) | 15 | 2007 | - | - | -0.002% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | 30 | 2007 | - | - | -0.002% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | 60 | 2007 | - | - | +0.009% | - | - |
| SPXW | DISCOVERY | EMA underlying (no cost) | close | 2007 | - | - | +0.012% | - | - |
| SPXW | DISCOVERY | ORB option 0.30d | 15 | 753 | -0.533% | -4.7% | -5.0% | -5.3% | -8.4% |
| SPXW | DISCOVERY | ORB option 0.30d | 30 | 753 | -0.185% | -4.3% | -4.6% | -4.9% | -8.0% |
| SPXW | DISCOVERY | ORB option 0.30d | 60 | 753 | +4.0% | -0.295% | -0.566% | -0.837% | -4.0% |
| SPXW | DISCOVERY | ORB option 0.30d | close | 753 | +5.0% | -4.9% | -5.1% | -5.3% | -7.7% |
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
| SPXW | DISCOVERY | random side (shuffle 0) | 15 | 2301 | +1.2% | -4.7% | -5.0% | -5.3% | -8.8% |
| SPXW | DISCOVERY | random side (shuffle 0) | 30 | 2301 | +1.5% | -4.6% | -4.9% | -5.2% | -8.7% |
| SPXW | DISCOVERY | random side (shuffle 0) | 60 | 2301 | -0.148% | -6.3% | -6.6% | -7.0% | -10.3% |
| SPXW | DISCOVERY | random side (shuffle 0) | close | 2301 | +2.6% | -9.4% | -9.7% | -9.9% | -12.4% |
| SPXW | DISCOVERY | underlying B&H (no cost) | 15 | 2301 | - | - | -0.009% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | 30 | 2301 | - | - | -0.003% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | 60 | 2300 | - | - | +0.007% | - | - |
| SPXW | DISCOVERY | underlying B&H (no cost) | close | 2301 | - | - | +0.018% | - | - |
| SPY | CALIBRATION | ATM straddle | 15 | 753 | +0.155% | -1.7% | -3.2% | -4.7% | -5.4% |
| SPY | CALIBRATION | ATM straddle | 30 | 753 | -0.411% | -2.4% | -3.9% | -5.4% | -6.1% |
| SPY | CALIBRATION | ATM straddle | 60 | 753 | -1.1% | -3.3% | -4.8% | -6.3% | -7.0% |
| SPY | CALIBRATION | ATM straddle | close | 753 | -3.4% | -7.5% | -9.0% | -10.4% | -11.0% |
| SPY | CALIBRATION | long call 0.30d | 15 | 753 | -5.1% | -8.1% | -11.7% | -15.3% | -16.6% |
| SPY | CALIBRATION | long call 0.30d | 30 | 753 | -3.5% | -6.6% | -10.2% | -13.7% | -15.2% |
| SPY | CALIBRATION | long call 0.30d | 60 | 753 | -4.4% | -7.6% | -11.2% | -14.8% | -16.1% |
| SPY | CALIBRATION | long call 0.30d | close | 753 | -1.3% | -6.8% | -9.8% | -12.8% | -14.0% |
| SPY | CALIBRATION | long put 0.30d | 15 | 753 | +4.9% | +1.8% | -1.4% | -4.6% | -6.2% |
| SPY | CALIBRATION | long put 0.30d | 30 | 753 | +1.4% | -1.7% | -4.9% | -8.1% | -9.6% |
| SPY | CALIBRATION | long put 0.30d | 60 | 753 | +0.124% | -3.1% | -6.3% | -9.5% | -10.9% |
| SPY | CALIBRATION | long put 0.30d | close | 753 | -3.7% | -8.8% | -11.7% | -14.5% | -15.3% |
| SPY | CALIBRATION | random side (shuffle 0) | 15 | 753 | -2.8% | -5.8% | -9.2% | -12.5% | -13.9% |
| SPY | CALIBRATION | random side (shuffle 0) | 30 | 753 | -3.3% | -6.3% | -9.7% | -13.0% | -14.4% |
| SPY | CALIBRATION | random side (shuffle 0) | 60 | 753 | -4.8% | -7.9% | -11.2% | -14.6% | -15.9% |
| SPY | CALIBRATION | random side (shuffle 0) | close | 753 | -4.9% | -10.1% | -13.0% | -15.9% | -16.9% |
| SPY | CALIBRATION | underlying B&H (no cost) | 15 | 753 | - | - | -0.014% | - | - |
| SPY | CALIBRATION | underlying B&H (no cost) | 30 | 753 | - | - | -0.006% | - | - |
| SPY | CALIBRATION | underlying B&H (no cost) | 60 | 753 | - | - | -0.006% | - | - |
| SPY | CALIBRATION | underlying B&H (no cost) | close | 753 | - | - | -0.004% | - | - |
| SPY | DISCOVERY | ATM straddle | 15 | 2131 | -0.438% | -2.7% | -4.1% | -5.6% | -6.3% |
| SPY | DISCOVERY | ATM straddle | 30 | 2132 | -0.551% | -2.9% | -4.4% | -5.9% | -6.6% |
| SPY | DISCOVERY | ATM straddle | 60 | 2132 | -1.7% | -4.3% | -5.7% | -7.2% | -7.9% |
| SPY | DISCOVERY | ATM straddle | close | 2132 | -4.3% | -8.6% | -10.0% | -11.4% | -12.0% |
| SPY | DISCOVERY | long call 0.30d | 15 | 2128 | -2.4% | -6.0% | -9.5% | -13.0% | -14.4% |
| SPY | DISCOVERY | long call 0.30d | 30 | 2129 | -1.4% | -5.0% | -8.6% | -12.1% | -13.5% |
| SPY | DISCOVERY | long call 0.30d | 60 | 2129 | -1.6% | -5.3% | -8.8% | -12.3% | -13.7% |
| SPY | DISCOVERY | long call 0.30d | close | 2129 | -5.6% | -11.0% | -14.0% | -16.9% | -17.6% |
| SPY | DISCOVERY | long put 0.30d | 15 | 2130 | -0.003% | -3.4% | -6.6% | -9.7% | -11.1% |
| SPY | DISCOVERY | long put 0.30d | 30 | 2131 | -1.6% | -5.1% | -8.2% | -11.4% | -12.7% |
| SPY | DISCOVERY | long put 0.30d | 60 | 2131 | -5.4% | -8.9% | -12.1% | -15.2% | -16.4% |
| SPY | DISCOVERY | long put 0.30d | close | 2131 | -9.1% | -14.5% | -17.3% | -20.0% | -20.7% |
| SPY | DISCOVERY | random side (shuffle 0) | 15 | 2128 | -2.0% | -5.5% | -8.8% | -12.1% | -13.5% |
| SPY | DISCOVERY | random side (shuffle 0) | 30 | 2128 | -2.6% | -6.0% | -9.4% | -12.7% | -14.0% |
| SPY | DISCOVERY | random side (shuffle 0) | 60 | 2128 | -4.2% | -7.7% | -11.0% | -14.4% | -15.7% |
| SPY | DISCOVERY | random side (shuffle 0) | close | 2128 | -8.4% | -13.6% | -16.5% | -19.4% | -20.0% |
| SPY | DISCOVERY | underlying B&H (no cost) | 15 | 2129 | - | - | -0.007% | - | - |
| SPY | DISCOVERY | underlying B&H (no cost) | 30 | 2129 | - | - | -0.000% | - | - |
| SPY | DISCOVERY | underlying B&H (no cost) | 60 | 2128 | - | - | +0.011% | - | - |
| SPY | DISCOVERY | underlying B&H (no cost) | close | 2129 | - | - | +0.027% | - | - |

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

- year: 2020: -11.0% [-17.6%, -4.0%] n=420 win 31%; 2021: -16.0% [-22.1%, -9.5%] n=476 win 27%; 2022: -8.8% [-15.9%, -2.1%] n=657 win 33%; 2023: +3.7% [-4.6%, +13.0%] n=748 win 37%
- GEX sign at 09:45 (MODEL): GEX<0: -5.5% [-11.0%, +0.164%] n=1012 win 34%; GEX>0: -7.4% [-12.6%, -2.1%] n=1279 win 32%; n/a: -18.2% [-32.8%, -2.2%] n=10 win 40%
- VIX tercile at 09:45: VIX high: -11.0% [-16.4%, -5.2%] n=755 win 32%; VIX low: -3.8% [-11.7%, +3.9%] n=757 win 33%; VIX mid: -4.7% [-10.6%, +1.6%] n=756 win 34%; n/a: -14.7% [-36.0%, +9.8%] n=33 win 30%
- trend/flat by the open: flat: -6.8% [-12.6%, -0.303%] n=1080 win 33%; n/a: -18.2% [-32.8%, -2.2%] n=10 win 40%; trend: -6.4% [-11.6%, -1.6%] n=1211 win 33%
- time bucket: 10:00: -5.4% [-10.6%, +0.384%] n=768 win 34%; 12:00: -6.6% [-11.0%, -1.9%] n=770 win 35%; 14:00: -7.9% [-16.6%, +1.2%] n=763 win 30%

### SPXW DISCOVERY underlying B&H (no cost) exit 60

- year: 2020: +0.036% [-0.005%, +0.079%] n=419 win 56%; 2021: +0.016% [-0.005%, +0.037%] n=476 win 57%; 2022: -0.017% [-0.053%, +0.017%] n=657 win 49%; 2023: +0.007% [-0.011%, +0.024%] n=748 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.014% [-0.039%, +0.009%] n=1011 win 50%; GEX>0: +0.024% [+0.008%, +0.041%] n=1279 win 56%; n/a: +0.016% [-0.280%, +0.247%] n=10 win 50%
- VIX tercile at 09:45: VIX high: +0.012% [-0.023%, +0.045%] n=755 win 54%; VIX low: +0.007% [-0.008%, +0.021%] n=757 win 55%; VIX mid: +0.001% [-0.018%, +0.023%] n=756 win 52%; n/a: +0.025% [-0.092%, +0.143%] n=32 win 38%
- trend/flat by the open: flat: +0.011% [-0.009%, +0.032%] n=1080 win 53%; n/a: +0.016% [-0.280%, +0.247%] n=10 win 50%; trend: +0.003% [-0.017%, +0.024%] n=1210 win 54%
- time bucket: 10:00: -0.012% [-0.042%, +0.017%] n=768 win 49%; 12:00: +0.011% [-0.010%, +0.033%] n=769 win 54%; 14:00: +0.023% [-0.001%, +0.046%] n=763 win 57%

### SPXW DISCOVERY EMA option 0.30d exit 60

- year: 2020: -16.8% [-25.8%, -8.1%] n=355 win 26%; 2021: -1.6% [-13.2%, +13.0%] n=401 win 34%; 2022: -7.3% [-16.3%, +2.1%] n=590 win 32%; 2023: -1.3% [-11.4%, +11.2%] n=661 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -4.1% [-11.4%, +4.7%] n=884 win 34%; GEX>0: -6.9% [-14.2%, +1.1%] n=1115 win 29%; n/a: -60.5% [-79.4%, -52.4%] n=8 win 12%
- VIX tercile at 09:45: VIX high: -7.3% [-15.4%, +1.6%] n=664 win 32%; VIX low: -4.9% [-14.1%, +6.4%] n=676 win 32%; VIX mid: -3.6% [-12.9%, +6.9%] n=644 win 31%; n/a: -57.7% [-70.2%, -43.8%] n=23 win 9%
- trend/flat by the open: flat: -6.4% [-13.2%, +1.2%] n=1080 win 30%; n/a: -60.5% [-79.4%, -52.4%] n=8 win 12%; trend: -4.8% [-12.9%, +3.7%] n=919 win 33%
- time bucket: 09:30: -6.4% [-22.3%, +13.4%] n=87 win 32%; 10:00: -11.3% [-23.6%, +3.8%] n=116 win 33%; 10:30: +10.9% [-4.7%, +28.5%] n=141 win 38%; 11:00: -12.3% [-21.8%, -0.013%] n=151 win 32%; 11:30: -13.5% [-23.0%, -3.6%] n=155 win 34%; 12:00: -4.6% [-14.5%, +6.6%] n=166 win 36%; 12:30: +0.125% [-13.0%, +14.0%] n=164 win 36%; 13:00: -2.1% [-15.0%, +11.2%] n=180 win 34%; 13:30: +7.5% [-13.5%, +34.4%] n=200 win 32%; 14:00: +1.3% [-15.1%, +17.0%] n=200 win 33%; 14:30: -20.2% [-37.4%, -1.4%] n=206 win 24%; 15:00: -16.9% [-41.1%, +9.5%] n=210 win 19%; 15:30: -14.4% [-59.9%, +33.7%] n=31 win 29%

### SPXW DISCOVERY EMA underlying (no cost) exit 60

- year: 2020: -0.007% [-0.058%, +0.044%] n=355 win 51%; 2021: +0.018% [-0.001%, +0.040%] n=401 win 54%; 2022: +0.004% [-0.026%, +0.034%] n=590 win 50%; 2023: +0.016% [-0.001%, +0.035%] n=661 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: +0.013% [-0.011%, +0.040%] n=884 win 52%; GEX>0: +0.012% [-0.002%, +0.027%] n=1115 win 52%; n/a: -0.922% [-1.8%, -0.180%] n=8 win 25%
- VIX tercile at 09:45: VIX high: +0.020% [-0.013%, +0.054%] n=664 win 52%; VIX low: +0.011% [-0.002%, +0.024%] n=676 win 53%; VIX mid: +0.008% [-0.013%, +0.030%] n=644 win 51%; n/a: -0.346% [-0.882%, -0.015%] n=23 win 35%
- trend/flat by the open: flat: +0.003% [-0.013%, +0.019%] n=1080 win 50%; n/a: -0.922% [-1.8%, -0.180%] n=8 win 25%; trend: +0.024% [+0.000%, +0.049%] n=919 win 54%
- time bucket: 09:30: -0.054% [-0.185%, +0.060%] n=87 win 51%; 10:00: +0.001% [-0.064%, +0.075%] n=116 win 48%; 10:30: +0.054% [-0.011%, +0.119%] n=141 win 57%; 11:00: -0.006% [-0.065%, +0.054%] n=151 win 52%; 11:30: -0.013% [-0.056%, +0.027%] n=155 win 48%; 12:00: +0.001% [-0.048%, +0.053%] n=166 win 53%; 12:30: +0.037% [-0.005%, +0.084%] n=164 win 55%; 13:00: +0.002% [-0.043%, +0.050%] n=180 win 51%; 13:30: +0.024% [-0.021%, +0.068%] n=200 win 52%; 14:00: +0.018% [-0.025%, +0.061%] n=200 win 54%; 14:30: -0.042% [-0.093%, +0.005%] n=206 win 46%; 15:00: +0.051% [-0.001%, +0.113%] n=210 win 55%; 15:30: +0.021% [-0.101%, +0.132%] n=31 win 52%

### SPXW DISCOVERY ORB option 0.30d exit 60

- year: 2020: -10.5% [-21.1%, +0.723%] n=138 win 30%; 2021: +7.1% [-8.4%, +24.9%] n=153 win 35%; 2022: -4.4% [-13.3%, +5.8%] n=214 win 37%; 2023: +3.5% [-6.9%, +15.5%] n=248 win 40%
- GEX sign at 09:45 (MODEL): GEX<0: -3.0% [-11.6%, +6.5%] n=332 win 37%; GEX>0: +1.4% [-6.6%, +10.1%] n=420 win 37%; n/a: -14.3% [-14.3%, -14.3%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -2.9% [-12.6%, +7.2%] n=248 win 35%; VIX low: +8.6% [-4.0%, +21.3%] n=246 win 40%; VIX mid: -6.3% [-15.6%, +3.7%] n=250 win 35%; n/a: -26.4% [-53.2%, +6.0%] n=9 win 33%
- trend/flat by the open: flat: -4.3% [-13.1%, +4.8%] n=355 win 34%; n/a: -14.3% [-14.3%, -14.3%] n=1 win 0%; trend: +2.8% [-5.6%, +12.0%] n=397 win 39%
- time bucket: 10:00: -2.2% [-9.8%, +5.3%] n=488 win 37%; 10:30: -1.6% [-13.9%, +13.6%] n=148 win 34%; 11:00: -6.2% [-22.1%, +12.9%] n=53 win 32%; 11:30: +18.3% [-13.8%, +50.1%] n=23 win 52%; 12:00: +22.8% [-29.8%, +99.6%] n=13 win 54%; 12:30: +64.8% [-26.7%, +194.4%] n=6 win 50%; 13:00: +11.3% [-48.6%, +106.6%] n=10 win 30%; 13:30: -39.8% [-94.6%, +58.6%] n=3 win 33%; 14:00: +16.7% [-70.0%, +108.5%] n=5 win 40%; 14:30: +40.9% [-100.2%, +179.1%] n=3 win 67%; 15:00: -93.9% [-93.9%, -93.9%] n=1 win 0%

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

- year: 2020: -25.3% [-47.0%, +3.6%] n=420 win 19%; 2021: -11.1% [-31.8%, +11.6%] n=476 win 21%; 2022: -10.6% [-29.6%, +12.3%] n=657 win 21%; 2023: +0.805% [-20.4%, +27.4%] n=748 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -16.4% [-30.8%, +0.873%] n=1012 win 21%; GEX>0: -4.2% [-20.9%, +15.0%] n=1279 win 22%; n/a: -32.4% [-94.4%, +54.4%] n=10 win 20%
- VIX tercile at 09:45: VIX high: -17.5% [-34.4%, +2.9%] n=755 win 21%; VIX low: -2.7% [-25.6%, +23.6%] n=757 win 21%; VIX mid: -6.9% [-22.8%, +11.6%] n=756 win 23%; n/a: -53.3% [-84.4%, -16.0%] n=33 win 15%
- trend/flat by the open: flat: -5.3% [-22.3%, +16.3%] n=1080 win 22%; n/a: -32.4% [-94.4%, +54.4%] n=10 win 20%; trend: -13.3% [-27.1%, +3.2%] n=1211 win 21%
- time bucket: 10:00: -3.1% [-18.8%, +12.8%] n=768 win 22%; 12:00: -12.6% [-27.8%, +2.6%] n=770 win 21%; 14:00: -13.3% [-28.5%, +2.0%] n=763 win 22%

### SPXW DISCOVERY underlying B&H (no cost) exit close

- year: 2020: +0.072% [-0.090%, +0.227%] n=420 win 59%; 2021: +0.024% [-0.045%, +0.092%] n=476 win 55%; 2022: -0.016% [-0.122%, +0.086%] n=657 win 51%; 2023: +0.014% [-0.041%, +0.068%] n=748 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.007% [-0.085%, +0.073%] n=1012 win 50%; GEX>0: +0.051% [+0.002%, +0.104%] n=1279 win 57%; n/a: -1.6% [-3.3%, -0.059%] n=10 win 30%
- VIX tercile at 09:45: VIX high: +0.071% [-0.042%, +0.182%] n=755 win 56%; VIX low: -0.016% [-0.064%, +0.030%] n=757 win 54%; VIX mid: +0.021% [-0.047%, +0.091%] n=756 win 53%; n/a: -0.475% [-1.2%, +0.057%] n=33 win 42%
- trend/flat by the open: flat: +0.027% [-0.040%, +0.098%] n=1080 win 54%; n/a: -1.6% [-3.3%, -0.059%] n=10 win 30%; trend: +0.024% [-0.039%, +0.083%] n=1211 win 54%
- time bucket: 10:00: +0.023% [-0.040%, +0.091%] n=768 win 54%; 12:00: +0.013% [-0.039%, +0.067%] n=770 win 55%; 14:00: +0.019% [-0.025%, +0.060%] n=763 win 53%

### SPXW DISCOVERY EMA option 0.30d exit close

- year: 2020: -28.3% [-44.9%, -8.1%] n=355 win 21%; 2021: +2.9% [-21.3%, +29.6%] n=401 win 22%; 2022: -13.0% [-29.9%, +5.4%] n=590 win 21%; 2023: -2.7% [-22.6%, +24.2%] n=661 win 22%
- GEX sign at 09:45 (MODEL): GEX<0: -9.3% [-24.1%, +6.4%] n=884 win 22%; GEX>0: -8.6% [-23.5%, +7.2%] n=1115 win 21%; n/a: -71.0% [-100.2%, -38.7%] n=8 win 12%
- VIX tercile at 09:45: VIX high: -16.9% [-31.6%, -0.914%] n=664 win 22%; VIX low: -3.6% [-25.2%, +23.3%] n=676 win 21%; VIX mid: -4.1% [-20.1%, +14.9%] n=644 win 22%; n/a: -86.2% [-97.9%, -68.9%] n=23 win 4%
- trend/flat by the open: flat: -3.1% [-18.7%, +14.2%] n=1080 win 23%; n/a: -71.0% [-100.2%, -38.7%] n=8 win 12%; trend: -15.7% [-29.8%, -0.992%] n=919 win 20%
- time bucket: 09:30: +8.3% [-29.2%, +51.7%] n=87 win 25%; 10:00: -18.1% [-47.8%, +12.4%] n=116 win 24%; 10:30: +4.6% [-29.4%, +41.6%] n=141 win 26%; 11:00: -27.7% [-53.2%, +1.1%] n=151 win 19%; 11:30: -3.7% [-37.5%, +34.3%] n=155 win 23%; 12:00: -22.2% [-44.6%, +1.5%] n=166 win 25%; 12:30: +9.7% [-27.8%, +53.5%] n=164 win 20%; 13:00: -17.0% [-43.4%, +13.8%] n=180 win 17%; 13:30: +13.6% [-28.6%, +77.2%] n=200 win 22%; 14:00: -11.9% [-35.1%, +12.7%] n=200 win 24%; 14:30: -19.5% [-46.3%, +9.8%] n=206 win 19%; 15:00: -16.9% [-41.1%, +9.5%] n=210 win 19%; 15:30: -14.4% [-59.9%, +33.7%] n=31 win 29%

### SPXW DISCOVERY EMA underlying (no cost) exit close

- year: 2020: +0.005% [-0.038%, +0.053%] n=355 win 53%; 2021: +0.005% [-0.017%, +0.031%] n=401 win 51%; 2022: +0.016% [-0.020%, +0.056%] n=590 win 48%; 2023: +0.015% [-0.003%, +0.038%] n=661 win 50%
- GEX sign at 09:45 (MODEL): GEX<0: +0.007% [-0.018%, +0.036%] n=884 win 50%; GEX>0: +0.018% [+0.001%, +0.036%] n=1115 win 50%; n/a: -0.343% [-0.413%, -0.275%] n=8 win 38%
- VIX tercile at 09:45: VIX high: +0.019% [-0.015%, +0.056%] n=664 win 50%; VIX low: +0.010% [-0.004%, +0.026%] n=676 win 50%; VIX mid: +0.011% [-0.012%, +0.036%] n=644 win 50%; n/a: -0.128% [-0.294%, +0.033%] n=23 win 35%
- trend/flat by the open: flat: +0.003% [-0.015%, +0.023%] n=1080 win 49%; n/a: -0.343% [-0.413%, -0.275%] n=8 win 38%; trend: +0.024% [-0.000%, +0.050%] n=919 win 51%
- time bucket: 09:30: +0.135% [-0.044%, +0.320%] n=87 win 57%; 10:00: -0.004% [-0.159%, +0.139%] n=116 win 53%; 10:30: +0.003% [-0.139%, +0.144%] n=141 win 47%; 11:00: -0.071% [-0.233%, +0.084%] n=151 win 46%; 11:30: +0.020% [-0.070%, +0.111%] n=155 win 49%; 12:00: +0.019% [-0.104%, +0.155%] n=166 win 51%; 12:30: +0.095% [-0.012%, +0.199%] n=164 win 52%; 13:00: +0.002% [-0.074%, +0.086%] n=180 win 44%; 13:30: -0.028% [-0.109%, +0.056%] n=200 win 48%; 14:00: +0.030% [-0.031%, +0.093%] n=200 win 51%; 14:30: -0.057% [-0.132%, +0.008%] n=206 win 49%; 15:00: +0.051% [-0.001%, +0.113%] n=210 win 55%; 15:30: +0.021% [-0.101%, +0.132%] n=31 win 52%

### SPXW DISCOVERY ORB option 0.30d exit close

- year: 2020: -36.7% [-61.6%, -8.5%] n=138 win 14%; 2021: -9.2% [-36.1%, +22.6%] n=153 win 24%; 2022: +5.4% [-21.3%, +33.8%] n=214 win 26%; 2023: +6.1% [-19.8%, +34.5%] n=248 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -15.8% [-33.2%, +3.3%] n=332 win 23%; GEX>0: +3.5% [-16.1%, +24.6%] n=420 win 24%; n/a: -5.5% [-5.5%, -5.5%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -3.4% [-31.2%, +23.8%] n=248 win 21%; VIX low: +3.4% [-19.0%, +30.4%] n=246 win 24%; VIX mid: -14.9% [-36.6%, +8.9%] n=250 win 24%; n/a: -9.3% [-95.3%, +97.3%] n=9 win 33%
- trend/flat by the open: flat: -4.1% [-25.4%, +16.0%] n=355 win 24%; n/a: -5.5% [-5.5%, -5.5%] n=1 win 0%; trend: -5.9% [-25.5%, +14.9%] n=397 win 23%
- time bucket: 10:00: -2.7% [-19.5%, +15.3%] n=488 win 24%; 10:30: -26.1% [-50.1%, -1.7%] n=148 win 18%; 11:00: -5.2% [-54.3%, +53.8%] n=53 win 23%; 11:30: +57.3% [-54.9%, +218.1%] n=23 win 30%; 12:00: -54.6% [-94.3%, +3.7%] n=13 win 15%; 12:30: -21.2% [-99.3%, +120.6%] n=6 win 17%; 13:00: +44.6% [-99.0%, +291.0%] n=10 win 20%; 13:30: +229.2% [-100.3%, +888.0%] n=3 win 33%; 14:00: +40.5% [-76.6%, +171.8%] n=5 win 60%; 14:30: -24.9% [-100.2%, +119.1%] n=3 win 33%; 15:00: -93.9% [-93.9%, -93.9%] n=1 win 0%

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

- year: 2024: -3.8% [-11.5%, +4.4%] n=752 win 30%
- GEX sign at 09:45 (MODEL): GEX<0: +4.6% [-7.4%, +18.0%] n=308 win 37%; GEX>0: -9.9% [-18.2%, +0.021%] n=441 win 26%; n/a: +16.8% [+16.8%, +16.8%] n=3 win 67%
- VIX tercile at 09:45: VIX high: +5.4% [-32.7%, +26.1%] n=9 win 44%; VIX low: -1.9% [-10.0%, +7.1%] n=618 win 30%; VIX mid: -14.2% [-33.2%, +7.5%] n=107 win 30%; n/a: -12.9% [-32.9%, +8.9%] n=18 win 33%
- trend/flat by the open: flat: -0.632% [-10.9%, +10.7%] n=358 win 32%; n/a: +16.8% [+16.8%, +16.8%] n=3 win 67%; trend: -6.9% [-17.0%, +4.7%] n=391 win 28%
- time bucket: 10:00: -6.8% [-16.7%, +3.3%] n=252 win 31%; 12:00: -6.1% [-15.2%, +4.5%] n=251 win 32%; 14:00: +1.4% [-15.7%, +21.7%] n=249 win 29%

### SPXW CALIBRATION underlying B&H (no cost) exit 60

- year: 2024: -0.006% [-0.025%, +0.012%] n=751 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.015% [-0.045%, +0.015%] n=307 win 50%; GEX>0: -0.000% [-0.023%, +0.022%] n=441 win 55%; n/a: +0.022% [+0.022%, +0.022%] n=3 win 67%
- VIX tercile at 09:45: VIX high: +0.097% [-0.243%, +0.333%] n=9 win 56%; VIX low: -0.006% [-0.025%, +0.013%] n=617 win 53%; VIX mid: -0.013% [-0.067%, +0.045%] n=107 win 52%; n/a: -0.018% [-0.073%, +0.035%] n=18 win 50%
- trend/flat by the open: flat: +0.017% [-0.008%, +0.041%] n=358 win 56%; n/a: +0.022% [+0.022%, +0.022%] n=3 win 67%; trend: -0.027% [-0.053%, -0.001%] n=390 win 50%
- time bucket: 10:00: -0.010% [-0.043%, +0.025%] n=251 win 55%; 12:00: +0.002% [-0.023%, +0.024%] n=251 win 53%; 14:00: -0.011% [-0.040%, +0.017%] n=249 win 50%

### SPXW CALIBRATION EMA option 0.30d exit 60

- year: 2024: -7.6% [-16.5%, +3.0%] n=674 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -10.6% [-21.2%, +0.183%] n=283 win 29%; GEX>0: -5.3% [-18.9%, +13.0%] n=386 win 29%; n/a: -16.3% [-16.3%, -16.3%] n=5 win 60%
- VIX tercile at 09:45: VIX high: +18.7% [-31.8%, +119.8%] n=3 win 33%; VIX low: -6.6% [-17.2%, +5.8%] n=550 win 30%; VIX mid: -18.2% [-33.3%, -1.5%] n=110 win 25%; n/a: +37.4% [-6.8%, +125.2%] n=11 win 45%
- trend/flat by the open: flat: -9.5% [-19.9%, +4.5%] n=332 win 30%; n/a: -16.3% [-16.3%, -16.3%] n=5 win 60%; trend: -5.6% [-20.1%, +12.9%] n=337 win 28%
- time bucket: 09:30: -7.2% [-41.5%, +29.8%] n=23 win 17%; 10:00: +25.9% [-2.3%, +60.5%] n=38 win 47%; 10:30: -3.9% [-24.7%, +21.7%] n=48 win 31%; 11:00: +4.6% [-15.4%, +27.9%] n=45 win 40%; 11:30: +6.7% [-10.0%, +25.3%] n=63 win 43%; 12:00: -2.8% [-19.9%, +18.2%] n=50 win 36%; 12:30: -0.250% [-20.4%, +23.3%] n=64 win 33%; 13:00: -17.8% [-33.0%, -0.084%] n=55 win 35%; 13:30: +52.7% [-10.1%, +145.9%] n=64 win 28%; 14:00: -16.4% [-36.4%, +7.9%] n=64 win 27%; 14:30: -29.2% [-58.0%, +3.9%] n=72 win 17%; 15:00: -71.0% [-84.8%, -52.6%] n=77 win 10%; 15:30: -1.2% [-97.4%, +174.7%] n=11 win 18%

### SPXW CALIBRATION EMA underlying (no cost) exit 60

- year: 2024: +0.006% [-0.007%, +0.020%] n=674 win 49%
- GEX sign at 09:45 (MODEL): GEX<0: +0.009% [-0.016%, +0.034%] n=283 win 49%; GEX>0: +0.004% [-0.012%, +0.021%] n=386 win 49%; n/a: +0.027% [+0.027%, +0.027%] n=5 win 60%
- VIX tercile at 09:45: VIX high: +0.255% [+0.062%, +0.639%] n=3 win 67%; VIX low: +0.008% [-0.007%, +0.024%] n=550 win 49%; VIX mid: -0.013% [-0.045%, +0.023%] n=110 win 45%; n/a: +0.049% [+0.000%, +0.166%] n=11 win 64%
- trend/flat by the open: flat: +0.005% [-0.013%, +0.027%] n=332 win 48%; n/a: +0.027% [+0.027%, +0.027%] n=5 win 60%; trend: +0.007% [-0.011%, +0.028%] n=337 win 49%
- time bucket: 09:30: -0.066% [-0.162%, +0.035%] n=23 win 35%; 10:00: +0.085% [+0.014%, +0.161%] n=38 win 71%; 10:30: +0.014% [-0.054%, +0.098%] n=48 win 42%; 11:00: -0.001% [-0.068%, +0.070%] n=45 win 51%; 11:30: +0.047% [+0.004%, +0.091%] n=63 win 51%; 12:00: +0.009% [-0.035%, +0.058%] n=50 win 52%; 12:30: +0.011% [-0.023%, +0.051%] n=64 win 52%; 13:00: -0.005% [-0.042%, +0.033%] n=55 win 53%; 13:30: +0.059% [-0.007%, +0.132%] n=64 win 58%; 14:00: +0.003% [-0.038%, +0.047%] n=64 win 48%; 14:30: -0.028% [-0.077%, +0.011%] n=72 win 38%; 15:00: -0.043% [-0.082%, -0.002%] n=77 win 40%; 15:30: -0.070% [-0.216%, +0.070%] n=11 win 45%

### SPXW CALIBRATION ORB option 0.30d exit 60

- year: 2024: -0.330% [-10.3%, +10.1%] n=251 win 37%
- GEX sign at 09:45 (MODEL): GEX<0: +5.5% [-11.5%, +24.9%] n=103 win 36%; GEX>0: -4.7% [-16.4%, +8.1%] n=147 win 38%; n/a: +42.3% [+42.3%, +42.3%] n=1 win 100%
- VIX tercile at 09:45: VIX high: -4.9% [-73.3%, +40.4%] n=3 win 67%; VIX low: -1.1% [-12.4%, +10.6%] n=206 win 37%; VIX mid: +10.0% [-19.0%, +48.2%] n=36 win 39%; n/a: -32.5% [-63.8%, +1.5%] n=6 win 17%
- trend/flat by the open: flat: +0.266% [-14.4%, +16.9%] n=120 win 36%; n/a: +42.3% [+42.3%, +42.3%] n=1 win 100%; trend: -1.2% [-14.9%, +13.0%] n=130 win 38%
- time bucket: 10:00: +0.651% [-11.3%, +13.8%] n=172 win 38%; 10:30: +8.9% [-13.8%, +35.8%] n=46 win 41%; 11:00: -13.7% [-47.0%, +28.4%] n=14 win 36%; 11:30: -27.3% [-46.5%, +1.3%] n=8 win 12%; 12:00: +19.8% [-50.4%, +69.9%] n=3 win 67%; 12:30: +1.7% [+1.7%, +1.7%] n=1 win 100%; 13:00: -58.9% [-59.6%, -58.1%] n=2 win 0%; 13:30: +23.7% [-64.6%, +112.1%] n=2 win 50%; 14:00: -53.1% [-53.1%, -53.1%] n=1 win 0%; 14:30: -66.2% [-91.7%, -40.7%] n=2 win 0%

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

- year: 2024: -5.9% [-27.2%, +17.1%] n=752 win 20%
- GEX sign at 09:45 (MODEL): GEX<0: -6.9% [-34.1%, +21.4%] n=308 win 24%; GEX>0: -4.5% [-34.4%, +30.0%] n=441 win 18%; n/a: -95.8% [-95.8%, -95.8%] n=3 win 0%
- VIX tercile at 09:45: VIX high: -92.6% [-100.1%, -81.5%] n=9 win 0%; VIX low: +0.679% [-23.6%, +29.9%] n=618 win 21%; VIX mid: -45.9% [-76.5%, -9.8%] n=107 win 15%; n/a: +51.6% [-28.3%, +146.7%] n=18 win 44%
- trend/flat by the open: flat: -3.5% [-28.9%, +26.0%] n=358 win 22%; n/a: -95.8% [-95.8%, -95.8%] n=3 win 0%; trend: -7.3% [-36.9%, +31.8%] n=391 win 19%
- time bucket: 10:00: -11.2% [-38.5%, +20.9%] n=252 win 20%; 12:00: -14.0% [-38.6%, +12.4%] n=251 win 20%; 14:00: +7.7% [-25.3%, +44.3%] n=249 win 21%

### SPXW CALIBRATION underlying B&H (no cost) exit close

- year: 2024: -0.006% [-0.065%, +0.043%] n=752 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.046% [-0.144%, +0.037%] n=308 win 48%; GEX>0: +0.023% [-0.045%, +0.084%] n=441 win 56%; n/a: -0.034% [-0.034%, -0.034%] n=3 win 67%
- VIX tercile at 09:45: VIX high: -0.146% [-0.480%, +0.381%] n=9 win 44%; VIX low: +0.002% [-0.054%, +0.055%] n=618 win 54%; VIX mid: -0.005% [-0.159%, +0.157%] n=107 win 50%; n/a: -0.214% [-0.474%, +0.066%] n=18 win 33%
- trend/flat by the open: flat: -0.016% [-0.099%, +0.056%] n=358 win 53%; n/a: -0.034% [-0.034%, -0.034%] n=3 win 67%; trend: +0.004% [-0.069%, +0.076%] n=391 win 52%
- time bucket: 10:00: +0.003% [-0.069%, +0.071%] n=252 win 55%; 12:00: +0.002% [-0.056%, +0.057%] n=251 win 53%; 14:00: -0.021% [-0.065%, +0.021%] n=249 win 49%

### SPXW CALIBRATION EMA option 0.30d exit close

- year: 2024: -4.3% [-26.2%, +19.6%] n=674 win 21%
- GEX sign at 09:45 (MODEL): GEX<0: -3.1% [-29.6%, +30.2%] n=283 win 25%; GEX>0: -4.0% [-34.6%, +35.4%] n=386 win 18%; n/a: -98.0% [-98.0%, -98.0%] n=5 win 0%
- VIX tercile at 09:45: VIX high: -24.3% [-96.4%, +119.8%] n=3 win 33%; VIX low: -5.8% [-30.1%, +23.1%] n=550 win 20%; VIX mid: -9.8% [-48.5%, +34.2%] n=110 win 22%; n/a: +131.6% [+64.1%, +294.3%] n=11 win 64%
- trend/flat by the open: flat: -16.1% [-42.7%, +15.1%] n=332 win 19%; n/a: -98.0% [-98.0%, -98.0%] n=5 win 0%; trend: +8.7% [-23.0%, +47.8%] n=337 win 23%
- time bucket: 09:30: +40.5% [-51.7%, +139.8%] n=23 win 26%; 10:00: +5.5% [-61.2%, +88.7%] n=38 win 26%; 10:30: +3.7% [-50.8%, +75.3%] n=48 win 27%; 11:00: -24.4% [-67.1%, +27.4%] n=45 win 18%; 11:30: +25.7% [-29.4%, +88.9%] n=63 win 29%; 12:00: -44.0% [-79.4%, +0.602%] n=50 win 12%; 12:30: +18.8% [-25.5%, +71.7%] n=64 win 34%; 13:00: +4.8% [-68.3%, +115.2%] n=55 win 16%; 13:30: +56.5% [-40.1%, +222.7%] n=64 win 22%; 14:00: -9.0% [-52.9%, +41.8%] n=64 win 20%; 14:30: -21.9% [-61.9%, +23.6%] n=72 win 17%; 15:00: -71.0% [-84.8%, -52.6%] n=77 win 10%; 15:30: -1.2% [-97.4%, +174.7%] n=11 win 18%

### SPXW CALIBRATION EMA underlying (no cost) exit close

- year: 2024: +0.005% [-0.012%, +0.026%] n=674 win 48%
- GEX sign at 09:45 (MODEL): GEX<0: +0.015% [-0.017%, +0.053%] n=283 win 52%; GEX>0: -0.001% [-0.021%, +0.022%] n=386 win 46%; n/a: -0.032% [-0.032%, -0.032%] n=5 win 40%
- VIX tercile at 09:45: VIX high: +0.149% [-0.096%, +0.639%] n=3 win 67%; VIX low: +0.006% [-0.012%, +0.027%] n=550 win 48%; VIX mid: -0.018% [-0.065%, +0.047%] n=110 win 47%; n/a: +0.159% [+0.053%, +0.387%] n=11 win 73%
- trend/flat by the open: flat: -0.006% [-0.028%, +0.022%] n=332 win 47%; n/a: -0.032% [-0.032%, -0.032%] n=5 win 40%; trend: +0.017% [-0.010%, +0.048%] n=337 win 49%
- time bucket: 09:30: -0.083% [-0.379%, +0.143%] n=23 win 57%; 10:00: -0.051% [-0.188%, +0.088%] n=38 win 53%; 10:30: +0.045% [-0.085%, +0.188%] n=48 win 48%; 11:00: -0.022% [-0.131%, +0.078%] n=45 win 53%; 11:30: +0.110% [+0.007%, +0.229%] n=63 win 57%; 12:00: -0.103% [-0.192%, -0.011%] n=50 win 38%; 12:30: +0.076% [+0.016%, +0.146%] n=64 win 55%; 13:00: +0.013% [-0.109%, +0.167%] n=55 win 45%; 13:30: +0.078% [-0.002%, +0.175%] n=64 win 55%; 14:00: -0.006% [-0.061%, +0.057%] n=64 win 44%; 14:30: -0.023% [-0.075%, +0.024%] n=72 win 43%; 15:00: -0.043% [-0.082%, -0.002%] n=77 win 40%; 15:30: -0.070% [-0.216%, +0.070%] n=11 win 45%

### SPXW CALIBRATION ORB option 0.30d exit close

- year: 2024: +11.1% [-17.0%, +43.2%] n=251 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -22.2% [-49.3%, +7.3%] n=103 win 24%; GEX>0: +35.1% [-10.7%, +88.1%] n=147 win 25%; n/a: -100.1% [-100.1%, -100.1%] n=1 win 0%
- VIX tercile at 09:45: VIX high: -90.9% [-100.0%, -72.6%] n=3 win 0%; VIX low: +16.8% [-16.4%, +57.8%] n=206 win 24%; VIX mid: -12.6% [-62.0%, +43.9%] n=36 win 28%; n/a: +6.1% [-75.5%, +89.9%] n=6 win 33%
- trend/flat by the open: flat: -4.1% [-37.0%, +35.8%] n=120 win 21%; n/a: -100.1% [-100.1%, -100.1%] n=1 win 0%; trend: +25.9% [-17.7%, +81.6%] n=130 win 28%
- time bucket: 10:00: +13.0% [-24.0%, +58.5%] n=172 win 25%; 10:30: -15.4% [-61.2%, +37.3%] n=46 win 22%; 11:00: +114.9% [-25.9%, +304.4%] n=14 win 43%; 11:30: -99.7% [-100.2%, -98.7%] n=8 win 0%; 12:00: +63.8% [-100.2%, +178.4%] n=3 win 67%; 12:30: -100.3% [-100.3%, -100.3%] n=1 win 0%; 13:00: +424.5% [-100.1%, +949.1%] n=2 win 50%; 13:30: -100.2% [-100.2%, -100.2%] n=2 win 0%; 14:00: -93.4% [-93.4%, -93.4%] n=1 win 0%; 14:30: -100.3% [-100.4%, -100.2%] n=2 win 0%

### SPXW CALIBRATION ORB underlying (no cost) exit close

- year: 2024: +0.004% [-0.059%, +0.074%] n=251 win 51%
- GEX sign at 09:45 (MODEL): GEX<0: -0.034% [-0.153%, +0.081%] n=103 win 50%; GEX>0: +0.031% [-0.044%, +0.111%] n=147 win 52%; n/a: -0.135% [-0.135%, -0.135%] n=1 win 0%
- VIX tercile at 09:45: VIX high: +0.034% [-0.522%, +0.635%] n=3 win 33%; VIX low: +0.015% [-0.063%, +0.085%] n=206 win 50%; VIX mid: -0.050% [-0.304%, +0.168%] n=36 win 56%; n/a: -0.078% [-0.480%, +0.283%] n=6 win 67%
- trend/flat by the open: flat: -0.057% [-0.156%, +0.040%] n=120 win 42%; n/a: -0.135% [-0.135%, -0.135%] n=1 win 0%; trend: +0.060% [-0.037%, +0.158%] n=130 win 58%
- time bucket: 10:00: -0.004% [-0.106%, +0.090%] n=172 win 55%; 10:30: -0.008% [-0.115%, +0.096%] n=46 win 41%; 11:00: +0.187% [-0.032%, +0.456%] n=14 win 57%; 11:30: -0.138% [-0.277%, -0.027%] n=8 win 12%; 12:00: +0.189% [-0.331%, +0.527%] n=3 win 67%; 12:30: +0.006% [+0.006%, +0.006%] n=1 win 100%; 13:00: +0.185% [-0.071%, +0.440%] n=2 win 50%; 13:30: -0.138% [-0.211%, -0.065%] n=2 win 0%; 14:00: +0.045% [+0.045%, +0.045%] n=1 win 100%; 14:30: -0.157% [-0.169%, -0.145%] n=2 win 0%

### SPY DISCOVERY long call 0.30d exit 60

- year: 2020: -4.9% [-11.0%, +1.4%] n=416 win 37%; 2021: -9.1% [-14.5%, -3.8%] n=466 win 34%; 2022: -11.2% [-17.4%, -4.7%] n=506 win 33%; 2023: -9.2% [-14.7%, -3.9%] n=741 win 35%
- GEX sign at 09:45 (MODEL): GEX<0: -9.3% [-13.9%, -4.9%] n=1030 win 33%; GEX>0: -8.7% [-12.7%, -4.9%] n=1083 win 36%; n/a: +15.6% [-15.9%, +43.6%] n=16 win 50%
- VIX tercile at 09:45: VIX high: -6.3% [-11.5%, -0.746%] n=701 win 37%; VIX low: -8.7% [-13.6%, -3.5%] n=699 win 34%; VIX mid: -11.0% [-16.5%, -5.8%] n=697 win 34%; n/a: -20.1% [-35.3%, -5.3%] n=32 win 28%
- trend/flat by the open: flat: -10.8% [-14.9%, -6.0%] n=1053 win 34%; n/a: +15.6% [-15.9%, +43.6%] n=16 win 50%; trend: -7.2% [-11.4%, -2.9%] n=1060 win 35%
- time bucket: 10:00: -13.0% [-17.6%, -8.0%] n=713 win 32%; 12:00: -6.8% [-10.9%, -2.6%] n=710 win 37%; 14:00: -6.6% [-12.7%, -0.220%] n=706 win 36%

### SPY DISCOVERY long put 0.30d exit 60

- year: 2020: -15.2% [-21.2%, -8.2%] n=417 win 27%; 2021: -19.1% [-24.9%, -12.5%] n=468 win 24%; 2022: -9.1% [-15.6%, -2.2%] n=506 win 34%; 2023: -8.0% [-16.0%, +2.4%] n=740 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -10.8% [-15.3%, -6.0%] n=1030 win 32%; GEX>0: -13.0% [-18.8%, -5.3%] n=1084 win 27%; n/a: -26.7% [-44.5%, -10.4%] n=17 win 24%
- VIX tercile at 09:45: VIX high: -11.5% [-16.7%, -5.7%] n=701 win 31%; VIX low: -11.0% [-19.4%, -1.3%] n=700 win 27%; VIX mid: -13.9% [-18.6%, -8.3%] n=697 win 30%; n/a: -10.5% [-23.3%, +3.2%] n=33 win 30%
- trend/flat by the open: flat: -11.3% [-17.4%, -4.0%] n=1054 win 30%; n/a: -26.7% [-44.5%, -10.4%] n=17 win 24%; trend: -12.6% [-17.4%, -7.8%] n=1060 win 29%
- time bucket: 10:00: -5.7% [-11.2%, +0.608%] n=713 win 33%; 12:00: -12.5% [-16.6%, -7.8%] n=710 win 31%; 14:00: -18.1% [-26.7%, -6.6%] n=708 win 24%

### SPY DISCOVERY ATM straddle exit 60

- year: 2020: -6.1% [-7.8%, -4.4%] n=417 win 24%; 2021: -7.2% [-9.0%, -5.5%] n=468 win 22%; 2022: -5.6% [-7.2%, -3.9%] n=506 win 25%; 2023: -4.6% [-6.5%, -2.3%] n=741 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -5.4% [-6.6%, -4.0%] n=1030 win 26%; GEX>0: -6.0% [-7.4%, -4.5%] n=1085 win 25%; n/a: -6.5% [-10.8%, -2.7%] n=17 win 24%
- VIX tercile at 09:45: VIX high: -5.2% [-6.5%, -3.8%] n=701 win 26%; VIX low: -4.8% [-6.8%, -2.7%] n=701 win 28%; VIX mid: -7.0% [-8.4%, -5.5%] n=697 win 24%; n/a: -10.4% [-15.0%, -6.0%] n=33 win 12%
- trend/flat by the open: flat: -5.8% [-7.1%, -4.3%] n=1055 win 25%; n/a: -6.5% [-10.8%, -2.7%] n=17 win 24%; trend: -5.7% [-6.8%, -4.3%] n=1060 win 26%
- time bucket: 10:00: -5.0% [-6.3%, -3.4%] n=713 win 26%; 12:00: -5.2% [-6.2%, -4.1%] n=711 win 26%; 14:00: -7.1% [-9.1%, -4.8%] n=708 win 25%

### SPY DISCOVERY random side (shuffle 0) exit 60

- year: 2020: -10.3% [-16.9%, -3.0%] n=416 win 32%; 2021: -11.7% [-18.0%, -5.2%] n=466 win 30%; 2022: -11.4% [-18.4%, -4.2%] n=506 win 33%; 2023: -10.8% [-16.3%, -4.8%] n=740 win 32%
- GEX sign at 09:45 (MODEL): GEX<0: -11.0% [-16.1%, -5.7%] n=1030 win 31%; GEX>0: -11.2% [-15.6%, -6.8%] n=1082 win 33%; n/a: -1.0% [-27.0%, +24.2%] n=16 win 38%
- VIX tercile at 09:45: VIX high: -10.4% [-15.8%, -5.3%] n=701 win 34%; VIX low: -11.2% [-17.2%, -5.0%] n=698 win 31%; VIX mid: -10.6% [-16.0%, -5.0%] n=697 win 33%; n/a: -31.3% [-42.3%, -19.6%] n=32 win 16%
- trend/flat by the open: flat: -13.8% [-17.8%, -10.0%] n=1052 win 31%; n/a: -1.0% [-27.0%, +24.2%] n=16 win 38%; trend: -8.5% [-13.7%, -3.1%] n=1060 win 33%
- time bucket: 10:00: -5.4% [-10.9%, +0.174%] n=713 win 34%; 12:00: -9.1% [-13.3%, -4.2%] n=709 win 35%; 14:00: -18.7% [-24.5%, -12.4%] n=706 win 28%

### SPY DISCOVERY underlying B&H (no cost) exit 60

- year: 2020: +0.041% [-0.004%, +0.084%] n=415 win 55%; 2021: +0.020% [-0.001%, +0.038%] n=466 win 57%; 2022: -0.012% [-0.051%, +0.026%] n=506 win 49%; 2023: +0.006% [-0.012%, +0.023%] n=741 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: +0.000% [-0.023%, +0.022%] n=1029 win 51%; GEX>0: +0.019% [+0.002%, +0.037%] n=1083 win 56%; n/a: +0.168% [-0.180%, +0.649%] n=16 win 62%
- VIX tercile at 09:45: VIX high: +0.018% [-0.019%, +0.053%] n=701 win 54%; VIX low: +0.010% [-0.004%, +0.025%] n=699 win 56%; VIX mid: +0.002% [-0.021%, +0.024%] n=697 win 52%; n/a: +0.091% [-0.090%, +0.328%] n=31 win 45%
- trend/flat by the open: flat: +0.009% [-0.012%, +0.030%] n=1053 win 52%; n/a: +0.168% [-0.180%, +0.649%] n=16 win 62%; trend: +0.012% [-0.009%, +0.031%] n=1059 win 55%
- time bucket: 10:00: -0.009% [-0.041%, +0.022%] n=713 win 49%; 12:00: +0.014% [-0.008%, +0.037%] n=709 win 54%; 14:00: +0.029% [+0.001%, +0.053%] n=706 win 58%

### SPY DISCOVERY long call 0.30d exit close

- year: 2020: -7.0% [-31.2%, +17.2%] n=416 win 27%; 2021: -12.8% [-33.9%, +10.9%] n=466 win 26%; 2022: -16.6% [-39.4%, +7.9%] n=506 win 22%; 2023: -16.9% [-33.4%, -1.4%] n=741 win 22%
- GEX sign at 09:45 (MODEL): GEX<0: -7.8% [-22.8%, +8.5%] n=1030 win 24%; GEX>0: -19.3% [-32.3%, -6.2%] n=1083 win 24%; n/a: -49.4% [-99.8%, +47.6%] n=16 win 6%
- VIX tercile at 09:45: VIX high: -9.0% [-26.6%, +9.7%] n=701 win 25%; VIX low: -24.1% [-40.2%, -6.8%] n=699 win 21%; VIX mid: -7.4% [-25.4%, +12.5%] n=697 win 27%; n/a: -44.9% [-89.0%, +25.4%] n=32 win 16%
- trend/flat by the open: flat: -9.7% [-25.1%, +7.3%] n=1053 win 25%; n/a: -49.4% [-99.8%, +47.6%] n=16 win 6%; trend: -17.7% [-31.0%, -1.3%] n=1060 win 23%
- time bucket: 10:00: -12.9% [-24.8%, +1.1%] n=713 win 23%; 12:00: -12.2% [-24.2%, +1.7%] n=710 win 24%; 14:00: -16.9% [-27.8%, -4.3%] n=706 win 25%

### SPY DISCOVERY long put 0.30d exit close

- year: 2020: -28.7% [-54.4%, +6.1%] n=417 win 16%; 2021: -22.7% [-50.9%, +6.9%] n=468 win 17%; 2022: -11.3% [-34.4%, +18.4%] n=506 win 23%; 2023: -11.4% [-38.3%, +21.4%] n=740 win 19%
- GEX sign at 09:45 (MODEL): GEX<0: -32.6% [-45.9%, -16.7%] n=1030 win 18%; GEX>0: -2.5% [-25.8%, +26.7%] n=1084 win 19%; n/a: -27.5% [-72.8%, +32.9%] n=17 win 24%
- VIX tercile at 09:45: VIX high: -22.7% [-42.6%, +0.738%] n=701 win 20%; VIX low: -2.9% [-34.2%, +29.9%] n=700 win 19%; VIX mid: -24.8% [-45.5%, -2.3%] n=697 win 18%; n/a: -46.9% [-75.1%, -7.2%] n=33 win 15%
- trend/flat by the open: flat: -9.5% [-32.2%, +17.2%] n=1054 win 20%; n/a: -27.5% [-72.8%, +32.9%] n=17 win 24%; trend: -24.8% [-41.3%, -7.0%] n=1060 win 17%
- time bucket: 10:00: -16.3% [-30.2%, +0.211%] n=713 win 19%; 12:00: -18.3% [-35.0%, -1.4%] n=710 win 18%; 14:00: -17.2% [-34.8%, +1.3%] n=708 win 19%

### SPY DISCOVERY ATM straddle exit close

- year: 2020: -11.3% [-20.1%, -0.611%] n=417 win 33%; 2021: -10.8% [-19.1%, -2.7%] n=468 win 29%; 2022: -9.2% [-17.8%, +0.052%] n=506 win 36%; 2023: -9.4% [-16.2%, -1.8%] n=741 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -12.7% [-17.4%, -7.6%] n=1030 win 34%; GEX>0: -7.3% [-13.5%, +0.076%] n=1085 win 34%; n/a: -22.2% [-40.4%, -6.0%] n=17 win 24%
- VIX tercile at 09:45: VIX high: -9.7% [-15.9%, -2.6%] n=701 win 35%; VIX low: -9.1% [-17.5%, -1.3%] n=701 win 33%; VIX mid: -10.5% [-17.0%, -4.0%] n=697 win 34%; n/a: -26.6% [-44.2%, -5.6%] n=33 win 27%
- trend/flat by the open: flat: -7.4% [-14.1%, -0.552%] n=1055 win 36%; n/a: -22.2% [-40.4%, -6.0%] n=17 win 24%; trend: -12.4% [-17.7%, -6.4%] n=1060 win 32%
- time bucket: 10:00: -9.2% [-13.9%, -3.3%] n=713 win 36%; 12:00: -10.1% [-15.2%, -5.2%] n=711 win 33%; 14:00: -10.8% [-15.4%, -5.5%] n=708 win 32%

### SPY DISCOVERY random side (shuffle 0) exit close

- year: 2020: -26.6% [-43.5%, -6.7%] n=416 win 19%; 2021: -16.8% [-35.8%, +7.2%] n=466 win 21%; 2022: -10.3% [-31.7%, +15.8%] n=506 win 23%; 2023: -14.9% [-30.1%, +1.8%] n=740 win 20%
- GEX sign at 09:45 (MODEL): GEX<0: -19.2% [-32.1%, -5.6%] n=1030 win 20%; GEX>0: -14.1% [-27.2%, +1.2%] n=1082 win 21%; n/a: -4.7% [-63.8%, +68.5%] n=16 win 25%
- VIX tercile at 09:45: VIX high: -19.4% [-31.9%, -5.9%] n=701 win 21%; VIX low: -13.2% [-32.3%, +6.3%] n=698 win 20%; VIX mid: -15.1% [-31.8%, +3.3%] n=697 win 21%; n/a: -54.4% [-77.2%, -28.3%] n=32 win 12%
- trend/flat by the open: flat: -10.1% [-25.5%, +6.6%] n=1052 win 22%; n/a: -4.7% [-63.8%, +68.5%] n=16 win 25%; trend: -23.1% [-33.7%, -10.0%] n=1060 win 20%
- time bucket: 10:00: -12.4% [-26.0%, +2.7%] n=713 win 21%; 12:00: -9.6% [-25.2%, +8.1%] n=709 win 20%; 14:00: -27.5% [-39.3%, -14.7%] n=706 win 20%

### SPY DISCOVERY underlying B&H (no cost) exit close

- year: 2020: +0.085% [-0.064%, +0.225%] n=416 win 59%; 2021: +0.033% [-0.036%, +0.104%] n=466 win 56%; 2022: -0.015% [-0.139%, +0.104%] n=506 win 52%; 2023: +0.018% [-0.038%, +0.071%] n=741 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: +0.061% [-0.017%, +0.140%] n=1030 win 55%; GEX>0: +0.005% [-0.055%, +0.059%] n=1083 win 55%; n/a: -0.731% [-1.6%, -0.095%] n=16 win 31%
- VIX tercile at 09:45: VIX high: +0.066% [-0.047%, +0.183%] n=701 win 55%; VIX low: -0.009% [-0.058%, +0.041%] n=699 win 55%; VIX mid: +0.038% [-0.030%, +0.107%] n=697 win 55%; n/a: -0.306% [-0.802%, +0.044%] n=32 win 44%
- trend/flat by the open: flat: +0.019% [-0.048%, +0.089%] n=1053 win 55%; n/a: -0.731% [-1.6%, -0.095%] n=16 win 31%; trend: +0.046% [-0.017%, +0.117%] n=1060 win 55%
- time bucket: 10:00: +0.026% [-0.035%, +0.090%] n=713 win 55%; 12:00: +0.029% [-0.021%, +0.081%] n=710 win 56%; 14:00: +0.024% [-0.018%, +0.069%] n=706 win 54%

### SPY CALIBRATION long call 0.30d exit 60

- year: 2024: -11.2% [-16.9%, -4.9%] n=753 win 31%
- GEX sign at 09:45 (MODEL): GEX<0: -13.4% [-21.8%, -4.3%] n=282 win 32%; GEX>0: -9.9% [-17.2%, -1.8%] n=471 win 31%
- VIX tercile at 09:45: VIX high: -11.1% [-45.0%, +15.0%] n=12 win 33%; VIX low: -10.1% [-16.9%, -2.7%] n=603 win 31%; VIX mid: -14.9% [-26.1%, -2.2%] n=120 win 33%; n/a: -23.3% [-45.7%, +2.8%] n=18 win 28%
- trend/flat by the open: flat: -7.8% [-16.1%, +0.981%] n=380 win 33%; trend: -14.7% [-22.6%, -6.4%] n=373 win 29%
- time bucket: 10:00: -10.8% [-18.9%, -2.7%] n=252 win 33%; 12:00: -2.5% [-11.7%, +7.0%] n=252 win 36%; 14:00: -20.5% [-32.8%, -8.7%] n=249 win 24%

### SPY CALIBRATION long put 0.30d exit 60

- year: 2024: -6.3% [-12.9%, +0.979%] n=753 win 30%
- GEX sign at 09:45 (MODEL): GEX<0: -5.2% [-15.8%, +6.1%] n=282 win 33%; GEX>0: -7.0% [-16.8%, +2.6%] n=471 win 28%
- VIX tercile at 09:45: VIX high: -29.3% [-51.6%, +2.3%] n=12 win 25%; VIX low: -5.5% [-13.5%, +3.3%] n=603 win 29%; VIX mid: -6.7% [-21.6%, +12.4%] n=120 win 33%; n/a: -16.5% [-38.1%, +6.2%] n=18 win 33%
- trend/flat by the open: flat: -9.8% [-17.9%, -1.0%] n=380 win 28%; trend: -2.8% [-14.3%, +10.0%] n=373 win 31%
- time bucket: 10:00: -2.5% [-12.3%, +9.2%] n=252 win 31%; 12:00: -7.1% [-14.5%, +1.2%] n=252 win 32%; 14:00: -9.5% [-25.9%, +11.4%] n=249 win 26%

### SPY CALIBRATION ATM straddle exit 60

- year: 2024: -4.8% [-6.5%, -2.8%] n=753 win 28%
- GEX sign at 09:45 (MODEL): GEX<0: -5.2% [-7.5%, -2.7%] n=282 win 29%; GEX>0: -4.5% [-7.1%, -1.8%] n=471 win 27%
- VIX tercile at 09:45: VIX high: -11.9% [-16.6%, -7.4%] n=12 win 17%; VIX low: -4.2% [-6.2%, -1.7%] n=603 win 29%; VIX mid: -6.1% [-8.7%, -3.0%] n=120 win 25%; n/a: -11.0% [-14.5%, -6.8%] n=18 win 17%
- trend/flat by the open: flat: -4.7% [-7.3%, -1.9%] n=380 win 27%; trend: -4.8% [-7.5%, -1.7%] n=373 win 29%
- time bucket: 10:00: -4.1% [-6.3%, -1.7%] n=252 win 29%; 12:00: -2.5% [-4.5%, -0.637%] n=252 win 31%; 14:00: -7.8% [-12.6%, -2.1%] n=249 win 22%

### SPY CALIBRATION random side (shuffle 0) exit 60

- year: 2024: -11.2% [-17.5%, -4.6%] n=753 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -14.2% [-24.2%, -4.5%] n=282 win 31%; GEX>0: -9.5% [-17.7%, +0.360%] n=471 win 28%
- VIX tercile at 09:45: VIX high: -32.1% [-58.0%, -1.2%] n=12 win 17%; VIX low: -9.5% [-17.0%, -1.2%] n=603 win 28%; VIX mid: -14.9% [-27.3%, -0.801%] n=120 win 37%; n/a: -30.8% [-46.6%, -13.0%] n=18 win 22%
- trend/flat by the open: flat: -12.5% [-20.0%, -4.3%] n=380 win 28%; trend: -10.0% [-19.5%, +0.347%] n=373 win 30%
- time bucket: 10:00: -13.4% [-22.1%, -4.6%] n=252 win 28%; 12:00: -4.5% [-13.6%, +5.3%] n=252 win 35%; 14:00: -15.9% [-29.6%, +0.124%] n=249 win 25%

### SPY CALIBRATION underlying B&H (no cost) exit 60

- year: 2024: -0.006% [-0.026%, +0.012%] n=753 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.003% [-0.032%, +0.027%] n=282 win 51%; GEX>0: -0.008% [-0.028%, +0.013%] n=471 win 55%
- VIX tercile at 09:45: VIX high: +0.119% [-0.124%, +0.278%] n=12 win 58%; VIX low: -0.006% [-0.025%, +0.012%] n=603 win 53%; VIX mid: -0.015% [-0.063%, +0.033%] n=120 win 53%; n/a: -0.014% [-0.069%, +0.038%] n=18 win 50%
- trend/flat by the open: flat: +0.008% [-0.015%, +0.031%] n=380 win 55%; trend: -0.020% [-0.048%, +0.008%] n=373 win 51%
- time bucket: 10:00: -0.011% [-0.047%, +0.025%] n=252 win 56%; 12:00: +0.002% [-0.021%, +0.024%] n=252 win 54%; 14:00: -0.010% [-0.040%, +0.017%] n=249 win 51%

### SPY CALIBRATION long call 0.30d exit close

- year: 2024: -9.8% [-29.5%, +11.6%] n=753 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -34.4% [-56.8%, -4.5%] n=282 win 19%; GEX>0: +4.9% [-23.6%, +38.1%] n=471 win 26%
- VIX tercile at 09:45: VIX high: -75.1% [-99.9%, -50.2%] n=12 win 8%; VIX low: -6.9% [-31.6%, +17.7%] n=603 win 23%; VIX mid: -16.2% [-55.1%, +39.7%] n=120 win 25%; n/a: -21.6% [-101.7%, +71.2%] n=18 win 33%
- trend/flat by the open: flat: -17.3% [-44.4%, +15.8%] n=380 win 22%; trend: -2.1% [-31.8%, +33.7%] n=373 win 25%
- time bucket: 10:00: -13.2% [-33.8%, +8.2%] n=252 win 25%; 12:00: +0.413% [-24.6%, +28.3%] n=252 win 25%; 14:00: -16.7% [-41.4%, +10.6%] n=249 win 20%

### SPY CALIBRATION long put 0.30d exit close

- year: 2024: -11.7% [-38.1%, +20.8%] n=753 win 20%
- GEX sign at 09:45 (MODEL): GEX<0: -24.9% [-49.3%, +0.056%] n=282 win 24%; GEX>0: -3.7% [-41.5%, +43.0%] n=471 win 17%
- VIX tercile at 09:45: VIX high: -35.9% [-97.4%, +54.7%] n=12 win 8%; VIX low: -12.2% [-42.9%, +24.3%] n=603 win 18%; VIX mid: -22.7% [-60.8%, +19.7%] n=120 win 25%; n/a: +95.2% [-34.2%, +233.5%] n=18 win 61%
- trend/flat by the open: flat: -16.3% [-46.1%, +22.3%] n=380 win 19%; trend: -7.0% [-47.5%, +44.4%] n=373 win 20%
- time bucket: 10:00: -9.4% [-39.6%, +22.9%] n=252 win 21%; 12:00: -7.2% [-41.7%, +36.8%] n=252 win 20%; 14:00: -18.4% [-43.2%, +12.7%] n=249 win 19%

### SPY CALIBRATION ATM straddle exit close

- year: 2024: -9.0% [-17.2%, +0.385%] n=753 win 33%
- GEX sign at 09:45 (MODEL): GEX<0: -16.8% [-25.8%, -7.9%] n=282 win 31%; GEX>0: -4.3% [-15.3%, +7.9%] n=471 win 34%
- VIX tercile at 09:45: VIX high: -31.9% [-46.4%, -8.4%] n=12 win 8%; VIX low: -9.1% [-18.4%, +1.7%] n=603 win 31%; VIX mid: -10.6% [-24.5%, +5.1%] n=120 win 39%; n/a: +22.0% [+0.631%, +43.0%] n=18 win 61%
- trend/flat by the open: flat: -12.9% [-22.9%, -1.0%] n=380 win 30%; trend: -4.9% [-16.9%, +9.2%] n=373 win 36%
- time bucket: 10:00: -7.9% [-17.3%, +1.9%] n=252 win 35%; 12:00: -6.2% [-16.7%, +4.3%] n=252 win 36%; 14:00: -12.8% [-22.1%, -2.5%] n=249 win 27%

### SPY CALIBRATION random side (shuffle 0) exit close

- year: 2024: -13.0% [-31.7%, +6.4%] n=753 win 21%
- GEX sign at 09:45 (MODEL): GEX<0: -29.9% [-50.5%, -5.5%] n=282 win 21%; GEX>0: -2.9% [-27.2%, +22.5%] n=471 win 21%
- VIX tercile at 09:45: VIX high: -75.9% [-91.7%, -60.8%] n=12 win 0%; VIX low: -8.7% [-30.4%, +15.1%] n=603 win 20%; VIX mid: -30.0% [-56.4%, +3.7%] n=120 win 25%; n/a: -1.5% [-55.2%, +51.6%] n=18 win 39%
- trend/flat by the open: flat: -10.9% [-34.0%, +16.4%] n=380 win 22%; trend: -15.2% [-40.9%, +13.2%] n=373 win 20%
- time bucket: 10:00: -13.2% [-40.2%, +18.1%] n=252 win 22%; 12:00: -14.4% [-37.5%, +9.3%] n=252 win 21%; 14:00: -11.3% [-38.2%, +18.6%] n=249 win 20%

### SPY CALIBRATION underlying B&H (no cost) exit close

- year: 2024: -0.004% [-0.063%, +0.045%] n=753 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.023% [-0.093%, +0.053%] n=282 win 47%; GEX>0: +0.007% [-0.066%, +0.076%] n=471 win 56%
- VIX tercile at 09:45: VIX high: -0.010% [-0.422%, +0.401%] n=12 win 58%; VIX low: +0.003% [-0.056%, +0.060%] n=603 win 54%; VIX mid: -0.008% [-0.154%, +0.140%] n=120 win 50%; n/a: -0.207% [-0.465%, +0.072%] n=18 win 33%
- trend/flat by the open: flat: -0.010% [-0.084%, +0.053%] n=380 win 53%; trend: +0.001% [-0.077%, +0.074%] n=373 win 52%
- time bucket: 10:00: +0.005% [-0.067%, +0.073%] n=252 win 54%; 12:00: +0.001% [-0.058%, +0.056%] n=252 win 54%; 14:00: -0.019% [-0.063%, +0.023%] n=249 win 50%

### QQQ DISCOVERY long call 0.30d exit 60

- year: 2020: -12.1% [-21.6%, -2.3%] n=141 win 36%; 2021: -11.2% [-17.9%, -4.3%] n=360 win 34%; 2022: -15.0% [-21.4%, -8.3%] n=506 win 31%; 2023: -8.2% [-13.6%, -2.2%] n=742 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -11.0% [-15.8%, -6.5%] n=1008 win 34%; GEX>0: -11.4% [-16.7%, -5.8%] n=736 win 34%; n/a: +4.4% [-14.2%, +16.8%] n=5 win 40%
- VIX tercile at 09:45: VIX high: -14.0% [-20.0%, -7.9%] n=583 win 33%; VIX low: -8.5% [-14.4%, -2.7%] n=576 win 36%; VIX mid: -10.0% [-16.3%, -2.8%] n=572 win 34%; n/a: -35.4% [-59.0%, -11.9%] n=18 win 22%
- trend/flat by the open: flat: -12.1% [-17.0%, -6.7%] n=927 win 34%; n/a: +4.4% [-14.2%, +16.8%] n=5 win 40%; trend: -10.1% [-15.2%, -5.2%] n=817 win 35%
- time bucket: 10:00: -16.8% [-22.7%, -11.2%] n=586 win 32%; 12:00: -9.0% [-14.1%, -4.0%] n=586 win 35%; 14:00: -7.5% [-14.1%, +0.175%] n=577 win 35%

### QQQ DISCOVERY long put 0.30d exit 60

- year: 2020: -16.2% [-26.0%, -5.1%] n=140 win 29%; 2021: -22.8% [-29.3%, -15.5%] n=366 win 25%; 2022: -10.8% [-17.7%, -3.7%] n=506 win 34%; 2023: -9.5% [-16.8%, -0.950%] n=742 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -10.4% [-16.0%, -4.2%] n=1010 win 31%; GEX>0: -16.7% [-22.3%, -10.6%] n=739 win 27%; n/a: -35.5% [-43.8%, -23.0%] n=5 win 40%
- VIX tercile at 09:45: VIX high: -13.1% [-18.8%, -6.8%] n=582 win 33%; VIX low: -10.3% [-19.6%, +0.455%] n=578 win 26%; VIX mid: -16.9% [-22.5%, -10.8%] n=576 win 29%; n/a: +12.6% [-28.1%, +65.7%] n=18 win 44%
- trend/flat by the open: flat: -14.7% [-20.8%, -8.4%] n=927 win 29%; n/a: -35.5% [-43.8%, -23.0%] n=5 win 40%; trend: -11.3% [-17.0%, -5.0%] n=822 win 30%
- time bucket: 10:00: -5.4% [-12.0%, +1.4%] n=587 win 34%; 12:00: -9.4% [-15.0%, -3.2%] n=588 win 33%; 14:00: -25.0% [-33.6%, -15.8%] n=579 win 22%

### QQQ DISCOVERY ATM straddle exit 60

- year: 2020: -9.6% [-12.4%, -6.7%] n=141 win 21%; 2021: -9.8% [-11.3%, -8.2%] n=369 win 21%; 2022: -8.4% [-10.0%, -6.6%] n=506 win 21%; 2023: -5.1% [-7.0%, -2.8%] n=742 win 27%
- GEX sign at 09:45 (MODEL): GEX<0: -6.7% [-8.1%, -5.1%] n=1011 win 23%; GEX>0: -8.4% [-9.9%, -6.8%] n=742 win 25%; n/a: -11.5% [-15.7%, -8.7%] n=5 win 20%
- VIX tercile at 09:45: VIX high: -9.0% [-10.3%, -7.7%] n=583 win 20%; VIX low: -5.0% [-7.1%, -2.5%] n=580 win 27%; VIX mid: -8.4% [-10.0%, -6.6%] n=577 win 23%; n/a: -5.0% [-14.2%, +7.5%] n=18 win 28%
- trend/flat by the open: flat: -8.1% [-9.6%, -6.3%] n=930 win 21%; n/a: -11.5% [-15.7%, -8.7%] n=5 win 20%; trend: -6.7% [-8.2%, -5.2%] n=823 win 26%
- time bucket: 10:00: -7.1% [-8.6%, -5.5%] n=587 win 24%; 12:00: -5.6% [-6.8%, -4.2%] n=589 win 23%; 14:00: -9.6% [-12.0%, -7.0%] n=582 win 23%

### QQQ DISCOVERY random side (shuffle 0) exit 60

- year: 2020: -17.2% [-26.8%, -7.7%] n=140 win 29%; 2021: -12.0% [-18.7%, -5.0%] n=357 win 32%; 2022: -9.2% [-15.9%, -2.0%] n=506 win 34%; 2023: -7.3% [-14.2%, -0.218%] n=742 win 33%
- GEX sign at 09:45 (MODEL): GEX<0: -6.1% [-11.2%, -0.714%] n=1007 win 35%; GEX>0: -14.1% [-19.8%, -8.2%] n=733 win 30%; n/a: -50.3% [-68.4%, -23.0%] n=5 win 20%
- VIX tercile at 09:45: VIX high: -13.2% [-18.6%, -7.3%] n=582 win 32%; VIX low: -4.9% [-13.2%, +2.8%] n=574 win 34%; VIX mid: -10.1% [-16.2%, -3.7%] n=571 win 33%; n/a: -26.0% [-45.7%, -9.2%] n=18 win 33%
- trend/flat by the open: flat: -9.8% [-14.8%, -5.0%] n=924 win 33%; n/a: -50.3% [-68.4%, -23.0%] n=5 win 20%; trend: -9.2% [-15.2%, -2.8%] n=816 win 32%
- time bucket: 10:00: -8.6% [-14.6%, -1.7%] n=586 win 34%; 12:00: -8.7% [-14.2%, -3.0%] n=585 win 34%; 14:00: -11.6% [-19.6%, -3.3%] n=574 win 30%

### QQQ DISCOVERY underlying B&H (no cost) exit 60

- year: 2020: -0.002% [-0.088%, +0.083%] n=141 win 55%; 2021: +0.023% [-0.006%, +0.052%] n=360 win 57%; 2022: -0.019% [-0.064%, +0.029%] n=506 win 49%; 2023: +0.008% [-0.015%, +0.032%] n=742 win 54%
- GEX sign at 09:45 (MODEL): GEX<0: -0.006% [-0.033%, +0.020%] n=1008 win 52%; GEX>0: +0.014% [-0.014%, +0.040%] n=736 win 55%; n/a: +0.047% [-0.025%, +0.094%] n=5 win 40%
- VIX tercile at 09:45: VIX high: -0.009% [-0.057%, +0.035%] n=583 win 50%; VIX low: +0.011% [-0.011%, +0.035%] n=576 win 58%; VIX mid: +0.008% [-0.024%, +0.043%] n=572 win 54%; n/a: -0.094% [-0.245%, +0.025%] n=18 win 28%
- trend/flat by the open: flat: +0.005% [-0.022%, +0.033%] n=927 win 53%; n/a: +0.047% [-0.025%, +0.094%] n=5 win 40%; trend: -0.001% [-0.030%, +0.028%] n=817 win 54%
- time bucket: 10:00: -0.028% [-0.072%, +0.016%] n=586 win 49%; 12:00: -0.008% [-0.036%, +0.020%] n=586 win 53%; 14:00: +0.044% [+0.012%, +0.075%] n=577 win 58%

### QQQ DISCOVERY long call 0.30d exit close

- year: 2020: -4.1% [-36.1%, +32.9%] n=141 win 29%; 2021: -11.0% [-32.4%, +12.9%] n=360 win 28%; 2022: -16.3% [-38.0%, +8.1%] n=506 win 24%; 2023: -14.1% [-29.2%, +0.955%] n=742 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -10.3% [-24.5%, +4.5%] n=1008 win 25%; GEX>0: -16.7% [-31.8%, -1.8%] n=736 win 26%; n/a: -97.0% [-99.0%, -94.1%] n=5 win 0%
- VIX tercile at 09:45: VIX high: -14.5% [-32.0%, +4.8%] n=583 win 25%; VIX low: -20.4% [-36.2%, -3.1%] n=576 win 24%; VIX mid: -4.2% [-22.9%, +17.1%] n=572 win 28%; n/a: -36.2% [-84.8%, +25.8%] n=18 win 22%
- trend/flat by the open: flat: -17.6% [-32.5%, -2.3%] n=927 win 24%; n/a: -97.0% [-99.0%, -94.1%] n=5 win 0%; trend: -7.9% [-23.0%, +8.7%] n=817 win 27%
- time bucket: 10:00: -9.7% [-22.9%, +4.1%] n=586 win 26%; 12:00: -11.5% [-24.3%, +2.6%] n=586 win 26%; 14:00: -18.7% [-30.8%, -6.5%] n=577 win 25%

### QQQ DISCOVERY long put 0.30d exit close

- year: 2020: -61.7% [-78.9%, -39.6%] n=140 win 16%; 2021: -30.9% [-61.0%, +0.767%] n=366 win 16%; 2022: -15.3% [-36.6%, +9.8%] n=506 win 23%; 2023: -19.0% [-38.7%, +4.1%] n=742 win 18%
- GEX sign at 09:45 (MODEL): GEX<0: -18.9% [-33.9%, +0.140%] n=1010 win 20%; GEX>0: -30.4% [-47.5%, -8.3%] n=739 win 17%; n/a: -28.5% [-79.6%, +5.5%] n=5 win 40%
- VIX tercile at 09:45: VIX high: -32.4% [-51.3%, -11.8%] n=582 win 20%; VIX low: -10.3% [-37.1%, +18.0%] n=578 win 19%; VIX mid: -29.4% [-48.9%, -8.6%] n=576 win 18%; n/a: -1.4% [-95.5%, +154.0%] n=18 win 17%
- trend/flat by the open: flat: -25.0% [-41.6%, -8.8%] n=927 win 20%; n/a: -28.5% [-79.6%, +5.5%] n=5 win 40%; trend: -22.4% [-42.2%, -4.1%] n=822 win 18%
- time bucket: 10:00: -16.2% [-30.9%, -0.147%] n=587 win 21%; 12:00: -26.5% [-41.3%, -9.8%] n=588 win 18%; 14:00: -28.7% [-43.6%, -12.9%] n=579 win 17%

### QQQ DISCOVERY ATM straddle exit close

- year: 2020: -20.1% [-29.9%, -9.4%] n=141 win 33%; 2021: -13.3% [-22.2%, -3.2%] n=369 win 31%; 2022: -11.4% [-19.5%, -3.1%] n=506 win 35%; 2023: -8.8% [-15.4%, -2.0%] n=742 win 36%
- GEX sign at 09:45 (MODEL): GEX<0: -9.0% [-14.2%, -3.4%] n=1011 win 35%; GEX>0: -14.4% [-20.1%, -8.2%] n=742 win 33%; n/a: -42.9% [-60.9%, -30.9%] n=5 win 0%
- VIX tercile at 09:45: VIX high: -15.2% [-21.8%, -8.0%] n=583 win 33%; VIX low: -8.0% [-15.6%, +0.048%] n=580 win 35%; VIX mid: -11.2% [-17.5%, -4.4%] n=577 win 34%; n/a: -6.0% [-40.1%, +36.4%] n=18 win 22%
- trend/flat by the open: flat: -13.0% [-18.6%, -7.8%] n=930 win 34%; n/a: -42.9% [-60.9%, -30.9%] n=5 win 0%; trend: -9.4% [-15.1%, -3.7%] n=823 win 34%
- time bucket: 10:00: -8.2% [-13.4%, -2.9%] n=587 win 37%; 12:00: -12.8% [-17.6%, -7.2%] n=589 win 33%; 14:00: -13.2% [-18.6%, -8.1%] n=582 win 32%

### QQQ DISCOVERY random side (shuffle 0) exit close

- year: 2020: -24.4% [-47.8%, +2.0%] n=140 win 24%; 2021: -17.4% [-39.2%, +5.4%] n=357 win 21%; 2022: -15.5% [-31.8%, +2.4%] n=506 win 24%; 2023: -15.3% [-28.9%, +0.472%] n=742 win 22%
- GEX sign at 09:45 (MODEL): GEX<0: -12.5% [-24.3%, +0.344%] n=1007 win 24%; GEX>0: -21.6% [-35.0%, -7.2%] n=733 win 21%; n/a: -88.9% [-95.1%, -79.6%] n=5 win 0%
- VIX tercile at 09:45: VIX high: -20.5% [-35.9%, -4.4%] n=582 win 23%; VIX low: -15.0% [-32.1%, +3.0%] n=574 win 22%; VIX mid: -12.9% [-29.3%, +4.2%] n=571 win 23%; n/a: -48.0% [-84.8%, +0.986%] n=18 win 17%
- trend/flat by the open: flat: -18.6% [-31.4%, -6.5%] n=924 win 23%; n/a: -88.9% [-95.1%, -79.6%] n=5 win 0%; trend: -13.7% [-28.0%, +0.522%] n=816 win 23%
- time bucket: 10:00: -16.5% [-30.2%, -1.5%] n=586 win 23%; 12:00: -12.4% [-27.2%, +5.6%] n=585 win 23%; 14:00: -20.8% [-34.2%, -5.7%] n=574 win 21%

### QQQ DISCOVERY underlying B&H (no cost) exit close

- year: 2020: +0.197% [-0.151%, +0.555%] n=141 win 60%; 2021: +0.082% [-0.021%, +0.180%] n=360 win 57%; 2022: -0.030% [-0.191%, +0.122%] n=506 win 50%; 2023: +0.041% [-0.030%, +0.110%] n=742 win 56%
- GEX sign at 09:45 (MODEL): GEX<0: +0.044% [-0.051%, +0.137%] n=1008 win 54%; GEX>0: +0.042% [-0.045%, +0.117%] n=736 win 57%; n/a: -0.444% [-0.581%, -0.238%] n=5 win 0%
- VIX tercile at 09:45: VIX high: +0.049% [-0.100%, +0.202%] n=583 win 52%; VIX low: +0.003% [-0.068%, +0.069%] n=576 win 55%; VIX mid: +0.075% [-0.022%, +0.169%] n=572 win 57%; n/a: -0.036% [-0.463%, +0.305%] n=18 win 50%
- trend/flat by the open: flat: +0.024% [-0.068%, +0.115%] n=927 win 55%; n/a: -0.444% [-0.581%, -0.238%] n=5 win 0%; trend: +0.064% [-0.021%, +0.157%] n=817 win 55%
- time bucket: 10:00: +0.033% [-0.062%, +0.120%] n=586 win 54%; 12:00: +0.042% [-0.021%, +0.109%] n=586 win 56%; 14:00: +0.050% [-0.005%, +0.102%] n=577 win 55%

### QQQ CALIBRATION long call 0.30d exit 60

- year: 2024: -12.6% [-17.9%, -6.5%] n=752 win 32%
- GEX sign at 09:45 (MODEL): GEX<0: -10.1% [-18.0%, -1.7%] n=329 win 35%; GEX>0: -14.5% [-21.9%, -6.5%] n=423 win 30%
- VIX tercile at 09:45: VIX high: -11.9% [-41.2%, +16.3%] n=12 win 33%; VIX low: -11.7% [-18.8%, -4.9%] n=582 win 32%; VIX mid: -15.9% [-27.2%, -4.1%] n=140 win 32%; n/a: -14.6% [-49.4%, +24.1%] n=18 win 33%
- trend/flat by the open: flat: -9.6% [-18.2%, -0.432%] n=370 win 33%; trend: -15.5% [-22.3%, -8.2%] n=382 win 31%
- time bucket: 10:00: -9.7% [-18.2%, -0.650%] n=252 win 36%; 12:00: -5.3% [-14.2%, +3.3%] n=251 win 36%; 14:00: -22.8% [-34.3%, -9.6%] n=249 win 24%

### QQQ CALIBRATION long put 0.30d exit 60

- year: 2024: -4.2% [-12.2%, +5.7%] n=752 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -4.9% [-15.1%, +6.4%] n=329 win 33%; GEX>0: -3.6% [-15.2%, +10.2%] n=423 win 26%
- VIX tercile at 09:45: VIX high: -30.3% [-53.6%, +6.2%] n=12 win 25%; VIX low: -3.4% [-13.8%, +8.1%] n=582 win 29%; VIX mid: -3.3% [-19.5%, +14.1%] n=140 win 31%; n/a: -17.3% [-47.1%, +13.8%] n=18 win 28%
- trend/flat by the open: flat: -8.4% [-17.7%, +0.969%] n=370 win 28%; trend: -0.046% [-13.6%, +15.9%] n=382 win 30%
- time bucket: 10:00: -3.9% [-15.4%, +10.3%] n=252 win 29%; 12:00: -5.3% [-14.6%, +4.5%] n=251 win 31%; 14:00: -3.3% [-23.0%, +25.8%] n=249 win 27%

### QQQ CALIBRATION ATM straddle exit 60

- year: 2024: -5.1% [-6.9%, -3.0%] n=753 win 26%
- GEX sign at 09:45 (MODEL): GEX<0: -3.9% [-6.1%, -1.1%] n=330 win 28%; GEX>0: -6.1% [-8.8%, -3.1%] n=423 win 25%
- VIX tercile at 09:45: VIX high: -13.4% [-20.0%, -9.3%] n=12 win 17%; VIX low: -4.7% [-7.1%, -2.5%] n=582 win 26%; VIX mid: -5.1% [-9.2%, -0.125%] n=141 win 26%; n/a: -11.0% [-17.8%, -1.6%] n=18 win 33%
- trend/flat by the open: flat: -5.1% [-7.5%, -2.5%] n=371 win 26%; trend: -5.1% [-8.0%, -1.8%] n=382 win 26%
- time bucket: 10:00: -4.5% [-7.4%, -1.1%] n=252 win 25%; 12:00: -3.2% [-5.1%, -1.1%] n=252 win 30%; 14:00: -7.7% [-12.7%, -1.8%] n=249 win 23%

### QQQ CALIBRATION random side (shuffle 0) exit 60

- year: 2024: -4.5% [-12.6%, +5.2%] n=751 win 32%
- GEX sign at 09:45 (MODEL): GEX<0: -0.871% [-10.4%, +9.6%] n=328 win 38%; GEX>0: -7.3% [-19.6%, +6.9%] n=423 win 28%
- VIX tercile at 09:45: VIX high: -15.1% [-55.2%, +24.8%] n=12 win 33%; VIX low: -4.5% [-14.2%, +6.7%] n=582 win 31%; VIX mid: -1.3% [-15.4%, +15.0%] n=139 win 35%; n/a: -22.4% [-56.0%, +13.7%] n=18 win 22%
- trend/flat by the open: flat: +0.577% [-9.5%, +11.1%] n=369 win 35%; trend: -9.3% [-21.7%, +7.6%] n=382 win 29%
- time bucket: 10:00: -7.5% [-17.1%, +4.4%] n=252 win 33%; 12:00: -4.3% [-13.5%, +6.0%] n=250 win 32%; 14:00: -1.6% [-21.2%, +24.5%] n=249 win 31%

### QQQ CALIBRATION underlying B&H (no cost) exit 60

- year: 2024: -0.011% [-0.036%, +0.012%] n=752 win 52%
- GEX sign at 09:45 (MODEL): GEX<0: -0.002% [-0.042%, +0.036%] n=329 win 52%; GEX>0: -0.018% [-0.050%, +0.011%] n=423 win 52%
- VIX tercile at 09:45: VIX high: +0.160% [-0.159%, +0.366%] n=12 win 58%; VIX low: -0.015% [-0.039%, +0.012%] n=582 win 52%; VIX mid: -0.013% [-0.073%, +0.049%] n=140 win 53%; n/a: +0.006% [-0.098%, +0.106%] n=18 win 56%
- trend/flat by the open: flat: +0.007% [-0.025%, +0.039%] n=370 win 50%; trend: -0.028% [-0.063%, +0.007%] n=382 win 54%
- time bucket: 10:00: -0.013% [-0.069%, +0.039%] n=252 win 50%; 12:00: -0.003% [-0.040%, +0.029%] n=251 win 53%; 14:00: -0.017% [-0.054%, +0.017%] n=249 win 53%

### QQQ CALIBRATION long call 0.30d exit close

- year: 2024: -18.0% [-34.7%, +0.679%] n=752 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -26.4% [-49.8%, +0.923%] n=329 win 22%; GEX>0: -11.4% [-35.3%, +16.0%] n=423 win 23%
- VIX tercile at 09:45: VIX high: -70.8% [-99.2%, -42.5%] n=12 win 8%; VIX low: -12.7% [-32.9%, +9.4%] n=582 win 24%; VIX mid: -33.9% [-69.7%, +14.9%] n=140 win 18%; n/a: -27.8% [-101.1%, +54.4%] n=18 win 28%
- trend/flat by the open: flat: -13.2% [-41.4%, +19.6%] n=370 win 20%; trend: -22.5% [-41.3%, -0.913%] n=382 win 25%
- time bucket: 10:00: -16.7% [-37.0%, +4.5%] n=252 win 24%; 12:00: -10.3% [-32.6%, +12.7%] n=251 win 24%; 14:00: -26.9% [-46.6%, -4.8%] n=249 win 20%

### QQQ CALIBRATION long put 0.30d exit close

- year: 2024: -12.1% [-38.7%, +21.6%] n=752 win 19%
- GEX sign at 09:45 (MODEL): GEX<0: -17.2% [-43.7%, +16.7%] n=329 win 22%; GEX>0: -8.2% [-46.5%, +42.0%] n=423 win 16%
- VIX tercile at 09:45: VIX high: -45.1% [-96.7%, +45.1%] n=12 win 17%; VIX low: -13.9% [-48.0%, +28.1%] n=582 win 17%; VIX mid: -13.0% [-50.7%, +27.5%] n=140 win 24%; n/a: +75.1% [-45.2%, +213.6%] n=18 win 39%
- trend/flat by the open: flat: -21.8% [-46.1%, +10.1%] n=370 win 19%; trend: -2.8% [-46.1%, +55.4%] n=382 win 19%
- time bucket: 10:00: -10.4% [-39.7%, +22.4%] n=252 win 17%; 12:00: -12.3% [-42.4%, +26.9%] n=251 win 20%; 14:00: -13.7% [-43.9%, +31.8%] n=249 win 19%

### QQQ CALIBRATION ATM straddle exit close

- year: 2024: -11.9% [-19.7%, -3.8%] n=753 win 30%
- GEX sign at 09:45 (MODEL): GEX<0: -14.1% [-23.7%, -3.0%] n=330 win 31%; GEX>0: -10.2% [-20.3%, +2.0%] n=423 win 29%
- VIX tercile at 09:45: VIX high: -32.2% [-52.2%, -5.0%] n=12 win 8%; VIX low: -11.9% [-20.7%, -2.0%] n=582 win 30%; VIX mid: -14.7% [-29.1%, +1.6%] n=141 win 27%; n/a: +23.3% [-8.1%, +55.5%] n=18 win 61%
- trend/flat by the open: flat: -14.0% [-23.5%, -2.0%] n=371 win 28%; trend: -9.9% [-20.2%, +3.1%] n=382 win 32%
- time bucket: 10:00: -13.2% [-22.0%, -3.9%] n=252 win 30%; 12:00: -8.2% [-18.0%, +1.5%] n=252 win 33%; 14:00: -14.4% [-23.3%, -4.4%] n=249 win 27%

### QQQ CALIBRATION random side (shuffle 0) exit close

- year: 2024: -9.6% [-30.3%, +13.3%] n=751 win 21%
- GEX sign at 09:45 (MODEL): GEX<0: -18.2% [-40.2%, +4.6%] n=328 win 22%; GEX>0: -2.9% [-33.7%, +34.2%] n=423 win 21%
- VIX tercile at 09:45: VIX high: -92.0% [-99.9%, -83.9%] n=12 win 0%; VIX low: -6.7% [-29.6%, +21.6%] n=582 win 21%; VIX mid: -17.4% [-51.2%, +22.8%] n=139 win 22%; n/a: +12.0% [-75.4%, +112.8%] n=18 win 33%
- trend/flat by the open: flat: -1.7% [-24.7%, +27.8%] n=369 win 23%; trend: -17.3% [-44.0%, +21.1%] n=382 win 19%
- time bucket: 10:00: -1.9% [-29.9%, +28.6%] n=252 win 22%; 12:00: -18.9% [-40.7%, +6.4%] n=250 win 21%; 14:00: -8.1% [-39.5%, +34.8%] n=249 win 20%

### QQQ CALIBRATION underlying B&H (no cost) exit close

- year: 2024: -0.010% [-0.085%, +0.052%] n=752 win 53%
- GEX sign at 09:45 (MODEL): GEX<0: -0.036% [-0.138%, +0.064%] n=329 win 49%; GEX>0: +0.010% [-0.077%, +0.095%] n=423 win 57%
- VIX tercile at 09:45: VIX high: +0.076% [-0.411%, +0.563%] n=12 win 50%; VIX low: +0.004% [-0.075%, +0.078%] n=582 win 55%; VIX mid: -0.048% [-0.213%, +0.119%] n=140 win 46%; n/a: -0.230% [-0.605%, +0.167%] n=18 win 39%
- trend/flat by the open: flat: -0.007% [-0.100%, +0.078%] n=370 win 52%; trend: -0.013% [-0.112%, +0.074%] n=382 win 54%
- time bucket: 10:00: +0.006% [-0.092%, +0.102%] n=252 win 56%; 12:00: -0.007% [-0.079%, +0.066%] n=251 win 52%; 14:00: -0.031% [-0.088%, +0.020%] n=249 win 52%

### IWM DISCOVERY long call 0.30d exit 60

- year: 2020: -20.4% [-32.0%, -9.0%] n=144 win 28%; 2021: -15.2% [-25.7%, -4.2%] n=223 win 29%; 2022: -13.2% [-20.7%, -5.9%] n=463 win 32%; 2023: -22.9% [-29.4%, -15.6%] n=439 win 27%
- GEX sign at 09:45 (MODEL): GEX<0: -16.7% [-22.2%, -10.4%] n=704 win 31%; GEX>0: -19.0% [-25.6%, -12.5%] n=563 win 28%; n/a: -29.6% [-29.6%, -29.6%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -13.2% [-20.4%, -6.2%] n=427 win 32%; VIX low: -19.1% [-26.9%, -11.6%] n=407 win 28%; VIX mid: -20.7% [-27.3%, -12.9%] n=421 win 29%; n/a: -29.9% [-51.7%, -7.1%] n=14 win 21%
- trend/flat by the open: flat: -19.8% [-25.2%, -14.1%] n=650 win 28%; n/a: -29.6% [-29.6%, -29.6%] n=2 win 0%; trend: -15.6% [-21.6%, -8.9%] n=617 win 30%
- time bucket: 10:00: -19.2% [-25.8%, -12.0%] n=435 win 31%; 12:00: -15.4% [-21.7%, -9.2%] n=428 win 29%; 14:00: -18.7% [-27.0%, -9.9%] n=406 win 29%

### IWM DISCOVERY long put 0.30d exit 60

- year: 2020: -15.8% [-26.1%, -3.9%] n=144 win 28%; 2021: -23.9% [-32.4%, -14.8%] n=226 win 26%; 2022: -16.3% [-23.2%, -9.0%] n=466 win 29%; 2023: -12.0% [-22.0%, +0.344%] n=443 win 29%
- GEX sign at 09:45 (MODEL): GEX<0: -18.2% [-24.0%, -12.4%] n=707 win 29%; GEX>0: -13.3% [-21.9%, -3.3%] n=570 win 29%; n/a: -61.1% [-61.1%, -61.1%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -13.5% [-20.1%, -6.8%] n=427 win 31%; VIX low: -14.7% [-26.1%, -0.703%] n=415 win 27%; VIX mid: -19.9% [-26.8%, -13.1%] n=423 win 27%; n/a: -21.3% [-54.3%, +11.1%] n=14 win 29%
- trend/flat by the open: flat: -17.3% [-23.0%, -10.8%] n=658 win 27%; n/a: -61.1% [-61.1%, -61.1%] n=2 win 0%; trend: -14.6% [-22.5%, -5.6%] n=619 win 30%
- time bucket: 10:00: -14.0% [-21.2%, -6.8%] n=435 win 34%; 12:00: -13.1% [-19.3%, -6.6%] n=432 win 29%; 14:00: -21.4% [-34.3%, -4.3%] n=412 win 23%

### IWM DISCOVERY ATM straddle exit 60

- year: 2020: -12.5% [-16.0%, -8.9%] n=144 win 22%; 2021: -11.8% [-14.0%, -9.6%] n=227 win 18%; 2022: -9.7% [-11.5%, -7.8%] n=466 win 22%; 2023: -11.7% [-14.5%, -8.9%] n=462 win 18%
- GEX sign at 09:45 (MODEL): GEX<0: -11.2% [-12.7%, -9.8%] n=716 win 19%; GEX>0: -10.9% [-13.2%, -8.6%] n=581 win 21%; n/a: -24.7% [-24.7%, -24.7%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -9.5% [-11.3%, -7.6%] n=427 win 22%; VIX low: -11.4% [-14.4%, -8.2%] n=430 win 20%; VIX mid: -12.3% [-14.1%, -10.5%] n=427 win 18%; n/a: -15.5% [-20.8%, -9.1%] n=15 win 13%
- trend/flat by the open: flat: -11.9% [-13.6%, -10.0%] n=663 win 19%; n/a: -24.7% [-24.7%, -24.7%] n=2 win 0%; trend: -10.3% [-12.2%, -8.0%] n=634 win 21%
- time bucket: 10:00: -11.3% [-13.0%, -9.5%] n=435 win 20%; 12:00: -9.4% [-10.9%, -7.9%] n=434 win 20%; 14:00: -12.7% [-15.4%, -9.5%] n=430 win 20%

### IWM DISCOVERY random side (shuffle 0) exit 60

- year: 2020: -25.7% [-37.8%, -11.4%] n=144 win 25%; 2021: -24.7% [-32.8%, -16.0%] n=222 win 25%; 2022: -15.6% [-22.2%, -8.6%] n=463 win 31%; 2023: -20.2% [-27.9%, -12.0%] n=420 win 28%
- GEX sign at 09:45 (MODEL): GEX<0: -21.5% [-26.6%, -15.9%] n=695 win 27%; GEX>0: -17.8% [-24.3%, -10.6%] n=552 win 29%; n/a: -61.1% [-61.1%, -61.1%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -19.8% [-27.4%, -11.9%] n=427 win 29%; VIX low: -22.7% [-29.8%, -15.5%] n=392 win 27%; VIX mid: -16.7% [-24.0%, -9.6%] n=417 win 29%; n/a: -41.6% [-59.4%, -19.0%] n=13 win 15%
- trend/flat by the open: flat: -21.4% [-27.2%, -15.1%] n=645 win 27%; n/a: -61.1% [-61.1%, -61.1%] n=2 win 0%; trend: -18.2% [-24.2%, -12.7%] n=602 win 29%
- time bucket: 10:00: -19.0% [-26.4%, -11.7%] n=435 win 31%; 12:00: -19.9% [-25.7%, -14.2%] n=426 win 26%; 14:00: -20.9% [-28.7%, -11.8%] n=388 win 27%

### IWM DISCOVERY underlying B&H (no cost) exit 60

- year: 2020: -0.026% [-0.119%, +0.064%] n=144 win 53%; 2021: +0.024% [-0.028%, +0.079%] n=223 win 51%; 2022: +0.004% [-0.044%, +0.049%] n=463 win 51%; 2023: -0.013% [-0.045%, +0.022%] n=439 win 50%
- GEX sign at 09:45 (MODEL): GEX<0: -0.005% [-0.041%, +0.035%] n=704 win 51%; GEX>0: +0.001% [-0.036%, +0.037%] n=563 win 51%; n/a: +0.222% [+0.222%, +0.222%] n=2 win 100%
- VIX tercile at 09:45: VIX high: -0.013% [-0.065%, +0.039%] n=427 win 52%; VIX low: +0.007% [-0.031%, +0.045%] n=407 win 51%; VIX mid: +0.000% [-0.038%, +0.039%] n=421 win 50%; n/a: -0.022% [-0.156%, +0.094%] n=14 win 50%
- trend/flat by the open: flat: +0.000% [-0.035%, +0.035%] n=650 win 51%; n/a: +0.222% [+0.222%, +0.222%] n=2 win 100%; trend: -0.005% [-0.041%, +0.030%] n=617 win 51%
- time bucket: 10:00: -0.023% [-0.079%, +0.035%] n=435 win 51%; 12:00: -0.009% [-0.048%, +0.029%] n=428 win 49%; 14:00: +0.028% [-0.020%, +0.072%] n=406 win 53%

### IWM DISCOVERY long call 0.30d exit close

- year: 2020: -44.4% [-66.3%, -19.7%] n=144 win 19%; 2021: -33.9% [-56.9%, -7.3%] n=223 win 20%; 2022: -29.2% [-48.6%, -7.1%] n=463 win 21%; 2023: -44.8% [-63.2%, -21.1%] n=439 win 17%
- GEX sign at 09:45 (MODEL): GEX<0: -30.7% [-46.1%, -13.2%] n=704 win 21%; GEX>0: -45.1% [-61.8%, -26.7%] n=563 win 17%; n/a: -73.6% [-73.6%, -73.6%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -26.1% [-45.0%, -4.5%] n=427 win 22%; VIX low: -49.4% [-68.8%, -27.2%] n=407 win 15%; VIX mid: -35.6% [-52.7%, -15.0%] n=421 win 21%; n/a: -64.0% [-90.1%, -41.4%] n=14 win 14%
- trend/flat by the open: flat: -36.7% [-52.2%, -19.9%] n=650 win 20%; n/a: -73.6% [-73.6%, -73.6%] n=2 win 0%; trend: -37.5% [-53.2%, -21.3%] n=617 win 19%
- time bucket: 10:00: -31.2% [-46.2%, -15.7%] n=435 win 19%; 12:00: -38.9% [-52.2%, -23.9%] n=428 win 18%; 14:00: -41.7% [-52.2%, -30.7%] n=406 win 20%

### IWM DISCOVERY long put 0.30d exit close

- year: 2020: -68.6% [-83.5%, -47.8%] n=144 win 12%; 2021: -28.6% [-63.9%, +15.9%] n=226 win 17%; 2022: -16.5% [-42.2%, +16.8%] n=466 win 21%; 2023: -24.0% [-53.3%, +12.3%] n=443 win 18%
- GEX sign at 09:45 (MODEL): GEX<0: -38.6% [-53.4%, -21.8%] n=707 win 18%; GEX>0: -12.5% [-44.2%, +25.1%] n=570 win 18%; n/a: -101.8% [-101.8%, -101.8%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -42.4% [-60.4%, -22.2%] n=427 win 17%; VIX low: -2.6% [-40.6%, +45.2%] n=415 win 19%; VIX mid: -33.9% [-55.3%, -11.2%] n=423 win 19%; n/a: -82.8% [-102.3%, -50.3%] n=14 win 7%
- trend/flat by the open: flat: -31.7% [-50.9%, -7.5%] n=658 win 19%; n/a: -101.8% [-101.8%, -101.8%] n=2 win 0%; trend: -21.9% [-47.9%, +9.3%] n=619 win 18%
- time bucket: 10:00: -25.1% [-43.8%, -6.8%] n=435 win 19%; 12:00: -26.2% [-44.4%, -6.3%] n=432 win 18%; 14:00: -30.1% [-51.0%, -0.735%] n=412 win 18%

### IWM DISCOVERY ATM straddle exit close

- year: 2020: -33.0% [-40.6%, -24.7%] n=144 win 20%; 2021: -18.1% [-29.1%, -5.7%] n=227 win 26%; 2022: -16.5% [-24.5%, -8.1%] n=466 win 31%; 2023: -23.4% [-31.7%, -14.2%] n=462 win 25%
- GEX sign at 09:45 (MODEL): GEX<0: -21.7% [-27.2%, -16.5%] n=716 win 27%; GEX>0: -20.2% [-28.0%, -11.4%] n=581 win 26%; n/a: -51.1% [-51.1%, -51.1%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -22.2% [-29.2%, -15.1%] n=427 win 28%; VIX low: -18.8% [-28.2%, -6.8%] n=430 win 24%; VIX mid: -21.3% [-28.0%, -13.9%] n=427 win 29%; n/a: -45.0% [-56.1%, -31.4%] n=15 win 13%
- trend/flat by the open: flat: -22.1% [-28.2%, -15.2%] n=663 win 28%; n/a: -51.1% [-51.1%, -51.1%] n=2 win 0%; trend: -19.9% [-27.2%, -12.2%] n=634 win 26%
- time bucket: 10:00: -18.5% [-24.3%, -12.7%] n=435 win 29%; 12:00: -22.6% [-28.4%, -16.2%] n=434 win 25%; 14:00: -22.0% [-27.6%, -16.0%] n=430 win 26%

### IWM DISCOVERY random side (shuffle 0) exit close

- year: 2020: -66.6% [-77.8%, -53.8%] n=144 win 12%; 2021: -42.4% [-59.6%, -21.4%] n=222 win 15%; 2022: -19.2% [-36.7%, -0.399%] n=463 win 23%; 2023: -42.2% [-57.9%, -23.6%] n=420 win 18%
- GEX sign at 09:45 (MODEL): GEX<0: -35.9% [-47.3%, -23.9%] n=695 win 20%; GEX>0: -37.2% [-52.9%, -19.7%] n=552 win 17%; n/a: -101.8% [-101.8%, -101.8%] n=2 win 0%
- VIX tercile at 09:45: VIX high: -37.0% [-52.0%, -19.3%] n=427 win 19%; VIX low: -42.6% [-62.1%, -21.9%] n=392 win 14%; VIX mid: -28.9% [-43.4%, -12.6%] n=417 win 23%; n/a: -85.8% [-100.5%, -58.1%] n=13 win 8%
- trend/flat by the open: flat: -35.6% [-49.3%, -22.0%] n=645 win 19%; n/a: -101.8% [-101.8%, -101.8%] n=2 win 0%; trend: -37.3% [-50.8%, -23.3%] n=602 win 18%
- time bucket: 10:00: -27.9% [-43.9%, -6.9%] n=435 win 18%; 12:00: -41.2% [-54.1%, -27.5%] n=426 win 18%; 14:00: -41.1% [-53.0%, -28.0%] n=388 win 19%

### IWM DISCOVERY underlying B&H (no cost) exit close

- year: 2020: +0.108% [-0.213%, +0.413%] n=144 win 58%; 2021: +0.055% [-0.125%, +0.226%] n=223 win 54%; 2022: -0.031% [-0.176%, +0.123%] n=463 win 51%; 2023: -0.016% [-0.116%, +0.085%] n=439 win 48%
- GEX sign at 09:45 (MODEL): GEX<0: +0.046% [-0.077%, +0.174%] n=704 win 54%; GEX>0: -0.049% [-0.151%, +0.060%] n=563 win 49%; n/a: +0.775% [+0.775%, +0.775%] n=2 win 100%
- VIX tercile at 09:45: VIX high: +0.059% [-0.121%, +0.245%] n=427 win 53%; VIX low: -0.052% [-0.162%, +0.051%] n=407 win 47%; VIX mid: +0.002% [-0.112%, +0.129%] n=421 win 54%; n/a: +0.099% [-0.118%, +0.273%] n=14 win 50%
- trend/flat by the open: flat: +0.014% [-0.113%, +0.139%] n=650 win 52%; n/a: +0.775% [+0.775%, +0.775%] n=2 win 100%; trend: -0.007% [-0.105%, +0.092%] n=617 win 51%
- time bucket: 10:00: -0.015% [-0.117%, +0.090%] n=435 win 49%; 12:00: +0.003% [-0.088%, +0.098%] n=428 win 52%; 14:00: +0.029% [-0.048%, +0.098%] n=406 win 54%

### IWM CALIBRATION long call 0.30d exit 60

- year: 2024: -23.5% [-29.5%, -17.9%] n=640 win 26%
- GEX sign at 09:45 (MODEL): GEX<0: -23.9% [-32.2%, -14.4%] n=244 win 27%; GEX>0: -23.3% [-30.6%, -15.4%] n=396 win 26%
- VIX tercile at 09:45: VIX high: -28.9% [-54.9%, -8.7%] n=12 win 25%; VIX low: -22.9% [-29.4%, -16.0%] n=504 win 27%; VIX mid: -25.9% [-41.4%, -12.8%] n=109 win 24%; n/a: -23.0% [-48.9%, +22.6%] n=15 win 20%
- trend/flat by the open: flat: -19.1% [-28.1%, -9.9%] n=306 win 30%; trend: -27.5% [-34.9%, -20.1%] n=334 win 22%
- time bucket: 10:00: -17.4% [-27.7%, -6.1%] n=224 win 29%; 12:00: -17.0% [-26.0%, -7.5%] n=222 win 30%; 14:00: -38.1% [-47.8%, -29.2%] n=194 win 18%

### IWM CALIBRATION long put 0.30d exit 60

- year: 2024: -15.6% [-22.6%, -8.5%] n=657 win 27%
- GEX sign at 09:45 (MODEL): GEX<0: -21.1% [-31.4%, -10.1%] n=249 win 27%; GEX>0: -12.2% [-21.4%, -2.5%] n=408 win 27%
- VIX tercile at 09:45: VIX high: -48.1% [-67.9%, -19.7%] n=12 win 8%; VIX low: -13.9% [-22.4%, -5.3%] n=517 win 27%; VIX mid: -17.4% [-29.9%, -0.637%] n=110 win 30%; n/a: -30.4% [-42.8%, -20.6%] n=18 win 28%
- trend/flat by the open: flat: -14.5% [-24.8%, -2.5%] n=314 win 26%; trend: -16.6% [-26.4%, -6.7%] n=343 win 28%
- time bucket: 10:00: -14.7% [-27.3%, -1.9%] n=224 win 27%; 12:00: -11.7% [-20.9%, -2.0%] n=223 win 30%; 14:00: -20.6% [-34.1%, -4.8%] n=210 win 24%

### IWM CALIBRATION ATM straddle exit 60

- year: 2024: -11.2% [-13.1%, -9.2%] n=669 win 23%
- GEX sign at 09:45 (MODEL): GEX<0: -11.7% [-14.5%, -8.8%] n=252 win 24%; GEX>0: -10.9% [-13.5%, -8.3%] n=417 win 22%
- VIX tercile at 09:45: VIX high: -23.2% [-26.5%, -21.1%] n=12 win 0%; VIX low: -10.8% [-12.9%, -8.6%] n=528 win 24%; VIX mid: -10.6% [-15.3%, -5.9%] n=111 win 21%; n/a: -18.5% [-26.9%, -5.7%] n=18 win 11%
- trend/flat by the open: flat: -10.1% [-13.3%, -6.8%] n=322 win 24%; trend: -12.2% [-14.5%, -10.0%] n=347 win 22%
- time bucket: 10:00: -11.4% [-14.8%, -8.0%] n=224 win 21%; 12:00: -7.3% [-9.8%, -4.8%] n=224 win 27%; 14:00: -14.9% [-18.7%, -10.4%] n=221 win 21%

### IWM CALIBRATION random side (shuffle 0) exit 60

- year: 2024: -15.9% [-22.3%, -9.0%] n=628 win 28%
- GEX sign at 09:45 (MODEL): GEX<0: -14.7% [-24.8%, -3.5%] n=241 win 30%; GEX>0: -16.7% [-24.9%, -7.6%] n=387 win 26%
- VIX tercile at 09:45: VIX high: -49.0% [-67.9%, -39.5%] n=12 win 8%; VIX low: -15.0% [-22.7%, -7.1%] n=493 win 28%; VIX mid: -16.7% [-29.8%, -1.9%] n=108 win 28%; n/a: -13.9% [-37.6%, +13.3%] n=15 win 33%
- trend/flat by the open: flat: -12.2% [-22.4%, -1.4%] n=298 win 30%; trend: -19.2% [-27.7%, -10.7%] n=330 win 25%
- time bucket: 10:00: -15.1% [-26.3%, -2.3%] n=224 win 27%; 12:00: -13.4% [-22.7%, -2.8%] n=221 win 31%; 14:00: -19.9% [-34.2%, -4.1%] n=183 win 25%

### IWM CALIBRATION underlying B&H (no cost) exit 60

- year: 2024: -0.007% [-0.042%, +0.026%] n=640 win 51%
- GEX sign at 09:45 (MODEL): GEX<0: +0.021% [-0.036%, +0.083%] n=244 win 54%; GEX>0: -0.025% [-0.069%, +0.020%] n=396 win 49%
- VIX tercile at 09:45: VIX high: +0.179% [+0.042%, +0.312%] n=12 win 67%; VIX low: -0.008% [-0.048%, +0.031%] n=504 win 52%; VIX mid: -0.031% [-0.109%, +0.034%] n=109 win 46%; n/a: +0.025% [-0.043%, +0.129%] n=15 win 60%
- trend/flat by the open: flat: +0.002% [-0.058%, +0.056%] n=306 win 51%; trend: -0.016% [-0.060%, +0.028%] n=334 win 51%
- time bucket: 10:00: +0.002% [-0.066%, +0.068%] n=224 win 54%; 12:00: -0.008% [-0.045%, +0.027%] n=222 win 50%; 14:00: -0.018% [-0.078%, +0.037%] n=194 win 49%

### IWM CALIBRATION long call 0.30d exit close

- year: 2024: -39.8% [-54.8%, -22.1%] n=640 win 16%
- GEX sign at 09:45 (MODEL): GEX<0: -52.9% [-75.0%, -26.5%] n=244 win 12%; GEX>0: -31.8% [-53.5%, -9.4%] n=396 win 18%
- VIX tercile at 09:45: VIX high: -86.3% [-98.1%, -74.5%] n=12 win 0%; VIX low: -37.8% [-55.9%, -17.5%] n=504 win 16%; VIX mid: -41.1% [-74.9%, -1.5%] n=109 win 15%; n/a: -62.6% [-98.9%, -18.6%] n=15 win 13%
- trend/flat by the open: flat: -30.5% [-56.9%, -1.0%] n=306 win 16%; trend: -48.4% [-65.0%, -28.7%] n=334 win 15%
- time bucket: 10:00: -27.1% [-49.5%, -1.8%] n=224 win 19%; 12:00: -38.6% [-58.7%, -17.7%] n=222 win 15%; 14:00: -56.0% [-71.5%, -37.8%] n=194 win 12%

### IWM CALIBRATION long put 0.30d exit close

- year: 2024: -19.8% [-38.8%, +1.3%] n=657 win 21%
- GEX sign at 09:45 (MODEL): GEX<0: -42.1% [-62.2%, -19.1%] n=249 win 17%; GEX>0: -6.2% [-34.4%, +26.0%] n=408 win 23%
- VIX tercile at 09:45: VIX high: -85.4% [-101.8%, -55.9%] n=12 win 8%; VIX low: -15.4% [-39.6%, +8.7%] n=517 win 22%; VIX mid: -32.5% [-65.4%, +13.1%] n=110 win 17%; n/a: -24.7% [-99.6%, +85.7%] n=18 win 28%
- trend/flat by the open: flat: -13.6% [-41.2%, +23.9%] n=314 win 22%; trend: -25.4% [-49.7%, +1.4%] n=343 win 20%
- time bucket: 10:00: -11.2% [-35.8%, +13.4%] n=224 win 24%; 12:00: -21.9% [-44.4%, +5.8%] n=223 win 20%; 14:00: -26.6% [-50.7%, -1.2%] n=210 win 19%

### IWM CALIBRATION ATM straddle exit close

- year: 2024: -17.9% [-24.2%, -10.9%] n=669 win 30%
- GEX sign at 09:45 (MODEL): GEX<0: -25.0% [-33.9%, -16.0%] n=252 win 26%; GEX>0: -13.6% [-22.6%, -4.9%] n=417 win 33%
- VIX tercile at 09:45: VIX high: -51.2% [-55.6%, -48.1%] n=12 win 8%; VIX low: -16.3% [-23.8%, -9.2%] n=528 win 31%; VIX mid: -18.8% [-32.0%, -3.4%] n=111 win 30%; n/a: -35.2% [-54.6%, -4.1%] n=18 win 17%
- trend/flat by the open: flat: -16.0% [-26.2%, -4.4%] n=322 win 30%; trend: -19.6% [-27.3%, -11.7%] n=347 win 30%
- time bucket: 10:00: -15.8% [-24.1%, -6.3%] n=224 win 33%; 12:00: -16.7% [-24.8%, -8.1%] n=224 win 32%; 14:00: -21.2% [-28.7%, -12.9%] n=221 win 25%

### IWM CALIBRATION random side (shuffle 0) exit close

- year: 2024: -29.5% [-44.6%, -11.1%] n=628 win 19%
- GEX sign at 09:45 (MODEL): GEX<0: -44.1% [-64.0%, -21.4%] n=241 win 15%; GEX>0: -20.5% [-42.3%, +6.8%] n=387 win 22%
- VIX tercile at 09:45: VIX high: -78.2% [-99.6%, -55.6%] n=12 win 8%; VIX low: -24.4% [-44.1%, -2.1%] n=493 win 20%; VIX mid: -40.4% [-66.9%, -9.4%] n=108 win 16%; n/a: -80.6% [-99.9%, -59.5%] n=15 win 13%
- trend/flat by the open: flat: -9.9% [-38.5%, +27.7%] n=298 win 21%; trend: -47.2% [-61.0%, -33.3%] n=330 win 17%
- time bucket: 10:00: -18.8% [-39.7%, +6.7%] n=224 win 23%; 12:00: -25.8% [-49.3%, +0.598%] n=221 win 19%; 14:00: -47.3% [-65.4%, -23.4%] n=183 win 14%

### IWM CALIBRATION underlying B&H (no cost) exit close

- year: 2024: -0.062% [-0.143%, +0.020%] n=640 win 48%
- GEX sign at 09:45 (MODEL): GEX<0: -0.005% [-0.111%, +0.110%] n=244 win 50%; GEX>0: -0.096% [-0.220%, +0.015%] n=396 win 47%
- VIX tercile at 09:45: VIX high: +0.226% [-0.026%, +0.416%] n=12 win 67%; VIX low: -0.073% [-0.172%, +0.019%] n=504 win 48%; VIX mid: -0.029% [-0.208%, +0.116%] n=109 win 51%; n/a: -0.145% [-0.528%, +0.105%] n=15 win 33%
- trend/flat by the open: flat: -0.081% [-0.235%, +0.039%] n=306 win 48%; trend: -0.044% [-0.142%, +0.052%] n=334 win 49%
- time bucket: 10:00: -0.052% [-0.164%, +0.070%] n=224 win 50%; 12:00: -0.057% [-0.137%, +0.024%] n=222 win 48%; 14:00: -0.077% [-0.155%, -0.000%] n=194 win 47%

## Execution assumptions

- Entry: decision t; fill at the first valid 1-second NBBO at or after t + 2 s (buy at the ask; quote must have bid > 0, ask > bid, ask size > 0), walking forward up to 60 s; otherwise SKIPPED (counted in "skips").
- Exit: time stop decision min(t + h, close - 2 min); sell at the bid of the first valid quote >= decision + 2 s; a zero bid closes the leg at 0 with no exit fee.
- Fees $0.65 per contract per side per leg; sensitivities $1.30 and +1 tick (SPXW 0.05 below $3, 0.10 above; ETF options 0.01). No mid fills. Size: 1 lot (displayed size > 0 required on the entry side).
- Underlying rows: bar-close to bar-close returns (OBS bars), no cost; SPX index return is not tradeable directly (labelled).
- Decision times with no qualifying contract on the board at t (no |delta| in [0.15, 0.50] with a valid two-sided quote inside the cached strike band, or no ATM strike) are not traded and are not skips; unconditional decision times (DISCOVERY + CALIBRATION) without a call / put / straddle: IWM 60 / 33 / 1 of 1969; QQQ 11 / 6 / 1 of 2512; SPXW 4 / 2 / 2 of 3057; SPY 4 / 2 / 1 of 2886.

