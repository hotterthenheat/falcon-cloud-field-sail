# EDGE0DTE Stage 1: the ONE CALIBRATION (2024) look

Frozen spec `frozen/STAGE1_CALIBRATION_SPEC.md` (sha256 `a45821ada4b545fd731bd4ad54a06d690573c2fec1736404291a3baf2c609743`), committed in 2dc2462 and registered in `v2data/locked_looks.jsonl` and `research-v2-ledger.md` before any 2024 outcome was computed. Sessions: 2024 expiry sessions of each root (SPXW 252, SPY 252, QQQ 252, IWM 224). Code: `families/agg_calibration.py` (look) reusing `d_stage1` / `d_vol` / `bf_stage1` / `bf` with only the split filter moved by a parameter; this report: `families/agg_cal_report.py`. Machine-readable: `results/stage1/STAGE1_CALIBRATION.parquet` (every cell x root) and `STAGE1_CALIBRATION_verdict.parquet`. Each cell was looked at once; nothing was re-run. No 2025 or 2026 data was read (HOLDOUT guard on).

Labels: bars, board mids OBS; IV_atm, RV, Z, V, d_rv30_rel, d_iv_rv60 CALC; VIX OBS; hurdles CALC from DISCOVERY OBS fills (HURDLE.md, frozen). Same-time (D) / same-bucket (BF) means are re-estimated inside 2024.

## (a) DISCOVERY survivors: PROTOCOL section 4 rule

Rule: FAIL on a sign flip of the 2024 SPXW effect, or when its 95% CI includes -d/2 (d = the DISCOVERY SPXW effect: the wrong-sign value of half the discovery effect). Everything else in the table is reported, not part of the rule.

| cell | DISCOVERY d [95% CI] | 2024 SPXW n obs / sess | 2024 effect [95% CI] | p | -d/2 | sign flip | CI incl. -d/2 | CI excl. 0 | CI beyond d/2 | 2024 E[V]-1 [95% CI] | short hurdle (below) | clears | SPY / QQQ / IWM 2024 | VERDICT |
|---|---|---:|---|---:|---:|:-:|:-:|:-:|:-:|---|---|:-:|---|:-:|
| D2 compression 60 | -0.320 [-0.363, -0.277] | 2958 / 159 | -0.151 [-0.210, -0.095] | 0.0005 | +0.160 | no | no | yes | no | -0.296 [-0.345, -0.243] | -0.390 | no | -0.184 / -0.207 / -0.181 (3/3 same sign) | **PASS** |
| D2 compression close | -0.139 [-0.174, -0.107] | 3276 / 164 | -0.049 [-0.111, +0.020] | 0.1520 | +0.070 | no | no | no | no | -0.109 [-0.235, +0.059] | -0.294 | no | -0.084 / -0.119 / -0.119 (3/3 same sign) | **PASS** |
| D4 high 60 | -0.311 [-0.350, -0.273] | 2657 / 180 | -0.248 [-0.344, -0.154] | 0.0005 | +0.156 | no | no | yes | no | -0.363 [-0.426, -0.288] | -0.446 | no | -0.321 / -0.352 / -0.399 (3/3 same sign) | **PASS** |
| D5 14:30 60 | -0.530 [-0.558, -0.503] | 1480 / 247 | -0.453 [-0.507, -0.400] | 0.0005 | +0.265 | no | no | yes | yes | -0.281 [-0.327, -0.233] | -0.353 | no | -0.674 / -0.689 / -0.540 (3/3 same sign) | **PASS** |

Replication detail (2024, same cell, each root its own frozen DISCOVERY cut and hurdle cell):

| cell | root | n obs / sess | effect [95% CI] | p | E[V]-1 [95% CI] | short hurdle |
|---|---|---:|---|---:|---|---|
| D2 compression 60 | SPXW | 2958 / 159 | -0.151 [-0.210, -0.095] | 0.0005 | -0.296 [-0.345, -0.243] | -0.390 |
| D2 compression 60 | SPY | 3097 / 159 | -0.184 [-0.249, -0.124] | 0.0005 | -0.385 [-0.429, -0.339] | - |
| D2 compression 60 | QQQ | 2428 / 151 | -0.207 [-0.280, -0.137] | 0.0005 | -0.347 [-0.397, -0.290] | - |
| D2 compression 60 | IWM | 1873 / 130 | -0.181 [-0.259, -0.101] | 0.0005 | -0.250 [-0.312, -0.184] | - |
| D2 compression close | SPXW | 3276 / 164 | -0.049 [-0.111, +0.020] | 0.1520 | -0.109 [-0.235, +0.059] | -0.294 |
| D2 compression close | SPY | 3433 / 163 | -0.084 [-0.145, -0.016] | 0.0180 | -0.243 [-0.340, -0.107] | - |
| D2 compression close | QQQ | 2707 / 160 | -0.119 [-0.190, -0.037] | 0.0070 | -0.300 [-0.401, -0.145] | -0.291 |
| D2 compression close | IWM | 2083 / 130 | -0.119 [-0.203, -0.033] | 0.0070 | -0.263 [-0.332, -0.190] | - |
| D4 high 60 | SPXW | 2657 / 180 | -0.248 [-0.344, -0.154] | 0.0005 | -0.363 [-0.426, -0.288] | -0.446 |
| D4 high 60 | SPY | 3106 / 195 | -0.321 [-0.407, -0.237] | 0.0005 | -0.483 [-0.530, -0.425] | - |
| D4 high 60 | QQQ | 3368 / 209 | -0.352 [-0.435, -0.275] | 0.0005 | -0.489 [-0.537, -0.432] | - |
| D4 high 60 | IWM | 1813 / 157 | -0.399 [-0.535, -0.258] | 0.0005 | -0.433 [-0.488, -0.368] | - |
| D5 14:30 60 | SPXW | 1480 / 247 | -0.453 [-0.507, -0.400] | 0.0005 | -0.281 [-0.327, -0.233] | -0.353 |
| D5 14:30 60 | SPY | 1494 / 249 | -0.674 [-0.738, -0.613] | 0.0005 | -0.409 [-0.449, -0.367] | -0.355 |
| D5 14:30 60 | QQQ | 1479 / 247 | -0.689 [-0.759, -0.616] | 0.0005 | -0.404 [-0.444, -0.358] | -0.338 |
| D5 14:30 60 | IWM | 1324 / 221 | -0.540 [-0.600, -0.481] | 0.0005 | -0.342 [-0.386, -0.296] | -0.650 |

## (b) REGISTRY_ADDENDUM_3 rows: Holm over 4 at 0.05, hurdle, replication

Rule: Holm-adjusted p <= 0.05 over the four SPXW tests AND effect > 0 with its 95% CI excluding 0 AND effect >= the HURDLE.md |E[za]|* (event-weighted SPXW bucket hurdles; X12R: low-VIX events) AND the 2024 effect > 0 on >= 2 of SPY / QQQ / IWM. DISCOVERY numbers are shown for orientation only (they suggested these rows and are not evidence).

| cell | DISCOVERY (contaminated) | 2024 SPXW n obs / sess | 2024 effect [95% CI] | p | Holm p | raw E[za] | hurdle | effect >= hurdle | SPY / QQQ / IWM 2024 | VERDICT |
|---|---|---:|---|---:|---:|---:|---:|:-:|---|:-:|
| B8R 30 | +0.135 [+0.039, +0.236] | 517 / 128 | +0.119 [-0.082, +0.330] | 0.2940 | 0.8820 | +0.119 | +0.134 | no | +0.168 / +0.064 / -0.003 (2/3 > 0) | **FAIL** |
| B8R 60 | +0.175 [+0.061, +0.294] | 499 / 128 | +0.168 [-0.027, +0.376] | 0.0880 | 0.3520 | +0.169 | +0.116 | yes | +0.197 / +0.067 / +0.026 (3/3 > 0) | **FAIL** |
| X12R 60 | +0.136 [-0.049, +0.326] | 174 / 174 (low 69 / high 105 events) | -0.082 [-0.390, +0.238] | 0.6370 | 1.0000 | +0.069 | +0.134 | no | -0.048 / +0.010 / -0.175 (1/3 > 0) | **FAIL** |
| X12R close | +0.126 [-0.063, +0.316] | 174 / 174 (low 69 / high 105 events) | -0.056 [-0.351, +0.258] | 0.6720 | 1.0000 | +0.017 | +0.072 | no | -0.069 / +0.136 / +0.017 (2/3 > 0) | **FAIL** |

Replication detail (2024):

| cell | root | n obs / sess | effect [95% CI] | p | raw E[za] | hurdle |
|---|---|---:|---|---:|---:|---:|
| B8R 30 | SPXW | 517 / 128 | +0.119 [-0.082, +0.330] | 0.2940 | +0.119 | +0.134 |
| B8R 30 | SPY | 368 / 93 | +0.168 [-0.064, +0.395] | 0.1580 | +0.169 | +0.182 |
| B8R 30 | QQQ | 614 / 141 | +0.064 [-0.107, +0.244] | 0.4760 | +0.062 | +0.202 |
| B8R 30 | IWM | 668 / 155 | -0.003 [-0.151, +0.141] | 0.9720 | -0.001 | +0.244 |
| B8R 60 | SPXW | 499 / 128 | +0.168 [-0.027, +0.376] | 0.0880 | +0.169 | +0.116 |
| B8R 60 | SPY | 358 / 93 | +0.197 [-0.033, +0.429] | 0.1050 | +0.197 | +0.114 |
| B8R 60 | QQQ | 598 / 141 | +0.067 [-0.108, +0.249] | 0.4690 | +0.066 | +0.198 |
| B8R 60 | IWM | 659 / 153 | +0.026 [-0.138, +0.184] | 0.7420 | +0.028 | +0.188 |
| X12R 60 | SPXW | 174 / 174 | -0.082 [-0.390, +0.238] | 0.6370 | +0.069 | +0.134 |
| X12R 60 | SPY | 176 / 176 | -0.048 [-0.332, +0.233] | 0.7600 | +0.067 | +0.138 |
| X12R 60 | QQQ | 171 / 171 | +0.010 [-0.315, +0.348] | 0.9370 | +0.122 | +0.208 |
| X12R 60 | IWM | 158 / 158 | -0.175 [-0.564, +0.195] | 0.3800 | -0.090 | +0.258 |
| X12R close | SPXW | 174 / 174 | -0.056 [-0.351, +0.258] | 0.6720 | +0.017 | +0.072 |
| X12R close | SPY | 176 / 176 | -0.069 [-0.325, +0.186] | 0.6190 | +0.041 | +0.187 |
| X12R close | QQQ | 171 / 171 | +0.136 [-0.152, +0.437] | 0.3520 | +0.216 | +0.117 |
| X12R close | IWM | 158 / 158 | +0.017 [-0.310, +0.321] | 0.9040 | -0.001 | +0.263 |

## Outcome

Passed CALIBRATION: 4 of 8 looked-at cells: D2 compression 60, D2 compression close, D4 high 60, D5 14:30 60.

**Read with the pass:** the PROTOCOL rule has no hurdle term at CALIBRATION, and in 2024 none of D2 compression 60, D2 compression close, D4 high 60, D5 14:30 60 keeps its conditional E[V]-1 below the frozen DISCOVERY short hurdle (table above, column "clears"). The variance premium inside these conditions was smaller in 2024 than in DISCOVERY, so the information survived but the economic size did not reach the round-trip cost of a short straddle/iron-fly proxy at aggressive fills. Stage 2 (executable P&L, including the passive-fill M1/M2 version) is where this is decided; this note is not a verdict.

Passing Stage 1 is not an edge: it only earns the pre-registered Stage-2 executable test (`results/STAGE2_QUEUE.md`) and, if that passes, one blind HOLDOUT look (PROTOCOL section 7).

