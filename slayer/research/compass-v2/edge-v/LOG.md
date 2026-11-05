# EDGE-V log: V1 VWAP-PULLBACK / V1P (2026-11-05)

Spec: `specs/PREREG.md`, committed @ c9cdf5e before any outcome (ledger PREREG lines). Owner constraint: long
calls/puts only. Origin day 2026-11-04 is LOCKED and was not used. Full table: `results/V1_DEV.md` / `.json`.

## Pipeline
- `vfetch.py`: 1-minute SPY/QQQ RTH bars with volume (EDGE's bars have none) -> v2data/edge-v/bars (DEV months only;
  VAL bars not fetched because DEV failed).
- `v1.py`: trigger (closed bars, VWAP from bars <= m), contract (0.20 delta in 0.15-0.25, ask 0.15-0.80 / SPXW 1.50-8.00,
  spread <= 10% of mid, board stamped <= t-60), 1-second fills (+2 s, ask in / bid out), exits A/B. EDGE's 1-minute
  chain is read-only; 896 new 1-s files (34 MB total under v2data/edge-v).
- `nulls.py`: M1-execution real vs random-minute (200 draws) and shuffled side (200); synthetic zero-drift (100 reps).
- `tests_lookahead.py`: 738 DEV triggers recomputed with every later bar removed -> 0 mismatches; canary (VWAP that
  includes the next bar) caught on 727/727.

## Result (DEV, 607 root-session days, 318 distinct sessions with a trade)
All 24 variants FAIL. Max trades 128 (< 150); no CI excludes 0 on the positive side; 9 variants have CI entirely
below 0. Best: SPXW-C-X1-B +3.1% [-17.9, +28.4] (n 52); SPY core best SPY-P-X1-A +1.0% [-14.4, +17.0] (n 51).
Random-minute null: buying the same contract at a random minute loses -11..-18%/trade; the $1 trigger beats it in
85-96% of draws (only SPY-C-X1-B >= 95%) but is itself negative. The 0.15% trigger (more trades) is no better than
random (48-74%). Doubled-rate: real 1-s 20-36% vs random-minute M1 14-19% and synthetic zero-drift 24-28%: the lift
over random minutes is reproduced by a driftless random walk at the day's vol, i.e. a dip below VWAP selects
volatile moments, not reversion. ~50% of trades exit on the underlying stop (a new low by X/2).
PBO 0.43, DSR <= 0.02 (N = 334). Null false-pass rates: random-minute 0%, shuffled 0%, synthetic 0-2% (pipeline OK).

Verdict: no VWAP-reversion edge in cheap 0DTE options on DEV; no VALIDATION look; nothing frozen. The 2026-11-04
example is one draw of a ~25-35% doubling base rate that a random walk produces at the same vol.
