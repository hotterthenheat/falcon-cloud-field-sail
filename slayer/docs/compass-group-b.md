# Compass Group B — model-input fixes (landed 2026-11-06)

The audit's Group B found five places where the inputs Model 1 (Hit) and Model 2 (Runner) read are wrong off a full
regular day, a live-path row that differs from the scan's, and an open-interest look-ahead. Research found no
demonstrated edge for Compass (`research/compass-v2/FINAL-REPORT-2026-11-05.md`), so Group B lands with the live
engine's behaviour as the baseline: only proven bug fixes run live; every other change that would move a live score or
gate is behind a switch that is off; feature version 2 runs in the shadow only.

## What changed, and where it lands

| | Finding | Fix | Lands |
|---|---|---|---|
| B1 | `yearFrac` floors 390 − t at 0: an evening, overnight or curb mark gets T ≈ 1e-6 y (vol solve fails, greeks fall back, column 15 = −300) | **Feature version 2**: T on one trading-time clock (`compassParams.tradingMinutesTo`) | shadow only (the shipped trees were trained on version 1's inputs; no version 2 trees exist) |
| B2 | Half days: T and column 15 assume a 16:00 close | the same clock reads each session's own close | shadow only |
| B5 | 1–7 DTE contracts count only today's minutes (solved vol too high) | the same clock counts every session to the expiry | shadow only |
| B2b | The theta-burn gate mixes the 16:00 theta with an early-close / overnight flat | off a full regular day, the repriced decay to the session's own flat (`compassFeatures.decayOver`) | **switch `COMPASS_GATE_DECAY`, off** |
| B3 | `scoreLiveContract` (the Weigher) built its row differently from the scan | one path (`passInputs` → `slotInputs` → `rowInputs`), the scan's contract id and sleeve, the session's date | **live (bug fix)** |
| B4 | The ATM pair read every board row, stale or crossed | `atmRows`: a valid quote stamped within 90 s | **switch `COMPASS_ATM_FRESH`, off** |
| OI | `pinOf` keyed the open-interest count on `Date.now()`: a mark scored late read a count published after it | keyed on the mark (`oiCountDay`) | **live (bug fix)** |

Model files: unchanged. SHA locks of `model_entry_all6months.txt` / `model_runner_all6months.txt`: unchanged.
`V2_ENTRY_SHA` / `V2_RUNNER_SHA` are empty, so the shadow loads nothing and stays inert even with `COMPASS_V2_SHADOW=1`.

## Why B3 and OI are live

Both fail on main's `compassModel.ts` and pass here (`scripts/compass-groupb-proof.ts`):

- B3: on the same contract (SPY 505C) and minute, main's scan gave Model 1 0.2457 / Model 2 0.5631 and main's Weigher
  gave 0.3267 / 0.5660. After: the Weigher gives the scan's numbers bit for bit. The scan itself is unchanged (the same
  0.2457 / 0.5631 before and after; Compass golden 220 of 220). B3 only touches the Weigher's display path; it places
  and alters no call.
- OI: a Wednesday 21:00 mark scored Thursday 08:00 (a restart's fill) read Thursday's count (published Thursday 06:30,
  after the mark). After: it reads Wednesday's count when the live read cached it. A live mark is the wall clock, so
  live marks are unchanged. Limit: the open-interest endpoint is a snapshot, so a late mark on a cold cache still reads
  the current count, as before.

## Why B2b and B4 are switches

Neither is a pure bug fix of the live answer: each changes which live calls are made (B2b both ways: an overnight
mark's decay to its 09:20 flat is nil, so it never burns), and the shipped trees' training inputs are not in the
repository, so there is no proof the shipped trees' live answers were wrong against their own training. With the switch
off, the live row is main's (the proof's "B4 switch off" check passes on main's code too).

## Research status (honest)

`research/groupb/` (build, train, evaluate) is the tooling only. Nothing was run: no rows, no trees, no holdout numbers
exist anywhere on disk, and the ledger has no Group B entry. Against the v2 protocol (`/tmp/qa/V2_PROTOCOL.md`) the
design could not count even if run: its training window (2026-06-29 .. 2026-10-02) and its holdouts (H1, H2) are all
LOCKED test data; its "dev" set is the training sessions (in sample); fills are the one-minute NBBO a full minute after
the mark (ask in, bid out, no fees), not the protocol's tick NBBO + 2 s; no nulls; no pre-registration. Group B has no
evidence that it improves any call. Before version 2 can go live it needs trees trained on DEV, chosen on VALIDATION,
one blind LOCKED look, and a shadow forward test.
