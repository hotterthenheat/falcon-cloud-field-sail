# EDGE-D2 pre-registration: can a big-move day be forecast before (or at) the open, and do the existing trend rules pay on forecast days?

Worker EDGE-D2, 2026-11-06. Written and committed BEFORE any feature, label, forecast or filtered outcome is computed.
What was read before this commit: the protocol, the foundation README, FINAL-REPORT-2026-11-05, EDGE-G (PREREG, LOG,
DEV.md incl. its published by-day-type table, which motivates this study), NOV5 (PREREG, REPORT), and the SCHEMAS of
`v2data/edge-g/trades_real.parquet`, `v2data/nov5-tape/res/dev/*.json`, `edge/chain`, `edge-r/board`, `edge/bars`,
`edge-g/book` (column names and the first rows printed while finding the files; no aggregate, no filter, no day-type
split was computed). Terminal reads before this commit: one format probe (VIX EOD 2024-11-04..08, 2024-09..12) and the
DEV-range SPX / VIX / VIX9D daily EOD fetch (`fetch_d2.py eod`, LOCKED ranges cut out, computes nothing); none of those
rows was looked at beyond the first probe row (format). Protocol: `/tmp/qa/V2_PROTOCOL.md` incl. anti-bias 10-14.

## Why (mechanism)
Every trend rule tested this week (EDGE-T, EDGE-G R1-R3/BASE, NOV5 N1-N3, the EMA baselines) earns only on days with
|SPX open-to-close| > 1.5% and loses on < 0.5% days (EDGE-G R3 0D45: +22.7% a trade, n 54, on big days; -4.6..-11.3% on
small days). That split is ex post. Mechanism for ex-ante predictability: (1) volatility clusters (GARCH; yesterday's
range, 5-20-day RV, VIX level and its jump carry information about today's range); (2) scheduled macro releases and FOMC
concentrate information; (3) when dealers are short gamma at the open their hedging adds to moves (EDGE-G's book);
(4) a 0DTE implied vol BELOW the next expiry's (the inverted 0DTE/1DTE ratio seen on 2026-11-05: 9.5% vs 14.6%) would
mean the same-day option under-prices the day relative to the market's own term view. Counter-mechanism (expected to
dominate the trading half): the option market prices the same information (L1: realised/implied 0.91 on all DEV days,
0.98 in the top forecast bucket), so a forecast that is right about range may still not make long options pay.
Hypotheses from 2026-11-05 (inverted 0DTE/1DTE, short gamma at the first read, pre-bell headlines) are hypotheses only;
2026-11-05 is never a test day. **Headline counts are NOT testable**: UW headlines cannot be paged before 2026-08-06
(all LOCKED) -> 0 trials.

## Splits
DEV only (sessions < 2025-01-01, `data/splits.py`), every read asserts `split_of(day) == 'DEV'`. A DEV day is used only if
none of its feature lookback (21 sessions before it, and the calendar dates between) is LOCKED (this drops 2022-10 and
the first weeks of 2024-09) and its prior session exists in the fetched EOD. VALIDATION 2025 is touched only for a Part 2
variant that passes DEV by the bar below, once. LOCKED (H1 = 2022-06, 2024-08, 2026-10-05..30; H2 = 2022-07..09,
2025-01..03; everything >= 2026-07-01) is never fetched or opened: the EOD fetch ranges skip them and `edge/bars` month files
that contain LOCKED days (2022-09, 2024-08) are never opened.

## Targets (labels; never inputs)
- Y1 (primary): |C/O - 1| > 1.5%; Y2 (secondary): > 1.0%; Y3: (H - L)/O > 2 x IM_open (IM_open below; board sample only).
- O, H, L, C of SPX: from EDGE's 1-minute SPX bars (09:30 bar open, 15:59 bar close, high/low of the 09:30-15:59 bars) on
  every day those bars are cached (EDGE-G's day-type convention); else the terminal SPX EOD open/high/low/close. Agreement
  of the two on the overlap days is reported (data QA).

## Features (strictly point in time)
Model P - "at the open" daily model (everything known by 09:30:01 ET; the gap needs the first SPX print):
1. lvix = ln VIX close of D-1. 2. dvix = ln(VIX_{D-1} / VIX_{D-2}). 3. vts = VIX9D_{D-1} / VIX_{D-1} (missing -> training median).
4. gap = |ln(O_D / C_{D-1})| x 100 (SPX first print vs prior close; SPY pre-market is not cached -> not used).
5. lrange = ln of the prior day's (H/L - 1). 6. lrv5, 7. lrv20 = ln of the annualised RMS of the last 5 / 20 SPX
close-to-close log returns (D-1 back). 8. cpinfp = 1 if CPI or NFP at 08:30 on D. 9. fomc = 1 if an FOMC statement at
14:00 on D (`macro_calendar.csv`, sources inside `make_calendar.py`; scheduled statement days only, unscheduled 2020
actions excluded). 10-13. dow_mon, dow_tue, dow_wed, dow_thu (Friday the reference). 14. opex = monthly options
expiration (the third Friday, or the Thursday before when that Friday is a holiday).
Model O - "open board" model (09:35 ET; SPXW sessions with a same-day expiry): Model P's 14 plus, from the 0DTE board
stamped 09:34 (EDGE's 1-minute chain, the `(t-60)//60` convention at t = 09:35) and spot S = close of the 09:34 SPX bar:
15. livr = ln(IV0 / IV1): IV0 = mean of the 0DTE call and put IV at the strike nearest S (mid, trading clock, `sim.implied_vol`);
IV1 = the same on the first expiry after D (edge-r's board, stamp 09:34; T on the trading clock incl. the sessions to it);
missing -> training median. 16. lim = ln IM_open, IM_open = (call mid + put mid) at that strike / S (the 0DTE implied move).
17. gshort = 1 if dealers are short gamma at 09:35 (EDGE-G book: `book.load_static` + `read_legs` at t = 09:35, ALL cut,
house-sign net at spot > 0). 18. fdist = min(|S - F| / (S x IV0 x sqrt(1/252)), 3), F = the raw repriced flip at 09:35
(no flip within the grid -> 3). Book missing -> the day is dropped from Model O (counted).
Model F - "first 30 minutes" (separate, disclosed; 10:00 ET): Model O's 18 plus 19. mv30 = |ln(S_10:00 / O)| / (IV0 x
sqrt(30/(390 x 252))) (S_10:00 = close of the 09:59 bar) and 20. rvr30 = RMS of the 1-minute log returns 09:30-09:59 x
sqrt(390 x 252) / IV0. Model F is applied only to trades decided at or after 10:00:00 (all Part 2 rules qualify: N2 from
10:00, EDGE-G marks 11:00 / 12:30 / 14:00).

## Model (fixed)
Logistic regression (scikit-learn, L2, C = 1.0, lbfgs), features standardised on the training window. Anchored
walk-forward by calendar quarter: for each test quarter Q, fit on every sample day before Q's first day, predict Q.
First test quarter: Model P 2020Q1 (training starts 2018-01-02, the first day with the macro calendar and 20-day lookback);
Models O and F 2023Q1 (training = the 2020-02..04 and 2022-01..05 board sessions). Each target (Y1, Y2, Y3) has its own fit.
**Forecast-positive day (pre-registered threshold): p_hat >= 2 x the training window's base rate** of that target.
Baselines (same walk-forward, same threshold rule): B-VIX (logistic on lvix alone), B-IM (on lim alone; board sample),
B-YB ("yesterday was big": score = 1 if |C/O - 1| of D-1 > 1.5%, else 0; forecast-positive = 1).

## Part 1 statistics (out-of-sample predictions only)
AUC (with a 95% CI: day bootstrap by calendar month blocks, 2,000), Brier score and Brier skill vs the training base rate,
a calibration table (deciles of p_hat: mean p_hat vs observed rate), precision / recall / flagged rate at the threshold,
the base rate, all by year. AUC difference model minus each baseline with a paired month-block bootstrap CI. Feature
weight: the standardised coefficients of the last fit and the drop-one-feature change in OOS AUC (diagnostic).
Null (anti-bias 11): shuffled-day labels, 200 permutations of the labels across the sample days, full walk-forward refit;
the real AUC's percentile and the share of null runs whose AUC CI excludes 0.5 (FDR, must be <= 5%).
Skill claim requires: OOS AUC beats >= 95% of the shuffled null AND Brier skill > 0; "beats VIX alone" requires the
paired AUC-difference CI > 0.

## Part 2: the existing rules, switched on only on forecast days (rules, contracts, exits UNCHANGED)
Trades are the already-simulated, registered trades (1-second NBBO, ask in / bid out +2 s, $0.65/side), read from their
caches, not re-simulated: EDGE-G `v2data/edge-g/trades_real.parquet` (sideflip = +1; roots SPY, QQQ, IWM, SPXW; the
variant sets of `edge-g/analyze_g.py`) and NOV5 `v2data/nov5-tape/res/dev/*.json` (sideset real). Rule-cells (15):
EDGE-G R3 (exit X-B) x {0D30, 0D45, 1D45}; EDGE-G BASE-XA x 3 cells; EDGE-G BASE-XB x 3 cells; NOV5 N2 x {XB, XE, XW} x
{D30, D15}. Filters (4), each with its Y1 fit and the threshold above: FP (Model P), FV (B-VIX), FO (Model O),
FF (Model F). Trial count: 15 x 4 = **60 Part 2 variants**, plus 3 models x 3 targets = **9 Part 1 forecast variants**.
A trade is kept iff its session is forecast-positive (the SPX forecast applies to every root that day). The forecast is
always made before the rule's decision time (P 09:30, O 09:35, F 10:00; rules decide >= 10:00).
Comparisons on the SAME pool (the rule's sessions with an OOS forecast from that filter):
(a) all days; (b) Null A random days: 2,000 draws of k sessions uniformly from the pool, k = the number of
forecast-positive sessions in the pool (also reported, not used for the bar: drawn within calendar quarter);
Null B shuffled-label forecasts: the forecast-positive days of the 200 shuffled-label walk-forward refits;
(c) PERFECT DAY FILTER (HINDSIGHT, an upper bound, not a strategy): true Y1 labels (Y2, Y3 also shown).
Per variant: n, sessions, win rate (net > 0), average win, average loss, net expectancy with a session-clustered
bootstrap 95% CI (4,000; `eval.metrics.cluster_ci_mean`), gross, $ per $ risked (sum net P&L / sum cost), by year; the
side-shuffle (EDGE-G opposite-side trades from P3/P4, NOV5 sideset opp) on the kept trades where those paths exist,
reported. PBO (CSCV, 16 blocks) over the 60 variants' per-session means (zero on no-trade sessions); DSR at the ledger's
total trial count.
**PASS DEV** iff n >= 150, net CI lower bound > 0, win >= 55% or expectancy >= +10%, beats >= 95% of Null A AND of
Null B, PBO < 0.3, DSR >= 0.95. Only a passing variant goes to VALIDATION 2025 once (fetch, rules unchanged, the model
refit with all DEV data and frozen); nothing else touches 2025; LOCKED stays closed.

## Expected signs
Part 1: positive skill (AUC well above 0.5), carried by lvix / lrv5 / lrange / lim (vol clustering); livr negative
(inverted 0DTE/1DTE -> bigger day) is the 2026-11-05 hypothesis, expected weak; gshort positive, weak.
Part 2: expectancy on forecast days > all days, but expected to stay below the perfect-filter bound by a wide margin and
likely <= 0 after costs, because the same information is in the option price.

## Data, limits, resumability
Terminal: SPX/VIX/VIX9D EOD only (one request in flight, never 09:15-16:05 ET). Everything else from caches. Own data under
`v2data/edge-d2/` (budget 500 MB; stop below 3 GB free). Every stage writes atomically and is resumable
(`features_d2.py` -> features parquet; `forecast_d2.py` -> OOS predictions; `part2_d2.py` -> tables).
