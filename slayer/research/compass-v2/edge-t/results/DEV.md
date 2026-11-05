# EDGE-T DEV results

Store: dev.json; root-sessions with a chain and bars: 1155; sessions: 397. Net = $0.65/contract/side; win = net > 0; 95% CI = session-clustered bootstrap. Ledger trials N = 608.

## H1 OPENING DRIVE

| variant | n | sessions | win | expectancy net [95% session CI] | no fee | median | payoff | shuffle: real beats (FDR) | synthetic flat (registered) / 5-min profile (A2): real beats (FDR, mean null n) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| H1-k0.30-d0.20 | 271 | 183 | 34% | -7.4% [-15.5, +2.3] | -5.5% | -36.5% | 1.39 | 85% (0.0%) | 49% (1%, n̄ 31) / 6% (1%, n̄ 245) |
| H1-k0.30-d0.35 | 269 | 186 | 36% | -6.6% [-13.6, +1.1] | -5.6% | -35.6% | 1.28 | 64% (0.0%) | 39% (1%, n̄ 31) / 8% (3%, n̄ 245) |
| H1-k0.60-d0.20 | 32 | 29 | 44% | +2.0% [-16.5, +23.7] | +3.1% | -34.8% | 1.41 | 62% (0.0%) | 64% (5%, n̄ 0) / 65% (1%, n̄ 35) |
| H1-k0.60-d0.35 | 31 | 29 | 42% | -2.2% [-20.8, +17.6] | -1.6% | -35.5% | 1.25 | 63% (0.5%) | 64% (6%, n̄ 0) / 44% (1%, n̄ 35) |

- H1-k0.30-d0.20: 300 triggers, 1 no contract, 28 skipped (fill quote not sane), 0 no 1-s data, 271 trades
- H1-k0.30-d0.35: 300 triggers, 1 no contract, 30 skipped (fill quote not sane), 0 no 1-s data, 269 trades
- H1-k0.60-d0.20: 35 triggers, 1 no contract, 2 skipped (fill quote not sane), 0 no 1-s data, 32 trades
- H1-k0.60-d0.35: 35 triggers, 1 no contract, 3 skipped (fill quote not sane), 0 no 1-s data, 31 trades


## H2 TREND DAY (RULES.md; Compass top score replaced by fixed delta)

| variant | n | sessions | win | expectancy net [95% session CI] | no fee | median | payoff | shuffle: real beats (FDR) | synthetic flat (registered) / 5-min profile (A2): real beats (FDR, mean null n) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| H2-d0.35 | 427 | 46 | 33% | -10.1% [-16.7, -3.2] | -8.9% | -36.6% | 1.26 | 96% (0.0%) | 6% (0%, n̄ 639) / 42% (0%, n̄ 564) |
| H2-d0.20 | 520 | 46 | 29% | -13.2% [-19.6, -6.0] | -10.8% | -37.6% | 1.34 | 94% (0.0%) | 3% (0%, n̄ 799) / 39% (0%, n̄ 718) |

- Sessions with >= 1 trigger mark: 46 (2020-03-04, 2020-03-06, 2020-03-09, 2020-03-13, 2020-03-16, 2020-03-18, 2020-03-20, 2020-03-23, 2020-03-25, 2020-03-27, 2020-03-30, 2020-04-03, 2020-04-06, 2020-04-08, 2020-04-13, 2022-01-24, 2022-02-11, 2022-02-23, 2022-03-02, 2022-03-07, 2022-03-09, 2022-04-22, 2022-04-26, 2022-05-23, 2022-05-25, 2022-05-27, 2022-10-03, 2022-10-04, 2022-10-07, 2022-10-10, 2022-10-13, 2022-10-14, 2022-10-21, 2022-10-26, 2023-01-06, 2023-01-18, 2023-01-20, 2023-01-23, 2023-02-09, 2023-03-13, 2023-03-16, 2023-10-06, 2024-04-15, 2024-05-23, 2024-09-06, 2024-12-20)
- H2-d0.35: 546 entry attempts, 62 no contract, 57 skipped (not sane), 427 trades; exits {'stop': 280, 'trail': 142, 'flat': 5}
- H2-d0.20: 705 entry attempts, 62 no contract, 123 skipped (not sane), 520 trades; exits {'stop': 361, 'trail': 154, 'flat': 5}

## H3 EXIT RULES (entries: H1-k0.30-d0.35 real side; same fills, 8 exit cells)

| variant | n | sessions | win | expectancy net [95% session CI] | no fee | median | payoff | shuffle: real beats (FDR) | synthetic flat (registered) / 5-min profile (A2): real beats (FDR, mean null n) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| H3-TR-off-sane | 269 | 186 | 36% | -6.6% [-13.6, +1.1] | -5.6% | -35.6% | 1.28 | 64% (0.0%) | 39% (1%, n̄ 31) / 8% (3%, n̄ 245) |
| H3-TR-off-raw | 269 | 186 | 36% | -6.3% [-13.4, +1.4] | -5.4% | -35.5% | 1.32 | 72% (0.0%) | 42% (1%, n̄ 31) / 10% (3%, n̄ 245) |
| H3-TR-rev-sane | 269 | 186 | 36% | -6.6% [-13.5, +1.3] | -5.6% | -35.5% | 1.30 | 59% (0.0%) | 39% (1%, n̄ 31) / 8% (4%, n̄ 245) |
| H3-TR-rev-raw | 269 | 186 | 35% | -6.3% [-13.3, +1.5] | -5.4% | -35.5% | 1.34 | 67% (0.0%) | 43% (1%, n̄ 31) / 9% (4%, n̄ 245) |
| H3-TP-off-sane | 269 | 186 | 38% | -5.2% [-11.3, +1.1] | -4.2% | -35.6% | 1.30 | 56% (0.0%) | 49% (1%, n̄ 31) / 15% (0%, n̄ 245) |
| H3-TP-off-raw | 269 | 186 | 38% | -4.9% [-11.0, +1.3] | -4.0% | -35.5% | 1.31 | 62% (0.0%) | 50% (1%, n̄ 31) / 19% (0%, n̄ 245) |
| H3-TP-rev-sane | 269 | 186 | 37% | -5.3% [-11.4, +0.9] | -4.4% | -35.5% | 1.31 | 52% (0.0%) | 48% (1%, n̄ 31) / 14% (0%, n̄ 245) |
| H3-TP-rev-raw | 269 | 186 | 37% | -5.1% [-11.1, +1.1] | -4.2% | -35.5% | 1.32 | 58% (0.0%) | 49% (1%, n̄ 31) / 17% (0%, n̄ 245) |

Paired difference vs the base cell H3-TR-off-sane (= H1-k0.30-d0.35), per trade, net:

| cell | n | mean diff [95% session CI] | trades changed | exits |
|---|---:|---:|---:|---|
| H3-TR-off-sane | 269 | +0.00% [+0.00, +0.00] | 0 | {'stop': 170, 'trail': 99} |
| H3-TR-off-raw | 269 | +0.28% [+0.03, +0.58] | 27 | {'stop': 170, 'trail': 99} |
| H3-TR-rev-sane | 269 | +0.00% [-0.61, +0.62] | 7 | {'stop': 164, 'trail': 98, 'reversal': 7} |
| H3-TR-rev-raw | 269 | +0.29% [-0.32, +0.94] | 34 | {'stop': 164, 'trail': 98, 'reversal': 7} |
| H3-TP-off-sane | 269 | +1.43% [-2.70, +5.06] | 100 | {'stop': 168, 'tp': 101} |
| H3-TP-off-raw | 269 | +1.63% [-2.54, +5.31] | 114 | {'stop': 168, 'tp': 101} |
| H3-TP-rev-sane | 269 | +1.25% [-2.95, +4.91] | 105 | {'stop': 163, 'tp': 100, 'reversal': 6} |
| H3-TP-rev-raw | 269 | +1.46% [-2.74, +5.16] | 119 | {'stop': 163, 'tp': 100, 'reversal': 6} |

- TP exits (H3-TP-off-sane): 101; the sane bid later reached >= +100% of fill on 64%, >= +150% on 57%, median later max +170% (the same trades under TR: +45.1% mean net vs TP's +48.9%)
- Reversal exits (H3-TR-rev-sane): 7; mean net -28.0% vs the same trades under the base -28.1%; later sane max >= fill +10% on 43%
- Raw vs sane (TR, no reversal): 28 of 269 trades exit at a different time; 14 raw stops fire earlier than the sane path (mean net raw -34.0% vs sane -38.0%); 0 of those decided 10:00:00-10:00:06 ET

## Trend-day dependence (descriptive; buckets use the day's outcome)

### H1-k0.30-d0.35

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 269 | 186 | 36% | -6.6% [-13.6, +1.3] | -11,936 |
| SPX |O→C| <0.5% | 152 | 101 | 30% | -14.9% [-22.8, -6.5] | -8,891 |
| SPX |O→C| 0.5-1.5% | 98 | 72 | 47% | +6.0% [-7.6, +19.3] | -3,513 |
| SPX |O→C| >1.5% | 19 | 13 | 32% | -4.7% [-31.4, +25.6] | +468 |
| first 15 min direction held | 169 | 113 | 45% | +0.4% [-8.6, +10.5] | -2,161 |
| first 15 min direction failed | 100 | 73 | 21% | -18.3% [-27.6, -8.2] | -9,775 |
| trade side = day direction | 169 | 118 | 44% | +1.2% [-8.2, +12.0] | -888 |
| trade side against day direction | 100 | 76 | 22% | -19.7% [-28.4, -9.4] | -11,048 |
| <0.5%, side with day | 81 | 55 | 31% | -15.9% [-25.4, -6.0] | -5,104 |
| <0.5%, side against day | 71 | 51 | 28% | -13.7% [-25.2, -0.1] | -3,786 |
| 0.5-1.5%, side with day | 76 | 54 | 58% | +17.4% [+1.5, +32.4] | +2,028 |
| 0.5-1.5%, side against day | 22 | 20 | 9% | -33.4% [-38.2, -26.8] | -5,542 |
| >1.5%, side with day | 12 | 9 | 50% | +14.4% [-25.4, +53.2] | +2,188 |
| >1.5%, side against day | 7 | 5 | 0% | -37.5% [-38.8, -36.1] | -1,720 |

### H1-k0.30-d0.20

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 271 | 183 | 34% | -7.4% [-15.2, +2.7] | -5,758 |
| SPX |O→C| <0.5% | 153 | 99 | 29% | -16.8% [-24.3, -7.4] | -4,388 |
| SPX |O→C| 0.5-1.5% | 98 | 70 | 40% | +5.4% [-11.0, +24.7] | -1,242 |
| SPX |O→C| >1.5% | 20 | 14 | 45% | +1.4% [-23.1, +37.8] | -128 |
| first 15 min direction held | 171 | 110 | 40% | -1.0% [-12.5, +12.2] | -1,247 |
| first 15 min direction failed | 100 | 73 | 24% | -18.4% [-28.2, -5.2] | -4,511 |
| trade side = day direction | 170 | 114 | 39% | -1.5% [-13.1, +11.6] | -1,162 |
| trade side against day direction | 101 | 77 | 26% | -17.4% [-27.3, -4.4] | -4,596 |
| <0.5%, side with day | 83 | 53 | 28% | -21.3% [-29.3, -13.3] | -2,860 |
| <0.5%, side against day | 70 | 52 | 30% | -11.4% [-25.3, +6.0] | -1,528 |
| 0.5-1.5%, side with day | 73 | 51 | 49% | +18.5% [-4.7, +43.9] | +1,191 |
| 0.5-1.5%, side against day | 25 | 21 | 12% | -32.9% [-39.2, -25.2] | -2,434 |
| >1.5%, side with day | 14 | 10 | 50% | +11.9% [-22.6, +60.7] | +507 |
| >1.5%, side against day | 6 | 4 | 33% | -23.1% [-41.2, -9.7] | -635 |

### H1-k0.60-d0.35

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 31 | 29 | 42% | -2.2% [-20.3, +17.3] | -785 |
| SPX |O→C| <0.5% | 10 | 9 | 30% | -17.1% [-38.0, +3.9] | -615 |
| SPX |O→C| 0.5-1.5% | 17 | 16 | 47% | +3.0% [-24.1, +33.5] | -269 |
| SPX |O→C| >1.5% | 4 | 4 | 50% | +13.0% [-37.3, +71.2] | +99 |
| first 15 min direction held | 24 | 22 | 54% | +8.5% [-13.6, +32.0] | +1,394 |
| first 15 min direction failed | 7 | 7 | 0% | -38.8% [-40.9, -37.3] | -2,179 |
| trade side = day direction | 25 | 23 | 52% | +6.6% [-14.6, +28.9] | +932 |
| trade side against day direction | 6 | 6 | 0% | -39.0% [-41.4, -37.0] | -1,718 |
| <0.5%, side with day | 7 | 6 | 43% | -7.0% [-31.4, +21.6] | -61 |
| <0.5%, side against day | 3 | 3 | 0% | -40.7% [-44.0, -37.8] | -554 |
| 0.5-1.5%, side with day | 15 | 14 | 53% | +8.4% [-21.2, +40.0] | +363 |
| 0.5-1.5%, side against day | 2 | 2 | 0% | -37.4% [-39.1, -35.8] | -633 |
| >1.5%, side with day | 3 | 3 | 67% | +29.6% [-37.8, +106.8] | +630 |
| >1.5%, side against day | 1 | 1 | 0% | -36.9% [-36.9, -36.9] | -531 |

### H1-k0.60-d0.20

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 32 | 29 | 44% | +2.0% [-17.6, +23.9] | +453 |
| SPX |O→C| <0.5% | 12 | 11 | 42% | +1.5% [-25.4, +31.2] | +349 |
| SPX |O→C| 0.5-1.5% | 16 | 14 | 44% | +3.5% [-24.4, +39.3] | +336 |
| SPX |O→C| >1.5% | 4 | 4 | 50% | -2.8% [-40.7, +35.4] | -232 |
| first 15 min direction held | 24 | 21 | 54% | +9.5% [-13.0, +33.7] | +1,026 |
| first 15 min direction failed | 8 | 8 | 12% | -20.5% [-41.2, +19.5] | -572 |
| trade side = day direction | 24 | 22 | 54% | +9.4% [-13.1, +33.9] | +827 |
| trade side against day direction | 8 | 8 | 12% | -20.2% [-41.0, +19.6] | -373 |
| <0.5%, side with day | 8 | 7 | 50% | +3.5% [-24.6, +35.5] | +157 |
| <0.5%, side against day | 4 | 4 | 25% | -2.3% [-43.2, +76.1] | +193 |
| 0.5-1.5%, side with day | 13 | 12 | 54% | +12.8% [-20.1, +51.2] | +611 |
| 0.5-1.5%, side against day | 3 | 3 | 0% | -36.9% [-37.7, -36.0] | -275 |
| >1.5%, side with day | 3 | 3 | 67% | +10.2% [-39.8, +49.7] | +59 |
| >1.5%, side against day | 1 | 1 | 0% | -41.6% [-41.6, -41.6] | -291 |

### H2-d0.35

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 427 | 46 | 33% | -10.1% [-16.5, -3.2] | -18,908 |
| SPX |O→C| <0.5% | 3 | 1 | 0% | -37.6% [-37.6, -37.6] | -275 |
| SPX |O→C| 0.5-1.5% | 102 | 15 | 17% | -26.2% [-37.5, -15.4] | -9,293 |
| SPX |O→C| >1.5% | 322 | 30 | 38% | -4.7% [-12.8, +3.4] | -9,341 |
| first 15 min direction held | 259 | 29 | 32% | -8.5% [-17.5, +1.1] | -10,123 |
| first 15 min direction failed | 163 | 15 | 34% | -12.1% [-22.2, -2.1] | -6,166 |
| trade side = day direction | 402 | 41 | 33% | -9.4% [-15.8, -2.4] | -14,820 |
| trade side against day direction | 25 | 6 | 28% | -21.2% [-53.2, -0.3] | -4,088 |
| <0.5%, side with day | 3 | 1 | 0% | -37.6% [-37.6, -37.6] | -275 |
| <0.5%, side against day | 0 | | | | |
| 0.5-1.5%, side with day | 81 | 12 | 12% | -28.2% [-38.1, -15.8] | -7,521 |
| 0.5-1.5%, side against day | 21 | 4 | 33% | -18.3% [-57.1, +5.1] | -1,771 |
| >1.5%, side with day | 318 | 28 | 39% | -4.3% [-11.8, +4.5] | -7,023 |
| >1.5%, side against day | 4 | 2 | 0% | -36.3% [-36.5, -35.6] | -2,317 |

### H2-d0.20

| split | n | sessions | win | exp net | sum $ net (1 lot) |
|---|---:|---:|---:|---:|---:|
| all | 520 | 46 | 29% | -13.2% [-19.4, -6.0] | -12,706 |
| SPX |O→C| <0.5% | 3 | 1 | 0% | -38.8% [-38.8, -38.8] | -130 |
| SPX |O→C| 0.5-1.5% | 120 | 15 | 15% | -26.9% [-38.1, -14.8] | -2,460 |
| SPX |O→C| >1.5% | 397 | 30 | 33% | -8.8% [-16.5, -0.2] | -10,116 |
| first 15 min direction held | 338 | 29 | 28% | -12.9% [-21.2, -3.4] | -7,780 |
| first 15 min direction failed | 177 | 15 | 31% | -13.0% [-22.8, -2.5] | -2,426 |
| trade side = day direction | 497 | 41 | 29% | -13.1% [-19.6, -6.1] | -11,007 |
| trade side against day direction | 23 | 6 | 26% | -13.7% [-53.2, +3.6] | -1,699 |
| <0.5%, side with day | 3 | 1 | 0% | -38.8% [-38.8, -38.8] | -130 |
| <0.5%, side against day | 0 | | | | |
| 0.5-1.5%, side with day | 101 | 12 | 12% | -30.0% [-39.9, -18.0] | -2,441 |
| 0.5-1.5%, side against day | 19 | 4 | 32% | -9.9% [-58.2, +7.0] | -19 |
| >1.5%, side with day | 393 | 28 | 34% | -8.6% [-16.0, +0.4] | -8,436 |
| >1.5%, side against day | 4 | 2 | 0% | -31.5% [-39.5, -28.8] | -1,680 |

### H3 cells by SPX day bucket (exp net)

| cell | <0.5% | 0.5-1.5% | >1.5% | held | failed |
|---|---:|---:|---:|---:|---:|
| H3-TR-off-sane | -14.9% (n152) | +6.0% (n98) | -4.7% (n19) | +0.4% (n169) | -18.3% (n100) |
| H3-TR-off-raw | -14.9% (n152) | +6.6% (n98) | -4.3% (n19) | +0.8% (n169) | -18.3% (n100) |
| H3-TR-rev-sane | -14.9% (n152) | +5.4% (n98) | -2.0% (n19) | +0.1% (n169) | -17.8% (n100) |
| H3-TR-rev-raw | -14.8% (n152) | +6.1% (n98) | -1.6% (n19) | +0.5% (n169) | -17.8% (n100) |
| H3-TP-off-sane | -11.6% (n152) | +5.0% (n98) | -5.6% (n19) | +2.1% (n169) | -17.5% (n100) |
| H3-TP-off-raw | -11.6% (n152) | +5.4% (n98) | -5.6% (n19) | +2.4% (n169) | -17.4% (n100) |
| H3-TP-rev-sane | -11.6% (n152) | +4.2% (n98) | -4.4% (n19) | +1.7% (n169) | -17.2% (n100) |
| H3-TP-rev-raw | -11.5% (n152) | +4.7% (n98) | -4.4% (n19) | +2.0% (n169) | -17.2% (n100) |

## By root and year (net)

- H1-k0.30-d0.20: roots QQQ n84 -3.9% [-15.7,+7.9]; SPXW n126 -10.7% [-19.8,-1.0]; SPY n61 -5.5% [-20.7,+12.3] | years 2020 n5 -15.4% [-38.5,+7.8]; 2022 n37 -7.0% [-22.0,+13.1]; 2023 n131 -13.6% [-22.2,-4.6]; 2024 n98 +1.1% [-15.9,+21.5]
- H1-k0.30-d0.35: roots QQQ n82 -3.9% [-14.5,+6.5]; SPXW n128 -10.1% [-17.7,-2.7]; SPY n59 -2.7% [-16.1,+12.3] | years 2020 n8 -18.4% [-31.1,-3.9]; 2022 n35 -8.9% [-23.4,+9.2]; 2023 n128 -11.9% [-19.2,-3.6]; 2024 n98 +2.1% [-12.0,+17.5]
- H1-k0.60-d0.20: roots QQQ n8 +2.4% [-19.8,+25.7]; SPXW n22 -0.3% [-20.8,+25.4]; SPY n2 +25.1% [-37.7,+87.9] | years 2020 n2 -36.3% [-36.3,-36.3]; 2022 n2 +4.1% [-41.6,+49.7]; 2023 n16 -6.4% [-26.6,+15.0]; 2024 n12 +19.2% [-18.9,+58.9]
- H1-k0.60-d0.35: roots QQQ n8 -1.0% [-21.4,+19.6]; SPXW n22 -8.3% [-26.4,+12.9]; SPY n1 +120.8% [+120.8,+120.8] | years 2020 n2 -12.2% [-37.6,+13.2]; 2022 n3 +11.6% [-36.9,+106.8]; 2023 n15 -15.6% [-31.3,+1.4]; 2024 n11 +14.1% [-23.3,+50.2]
- H2-d0.35: roots QQQ n107 -11.5% [-20.2,-2.8]; SPXW n175 -8.1% [-15.0,-0.2]; SPY n145 -11.5% [-18.0,-4.7] | years 2020 n87 -16.6% [-27.3,-6.5]; 2022 n208 -6.9% [-17.1,+3.7]; 2023 n87 -9.8% [-27.0,+1.5]; 2024 n45 -12.9% [-33.7,+30.2]
- H2-d0.20: roots QQQ n140 -16.6% [-23.2,-8.8]; SPXW n193 -10.6% [-19.3,-0.1]; SPY n187 -13.2% [-18.9,-6.3] | years 2020 n86 -20.1% [-31.8,-7.6]; 2022 n287 -11.5% [-20.5,-1.3]; 2023 n89 -12.0% [-28.5,-1.0]; 2024 n58 -13.0% [-32.1,+35.8]
- H3-TR-off-sane: roots QQQ n82 -3.9% [-14.5,+6.5]; SPXW n128 -10.1% [-17.7,-2.7]; SPY n59 -2.7% [-16.1,+12.3] | years 2020 n8 -18.4% [-31.1,-3.9]; 2022 n35 -8.9% [-23.4,+9.2]; 2023 n128 -11.9% [-19.2,-3.6]; 2024 n98 +2.1% [-12.0,+17.5]
- H3-TR-off-raw: roots QQQ n82 -3.8% [-14.3,+6.5]; SPXW n128 -9.7% [-17.5,-2.1]; SPY n59 -2.4% [-15.9,+12.9] | years 2020 n8 -15.7% [-30.3,-1.1]; 2022 n35 -7.9% [-22.5,+11.0]; 2023 n128 -12.0% [-19.3,-4.0]; 2024 n98 +2.5% [-11.7,+17.8]
- H3-TR-rev-sane: roots QQQ n82 -4.2% [-14.5,+5.9]; SPXW n128 -10.0% [-17.7,-2.6]; SPY n59 -2.3% [-16.0,+12.8] | years 2020 n8 -18.4% [-31.1,-3.9]; 2022 n35 -8.7% [-22.8,+7.9]; 2023 n128 -11.9% [-19.3,-3.6]; 2024 n98 +2.1% [-12.0,+17.5]
- H3-TR-rev-raw: roots QQQ n82 -4.1% [-14.5,+6.2]; SPXW n128 -9.6% [-17.4,-2.0]; SPY n59 -2.1% [-15.7,+13.2] | years 2020 n8 -15.7% [-30.3,-1.1]; 2022 n35 -7.8% [-22.1,+9.2]; 2023 n128 -12.0% [-19.3,-4.0]; 2024 n98 +2.5% [-11.7,+17.8]
- H3-TP-off-sane: roots QQQ n82 -3.4% [-12.1,+5.2]; SPXW n128 -6.5% [-13.9,+0.8]; SPY n59 -4.7% [-15.1,+5.7] | years 2020 n8 -4.5% [-26.4,+20.9]; 2022 n35 -5.5% [-19.1,+10.2]; 2023 n128 -5.6% [-14.1,+2.9]; 2024 n98 -4.4% [-13.9,+6.4]
- H3-TP-off-raw: roots QQQ n82 -3.4% [-12.2,+5.2]; SPXW n128 -6.1% [-13.5,+1.2]; SPY n59 -4.5% [-14.8,+5.9] | years 2020 n8 -2.0% [-25.4,+23.5]; 2022 n35 -4.7% [-18.4,+10.8]; 2023 n128 -5.7% [-14.1,+2.9]; 2024 n98 -4.3% [-13.6,+6.5]
- H3-TP-rev-sane: roots QQQ n82 -4.2% [-12.9,+4.5]; SPXW n128 -6.5% [-13.8,+0.8]; SPY n59 -4.4% [-15.0,+6.2] | years 2020 n8 -4.5% [-26.4,+20.9]; 2022 n35 -6.8% [-19.7,+8.4]; 2023 n128 -5.7% [-14.2,+2.9]; 2024 n98 -4.4% [-13.9,+6.4]
- H3-TP-rev-raw: roots QQQ n82 -4.3% [-12.9,+4.5]; SPXW n128 -6.1% [-13.4,+1.2]; SPY n59 -4.2% [-14.7,+6.2] | years 2020 n8 -2.0% [-25.4,+23.5]; 2022 n35 -6.0% [-19.3,+9.5]; 2023 n128 -5.7% [-14.2,+2.8]; 2024 n98 -4.3% [-13.6,+6.5]

## Overfit control

- PBO (CSCV, 16 blocks) H1 (4 configs, 195 sessions): 0.72
- PBO (CSCV, 16 blocks) H2 (2 configs, 46 sessions): 1.00
- PBO (CSCV, 16 blocks) H3 (8 configs, 186 sessions): 0.81
- DSR at N = 608 trials (var of per-trade Sharpe across EDGE-T variants 0.0039):
  - H1-k0.30-d0.20: Sharpe/trade -0.132, DSR 0.000
  - H1-k0.30-d0.35: Sharpe/trade -0.135, DSR 0.000
  - H1-k0.60-d0.20: Sharpe/trade +0.038, DSR 0.186
  - H1-k0.60-d0.35: Sharpe/trade -0.045, DSR 0.101
  - H2-d0.35: Sharpe/trade -0.202, DSR 0.000
  - H2-d0.20: Sharpe/trade -0.232, DSR 0.000
  - H3-TR-off-sane: Sharpe/trade -0.135, DSR 0.000
  - H3-TR-off-raw: Sharpe/trade -0.129, DSR 0.000
  - H3-TR-rev-sane: Sharpe/trade -0.135, DSR 0.000
  - H3-TR-rev-raw: Sharpe/trade -0.129, DSR 0.000
  - H3-TP-off-sane: Sharpe/trade -0.122, DSR 0.000
  - H3-TP-off-raw: Sharpe/trade -0.118, DSR 0.000
  - H3-TP-rev-sane: Sharpe/trade -0.127, DSR 0.000
  - H3-TP-rev-raw: Sharpe/trade -0.123, DSR 0.000

## Protocol bar (DEV gate to VALIDATION: n >= 150, CI > 0, beats >= 95% of both nulls)

- H1-k0.30-d0.20: FAIL (n 271, CI low -15.5%, shuffle 85%, synthetic 6%)
- H1-k0.30-d0.35: FAIL (n 269, CI low -13.6%, shuffle 64%, synthetic 8%)
- H1-k0.60-d0.20: FAIL (n 32, CI low -16.5%, shuffle 62%, synthetic 64%)
- H1-k0.60-d0.35: FAIL (n 31, CI low -20.8%, shuffle 63%, synthetic 44%)
- H2-d0.35: FAIL (n 427, CI low -16.7%, shuffle 96%, synthetic 6%)
- H2-d0.20: FAIL (n 520, CI low -19.6%, shuffle 94%, synthetic 3%)
- H3-TR-off-sane: FAIL (n 269, CI low -13.6%, shuffle 64%, synthetic 8%)
- H3-TR-off-raw: FAIL (n 269, CI low -13.4%, shuffle 72%, synthetic 10%)
- H3-TR-rev-sane: FAIL (n 269, CI low -13.5%, shuffle 59%, synthetic 8%)
- H3-TR-rev-raw: FAIL (n 269, CI low -13.3%, shuffle 67%, synthetic 9%)
- H3-TP-off-sane: FAIL (n 269, CI low -11.3%, shuffle 56%, synthetic 15%)
- H3-TP-off-raw: FAIL (n 269, CI low -11.0%, shuffle 62%, synthetic 19%)
- H3-TP-rev-sane: FAIL (n 269, CI low -11.4%, shuffle 52%, synthetic 14%)
- H3-TP-rev-raw: FAIL (n 269, CI low -11.1%, shuffle 58%, synthetic 17%)
