# Baselines (Phase 1, DEV) — what "no edge" looks like for long premium on these contracts

Pre-registered in `specs/STRATEGY_SPEC.md` §14 and the ledger before this run; references, not candidates; nothing was tuned on them. Executable simulator (`engine/execution.py`): decision at a 1-minute bar close; buy at the ask, sell at the bid, never the mid; displayed size; fees $0.65/contract/side (SPXW $1.15). Main tables: fill model **L0c** = the NBBO at the bar close moved against us by the measured mean 2-second drift (+0.17% of mid on buys, +0.05% on sells; PREREG A1); the latency table adds L0 (no latency), L60 (60 s) and exact **L2** (1-second NBBO 2 s after the decision) where it was run. Sessions: 64 DEV eval sessions (20240301..20240531), blocks ['A'], roots ['IWM', 'QQQ', 'SPXW', 'SPY']. DSR trial count 904 (ledger).

Contract: |delta| nearest 0.40 in [0.30, 0.50] of the bucket's representative expiration(s), spread ≤ 8% of mid. XT30 = hold 30 minutes (or the 15:55 flat); X3S = sell at the first completed 5m MID close below the contract's own 5m EMA9, or when the MID falls to 70% of the entry fill.


## Exit XT30: all roots and buckets pooled

| baseline | n | expectancy net | 95% CI (session bootstrap) | gross | mid-to-mid | win | payoff | median | $/trade net | Sharpe/day | maxDD $ | DSR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BL1 buy-and-hold grid | 26918 | -2.2% | [-2.5, -1.8] | -1.7% | -0.3% | 36% | 1.18 | -1.6% | -21.4 | -1.49 | -575656 | 0.00 |
| BL2 random entries | 4982 | -2.0% | [-2.7, -1.2] | -1.4% | -0.1% | 37% | 1.20 | -1.4% | -18.1 | -0.60 | -90273 | 0.00 |
| BL3 underlying-only EMA | 2196 | -0.8% | [-3.0, +1.9] | -0.2% | +1.1% | 41% | 1.28 | -1.2% | -8.9 | -0.07 | -25103 | 0.00 |
| BL4 option-only EMA | 2991 | -1.2% | [-3.0, +1.4] | -0.7% | +0.5% | 38% | 1.31 | -1.2% | -13.9 | -0.14 | -53611 | 0.00 |
| BL5 combined | 2855 | -1.3% | [-3.2, +1.4] | -0.8% | +0.4% | 38% | 1.29 | -1.2% | -13.4 | -0.14 | -50510 | 0.00 |
| BL6 plain directional | 2131 | -0.4% | [-2.7, +2.4] | +0.2% | +1.5% | 42% | 1.30 | -1.0% | -8.5 | -0.04 | -25886 | 0.00 |

### XT30 by DTE bucket (net expectancy [95% CI], n)

| baseline | 0 | 1-7 | 8-30 | 31-90 | 91-200 |
|---|---|---|---|---|---|
| BL1 | -5.8% [-7,-4] n=4530 | -2.4% [-3,-2] n=5596 | -1.4% [-2,-1] n=5591 | -1.1% [-1,-1] n=5606 | -1.0% [-1,-1] n=5595 |
| BL2 | -5.4% [-9,-1] n=883 | -2.1% [-3,-1] n=1013 | -1.2% [-2,-1] n=1020 | -0.9% [-1,-1] n=1024 | -0.8% [-1,-1] n=1042 |
| BL3 | +0.1% [-9,+10] n=380 | -1.4% [-4,+1] n=454 | -0.9% [-2,+0] n=454 | -0.8% [-1,-0] n=454 | -0.8% [-1,-0] n=454 |
| BL4 | -1.5% [-11,+12] n=394 | -1.7% [-3,+0] n=757 | -1.0% [-2,+0] n=595 | -0.8% [-1,-0] n=620 | -1.0% [-1,-1] n=625 |
| BL5 | -1.6% [-11,+12] n=389 | -2.1% [-4,-0] n=746 | -0.9% [-2,+0] n=569 | -0.7% [-1,-0] n=584 | -0.9% [-1,-1] n=567 |
| BL6 | +1.6% [-8,+12] n=367 | -1.0% [-3,+1] n=441 | -0.7% [-2,+1] n=441 | -0.7% [-1,-0] n=441 | -0.7% [-1,-0] n=441 |

### XT30 by root and by block (net expectancy, n)

| baseline | IWM | QQQ | SPXW | SPY | block A |
|---|---|---|---|---|---|
| BL1 | -3.0% n=6157 | -1.9% n=6917 | -2.0% n=6955 | -2.1% n=6889 | -2.2% n=26918 |
| BL2 | -2.3% n=1164 | -0.5% n=1263 | -2.6% n=1279 | -2.5% n=1276 | -2.0% n=4982 |
| BL3 | -3.0% n=469 | -1.9% n=568 | +1.4% n=585 | -0.1% n=574 | -0.8% n=2196 |
| BL4 | -2.8% n=650 | -1.5% n=770 | -0.2% n=811 | -0.6% n=760 | -1.2% n=2991 |
| BL5 | -2.8% n=617 | -1.6% n=743 | -0.3% n=769 | -0.7% n=726 | -1.3% n=2855 |
| BL6 | -3.0% n=454 | -0.7% n=548 | +1.3% n=570 | +0.4% n=559 | -0.4% n=2131 |

## Exit X3S: all roots and buckets pooled

| baseline | n | expectancy net | 95% CI (session bootstrap) | gross | mid-to-mid | win | payoff | median | $/trade net | Sharpe/day | maxDD $ | DSR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BL1 buy-and-hold grid | 26918 | -1.5% | [-2.5, +0.3] | -0.9% | +0.4% | 22% | 2.40 | -1.8% | -17.6 | -0.26 | -493873 | 0.00 |
| BL2 random entries | 5987 | -1.0% | [-2.5, +1.6] | -0.4% | +0.9% | 20% | 2.95 | -1.7% | -12.8 | -0.12 | -81658 | 0.00 |
| BL3 underlying-only EMA | 2787 | -0.4% | [-4.2, +5.9] | +0.2% | +1.6% | 19% | 3.94 | -2.7% | -9.2 | -0.02 | -37797 | 0.00 |
| BL4 option-only EMA | 3604 | -0.2% | [-3.1, +5.2] | +0.3% | +1.6% | 21% | 3.59 | -2.5% | -11.4 | -0.01 | -57816 | 0.00 |
| BL5 combined | 3413 | -0.1% | [-3.3, +5.4] | +0.4% | +1.7% | 22% | 3.54 | -2.5% | -10.3 | -0.01 | -56269 | 0.00 |
| BL6 plain directional | 2682 | -0.1% | [-4.0, +6.4] | +0.5% | +2.0% | 20% | 3.88 | -2.6% | -7.6 | -0.01 | -36911 | 0.00 |

### X3S by DTE bucket (net expectancy [95% CI], n)

| baseline | 0 | 1-7 | 8-30 | 31-90 | 91-200 |
|---|---|---|---|---|---|
| BL1 | -3.0% [-7,+5] n=4530 | -1.7% [-3,-0] n=5596 | -1.2% [-2,-1] n=5591 | -1.0% [-1,-1] n=5606 | -0.9% [-1,-1] n=5595 |
| BL2 | -1.3% [-7,+9] n=1102 | -1.6% [-3,+1] n=1246 | -0.7% [-1,+0] n=1218 | -0.7% [-1,-0] n=1198 | -0.8% [-1,-1] n=1223 |
| BL3 | +1.0% [-13,+23] n=486 | -0.5% [-4,+5] n=582 | -0.9% [-3,+2] n=576 | -0.8% [-2,+0] n=573 | -0.8% [-1,-0] n=570 |
| BL4 | +4.2% [-12,+34] n=440 | -1.0% [-3,+2] n=928 | -0.7% [-2,+1] n=721 | -0.6% [-1,+0] n=751 | -0.8% [-1,-0] n=764 |
| BL5 | +4.4% [-12,+34] n=436 | -1.1% [-4,+2] n=908 | -0.6% [-2,+2] n=686 | -0.5% [-1,+0] n=695 | -0.7% [-1,-0] n=688 |
| BL6 | +2.4% [-13,+28] n=462 | -0.4% [-4,+5] n=561 | -0.8% [-3,+2] n=556 | -0.7% [-2,+0] n=553 | -0.7% [-1,-0] n=550 |

### X3S by root and by block (net expectancy, n)

| baseline | IWM | QQQ | SPXW | SPY | block A |
|---|---|---|---|---|---|
| BL1 | -2.9% n=6157 | -0.9% n=6917 | -1.1% n=6955 | -1.2% n=6889 | -1.5% n=26918 |
| BL2 | -2.4% n=1400 | -0.4% n=1508 | -0.4% n=1558 | -1.0% n=1521 | -1.0% n=5987 |
| BL3 | -0.9% n=596 | -0.1% n=755 | +1.5% n=724 | -2.4% n=712 | -0.4% n=2787 |
| BL4 | -2.5% n=782 | +0.1% n=934 | +0.6% n=983 | +0.7% n=905 | -0.2% n=3604 |
| BL5 | -2.4% n=742 | +0.1% n=900 | +0.6% n=922 | +0.9% n=849 | -0.1% n=3413 |
| BL6 | -1.0% n=580 | +0.2% n=708 | +1.9% n=702 | -1.8% n=692 | -0.1% n=2682 |

## Costs at entry (all filled baseline trades, XT30)

| root | bucket | n | median spread (% of mid) | median premium $ | median fee (% of premium, one side) | rejected at arrival |
|---|---|---|---|---|---|---|
| IWM | 0 | 910 | 4.08% | 35 | 1.86% | 16 |
| IWM | 1-7 | 2163 | 1.74% | 129 | 0.50% | 2 |
| IWM | 31-90 | 2145 | 0.73% | 435 | 0.15% | 0 |
| IWM | 8-30 | 2134 | 0.91% | 250 | 0.26% | 0 |
| IWM | 91-200 | 2163 | 0.77% | 685 | 0.09% | 0 |
| QQQ | 0 | 1973 | 1.83% | 69 | 0.94% | 1 |
| QQQ | 1-7 | 2312 | 0.90% | 247 | 0.26% | 0 |
| QQQ | 31-90 | 2158 | 0.43% | 804 | 0.08% | 0 |
| QQQ | 8-30 | 2205 | 0.59% | 455 | 0.14% | 0 |
| QQQ | 91-200 | 2165 | 0.42% | 1362 | 0.05% | 0 |
| SPXW | 0 | 2132 | 2.40% | 540 | 0.21% | 0 |
| SPXW | 1-7 | 2262 | 1.21% | 2130 | 0.05% | 0 |
| SPXW | 31-90 | 2215 | 0.65% | 6670 | 0.02% | 0 |
| SPXW | 8-30 | 2152 | 0.79% | 3980 | 0.03% | 0 |
| SPXW | 91-200 | 2221 | 0.61% | 11770 | 0.01% | 0 |
| SPY | 0 | 1929 | 1.68% | 64 | 1.02% | 2 |
| SPY | 1-7 | 2275 | 0.80% | 207 | 0.31% | 0 |
| SPY | 31-90 | 2217 | 0.37% | 677 | 0.10% | 0 |
| SPY | 8-30 | 2183 | 0.51% | 398 | 0.16% | 0 |
| SPY | 91-200 | 2182 | 0.34% | 1199 | 0.05% | 0 |

## Latency: net expectancy by fill model (pooled; L0 = bar-end NBBO, no latency, optimistic; L0c = L0 + measured 2 s drift, the screening model; L60 = NBBO 60 s after the bar end; L2 = exact 1-second NBBO 2 s after, where run)

| baseline | exit | L0 | L0c | L60 |
|---|---|---|---|---|
| BL1 | XT30 | -2.0% (n=26941) | -2.2% (n=26918) | -2.0% (n=26883) |
| BL1 | X3S | -1.3% (n=26941) | -1.5% (n=26918) | -1.0% (n=26883) |
| BL2 | XT30 | -1.8% (n=4982) | -2.0% (n=4982) | -1.8% (n=4969) |
| BL2 | X3S | -0.8% (n=5988) | -1.0% (n=5987) | -0.6% (n=5974) |
| BL3 | XT30 | -0.6% (n=2196) | -0.8% (n=2196) | -0.4% (n=2188) |
| BL3 | X3S | -0.2% (n=2787) | -0.4% (n=2787) | +1.2% (n=2774) |
| BL4 | XT30 | -1.0% (n=2991) | -1.2% (n=2991) | -0.8% (n=2987) |
| BL4 | X3S | +0.1% (n=3604) | -0.2% (n=3604) | +0.7% (n=3598) |
| BL5 | XT30 | -1.1% (n=2855) | -1.3% (n=2855) | -0.9% (n=2851) |
| BL5 | X3S | +0.1% (n=3413) | -0.1% (n=3413) | +0.7% (n=3407) |
| BL6 | XT30 | -0.2% (n=2131) | -0.4% (n=2131) | +0.1% (n=2123) |
| BL6 | X3S | +0.1% (n=2682) | -0.1% (n=2682) | +1.5% (n=2670) |

### Exact L2 vs L0c on the same decisions (roots ['IWM', 'QQQ', 'SPXW', 'SPY']; paired by session, decision, contract, exit)

| baseline | exit | n pairs | L0c | L2 | L2 − L0c (95% CI, session bootstrap) |
|---|---|---|---|---|---|
| BL2 | XT30 | 4973 | -2.0% | -1.8% | +0.24pt [+0.20, +0.29] |
| BL2 | X3S | 5978 | -1.0% | -0.8% | +0.17pt [+0.11, +0.23] |
| BL3 | XT30 | 2188 | -0.8% | -0.7% | +0.10pt [-0.04, +0.25] |
| BL3 | X3S | 2777 | -0.4% | -0.3% | +0.10pt [-0.06, +0.25] |
| BL4 | XT30 | 2976 | -1.2% | -1.2% | +0.06pt [-0.03, +0.16] |
| BL4 | X3S | 3584 | -0.2% | -0.2% | +0.08pt [-0.01, +0.17] |
| BL5 | XT30 | 2842 | -1.3% | -1.3% | +0.06pt [-0.04, +0.16] |
| BL5 | X3S | 3398 | -0.2% | -0.1% | +0.08pt [-0.01, +0.18] |
| BL6 | XT30 | 2129 | -0.3% | -0.3% | +0.06pt [-0.11, +0.22] |
| BL6 | X3S | 2678 | -0.1% | -0.0% | +0.09pt [-0.08, +0.24] |

## Exit reasons (L0c)

    exit_reason    below9  expiry_flat  flat  stop30   time
    baseline exit                                          
    BL1      X3S    26193           12   103     610      0
             XT30       0            0     0       0  26918
    BL2      X3S     5883            4    14      86      0
             XT30       0            0     0       0   4982
    BL3      X3S     2652            2    19     114      0
             XT30       0            0     0       0   2196
    BL4      X3S     3442            3    28     131      0
             XT30       0            0     0       0   2991
    BL5      X3S     3252            3    27     131      0
             XT30       0            0     0       0   2855
    BL6      X3S     2553            2    18     109      0
             XT30       0            0     0       0   2131

## Median minutes held (L0c)

    exit       X3S  XT30
    baseline            
    BL1        5.0  30.0
    BL2        5.0  30.0
    BL3       15.0  30.0
    BL4       20.0  30.0
    BL5       20.0  30.0
    BL6       15.0  30.0

## Reading

These are reference numbers, not findings about any strategy. What they establish for Phase 2 (DEV block A only:
one regime, March–May 2024; block B 2022 not yet fetched):

1. **Holding long premium costs money unconditionally.** The buy-and-hold grid (BL1: the 0.40-delta call and put,
   bought every 30 minutes, held 30 minutes) loses −2.2%/trade net [−2.5, −1.8] at L0c, from −5.8% on 0DTE to
   −1.0% on 91–200 DTE. Its mid-to-mid return is −0.3%: the loss is almost all spread + fees + theta, and it is
   largest where spreads are widest (0DTE: median spread 1.7% SPY, 1.8% QQQ, 2.4% SPXW, 4.1% IWM of mid) and fees
   are a large share of a small premium (≈1% a side on SPY/QQQ 0DTE, 1.9% on IWM 0DTE).
2. **Random timing loses about the same** (BL2 −2.0% [−2.7, −1.2] at XT30). Any entry rule has to beat roughly
   −1 to −2.5% per trade before it is worth anything; a positive mid-to-mid number is not enough.
3. **None of the EMA references is distinguishable from zero, and all are ≤ 0 net pooled at the 30-minute hold**:
   underlying-only EMA cross (BL3) −0.8% [−3.0, +1.9]; option-only EMA cross (BL4) −1.2% [−3.0, +1.4]; combined
   (BL5) −1.3% [−3.2, +1.4]; plain directional (BL6) −0.4% [−2.7, +2.4]. They beat BL1/BL2 by ~1 point mid-to-mid
   (directional timing has some gross value: BL6 mid +1.5%), which the spread takes back. BL4 ≈ BL5: adding the
   underlying's EMA state to the option-chart cross changes almost nothing (the two are nearly the same event —
   STRATEGY_SPEC §4.1 point 3); the option chart's incremental value is exactly what PREREG Stage 1 measures.
4. **The exit alone reshapes the distribution.** With X3S (sell on the first 5m close below the contract's own
   EMA9) every baseline — including random entries — moves to a ~20% win rate, payoff 2.4–3.9 and a mean closer to
   zero (BL2 −1.0%, BL4 −0.2%, BL6 −0.1%), with CIs that are wide and include zero. That is the mechanical effect of
   an EMA-trailing exit on the same series (STRATEGY_SPEC §4.1 point 4), not entry skill: Phase 2 must compare every
   EMA entry with BL2 under the same exit.
5. **0DTE is where the variance is**: X3S 0DTE results range +1% to +4% with CIs of roughly ±12 to ±30 points
   (n ≈ 440–1100). Nothing there is significant; it is the bucket where false positives are most likely.
6. **Latency.** Exact 1-second fills 2 s after the decision (L2; run for BL2–BL6 on all four roots, 23,000+ paired
   trades) are 0.06–0.24 points *better* than the L0c screening model on the same decisions (paired table above): L0c
   is mildly conservative, as intended, and never flatters a result. L60 (a 60-second delay) is close to L0 for the
   30-minute hold but 0.8–1.6 points better than L0c for the X3S exit (premium partly rebounds after a
   sell-on-weakness trigger) — a reminder that exit-latency assumptions move EMA-exit results by about a point.
7. **Pass bar context.** Every baseline has DSR 0.00 at the ledger's 904 trials and fails the protocol bar; any
   Phase-2 candidate must clear CI > 0 net *and* beat BL2/shuffled nulls at the 95th percentile.

