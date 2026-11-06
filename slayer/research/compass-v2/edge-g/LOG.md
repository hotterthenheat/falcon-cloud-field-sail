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
