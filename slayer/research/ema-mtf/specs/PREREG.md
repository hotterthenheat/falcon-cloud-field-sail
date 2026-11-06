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

## 10. Final verdict mapping (fixed now)

* **A — viable edge**: a frozen candidate passes VALIDATION and the single blind LOCKED look at the §7 bar.
* **B — inconclusive**: a candidate passes DEV-WF but VALIDATION/LOCKED cannot be scored at the bar for lack of data
  (n < 150 with CI > 0, a missing regime, a data gap), or the key configurations are only partially testable; the
  report states exactly which data would settle it.
* **C — no demonstrated edge**: nothing passes the §7 DEV bar (or VALIDATION fails); the report lists every
  configuration that was untestable (DATA_COVERAGE) or not run.
