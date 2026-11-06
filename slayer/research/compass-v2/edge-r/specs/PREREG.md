# EDGE-R pre-registration: Compass "Model Risk" (book R, tail-risk fade) on history

Written and committed before any EDGE-R terminal request and before any outcome was computed. Protocol:
/tmp/qa/V2_PROTOCOL.md (incl. anti-bias controls 10-14). Owner constraint: long calls/puts only (the book is long-only).

## Why
Live record 2026-11-05 (`slayer/.cache/compass/2026-11-05.json`, book 'R'; read before this spec, it is the motivation,
not a test): 29 tickets, 28 closed, 3 winners, -$1,697 on one contract each, on a -3.9% trend-down day. The first one,
SPY 766C (2026-11-06) at 09:24:39 ET, was bought on a pre-open quote and held 30 minutes for -77.5%. Model Risk has never
been tested on history.

## Mechanism (as the code states it, and the counter-mechanism)
Fade: a close outside the high/low of the last 30 minute-closes is an overshoot by liquidity-taking flow; once that flow
is done, liquidity providers lean against it and the price returns to the broken line within 30 minutes. The trade buys
the option that profits from the return (a call after a downside break, a put after an upside break) and sells on the
first close back through the line, or after 30 minutes. Counter-mechanism (intraday momentum, Gao-Han-Li-Zhou; EDGE E1;
EDGE-T H1): range breaks on index products continue more often than they revert, especially on trend days, and a
30-minute 0DTE/1-7 DTE long pays spread + decay. Expected sign: negative or zero net of the round trip; the test exists
because the book is live.

## The rule as coded (slayer/src/data/modelRisk.ts, modelRiskScan.ts @ 0a91686) and my readings
Constants: TAIL_FIRST 30 closes, TAIL_FADE_MIN 30, TAIL_MONEY 1.5%, TAIL_SPREAD 4%, TAIL_ASK_CAP 5 (single names only;
not binding on SPXW/SPY/QQQ), TAIL_QUOTE_MS 1000, TAIL_OPEN_NOW 1, TAIL_SCORE_BAND 5%, chain gate spreadPass (bid > 0.15,
spread <= 8% of mid), R = 0.042, 390-minute session, 252 sessions/year.

1. Universe. Tickers SPXW (bars = SPX index, option root SPXW for both books), SPY, QQQ (stock bars, own roots). No
   single names: no single-name option quotes are cached (v2data/edge-* hold SPXW/SPY/QQQ/IWM only), and the brief says
   not to widen the fetch. When two or more tickers break at the same decision instant they are tried in COMPASS_TICKERS
   order (SPXW = 0, SPY = 2, QQQ = 3); the first that gets a contract takes the single seat. (Live rotates a cursor over
   458 names; see artefacts.)
2. Bars and clock. Minute bar m (stamp = bar start, minute of the New York day) closes at (m+1):00:00; the decision for
   bar m is at t = (m+1):00:00 and sees closes of bars <= m only. SPY/QQQ: stock 1-minute bars 04:00-19:59 (the code asks
   04:00-20:00). SPXW: SPX index bars over 00:00-23:59, closes > 0 only (expected: 09:30-15:59; checked by one probe and
   recorded in LOG.md; whatever the terminal returns with close > 0 is used, as the code would). The day's closes array
   restarts at midnight (roll()).
3. Signal. px = close[m]; range = trailRange(closes, m) = high/low of the last 30 closes strictly before m (any hour,
   same calendar day, missing minutes skipped, < 30 closes = no range). Close > high -> buy the PUT; close < low -> buy
   the CALL; a close on the line is not a break.
4. Seat and keys. One open ticket across all tickers and both books. A ticket key is day|ticker|book|side, once per day.
   Books in order: '0' (only if the root lists an expiry with weekdayDte = 0 that day; holiday-aware weekdayDte from
   shared/marketCalendar.mjs), then '1-7' (nearest listed expiry with weekdayDte in 1..7). The first book whose rank
   returns a pick opens the ticket. If neither picks, the ticker waits 20 s live; here it is re-tried at the next
   minute's decision (my reading: with 1-minute boards a 20-s retry inside the minute cannot be resolved). A new entry
   may open at the same instant as an exit decision (same pass).
5. Contract (rankBook). Board = the expiry's 1-minute NBBO board stamped m+1 (= the NBBO in force at the decision
   instant t; terminal interval semantics verified in validation/interval_semantics.py). Probe = the 12 strikes above
   and below the strike nearest spot (strike_range=12), right = the side; legs kept if spreadPass (bid > 0.15, spread
   <= 8% of mid). strikes = the kept legs' strikes; span = strikeSpan(..., index=true) = 4 strike steps of that list from
   the ATM (nearest, lower on a tie); tailQuoteOk (|K-S|/S <= 1.5%, spread <= 4% of mid); score = gamma/|thetaYear| from
   BS at IV solved at mid (bisection 0.01..8, 60 steps), T = minutesLeft(rankMinute(m), dte)/(390*252), rankMinute =
   max(0, m - 570) (so a book-0 decision on a bar >= 16:00 has T = 0 and no pick); betterRank (higher score unless within
   5%, then the strike nearer spot). spot = px. Freshness (1 s): in 09:30-16:00 (16:15 for non-expiring SPY/QQQ/SPXW)
   index-option NBBO updates many times a second, so the check is treated as passed; outside those hours a leg passes
   only if the pre-open board exists (see 7). Exact cdf is used where the app's carry term uses the 1e-7 normCdf (no
   material difference).
6. Exit. line = range low (call) / range high (put) at entry. Exit bar = exitAt: the first later bar whose close is >=
   line (call) / <= line (put) -> 'back'; else the first close at a bar >= entry bar + 30 -> 'held'. Exit decision at
   (exit bar + 1):00:00. No stop, no clock flat. If the entry-day closes run out (SPX after 15:59) the next session's
   closes are used from its first bar (findExit), so an SPXW ticket opened late can exit at the next session's 09:31.
7. Execution (protocol rule 2, real fills). Buy 1 at the ASK in force at t + 2 s on the 1-second NBBO (ask > 0, ask size
   >= 1; else no fill, key still spent); sell at the BID in force at the exit decision + 2 s (if bid = 0 then, the
   first later second with bid > 0 while the contract trades). Fee $0.65/contract/side, reported net and gross.
   Tradable windows: 09:30:00-16:00:00 for an expiring contract; 09:30:00-16:15:00 for a non-expiring SPY/QQQ/SPXW
   contract. Outside them an order waits: an order decided before 09:30 fills at the quote in force at 09:30:02 (a
   resting market order fills at the open; the live paper fill at the pre-open quote is reported as an artefact); an
   exit decided after the contract's close is: (a) an expired 0DTE -> held to expiry, valued at intrinsic on the
   underlying's 15:59 bar close (no exit fee if worthless); (b) a 1-7 contract -> sold at the bid in force at 09:30:02 of
   the next session (if that session is LOCKED, it is not read: the trade is closed at the last tradable bid of the entry
   day and flagged). Pre-open selection: one probe (LOG.md) checks whether the terminal holds option NBBO before 09:30
   for SPY/QQQ; if it does, 1-minute boards 09:00-09:29 are fetched for both books and used as in 5; if it does not,
   pre-open decisions get no contract (the live chain would have no fresh leg). Decisions after 16:15 get no contract.
   Sessions are simulated independently (a ticket carried overnight does not block the next session's pre-open scan;
   rare, reported).
8. Live-accounting comparison (an artefact measurement, not a variant): the same R0 tickets priced the way the live
   ledger prices them: entry at the board ask at t (no latency), exit at the bid at the START of the exit bar
   (bidThen asks at_time hh:mm:00.000 of the exit bar, ~60 s before the exit decision).

## Variants (3; one ledger line each)
- R0: the book exactly as above.
- R1: R0 + market-direction filter, fixed now: at the decision instant, with O = open of SPX's 09:30 bar and S = the close
  of SPX's latest bar <= m: no CALL fade (any ticker) if S/O - 1 <= -1.0% AND S < min(SPX closes of the 30 bars before
  S's bar, as many as exist since 09:30, >= 1); no PUT fade if S/O - 1 >= +1.0% AND S > max(same). Inactive before SPX's
  first bar of the day (pre-open). After 15:59, S = the 15:59 close.
- R2: R0 + stop + no pre-open entries. Stop fixed now: from the second after the fill, every second while the contract
  trades, stop when a SANE bid (bid > 0, spread <= 12% of mid, bid and ask size >= 2; EDGE-T's sanity) is <= 0.65 x the
  fill; sell at the bid in force at the stop second + 2 s; the stop replaces the back/held exit if earlier. No entries
  for SPY and QQQ (no overnight options) on a decision before 09:31:00 (i.e. bars < 09:30; the first full regular
  minute is the 09:30 bar). SPXW is not restricted by that clause (GTH root), though it has no pre-open bars anyway.
  The seat sequence is recomputed with the earlier stop exits.

## Data
- DEV sessions: EDGE's DEV set (edge/fetch.want_days('DEV'): 2020-02-18..04-30, 2022-01..05, 2022-10, 2023, 2024 minus
  the locked 2024-08; 656 sessions) minus scheduled early closes (13:00 sessions; the rank clock and tradable windows
  above assume a full day; ~8 sessions). Processed in a seeded random order (seed 20261105, EDGE-T's order); if time
  forces a cut it is on time, not outcome, and is reported.
- Reused, read only: edge/chain (0DTE 1-minute boards 09:30-16:00), edge/bars (SPX RTH bars), edge/exp_*.json
  (expiry lists), edge-t/q1s and edge-m/q1s and v2data/sessions (1-second / 100 ms NBBO where they cover a window).
- New, under v2data/edge-r/ (budget 700 MB; stop fetching if disk free < 1.5 GB): SPY/QQQ 1-minute stock bars
  04:00-20:00 by month; the 1-7 expiry's 1-minute boards 09:30-16:15 (strike_range 14; SPXW 24) per root-session, plus
  pre-open boards if the probe finds pre-open quotes; 1-second NBBO per traded contract from the decision to the exit
  decision + 10 s (and 09:30:00-09:32:00 of the next session where 7(b) applies); the same windows for the opposite-side
  contract (shuffle null). Terminal: no request before 16:05 ET; then at most 2 in flight.
- Splits: DEV only. VALIDATION (2025) opened only if a variant passes the DEV bar below. LOCKED (H1, H2, >= 2026-07-01)
  never opened; the code refuses a locked day.

## Reporting (every variant)
n, win rate (net return > 0), expectancy net and gross with session-clustered 95% bootstrap CI, payoff (mean win /
|mean loss|), $ P&L per contract; by DEV year (2020, 2022, 2023, 2024); by day type on |SPX C/O - 1| (O = 09:30 bar
open, C = 15:59 bar close): < 0.5%, 0.5-1.5%, > 1.5% (outcome-defined, descriptive only); by ticker, book, side, exit
reason, and pre-open vs regular entries. Execution artefacts: pre-open fills, 09:30 opening fills, live-accounting gap,
expiry holds, overnight carries, skipped fills.

## Nulls, overfit control, bar
- Shuffled side (200 draws): the same entry instants and exit decision instants; side by fair coin per trade; the
  opposite side's contract chosen by the same rank on the same board, priced on its own real 1-second NBBO (R2: its own
  stop path). Real-beats rate and null CI-pass rate (FDR).
- Synthetic zero drift (100 runs): per session and ticker, minute closes from a zero-drift martingale at the real bars'
  5-minute RMS-return profile (10-second steps), started at the real first close; the full sequencing rule (signal,
  seat, keys, books, R1 filter on synthetic SPX, exits) re-run on them; option = the ATM strike of the real board
  (a flat smile makes every strike tie inside the 5% band, so the nearer strike wins), priced by BS at the real ATM IV of
  that book's board at the decision minute (else the day's median), entry at mid x (1 + s/2), exit at mid x (1 - s/2)
  with s = the variant's real median entry spread for that ticker/book; R2's stop on the 10-s synthetic bid; same fees
  and tradable windows. Real-beats rate and FDR (must be <= 5%, else the pipeline is reported broken).
- PBO (CSCV, 16 blocks) over R0, R1, R2 per-session mean returns; DSR with the ledger's trial count incl. these 3.
- Look-ahead test with canaries (tests_lookahead_r.py): signals, selections and exits recomputed with every bar, board
  and quote after the decision replaced by noise must be identical; a canary that reads the forming bar (m+1) and one
  that reads the exit bid 60 s ahead must be caught.
- To VALIDATION only if, on DEV: n >= 150, net expectancy CI > 0, beats >= 95% of both nulls. Otherwise nothing is
  fetched for 2025 and nothing is frozen.
