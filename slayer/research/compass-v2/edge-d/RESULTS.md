# EDGE-D — scheduled-event variance (CPI / NFP / PPI 08:30, FOMC 14:00) — results

Pre-registration: `specs/PREREG.md` (@ aa6fd76; amendments A1 @ e5051fb, A2 @ fd809d1). Protocol: /tmp/qa/V2_PROTOCOL.md.
Code: `fetch_events.py` (terminal only), `build.py` (MemSession: 1-s NBBO of the legs, parity-forward underlying, BS
greeks per minute from rows <= the minute), `strategies.py`, `run.py` (foundation sim/eval), `tests_lookahead.py` (pass).
Data: `/home/user/falcon-cloud-field-sail/v2data/edge-d/` (parquet/zstd; see size in the hand-off). Locked days never read.

## Calendars (specs/calendar.csv)
- CPI, Employment Situation (NFP), PPI: BLS news-release archives (bls.gov/bls/news-release/{cpi,empsit,ppi}.htm), 2018–2025
  (PPI only 2022+; 2025-10/11 releases kept at their shutdown-delayed published dates).
- FOMC: federalreserve.gov/monetarypolicy/fomccalendars.htm, 2021–2025 scheduled statement days.
- Retail sales: Census schedule archive not reachable (404) — NOT included (gap).
- Controls (A2): Mon/Tue/Wed/Fri 2022+, ±1 day from any calendar date excluded, day-of-month 13–19 and 24–31 excluded.

## Data findings (before any outcome)
1. SPXW has NO GTH pre-open quotes from 2018-12 through 2021-12 (whole-chain rows all zero bid/ask). 2018 pre-open
   quotes exist but the ATM straddle spread is ~16% of mid (median) and 20–45% on Δ0.30 legs at 08:36 → unexecutable
   under rule 4. From 2022 on, GTH spreads are 1.5–3% (straddle) and 2–7% (Δ0.30 legs). The testable pre-open sample is
   therefore 2022–2024 DEV (ex locked Jun–Sep 2022, Aug 2024) and Apr–Dec 2025 VALIDATION.
2. The SPX index prints 0 pre-open and the terminal's pre-open greeks are 0: underlying = parity forward of the ATM
   pair, deltas = Black–Scholes on it (own-mid IV). Canaries: peeking raises LookAheadError; forward uses rows <= t only;
   greeks invisible before the stamp.
3. A whole-chain 1-second request fails at the terminal ("io exception"); 1-minute whole-chain + 1-second per-leg
   requests work (≤1 in flight).

## Results
(filled by `python3 report.py` → `results/TABLES.md`; see below)
