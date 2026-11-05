# EDGE-R log (2026-11-05): Compass Model Risk (book R) on history

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10-14. Pre-registration `specs/PREREG.md` (R0, R1, R2), committed before
any EDGE-R terminal request or outcome.

## Timeline
- 15:03 ET: read protocol, README, FINAL-REPORT, edge-t/edge-m, modelRisk.ts/modelRiskScan.ts, the live 2026-11-05
  record (book R). Wrote PREREG. No terminal request before 16:05 ET.
- 15:05 ET: PREREG committed @ 74ad403 (ledger: 3 PREREG lines, 1 variant each).
- 15:12 ET: code committed @ 3f3930f before any data: `rmodel.py` (rules ported from modelRisk.ts / modelRiskScan.ts),
  `sim_r.py` (seat sequencing, fills, exits, R1/R2), `synth_r.py`, `tests_lookahead_r.py`, `analyze_r.py`, `probe_r.py`,
  `term.py` (terminal gate: refuses before 16:05 ET; disk and 700 MB guards). Offline smoke test on cached EDGE data only
  (no outcome table looked at; one SPXW ticket priced from an EDGE-T cache file to check the plumbing).

- 16:05 ET: probes (`probe_r.py`, 9 requests, one at a time), on 2024-04-17, 2023-10-27, 2022-03-08:
  (a) SPY 0DTE 1-minute NBBO 08:00-09:29: 720 rows a day, **0 with bid > 0 and ask > 0** (2022-03-08: no data). The
  terminal's history holds no pre-open option quotes, so under PREREG 7 pre-open decisions get no contract
  (`EDGE_R_PREOPEN=0`); the live 09:24:39 fill on a pre-open quote cannot be reproduced on history, and R0's pre-open
  clause is empty in the backtest (R0 and R2 differ only by the stop, plus the 09:30:00 decision on the 09:29 bar, which
  also has no contract because the 09:30 board is empty, EDGE-T A1). (b) SPX index bars: close > 0 on 570-962
  (09:30-16:02; 3-4 post-close prints a day), nothing before 09:30. Used as returned (SPX month bars fetched 00:00-23:59).
  (c) SPY stock bars 04:00-19:59 (950-960 bars a day).
- 16:08-16:25 ET: month bars (SPY, QQQ, SPX) 2 processes, 1 request each. Incident: the next-session month 2025-01
  (for 2024-12-31) was requested for QQQ by the first rule (skip only wholly locked months); its locked days were
  dropped before writing, the file (1 day) was deleted unread, and the rule now refuses any month that holds a LOCKED
  day. Nothing from 2025-01 was looked at.
- 16:20 ET: `fetch_month_bars` extended to SPX index bars 00:00-23:59 (PREREG 2) and to refuse any month holding a
  LOCKED day (the incident above). Uncommitted edits made before any data (15:14-15:15 ET, after 3f3930f): `sim_r._bid_from`
  returns the last quote when the sale second falls past the priced window's end (a stop in the last 2 s before the
  contract's close); `synth_r` gained a no-cost calibration switch (`EDGE_R_SYN_NOCOST=1`). No rule changed.
- 16:24 ET: two simulation workers (`sim_r.py run 0 2`, `run 1 2`; 1 request in flight each). 16:28 ET: a 10-session
  pipeline check of `analyze_r.py` wrote an interim results/DEV.md (overwritten by the full run); no code that decides
  a signal, contract, fill or exit was edited after it (file times: rmodel 16:20, sim_r 15:15, synth_r 15:14 ET).
- 16:49 ET: look-ahead test on the 60 sessions then cached: 673/673 identical on all three checks; forming-bar canary
  caught 636/673; the 60-s peek canary reached only 14 windows (caught 14/14), so an 8-s peek canary was added
  (inside every priced window; test-only change).
- ~16:58 ET: a container restart killed both workers after 102 sessions (all 102 JSONs, 2,822 q1s files and 411
  parquets re-read cleanly at resume; logs show 0 quote misses). 91 MB used.
- 17:05 ET (resume, new run): committed the above as found (the stray `edge/__pycache__` .pyc change restored, not
  committed). `sim_r.run` now refuses to write a session in which any terminal request failed (a failed board or quote
  fetch would otherwise be stored as "no contract" / "no quotes"); it waits 60 s and re-runs that session (6 tries),
  and writes each session JSON atomically. Terminal answered (one 2-minute SPY bar request, 0.7 s); workers restarted
  17:07 ET (PIDs 1069, 1070), 1 request in flight each.

## Live record 2026-11-05 (motivation; execution artefacts only, not a test)
Book R closed 29 tickets on 23 names (−$1,691 at 15:12 ET). 16 of 29 were held ≤ 5 s (−$259): the live scan reads bars
for 4 of 458 names per pass, so a name's closes can be ~2 minutes old; the entry fires on a stale break, the next pass
refreshes that name first (open tickets are prioritised), the exit rule is already met, and the ticket is a spread round
trip. 5 tickets held ≥ 10 min lost −$1,449 (SPX 7500C −$920, SPY 766C −$255 pre-open, RUTW −$260). The 3-root backtest
cannot reproduce the stale-bar round trips (its bars are current); it measures the rule itself.
