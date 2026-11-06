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
