# EDGE-V pre-registration: V1 VWAP-PULLBACK (calls) and V1P (puts mirror)

Registered 2026-11-05, before any DEV outcome of this hypothesis was computed. Owner constraint: long calls and
long puts only (buy to open, sell to close). Protocol: /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14.

## Origin (hindsight, one day, LOCKED - not used)
2026-11-04 SPY 768C 0DTE 0.33 -> 1.90 after SPY sat $1.74 under session VWAP on an up day. That day is in the
LOCKED TEST window (>= 2026-07-01). It motivated the idea only; no number from it is used anywhere here.

## Mechanism (stated before testing)
Intraday mean reversion to the session VWAP: institutional VWAP-benchmarked execution (algorithms that buy more
when price is under the running VWAP to hit their benchmark) and dealer hedging pull price back toward the
volume-weighted average after a liquidity-driven dip, more so on trend (up) days where the dip is against the day's
direction. Cheap low-delta 0DTE options are convex, so a reversion of ~1.5x the dip pays several times the premium
while the loss is capped at the premium. Expected sign: positive expectancy for the VWAP-dip trigger, and better than
buying the same contract at a random minute of the same sessions. Mirror (V1P): a rip above VWAP on a down day
reverts down; buy a 0.20-delta put.

## Data (all point-in-time)
- Underlying: 1-minute RTH bars with volume (ThetaData stock OHLC, interval 1m) for SPY and QQQ, fetched to
  v2data/edge-v/bars/. Bar m covers [m*60, m*60+60) s of the ET day and is visible from (m+1)*60.
- Session VWAP at decision t = (m+1)*60: sum(typical*vol)/sum(vol), typical = (h+l+c)/3, over RTH bars 09:30..m
  (only bars closed by t). Open O = open of the 09:30 bar.
- Option chain: EDGE's 0DTE 1-minute NBBO board (v2data/edge/chain, read-only); the board used at t is the row
  stamped (t-60) floored to the minute (all quotes stamped <= t-60). Delta = Black-Scholes from the mid IV, T to 16:00.
- Fills: 1-second NBBO per contract (ThetaData option quote interval 1s), cached in v2data/edge-v/q1s/.

## Trigger (event time, closed bars only)
Decision times t = (m+1)*60 for bars m = 599..869 (10:00:00 .. 14:30:00 ET). Let c = close of bar m, V = VWAP at t.
- V1 (calls): c <= V - X and c > O (up on the open).
- V1P (puts): c >= V + X and c < O (down on the open).
- X1 = $1.00 of the trigger root's price; X2 = 0.15% x c.
- First trigger per session per side per X only. If that trigger has no eligible contract, no trade that session
  (no retry later).

## Contract
0DTE of the traded root, side per trigger; |delta| closest to 0.20 within [0.15, 0.25]; ask in [0.15, 0.80]
(SPXW: [1.50, 8.00], i.e. x10 for the 10x index); (ask - bid)/mid <= 10%; bid > 0; ask size >= 1 on the board.
Enter 1 contract at the ask of the first 1-second quote stamped >= t + 2 s with bid > 0, ask > 0, ask size >= 1
(no fill if none within 60 s). Note: the 10% spread gate is the owner's pre-registered rule and is looser than
protocol rule 4's 8%; disclosed as a deviation.

## Exits (decision d; fill at the bid of the first 1-second quote stamped >= d + 2 s)
Dip D = V - c (calls) / c - V (puts) at the trigger; trigger-bar low Lo / high Hi; V frozen at the trigger value.
- Exit A (target/stop): target = a closed bar with close >= V + D/2 (calls; puts: close <= V - D/2) OR option bid
  >= 2 x fill; stop = a closed bar with close <= Lo - X/2 (puts: close >= Hi + X/2); time stop t + 60 min; flat 15:50.
- Exit B (trail): after the option bid has reached 2 x fill, exit when bid <= 0.7 x peak bid since entry; same
  underlying stop, time stop and 15:50 flat; no underlying target.
Option-based rules are evaluated on every 1-second quote; underlying rules on each bar as it closes.
Fee $0.65/contract/side (reported with and without).

## Variants (all counted: 24)
Core V1/V1P on SPY: {call, put} x {X1, X2} x {A, B} = 8. Pre-registered extensions, same 8 each:
- QQQ: trigger on QQQ bars/VWAP, trade QQQ 0DTE.
- SPXW: trigger on SPY bars/VWAP (SPX has no volume), trade the SPXW 0DTE contract (delta from SPX spot,
  ask band x10). Same sessions/events as SPY: not independent evidence.
Total 24 variants -> global trial count = ledger count + 24.

## Splits
DEV = EDGE's DEV session list (2020-02-18..04, 2022-01..05, 2022-10, 2023-01..2024-12, minus 2024-08; no H1/H2,
nothing >= 2026-07-01), restricted to sessions with a same-day expiry for the traded root.
VALIDATION = EDGE's 2025 VAL list (2025-04..12), looked at ONCE, only for a variant whose DEV result has
>= 150 trades AND net expectancy 95% session-clustered CI > 0 AND beats >= 95% of the random-minute null.
LOCKED TEST: never scored here; a VALIDATION survivor is frozen as a spec + commit hash for the blind scorer.

## Nulls (anti-bias 11)
Null comparisons use M1 execution for both the real trigger and the null (entry at the ask of the first 1-minute
board row stamped >= t + 2 s, exit at the bid of the first row stamped >= d + 2 s, option rules on board rows),
because 1-second paths for thousands of null draws are not affordable on the shared terminal.
1. KEY NULL - random minute: for each session where the variant triggered, a uniform random decision minute in
   10:00..14:30 of the same session, same side, same contract rule, same exits with D := X, Lo/Hi := that bar's
   low/high, V := c + X (calls) / c - X (puts) (i.e. the geometry of a minimal trigger). 200 draws. Reports
   expectancy and the doubled-rate (option bid >= 2 x fill at any time within the hold window t..min(t+60m,
   15:50)) vs the trigger's.
2. Shuffled side: same trigger times, side (call/put) by a fair coin, mirrored exits. 200 draws.
3. Synthetic zero-drift: underlying re-simulated at 10-s steps from the real day's 1-minute realised vol with zero
   drift, real per-minute volume profile for VWAP, Black-Scholes options at the real ATM IV (flat smile), real
   median spread of the selected contracts, same trigger/contract/exits (10-s grid, fills 10 s after decisions).
   100 runs per SPY variant. Null pass rate (CI > 0) is the pipeline FDR and must be <= 5%.
A variant counts only if it beats >= 95% of the random-minute and shuffled-side nulls.

## Checks
Look-ahead: recompute recorded triggers with all bars after the trigger bar removed (must be identical); a canary
VWAP that includes the next bar must be detected. Independent events = sessions (one trade per session per variant).
Reports: sessions/trades, win, net expectancy +/- CI (session-clustered), payoff, doubled-rate vs null, null pass
rates, PBO (CSCV over the 24 variants), DSR with the global trial count.
