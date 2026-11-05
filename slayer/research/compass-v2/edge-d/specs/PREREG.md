# EDGE-D pre-registration — SCHEDULED-EVENT VARIANCE (written before any DEV outcome)

Protocol: /tmp/qa/V2_PROTOCOL.md. Splits: DEV < 2025 (ex H1/H2), VALIDATION 2025 (ex Jan–Mar H2). Locked test never read.
Data: ThetaData terminal only (`edge-d/fetch_events.py`): SPXW first expiration >= D, 1-minute whole-chain snapshot
T-10m..T+7m (selection; every decision uses rows stamped <= decision time, asserted), 1-second NBBO of the traded legs
T-10m..flat. Never the challenger replay. Calendar: `specs/calendar.csv` (BLS CPI/Employment Situation archives
2018–2025, Fed FOMC calendars 2021–2025; PPI/retail sales NOT included for time — noted as a gap).
Execution (foundation `sim/engine.py`): decision at t -> order arrives t+2 s -> buy at ask / sell at bid in force, size
capped at displayed, $0.65/contract/side, spread <= 8% of mid at entry (straddle legs each <= 8%), |delta| 0.15–0.50
for directional legs. Underlying for vol-scaled exits = parity forward F = K + C_mid − P_mid of the ATM pair (SPX
index prints nothing pre-open), fed to the engine as the SPX series (1 s). Deltas: Black–Scholes on F with each
contract's own implied vol per minute (greeks rows stamped at the minute, visible from the stamp).

## Mechanisms
Event-variance (D1): before a scheduled 08:30 release the 0DTE/1DTE SPXW ATM straddle carries an implied move. Option
market makers are short gamma into a known jump and demand a premium (literature: event-day straddles lose on average
for single names). The sign is NOT known from theory for index macro releases in the GTH session where liquidity is
thin, so BOTH signs are registered: D1+ realized > implied (long straddle pays), D1- realized < implied (long straddle
loses -> "avoid"; not tradeable long-premium). Expected sign from theory: D1- (variance risk premium).
Post-event drift (D2): the first 5 minutes after the print set the direction; dealers hedging the 0DTE gamma they are
short and slow macro repricing push the underlying further in the same direction into the open and the first hour.
Registered both signs: D2+ continuation (expected from theory, dealer hedging), D2- reversal (overshoot).
FOMC (D1b/D2b): same two mechanisms at 14:00 with 0DTE SPXW bought 13:55 / drift pick at 14:06, flat 15:55.

## Hypotheses and variants (<= 8 per hypothesis; every one lands in the ledger)
D1 (CPI+NFP, buy ATM straddle at T-5m = 08:25, both legs at ask, 2 s latency; 1 contract each leg):
  D1-X1 exit TimeStop 08:45   D1-X2 exit 09:00   D1-X3 exit 09:20
  D1-X4 AnyOf(VolBracket(k_tp=1.0, k_sl=1.0, horizon 1800 s, rv 600 s), TimeStop 09:20)
  D1-X5 AnyOf(TrailingVol(k=2.0, horizon 300 s, rv 600 s, arm 0.3), TimeStop 09:20)
  Metric: net return per straddle; realized/implied = |F(exit) − F(08:25)| / straddle mid(08:25).
  Pass = protocol bar on DEV AND the same sign on VALIDATION. Expected: D1- (negative).
D1b (FOMC, straddle at 13:55): X1 exit 14:20, X2 exit 14:45, X3 exit 15:30, X4 VolBracket(1,1)+15:30.
D2 (CPI+NFP: side = sign(F(08:35:00) − F(08:29:59)) if |move| >= 0.10%; buy 0.30 |delta| (band 0.25–0.40) same-side
  0DTE at 08:36; flat 10:30):
  D2-E1 AnyOf(VolBracket(1.5, 1.0, horizon 1800, rv 600), TimeStop 10:30)
  D2-E2 AnyOf(VolBracket(2.0, 1.0), TrailingVol(2.0, arm 0.5), TimeStop 10:30)
  D2-E3 AnyOf(TrailingVol(1.5, horizon 300, rv 600, arm 0.3), TimeStop 10:30)
  D2-E4 TimeStop 09:35 only (open repricing)    D2-C1..C3 = E1..E3 with the OPPOSITE side (reversal sign).
  Expected: D2+ (continuation) positive, D2- negative.
D2b (FOMC: side = sign(F(14:05) − F(13:59:59)), pick at 14:06, exits E1..E3, flat 15:55).
D3 (single-name earnings straddles / drift): registered in concept only; run only if time remains (none expected).

## Nulls (every test)
(a) Control mornings: the identical rule on weekday-matched non-event days (`plan.csv` kind=control, same split) —
    the key null: an edge here means time-of-day/structure, not the event.
(b) Shuffled side (D2): same entry times/contract rule/exit, coin-flip side, 100 seeds (eval/nulls.ShuffledSignal).
(c) Synthetic zero-drift sessions at the realized vol with BS prices (eval/nulls.synthetic_session), 20 seeds.
A result counts only if it beats >= 95% of null runs; null pass rate > 5% = broken pipeline.
Freeze (frozen/<ID>.py + commit hash) only a VALIDATION survivor; the blind scorer scores LOCKED once.

## Amendment A1 (2026-11-05, before any 2022+ outcome; only a 2018 smoke run with 1 executable straddle had been seen)
Data finding: SPXW has NO GTH pre-open quotes from 2018-12 to 2021-12 (chain rows all zero; Cboe added SPXW to GTH in
late 2021); 2018 pre-open spreads are 16-45% of mid (unexecutable under rule 4). The testable sample is therefore
2022-01..2024-12 (DEV, ex locked Jun-Sep 2022 and Aug 2024) and 2025-04..12 (VALIDATION). To reach a usable count,
PPI (BLS archive, 08:30) is ADDED to the 08:30 event set with the same rules; retail sales dropped (Census schedule
archive not reachable). Controls: weekday-matched non-event days 2022+ (1 per 2 events). Variants unchanged.

## Amendment A2 (2026-11-05, after the pipeline auditor, before any control day was run)
Control-day rule tightened so controls carry NO 08:30 release: Mon/Tue/Wed/Fri only (Thursdays carry jobless claims,
GDP, Philly Fed), not within +-1 day of any CPI/NFP/PPI/FOMC date, day-of-month outside 13-19 (retail sales, housing
starts, Empire/import prices) and outside 24-31 (durable goods, GDP, personal income/PCE). 57 controls 2022+,
weekday-matched where possible (specs/controls.txt). Drift legs: fetched by Black-Scholes |delta| nearest 0.30 on the
08:36 forward (+-1 strike, both rights) instead of a fixed +-3-strike band, which did not reach 0.25-0.40 on high-IV days.

## Amendment A3 — D3 concrete rule (2026-11-05, registered before any D3 data was fetched)
Long premium only (owner constraint: long calls and puts only; a straddle = two long legs). Calendar: UW
/api/earnings/{ticker}, report_time == 'postmarket' only. Universe (fixed, liquid weeklies): AAPL MSFT AMZN GOOGL META
NVDA TSLA NFLX AMD INTC CRM ADBE ORCL QCOM MU. Events 2022-01..2025-12; DEV = 2022-2024 ex locked (Jun-Sep 2022,
Aug 2024), VALIDATION = 2025 ex Jan-Mar. Contract: the first listed expiration strictly AFTER the report date (1-DTE
when the report is the day before an expiry, else 2-4 DTE; a 1-DTE expiry is not always listed for single names).
Strike: listed strike nearest the stock NBBO mid at 15:55:00 (stock quotes stamped <= 15:55:00; assertion).
Entry: decision 15:55:00, fill both legs at the ask in force at 15:55:02 (1-s NBBO); skip if either leg spread > 8% of
mid or ask size < 1. Fee $0.65/contract/side.
Variants (3): D3-Y1 sell both legs at the bid at 09:35:02 next session; D3-Y2 at 10:00:02; D3-Y3 at 15:55:02.
Expected sign: NEGATIVE (implied earnings move > realized on average; literature). Realized/implied =
|S(next 09:35) - S(15:55)| / straddle mid at 15:55.
Key null: the identical rule on the same name 14 calendar days before the report (non-event control; skipped if that
day is within 3 days of another report). D3b (next-morning drift) is NOT run (time): 0 trials.
