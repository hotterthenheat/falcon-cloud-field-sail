# EDGE-K log: a data-driven contract chooser, tested on the same signals

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls/puts only. Pre-registration `specs/PREREG.md` @ a0e1dc6
(12 variants, before any fit or outcome). Full tables: `results/DEV.md`; look-ahead test `results/lookahead.txt`;
synthetic null `results/synthetic_null.json`.

## The chooser in plain words
For a signal (root, side, time) it takes every listed 0DTE contract on that side with a two-sided quote (and, for SPX
signals, every XSP contract), and for each one asks: "if I buy this at today's ask and run the exits this signal really
uses, what do I get back per dollar paid, on average, after spread and fees?" It answers by simulating 1,000-2,000
paths of the underlying for the rest of the hold. The paths' size comes from the underlying's own recent realised
moves (a per-minute variance profile from the last 60 sessions, scaled by how volatile yesterday and this morning were,
with the scaling learned on DEV), never from the option's implied vol. Their direction comes only from what the signal
has historically been worth (the signal's average move, learned on DEV). Each contract is re-priced along every path
at its own implied variance, decaying in the underlying's business time; the exit bid is the model mid minus a spread
that scales with the price the way DEV spreads do. The exits (stop, trail, time flat) are applied to that bid. The
contract with the best average net return per dollar wins; if none is above zero, it picks nothing. Every fitted number
for a session comes from the other 80% of DEV (5 contiguous folds).

## Implementation notes (all before any outcome was read)
- z pool demeaned and unit-scaled (the prereg's "standardised"): the first smoke test showed a raw pool from a rising
  60-day window adds a +0.2% drift over a day, which is the drift term's job. Fixed before any pick was stored.
- Fetch order: phase 1 fetches the compared pickers (K-forced, K-root, A, B, C, D), phase 2 the null picks (random,
  kappa = 0). Order changes no outcome.
- XSP boards fetched one minute each (~4-10 s per request on the shared terminal).

## Run
- Signals: S1 450 (298 sessions; SPXW 217, QQQ 143, SPY 90), S2 1,201 (442 sessions; 70 E1 triggers dropped because
  EDGE's 20-day sigma_d had read LOCKED 2022-09 / 2024-08 closes). All 516 sessions done, no time cut.
- Terminal: 537 XSP boards (502 requests), 11,010 1-second paths (6,257 phase 1 + 4,753 phase 2), one request in
  flight throughout. Disk: 383 MB under v2data/edge-k (budget 1 GB).
- Fits (5 folds): S1 ln L_rem = -0.02 + 0.71 ln L_prev + 0.11 ln L_today (R2 0.42-0.61, resid sd 0.49-0.53); S2 = -0.16
  + 0.05 ln L_prev + 0.94 ln L_today (R2 0.49-0.68). Signal drift kappa (sigma units): S1 -0.007..+0.063, S2 -0.032..+0.028.
  Spread elasticity beta 0.43-0.60 (ETFs/SPXW), 0.55-0.73 (XSP).
- Look-ahead (`results/lookahead.txt`, 60 signals): picks and ER identical 60/60 with later bars, later boards and later
  sessions replaced by noise; canaries (board stamped t, forming bar in L_today) caught 60/60.

## Results (DEV, net of $0.65/side, session-clustered 95% CI) -- full tables in results/DEV.md
| picker | S1 n | S1 exp/trade [95%] | S1 $ per $ | S2 n | S2 exp/trade [95%] | S2 $ per $ |
|---|---:|---:|---:|---:|---:|---:|
| K chooser (abstains) | 207 | -1.5% [-9.3, +6.8] | -6.2% | 46 | -6.8% [-18.4, +5.3] | -6.4% |
| K-forced | 386 | +1.7% [-5.7, +10.2] | -4.1% | 1,200 | -5.9% [-8.7, -2.9] | -3.2% |
| K-root (no XSP) | 384 | +1.9% [-5.8, +10.4] | -4.1% | 1,200 | -5.7% [-8.5, -2.6] | -3.0% |
| A 0.35 delta (incumbent) | 402 | +2.0% [-6.7, +12.2] | +0.8% | 793 | -6.0% [-11.2, -0.4] | -4.3% |
| B ATM | 396 | +2.7% [-4.3, +10.4] | +2.4% | 1,200 | -10.0% [-13.9, -5.8] | -7.5% |
| C cheapest two-sided | 333 | -11.3% [-22.7, +1.9] | -17.4% | 1,178 | -73.9% [-75.3, -72.2] | -51.7% |
| D Compass style (ITM 4) | 383 | +0.7% [-6.9, +8.6] | +0.7% | 1,131 | -5.5% [-9.0, -1.8] | -4.3% |

Paired, same signals, K-forced minus X: S1 vs A +0.9% [-6.9, +8.6], vs B +0.0% [-4.3, +4.9], vs C +16.3% [+7.1, +25.5],
vs D +1.9% [-1.8, +5.3]; S2 vs A +1.8% [-2.5, +6.1], vs B +4.1% [+1.0, +7.2], vs C +67.8% [+64.9, +70.7], vs D +1.0%
[-0.7, +2.7]. The chooser rarely picks the incumbent's contract (3-4% same) and often picks D's (27-38% same).

Abstention: S1 K abstains on 222 of 450; K-forced on those signals made +5.4% [-6.7, +18.3] (abstaining HURT, n.s.).
Cause: cross-fitting. Folds 1 and 4 held the strongest drift themselves, so their other-fold kappa was ~0 and K abstained
exactly where the signal paid (K-forced fold means +16.5% / +8.3% there vs -16.4% / -3.1% / -3.8% in the others): the
drift estimate is noise. S2 K abstains on 1,155 of 1,201; K-forced there lost -5.8% [-8.6, -2.8] (abstaining HELPED, CI
excludes 0); per-signal value K -0.26% vs K-forced -5.86% vs A -3.98%. But the 46 S2 trades K kept lost -6.8%.

Mini (XSP): K-forced picked XSP on 5 of 215 SPXW S1 signals and 27 of 320 S2; K (traded) never. Mini effect K-forced vs
K-root: S1 +0.02% [-0.29, +0.26], S2 -0.19% [-0.33, -0.08] (XSP spreads scale worse, beta 0.55-0.73).

Price of picks: the chooser is a high-delta chooser. K-forced |delta| median 0.77 (S1) / 0.96 (S2); premium per contract
median $465 / $1,050, p75 $1,927 / $1,676, p95 $9,145 / $14,083; 41% / 50% over $1,000. K's traded picks are cheaper
(median $418 / $355, p95 $4,793 / $805). In S1 the delta > 0.9 picks lost -10.5% (n 92, -$47.7k); 0.6-0.8 made +9.1%.

Model calibration: S1 corr(ER, realised) +0.08 over 1,711 fetched picks (ER barely informative over a 6-hour hold);
S2 +0.63 over 4,521 (it ranks contracts: it knows the far-OTM ones lose 74-87%; the top deciles are ~1-3 points
optimistic, -0.6% / -2.2% predicted vs -3.6% / -3.7% realised).

## Nulls, overfit
- N1 random contract (3 per signal): K-forced beats 96% (S1) / 100% (S2) of 2,000 random-chooser draws (random means
  -0.7% / -25.5%; the S2 random draw is dragged by far-OTM contracts); FDR 0%.
- N2 shuffled side (kappa = 0 chooser, coin side): K beats only 20% (S1) / 4% (S2); FDR 1.0% / 3.5%. No signal-level edge.
- N3 synthetic zero drift (100 runs): K FDR 3% / 3%; K-forced - A paired FDR 5% (S1) and **97% (S2)**: in the synthetic
  world (calendar-time BS decay at entry IV, realised = the real day's profile) 0.35-delta options in the last 33 minutes
  lose -19% vs -6% in reality, so that null structurally favours high delta. By the pre-registered rule (<= 5%) N3 is
  invalid for the S2 contract comparison; no verdict depends on it (the real S2 paired CI includes 0).
- PBO (6 pickers, 16 blocks): S1 0.76, S2 0.28. DSR of K at N = 642 ledger trials: 0.000 (Sharpe/trade -0.03 / -0.17).

## Execution artefacts
- S1 RULES.md sanity at t + 2 s skipped 60 of 446 K-forced picks (13%), 46 of 448 A, 49 B, 58 D, 112 of 445 C (25%,
  one-lot / nickel-wide quotes). The chooser reads the board stamped t - 60 and fills a minute later; deep-ITM SPXW quotes
  move with the index inside that minute.
- S2's entry rule (ask size >= 1) skipped only 22 C picks; E1's registered 0.35-delta rule found no contract inside its
  8% spread gate on 408 of 1,201 signals (A n 793).
- Board coverage: the stored chain is +-24 SPXW / +-14 ETF strikes; the outermost OTM strike was still two-sided on 48%
  (S1) / 12% (S2) of signals, so a full chain would give an even cheaper (and worse) C.
- $ per $ vs per-trade mean diverge for the chooser in S1 (+1.7% a trade, -4.1% per $): its $5k-$9k deep-ITM SPXW trades
  carry the dollars.

## Verdict
The pre-registered test FAILS. On the same signals the chooser does not beat the 0.35-delta incumbent (S1 +0.9 points
[-6.9, +8.6], S2 +1.8 [-2.5, +6.1]) or ATM in S1 (+0.0), ties the Compass-style ITM pick (+1.9 / +1.0, n.s.), and only
clearly beats the cheapest contract (+16 / +68 points) and, in S2, ATM (+4.1 [+1.0, +7.2]). Abstention helps only where
the signal itself loses (S2: it declines 96% of trades, so it loses 0.3% a signal instead of 4-6%); where the signal has a
little drift (S1) the cross-fitted drift estimate is noise and abstention cuts the wrong days. Asked to maximise expected
net return per dollar without a directional edge, the model buys stock-like deep-ITM options (median delta 0.77-0.96,
half over $1,000 a contract): the least-bad way to hold an over-priced, decaying 0DTE option is to hold as little option
as possible. Nothing goes to VALIDATION, nothing is frozen, LOCKED untouched. 12 variants in the ledger.
