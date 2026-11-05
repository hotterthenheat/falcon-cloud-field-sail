# EDGE-L results (long calls / puts only)

Registration: `specs/PREREG.md` @ d14dc62 (committed before any outcome). Ledger lines: `EDGE-L` in
`research-v2-ledger.md` (snapshot `specs/ledger-snapshot.md`). Code: `l1signal.py` (forecast/implied/R),
`l1sim.py` (fills/exits), `run_l1.py`, `analyze.py`, `l3.py`, `l3_analyze.py`, `tests.py` (look-ahead).
Data: `v2data/edge-l/` (signals, 1-s NBBO of traded legs, L3 name chains), reusing EDGE's 0DTE chains/bars and the
physics gamma book read-only.

## Look-ahead controls
`common.Clock` serves only bars whose end <= T and the chain snapshot stamped T-60 s; asking for anything later
raises `LookAhead` (canary peeks raise, `tests.py` 1). Signal inputs recomputed with every bar/quote stamped >= T
deleted are identical on 48 sampled (root, session, T) (`tests.py` 2). The HAR x gamma forecast is fitted walk-forward
(monthly expanding refits on prior DEV sessions only). One bug found and fixed before any outcome was read: int16
minute stamps overflowed in `m*60` (would have broken the point-in-time filters).

## L1 CHEAP VOL — FAILS DEV (8 variants), no VALIDATION look, nothing frozen
DEV = 2023-2024 (ex 2024-08), SPY 367 / SPXW 365 / QQQ 141 forecastable sessions per decision time.
1-s NBBO execution, ask in at T+2 s, bid out at decision+2 s, $0.65/contract/side.

| variant | n | win | net/trade [95% CI] | no fee | payoff | real/impl traded | key null beats | FDR key/shuf/syn |
|---|---|---|---|---|---|---|---|---|
| V1 S0945 k1.10 XA | 142 | 37% | -5.9% [-21.9, +11.4] | -5.2% | 1.36 | 0.942 | 81% | 0 / 0 / 0.5% |
| V2 S0945 k1.25 XA | 25 | 52% | +11.3% [-26.5, +50.5] | +12.1% | 1.36 | 0.980 | 94% | 0 / 0 / 1.0% |
| V3 S0945 k1.40 XA | 8 | 50% | -32.5% [-82.0, +17.0] | -31.8% | 0.21 | 0.988 | 15% | 0.5 / 1.5 / 5.0% |
| V4 S0945 k1.25 XB | 25 | 36% | +7.0% [-18.3, +31.9] | +7.8% | 2.47 | 0.980 | 94% | 0 / 0.5 / 1.0% |
| V5 S1030 k1.25 XA | 24 | 29% | -20.1% [-49.4, +16.0] | -19.4% | 1.16 | 0.987 | 14% | 0.5 / 0 / 3.0% |
| V6 D0945 k1.25 XA | 21 | 38% | +17.0% [-62.4, +119.8] | +18.2% | 2.10 | 0.974 | 86% | 0 / 0.5 / 0.5% |
| V7 D1030 k1.25 XA | 17 | 24% | -11.3% [-79.5, +104.7] | -10.5% | 2.71 | 1.000 | 47% | 0.5 / 0.5 / 0.5% |
| V8 D1030 k1.25 XB | 17 | 24% | +3.2% [-59.3, +73.9] | +4.3% | 3.43 | 1.000 | 62% | 1.5 / 1.5 / 1.5% |

PBO (CSCV, 16 blocks, 8 variants) 0.63; DSR <= 0.01 for every variant (N = 408 ledger trials). Synthetic no-edge
(zero drift, path vol = entry implied vol) means -2% to -6%/trade; no real variant beats its 95th percentile.
Null false-discovery rates 0-5% (pipeline calibrated).

Why it fails (the mechanism check): realized/implied over all DEV sessions = 0.908 (09:45) and 0.905 (10:30), i.e. the
0DTE straddle over-prices the rest of the day by ~9%. R ranks that ratio monotonically (0.85-0.89 for R < 0.9 up to
0.98 for R >= 1.25; corr(log R, log realized/implied) = 0.13) but never finds a bucket where realized exceeds
implied, so buying is still paying the premium. The gamma regime is already priced at the 0DTE level:
realized/implied 0.911 on short-gamma days vs 0.905 on long-gamma days (the fitted short-gamma coefficient is
+0.073 in log variance, ~ +3.7% in sd: real, but the 0DTE price has it). Only V1 reaches >= 100 DEV trades and it is
negative; the k = 1.25 variants are positive point estimates on 17-25 trades with CIs spanning +-30-100%.

Disclosure: the minute-path sweep that feeds the nulls also computed 2025 VALIDATION rows for the six unconditional
structures (all sessions, any R) before L1 failed DEV; no trigger-conditioned VALIDATION number was computed.

## L2 SHORT-GAMMA BREAK — dropped (duplicate of EDGE E3), 0 trials
EDGE's E3 already tests GEX < 0 at the open + first close outside the 09:30-09:59 range + ~0.35d 0DTE on the break
side; L2 would only change the exit (an exit variant of E3, not a new hypothesis).

## L3 VOL-SHOCK SPILLOVER — FAILS DEV (2 variants), no VALIDATION look, nothing frozen
DEV 2023-2024: 2,692 SPY shock minutes (15-min/day per-minute RV >= 2 with SPY's 0DTE ATM IV rising) on 191
sessions -> 535 name triggers (AAPL 139, MSFT 199, NVDA 197) where the name's ATM IV (1-7 DTE) rose < half of SPY's
(median dIV SPY +1.8 vol pts vs name +0.03). 0.35d long option on the side of SPY's 15-min move; 1-s NBBO execution.

| variant | n | win | net [95% CI] | no fee | payoff | synthetic no-edge (beats) | side-shuffle (beats, n=74 AAPL) |
|---|---|---|---|---|---|---|---|
| M1 flat 60 min | 535 | 40% | +1.5% [-2.7, +6.4] | +2.3% | 1.75 | -2.9% (100%) | -2.1% (83%) |
| M2 vol bracket | 535 | 39% | -1.9% [-4.8, +1.1] | -1.2% | 1.28 | -2.7% (85%) | -1.1% (92%) |

DSR 0.01 / 0.00 (N = 419). M1 beats the no-edge synthetic world by ~4.4 points (the spillover move is partly real),
but +1.5%/trade is far below the +10% bar and its CI includes 0; the adaptive bracket gives it back. Null FDRs 0-0.5%.
The side-shuffle null is only partial: the opposite-side contract was fetched for the first 74 AAPL triggers before
the fetch was cut to own-side only (terminal time); on that subset the opposite side lost -4.6%/trade.

## Verdict
Nothing passes DEV; nothing is frozen; no blind-scorer spec. The variance risk premium on 0DTE index options
(~9% of the straddle on DEV) is not undone by a HAR x opening-gamma forecast: the best forecast buckets still realize
~0.98 of implied, and the gamma regime is already in the 0DTE price. Single-name spillover has a small, real but
uneconomic effect (+1.5%/trade, CI spans 0).
