# EDGE-K pre-registration: a data-driven contract chooser (written and committed before any fit or outcome)

Owner's ask: "it should risk the con that makes the most sense, not one with the most delta or most volume or anything
that's hard coded." On 2026-11-05 Compass bought SPXW 7585P at $36.50 and SPXW 7575P at $47.40. A hard $5 cap was
rejected. Question: for the SAME signal (same timestamp, root, side), does choosing the contract by its estimated net
return per dollar risked beat simple alternatives, and does abstaining when no estimate is positive help?
Protocol: /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls/puts only. Nothing here was fit before this commit;
the only things computed are the trigger lists (`signals.py`: S1 450 signals / 298 sessions, S2 1,201 / 442), which
read no option outcome.

## Mechanism (why a chooser could help)
A long option's net result for a given signal depends on (i) how far the underlying moves in the hold (signal drift +
realised vol), (ii) what the market charges for that move (implied variance, decay; 0DTE realised/implied ~0.91 on
DEV), (iii) the round-trip spread, a much larger share of premium for cheap contracts, and (iv) how the exit rules
interact with the contract's leverage (a -35% stop is a small underlying move for a 0.10-delta option and a large one
for a 0.90-delta one). Fixed rules (0.35 delta, ATM, cheapest, Compass's ITM pick) ignore all four. A model that
prices each listed contract against a forecast from the underlying's own realised behaviour, with the real costs and
the real exits, should pick the contract with the best net trade-off and say "none" when the signal cannot pay for
any contract. Expected sign: chooser >= fixed rules on the same signals; abstention helps if the signals' average
contract loses. Counter-expectation: with realised < implied on every DEV bucket, a structural model mostly abstains.

## Signal sets (fixed; the chooser is tested in isolation on honest, already-built signals)
- **S1 = EDGE-T H1-k0.30 (opening drive)**: EDGE-T's trigger code unchanged (`ht.trig_h1`, amendment A1), now on all
  656 DEV sessions (EDGE-T ran 430 on time). Roots SPXW, SPY, QQQ. Decision t in 09:32..09:35, side = drive sign.
  Exits = EDGE-T "RT" exactly (`ht.manage`): checks every 10 s on sane quotes, stop bid <= 0.65 x fill, trail once the
  peak >= 1.50 x fill exit at bid <= 0.75 x peak, flat decision 15:50:00, exit fill = bid in force at decision + 2 s.
  Entry (`ht.enter`): the quote in force at t + 2 s must be sane (bid > 0, spread <= 12% of mid, both sizes >= 2),
  buy 1 at its ask; else skip. Reason: one trade per root-session (clean clusters), long hold (decay matters), live
  RULES.md exits (the exits Compass's trend book actually runs).
- **S2 = EDGE E1-z0.5 (momentum into the close)**: EDGE's stored triggers (t = 15:25:00), minus 70 whose 20-day
  sigma_d window contains a LOCKED session (EDGE's `daily_closes` read the 2022-09 / 2024-08 bar files; dropping them
  is a pre-outcome guard). Roots SPY, QQQ, IWM, SPXW. Exits = E1 X2 exactly (`sim.run_trade`, per-second): stop bid <=
  0.50 x fill; trail armed once bid >= 1.25 x fill, exit at bid <= 0.75 x peak; time decision 15:58:30; entry the ask
  of the first quote >= t + 2 s with bid, ask > 0 and ask size >= 1 (within 60 s). Reason: the most-supported mechanism
  (E1 side beats a coin in 86-96% of shuffles), many signals, and a 33-minute hold where contract choice (leverage vs
  spread) matters most. Using two sets with opposite horizons tests whether the chooser generalises.
- Both sets are DEV only. Fees $0.65/contract/side; every number net (and gross where shown).

## Data
Boards: EDGE's 0DTE 1-minute chain (`v2data/edge/chain`, read only), the board stamped (t - 60)//60 (EDGE's
convention), strikes +-24 (SPXW) / +-14 (ETFs) around spot; contracts beyond were not stored (diagnostic: share of
signals whose outermost stored side strike is still two-sided). Mini: for SPXW signals, the XSP 0DTE board of the
same minute (fetched, 1 request, strike_range 20, cached `v2data/edge-k/xsp/`), when XSP lists a same-day expiry; XSP
underlying = SPX / 10. Outcome paths: 1-second NBBO per contract (terminal, one request in flight; S1 09:31:00-15:51:00
reusing EDGE-T's cache, S2 15:25:00-15:59:00 reusing EDGE's chunks), cached under `v2data/edge-k/q1s/` (budget 1 GB).
Underlying: EDGE's 1-minute bars; a LOCKED day is never read (EDGE-T's `day_bars` guard; profile windows skip locked
days). Signals run in one seeded random order over the union of S1 and S2 sessions (seed 20261105); a time cut is on
time, not outcome, and reported. Per-session result files are atomic (resumable).

## The candidate set (the same for every picker)
F(side) = the signal side's contracts on the board with bid > 0 and ask > bid (two-sided), an IV solvable at mid,
and the signal's own entry rule checked on the board quote (S1: spread <= 12% of mid and both sizes >= 2; S2: ask size
>= 1). For SPXW signals, F_mini = the same from the XSP board. These are sanity/feasibility guards only: no delta band,
price cap, volume or OI filter.

## The chooser (K): Monte Carlo net return per dollar risked, under the signal's exits
Per signal, for each contract i in F u F_mini, ER_i = E[(100 x bid_exit - 0.65) / (100 x ask_i + 0.65) - 1] over
simulated paths (common random numbers across contracts), ask_i = the board ask. Pick argmax ER; if max ER <= 0, pick
nothing (abstain).
1. Diurnal variance profile P(m), m = minute of the session (09:30 + m), causal: mean of r_m^2 over the underlying's
   prior <= 60 eligible sessions (>= 300 bars, not LOCKED, before the signal day; >= 15 required, else no estimate ->
   K abstains), r_0 = ln(c/o) of the 09:30 bar, r_m = ln(c_m / c_{m-1}); centred 5-minute moving average.
2. Variance level (realised, never implied): L_prev = sum r^2 / sum P over the last eligible prior session; L_today =
   the same over today's closed bars (bar start <= t - 60); L_rem = the same over the hold window (first unclosed bar to
   the flat bar: S1 15:49, S2 15:58). OLS on DEV root-sessions (all root-sessions with bars, not only signals; S1 at each
   t in 09:32..09:35 pooled, S2 at 15:25): ln L_rem = a + b ln L_prev + c ln L_today + e (L floored at 0.05).
   Paths draw L_path = exp(a + b ln L_prev + c ln L_today + e_j), e_j resampled from the training residuals.
3. Return shape: standardised minute returns z = r_m / sqrt(P(m) L_day) pooled from the same prior <= 60 sessions;
   sub-steps of 30 s (S1) / 15 s (S2) draw z iid and scale to variance P(m) L_path x dt/60; log-price increments
   mu_j + sigma_j z - sigma_j^2 / 2.
4. Signal drift: kappa = mean over training-fold signals of the set of side-signed ln(S_flat / S_t) / sigma_f, sigma_f =
   sqrt(point-forecast L x sum P over the hold); mu_j = kappa x sigma_f x (P(m_j) dt/60) / sum P (spread in business time).
5. Option value along the path: each contract's implied total variance W_i = IV_i^2 T (IV solved at the board mid, T =
   EDGE's minutes-to-16:00 / (252 x 390)) decays in the underlying's business time: W_i(t') = W_i x Prem(t') / Prem(t),
   Prem = sum of P from t' to 16:00 (sticky strike). mid' = Black-Scholes(S', K, W_i(t')), r = q = 0.
6. Exit bid: bid' = max(0, mid' - h'), h' = max(h_min, h_0 (mid'/mid_0)^beta), h_0 = the entry half-spread; beta and h_min
   per root (XSP its own) and set, from DEV boards at the signal minute (training folds): OLS slope of ln half-spread on
   ln mid over two-sided contracts, h_min = the 5th percentile of half-spreads.
7. Exits applied to the simulated bid on the sub-step grid exactly as the set's rules (S1 RT, S2 X2; trail peak starts
   at the board bid); the hold ends at the set's flat. Paths: 1,000 (S1), 2,000 (S2); seed from (set, root, day).
8. Cross-fitting: DEV sessions sorted by date are cut into 5 contiguous folds of equal count; every fitted parameter
   (a, b, c, residuals, kappa, beta, h_min) used for a signal comes from the other 4 folds. Nothing is tuned after a
   look; no parameter is chosen by outcome. VALIDATION and LOCKED are never read.

## Pickers compared on the same signals (all use F/F_mini and the set's real execution and exits)
- K = chooser with abstention (the hypothesis). K-forced = argmax ER even when <= 0. K-root = K-forced without the mini.
- A = the signal's registered 0.35-delta pick (S1: `ht.select(..., 0.35)`, |delta| 0.15-0.50, ask <= 0.6 EM;
  S2: `sim.select(..., 0.25, 0.50, 0.35)`, spread <= 8%, ask <= 0.6 EM) = the incumbent fixed-delta rule.
- B = at-the-money: the contract in F (root) whose strike is nearest spot.
- C = cheapest: the contract in F (root) with the lowest ask.
- D = Compass style: Compass Book A takes, among contracts within 4 strikes of the ATM strike with bid > 0.15 and spread
  <= 8% (compassParams.ts `spreadPass`, `strikeSpan` = 4 for index roots), the one with the highest Model 1 score. Model 1
  cannot be scored on history (its live inputs were not recorded), so D reproduces the style, not the score: its 14
  recorded index-root Book A picks (2026-11-04 replay, 2026-11-05 live; strike vs spot only, no outcome used) were ITM in
  every case, median and mode 4 strikes (range 1-4, 8 of 14 at 4) from the ATM strike (e.g. 7585P at spot 7565). D = the contract in F (root)
  4 strikes ITM from the ATM strike (nearest spot on the board's strike list) passing bid > 0.15 and spread <= 8%, else 3,
  2, 1, 0 strikes ITM, first that passes; none -> no trade.
- A pick that fails the set's entry rule at t + 2 s is a skipped trade (counted, reported per picker).

## Outcomes and statistics
Per picker: n traded, abstain/skip counts, expectancy per trade net [95% CI, session-clustered bootstrap], no-fee
expectancy, $ per $ risked (sum P&L / sum premium incl. fees), hit rate (net > 0), median premium; per-SIGNAL value
(abstain = 0) for K vs the others; paired per-signal differences K-forced - X on signals both traded (session-
clustered CI). Abstention: the realised mean of K-forced on the signals K abstains on (CI). Mini: share of K / K-forced
picks on XSP; K-forced vs K-root on those signals. Price distribution of picks (premium per contract, quantiles) per
picker. Model calibration: realised vs ER deciles for every fetched pick. By year and by root.

## Nulls (anti-bias 11)
- N1 random contract: per signal 3 contracts drawn uniformly from F u F_mini (seeded), real outcomes; 2,000 draws of one
  of the 3 per signal give the null distribution of a random chooser's mean; report K-forced's percentile and the share
  of null draws whose CI excludes 0 (FDR).
- N2 shuffled side: the chooser run with kappa = 0 on both sides (K0-real, K0-opp, real outcomes); 200 coin draws of the
  side per signal, abstaining when ER0 <= 0; report K's percentile and the null pass rate.
- N3 synthetic zero drift: for every fetched pick, outcomes re-simulated on a zero-drift underlying at the real day's
  5-minute RMS profile (EDGE-T A2 convention), option prices Black-Scholes in calendar time at the contract's entry IV,
  bid/ask = mid -+ the entry half-spread, the set's exits on a 10-s grid; 100 runs. Report the share of runs where K's
  expectancy CI > 0 and where K-forced - A's paired CI > 0 (both must be <= 5%, else the pipeline is broken).
- PBO (CSCV, 16 blocks) over {K-forced, K-root, A, B, C, D} per set; DSR of K at the ledger trial count.

## Pre-registered decision rules
- "The chooser makes the same signals better" iff, on BOTH sets, K-forced - A paired mean > 0 with CI excluding 0 and
  K-forced beats >= 95% of N1. Reported against B, C, D the same way (descriptive).
- "Abstention helps" iff the realised mean of K-forced on K's abstained signals < 0 with CI excluding 0 (per set).
- K (with abstention) as a strategy goes to VALIDATION (2025) only if on DEV it clears the protocol bar: n >= 150,
  expectancy CI > 0, beats >= 95% of N1 and N2, N3 FDR <= 5%. Otherwise nothing is fetched for 2025, nothing is frozen.

## Variants (ledger): 12
K, K-forced, K-root on S1 and S2 (6) + comparators B, C, D on S1 and S2 (6). A is the signals' existing variant (already
in the ledger). Look-ahead test with canaries (`tests_lookahead_k.py`): K's picks identical with every later bar, board
and quote replaced by noise; a canary that reads the forming bar / the next board must be caught.
