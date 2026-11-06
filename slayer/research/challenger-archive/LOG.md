# Challenger research log

Hypothesis → test → result, in order. Every number below is out-of-sample (walk-forward by session, purged and
embargoed) unless it says otherwise.

## 2026-10-31

**Pipeline.**
- The replay harness (`scripts/compass-replay.ts`) reads the terminal for every mark: ~1,800 requests and ~1 h for one
  session from 07:30. Too slow for history. Built instead: `fetch.ts` (one chain-NBBO request per root, expiry and
  calendar date, 1-minute, the engine's own strike band, every session the root trades; open interest; 1-minute
  bars a month per request), ~70–90 s and ~90 requests a session at two in flight; `localHost.ts` answers the
  engine's own requests from that cache; `build.ts` runs the engine's late path (the replay's loop) over it.
- Parity of the cache-built path with the replay: 2026-10-30, the engine's would-calls from the cache are the
  replay's five Book A calls (GOOGL 280C, AMZN 232.50C, AMD 507.50C, AAPL 345P, GLD 362P). Book C differed (SPXW
  7580C for GLD 355C) because the cache holds minute quotes and the sweep reads 15:20:15; the builder now reads the
  sweep's 15:20:15 board from the terminal (cached). The seat simulation (`common.py simulate`) run on the Hit score
  reproduces the engine's five calls exactly.
- Row cost: ~45–55k Book A/B candidate rows a session (inside the entry minutes, past the spread), ~7 min of CPU a
  session (the engine's own scoring of every board row dominates).

**History reach (checked on the terminal).** SPY options from 2012-06; full SPY 1-minute chain NBBO in 2014; SPXW
in 2016; daily same-day expiries only since 2022 for SPY/QQQ/SPX (M/W/F before, Fridays earlier). The 07:30 options
pre-market is 2026. Tonight's reach is bounded by CPU (the build), not by the terminal.

**First look (2 sessions, in-sample, descriptive only).** 33% of same-day candidates reach +50% before the flat, but
the mean candidate loses as a Book A non-runner (−$35 to −$120 a contract in most time buckets): selection is the
whole game. Movers are cheaper (premium / expected move 0.38 vs 0.72), further out of the money, with higher
realised-to-implied (AUC 0.64) and a gap in their direction (AUC 0.66). Pre-market candidates: 0 of 638 reached +50%
before the 09:20 flat.

**Seat simulation = engine.** `sim_check.py`: the Hit score through `common.simulate` calls exactly the engine's
Book A/B contracts on every built session (12 of 12, then every later check).

**v1 walk-forward (24 sessions built: 23 from 2026-09-15..10-30, one 2020 regime day; blocks of 3 sessions,
embargo 1, at least 10 training sessions; 13-14 held-out sessions, all 2026-10).** Same seats, same exits
(one-minute NBBO), no fees. 95% session-block bootstrap.

| book | calls | hit | $/call | $/session |
|---|---:|---:|---:|---:|
| Hit score + Runner (current A/B) | 65 | 31% | +59 [-214, +340] | +296 [-1072, +1701] |
| Late sweep (Book C) | 46 | 30% | -15 [-43, +19] | -52 [-157, +67] |
| Challenger v1, target = 1.50x before the stop | 65 | 37% | -6 [-444, +446] | -29 [-2220, +2230] |
| Challenger v1, target = return, line on $ EV at the ask | 61 | 20% | -242 [-679, +283] | -1054 [-3043, +1251] |

Result: **no edge shown; the sample cannot separate anything.** The challenger's hit rate is higher (37% vs 31%)
but its P&L is not. Why the intervals are this wide: a call's P&L is in dollars a contract, and the books call
NDXP/SPXW contracts at $30-120 (one NDXP call: +$6,090, another -$4,870): five such calls decide a session. The
return target with a dollar line chose exactly those contracts and lost (-$8,230 worst). The Runner score never
mattered: every current call fired at 09:45-09:50, before Model 2 can be scored (10:30), so no Book A call rode.

**v2: stack the live Hit and Runner scores as inputs** (same protocol, 16 held-out sessions): challenger 70 calls,
27% hit, -$90/call [-347, +143], -$394/session; the Hit score's book +$55/call [-185, +293] on the same sessions.
Paired difference per call -$145 [-446, +149]. No edge.

**Exit hypothesis (one fixed rule, no fitting): Book A always rides the ratchet** (instead of the Runner score's
ride, which never fires before 10:30, i.e. never for these calls). On the Hit score's own 147 calls over 30 built
sessions: +$159/call [-126, +466] against +$82 [-124, +276]; paired difference +$77/call [-56, +261], +$377/session
[-278, +1279]. Riding is worse on 31 of the 43 calls where it differs, better on 12, and two NDXP calls (+$8,500
and +$8,700 more) carry the mean. Suggestive, not shown. To be re-tested on the sessions still to be built (it was
formed after seeing these).

**Throughput.** A 2020 regime session took ~30 min to build: 93% of it in `weekdayDte`, because the cache served the
engine the whole expirations list to 2029 (each weekly mark walked years of weekdays, and the list held expirations
not yet listed then). The host now serves the expirations within a week before to 60 days after the session (the
nearest 1-7 sessions out is unchanged): 140 s a regime session. LightGBM fits stalled for minutes on the shared
machine (OpenMP spin-wait); `OMP_WAIT_POLICY=PASSIVE` and two threads: ~60 s a fold.

**Coverage at 12:55 UTC 2026-10-31:** 307 sessions fetched (2026-09-14..10-30 every Compass root; regime samples
2020-02-18..04-30, 2022-01-03..10-31, 2024-07-15..08-30 for SPY, QQQ, IWM, SPXW), 38 built. A detached supervisor
(`keepgoing.sh`) keeps fetching (newest first, back to 2025-01) and building (newest-first and oldest-first).

**Live path unchanged: the replay proof.** `replay_proof.sh`: `scripts/compass-replay.ts 2026-10-30` (09:30-15:05)
run with the code before the challenger (a git archive of 6657dad) and with this branch, through a caching relay so
both read byte-identical answers (8,970 terminal reads, the second run all from the relay). The same 10 calls
(GOOGL 280C, AMZN 232.50C, AMD 507.50C, AAPL 345P, GLD 362P in Book A at 09:45; IWM 278C, QQQ 686C, SPY 752C,
XSP 755C, SPXW 7580C in Book C), the same scores, runner flags and P&L, and every mark and gate funnel identical.
CHECKS: none.

## LOCKED FINAL HOLDOUT (set 2026-10-31 13:15 UTC, before any of the tests below)

Nothing is fit, calibrated, lined or chosen on these sessions. Each candidate is scored on them once, after its
specification is frozen on the development sessions, and the result is reported with the running count of
hypotheses tried.

- **H-recent:** the 20 most recent sessions, 2026-10-05 .. 2026-10-30 (all Compass roots).
- **H-2022:** June 2022, 2022-06-01 .. 2022-06-30 (SPY, QQQ, IWM, SPXW; the bear market's CPI selloff).
- **H-2024:** August 2024, 2024-08-01 .. 2024-08-30 (SPY, QQQ, IWM, SPXW; the 5 August vol shock).

Honest caveat: H-recent is not virgin. v1, v2 (walk-forward test blocks in 2026-10) and the always-ride observation
(all built sessions) were looked at on part of it before the lock. H-2022 and H-2024 were never built or looked at.
Results are reported for each holdout block separately so the unseen blocks can be read on their own.

Development sessions: every other built session (2026-08/09, 2025 as it lands, 2020-02..04, 2022 except June,
2024-07). Hypothesis count before the lock: 4 (v1 tp, v1 ret, v2 stack, always-ride).

Metrics from here on: per call, the scale-free return (exit ÷ fill − 1) first, dollars a contract beside it; per
session, the sum of the calls' returns (one contract each) and the dollars. Intervals: 95%, whole-session bootstrap.

Next: (a) more sessions (the binding constraint: ~7 min of CPU a session on a shared machine); (b) stack the live
Hit and Runner scores as inputs (the challenger should then do at least what the Hit score does, plus what the
session-relative inputs add); (c) report P&L per call also as return (scale-free) beside dollars; (d) the regime
samples (2020, 2022, 2024) are fetched for SPY/QQQ/IWM/SPXW and build fast.

## Development round 1 (27-31 development sessions: 2026-09-03..10-02 and 2020-02; holdout untouched)

Hypotheses 5-13 (`explore.py`, rules on the Hit score's own candidates, same seats): always-ride exit +5.9%/call
[-9.5, +26.5] vs the current -2.8% [-11.0, +5.3]; gap in the call's direction +4.9% [-7.0, +17.2] (hit 43%);
|delta| 0.30-0.70, premium >= 0.3 expected move, realised/implied >= 0.35, SPY vol shock >= 1, 0DTE only, 1-7 DTE
only: all within a point or two of the current book or worse. Nothing separates on 27 sessions.

Hypotheses 14-15 (`ml.py`, walk-forward inside development, blocks of 4, embargo 1, 14 test sessions, target =
return under the always-ride exit): M1 (all sessions) -7.9%/call [-21.1, +5.9] (hit 14%) vs the current -0.1%
[-10.7, +9.3]; M2 (overnight only) -16.5%/call [-32.6, +3.4]. Both worse: the models learn on 12-26 sessions.

Hypotheses 16-23 (descriptive scan of mean candidate return by sleeve x delta x time x gap, then 8 overnight rules):
the only cells with a positive mean return are **overnight, |delta| 0.15-0.30** (+6 to +18% a candidate under the
books' exits, both sleeves), and inside them **SPXW** (+21% TP / +37% ride) while XSP is flat and RUTW loses
(-47 to -69%). A one-call-a-night rule (overnight, |delta| 0.15-0.30, 2-11.7 h into the session, the side of the
overnight move so far, the strike nearest 0.225 delta): SPXW+XSP +15.1%/call [+1.6, +28.2], 38 calls in 31
sessions, +18.5%/session [+1.8, +36.4]; SPXW alone +24.1% [+4.7, +40.8] on 16 calls. **This is a best cell picked out
of ~100: in-sample, multiple-comparison-inflated.** It goes to the locked holdout once, frozen, as a candidate that
adds overnight calls to the current book (the session the current trees cannot score).

Data: two more builders (oldest first: the regime samples) and a second fetch pass (2025 H2, two in flight).

## Development round 2: the overnight SPX effect, replicated and checked (no new hypothesis; holdout untouched)

**Replication on sessions built after the rule was frozen** (25 development sessions, 2025-12-26 and 2026-08-03 ..
08-31, none of which existed when hypotheses 16-23 were formed): K2b (overnight SPXW rule alone) **+22.4%/call
[+11.8, +33.7]**, 21 calls, 48% hit, +$151/call [+76, +232], +18.8%/session [+9.3, +29.0], +$127/session [+61, +198].
K2 (the live Books A/B plus the overnight SPXW rule, one set of seats) against the live books on the same sessions:
+3.2%/call [-0.0, +6.4], +15.9%/session [-0.1, +32.0], +$19/session [-149, +169]. K1 (always ride): +1.4%/call
[-4.7, +8.7] — not replicated.

**Is it a quote artefact? Checks on the overnight SPXW quotes against XSP (the same index at a tenth):**
- SPXW's overnight NBBO changes minute to minute more often than XSP's (unchanged 9-18% of minutes vs 24-35%); its
  put-call parity forward sits within ±0.3-0.6 bp of 10 x XSP's (p5-p95) with no lead or lag (5-minute changes
  correlate 0.99-1.00 at the same minute, -0.09 to +0.05 one step apart). Not stale.
- At the minute a SPXW candidate's bid first reached 1.50x its fill (400 sampled), that bid was 0.65% under
  10 x XSP's mid (median; p90 0.00%), and XSP's own bid x 10 had also reached 1.50x the SPXW fill in 81% of them
  (1.40x in 98%). Median bid size 7 contracts; 20% were one-lot bids. The moves are in the index, not in a quote.
- At matched moneyness both price the same implied vol (e.g. -1 to -0.5 expected moves out: 14.9% vs 15.1%), but
  XSP's spread is wider (4.3% vs 2.7%) and its premiums are $0.4-0.8 against a $0.01-0.05 tick: XSP's fill sits
  further above the mid, so the same index move reaches 1.50x less often (46% vs 62%) and its average candidate
  loses. SPXW is the cheapest way to own the overnight move; the edge is in the instrument's cost as much as in the
  move.
- By month (development): positive in every month with more than three sessions (2020-03 +41%, 2024-07 +20%,
  2025-12 +16%, 2026-08 +9%, 2026-09 +16% a candidate, |delta| 0.10-0.40); by entry hour strongest after midnight
  (00:00-03:00 +20 to +24%), fading to +6% at 08:00 and ~0 for the evening marks (20:15-23:55). The rule's calls fire
  mostly at 00:05, the first mark where a same-side 15-30 delta SPXW contract passes the gates.
- The ledger's 1-second exits (settle_calls.ts) on the 17 round-1 overnight calls: +26.0%/call against +25.7% on the
  minute path. The exits do not flatter it.

**2022 (bear market) development sessions, first 41 (Feb-Apr, Oct):** K2b +2.0%/call [-18.2, +20.5] on 19 calls
(42% hit): not significant. The Hit score's book had a bad stretch there (-8.6%/call [-16.1, -0.5], -$309/session),
the Late sweep worse (-48.9%/call). K2 against the live books: +0.7%/call [-2.4, +3.6], +$78/session [-167, +306].
The overnight effect is a 2024-2026 (and 2020) effect so far, not every regime's.

## The 60% bar (owner, 2026-10-31): a win = the bid reached 1.50x the ask paid before the stop

On 166 development sessions the average Book A/B candidate wins 14.8% of the time; the Hit score's book about 28-34%.
The overnight SPXW cells (development, descriptive): marks 00:00-03:59 with |delta| 0.10-0.25 win 62-80% (+26 to
+40% a candidate), consistent hour by hour and over 21-112 sessions a cell; the evening marks (20:15-23:59) win
12-35% and lose.

**Overfitting checks (overfit.py; my own implementation of Bailey et al. 2015 CSCV and Bailey & López de Prado
2014):** on the 171 development sessions, 16 blocks, 12,864-12,870 symmetric splits.
- Overnight SPXW family (60 configurations: 6 delta bands x 5 entry windows x 2 sides): **PBO 0.03** (win rate) and
  0.04 (return per call): the in-sample best stays above the out-of-sample median in 97% of splits. Best
  configurations: |delta| 0.10-0.20 win 63-79% on 24-53 calls, +27 to +33% a call. Deflated Sharpe (N = 101
  trials, the trials' Sharpe variance): 0.01-0.41 — **below 0.95: with 24-53 calls a call-level Sharpe of 0.7-1.1
  cannot yet be told from the best of 101 noisy trials.**
- Hit-score filter family (18 configurations): PBO 0.03 / 0.09; every configuration wins 28-34%: none near the bar.

Hypotheses tried so far: 101 (23 individual + 60 + 18 family configurations).

**K4 frozen (before any holdout look), by the a-priori rule "the highest development win rate among the overnight
family's configurations with at least 40 development calls":** SPXW, overnight, |delta| 0.10-0.20, 22:15-07:55
(its calls fire from 00:05), the side against the overnight move so far, strike nearest 0.15 delta, 1.50x
take-profit, flat 09:20. Development: 53 calls, 72% win, +29.6% a call.

## LOCKED HOLDOUT, scored once (2026-10-31 17:10 UTC): 63 sessions (H-2022 21, H-2024 22, H-recent 20)

Every engine call settled with the ledger's 1-second exits first (`resettle.ts --holdout`). Win = the bid reached
1.50x the ask paid before the stop (Book C: a closed gain, it has no stop). Hypotheses tried before this look: 101.

| book | calls | win [95%] | return/call [95%] | $/call [95%] | return/session [95%] | $/session [95%] |
|---|---:|---:|---:|---:|---:|---:|
| Hit score + Runner (current A/B) | 256 | 25% [19, 31] | -5.6% [-10.7, -0.6] | -22 [-124, +85] | -22.8% [-43.0, -2.6] | -87 [-499, +355] |
| Hit score, no ride | 256 | 25% [19, 31] | -5.6% [-10.7, -0.6] | -22 [-124, +85] | -22.8% [-43.0, -2.6] | -87 [-499, +355] |
| Late sweep (Book C) | 96 | 44% [29, 60] | -3.4% [-22.6, +19.3] | +1 [-19, +23] | -5.2% [-35.1, +27.4] | +2 [-28, +34] |
| **K2b** overnight SPXW, 15-30 delta, gap side | 51 | **45% [32, 59]** | **+12.3% [+1.4, +23.0]** | +152 [+46, +261] | +9.9% [+1.2, +18.6] | +123 [+37, +211] |
| K4 overnight SPXW, 10-20 delta, against side | 29 | 38% [21, 56] | +11.2% [-1.3, +23.8] | +66 [-17, +150] | +5.2% [-0.6, +11.0] | +30 [-7, +70] |
| K2 live books + K2b, one set of seats | 259 | 27% [22, 33] | -2.5% [-7.3, +2.4] | +34 [-51, +124] | -10.3% [-29.6, +10.1] | +140 [-210, +517] |
| K1 Hit score, always ride | 256 | 25% [19, 31] | -5.9% [-11.7, +0.0] | -10 [-134, +152] | -23.9% [-47.2, +0.2] | -42 [-545, +631] |

Paired against the live books (same sessions): K2b +17.9%/call [+6.1, +29.8], +32.7% return/session [+12.0, +54.8],
+$211/session [-221, +650]; against the Late sweep +$121/session [+21, +218]. K2 +3.1%/call [-0.2, +6.7], +$228/session
[-18, +501]. By block, K2b: H-2022 64% win (14 calls, +25.6%/call), H-2024 47% (19, +16.9%), **H-recent 28% (18,
-3.0%)**; K4: 62% (8), 55% (11), **0% (10)**.

**Verdict.** The overnight SPXW effect is real out of sample in return (K2b's interval excludes zero, per call and
per session, and it beats all three current books per call) but **no candidate reaches the 60% win bar**: K2b's 45%
[32, 59] is the best, and it failed in the most recent block. The always-ride exit (K1) did not hold up. The
holdout is now spent for these candidates; a new candidate needs fresh sessions (below).

**Next holdout (H2), locked now, not built when locked:** 2022-07-01 .. 2022-09-30 (SPY, QQQ, IWM, SPXW) and 2025-01-02
.. 2025-03-31 (all roots, when fetched). Nothing is tuned on them.

## After the first holdout: the break-even stop is what kept the overnight calls under 60%

In the holdout list of K4/K2b calls, many ended "Stop" at exactly their own price: the bid reached 1.25x (the
break-even move), fell back to the ask paid, and the call closed flat, though the bid went on to 1.50x later that
night (hit50 = 1). The row data hold the path facts to test another exit: hit50, the worst bid before the first
1.50x (worstPre) and the last bid before the flat. With the hard-stop exit (1.50x take-profit or the 0.5322 stop, no
break-even move, flat 09:20), SPXW overnight candidates after midnight at |delta| 0.10-0.20 win 79-97% a candidate
(development, 23-59 sessions a cell), and the evening marks still lose.

- **M5** (hypothesis 102: an ML win-classifier on SPXW overnight rows under the books' exits, walk-forward, blocks
  of 20): no line ever reached 62% on its calibration sessions; no calls. (Killed by the machine's memory later.)
- **Family F2** (hypotheses 103-152: the overnight SPXW rule with the hard-stop exit, 5 delta bands x 5 entry
  windows x 2 sides), on 273 development sessions (the spent first holdout now included): **PBO 0.04** (win rate),
  0.17 (return per call); the best configurations win 79-92% on 19-59 calls at +33 to +42% a call; deflated Sharpe
  (N = 155 trials) 0.65-0.94.
- **K5 frozen** by the a-priori rule "the highest development win rate among F2's configurations with at least 40
  development calls": SPXW, overnight, |delta| 0.10-0.20, 00:00-05:59, the side the overnight move favours, strike
  nearest 0.15 delta, hard-stop exit. Development: 49 calls, 86% win, +38.6% a call; DSR 0.94.
- **The exit checked to the second:** the challenger's hard-stop exit is written in TypeScript
  (`src/data/challengerExit.ts`: the same fill and flat as the books, a fixed stop, the 1-second quotes of every
  minute that crossed the stop or the target) and the shadow settles its hard-exit calls with it. On K5's 49
  development calls (`settle_hard.ts`, the terminal's 1-second quotes): **42 wins (86%), +38.2% a call**, the same
  42 wins as the minute path. The exits do not flatter it.

K5 is scored on the second holdout (H2: 2022-07..09, 2025-01..03) once, when it is built.

**Removed from the branch (coordinator, 2026-10-31):** the v1 machines and their meta (below the bar). The shadow
is off until a machine passes; its display name is "Model 4 · shadow" (the owner's naming: a number, never a score
or a percentage). The golden now proves the "calling shadow changes nothing live" property with a test-only
rules machine (CHALLENGER_TEST_META), so it holds with nothing shipped.

**Descriptive scans on development (not candidates):** under the hard-stop exit the regular session's best cells
(index roots, 0DTE, 40-60 delta, first two hours) win 46-48% and lose 3-5% a candidate: no pocket near 60% there.
Overnight after midnight, SPXW wins 64-97% a candidate below 0.30 delta in both sleeves (weekly 0.20-0.25: 91%);
XSP 50-67% (weekly 0.10-0.20 best); RUTW 11-37% and loses.

**Correction (found 2026-10-31 22:55 UTC): the Late sweep is missing on the regime blocks.** The regime sessions
(2020, 2022, 2024) were fetched before the fetcher kept Book C's 15:20:15 board, and built without the terminal, so
the engine's sweep read no board there: H1's Late sweep row (96 calls) is H-recent only; H-2022 and H-2024 had none.
The candidates' and the Hit score's numbers are unaffected (they are read off the rows). `bookc.ts` sweeps those
days again (the board from the terminal, the engine's own scoreLottery, the ledger's 1-second settlement); H2's 2022
quarter gets the same before it is scored, and H1's Late sweep row is restated with it.

**Disk full (~23:00 UTC).** The machine's disk filled for a few minutes; the fetcher's writes failed (ENOSPC) and
those days were not marked done. `integrity.py --fix`: every raw chain, sweep board, bar month, built row file,
parquet, calls file and 1-second cache parses (0 broken of all); the leftover .tmp files were removed (their days are
fetched again). The relay cache of the replay proof (418 MB, its result is recorded above) was deleted. Research
data: 4.6 GB.

**Pipeline v2.** The terminal was restarted or down several times this afternoon and the builders, which read Book
C's 15:20:15 board and the 1-second exits from it, stalled. Now the fetcher keeps Book C's board with the raw cache,
the builders need no terminal (~70 s a regime session, ~5 min a full one), and the 1-second exits are settled
afterwards (`resettle.ts`). Days built while the terminal did not answer are not written and are built again.
