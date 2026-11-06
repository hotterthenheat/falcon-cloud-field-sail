# EDGE-G log: R1 flip / R2 wall room / R3 realised > implied (the 2026-11-05 live-scan leads)

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Long calls/puts only. Pre-registration `specs/PREREG.md`
(21 variants) committed before any book, trigger or outcome.

## 0. Before the pre-registration
- Format probes only (2026-11-06 06:18 UTC, one request each, no strategy quantity computed): SPY
  /option/history/greeks/eod 2024-03-14 (expiration=*, max_dte=31: 3,139 rows, 0.8 s, IV + gamma + underlying present);
  SPX /option/history/open_interest 2024-03-15 (7,089 rows; root SPX = the AM monthlies, separate from SPXW).
- Disk at start: 3.8 GB free on / (shared). Budget 1 GB under v2data/edge-g; stop fetching below 3 GB.
