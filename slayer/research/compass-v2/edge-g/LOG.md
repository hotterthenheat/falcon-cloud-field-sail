# EDGE-G log: R1 flip / R2 wall room / R3 realised > implied (the 2026-11-05 live-scan leads)

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls/puts only. Pre-registration `specs/PREREG.md`
(21 variants) committed before any book, trigger or outcome.

## 0. Before the pre-registration
- Format probes only (2026-11-06 06:18 UTC, one request each, no strategy quantity computed): SPY
  /option/history/greeks/eod 2024-03-14 (expiration=*, max_dte=31: 3,139 rows, 0.8 s, IV + gamma + underlying present);
  SPX /option/history/open_interest 2024-03-15 (7,089 rows; root SPX = the AM monthlies, separate from SPXW).
- Disk at start: 3.8 GB free on / (shared). Budget 1 GB under v2data/edge-g; stop fetching below 3 GB.

## 1. Book port and parity (before any trigger)
- `gex.py`: Python port of core/gammaFlip.ts (repricedFlip, netGammaAt/Path, quietLegs), flipLevel.ts (smileOf,
  same-day ITM runaway rule, stickFlip hysteresis), core/walls.ts pickLegWalls, levelsOfRows' supreme, settle.ts roots.
- `parity/test_parity.py` -> `parity/PARITY.md`: **PASS**. (A) 49/49 leg sets through the app's own TS (tsx) and the
  port: flip, net at spot, every crossing, netGammaAt at 25 prices, walls agree to <= 4.3e-13 relative (the recorded
  pinpoint-2026-10-29 SPY/NVDA books, 40 synthetic books, 5 DEV history books); the history "fast" bracket closing
  (3 x 64-point refinement instead of 40 serial bisections) lands within 1.6e-9 of spot of TS. (B) recorded book:
  Python off the raw vendor rows reproduces GOLD net, call wall, put wall, supreme exactly for SPY/NVDA today and all;
  the Python flip on the rows' priced legs is within 4.6e-7 .. 9.2e-5 of spot of GOLD (bar 2e-4, the golden's own).
- `book.py`: point-in-time history book, one read a minute 09:46-15:00 (SPXW ~14 s, ETFs ~5 s a root-session).

## 2. Implementation notes (all fixed before any outcome was read)
- History book reads end at 15:00 (PREREG); R1a's re-cross exit after 15:00 compares closed bars to the last held
  flip of 15:00. 1-7 DTE cell = the first expiry after the session (edge-r's boards; IWM: a fetched 1-minute snapshot),
  kept only if <= 7 calendar days out.
- The 0DTE IV is solved against the close of the bar ending at the chain stamp (the price at that quote), the book is
  priced at S_t (the last closed bar); every book leg is priced at S_t, so the app's "own spot" shortcut applies.
- Look-ahead test (tests_lookahead_g.py): a first run reported 0/25 "identical" reads; cause: the masking cast the
  float32 boards to float64 (mid computed in a different precision), not a leak. Fixed by keeping dtypes; 25/25 reads,
  25/25 features+picks, 4/4 R1a full histories identical; both canaries caught 25/25 (partial trigger list; rerun on all).
- Exit unit checks on fabricated paths: TP at the resting limit, vol stop, time, trail behave as registered.
- N3 approximations: 10-second grid with one-step latency; the 1-7 DTE cell priced 1 session out at the root-session's
  real 1D45 pick IV (else the 0DTE ATM IV); half-spread = the real median entry half-spread of the cell.
- Partial trigger rates on the first ~100 books: R1A ~19% of root-sessions (all puts: the crossing into the dealer-short
  side is downward through the flip), R1B ~27%, BASE 0.63 per root-session (R2-CLEAR 75%, R2-BLOCKED 12%, R3 47% of BASE).
- Disk: the EMA job grows ~7 MB/min on the shared disk (441 -> 680 MB in 35 min); free 3.5 GiB at 06:50 UTC.
