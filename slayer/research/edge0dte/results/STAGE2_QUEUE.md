# EDGE0DTE Stage 2 queue (written before any Stage-2 P&L is seen; not run by the aggregator)

Source: `results/STAGE1_CALIBRATION.md` (one CALIBRATION look, spec sha256
`a45821ada4b545fd731bd4ad54a06d690573c2fec1736404291a3baf2c609743`). Four cells passed the PROTOCOL section-4
CALIBRATION rule; all four are V < 1 (short-premium) cells of family D on SPXW. The Addendum-3 rows B8R and X12R
failed, so no direction (long 0.30-delta) or V > 1 (ATM straddle) expression is queued.

**Caution carried into Stage 2:** in 2024 none of the four cells kept its conditional E[V]-1 below the frozen
DISCOVERY short hurdle (aggressive ask-in/bid-out round trip), and D2 hclose's 2024 CI includes 0. Stage 2 decides
executability; nothing here is an edge.

## Expression rule (PROTOCOL section 4, fixed before P&L)

V < 1 -> defined-risk short iron fly with a fixed time stop at the Stage-1 horizon, AND the REGISTRY_ADDENDUM_2
M1/M2 passive-fill version of the same trade. Common to every variant below:

* Root SPXW (primary); SPY/QQQ/IWM run as replication only. Splits: exit-grid fit on DISCOVERY + CALIBRATION by
  walk-forward (fit on years <= y, score y + 1); frozen with its sha256 in `v2data/locked_looks.jsonl`; one blind
  HOLDOUT (2025) look by a separate scorer. 2026 never opened.
* Structure: sell the ATM call and put at the strike nearest the parity forward F(t) of the board at t
  (`board.select_atm`), buy the call and put wings at the listed strikes nearest F(t) +/- 1 sigma_close(t)
  (ADDENDUM_2 M1's registered wing; the only wing width; no wing grid). Same-day expiry only.
* Signal and entry: the Stage-1 condition evaluated at grid time t with the identical feature code
  (`families/d_vol.py`, frozen DISCOVERY cuts in `results/stage1/D_cutoffs.json`). Primary (P): the FIRST grid time
  of the session at which the condition holds; one package per session. Sensitivity (G): every signalled grid time,
  non-overlapping (a new package only after the previous one is closed).
* Time stop: `fills.exit_decision(day, t, h)` = min(t + h, close - 2 min); h = 60 min or the close (15:58 decision).
  Exit grid (fit by walk-forward, PROTOCOL section 4): {time stop only (P); vol-scaled profit target / stop}.
* Aggressive fills (A): every leg at the first valid 1-second NBBO >= t + 2 s, sell at the bid / buy at the ask, exit
  the opposite way; invalid quotes skipped forward up to 60 s, else the trade is SKIPPED and counted. Fees
  $0.65/contract/side/leg; sensitivities $1.30 and +1 tick each side.
* Passive fills (M, ADDENDUM_2 fill model): each leg a resting limit at mid; filled only when later prints trade
  at/through the limit with cumulative printed size beyond the displayed size ahead at placement; unfilled legs are
  cancelled at the time stop and an incomplete package is not opened (no legging assumed away); exits passive first,
  then cross the spread at the time stop. Same fees.
* Reporting: PROTOCOL section 8 in full, against the section-6 baselines (incl. the unconditional ATM straddle and
  ADDENDUM_2 M1), deflated Sharpe with the full trial count, PBO.

## Queue

| # | Stage-1 cell (passed CALIBRATION) | signal (SPXW, P) | entry | time stop | expression | fills |
|---|---|---|---|---|---|---|
| S2-1A | D2 compression, h = 60 (DISCOVERY ln V effect -0.320, 2024 -0.151) | d_rv30_rel(t) < 0.5 | first signalled grid time (10:05 .. 15:30 with 60 min left to the close) | t + 60 min | short iron fly, wings +/- 1 sigma_close | aggressive |
| S2-1M | same | same | same | same | same | passive (M fill model) |
| S2-2A | D2 compression, h = close (-0.139; 2024 -0.049, CI incl. 0) | d_rv30_rel(t) < 0.5 | first signalled grid time | 15:58 | short iron fly | aggressive |
| S2-2M | same | same | same | same | same | passive |
| S2-3A | D4 high IV/RV, h = 60 (-0.311; 2024 -0.248) | d_iv_rv60(t) >= 2.056208976593107 (SPXW DISCOVERY top-tercile cut) | first signalled grid time (from 10:35) | t + 60 min | short iron fly | aggressive |
| S2-3M | same | same | same | same | same | passive |
| S2-4A | D5 14:30 bucket, h = 60 (-0.530; 2024 -0.453) | decision time in 14:30-14:55 | 14:30 each session (G: 14:55, the other end of the bucket) | t + 60 min | short iron fly | aggressive |
| S2-4M | same | same | same | same | same | passive |
| M1 | ADDENDUM_2 M1 as registered (unconditional) | none | 10:00 | 15:50 or stop at 2x credit | iron fly, wings +/- 1 sigma_close | passive (M) |
| M2 | ADDENDUM_2 M2 as registered | IV/RV top tercile (D4 high, passed) AND gamma concentration top tercile (A5, failed Stage 1; kept because M2 is registered) | 10:00 (the D4 feature is first defined at 10:35, so M2 evaluates D4 at 10:35 and enters then; to be confirmed in the Stage-2 spec before any P&L) | 15:50 or 2x credit | iron fly | passive (M) |

Trial count added to the deflated Sharpe: 8 queued variants (S2-1A .. S2-4M) x the exit grid, plus M1/M2 (already
registered in ADDENDUM_2) and their grids.

Not queued: B8R h30/h60 and X12R h60/hclose (failed the Addendum-3 CALIBRATION rule: Holm p 0.35 .. 1.00, see
`STAGE1_CALIBRATION.md`); every other Stage-1 cell (failed DISCOVERY, `STAGE1_DISCOVERY.md`).
