# EDGE0DTE: hypothesis registry (pre-registration; committed before any outcome is computed)

Conventions. S = spot (SPX index for SPXW, the ETF for SPY/QQQ/IWM). sigma_h = IV_atm(t) * sqrt(h_years), the board's
implied move over h. Z, V as defined in PROTOCOL.md section 4. "Sign" = the predicted sign of sign-aligned Z
(direction) or of ln V (volatility). Each row has ONE primary parameter set (P) used for the FDR test; the grid (G)
is reported as sensitivity and is never used to pick a winner. Outcomes are tested at h = 15, 30, 60, close unless a
row says otherwise. Labels: OBS / CALC / MODEL (PROTOCOL.md section 2).

Dealer sign convention (MODEL, used by every A/E row): customers are net long puts and net short calls, so dealers are
long call gamma and short put gamma: GEX(K) = gamma(K) * (OI_call(K) - OI_put(K)) * 100 * S^2 * 0.01. gamma from Black-
Scholes on the observed board mid at t with the same-day expiry's OI only (P) or all expiries <= 7 DTE (G). Flip =
the spot level at which total GEX, re-priced across a +/- 3 sigma_close grid, changes sign. This convention is an
assumption and every A/E result is labelled MODEL.

## A. Dealer gamma regimes

| id | feature (at t) | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| A1 | total GEX sign at 09:45 | long-gamma dealers sell rallies / buy dips (damping); short-gamma dealers chase (amplifying) | V: negative GEX -> ln V > 0 relative to positive; Z: prior-30-min direction continues when GEX < 0, reverts when > 0 | P: same-day OI; G: <= 7 DTE OI |
| A2 | distance to flip, (S - flip)/sigma_close | hedging flow changes sign at the flip; near it, convexity of the hedge is largest | V: |dist| < 0.5 -> ln V > 0 | P 0.5; G 0.25, 1.0 |
| A3 | spot crosses the flip intraday (5-min close beyond) | regime switch: crossing into short gamma turns damping into amplification | Z in the crossing direction > 0 | P 5-min close; G 1-min, 15-min |
| A4 | distance to the call wall (max positive GEX strike above S) and put wall (max abs GEX strike below S), in sigma_h | dealer hedging concentrates at the wall: approach slows and reverses (resistance / support) | Z toward the wall < 0 once within 0.5 sigma_30 | P 0.5; G 0.25, 1.0 |
| A5 | gamma concentration: Herfindahl of |GEX| by strike within +/- 2 sigma_close | concentrated long gamma pins price | V: top tercile -> ln V < 0 | P tercile; G quintile |
| A6 | GEX change since 09:45 driven by spot (re-priced at t vs open), standardised | price walking into short gamma raises realized volatility the board has not repriced | V: falling GEX -> ln V > 0 | P 1 sd; G 0.5, 2 sd |
| A7 | pin magnet: after 14:00, distance to the largest-|GEX| strike within 1 sigma_close | expiry-day pinning by long-gamma dealers | Z toward that strike > 0 at h = close | P 14:00; G 13:00, 15:00 |

## B. Intraday price behaviour

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| B1 | opening-range breakout: first 5-min close beyond the 30-min OR | late information / institutional order splitting continues | Z in breakout direction > 0 | P OR 30; G OR 15, 60 |
| B2 | failed breakout: OR break, then a 5-min close back inside within 30 min | trapped breakout traders cover | Z toward the opposite OR side > 0 | P 30 min; G 15, 60 |
| B3a | VWAP acceptance: 3 consecutive 5-min closes beyond session VWAP after a cross | acceptance = new value area, inventory traders follow | Z in that direction > 0 | P 3 closes; G 2, 4 |
| B3b | VWAP rejection: touch (within 0.1 sigma_30) then 5-min close back away | VWAP execution algos defend value | Z away from VWAP > 0 | P 0.1; G 0.05, 0.2 |
| B4 | EMA alignment: close > EMA9 > EMA21 on all of 1, 5, 15, 30, 60-min bars (or all inverted) | multi-horizon trend agreement = persistent order imbalance | Z in aligned direction > 0 | P all 5 frames; G 4 of 5, 3 of 5 |
| B5 | trend exhaustion: |move from open| > 1.5 sigma_open-to-t AND the last 15-min return opposes it | liquidity providers absorb stretched moves | Z against the day's move > 0 | P 1.5; G 1.0, 2.0 |
| B6 | momentum acceleration: 5-min |Z| > 2 and 5-min Z > 15-min Z per minute, same sign | accelerating forced flow (stops, hedges) | Z continuation > 0 at h = 15, 30 | P 2; G 1.5, 2.5 |
| B7 | intraday momentum: first-30-min return (09:30-10:00, plus the overnight gap) | late-day rebalancing / hedging trades in the direction of the day (published: Gao, Han, Li, Zhou 2018) | Z over 15:30-16:00 in that direction > 0 | P with gap; G without gap |
| B8 | intraday reversal: last 60-min Z beyond 2 (one-hour shock) | temporary price pressure reverts | Z against the shock > 0 at h = 30, 60 | P 2; G 1.5, 2.5 |

## C. Options market microstructure (trades with their NBBO; aggressor = CALC)

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| C1 | unusual 0DTE volume: call vs put contract volume in the last 15 min / its 20-session same-minute median | informed demand shows up in volume before price | Z toward the heavier side > 0 | P ratio > 3; G 2, 5 |
| C2 | aggressive delta flow: sum over trades of sign(price vs mid) * size * delta * 100, last 15 min, standardised | buy-initiated delta forces dealers to hedge in the same direction; may also carry information | Z in flow direction > 0, incremental after controls | P 15 min; G 5, 30 |
| C3 | board size imbalance: near-ATM (|delta| 0.2-0.5) (bid size - ask size)/(sum), calls minus puts | resting liquidity imbalance precedes quote moves | Z toward the imbalance > 0 at h = 15 | P 15; G 5-min avg, 30-min avg |
| C4 | residual IV change: 15-min change in ATM IV minus its fitted spot-vol beta (fit on prior 20 sessions) | IV moving more than spot explains = option-led information | Z: residual IV up -> Z < 0; V: residual up -> ln V > 0 | P 15 min; G 30 |
| C5 | skew change: 15-min change of the 25-delta put minus call IV | demand for crash protection leads the index | Z: skew up -> Z < 0 | P 15; G 30 |
| C6 | OI change: (OI_D - OI_D-1) on puts minus calls within +/- 2% of the open (both published before the open) | new positioning carried overnight | Z at h = close, sign of put build -> Z > 0 (hedged dealers) | P 2%; G 1%, 5% |
| C7 | liquidity: median near-ATM spread / mid vs its 20-session same-minute median | wide spreads = market makers see risk | V: wide -> ln V > 0 | P ratio > 1.5; G 1.25, 2 |

## D. Volatility

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| D1 | RV expansion: RV last 30 min / same-time 20-session median > 2 | volatility clusters; the board under-reacts | V: ln V > 0 | P 2; G 1.5, 3 |
| D2 | RV compression: that ratio < 0.5 | quiet sessions stay quiet; implied lags down | V: ln V < 0 | P 0.5; G 0.4, 0.67 |
| D3 | signed semivariance: (RS+ - RS-)/RV over the last 60 min | positive semivariance predicts lower returns (Bollerslev, Li, Zhao 2020) | Z: high (RS+ > RS-) -> Z < 0 | P top/bottom tercile; G quintile |
| D4 | implied over realized: IV_atm(t)^2 / RV(last 60 min, annualised) | the premium dealers charge varies; when it is low, long gamma is cheap | V: lowest tercile -> ln V > 0; highest -> ln V < 0 | P tercile; G quintile |
| D5 | seasonality: time-of-day bucket alone (30-min buckets) | systematic intraday mispricing of 0DTE variance by time of day | V: test ln V != 0 per bucket (two-sided, each bucket one test) | P 30-min; G 60-min |
| D6 | unconditional variance premium at 09:45 (ATM straddle) | sellers are paid for gap and tail risk | V: ln V < 0 at h = close (the short-premium hypothesis; expressed as a defined-risk iron fly) | P 09:45; G 10:00, 10:30, 12:00 |

## E. Dealer hedging (MODEL)

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| E1 | charm flow: dealer delta change from time decay between t and 16:00 at constant S (sum over OI of charm) | as OTM option delta decays, dealers unwind hedges: e.g. short puts losing delta -> dealers buy back short futures | Z after 13:00 in the sign of the implied dealer buying > 0 at h = close | P 13:00; G 12:00, 14:00 |
| E2 | vanna flow: dealer delta change from the last 30-min IV change at constant S | IV falling raises dealer delta on short puts -> hedges bought | Z in the implied hedge direction > 0 at h = 30, 60 | P 30 min; G 15, 60 |
| E3 | gamma hedge demand: GEX * dS over the last 15 min (estimated dealer delta trade) | short-gamma dealers must trade with the move; long-gamma against it | Z in the hedge direction > 0, incremental after the prior-15-min return as control | P 15; G 5, 30 |
| E4 | total estimated hedge demand H = E1 + E2 + E3 at t, standardised | the sum is what dealers must trade | Z in sign(H) > 0; IC > 0 | P all three; G drop E1 |

## F. Market structure (5-minute bars; swing = a 5-min high/low with 2 lower highs / higher lows on each side, CALC, known only 2 bars after it forms)

| id | feature | mechanism | outcome, sign | P / G |
|---|---|---|---|---|
| F1 | structure: last two confirmed swing highs AND lows rising (HH+HL) or falling (LH+LL) | trend persistence | Z in structure direction > 0 | P 2 swings; G 3 swings |
| F2 | break of structure: 5-min close beyond the last confirmed swing in the trend direction | continuation through stops above/below swings | Z continuation > 0 | P close; G wick |
| F3 | structure shift: 5-min close beyond the last swing AGAINST a prevailing F1 trend | trend failure | Z in the new direction > 0 | P close; G wick |
| F4 | displacement: 5-min range > 2 x ATR(14, 5-min) with close in its outer 20% | forced, one-sided flow | Z continuation > 0 at h = 15, 30 | P 2; G 1.5, 3 |
| F5 | liquidity sweep: wick beyond the prior-day high/low or a confirmed swing, 5-min close back inside | stops run, then liquidity exhausted | Z back into range > 0 | P prior-day H/L and swings; G prior-day only |
| F6 | failed auction: new session high/low that is back inside the prior range for 15 min | no follow-through = the auction failed, price rotates | Z away from the failed extreme > 0 | P 15 min; G 10, 30 |

## X. Conditional tests (pre-registered interactions; each is one test of the DIFFERENCE between regimes)

| id | test | predicted |
|---|---|---|
| X1 | B4 EMA alignment, GEX < 0 vs GEX > 0 | continuation stronger when GEX < 0 |
| X2 | B2 failed breakout, GEX > 0 vs GEX < 0 | reversal stronger when GEX > 0 |
| X3 | C2 flow, incremental over prior return, ETF volume and prior RV (regression) | coefficient > 0 |
| X4 | B7 intraday momentum, GEX < 0 vs > 0 (Baltussen, van Bekkum, Da 2019) | stronger when GEX < 0 |
| X5 | F5 sweep at a wall (within 0.25 sigma_30 of A4 wall) vs elsewhere | reversal stronger at a wall |
| X6 | B3b VWAP rejection, GEX > 0 vs < 0 | stronger when GEX > 0 |
| X7 | D4 cheap implied, GEX < 0 vs > 0 | ln V higher when GEX < 0 |
| X8 | A7 pin magnet, GEX > 0 vs < 0 | pin only when GEX > 0 |
| X9 | D1 RV expansion, GEX < 0 vs > 0 | ln V higher when GEX < 0 |
| X10 | E1 charm afternoon drift, GEX > 0 vs < 0 | stronger when GEX > 0 |
| X11 | C1 unusual volume, incremental over B6 momentum and ETF volume | coefficient > 0 |
| X12 | B1 OR breakout, VIX tercile high vs low | breakout continuation stronger in high VIX |

## Baselines (PROTOCOL.md section 6) are run once each, in FOUNDATION, and ledgered like any test.

## Counting
Stage-1 FDR family (SPXW): every (row, outcome, horizon) cell with its primary parameter. Grid cells, replication roots
and baselines are reported but are not in the FDR family. Stage-2 variants (expression x exit) count toward the
deflated Sharpe trial total on top of the ledger's existing count.
