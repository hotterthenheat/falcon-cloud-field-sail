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

## 3. Run
- Book: 2,203 of 2,204 DEV root-sessions (547 sessions 2020-02..2024-12; IWM 2020-03-16 has no OI in EDGE's cache);
  one read a minute 09:46-15:00 = ~690k flip reads. Look-ahead test on the final 2,908 triggers (`results/lookahead.txt`,
  before any outcome was read): book reads 60/60, features + all three cell picks 60/60, R1a full read histories 9/9
  identical with later bars/boards as noise; canaries (forming bar, next chain stamp) caught 60/60 each.
- Triggers: R1A 514 (every one a put: the crossing into the dealer-short side is downward through the flip), R1B 744,
  BASE 1,650 (R2-CLEAR 1,261, R2-BLOCKED 197, R3 830).
- Terminal: 17,869 requests, one in flight, 0 failures (book 3,417; P1 4,462; P2 3,247 incl. IWM board snapshots;
  P3 4,174; P4 2,569); 1,004 paths reused from edge/edge-t/edge-l/edge-m caches. No time or disk cut: all four phases ran on
  every session. Disk: 673 MB under v2data/edge-g (budget 1 GB); free never below 4.8 GB after 07:00 UTC.
- N3: 100 runs, 2,207 root-sessions; synthetic trigger counts track the real (R1A 536 vs 514, R1B 750 vs 744, BASE 1,619 vs
  1,650); FDR 0% in all 21 variants (the pipeline manufactures no passes).

## 4. Results (DEV, net of $0.65/side, session-clustered 95% CI) -- full tables in results/DEV.md
| variant | 0DTE d0.30 | 0DTE d0.45 | 1-7 DTE d0.45 |
|---|---|---|---|
| R1a flip-cross | 462: -9.7% [-13.0,-6.3] | 456: -8.2% [-11.3,-5.0] | 508: -3.5% [-5.4,-1.5] |
| R1b flip-ahead | 671: -4.4% [-8.1,-0.7] | 644: -1.7% [-5.2,+1.9] | 740: -0.7% [-2.7,+1.5] |
| R2-CLEAR | 1082: -6.4% [-10.3,-2.3] | 1031: -3.1% [-7.0,+0.7] | 1257: -1.7% [-3.8,+0.4] |
| R2-BLOCKED | 162: -8.0% [-15.9,-0.1] | 194: -9.9% [-16.6,-2.7] | 197: -4.5% [-8.3,-0.4] |
| R3 RV>IV | 683: -6.8% [-11.9,-1.2] | 656: -3.6% [-9.1,+2.1] | 828: -1.3% [-4.3,+1.9] |
| BASE-XA | 1420: -6.3% [-10.1,-2.7] | 1382: -4.4% [-8.0,-0.7] | 1645: -2.2% [-4.2,-0.1] |
| BASE-XB | 1420: -6.5% [-10.7,-2.4] | 1382: -4.8% [-8.6,-1.0] | 1645: -1.2% [-3.2,+1.0] |
PBO (21 variants, CSCV 16 blocks) 0.60. DSR 0.000 for all 21 at the ledger's trial count (904 when read).

Readings:
- R1a: the crossing into the dealer-short side LOSES and is worse than a coin (N1 beats 0-6%) and worse than zero-drift
  paths (N3 beats 0-13%): after a downward cross of the flip SPX/ETFs tend to come back (62-74% of exits are the re-cross).
  Worse when the front book is also dealer-short (0D30 -12.7% vs -5.9%), the opposite of the registered expectation.
- R1b: the side toward the flip carries direction (N1 beats 98-100% of side shuffles in every cell) but not enough to pay
  the option: best cell 1-7 DTE -0.7% [-2.7,+1.5]. The AUC 0.85 of 2026-11-05 does not survive as a trade.
- R2: CLEAR is better than BLOCKED (per-session diff 1-7 DTE +2.8% [+0.0,+5.7]; 0D45 +3.2% [-3.0,+9.4]) and beats 92-96% of
  random BASE subsets in two cells, so wall room is real information, but CLEAR itself is negative everywhere.
- R3: realised > 1.25 x implied by mid-day adds nothing over the trend entries it filters (N2 beats 15-70%); -1.3% to
  -6.8%. $ per $ is slightly positive in 0DTE (+0.3%, +3.0%) because the larger SPXW premiums did better, n.s.
- Everything pays only on |SPX o->c| > 1.5% days (e.g. R3 0D45 +22.7%, n 54; R2-CLEAR 0D45 +11.8%, n 76) and loses on
  < 0.5% days (-4.6% to -11.3%): an ex-post stratum, not knowable at entry. 2020 positive for the trend cells, 2022-2024
  negative.
- Execution: median premium $61 / $107 / $186 (0D30 / 0D45 / 1D45; p95 $690 / $1,210 / $2,290), median spread at fill
  2.8% / 1.9% / 1.2%, entry lag 2 s; 9% of 0DTE picks had no contract inside the gate (|delta| +-0.08, spread <= 8%).

## 5. Verdict
No variant passes DEV, so nothing was fetched for VALIDATION 2025, nothing frozen, LOCKED untouched. 21 variants in the
ledger + R4 (untestable on history) + R5 (dead family, not re-run).
