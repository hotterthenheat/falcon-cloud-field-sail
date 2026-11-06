# EMA-MTF Phase 2 pre-registration (frozen before any strategy outcome)

Worker: EMA (Phase 1 lead EMA-1). Definitions: `specs/STRATEGY_SPEC.md` (the spec wins over code). Data feasibility:
`reports/DATA_COVERAGE.md`. Reference results: `reports/BASELINES.md` (no-edge references; nothing here was tuned on
them). Protocol: `/tmp/qa/V2_PROTOCOL.md` (V2 rules 1–14) — this plan adds to it and never relaxes it.

**What Phase 1 saw before freezing this file:** the coverage study (bar counts, no returns), the six baselines on
DEV (§9), and unit/look-ahead tests on synthetic data. No entry model, MTF model, exit or feature in this plan has
been run on real outcomes.

The commit that adds this file is the record. Phase 2 may not edit §1–§8; a change is a new PREREG amendment with a
new ledger line, made before the affected outcome is seen, and counts its new variants.

---

## 1. Mechanism (V2 rule 1)

Stated so it can fail. Long-premium EMA trading on an option's own chart can only earn money if one of these is true:
1. **Delayed price discovery in the option.** The option's quote/prints adjust to underlying moves, flow and
   inventory with a lag, so its own EMA states carry information the underlying chart does not (market-maker quote
   updating, wide spreads on illiquid strikes, inventory-driven skewing after customer flow).
2. **Vol/flow momentum.** Premium trends that the underlying does not show (IV expansion, demand-driven richening —
   e.g. dealers short gamma marking up premium after customer buying) persist over 15–60 minutes.
3. **Dealer hedging feedback.** With dealers short gamma (inferred GEX < 0), hedging amplifies moves, so momentum on
   the option chart continues; with dealers long gamma it mean-reverts.

Against it: the option chart is mostly a leveraged, decaying copy of the underlying chart (STRATEGY_SPEC §4.1); the
spread (measured per root and bucket in BASELINES) and theta are paid on every trade; and EMA rules are widely used, so
any simple edge is likely competed away. Expected sign before testing: **≤ 0 net of costs for most configurations**;
the question is whether any feature has incremental, executable value beyond the underlying and beyond random entry.

## 2. Data and splits (fixed)

| set | sessions | use |
|---|---|---|
| DEV block A | 2024-03-01 .. 2024-05-31 (64 sessions), warm-up from 2023-11-29 | Stage 1, 2, 3 |
| DEV block B | 2022-03-01 .. 2022-05-31 (64 sessions), warm-up from 2021-12 | Stage 1, 2, 3 (the regime check) |
| VALIDATION | **2025-07-01 .. 2025-12-31**, warm-up from 2025-04-01 (2025-Q1 is LOCKED H2, so earlier 2025 sessions cannot be warmed). If the disk budget cannot hold it, the pre-declared fallback is 2025-07-01 .. 2025-09-30 (decided by bytes before any look, logged) | once per frozen candidate |
| LOCKED | H1 ∪ H2 ∪ ≥ 2026-07-01 | never opened by Phase 2; frozen specs go to the blind scorer (V2 rule 12) |

Roots SPY, QQQ, IWM, SPXW; buckets 0, 1–7, 8–30, 31–90, 91–200 DTE; contract rule STRATEGY_SPEC §7 (|delta| 0.40
target in [0.30, 0.50]); execution §6 (2 s latency, ask in / bid out, displayed size, fees $0.65 ETF / $1.15 SPXW).

## 3. Testable configuration universe

From DATA_COVERAGE §4–5 (fixed now): an (series, bucket, timeframe, EMA length) cell is **in scope** if ≥ 80% of the
coverage sample is warm under the primary rule (≥ N bars) on that series; cells at 20–80% are run but reported
"partial coverage" with the eligible share; cells < 20% are **not tested** and listed as untestable in the final
report. MID is the primary series (all stages); TRADE is the replication arm where the density rule holds
(STRATEGY_SPEC §3), reported, never gating. A decision event whose contract is not warm for a feature is excluded
from that feature's test (never back-filled).

## 4. Stage 1 — feature screen (incremental predictive value, DEV only)

### 4.1 Events and outcome
* **Decision events**: every 5-minute bar close 09:45, 09:50, … 15:00 of every DEV eval session; for each root ×
  bucket × right (call, put): the tradable contract per §7 (one per cell; none → no event).
* **Outcome Y_h**: the executable net return of buying that contract at the ask 2 s after the decision close and
  selling at the bid 2 s after the close h minutes later (or the 15:55 flat if earlier), fees included
  (`engine/execution.py` with exit XT_h). **h = 30 primary**; h = 15 and 60 secondary. Y_mid (mid-to-mid) is reported,
  never used for a decision.
* Inference: session-clustered bootstrap (4000 resamples, seed 7, sessions with no event included as clusters), as
  compass-v2 `eval/metrics.py cluster_ci_mean`. p-values one-sided (H1: effect > 0) from the bootstrap distribution.

### 4.2 Option-chart features (MID series of the event's own contract) — family S1A, 40 tests
For each timeframe tf ∈ {1, 5, 15, 30, 60}, eight binary features computed at the decision close:
| feature | definition (STRATEGY_SPEC §8 on the tf table) |
|---|---|
| S  | state +1 (c > E9 > E21) |
| A  | model A reclaim of E9 fired on the last completed tf bar |
| B  | model B cross E9/E21 fired on the last completed tf bar |
| C  | model C alignment-continuation fired |
| D  | model D compression breakout fired |
| H  | model H early momentum transition fired |
| L50 | c > E50 |
| L200 | c > E200 |
**Statistic (incremental over the underlying):** δ = Σ_strata w · [mean Y | feature = 1, stratum − mean Y | feature = 0,
stratum], strata = root × bucket × right × (the underlying's same-tf state −1/0/+1, sign-aligned to the trade:
for puts the underlying's state is negated), w ∝ the number of feature = 1 events in the stratum. This is the
option chart's information **holding the underlying's own EMA state fixed**.
**Pass (each feature):** (i) δ's 95% CI > 0; (ii) Holm-adjusted one-sided p < 0.05 within S1A (40 tests); (iii) δ > 0
in block A and in block B separately (point estimates); (iv) same sign at h = 15 and h = 60; (v) mean Y | feature = 1 >
mean Y over all events (beats the random-entry reference, BL2-like) — reported, and required.

### 4.3 Timeframe incremental information — family S1B, 5 tests
OLS of Y_30 on the five option-chart S states (tf = 1..60) jointly + the five underlying S states + fixed effects
(root × bucket × right, half-hour of day), session-clustered SEs. Test: each option tf coefficient > 0 (Holm over 5).
This is the "five timeframes are not five confirmations" check: an MTF model in Stage 2 may use a timeframe only if
its S1B coefficient is > 0 at the nominal 5% level (one-sided) OR it is the trigger timeframe. The variance inflation
factors and the pairwise correlation of the five states are reported.

### 4.4 Confirmation features — family S1C, 14 tests
Conditional on the base trigger "B on the 5m MID chart fired" (the canonical event; STRATEGY_SPEC §8 B), the
incremental effect of each confirmation (1 vs 0) on Y_30, stratified by root × bucket × right:
VWAP side (trade's side), underlying 5m S = +1, RSI14(5m und) > 50 in trade direction, cumulative RVOL > 1.5, opening-
range break (15-min OR, trade direction) before the event, PDH/PDL break (trade direction), premarket H/L break,
5m BOS in trade direction within the last 3 bars, inferred net GEX < 0, no wall against within 0.3% (inferred),
put/call OI ratio above its 20-session median (observed), ATM IV up over the last 60 min (observed), contract RVOL
> 2 (observed volume), UW ask-side flow in trade direction in the last 15 min (block A only; observed).
Pass: CI > 0, Holm p < 0.05 within S1C (14), point estimate > 0 in each block where the feature exists.

### 4.5 Controls (reported for every S1A feature, not gating)
* **Theta/reprice control**: the same feature computed on the counterfactual premium path P* = Black–Scholes
  reprice of the contract along the underlying's 1-minute closes at the MID-implied vol frozen at each session's
  10:00 (STRATEGY_SPEC §4.1). δ* = incremental effect of the real feature holding the P* feature fixed. A feature
  whose δ vanishes under δ* is reported as "underlying/theta mechanics, not option information".
* **TRADE replication**: the same tests on the TRADE series over the dense subset.
* **Null calibration (V2 rule 11)**: the whole S1A pipeline re-run 200 times with feature values permuted across
  events within (session × root × bucket × right); the share of null runs with any Holm-passing feature (the family
  FWER) must be ≤ 5% for the pipeline to count; the observed δ's percentile in its null distribution is reported.

## 5. Stage 2 — strategy models (DEV, executable simulator)

### 5.1 Stage 2-C: canonical one-factor-at-a-time set — always run, 23 variants
Centre: entry **B** (E9/E21 cross) on the **5m MID** chart, no MTF filter, exit **3** (hold above 9 EMA), |delta| 0.40,
2 s latency, intraday (flat 15:55), all roots and buckets pooled (by-bucket results reported, not separate variants).
Variants: (a) entries A, C, D, E (MTF pullback 5→15), F (VWAP), G (GEX), H with the centre's exit and no MTF (7) + the
centre (1); (b) the centre with MTF models A (5,15), B (5,15), C (5,15,60), D (1,5,15,30,60), E (1,5,15,30,60),
F (5,15) (6); (c) the centre with exits 1, 2, 4, 5, 6, 7, 8, 9, 10 (9). Total 23. This guarantees every entry, MTF
model and exit in the brief is run once, so none is "untested", while the variant count stays small.

### 5.2 Stage 2-S: models built from Stage-1 passers — cap 80 variants
Only if ≥ 1 feature passes Stage 1. Construction rule (no other choices allowed):
* each passing S1A feature (tf, type) maps to its entry model (S → model C on that tf as a state-entry: the first bar
  S turns +1; A/B/C/D/H → the same model; L50/L200 → model A with N = 50/200) — at most the 8 passers with the
  largest δ lower bound;
* each entry is run (i) alone, (ii) with the MTF model that uses only S1B-qualified timeframes (B if one HTF
  qualifies, C if two or more), (iii) with the passing S1C confirmations combined (all of them, AND) — at most 3 forms;
* exits: the three exits with the best Stage-2-C results **on the centre entry** (chosen from 2-C, so no new search)
  plus exit 10: 4 exits;
* buckets: pooled, or restricted to the buckets whose per-bucket S1A δ point estimate is > 0 (one choice, fixed by
  that rule).
8 × 3 × 4 = 96 ≥ 80: if the product exceeds 80, entries are dropped from the smallest δ lower bound until ≤ 80.

### 5.3 Reporting for every Stage-2 variant
n, expectancy net and gross, session-clustered 95% CI, win rate, payoff, median, Sharpe per trade/day, max DD,
by block and by bucket and root, exit reasons, holding time, mid-reference return, rejected entries (spread/size), and
the comparison with (a) **BL2 random entries with the same exit and the same entry count per session** (the
shuffled-time null), (b) **the shuffled-side null** (same times and contracts' delta, random call/put), and (c) BL3/BL4
(underlying-only / option-only EMA references).

## 6. Stage 3 — walk-forward, ablation, sensitivity (DEV)

* **Walk-forward** (`engine/walkforward.py monthly_folds`, embargo 1 session): DEV months in time order
  2022-03, 2022-04, 2022-05, 2024-03, 2024-04, 2024-05; anchored expanding train; test months 2022-05, 2024-03,
  2024-04, 2024-05 (min 2 train months). In each fold the variant with the best train expectancy (net) within the
  Stage-2 family is run on the test month; the concatenated OOS trades are the WF result.
* **PBO** (CSCV, 16 blocks) on the sessions × variants matrix of each Stage-2 family; **DSR** with the ledger's total
  trial count at the time of the look (`eval/metrics.py ledger_trials`).
* **Ablation** (each candidate that passes the §7 bar on DEV-WF): remove one component at a time — each timeframe of
  its MTF set, the VWAP leg, the GEX leg, RSI/RVOL legs, the underlying confirmation, the option-chart trigger (→ the
  underlying-only version). Paired session-clustered difference. **Freeze the simplest model** whose expectancy is
  not significantly lower (paired CI includes 0) than the full one.
* **Sensitivity** (reported, a candidate must survive): latency 0 s / 60 s, +1 tick slippage both sides, SPXW fee
  $0.65 and $1.65, |delta| target 0.30 and 0.50, EMA lengths one step either side in the brief's list (e.g. 9 → 5/15,
  21 → 20/50), warm-up strict (2N), TRADE instead of MID series. **Survival rule:** expectancy > 0 at +1 tick and at
  60 s latency, and > 0 in ≥ 70% of the parameter neighbours.
* Overnight variant (8+ DTE only): one registered variant per candidate (exit unchanged, no 15:55 flat, max 5 sessions).
* Cap: ≤ 20 looks per candidate, ≤ 3 candidates (60 looks).

## 7. Pass bars

**Promotion to VALIDATION** (DEV walk-forward OOS trades; V2 rule 7 bar): n ≥ 150; expectancy net > 0 with the
95% session-clustered CI excluding 0; win rate ≥ 55% OR expectancy ≥ +10%/trade; beats the BL2-same-exit null and
the shuffled-side null at ≥ 95% (candidate above the 95th percentile of ≥ 200 null runs; null FDR ≤ 5%); DSR ≥ 0.95 at
the ledger trial count; PBO < 0.3 for its family; positive in both blocks (regimes) and in ≥ 2 of the 3 labelled
day types (`classify_session`); survives §6 sensitivity. At most 3 candidates; each is frozen (frozen/<ID>.py from
compass-v2's template, its commit hash in the ledger) before VALIDATION is fetched.
**VALIDATION** (one look per frozen candidate): the same bar on 2025-H2 (n ≥ 150, CI > 0 net, win/expectancy rule,
≥ 2 regimes, null percentile ≥ 95%). **LOCKED**: a validated candidate goes to the blind scorer once (V2 rule 12),
then red team (rule 13), then a ≥ 15-session live shadow (rule 8).

## 8. Multiple testing and the ledger

* Stage 1: Holm–Bonferroni (FWER 5%) within each family (S1A 40, S1B 5, S1C 14); BH q-values also reported.
* Stage 2/3: every variant and every look counts. Deflated Sharpe uses the global ledger total.
* **Registered now** (ledger lines under worker EMA): S1A 40 looks, S1B 5 looks, S1C 14 looks, S1 null calibration
  (pipeline check, not a hypothesis: 0 trials), S2-C 23 variants, S2-S cap 80 variants, S3 cap 60 looks,
  VALIDATION cap 3 looks — **225 trials registered**, plus the six baselines × two exits counted conservatively as
  12 looks: **237 in all**. The global ledger total after these lines is **904** (`eval/metrics.py ledger_trials`:
  155 prior + 488 registered + 261 other result lines) — the N for every deflated Sharpe until more lines are added.
* Every executed variant/look is also logged on its own ledger line with its result (pass or fail), including the
  failures; failed experiments and their code/results stay in the repo (`results/` under ema-mtf).

## 9. Baseline reference (Phase 1, DEV)

See `reports/BASELINES.md`. These are references, not hypotheses: Phase 2 compares every variant with BL2 (random,
same exit) and BL3/BL4 and reports the difference; no threshold in §7 is changed by them.

## 9a. Amendment A1 (2026-11-06, before any Stage-1/2 outcome and before the baselines ran): latency source

Found while building the panel (`edata/validate.py`, DATA_COVERAGE §6): the terminal's 1-minute grid does not move
with `start_time` — the "2 s after the bar" rows are the bar-end NBBO relabelled (100% equal to the 100 ms store at
:00, 43% at :02). Exact 2 s fills therefore need the contract-day's 1-second NBBO (`edata/fills.py`, verified 100%
equal to the 100 ms store at bar end + 2 s). Rules, replacing "2 s latency" wherever §4–§7 use it:
* **Screening** (Stage 1 outcomes Y_h, Stage 2 variants, walk-forward, ablation, sensitivity) runs at **L0c** = fills at
  the bar-end NBBO (L0) **minus the measured mean 2-second drift** (+0.17% of mid on the buy, +0.05% on the sell,
  `edata/latency_cal.py`, 2.08M contract-minutes, applied as an extra cost on every fill), with **L60** (fills at the
  next bar end) reported beside it.
* **Promotion** (§7 bar) and VALIDATION are evaluated at exact **L2** (1-second NBBO 2 s after each decision) on
  every trade of the candidate; a candidate must pass at L2 — L0c is never the result of record.
* This changes no feature, model, parameter or pass threshold, adds no variant, and is logged in the ledger.
* Housekeeping: per-trade logs are kept with the data (`v2data/ema/results/`, too large for git); every result's
  markdown report, its code and its ledger line stay in the repo (§8 "failed experiments preserved" is met by those).

## 9b. Amendment A2 (2026-11-06, EMA-2, before any Stage-1 statistic was computed on real outcomes)

Why: §4 leaves some computational details open. Each is fixed here, by the code that implements it
(`stage1/`), before `stage1.run analyse`, the permutation null or the synthetic null ran on real data. What had been
looked at when this was written: the event-table coverage (event counts, warm shares, feature prevalences, joined-bar
timestamps). No outcome had been split by any feature. **No feature, model, parameter, horizon, family or pass threshold
changes, and no variant is added**: 0 trials.

1. **δ (§4.2)** is formed over the strata that hold both feature = 1 and feature = 0 events. A stratum with only one
   side has no within-stratum contrast and is left out. Weights = the feature = 1 count. The underlying state in the
   stratum is the same-tf state (c > E9 > E21 → +1, mirror → −1, else 0) on the underlying's own bars, read at the last
   completed bar and multiplied by the trade's right.
2. **p-value**: one-sided, from the same session-clustered bootstrap that gives the CI (4000 resamples, seed 7, every
   eval session of both blocks a cluster, the statistic recomputed per resample): p = (1 + #{δ* ≤ 0}) / 4001.
3. **Pooling**: rules (i), (ii), (iv) and (v) use both blocks pooled (128 sessions); (iii) uses each block alone. The
   strata do not include the block.
4. **(v)** compares mean Y30 | feature = 1 (warm events) with mean Y30 over all events that have an outcome.
5. **Events without an outcome** (the entry is rejected at arrival under L0c: the drifted spread is > 8% of mid, or the
   size is 0) are dropped from every test (0.01% of SPY block-A events).
6. **S1B**: the regressors are the tri-valued states (−1/0/+1), five on the option's MID chart and five on the
   underlying (sign-aligned). The fixed effects are root×bucket×right and the half-hour of the decision close. Standard
   errors are CR1 clustered by session, p is one-sided normal. Only events with all ten states defined are used. The
   "nominal 5% one-sided" qualification rule is applied to each coefficient, and Holm over 5 is reported as the family
   test.
7. **S1C definitions**:
   * VWAP side: the underlying's 1-minute close is on the trade's side of the session VWAP.
   * Underlying 5m state = +1 in the trade's direction.
   * RSI14 of the underlying's 5m closes is above 50 for calls and below 50 for puts.
   * Cumulative RVOL > 1.5 (engine/underlying.py; SPX uses SPY's volume).
   * The three "breaks" are a 1-minute close beyond the level, at or before the decision bar, in the trade's
     direction: the 15-min opening range (closes from the bar ending 09:46), PDH/PDL and the premarket H/L (closes from
     09:31).
   * 5m BOS in the trade's direction on one of the last 3 completed 5m bars.
   * GEX / walls / ATM IV come from the latest positioning snapshot visible at the decision (stamp + 60 s; before
     10:01 that is the previous eval session's 16:00 book).
   * Wall distance is measured from the underlying's close at the decision. A missing wall counts as "no wall
     against".
   * ATM IV "up over 60 min": the visible snapshot's ATM IV is above the one stamped 60 minutes earlier in the same
     session (else undefined).
   * P/C OI ratio: total put OI / call OI on the morning report (all expirations), compared with the median of the
     prior 20 stored sessions' ratios (undefined with fewer than 20).
   * Contract RVOL: today's cumulative eligible print volume to the decision, divided by the mean of the same over
     the contract's 5 prior stored sessions. All 5 must exist. A zero base counts as RVOL > 2 if today printed, and is
     undefined otherwise.
   * UW: an alert is ask-side if its ask-side premium is above its bid-side premium. It counts if its right equals the
     trade's and its `created_at` falls in (decision − 15 min, decision]. It is undefined for SPXW and for block B.
8. **Theta/reprice control (§4.5)**:
   * P* uses the MID-implied vol at the first valid bar end at or after 10:00 of each session, and applies it from
     that bar on.
   * Earlier bars of the session use the previous stored session's frozen vol, so no P* bar reads a later quote.
   * P* is evaluated on the MID chart's own bar grid: the underlying's close of the bar's last minute, and the time
     to the 16:00 expiry at the bar end.
   * δ* is the same statistic, with the strata also split by the P* feature value.
   * "Vanishes" means δ's CI excludes 0 and δ*'s CI includes 0.
9. **TRADE arm**: the density rule is computed on the wall-clock tf grid of the sessions where the contract was stored
   (quoted). N is the feature's longest EMA (S, B, H 21; A 9; C, D, L50 50; L200 200).
10. **Permutation null (§4.5)**:
    * Each run permutes every feature's values among its warm events within each session × root × bucket × right
      cell, with outcomes and strata fixed.
    * It then applies the full S1A rule: bootstrap p, Holm over 40 and rules (i)–(v).
    * FWER = the share of the 200 runs (seed 20261106) with any feature passing (i) and (ii). The share passing the
      full rule is reported too.
11. **Synthetic zero-drift null (V2 rule 11b; required by the Phase-2 brief)**:
    * Data: `stage1/synth.py` (tested in `etests/test_stage1.py`) builds a martingale underlying at each session's
      real 5-minute vol profile and re-quotes every option at Black–Scholes on compass-v2's trading-time clock, with
      the real median spread and real sizes.
    * Pipeline: the whole S1A pipeline, rules included, runs on all 8 root-blocks.
    * Seeds: 20 (0–19), run before any decision that uses the null. Each seed rebuilds both DEV blocks (≈10 CPU-min),
      so 200 are out of budget. The 95% upper bound on a 0/20 FWER is 14%, and the report states it.
    * Pass condition: the share of synthetic runs with a Holm-passing feature is ≤ 5% (≤ 1 of 20).
12. **VALIDATION window decided by bytes (§2)**: the store holds 1.135 GB and block B will add ≈ 0.62 GB (block A
    measured: 2.15 MB per eval root-session, 0.28 MB per history root-session). The full 2025-07..12 panel is
    estimated at ≈ 1.17 GB → 2.93 GB, over the 2.5 GB budget. The pre-declared fallback **2025-07-01 .. 2025-09-30**
    (64 sessions, warm-up from 2025-04-01) is estimated at ≈ 0.62 GB → 2.37 GB, and it is used. Nothing from 2025 had
    been fetched or looked at.

## 9c. Amendment A3 (2026-11-06, EMA-2, before any Stage-2 outcome was computed)

Why: §5–§6 and STRATEGY_SPEC §7–§10 leave some execution details open. They are fixed here, by `stage2/`, which is
tested trade by trade against `engine/execution.Simulator` + `engine/signals.py` (`etests/test_stage2.py`). This was
committed before any Stage-2 variant or null ran on real data. **No variant, parameter or threshold changes**: 0 trials,
except item 9's reference, which is counted.

1. **Entry decisions**: every Stage-2-C trigger is on the 5m chart. Entries are taken at 5m closes 09:35–15:50
   (STRATEGY_SPEC §5) and flattened at 15:55.
2. **Contract**: the trigger is evaluated on every tradable contract's own chart (§7).
   * Within a (bucket, right), the trigger contract nearest |delta| 0.40 is taken (ties: the cheaper ask).
   * If a call and a put both trigger in the same bucket, the one nearer 0.40 is taken (ties: the call).
   * One open position per (variant, root, bucket). A new entry needs a decision after the open position's exit
     decision bar.
3. **MTF models with the centre trigger** (B on 5m):
   * A (5,15): model B fired on a 15m bar ending at the decision or at one of the two previous 5m closes.
   * B (5,15): 15m state +1.
   * C (5,15,60), D and E (1,5,15,30,60): the listed timeframes include the 5m trigger timeframe. D is the weighted
     score ≥ 0.6 with all five states defined; E is ≥ 3 of 5 at +1.
   * F (5,15) needs an H trigger by its own definition, so the variant is entry H on 5m + 15m state ≤ 0 + 15m E5 slope
     > 0.
   * Every state is read at its timeframe's last completed bar, and only once E21 is warm.
4. **Entry E** reads the HTF state from the 15m chart. **F** is B + the underlying's close on the trade's side of the
   session VWAP and of its 5m EMA21. **G** is B + net GEX < 0 + no wall against within 0.3% (latest snapshot visible
   at stamp + 60 s; wall distance from the underlying's close).
5. **Exits** read the 5m trigger chart. "Highest timeframe used at entry" (exits 6, 10) is 5m for every exit variant
   (they all sit on the centre, which has no MTF).
   * X1/X2 levels are the 5m EMAs known at the entry decision, frozen.
   * X2 is three 1-contract units averaged into one trade record.
   * X5 uses the 1m MID chart's confirmed swing lows (close-only pivots), with a 1.5×ATR stop until one forms.
   * ATR is the Wilder(14) true range of the contract's 5m TRADE bars where the TRADE series is dense (≥ 80% of the
     last 28 wall-clock 5m bars printed), else 1.25 × the Wilder mean |Δ| of the 5m MID closes.
6. **Stage-2 nulls (§5.3)**: 20 seeds per variant for the Stage-2 table; ≥ 200 for a §7 candidate.
   * (a) Shuffled time: per (session, root, bucket), the variant's number of filled entries, drawn at random 5m
     decision closes in random order. The one-position rule applies, and draws continue until the count is met.
     The side is random, the contract is the tradable one nearest 0.40, and the exit is the variant's.
   * (b) Shuffled side: the variant's entry times and buckets, a coin-flip right, the contract of that right nearest
     the variant contract's |delta|, and the variant's exit.
   * The variant's percentile is the share of null runs whose pooled net expectancy is below the variant's.
7. **Fill models**: L0c is the screening model. L60 is run beside it for every Stage-2-C variant. Exact L2 (1-second
   NBBO, fetched only outside 09:15–16:05 ET) is run only for a §7 candidate's trades.
8. **Day types** use compass-v2's fixed `classify_session` rules, applied to the 1-minute SPX (else SPY) closes
   09:35–15:55. Return on capital = Σ net $ / Σ (premium + entry fee) $.
9. **Reference run, counted**: BL3 (underlying-only 5m EMA9/21 cross, side of the cross, contract nearest 0.40) with
   exit 3. It is the underlying-only reference for the centre and is logged in the ledger as one baseline look. The
   option-only reference with exit 3 *is* the centre (BL4's entry), so it is not run twice.
10. **Stage 3 (§6)**:
    * Walk-forward: within each Stage-2 family, the variant with the highest train-month pooled net expectancy
      (L0c) is run on each test month. Train months use only DEV sessions before the test month, minus a 1-session
      embargo.
    * PBO: CSCV with 16 blocks on the sessions × variants matrix of per-session mean net returns (0 for a session
      with no trade).
    * DSR: per-trade Sharpe of the WF OOS trades, with N = `ledger_trials()` of the global ledger at the time of the
      look.
    * Ablation and sensitivity are run only for a candidate that passes the §7 DEV-WF bar (other than the
      L2/sensitivity items, which are part of that bar).

## 9d. Amendment A4 (2026-11-06, EMA-2, after the Stage-3 walk-forward and before any sensitivity/ablation look)

What had been seen: Stage 1 (0/40, 0/5, 0/14), the 23 Stage-2-C variants on both blocks (all negative net, no CI > 0)
and the walk-forward. The WF result fails the §7 DEV bar: OOS CI ≤ 0, DSR ≈ 0, and it is negative in both blocks.
**So there is no candidate.** §6 runs ablation and sensitivity only for a candidate that passes. The brief still
asks for an ablation study and a parameter-sensitivity report, so they are run as a **diagnostic, not a
promotion step**. Nothing found here can create a candidate: a variant would need a new pre-registration and its own
untouched data.

* **Variants** (fixed by rule, not by results within this step), the three that cover every component §6 names:
  * S2C-entryF (B + VWAP + underlying EMA21): the best Stage-2-C variant on DEV; VWAP and underlying legs.
  * S2C-mtfD (weighted MTF over 1/5/15/30/60m): the MTF variant the walk-forward chose; each timeframe.
  * S2C-entryG (B + GEX + walls): the only positioning variant; GEX and wall legs.
* **Looks**: the 15 §6 sensitivity looks each (latency 0/60 s, +1 tick, SPXW fee $0.65/$1.65, |delta| 0.30/0.50,
  entry EMA neighbours 5/15 × 21 and 9 × 20/50, strict warm-up, TRADE trigger, exit-EMA 5/15). Plus the one-component
  ablations: F: no VWAP, no underlying EMA21, underlying-only; mtfD: each of the 5 timeframes removed; G: no GEX,
  no wall, underlying-only.
* An ablation identical to an existing Stage-2 variant (no MTF, no underlying legs, no positioning = the centre) uses
  that variant's stored trades and is not a new look.
* That makes 18 + 20 + 18 = **56 looks**, inside the registered S3 cap of 60, each logged.
* RSI/RVOL legs are in no Stage-2-C variant (they were S1C confirmations, and none passed): not ablated.
* The overnight variant is defined only for a candidate: not run.

## 10. Final verdict mapping (fixed now)

* **A — viable edge**: a frozen candidate passes VALIDATION and the single blind LOCKED look at the §7 bar.
* **B — inconclusive**: a candidate passes DEV-WF but VALIDATION/LOCKED cannot be scored at the bar for lack of data
  (n < 150 with CI > 0, a missing regime, a data gap), or the key configurations are only partially testable; the
  report states exactly which data would settle it.
* **C — no demonstrated edge**: nothing passes the §7 DEV bar (or VALIDATION fails); the report lists every
  configuration that was untestable (DATA_COVERAGE) or not run.
