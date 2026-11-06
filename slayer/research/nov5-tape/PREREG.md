# NOV5 pre-registration: the "Thursday signs" of 2026-11-05, tested out of sample with no re-tuning

Worker NOV5. Written and committed BEFORE any other day's data was looked at: no 2026-11-04 feature, trigger or option
price and no DEV/VALIDATION trigger or outcome has been read. (Nov 4's 1-minute files and the DEV point-in-time books are
being fetched/built in the background by code that computes no rule and no outcome; nothing from them is opened until
this file is committed.) Protocol: `/tmp/qa/V2_PROTOCOL.md`, including anti-bias controls 10-14. Long calls and puts
only, 1 contract, buy to open / sell to close.

## Why these rules, and the honest framing
Perfect-hindsight entries always win (see `results/CEILING_20261105.md`). The rules below are what the 2026-11-05 tape
(`results/TIMELINE_20261105.md`) suggests was observable BEFORE its turns, written as exact definitions. They were shaped
on 2026-11-05 itself (in-sample), so 2026-11-05 results prove nothing; the question is only whether they work on other
days. On 2026-11-05: dealers were short gamma from the open (SPX 7678 < rebuilt flip ~7700, all day); the large-gamma
strikes 7500 / 7400 / 7350 acted first as accelerators when broken (7500 at 10:37) and then as the floors of the lows
(10:53 low 7394 pierced 7400 and closed back above it; 14:06 low 7363 over 7350; close 7350.35 at 7350).

## Splits and the two study days
- DEV = sessions before 2025-01-01 (`compass-v2/data/splits.py` says `DEV`; EDGE's DEV list, SPXW same-day expiry cached,
  prior session not LOCKED). Every read asserts `split_of(day) == 'DEV'`.
- VALIDATION 2025 only for a variant that passes DEV by the bar below; scored once.
- LOCKED (H1, H2, every session on/after 2026-07-01) is NEVER opened, with exactly two declared exceptions:
  **2026-11-05** (in-sample: the day the rules come from) and **2026-11-04** (the first out-of-sample day, the failed-rally
  day). Both are the owner's live days and the subject of this study, inside LOCKED's calendar range; they are named here
  so no other LOCKED day can be added later. Nothing in this study is ever scored on any other LOCKED session.

## Point-in-time inputs at a decision minute t (seconds of the ET day, t = m*60)
- SPX 1-minute bars with start <= t - 60; S_t = close of the last closed bar.
- 0DTE board stamped (t - 60)//60; IV_atm = mean of the call and put IV at the strike nearest the price at that stamp,
  solved at the mid on the trading clock (EDGE `sim.implied_vol`, T = minutes to 16:00 / (390*252)).
- EM_h = S_t * IV_atm * sqrt(h / (390*252)) (h in minutes).
- Gamma book read at t, EDGE-G's audited definitions (`edgeg/book.py`, `gex.py` = byte copies of EDGE-G @ 2ca62d0; the
  study days use `book_nov.py`, the same construction on the fetched files): OI of the morning report (SPXW all expiries
  <= 31 days + SPX AM monthlies, strikes within 12%), 0DTE vols from the board, other expiries from the prior EOD IVs;
  dealers long calls / short puts. `net` = the house-sign net dollar gamma at S_t (> 0 = **dealers short gamma**).
  `wall_dn(t)` / `wall_up(t)` = the strike with the largest |net dealer gamma| below / above S_t within 10%
  (`walls_at`), re-priced at S_t. Reads every minute 09:59-14:30.

## Rules (exact; `rules.py`)
- **N1 SHORT-GAMMA DRIVE.** At 10:00 only: if dealers are short gamma (net > 0) and |ln(S_t / open)| >= 2.0 x EM_30 / S_t
  (the move since the open is at least twice what the 0DTE prices for 30 minutes), buy the trend side (put if down,
  call if up). Mechanism: dealers short gamma hedge with the move, so an opening drive that is already large keeps
  going. Target (for XW) = wall_dn(t) for a put, wall_up(t) for a call. One per session.
- **N2 WALL BREAK.** Every minute 10:00-14:30: dealers short gamma at t, and S_t <= wall_dn(t-60) - 0.10 EM_1h with
  S_t < S_{t-30} -> put; or S_t >= wall_up(t-60) + 0.10 EM_1h with S_t > S_{t-30} -> call. Mechanism: the wall is where
  dealer hedging concentrates; once through it while short gamma, hedging flow adds to the move until the next wall.
  Target = the next wall in the trade's direction at t. After an event the rule sleeps 60 minutes.
- **N3 WALL REJECTION (bottom / top tick).** Every minute 10:00-14:30: |ln(S_t / S_{t-30})| >= 1.5 x EM_30 / S_t, and the
  last closed bar pierced the previous read's wall in the move's direction and closed back on the near side (after a
  fall: bar low <= wall_dn(t-60) < bar close; after a rise: bar high >= wall_up(t-60) > bar close) -> buy the reversal
  (call after a fall, put after a rise). No gamma condition. Mechanism: a large-gamma strike absorbs an extended move
  (dealers long gamma there, or the strike's sellers defend it); a pierce that fails marks exhaustion. After an event
  the rule sleeps 60 minutes.

## Contract cells (`devsim.pick_on_board`, EDGE-G's registered pick)
Board stamped (t-60)//60; same side; bid > 0, ask > bid; spread <= 8% of mid; ask <= 0.6 * S * IV_atm * sqrt(T);
|delta| nearest the target within +-0.08. **D30** = 0DTE delta 0.30. **D15** = 0DTE delta 0.15 (the protocol's lower
edge; the closest a protocol contract gets to the far-OTM puts that made Thursday's multiples). No pick -> no trade.

## Execution (protocol rule 2; `devsim.py` = EDGE-G sim_g conventions)
Entry = ask of the first 1-second quote >= t + 2 s with bid > 0, ask > bid, ask size >= 1, within 60 s. Exits decided on
1-second quotes; stops/trails only on a sane quote (bid > 0, spread <= 25% of mid); an exit decided at second s fills at
the bid of the first 1-second quote >= s + 2. Flat decision 15:50:00. $0.65/contract/side; ret_net =
(100(exit - ask) - 1.30) / (100 ask + 0.65). (2026-11-05 has no 1-second store yet: its in-sample numbers use the
1-minute board held for the minute and are labelled so; 2026-11-04 and DEV use 1-second NBBO.)

## Exits (fixed; part of the hypothesis)
- **XB** (EDGE-G X-B verbatim): vol trail, exit when bid <= peak - D, D = clamp(1.5 |delta| S RV_so_far sqrt(15/(390*252)),
  0.15 fill, 0.50 fill); time stop 90 min.
- **XE** (the option's own EMA): at each minute close after the fill, EMA9 and EMA21 of the option's 1-minute mid
  (seeded with the 30 minutes before the decision); exit at the first minute close where EMA9 < EMA21 after having been
  >= EMA21 at an earlier minute close since the fill. Vol stop as EDGE-G X-A (bid <= fill - clamp(1.0 |delta| S IV_atm
  sqrt(30/(390*252)), 0.20 fill, 0.50 fill)); time stop 90 min.
- **XW** (N1, N2 only; target wall): exit at the close of the first bar after the entry whose extreme reaches the target
  (low <= target + 0.10 EM_1h for puts, high >= target - 0.10 EM_1h for calls); X-A vol stop; time stop 90 min.

## Variants (trials) = 16
N1 x {XB, XE, XW} x {D30, D15} = 6; N2 x {XB, XE, XW} x {D30, D15} = 6; N3 x {XB, XE} x {D30, D15} = 4. Every one is
logged in `research-v2-ledger.md` under NOV5, pass or fail. Family notes (counted as new trials anyway): N1 re-tries the
dead opening-drive (EDGE-T H1) and gamma-break (EDGE E3) families; N2 re-tries E3 / EDGE-G R2 (wall room); N3 re-tries the
reversal (E2) and pin (E6) families.

## "Thursday signs" NOT turned into tests (0 trials), and why
- Headlines (Hormuz tankers 09:09-09:23 ET, "Nasdaq -3%" 09:48, "risk of renewed war eased" 11:29): UW headline history
  starts 2026-08-06 (all LOCKED) and the recorder started 2026-11-05 -> no DEV, no Nov 4.
- Compass p1 side (calls topped the board 13:40-14:40 near the 14:06 low): engine rows exist only from 2026-10-29; no
  Nov 4 rows file -> untestable.
- VIX / ATM-IV spike and put/call volume at the turns: contemporaneous with the move (they ARE the move), described in
  the timeline, not registered.
- Realised > implied (RV/IV > 1 from 10:00): already registered by EDGE-G (R3); not duplicated here.

## Nulls (anti-bias 11) and statistics
- **Side shuffle**: for every DEV trigger of the D30 cell (and D15 where paths allow) the opposite-side contract is picked
  and simulated with the same exit; 2,000 coin-flip assignments of side per trigger; the real variant's percentile.
- **Synthetic zero drift**: 100 runs per variant. Per DEV session the SPX path is re-simulated from the real open, zero
  drift, 1-minute steps at the real day's 5-minute RMS profile of 1-minute log returns; the book's net and walls are
  re-priced at the synthetic S from the real 10:30 legs; IV_atm = the real day's per-minute ATM IV; triggers recomputed;
  options priced Black-Scholes at the real ATM IV on the trading clock, bid/ask = model mid -+ the cell's real median
  entry half-spread, held per minute; same exits. FDR = share of runs whose CI excludes 0 (must be <= 5%); the real
  result's percentile.
- Per variant: n, skips, win rate (net > 0), average win, average loss, expectancy net and gross with a session-clustered
  bootstrap 95% CI (4,000), median, $ per $ risked, by year, call vs put. PBO (CSCV, 16 blocks) over the 16 variants'
  per-session means; deflated Sharpe at the ledger's total trial count.
- **PASS DEV** iff n >= 150, net expectancy CI > 0, win >= 55% or expectancy >= +10%, beats >= 95% of the side-shuffle and
  of the synthetic runs, synthetic FDR <= 5%, PBO < 0.3, DSR >= 0.95. Only a passing variant is fetched and scored once on
  VALIDATION 2025; nothing is frozen unless VALIDATION's CI excludes 0.

## The first out-of-sample day (2026-11-04)
The same code (`runner.py study 20261104`) on Nov 4 with Nov 4's own book, 1-second NBBO, every variant reported, no
parameter changed. One day is an anecdote either way; it is reported first because the owner asked for it.

## Data, cuts, resumability
DEV paths: 1-second NBBO per picked contract, window [t - 30 min, min(t + 92 min, 15:52)], reusing every worker's cache
(edge, edge-t, edge-r, edge-k, edge-g, edge-l, edge-m) and writing new ones to v2data/nov5-tape/q1s_dev (atomic). One
terminal request in flight; 1 s pause between requests 09:15-16:05 ET (the live engine shares the terminal). Sessions in
one seeded order (seed 20261106); a cut is on time or disk (stop below 3 GB free, budget 1 GB under v2data/nov5-tape),
never on outcome, and is reported. DEV sessions whose EDGE-G inputs (prior EOD IVs, SPX AM OI) are not built are skipped
and counted.
