# EDGE0DTE Stage 1: frozen spec of the ONE CALIBRATION (2024) look

Frozen 2026-11-07, after the Step-1 DISCOVERY aggregation (commit 5cccac6, `results/STAGE1_DISCOVERY.md`) and BEFORE
any 2024 outcome (Z, V) of any EDGE0DTE test was computed or read. Its sha256 is appended to
`v2data/locked_looks.jsonl` and to `research-v2-ledger.md` ("CALIBRATION LOOK") in the commit that adds this file. The
code refuses every CALIBRATION step unless this file's sha256 is registered. Each cell below is looked at ONCE; there is
no re-run with other settings. 2025 (HOLDOUT) and 2026 (LOCKED) are not read: the loaders refuse any split other than
DISCOVERY / CALIBRATION, and lib.guard stays on.

## 1. Sessions, data, code

* CALIBRATION = expiry sessions 2024-01-02 .. 2024-12-31 of each root (FOUNDATION panel `split == 'CALIBRATION'`:
  SPXW 252, SPY 252, QQQ 252, IWM 224 sessions). Decision grid, Z, V, IV_atm, RV exactly as in DISCOVERY (lib.outcomes).
* Code (reused, definitions unchanged; only a split parameter added): `families/d_stage1.py` (`load_panel(root, split)`,
  `features(root, split)`, `Grid`, `hmix`, `hget`), `families/d_vol.py` (features, unchanged), `families/bf_stage1.py`
  (`discovery_days(root, which)`, `run_events(root, which, keep)`, `events_day(root, day, keep)`,
  `bucket_means(root, which)`, `hurdle_for`), `families/bf.py` (unchanged), `lib/stats.py` (unchanged).
  The look itself: `families/agg_calibration.py`. `keep = {('B8','z2'), ('B1','OR30')}`: only these events get an
  outcome; no other BF row gets a 2024 outcome.
* Validation done before freezing (DISCOVERY only): the same code with `split = 'DISCOVERY'` reproduces D.parquet and
  BF.parquet exactly for every cell below on all four roots (effect, CI, p, n, E[V]-1, hurdle), and
  `events_day(keep=...)` reproduces the DISCOVERY B1/B8 event rows on three sampled sessions
  (`python3 -m families.agg_calibration validate` -> VALIDATION PASS).
* Frozen inputs (sha256):
  - families/agg_calibration.py c0f5d5062c61ee11ddf47e40e9ab07cdcb48ebe33ae67b2e8c16ee5f04c3cd57
  - families/d_stage1.py 5ad20f233950dbe890416daa980b4b88528d64ca2cb1f2182c3be99f802f3c26
  - families/d_vol.py 8ceb75970fc718ad91df7c882bd609b469d9fe68917e55b4af28f5f97df5aade
  - families/bf_stage1.py 326f03bbe0817b944fdac21715f454f61002e1cb89e562e17dc2d342c46b3d0f
  - families/bf.py 68b22e22d02b167d42c5612814d2ec7fdc4cfe120509df3b8d8c1e19ffd77414
  - lib/stats.py 49d9ed9b5e6962cae7c9f0888c4d8bf04c977168f46cb075019477d65533be33
  - results/stage1/D_cutoffs.json 3ead4f80f6d5b42eb261b1a13a125cb3b1ca746a0874742d5c65659c1b70f2b0
  - results/stage1/STAGE1_DISCOVERY.parquet 371bfbb102b7b5f66128851c5dedd2937587e0cd800f1b4828b081951204dde0
  - v2data/edge0dte/hurdle.parquet a85f03305db04766d7f7e2f840aa2c3ffa0c75659e9589524280a6eb22b75442
  - v2data/edge0dte/panel/SPXW.parquet 5fa20122c894862999b8d4d6111cbfb6974ebcd908585ed698d77c5aeb22311c
  - v2data/edge0dte/panel/SPY.parquet e2a4ec22c59b2f92974fb3b4aa30e8ed57094ef4f06fe0e7a95cfcaa43052ccc
  - v2data/edge0dte/panel/QQQ.parquet b73ac4011872d781c2894ac45c7fe74e7fa0e96180b7de150a3dfb8e8177e1a6
  - v2data/edge0dte/panel/IWM.parquet 94b630deb3a8f127a83967045f1f38e288c7699704903be2ddc3ed92641807a4

## 2. Cells looked at (and nothing else)

### (a) Step-1 DISCOVERY survivors (family D, SPXW primary; SPY/QQQ/IWM computed and reported, not in the rule)

| cell | feature and condition (P) | outcome | DISCOVERY effect [95% CI] (SPXW) | registered sign |
|---|---|---|---|---|
| D2 compression h60 | d_rv30_rel = RV(t-30m,t) / median same-window RV of the prior 20 sessions (>= 10 valid) < 0.5 | ln V(t,60) | -0.320 [-0.363, -0.277] | ln V < 0 |
| D2 compression hclose | same | ln V(t,close) | -0.139 [-0.174, -0.107] | ln V < 0 |
| D4 high h60 | d_iv_rv60 = IV_atm(t)^2 / annualised RV(last 60 min) >= the frozen DISCOVERY top-tercile cut of the root (D_cutoffs.json; SPXW 2.056208976593107, SPY 2.2470032857814863, QQQ 1.8901496806454299, IWM 1.9768316792043474) | ln V(t,60) | -0.311 [-0.350, -0.273] | ln V < 0 |
| D5 14:30 h60 | decision times in the 14:30 bucket (14:30, 14:35, ..., 14:55) | ln V(t,60) | -0.530 [-0.558, -0.503] | two-sided (ln V != 0); DISCOVERY sign < 0 |

Statistic (identical to D): D2/D4: effect = mean over the condition of (ln V - mu_t), mu_t = the same-grid-time mean of
ln V over all rows of the tested sample (here: 2024), CI and two-sided p from the day-clustered bootstrap
(`Grid.boot`, 2,000 day resamples, seed 1, mu_t re-estimated in each resample). D5: mean ln V over the bucket vs 0,
`lib.stats.boot_mean` (2,000, seed 1). Also reported: E[V]-1 inside the condition (day-clustered CI), the frozen
DISCOVERY short-side hurdle (D2/D4: hv_short weighted by the 2024 condition's time-of-day mix; D5: the 14:30 bucket
cell, 198 times), and SPY/QQQ/IWM effects.

**Pass rule (PROTOCOL section 4, the only rule that decides):** with d = the DISCOVERY SPXW effect (all four are
negative), the cell FAILS if (i) the 2024 SPXW effect has the opposite sign of d (sign flip), or (ii) the 2024 95% CI
includes -d/2, the wrong-sign value of half the discovery effect (i.e. ci_lo <= -d/2 <= ci_hi; here -d/2 > 0).
Otherwise it PASSES. Reported only, never used to pass or fail: CI excludes 0; CI beyond d/2; 2024 E[V]-1 vs the
short hurdle; replication signs on SPY/QQQ/IWM.

### (b) REGISTRY_ADDENDUM_3 rows (no DISCOVERY evidence by design)

| cell | definition | outcome, stated sign |
|---|---|---|
| B8R h30, B8R h60 | B8's exact P trigger: at a grid time t, |Z over the last 60 min| > 2 (Z60 = ln(S(t)/S(t-60)) / (IV_atm(t) sqrt(60 min)); bf.day_events 'B8' 'z2'); direction = the sign of the shock (= -B8's dir) | mean over events of dir_shock * (Z_h - mu_bucket,h) > 0, h = 30, 60 |
| X12R h60, X12R hclose | B1 P trigger (first 5-min close beyond the 30-min opening range, one event per session; bf 'B1' 'OR30'); VIX(t) tercile from the prior 252 sessions' VIX closes (bf.vix_terciles; low = VIX <= 1/3 quantile, high = VIX > 2/3 quantile) | [mean of dir*(Z_h - mu) over low-tercile events] - [same over high-tercile events] > 0 (`lib.stats.boot_diff`, days resampled), h = 60, close |

mu_bucket,h = the mean of Z_h over all 2024 grid rows of the root in the same 30-minute bucket (`bucket_means(root,
'CALIBRATION')`). CI and two-sided p: day-clustered bootstrap, 2,000, seed 1.

**Pass rule (Addendum 3, verbatim intent):** on SPXW, the four p-values (B8R h30, B8R h60, X12R h60, X12R hclose) are
Holm-adjusted as one family at 0.05. A cell PASSES only if all of: Holm-adjusted p <= 0.05, effect > 0 and its 95%
CI excludes 0; the effect >= the HURDLE.md hurdle |E[za]|* at that horizon (`bf_stage1.hurdle_for`: the SPXW bucket
hurdles averaged over the cell's events - for X12R the low-tercile events -, pooled cell where a bucket is missing);
and the same cell's 2024 effect is > 0 on at least 2 of SPY / QQQ / IWM. Reported only: the raw sign-aligned E[za]
(no mu) against the same hurdle.

## 3. Stage-2 expression fixed now (before any P&L of any cell is seen)

A cell that passes earns a Stage-2 executable test (PROTOCOL section 4 Stage 2, REGISTRY_ADDENDUM_2 M rows):
* V < 1 cells (D2 h60, D2 hclose, D4 high h60, D5 14:30 h60): defined-risk short iron fly (short ATM straddle + long
  wings) entered at the signal time, fixed time stop at the Stage-1 horizon (h = 60: t + 60 min; close: 15:58), fills
  ask-in/bid-out at the first valid 1-s NBBO >= t + 2 s, $0.65/contract/side/leg; AND the ADDENDUM_2 M1/M2 passive-fill
  version (resting limits at mid, the M fill model; unfilled package = no trade).
* Direction cells (B8R, X12R): long 0.30-delta option in the cell's direction (call up / put down), time stop at h.
* V > 1 cells: ATM straddle (none is in this look).
The exit grid and wing width are fit on DISCOVERY+CALIBRATION by walk-forward per PROTOCOL; nothing of Stage 2 is run
by the aggregator.
