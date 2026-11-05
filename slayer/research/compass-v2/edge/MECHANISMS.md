# Mechanism memo (worker EDGE, 2026-11-05)

Rule: no test without a forced trader. Each hypothesis names who must trade, why the price has to move, the event-time
trigger, the contract, an adaptive exit and the expected sign and size. Ranked by prior plausibility *for a long
option buyer after the spread* (not by how interesting the mechanism is). What the earlier studies already killed
is listed at the end so it is not re-run.

Execution for every test (V2_PROTOCOL 2–4): decision at event time t from data stamped <= t (underlying 1-minute bars
that have closed, chain minute quotes stamped <= t − 60 s); buy the ask of the first 1-second NBBO quote at or after
t + 2 s (ask size >= 1), sell the bid of the first 1-second quote at or after the exit decision + 2 s; fee $0.65 per
contract per side reported both ways; |delta| 0.15–0.50; spread <= 8% of mid; ask <= 0.6 × the ATM expected move to
expiry (no deep ITM, no lottery tickets below 0.15 delta).

| rank | id | mechanism (who is forced) | trigger (event time) | contract | adaptive exit | expected sign / size |
|---:|---|---|---|---|---|---|
| 1 | **E1 MOM-CLOSE** | **Intraday momentum into the close.** Dealers short gamma after a large day move must buy (sell) more as price rises (falls), and they rebalance most into the close; leveraged/inverse ETFs (SPXL/SQQQ, TQQQ…) must rebalance in the direction of the day's return near 15:45–16:00; MOC imbalance from benchmarked funds follows the day. Gao-Han-Li-Zhou (JFE 2018), Baltussen-Da-Lammers-Martens (JFE 2021: stronger when gamma is negative). | 15:25:00 ET, rest-of-day return r = ln(S(15:24 close)/S(prior close)) with abs(r) >= z × 20-day realised daily vol | 0DTE on the side of r, abs(delta) nearest 0.35 in 0.25–0.50 | bid stop −50%, trail by a fraction of peak once up, signal-decay time stop 15:58:30 (no hold to expiry) | positive; +5 to +20%/trade gross if the last-30-min drift is 5–10 bp; bigger on larger r and short-gamma days |
| 2 | **E2 OPEN-REV** | **Opening-auction overshoot.** Overnight orders, retail market orders and stop orders are executed price-insensitively in the first minutes; liquidity providers absorb them and are paid by a partial reversion once the imbalance is done. The Nov 4 runners were the cheap beaten side near the low after a violent open; Nov4 R4 (opening reversal) won 59% on its holdout but its CI spanned zero. | 10:00:00 ET: opening move m = ln(S(09:59 close)/S(09:30 open)), abs(m) >= 0.35 × 20-day daily vol, and price already off its extreme by >= 25% of the move | 0DTE against m, abs(delta) nearest 0.30 in 0.20–0.45 | underlying (closed 1-min bars) retraces 50% of the move → take; a bar closes beyond the morning extreme → stop; bid −50% hard stop; time stop 12:00 | positive, small (+0 to +10%); calls-vs-puts asymmetry in up-trending samples must be checked |
| 3 | **E3 GAMMA-BREAK** | **Short-gamma breakout.** When dealers are net short gamma (customers long puts, short calls on net), a break of the opening range forces dealers to hedge in the break's direction, extending it; when long gamma they sell rallies / buy dips (pinning). | first 1-min bar closing outside the 09:30–10:00 range, 10:00–13:00, on days with net dealer GEX < 0 (from the prior day's OI, all expiries <= 30 DTE, strikes within ±10%, dealers long calls / short puts) | 0DTE on the break side, abs(delta) nearest 0.35 | bar closes back inside the range midpoint → stop; trail at peak bid × (1 − f); bid −50% stop; time stop 15:30 | positive on GEX<0; ~0 or negative on GEX>0 (pre-registered contrast) |
| 4 | K5 family | **Overnight index repricing.** ES/futures trade 24 h; SPXW GTH options must be re-marked by the few market makers quoting overnight, with SPXW the cheapest instrument to own the overnight move. | 00:00–05:59 marks, side of the overnight move | SPXW 0.10–0.20Δ | hard stop 1.5× / 0.5322, flat 09:20 | positive (dev +38%/call); **frozen — goes to the blind scorer (specs/K5.spec.md), not re-tested here** |
| 5 | E5 EVENT-IV | **Scheduled-event IV crush / realised vs implied.** Before CPI/FOMC/NFP, hedgers bid event vol; after the print IV collapses. A buyer only wins if realised exceeds the crushed implied: buy *after* the print when the first 5 minutes already realised > the event straddle. | 08:30 print + 5 min (SPXW GTH) or 14:00 FOMC + 5 min | 0DTE on the move's side | trail by realised vol | weak; the buyer is on the wrong side of the crush; low rank |
| 6 | E6 CHARM-CLOSE | **0DTE charm/vanna decay.** As 0DTE OTM options decay into the close, dealers short them unwind hedges (charm), pushing the index toward the largest-OI strike (pin) in the last hour. | 15:00, distance to the max-OI 0DTE strike > 0.5 expected moves | 0DTE toward the pin | target at the pin, time stop 15:55 | positive but overlaps E1 and the pin pulls against E1 on trend days; test only if E1 fails |
| 7 | E7 SWEEP-DRIFT | **Informed aggressive flow.** Sweeps lifting offers on short-dated OTM options reveal informed demand; dealers selling them delta-hedge immediately (buying stock), and the information diffuses over minutes. | a UW sweep cluster with net premium > X on one side within 5 min | the same expiry, 0.25–0.45Δ | trail / time stop 60 min | small; Nov4 R1 (flow-aligned 0DTE) lost on its holdout (45%, −9%); UW history is too short for a DEV/VAL/TEST split before 2025 |
| 8 | E8 NEWS-DRIFT | **Post-news drift on single names** (attention-constrained investors, slow diffusion). | UW news timestamp + first 1-min reaction > 2σ | 1–7 DTE 0.30–0.45Δ on the reaction side | trail, time stop next day | uncertain; UW news history depth and timestamp quality unverified; no single-name tick cache before 2025 |
| 9 | E9 MOC | **MOC imbalance** (published 15:50): the imbalance must be crossed at 16:00. | 15:50 imbalance feed | 0DTE | exit 15:59 | positive but we have no imbalance feed; untestable now |

## Dead ends not to repeat (from compass-model4, nov4, dont-chase)
Regular-session ML scores (v1/v2/M1/M2/M5), always-ride, the Hit-score filter family, "don't chase" (≈1 pt of win
rate), gap-in-direction alone, delta/premium/RV-IV cuts on the regular session (best cells 46–48% win and losing),
flow-aligned 0DTE (Nov4 R1), hot-tape weekly (R2), gamma-flip side (R3: chose the side of the flip, no break trigger;
E3 differs: it conditions a *break* on the *sign* of dealer gamma), XSP/RUTW overnight, evening overnight marks,
the 07:30 pre-market.

## What gets tested here
E1, E2, E3 on DEV (sessions before 2025-01-01 outside H1/H2), exits iterated on DEV only, frozen, VALIDATION
(2025, outside H2) once. Each spec is pre-registered in `specs/` and the global ledger before its DEV test.
