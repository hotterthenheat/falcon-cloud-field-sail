# EDGE-K DEV results (specs/PREREG.md @ a0e1dc6)

Sessions with results: 516; signals: S1 450, S2 1201.

## S1 (EDGE-T H1-k0.30 opening drive, RT exits)

| picker | traded / picked / signals | skipped at fill | abstain | exp net [95%] | no fee | $ per $ risked | hit | P&L $ | premium $ p10/p25/p50/p75/p90 | med delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| K chooser (abstains if max ER <= 0) | 207 / 228 / 450 | 21 | 222 | -1.5% [-9.3%, +6.8%] | -1.1% | -6.2% | +41% | -15,531 | 138/200/464/1790/2508 | 0.70 |
| K-forced (argmax ER always) | 386 / 446 / 450 | 60 | 4 | +1.7% [-5.7%, +10.2%] | +2.1% | -4.1% | +40% | -28,914 | 150/218/490/2008/5305 | 0.76 |
| K-root (no XSP, forced) | 384 / 445 / 450 | 61 | 5 | +1.9% [-5.8%, +10.4%] | +2.2% | -4.1% | +40% | -29,102 | 149/218/490/2028/5539 | 0.76 |
| A registered 0.35-delta | 402 / 448 / 450 | 46 | 2 | +2.0% [-6.7%, +12.2%] | +2.9% | +0.8% | +41% | +1,464 | 61/82/154/730/1108 | 0.35 |
| B at-the-money | 396 / 445 / 450 | 49 | 5 | +2.7% [-4.3%, +10.4%] | +3.3% | +2.4% | +43% | +7,725 | 102/135/540/1260/1870 | 0.50 |
| C cheapest two-sided | 333 / 445 / 450 | 112 | 5 | -11.3% [-22.7%, +1.9%] | -5.5% | -17.4% | +37% | -4,082 | 11/13/18/65/126 | 0.07 |
| D Compass style (ITM 4) | 383 / 441 / 450 | 58 | 9 | +0.7% [-6.9%, +8.6%] | +0.9% | +0.7% | +39% | +3,977 | 222/315/482/2500/2996 | 0.82 |

Per-signal value (every signal; abstain or skipped fill = 0):

| picker | mean per signal [95%] | total P&L $ |
|---|---:|---:|
| K | -0.68% [-4.10%, +2.82%] | -15,531 |
| Kf | +1.45% [-4.83%, +8.41%] | -28,914 |
| A | +1.76% [-6.01%, +10.71%] | +1,464 |
| B | +2.40% [-3.59%, +8.38%] | +7,725 |
| C | -8.40% [-17.06%, +0.78%] | -4,082 |
| D | +0.58% [-5.71%, +7.21%] | +3,977 |

Paired, same signals both traded: K-forced minus X (net return per trade):

| vs | n pairs | mean diff [95%] | same contract |
|---|---:|---:|---:|
| A | 357 | +0.87% [-6.92%, +8.61%] | +3% |
| B | 354 | +0.01% [-4.32%, +4.88%] | +10% |
| C | 289 | +16.31% [+7.05%, +25.53%] | +0% |
| D | 351 | +1.90% [-1.77%, +5.29%] | +27% |
| Kr | 384 | +0.02% [-0.29%, +0.26%] | +99% |

Abstention: K-forced on the signals K abstains on: n 179, +5.4% [-6.7%, +18.3%], $ -13,383; on the signals K trades: n 207, -1.5% [-9.3%, +6.8%].
- A on K-abstain signals: n 195, +6.7%; on K-trade signals: n 207, -2.5%
- B on K-abstain signals: n 184, +6.3%; on K-trade signals: n 212, -0.4%
- D on K-abstain signals: n 188, +4.5%; on K-trade signals: n 195, -3.0%

Mini: SPXW signals 217, with an XSP board/candidates 197; K-forced picks XSP on 5 of 215; K (traded) on XSP 0 of 116.
- K-forced vs K-root (the mini effect, pairs where both traded): n 384, +0.02% [-0.29%, +0.26%]
- K pick premium (board ask x 100) $: p5 100, p25 176, p50 418, p75 1,550, p95 4,793; |delta| p25/p50/p75 0.57/0.72/0.84; share > $1,000: +38%
- Kf pick premium (board ask x 100) $: p5 109, p25 195, p50 465, p75 1,927, p95 9,145; |delta| p25/p50/p75 0.62/0.77/0.90; share > $1,000: +41%

| by | K n | K exp | Kf n | Kf exp | A n | A exp | D n | D exp |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| year 2020 | 1 | -38.3% | 10 | -32.3% | 10 | -21.9% | 9 | -25.8% |
| year 2022 | 25 | +11.6% | 62 | +8.0% | 60 | -5.9% | 65 | +7.8% |
| year 2023 | 109 | -6.7% | 181 | -0.7% | 187 | -1.1% | 176 | -2.4% |
| year 2024 | 72 | +2.3% | 133 | +4.5% | 145 | +10.8% | 133 | +3.1% |
| root QQQ | 63 | +4.5% | 125 | +2.6% | 125 | -5.1% | 125 | +2.7% |
| root SPXW | 108 | -5.0% | 186 | +0.7% | 192 | +2.6% | 179 | +1.1% |
| root SPY | 36 | -1.2% | 75 | +2.6% | 85 | +10.9% | 79 | -3.4% |

Model calibration (every distinct fetched pick, n 2425; corr(ER, realised) +0.073):

| ER decile | n | mean ER | realised [95%] |
|---:|---:|---:|---:|
| 0 | 243 | -25.1% | -19.9% [-32.6%, -5.6%] |
| 1 | 242 | -14.8% | -6.7% [-16.2%, +3.5%] |
| 2 | 243 | -9.1% | +4.0% [-9.9%, +22.1%] |
| 3 | 242 | -6.2% | +4.0% [-9.8%, +21.5%] |
| 4 | 243 | -4.3% | +2.1% [-7.2%, +11.6%] |
| 5 | 242 | -2.9% | +10.9% [-0.8%, +23.7%] |
| 6 | 242 | -1.7% | +0.4% [-7.4%, +8.9%] |
| 7 | 243 | -0.5% | +1.4% [-8.7%, +12.1%] |
| 8 | 242 | +0.9% | -2.5% [-11.1%, +6.6%] |
| 9 | 243 | +3.4% | -3.1% [-12.1%, +7.3%] |
- K exits: stop 120, trail 78, flat 9
- A exits: stop 237, trail 165

N1 random contract (3 per signal, 437 signals, 2,000 draws): null mean -0.7%, p95 +1.6%; K-forced +1.8% beats +96%; K -1.5% beats +28%; null FDR +0.0%
N2 shuffled side (kappa = 0 chooser, side by coin, 200 draws; mean 93 trades/draw): null mean +1.5%, p95 +8.0%; K beats +20%; null FDR +1.0%
PBO (CSCV, 16 blocks, 6 pickers): 0.76; K Sharpe/trade -0.030, DSR at N = 642: 0.000

## S2 (EDGE E1-z0.5 momentum into the close, X2 exits)

| picker | traded / picked / signals | skipped at fill | abstain | exp net [95%] | no fee | $ per $ risked | hit | P&L $ | premium $ p10/p25/p50/p75/p90 | med delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| K chooser (abstains if max ER <= 0) | 46 / 46 / 1201 | 0 | 1155 | -6.8% [-18.4%, +5.3%] | -6.2% | -6.4% | +39% | -1,309 | 86/192/405/670/805 | 0.68 |
| K-forced (argmax ER always) | 1200 / 1200 / 1201 | 0 | 1 | -5.9% [-8.7%, -2.9%] | -5.0% | -3.2% | +35% | -85,992 | 57/140/1070/1673/5829 | 0.96 |
| K-root (no XSP, forced) | 1200 / 1200 / 1201 | 0 | 1 | -5.7% [-8.5%, -2.6%] | -4.8% | -3.0% | +36% | -88,674 | 57/140/1070/1675/11544 | 0.96 |
| A registered 0.35-delta | 793 / 793 / 1201 | 0 | 408 | -6.0% [-11.2%, -0.4%] | -3.2% | -4.3% | +40% | -4,516 | 20/28/49/195/330 | 0.36 |
| B at-the-money | 1200 / 1200 / 1201 | 0 | 1 | -10.0% [-13.9%, -5.8%] | -7.2% | -7.5% | +39% | -16,021 | 21/37/59/201/490 | 0.50 |
| C cheapest two-sided | 1178 / 1200 / 1201 | 22 | 1 | -73.9% [-75.3%, -72.2%] | -48.0% | -51.7% | +2% | -9,361 | 2/2/2/10/10 | 0.03 |
| D Compass style (ITM 4) | 1131 / 1131 / 1201 | 0 | 70 | -5.5% [-9.0%, -1.8%] | -4.9% | -4.3% | +40% | -31,911 | 67/149/390/700/2030 | 0.90 |

Per-signal value (every signal; abstain or skipped fill = 0):

| picker | mean per signal [95%] | total P&L $ |
|---|---:|---:|
| K | -0.26% [-0.72%, +0.17%] | -1,309 |
| Kf | -5.86% [-8.59%, -2.75%] | -85,992 |
| A | -3.98% [-7.57%, -0.44%] | -4,516 |
| B | -9.98% [-13.92%, -5.78%] | -16,021 |
| C | -72.47% [-74.03%, -70.78%] | -9,361 |
| D | -5.22% [-8.50%, -1.65%] | -31,911 |

Paired, same signals both traded: K-forced minus X (net return per trade):

| vs | n pairs | mean diff [95%] | same contract |
|---|---:|---:|---:|
| A | 793 | +1.78% [-2.54%, +6.06%] | +4% |
| B | 1200 | +4.12% [+0.96%, +7.19%] | +16% |
| C | 1178 | +67.81% [+64.94%, +70.67%] | +1% |
| D | 1131 | +0.96% [-0.72%, +2.65%] | +38% |
| Kr | 1200 | -0.19% [-0.33%, -0.08%] | +98% |

Abstention: K-forced on the signals K abstains on: n 1154, -5.8% [-8.6%, -2.8%], $ -84,683; on the signals K trades: n 46, -6.8% [-18.4%, +5.3%].
- A on K-abstain signals: n 754, -5.7%; on K-trade signals: n 39, -11.8%
- B on K-abstain signals: n 1154, -9.9%; on K-trade signals: n 46, -11.3%
- D on K-abstain signals: n 1085, -5.2%; on K-trade signals: n 46, -13.6%

Mini: SPXW signals 320, with an XSP board/candidates 316; K-forced picks XSP on 27 of 320; K (traded) on XSP 0 of 34.
- K-forced vs K-root (the mini effect, pairs where both traded): n 1200, -0.19% [-0.33%, -0.08%]
- K pick premium (board ask x 100) $: p5 66, p25 156, p50 355, p75 598, p95 805; |delta| p25/p50/p75 0.54/0.68/0.79; share > $1,000: +2%
- Kf pick premium (board ask x 100) $: p5 32, p25 130, p50 1,050, p75 1,676, p95 14,083; |delta| p25/p50/p75 0.82/0.96/0.98; share > $1,000: +50%

| by | K n | K exp | Kf n | Kf exp | A n | A exp | D n | D exp |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| year 2020 | 0 | n/a | 55 | -10.9% | 25 | -11.4% | 39 | -8.9% |
| year 2022 | 2 | -27.1% | 170 | -8.1% | 134 | -13.1% | 166 | -9.0% |
| year 2023 | 19 | -15.6% | 523 | -5.6% | 342 | -7.9% | 495 | -5.1% |
| year 2024 | 25 | +1.5% | 452 | -4.7% | 292 | -0.1% | 431 | -4.4% |
| root IWM | 0 | n/a | 257 | -9.3% | 59 | -15.2% | 203 | -9.3% |
| root QQQ | 5 | +0.8% | 308 | -5.0% | 216 | -10.8% | 302 | -6.1% |
| root SPXW | 34 | -8.9% | 320 | -5.5% | 279 | -1.6% | 313 | -4.0% |
| root SPY | 7 | -2.1% | 315 | -4.3% | 239 | -4.6% | 313 | -4.1% |

Model calibration (every distinct fetched pick, n 6836; corr(ER, realised) +0.604):

| ER decile | n | mean ER | realised [95%] |
|---:|---:|---:|---:|
| 0 | 684 | -90.1% | -86.7% [-87.2%, -86.2%] |
| 1 | 684 | -71.7% | -66.9% [-69.7%, -63.7%] |
| 2 | 683 | -44.5% | -35.8% [-41.0%, -29.7%] |
| 3 | 684 | -23.4% | -11.1% [-17.2%, -5.0%] |
| 4 | 683 | -14.5% | -7.2% [-13.0%, -1.1%] |
| 5 | 684 | -9.0% | -8.3% [-12.4%, -4.0%] |
| 6 | 683 | -5.7% | -5.4% [-9.2%, -1.4%] |
| 7 | 684 | -3.6% | -5.8% [-8.9%, -2.9%] |
| 8 | 683 | -2.2% | -3.8% [-5.8%, -1.4%] |
| 9 | 684 | -0.8% | -3.0% [-6.1%, +0.5%] |
- K exits: trail 26, stop 16, time 4
- A exits: trail 468, stop 315, time 10

N1 random contract (3 per signal, 1199 signals, 2,000 draws): null mean -25.5%, p95 -24.1%; K-forced -5.8% beats +100%; K -6.8% beats +100%; null FDR +0.0%
N2 shuffled side (kappa = 0 chooser, side by coin, 200 draws; mean 28 trades/draw): null mean +6.7%, p95 +19.1%; K beats +4%; null FDR +3.5%
PBO (CSCV, 16 blocks, 6 pickers): 0.28; K Sharpe/trade -0.172, DSR at N = 642: 0.000

Board coverage: outermost stored side strike still two-sided on +22% of signals (S1 +48%, S2 +12%).
Skip reasons: insane 325, no_fill 22
