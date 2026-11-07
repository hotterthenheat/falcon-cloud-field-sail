# NEXTGEX: pre-registration (committed before any outcome is computed)

Family NEXTGEX. Method follows `slayer/research/edge0dte/PROTOCOL.md` (splits, labels, leakage rules, day-clustered
inference) and `/tmp/qa/V2_PROTOCOL.md` (theory first, null calibration, report everything). This study measures
whether two quantities describe something real. It makes no trading claim, and nothing here is a Stage-2 option P&L
test. The commit that adds this file is the pre-registration; its hash goes in `research-v2-ledger.md`.

## 0. Common definitions

* **Splits.** DISCOVERY = sessions 2020-01-01 .. 2023-12-31. CALIBRATION = 2024-01-01 .. 2024-12-31 (one look per
  test, after the DISCOVERY numbers are written down). 2025+ = never: the code asserts every session it scores is
  before 2025-01-01. No outcome is computed on 2025 or 2026.
* **Roots.** SPXW (primary; pass/fail is decided on SPXW only). SPY, QQQ, IWM are replication roots, reported only.
  Sessions = every day with a same-day expiry and both a 0DTE board and an OI file in
  `v2data/edge/{chain,oi}` or `v2data/edge0dte/{chain,oi}` (SPXW: 141 + 159 + 198 + 250 sessions 2020-2023,
  230 in 2024). NYSE early-close days are excluded (2020-11-27, 2020-12-24, 2021-11-26, 2022-11-25, 2023-07-03,
  2023-11-24, 2024-07-03, 2024-11-29, 2024-12-24). Missing days are missing, not filled.
* **Decision times** t in {10:00, 12:00, 14:00, 15:00} ET. Board = the 1-minute NBBO row m = (t - 60 s) // 60 (the
  `sim.board` rule: stamped <= t - 60). Spot S(t) = close of the last 1-minute bar that has closed by t.
* **Outcome (OBS).** S_T = close of the 15:59 bar of the underlying (SPX index for SPXW; the ETF for SPY/QQQ/IWM).
  SPXW settles on the official 16:00 SPX print; the 15:59-bar close is its proxy (label OBS-proxy). ETF options are
  American and physically settled; their closing price is used as the terminal value (label OBS-proxy).
* **Mid (CALC).** (bid + ask) / 2 when ask > bid > 0; ask / 2 when bid = 0 < ask (one-sided far-OTM market); unusable
  otherwise (crossed, zero ask).
* **Forward (CALC).** F(t) = median over the 5 listed strikes nearest S(t) of C_mid(K) - P_mid(K) + K (put-call
  parity, discounting ignored over < 6.5 h; label CALC-approx).
* **Priced move (CALC).** s(t) = ATM straddle mid at the strike nearest F times sqrt(pi/2): the one-standard-move in
  price the board prices to the close (normal approximation, label CALC-approx). z(K) = ln(K/F) / (s/F).
* **Priced odds, model-free (CALC).** At the midpoint between two adjacent listed strikes K1 < K2:
  P_RN(S_T > (K1+K2)/2) = (C_mid(K1) - C_mid(K2)) / (K2 - K1) using calls where K1 >= F, and
  P_RN(S_T <= (K1+K2)/2) = (P_mid(K2) - P_mid(K1)) / (K2 - K1) using puts where K2 <= F (the out-of-the-money leg; the
  pair straddling F uses the average of both). The resulting CDF over the strike midpoints is made monotone by
  pool-adjacent-violators (isotonic regression, equal weights) and clipped to [0, 1]. Between midpoints the CDF is
  linearly interpolated; beyond the outermost midpoint it is undefined and the point is dropped (counted). This is
  the price of a vertical spread divided by its width: what the board charges for a digital bet. No smile model,
  no dealer sign.
* **Inference.** Day-clustered bootstrap, 2,000 resamples of sessions (all decision times and strikes of a session
  move together), 95% percentile CIs. Holm correction across the three primary tests (H1.1, H1.3, H2.1).
* **Year groups** for the stability check: 2020-21 pooled, 2022, 2023.

## 1. Concept 1: CALIBRATED ODDS (priced vs real probabilities of the close)

**Mechanism.** The 0DTE board is a price list for bets on where the close lands. Option sellers are paid for bearing
jump and tail risk (variance risk premium) and end-users' demand pushes particular strikes (Garleanu, Pedersen &
Poteshman 2009), so priced probabilities are not frequencies. If the wedge is stable, a correction fitted on the past
turns priced odds into real odds, the way desks move from a risk-neutral to a "physical" density (Bliss &
Panigirtzoglou 2004).

**Labels.** Priced odds CALC (from OBS quotes); outcome OBS; the recalibration map MODEL (a fitted statistical map).

**Evaluation grid.** z in {-2.5, -2, -1.5, -1, -0.5, +0.5, +1, +1.5, +2, +2.5}; level K_z = F exp(z s/F). Tail event:
"close <= K_z" for z < 0, "close > K_z" for z > 0; priced tail probability p = P_RN of that event; realised y = 1 if it
happened.

* **H1.1 (primary, risk description).** Priced odds overstate a move of more than one priced standard move:
  ratio R = sum(y) / sum(p) over the two tails at |z| = 1, pooled over the four decision times.
  Prediction R < 1. **Pass:** DISCOVERY R < 1 with the CI upper bound < 1, Holm-adjusted p < 0.05, same sign in all
  three year groups; CALIBRATION R < 1 with CI upper bound < 1.
* **H1.2 (secondary, two-sided, descriptive).** Where the wedge sits: R(z) for each z, each tail separately, each
  decision time. Two competing priors: the classic "puts are dear" (left tail more overpriced) vs Bandi, Fusari &
  Renò (2023) "0DTE variance premium is mainly upside" (right tail more overpriced). Statistic: R(+1) - R(-1) with CI.
  No pass/fail.
* **H1.3 (primary, the product test).** A correction learnt on DISCOVERY improves the odds in CALIBRATION.
  Map (MODEL): per decision time, logistic regression of y on [1, L, side, L*side] with L = logit(clip(p, 0.002,
  0.998)) and side = 1 for the right tail, fitted on DISCOVERY tail points with |z| in {0.5, 1, 1.5, 2, 2.5}, frozen,
  then applied to CALIBRATION. Statistic: Brier(priced) - Brier(corrected) on CALIBRATION, per point, pooled.
  **Pass:** > 0 with CI lower bound > 0 (Holm). Log-score difference reported alongside.
* **H1.4 (secondary).** PIT: u = F_RN(S_T) for each session-time where S_T lies inside the quoted range; decile
  histogram and the share of u in the outer deciles. Descriptive.
* **H1.5 (secondary, "where the overpricing sits" in dollars).** For the listed OTM strike nearest K_z (puts z < 0,
  calls z > 0), payoff-to-premium = sum(payoff at S_T) / sum(mid at t) and / sum(ask at t), by z and decision time,
  with CI. Descriptive: it says what each cent spent on that strike returned on average; it is not a trade test
  (no fills, no fees, no exits).
* **Sensitivity (reported, not decisive).** The same H1.1 statistic with the priced odds from an app-style smoothed
  smile (quadratic in log-moneyness of out-of-the-money IV, weights e^{-x^2/2} + 0.05 in x = ln(K/F)/(s/F), the
  `data/weigherDensity.ts` convention, approximated in Python).
* **Null calibration.** Replace each realised close by a draw from that session-time's own priced distribution
  (inverse CDF of the isotonic P_RN at a uniform u; 200 runs). The pipeline must give R ~ 1 (null CI covering 1 in
  >= 95% of runs): otherwise the measurement, not the market, is biased.

## 2. Concept 2: PIN GRAVITY (does the close land at large-OI strikes more than the board prices?)

**Mechanism.** On expiry day, whoever holds a large position at strike K near spot and delta-hedges it trades against
moves around K if they are long gamma there (Avellaneda & Lipkin 2003; Ni, Pearson & Poteshman 2005 found closes
cluster at high-OI strikes on equity expiries). Retail tools show "max pain" or a "pin" without ever measuring it.
If the pin is real and the board does not price it, butterflies centred on large-OI strikes pay more than they cost
relative to butterflies at the same distance from spot on small-OI strikes.

**Labels.** OI OBS (published for day D, the prior close's figure; e = 0 rows of the OI file); fly price CALC;
outcome OBS. No dealer-sign assumption in the primary test (who is long is not observed).

**Unit of observation.** Each listed strike K with both neighbours K - w and K + w listed at equal spacing w (SPXW 5,
ETFs 1) and |K - F| <= 1.5 s at decision time 14:00 (primary; 12:00 and 15:00 sensitivity). Fly price per unit of
width q(K) = (X(K-w) - 2 X(K) + X(K+w)) / w with X = call mids for K >= F, put mids for K < F (equal by parity);
q is the board's price of "close near K" (triangular weight). Payoff per unit of width g(K) = max(0, 1 - |S_T - K| / w).
Excess e(K) = g(K) - q(K). Flies with q <= 0 (arbitrage-violating mids) are kept; their count is reported.

**Feature.** x(K) = within-session z-score of ln(1 + OI_call(K) + OI_put(K)) over the strikes in the window.

* **H2.1 (primary).** e(K) = cell FE + beta * x(K) + error, cells = (side of F) x (|K - F| / s in 0.25-wide bins),
  pooled OLS after demeaning within cell, SPXW, 14:00. Prediction beta > 0. **Pass:** DISCOVERY beta > 0 with CI
  lower bound > 0, Holm-adjusted p < 0.05, same sign in all three year groups; CALIBRATION beta > 0 with CI lower
  bound > 0. Economic floor: beta must be >= 10% of the mean q of strikes within 0.5 s (a one-sd OI increase
  adds at least a tenth of the board's own price of the pin); a significant effect below the floor is reported as
  "real but too small to show".
* **H2.2 (secondary).** The largest-OI strike within +/- 1 s at 14:00 (K*): mean e(K*) vs the mean e of the other
  strikes in its cell, and the hit rate |S_T - K*| <= w/2 vs the board's price of that event. Descriptive.
* **H2.3 (secondary).** Gamma-weighted OI (OI x Black-Scholes gamma at the board's ATM vol) in place of raw OI; and
  12:00 / 15:00 decision times. Reported only.
* **Null calibration.** Permute the OI vector across strikes within each session (200 runs): the real beta must exceed
  the 95th percentile of the permuted betas; the null pass rate at the pipeline's own 5% test must be <= 5%.

## 3. What counts as "real"

* Concept passes as a **risk description** if its primary description test (H1.1, H2.1) passes in DISCOVERY and
  CALIBRATION.
* Concept 1 passes as a **product correction** only if H1.3 also passes (the learnt correction beats raw priced
  odds a year later).
* Neither is a trading edge claim. Any later trade built on them goes through EDGE0DTE Stage 2 as a new registry entry.

## 4. Trial count

Primary tests: 3 (H1.1, H1.3, H2.1). Secondary and sensitivity cells are reported, not counted for FDR, and none is
used to pick a winner. CALIBRATION is looked at once per primary test.
