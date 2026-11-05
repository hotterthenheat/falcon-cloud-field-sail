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

## Results (net of spread + $0.65/contract/side; ask in, bid out, +2 s; session-clustered 95% CIs)
Full tables: `results/TABLES.md`; every variant/set/null is a line in the ledger.

| hyp | set | n | net expectancy [95% CI] | win | realized/implied (median) | verdict |
|---|---|---|---|---|---|---|
| D1 straddle 08:25 (CPI/NFP/PPI) | DEV event, X1..X5 | 89 | X2 -4.8% [-9.1,-0.0] (best) .. X4 -22.9% [-27.1,-19.3] | 25-28% (X4 1%) | 0.28 (15m) / 0.32 (30m) / 0.35 (50m) | D1- confirmed, D1+ rejected |
| | DEV control mornings | 44 | X1 -2.6% [-3.5,-1.7] .. X4 -4.9% | 11-14% | 0.12 / 0.14 / 0.22 | event straddles lose MORE than controls |
| | VALIDATION event | 23 | X1 -8.3% [-13.6,-2.8] .. X4 -23.1% [-32.0,-15.6] | 4-22% | 0.32 / 0.47 / 0.45 | sign replicates |
| D1b FOMC straddle 13:55 | DEV (2021-24) | 28 | X3 +19.1% [-14.6,+69.0] (2024 n7 +70%); X4 -18.7% [-25.5,-11.9] | 4-54% | 0.35 / 0.48 / 0.74 | FAIL (n, CI) |
| | VALIDATION | 6 | -4.9% .. -22.7% | 0-33% | 0.23 / 0.19 / 0.48 | FAIL |
| D2 post-08:30 drift 0.30Δ | DEV continuation E1..E4 | 64 | E1 -19.3% [-33.6,-3.4] .. E4 -3.6% [-15.9,+9.8] | 25-58% | - | FAIL |
| | DEV reversal contrast | 66 | E1 +1.2% [-14.5,+18.5] .. E2 -6.4% | 39-59% | - | FAIL |
| | VALIDATION continuation | 20 | E1 -18.4% [-35.7,-0.2] .. E4 -10.0% | 20-40% | - | FAIL |
| D2b FOMC drift | DEV continuation | 15 | E2 +42.5% [-16.5,+108.5] .. E4 +7.7% | 47-53% | - | FAIL (n=15, CI, shuffle 82%) |
| | VALIDATION | 3 | -24% .. -65% | 0-33% | - | FAIL |

Nulls: control mornings (key null) — D1 control straddles lose 2.6-4.9% (no 08:30 print, smaller implied 0.53% vs
0.69%); D2 triggers on only 6/44 controls (a 0.10% move in 08:30-08:35 is an event phenomenon). Shuffled-side null
(50 seeds): D2 DEV candidate beats 6% (CI-pass rate 0%), D2 VAL 12% (2%), D2b DEV 82% (2%), D2b VAL 34% (0%) —
calibrated (<= 5% FDR). Synthetic zero-drift null: MIS-SPECIFIED for straddles (path keeps the event's jump variance
after entry, options priced at window-average or median IV -> a no-edge straddle shows +11..+116%); its pass rate is
not an FDR estimate and is not used; it cannot create a false pass. PBO (CSCV over each family's variants): D1 0.14,
D2 0.24, D1b 0.61, D2b 0.64.

D3 earnings straddle (15 names, UW postmarket dates, first expiry after the report, 15:55 at ask; `d3.py`):
| set | n | Y1 09:35 | Y2 10:00 | Y3 15:55 | realized/implied (Y1/Y3) |
|---|---|---|---|---|---|
| DEV event | 143 | +2.6% [-6.0,+12.1] | +5.8% [-3.8,+16.1] | +4.9% [-5.2,+15.8] | 0.88 / 0.99 |
| DEV control (14 d earlier) | 99 | -1.0% | -2.0% | -0.5% | 0.33 / 0.63 |
| VALIDATION event | 38 | -6.0% [-24.6,+15.9] | -11.6% | -25.8% [-43.1,-4.3] | 0.67 / 0.52 |
DEV is NOT the pre-registered negative sign (CI spans 0; 2024 +11..+15% carries it); VALIDATION is negative. Neither
sign holds across splits -> FAIL; earnings straddles on these mega-caps are close to fairly priced. D3b not run (0 trials).

Verdict: NOTHING passes; nothing frozen; no locked-test look requested.

Reading: the option market OVER-prices the 08:30 move in the 08:25 0DTE straddle (realized ~0.3x implied within
50 min; only 7-11% of events exceed the implied move by 09:20). Long premium into the print is a consistent loser in
2023, 2024 and 2025 (2022 n22 slightly positive, +1..+4%). Post-print continuation is not exploitable with a 0.30Δ
0DTE option bought at 08:36 (the first 5 minutes already contain the repricing).
