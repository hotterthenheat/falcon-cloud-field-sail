# EDGE-D2 Part 1: forecasting a big-move day (DEV, out-of-sample walk-forward predictions only)

PREREG `edge-d2/PREREG.md` @ bc38f68. Logistic regression (L2, C=1), anchored walk-forward by quarter; forecast-positive = p_hat >= 2 x the training base rate. AUC CIs: month-block bootstrap (2,000). Brier skill vs the training base rate. Y1 |o->c| > 1.5%, Y2 > 1.0%, Y3 high-low > 2x the 09:34 implied move.

## Target Y1

| model | OOS days | positives (base rate) | AUC [95% CI] | shuffled-null AUC p95 (real beats) | Brier (clim) | Brier skill | flagged | precision | recall |
|---|---:|---:|---|---|---|---:|---:|---:|---:|
| P | 1109 | 100 (9.0%) | 0.807 [0.728, 0.872] | 0.541 (100%, 200 runs; FDR 0.5%) | 0.0711 (0.0829) | +14.3% | 13% | 32.0% | 47% |
| B-VIX | 1109 | 100 (9.0%) | 0.817 [0.745, 0.877] | 0.538 (100%, 200 runs; FDR 1.0%) | 0.0742 (0.0829) | +10.5% | 14% | 31.9% | 51% |
| B-YB | 1109 | 100 (9.0%) | 0.604 [0.534, 0.671] | - | - | - | 9% | 28.0% | 28% |
| O | 454 | 14 (3.1%) | 0.743 [0.590, 0.871] | 0.568 (100%, 200 runs; FDR 3.0%) | 0.0348 (0.0456) | +23.7% | 1% | 16.7% | 7% |
| B-IM | 454 | 14 (3.1%) | 0.780 [0.569, 0.921] | - | 0.0296 (0.0456) | +35.1% | 0% | nan% | 0% |
| F | 454 | 14 (3.1%) | 0.711 [0.533, 0.860] | 0.574 (100%, 200 runs; FDR 2.5%) | 0.0362 (0.0447) | +19.1% | 1% | 16.7% | 7% |

Paired AUC difference (same OOS days), month-block bootstrap:

- P minus B-VIX: -0.010 [-0.049, +0.022] on 1109 days
- P minus B-YB: +0.202 [+0.161, +0.247] on 1109 days
- O minus B-VIX: -0.047 [-0.140, +0.070] on 454 days
- O minus B-IM: -0.037 [-0.146, +0.104] on 454 days
- O minus P: +0.042 [-0.105, +0.161] on 454 days
- F minus O: -0.032 [-0.072, -0.001] on 454 days
- F minus B-IM: -0.069 [-0.181, +0.064] on 454 days

## Target Y2

| model | OOS days | positives (base rate) | AUC [95% CI] | shuffled-null AUC p95 (real beats) | Brier (clim) | Brier skill | flagged | precision | recall |
|---|---:|---:|---|---|---|---:|---:|---:|---:|
| P | 1109 | 228 (20.6%) | 0.763 [0.712, 0.804] | 0.527 (100%, 200 runs; FDR 0.5%) | 0.1401 (0.1660) | +15.6% | 16% | 48.9% | 38% |
| B-VIX | 1109 | 228 (20.6%) | 0.745 [0.691, 0.791] | 0.518 (100%, 200 runs; FDR 0.5%) | 0.1452 (0.1660) | +12.5% | 15% | 49.1% | 36% |
| B-YB | 1109 | 228 (20.6%) | 0.570 [0.531, 0.614] | - | - | - | 9% | 46.0% | 20% |
| O | 454 | 56 (12.3%) | 0.712 [0.629, 0.794] | 0.543 (100%, 200 runs; FDR 0.5%) | 0.1085 (0.1388) | +21.8% | 2% | 40.0% | 7% |
| B-IM | 454 | 56 (12.3%) | 0.715 [0.633, 0.780] | - | 0.1024 (0.1388) | +26.2% | 0% | nan% | 0% |
| F | 454 | 56 (12.3%) | 0.711 [0.629, 0.793] | 0.553 (100%, 200 runs; FDR 4.5%) | 0.1085 (0.1378) | +21.3% | 2% | 50.0% | 7% |

Paired AUC difference (same OOS days), month-block bootstrap:

- P minus B-VIX: +0.017 [-0.009, +0.048] on 1109 days
- P minus B-YB: +0.192 [+0.157, +0.227] on 1109 days
- O minus B-VIX: +0.029 [-0.039, +0.126] on 454 days
- O minus B-IM: -0.004 [-0.055, +0.066] on 454 days
- O minus P: +0.018 [-0.028, +0.074] on 454 days
- F minus O: -0.001 [-0.012, +0.014] on 454 days
- F minus B-IM: -0.004 [-0.057, +0.067] on 454 days

## Target Y3

| model | OOS days | positives (base rate) | AUC [95% CI] | shuffled-null AUC p95 (real beats) | Brier (clim) | Brier skill | flagged | precision | recall |
|---|---:|---:|---|---|---|---:|---:|---:|---:|
| P | 454 | 169 (37.2%) | 0.564 [0.520, 0.610] | 0.538 (98%, 200 runs; FDR 2.5%) | 0.2461 (0.2342) | -5.1% | 5% | 41.7% | 6% |
| B-VIX | 454 | 169 (37.2%) | 0.511 [0.464, 0.553] | 0.526 (84%, 200 runs; FDR 0.0%) | 0.2343 (0.2342) | -0.0% | 0% | nan% | 0% |
| B-YB | 454 | 169 (37.2%) | 0.508 [0.497, 0.521] | - | - | - | 3% | 50.0% | 4% |
| O | 454 | 169 (37.2%) | 0.560 [0.519, 0.605] | 0.537 (98%, 200 runs; FDR 2.5%) | 0.2520 (0.2342) | -7.6% | 8% | 42.9% | 9% |
| B-IM | 454 | 169 (37.2%) | 0.528 [0.489, 0.568] | - | 0.2338 (0.2342) | +0.2% | 0% | nan% | 0% |
| F | 454 | 169 (37.2%) | 0.589 [0.544, 0.636] | 0.544 (100%, 200 runs; FDR 4.0%) | 0.2471 (0.2342) | -5.5% | 8% | 44.4% | 9% |

Paired AUC difference (same OOS days), month-block bootstrap:

- P minus B-VIX: +0.053 [+0.005, +0.111] on 454 days
- P minus B-YB: +0.056 [+0.001, +0.109] on 454 days
- O minus B-VIX: +0.049 [-0.001, +0.113] on 454 days
- O minus B-IM: +0.033 [-0.014, +0.085] on 454 days
- O minus P: -0.004 [-0.035, +0.027] on 454 days
- F minus O: +0.029 [+0.009, +0.050] on 454 days
- F minus B-IM: +0.062 [+0.014, +0.121] on 454 days

## By year (Y1): AUC / base rate / precision at the threshold / recall / flagged

| model | 2020 | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|---|
| P | 0.83 / 16% / 39% / 68% / 28% | 0.72 / 5% / 15% / 17% / 5% | 0.63 / 23% / 33% / 52% / 35% | 0.68 / 4% / 0% / 0% / 3% | 0.69 / 2% / 0% / 0% / 1% |
| B-VIX | 0.85 / 16% / 31% / 88% / 46% | 0.81 / 5% / 33% / 17% / 2% | 0.66 / 23% / 35% / 39% / 26% | 0.79 / 4% / nan% / 0% / 0% | 0.77 / 2% / 0% / 0% / 0% |
| B-YB | 0.64 / 16% / 39% / 39% / 16% | 0.56 / 5% / 17% / 17% / 5% | 0.55 / 23% / 30% / 30% / 23% | 0.48 / 4% / 0% / 0% / 4% | 0.49 / 2% / 0% / 0% / 2% |
| O | - | - | - | 0.69 / 4% / 0% / 0% / 1% | 0.76 / 2% / 33% / 25% / 1% |
| B-IM | - | - | - | 0.83 / 4% / nan% / 0% / 0% | 0.69 / 2% / nan% / 0% / 0% |
| F | - | - | - | 0.65 / 4% / 0% / 0% / 1% | 0.71 / 2% / 33% / 25% / 1% |

## Calibration (Y1, deciles of p_hat: mean p_hat -> observed rate, n)

- P: 1%->0% (111); 2%->2% (111); 2%->5% (111); 3%->2% (111); 4%->2% (111); 6%->9% (110); 8%->6% (111); 11%->9% (111); 18%->20% (111); 47%->36% (111)
- O: 0%->0% (46); 1%->2% (45); 1%->0% (45); 2%->0% (46); 2%->4% (45); 3%->2% (45); 5%->2% (46); 8%->2% (45); 12%->7% (45); 27%->11% (46)
- F: 0%->0% (46); 1%->2% (45); 1%->0% (45); 1%->0% (46); 2%->7% (45); 3%->0% (45); 5%->2% (46); 7%->4% (45); 12%->7% (45); 27%->9% (46)

## What carries it (Y1): standardised coefficients of the fit on all sample days; drop-one-feature change in OOS AUC

**P** (OOS AUC 0.807)

| feature | coef (std) | AUC change if dropped |
|---|---:|---:|
| lvix | +0.71 | -0.021 |
| lrange | +0.53 | +0.001 |
| vts | +0.26 | -0.004 |
| fomc | +0.16 | -0.001 |
| dvix | -0.11 | +0.001 |
| dow_tue | -0.09 | +0.003 |
| lrv20 | -0.09 | +0.000 |
| dow_mon | -0.09 | +0.003 |
| gap | +0.08 | +0.001 |
| lrv5 | -0.07 | +0.004 |
| cpinfp | +0.06 | +0.009 |
| opex | -0.06 | +0.001 |
| dow_wed | -0.05 | +0.002 |
| dow_thu | +0.02 | -0.000 |

**O** (OOS AUC 0.743)

| feature | coef (std) | AUC change if dropped |
|---|---:|---:|
| lvix | +1.09 | -0.019 |
| lim | +1.04 | -0.012 |
| dow_tue | -0.61 | +0.002 |
| gshort | +0.48 | +0.009 |
| lrv20 | -0.48 | -0.009 |
| dow_wed | -0.42 | -0.029 |
| dow_mon | -0.28 | -0.003 |
| lrv5 | -0.25 | +0.001 |
| cpinfp | -0.23 | +0.025 |
| fdist | -0.23 | -0.018 |
| dvix | -0.22 | +0.011 |
| lrange | -0.18 | +0.046 |
| fomc | +0.17 | +0.005 |
| gap | -0.14 | +0.001 |
| dow_thu | -0.07 | +0.014 |
| livr | +0.04 | +0.006 |
| opex | -0.03 | -0.002 |
| vts | +0.02 | -0.025 |

**F** (OOS AUC 0.711)

| feature | coef (std) | AUC change if dropped |
|---|---:|---:|
| lvix | +1.20 | -0.013 |
| lim | +0.90 | -0.013 |
| dow_tue | -0.63 | +0.000 |
| gshort | +0.48 | -0.006 |
| dow_wed | -0.43 | -0.038 |
| lrv20 | -0.40 | -0.004 |
| dow_mon | -0.36 | -0.001 |
| lrv5 | -0.31 | -0.004 |
| cpinfp | -0.24 | +0.021 |
| gap | -0.23 | +0.006 |
| fdist | -0.23 | -0.023 |
| dvix | -0.22 | +0.006 |
| lrange | -0.16 | +0.051 |
| fomc | +0.15 | +0.000 |
| livr | +0.14 | -0.013 |
| mv30 | -0.10 | +0.034 |
| dow_thu | -0.08 | +0.037 |
| opex | -0.04 | -0.005 |
| vts | +0.04 | -0.040 |
| rvr30 | +0.03 | -0.006 |

Model P on Model O's OOS days (2023-24, n 454): AUC 0.701, base rate 3.1%.

Data QA: on the 683 days with 1-minute bars, Y1 from the bars and from the EOD open/close agree on 99.9% of days; median |EOD open / 09:30 bar open - 1| = 0.0 bp.
