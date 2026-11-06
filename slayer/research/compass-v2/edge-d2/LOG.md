# EDGE-D2 log: big-move day forecast (2026-11-06)

## 0. Before the pre-registration (all disclosed in PREREG.md)
- Read: protocol, foundation README, FINAL-REPORT-2026-11-05, EDGE-G PREREG/LOG/DEV.md, NOV5 PREREG/REPORT; the schemas of
  the cached trade files and boards (column names, first rows while locating files; no aggregate or filter computed).
- Terminal 07:0x ET (outside the 09:15-16:05 live window, one request in flight): one VIX EOD format probe, then
  `fetch_d2.py eod` (SPX, VIX, VIX9D daily EOD, 30 quarterly requests per symbol, LOCKED ranges cut out by construction and
  checked by `check_ranges`). A first attempt with multi-year ranges stalled in retries and was killed (own PID); quarterly
  chunks then took < 1 min in all. No terminal request after that.
- Pre-registration commit **bc38f68** (PREREG.md, macro_calendar.csv with sources, fetcher, ledger lines: 9 + 60 variants).

## 1. Implementation notes (fixed before any outcome)
- Daily table: 1,737 SPX sessions 2017-09..2024-12 minus LOCKED (session counts per year match the NYSE calendar: 2018 251,
  2019 252, 2020 253, 2021 252, 2023 250). VIX9D history in the terminal starts 2018-06 (vts imputed by training median
  before that, as registered). 1,674 days pass the lookback guard (21 sessions, no gap > 5 days, no LOCKED weekday inside;
  this drops 2022-10 and early 2024-09).
- Labels: 683 days from 1-minute bars, 991 from EOD; on the bar days Y1 from bars and EOD agree on 99.9%, median open
  difference 0.0 bp.
- Board (09:34 stamp): 607 SPXW DEV chain days, 599 with a 0DTE ATM pair, 598 with the EDGE-G book at 09:35 (2 days lack
  EDGE's OI); 558 survive the lookback guard = Model O/F sample (454 of them OOS, 2023Q1..2024Q4).
- Y3 for Model P and the baselines uses the board sample (it needs the open's implied move) with the 2023Q1 schedule (a
  PREREG gap resolved before outcomes).
- Look-ahead test (`tests_lookahead_d2.py`, before any outcome): every bar and board row after 09:34 replaced by noise ->
  12/12 open-feature sets identical; after 09:59 -> 12/12 30-minute features identical; injecting a later bar's value
  into the visible bar is caught 12/12. Daily features use indices i-1 and earlier (gap uses the day's first print).
- Interim code commit 6998ad6 (before any outcome).
- Part 2 side-shuffle: EDGE-G opposite-side trades from res/P3, P4; NOV5 from res/dev_flip (sideset 'flip').
- Shuffled-label null: 200 permutations x 4 models (P, O, F, B-VIX) x 3 targets, full walk-forward refit each.

## 2. Results (full tables: results/PART1.md, results/PART2.md; one ledger line per variant)
- Part 1 (Y1, OOS): P AUC 0.807 [0.728, 0.872], Brier skill +14%, precision 32% / recall 47% at 13% flagged; VIX alone
  0.817 (P - VIX -0.010 [-0.049, +0.022]); yesterday-big 0.604; O 0.743 and F 0.711 on 2023-24 (14 big days), the 0DTE
  implied move alone 0.780. Shuffled-label null: every model beats 100% of 200 runs, null FDR 0.5-4.5%. Y3 (range > 2x
  implied) AUC 0.56-0.59 with negative Brier skill. livr (0DTE/1DTE inversion) weight +0.04; gshort +0.48, no OOS gain.
- On P-flagged days median |o->c| / 0DTE implied move 0.74 vs 0.87 elsewhere (high-low / implied 1.75 vs 1.77).
- Part 2: 0 of 60 pass. Best: R3 0D45 on VIX-only days +12.8% [-11.3, +42.1] n 49; on P days +7.5% [-11.0, +29.9] n 69
  (Null A 93%, Null B 40%). Filters lift the rules ~4-12 pts from all-days (-2..-7%) to ~0, no CI above 0; 2020 and 2023
  positive, 2024 -25..-40%. P-flagged 2023-24 days (11) contain no big day. FO/FF flag 6 sessions (3-6 trades a rule).
  PBO 0.58, DSR <= 0.04 at 1,055 trials. No VALIDATION look; LOCKED untouched.
- Process: two null processes were stopped by the 30-minute background limit and restarted (resumable blocks, seeded by
  run index); one duplicate-block process was killed by its own PID; no result depends on which process wrote a block.

## 3. Disk / terminal
- Own data: v2data/edge-d2 (EOD json, daily/features parquet, board json, preds, nulls) ~6 MB (budget 500 MB). Free disk
  4.2 GB throughout. Terminal: ~91 requests in total, all before 07:15 ET, none during the live window.
