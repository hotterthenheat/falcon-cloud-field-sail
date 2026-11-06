# NOV6 pre-registration: the 2026-11-05 crash, every root, tested out of sample with no re-tuning

Worker NOV6 (study renamed nov5-broad when the owner moved the study day from Fri 11-06 to Thu 11-05). Written and
committed BEFORE any other day's data was read by this worker: nothing of 2026-11-04, 2026-11-06, DEV (pre-2025) or
VALIDATION (2025) has been fetched, opened or simulated by NOV6. The only other-day information used is what earlier
workers already published (their reports and ledger lines: VRP ~0.91 realized/implied on DEV, the dead families).
Protocol: `/tmp/qa/V2_PROTOCOL.md` (anti-bias controls 10-14). Long calls and puts only (the debit spread and the
straddle are packages of long and short legs, registered as the secondary expression the lead asked for).

## What the rules come from (in sample, 2026-11-05; results/TIMELINE_20261105.md, CEILING_20261105.md)
- The money was in index puts bought at 09:30 (SPXW/SPY/QQQ/IWM 0.5-4% OTM, median best multiple 109-143x), then
  the 10:53 -> 11:35 relief bounce (calls 2-3x on every root and name), then the 11:35 -> 14:06 and 14:53 -> close legs.
  The five most active single names (NVDA, TSLA, AAPL, AMZN, META; 1DTE weekly) moved with the index at the same turns.
- **Cheap 0DTE vol at the open.** At 09:35 the SPXW 0DTE ATM IV (trading clock) was 0.105 against VIX 17.7 (ratio
  0.59) and 0.146 for the next expiry. The day realized ~4.2%.
- **IV spike into the 10:53 low, release before the bounce.** The 0DTE ATM IV went 0.14 -> 0.28 (SPXW), 0.17 -> 0.28
  (SPY), 0.27 -> 0.40 (QQQ), NVDA 1DTE 0.52 -> 0.75 while the market fell 1-2.5% in an hour; it peaked with the low and
  was 10% off its peak minutes later while price held above the low; the bounce followed on every root. (No such spike
  at the 14:06 low or the close.)
- **Vol re-ignition ends the relief.** During the 10:53-11:35 relief the ATM IV fell 25-30%; at 11:34 it turned up
  (+5% off its trough) with price off the relief high, and the 11:35 -> 14:06 leg followed.
- **Crowd flow.** SPY ask-side OTM short-dated put "chase" premium (UW alerts) peaked at the 10:53 low (5.4-5.9 $M per
  15 min against 1.3-1.8 $M of calls); on QQQ the crowd chased calls during the fall. Mixed: registered, with the
  in-sample result negative (see below).
- **Relief headlines before the highs.** "IRAN HAS SENT US A NUCLEAR PROPOSAL VIA QATAR" 14:42 (high 14:53); "risk of
  renewed war with Iran eased" 11:29 and a "de-escalation" headline 11:21 (high 11:35).
- Not turned into rules (0 trials): ATM displayed size fell to ~0.6x its session median AFTER the 10:53 low
  (coincident/lagging); put/call premium flow from tick prints moved with the market; walls/flip (dead family; the
  nov5-tape book is reused only as description).

## Splits and days
- DEV = sessions before 2025-01-01 (EDGE's DEV list, `common.dev_sessions('DEV')`; every read asserts `split_of(day)
  == 'DEV'`), roots SPXW, SPY, QQQ, IWM (EDGE's cached 1-minute first-expiry boards and bars; single names have no DEV
  boards and the 1 GB budget cannot hold them: names are tested on the out-of-sample days only).
- Out-of-sample days, in this order: **Wed 2026-11-04**, then **Fri 2026-11-06** (owner-declared live study days inside
  LOCKED's calendar; named here so no other LOCKED day can be added). Then DEV. VALIDATION 2025 once, only for a
  variant that passes DEV. LOCKED (2026 H1/H2 and every session on/after 2026-07-01 except the three named days) is
  never opened.
- 2026-11-05 is in-sample for every rule (all were shaped on it): its numbers prove nothing and are reported as such.

## Point-in-time inputs at decision minute m (t = 60 m seconds of the ET day)
- Bars: 1-minute bars of the underlying (SPX index for SPXW; the stock's 1-second NBBO mid on the study days, EDGE's
  bars on DEV); S = close of bar m-1; bars with start <= m-1 only.
- Board: the first expiry on/after the day (0DTE for index roots when listed; names: the nearest weekly), the 1-minute
  NBBO stamped j <= m-1. Rows flagged frozen (quality.py: same bid/ask on >= 5 stamps while |delta| x |S move| >
  spread + 2 ticks) are dropped on the study / out-of-sample days.
- sig[j] (ATM IV of stamp j): the strike nearest S_q = close of bar j-1 among strikes quoted on both sides (bid > 0,
  ask > bid); mean of the call and put IV solved at the mid (EDGE solver), T = (960 - j + 390 x)/(390 x 252), x = whole
  sessions to the expiry. A rule at m reads sig up to stamp m-1.
- EM_h(S, sig) = S sig sqrt(h / (390 x 252)).
- Vol index (R3): VIX (SPXW, SPY), VXN (QQQ), RVX (IWM), the 1-minute print stamped 09:35.
- UW flow (R4): alerts available at `created_at` (publication), ticker = the root (SPY/QQQ/IWM on DEV: EDGE-B's cache,
  2023-12-06..2024-12-31, UW filter ask-side, OTM, <= 7 DTE, premium >= $100k). "Chase" alert = premium >= $100k, OTM,
  <= 7 DTE and ask-side premium >= 50% of premium (the same test on the live file and the DEV cache).
- Headlines (R5): UW headlines at `created_at` (recorder files; from 2026-11-05 only).

## Rules (exact; `brules.py`)
Every rule: decisions on whole minutes, one trade per trigger, 60-minute refractory per rule and root.
- **R1 VOL-SPIKE RELEASE -> CALL.** For m in [10:30, 15:00]: s_pk = max sig[m-30..m-1]; s_ref = median of sig[max(571,
  m-90)..m-61] (>= 10 values); S_ref = close of bar max(570, m-91); lo30 = min low of bars m-30..m-1. Trigger when
  s_pk >= 1.25 s_ref AND ln(lo30 / S_ref) <= -2 EM_60(S_ref, s_ref)/S_ref AND sig[m-1] <= 0.90 s_pk AND S >= lo30 +
  0.5 EM_30(S, sig[m-1]). Mechanism: a panic bid for puts lifts IV (dealers short those puts are short vega/gamma and
  hedge by selling); once IV comes off the peak, the puts' deltas shrink and the dealers buy back their hedges (vanna),
  so the relief extends. The IV state, not price alone, marks the exhaustion (price-only reversal E2 / N3 are dead).
- **R2 VOL RE-IGNITION -> PUT (down days).** For m in [10:30, 15:00]: down day: ln(S/open) <= -1.5 EM_390(open,
  median sig[571..575])/open; s_tr = min sig[m-30..m-1]; s_pk = max sig[max(571, m-90)..m-31]; hi30 = max high of bars
  m-30..m-1; lo_prev = min low of bars max(570, m-90)..m-31. Trigger when s_tr <= 0.80 s_pk AND sig[m-1] >= 1.05 s_tr
  AND hi30 - lo_prev >= EM_60(S, sig[m-1]) AND S <= hi30 - 0.5 EM_30(S, sig[m-1]). Mechanism: the relief rally is fuelled
  by the vanna buy-back while IV deflates; when IV turns back up the fuel is gone and the day's sellers resume. Differs
  from the dead pullback/VWAP and trend-day families by conditioning on the IV path.
- **R3 CHEAP OPENING 0DTE VOL -> ATM STRADDLE.** Only on days with a same-day expiry (x = 0). At m = 09:36: rho =
  sig[09:35] / (vol index at 09:35 / 100). Trigger when rho <= 0.60. Buy the call and the put at the strike nearest S
  quoted on both sides. Mechanism: systematic 0DTE premium sellers price the session off recent quiet; the 30-day index
  includes the risk they leave out (overnight variance is ~25% of daily variance, so a fair intraday ratio is ~0.85;
  0.60 is < 70% of that). Differs from EDGE-L L1 (dead: HAR x gamma forecast) by using the option market's own 30-day
  price as the forecast.
- **R4 CHASE-FLOW EXHAUSTION -> AGAINST THE CHASE.** For m in [10:30, 15:00], window W = [t-15 min, t): after a fall
  (ln(S/close of bar m-31) <= -1.5 EM_30/S) with chase put premium P >= 3 x chase call premium and P >= 3 x the mean
  15-minute chase put premium of [09:30, t-15 min) and P >= $500k -> CALL; mirror after a rise -> PUT. Mechanism: late
  retail/fast-money chasing after an extended leg is the last marginal buyer; their premium is overpriced and the leg
  is exhausted. **In-sample it was mostly wrong on 2026-11-05 (4 trades, 25% win, the opposite side +80%)**; it is
  registered because the owner asked for the crowd-flow test, and its mirror (following the flow) is the dead EDGE-B F1.
  Testable on DEV 2023-12-06..2024-12-31 (SPY/QQQ/IWM) only.
- **R5 RELIEF-HEADLINE FADE -> PUT.** A headline whose text matches RELIEF and MACRO (case-insensitive regexes in
  `brules.py`: easing / de-escalation / ceasefire / truce / peace deal-talks-plan-proposal / nuclear proposal / ending
  the war / "risk|threat|fears of ... eased|receded|faded", AND Iran/Israel/Russia/Ukraine/China/tariff/war/Hormuz/
  missile/sanction/Fed/Powell/Trump/White House/oil/OPEC/Gaza/Hezbollah/Houthi/Qatar); decision at m = ceil((publication
  + 600 s)/60), m in [10:00, 15:00], on a down day (as R2). Mechanism: relief headlines in a risk-off tape trigger short
  covering that is spent within minutes while the risk persists. **No DEV is possible** (headline history starts
  2026-08, inside LOCKED; recorder from 2026-11-05): tested on 2026-11-06 only (and on every recorded day after), an
  anecdote by construction.

## Contract and expressions
- **L (long, primary):** EDGE-G's registered pick on the board stamped (t-60)//60: same side, bid > 0, ask > bid,
  spread <= 8% of mid, ask <= 0.6 S sigma_atm sqrt(T), |delta| nearest 0.30 within +-0.08. R3: the ATM call + put.
- **S (debit spread, secondary):** buy the L contract, sell the same-side further-OTM strike whose |delta| is nearest
  half the long leg's (+-0.08), bid > 0, spread <= 25% of mid, on the same board. R3: both sides (long ATM straddle,
  short the ~0.25-delta strangle). Package quote = long bids - short asks (selling value, floored at 0) / long asks -
  short bids, size = the smaller leg; all legs fill at the same second; fees on every leg.
- No pick -> no trade (counted as a skip).

## Execution (protocol rule 2; nov5-tape/devsim.py conventions)
Entry = the package's ask at the first 1-second quote >= t + 2 s with bid > 0, ask > bid, ask size >= 1 (within 60 s).
Exits decided on 1-second quotes; stops/trails only on a sane quote (bid > 0, spread <= 25% of mid); an exit decided at
second s fills at the bid at s + 2. Flat decision 15:50:00. $0.65 per contract per side per leg; ret_net = (100 (exit -
entry) - fees) / (100 entry + entry fees). Stale 1-second stretches (quality.py) are never filled on the study days.

## Exits (fixed)
- **XB** (EDGE-G X-B verbatim): vol trail, exit when bid <= peak - D, D = clamp(1.5 |delta| S RV_so_far sqrt(15 min),
  0.15 fill, 0.50 fill) (package: delta = long minus short |delta|); 90-minute time stop.
- **XR** (mechanism reversal): exit at the first minute m after the entry where the trigger's mechanism undoes itself,
  read from bar m-1 and sig[m-1]: R1 sig >= s_pk or close < lo30; R2 sig <= s_tr or close > hi30. Plus EDGE-G X-A vol
  stop (bid <= fill - clamp(1.0 |delta| S IV_atm sqrt(30 min), 0.20 fill, 0.50 fill)) and a 90-minute time stop.
  (Unlike nov5-tape's XW, no option-EMA exit: that one carried an undocumented EMA-cross exit in devsim's XA_W path.)
- **XP** (R3, package): stop when the package bid <= 0.60 fill; once the bid has reached 1.5 fill, trail at 0.75 of the
  peak bid; flat 15:50.

## Variants (trials) = 14
R1 x {XB, XR} x {L, S} = 4; R2 x {XB, XR} x {L, S} = 4; R3 x XP x {L, S} = 2; R4 x XB x {L, S} = 2; R5 x XB x {L, S}
= 2. Delta 0.30 only (nov5-tape's 0.15 cell was not better on DEV; the debit spread is the cheaper expression). Every one
is logged in `research-v2-ledger.md` under NOV6, pass or fail.

## Statistics, nulls and the bar (anti-bias 11)
- Per variant: n, skips, win rate (net > 0), average win, average loss, net expectancy with a session-clustered
  bootstrap 95% CI (4,000), gross, median, $ per $ risked, by root, by year, by day type (EDGE classify: high_vol RV >=
  25%, trend |o->c| >= 0.6% closing in the outer quarter, else flat), by x (same-day vs later expiry).
- **Side shuffle** (R1, R2, R4): every DEV trigger also run on the opposite side (same pick rule, same exit); 2,000
  coin-flip side assignments; the real variant's percentile.
- **Key null for R3**: the same straddle (L, XP) at 09:36 on a seeded random sample (seed 20261108) of 200 DEV
  same-day-expiry root-sessions with rho > 0.60 (random-day reference); R3-L must beat >= 95% of 2,000 bootstrap
  draws of the reference mean with the same n.
- **Variance-clock synthetic zero-drift null** (all DEV variants, `nullsyn.py`, 40 runs): per DEV root-session, the
  underlying re-simulated from the real open at 10-second steps, log-returns N(-v/2, v) with v(m) = the real day's
  5-minute RMS profile of 1-minute log returns scaled so the post-09:35 total equals sig[09:35]^2 T(09:35); every
  option priced Black-Scholes with the REMAINING generator variance W(t) = sum of v over [t, 16:00) (a variance clock,
  so every synthetic premium is a martingale; checked: the mean 30-minute mid-to-mid return of 0.30-delta options by
  half hour is reported and must be ~0); boards rebuilt from the synthetic prices on the real strike grid; bid/ask =
  mid -+ the root's real median relative half-spread of the cell's entries; the real flow / vol index. Triggers, picks
  and exits recomputed by the same code. FDR = share of runs whose CI excludes 0 with positive mean (must be <= 5%);
  the real result's percentile.
- PBO (CSCV, 16 blocks) over the 12 DEV variants' per-session means; deflated Sharpe at the ledger's total trial count
  (1,305 before NOV6 + 14).
- **PASS DEV** iff n >= 150, net CI > 0, win >= 55% or expectancy >= +10%, beats >= 95% of the side shuffles (R1, R2,
  R4) or the random-day reference (R3) and of the synthetic runs, FDR <= 5%, PBO < 0.3, DSR >= 0.95, positive in >= 2
  of {2020-21, 2022, 2023, 2024}. Only a passing variant is scored once on VALIDATION 2025.

## Data, cuts, resumability
Out-of-sample days: base files, 1-second NBBO of every traded first-expiry contract within the day's range +-3%
(names +-4%), ticks, indices fetched with the same code (`fetch_broad.py`), then `brunner.py day`. DEV paths: 1-second
NBBO per picked contract, window [t-30 min, min(t+92 min, 15:52)] (R3: to 15:52), reusing every worker's cache and
writing new ones to v2data/nov5-broad/q1s_dev. At most 2 terminal requests in flight (one per process). DEV sessions in
one seeded order (seed 20261107); a cut is on time or disk (stop below 2.5 GB free; budget 1 GB under
v2data/nov5-broad), never on outcome, and is reported.
