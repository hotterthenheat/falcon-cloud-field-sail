# EDGE0DTE: protocol (fixed before any outcome is computed)

Owner's brief (2026-11-07): find out whether a statistically significant, economically viable and repeatable 0DTE edge
exists. Do not validate or rescue earlier work, do not optimise for P&L, report every failure. If nothing passes, say
"no validated edge was found".

This study is independent of the earlier families (EDGE-B..V, EMA-MTF, NOV5, NOV5-BROAD). It reuses only their raw-data
caches and loaders, never their conclusions. Their ~1,305 ledger trials still count toward the deflated Sharpe.

## 1. Universe and splits (chronological, never changed)

| split | sessions | use |
|---|---|---|
| DISCOVERY | every session with a same-day expiry for the root, 2020-02-18 .. 2023-12-31 | Stage 1 search; Stage 2 rule construction |
| CALIBRATION | 2024-01-01 .. 2024-12-31 | one confirmation look per Stage-1 survivor; Stage-2 exit fit; walk-forward step |
| HOLDOUT | 2025-01-01 .. 2025-12-31 | ONE look per frozen Stage-2 spec, scored blind by a separate worker |
| LOCKED | 2026 (all) | never opened in this study; reserved for the live forward shadow |

* Roots: SPXW (primary), SPY, QQQ, IWM (replication). Same calendar days across roots are NOT independent: all inference
  clusters by trading day, never by root-day.
* Disclosure: 2025 has had exactly one earlier look (EDGE-D, event days of single names and earnings straddles). No
  intraday index result for 2025 has been computed. 2026 Nov 4-6 were live study days; LOCKED is untouched.
* Holdout forward outcomes (Z, V below) are NOT computed until a spec is frozen. Library code refuses to build them
  unless `EDGE0DTE_HOLDOUT=<frozen spec sha256>` is set and the look is appended to the ledger first.

## 2. Data labels (every column in every table carries one)

| label | meaning | examples |
|---|---|---|
| OBS | observed historical record | 1-minute index/ETF bars, option NBBO board (1-min), 1-second option NBBO, option trades with their NBBO, prior-day OI, ETF volume |
| CALC | deterministic calculation on observed data only | VWAP, EMAs, realized variance, IV inverted from the observed mid, trade aggressor side (trade price vs its NBBO) |
| MODEL | needs an assumption that is not observed | dealer sign of open interest, GEX / vanna / charm (BS greeks x OI x assumed dealer side), estimated hedge demand |
| INTERP | filled between observations | none allowed in signals; a missing minute is missing |
| N/A | not available | ES futures (SPX index / SPY used instead, labelled); intraday OI; true dealer inventory; trade-level customer identity |

Option prices used for P&L are always observed executable quotes. A modelled price is never a fill. A trade with no
valid quote at its fill second is SKIPPED and counted as a skip.

## 3. Leakage rules

* A signal at decision time t uses only data stamped <= t. A 1-minute bar labelled m closes at m+60 s: it is usable at
  t >= m+60 s.
* OI used on day D is the OI published for D (the prior close's settlement); never D+1.
* Contract selection uses only the board at the decision time (strike, delta from the observed mid at t, spread, size).
* Expiry = the session's own same-day expiry. Sessions without one are excluded for that root (not filled with 1DTE).
* Fills: buy at the ask, sell at the bid, of the first 1-second NBBO at or after t + 2 s; quotes flagged stale/crossed/
  zero are skipped forward; no mid fills. Fee $0.65 per contract per side per leg; sensitivity at $1.30 and +1 tick.
* Survivorship: index products only; the session calendar is the exchange calendar, not "days we have data". Missing
  data days are listed with the reason.

## 4. Two stages

### Stage 1: does the variable carry information? (underlying + option-implied outcomes, no option P&L)

Decision grid: every 5 minutes from 09:45 to 15:30 ET, plus event times for event features (the first minute after
the event bar closes). Outcomes at decision time t, horizon h in {15, 30, 60 min, close}:

* **Z(t,h)** = ln(S(t+h)/S(t)) / (IV_atm(t) * sqrt(h_years)). Drift in units of the move the 0DTE board implied at t
  (IV_atm = CALC from the observed ATM mids). |E[Z]| is the directional information a long option can monetise.
* **V(t,h)** = RV(t, t+h) / (IV_atm(t)^2 * h_years), RV from 1-minute log returns (CALC). V > 1: realized beat implied
  (long gamma wins gross); V < 1: the variance premium (short gamma wins gross).

Statistics for each registered test:
* sign-aligned conditional mean of Z (or mean of log V) vs the unconditional mean at the same times of day;
* day-clustered bootstrap (2,000 resamples of days) 95% CI; continuous features also Spearman IC with a day-clustered CI;
* "incremental" tests: OLS of Z on the feature plus controls (prior 30-min Z, prior RV ratio, time-of-day bucket, ETF
  volume ratio) with day-clustered standard errors;
* Benjamini-Hochberg FDR at q = 0.10 across ALL Stage-1 tests of the registry (primary root SPXW); replication roots are
  reported, not counted.

Stage-1 pass (DISCOVERY) requires all of:
1. FDR-significant at q = 0.10;
2. same sign in at least 2 of the discovery years with n >= 30 sessions (2020-21 pooled, 2022, 2023);
3. economic size: the effect clears the **hurdle** (section 5) at its horizon;
4. same sign on at least 2 of the 3 replication roots.
Survivors get ONE CALIBRATION look of the identical test. Sign flip or CI including the wrong sign of half the
discovery effect -> fail.

### Stage 2: is it executable? (option P&L with observed quotes)

Only Stage-1 survivors that pass CALIBRATION. Each gets a pre-registered expression chosen BEFORE its P&L is seen:
long 0.30-delta single option (direction), ATM straddle (V > 1), or a defined-risk short iron fly (V < 1), with a
fixed time stop at the Stage-1 horizon. The exit grid (time stop only / vol-scaled target and stop) is fit on
DISCOVERY+CALIBRATION by walk-forward (fit on years <= y, score y+1), then frozen with its sha256 in
`v2data/locked_looks.jsonl` and scored once on HOLDOUT by a blind scorer.

## 5. The hurdle (computed first, in FOUNDATION, on DISCOVERY only)

For each root, time-of-day bucket and horizon, measure the executable round-trip cost of the 0.30-delta option and the
ATM straddle (ask-in / bid-out spread + fees, as % of premium), and regress observed executable option returns on
realized Z and V. The hurdle is the |E[Z]| (direction) or E[V] - 1 (volatility) that makes expected net P&L zero. A
Stage-1 effect smaller than its hurdle cannot be an option edge, however significant it is.

## 6. Baselines (same sessions, same times, same contract rule, same costs)

no-trade (0); random side (1,000 shuffles); unconditional long call; unconditional long put; ATM straddle;
underlying buy-and-hold over the same window (SPY/IWM/QQQ shares, SPX as index return, labelled); simple EMA 9/21
crossover on 5-minute bars; 30-minute opening-range breakout. A candidate must beat the random side AND the best
simpler baseline by a margin whose day-clustered 95% CI excludes 0.

## 7. Acceptance (all required; any miss = no validated edge)

1. Stage 1 pass in DISCOVERY and CALIBRATION (section 4).
2. HOLDOUT (one look): net expectancy > 0 with day-clustered bootstrap 95% CI lower bound > 0, n >= 100 trades on
   >= 60 sessions.
3. Beats random side and the best simpler baseline on HOLDOUT (CI-separated).
4. Deflated Sharpe >= 0.95 at the full trial count (ledger total + this study's Stage-2 variants); PBO < 0.30.
5. Parameter neighbourhood: each parameter +/- one grid step keeps the sign of HOLDOUT expectancy.
6. Survives $1.30 fees and +1 tick slippage each side.
7. Not carried by one year, one regime or one time-of-day bucket (removing the best one keeps the sign).
8. Red-team review finds no leakage, fill or data error.
Passing all eight earns a 15-session live shadow on LOCKED-period live data; nothing ships before it.

## 8. Reporting (every experiment, failures included, same detail)

hypothesis and mechanism; data period and labels; sessions; trades; win rate; average winner; average loser; net
expectancy (% of premium and $ per lot); profit factor; Sharpe (per trade and daily); maximum drawdown; total return
($1,000 premium per trade, $25,000 starting equity); transaction costs paid; out-of-sample result; significance
(p, FDR q, DSR); by year; by regime (GEX sign, VIX tercile, trend/flat day defined ex ante by the open); by time of
day; parameter sensitivity grid; execution assumptions. Stage-1 tables report n, effect, CI, p, q, IC.

## 9. Registry and ledger

Every test (Stage 1 rows, Stage 2 variants, baseline runs, holdout looks) is appended to
`research-v2-ledger.md` with family `EDGE0DTE`. REGISTRY.md is committed before any outcome exists; its commit hash is
the pre-registration. Adding a hypothesis later is allowed only as a new, dated registry entry, never by editing one,
and never after a CALIBRATION or HOLDOUT look at a related test.
