# EMA-MTF — final assessment (Phase 2, worker EMA-2, 2026-11-06)

## Verdict: **C — no demonstrated edge**

Under the pre-registered plan (`specs/PREREG.md`, frozen 7d1c06d, amendments A1–A4), no long-premium strategy built
from EMAs on the option contract's own chart clears the DEV bar. This holds alone or combined with higher
timeframes, the underlying, VWAP, positioning or flow, under any of the ten exits, at executable prices (ask in, bid
out, displayed size, fees, measured 2-second drift). Nothing reached VALIDATION, so VALIDATION was not looked at.
LOCKED was never fetched or opened.

This verdict covers the implementation tested: SPY/QQQ/IWM/SPXW, 0–200 DTE, |delta| ≈ 0.40, intraday, 5-minute
entry trigger, two 3-month DEV regimes. It does **not** show that the concept is impossible (see "What remains
untested").

Everything below is traceable to trade logs in `v2data/ema/results/` (not in git: size). Each figure is regenerated
by the commands in §6. Every test and variant, failures included, has a ledger line (research-v2-ledger.md, worker
EMA) and is listed in `reports/FAILED_EXPERIMENTS.md`.

## 1. Data used

* **DEV block A**: 2024-03-01..05-31, 64 sessions, low-vol uptrend.
* **DEV block B**: 2022-03-01..05-31, 64 sessions, bear / high-vol. Fetched in this phase: 504 root-sessions, 0
  failures, 504 MB.
* Roots: SPY, QQQ, IWM, SPXW. Buckets: 0, 1–7, 8–30, 31–90, 91–200 DTE.
* The panel holds each contract's own 1-minute NBBO-mid chart over its stored life (warm-up from 62 sessions
  before), SIP trade bars, the full positioning book every 30 minutes, the morning OI reports, and UW flow (block A
  only).
* **VALIDATION** (the pre-declared fallback 2025-07-01..09-30, chosen by bytes: A2 item 12) is being fetched with the
  same code under the 09:15–16:05 ET request guard. Its outcomes were never computed. LOCKED: not fetched.

## 2. Stage 1 — does the option's own chart carry information? (`reports/STAGE1.md`)

* 309,035 decision events with an executable outcome: every 5-minute close 09:45–15:00 × root × bucket × right, the tradable contract nearest
  |delta| 0.40.
* Outcome: the executable net return over 30 minutes (15 and 60 secondary).
* Effects are measured incrementally, holding the underlying's own same-timeframe EMA state fixed.

| family | tests | passed | strongest result |
|---|---|---|---|
| S1A option-chart features (8 features × 1/5/15/30/60m) | 40 | **0** | 1m L50 (premium above its own 1-minute EMA50): δ = +1.11 pp [+0.11, +2.03], nominal p 0.017, Holm 0.68. **Explained by the reprice control**: the same feature computed on a Black–Scholes counterfactual (the underlying's path at a frozen IV, no option-specific information) gives +1.13 pp; holding it fixed, δ* = +0.49 [−0.41, +1.35]. So: underlying/theta mechanics, not option information. |
| S1B timeframe incremental information (joint OLS) | 5 | **0** | No option-chart state on any timeframe adds to the underlying's states (all β ≤ +0.30 pp/unit, every Holm p = 1.0). States correlate 0.4–0.76 across adjacent timeframes: five aligned timeframes are not five confirmations. |
| S1C confirmations on the 5m MID E9/E21 cross | 14 | **0** | VWAP side: δ = +3.79 pp [+0.38, +7.31], p 0.016, Holm 0.22; positive in both blocks (A +6.4, B +0.7). It fails the family test, but it is the one lead worth a fresh pre-registration. GEX < 0: −2.9 pp. UW ask-side flow: +1.6 pp [−3.6, +6.6]. P/C OI: −1.7 pp. |

TRADE (charting-app print chart, dense subset only), tested as its own family: 0 of 40 pass.

**Null calibration.**
* **The pre-registered permutation null FAILED**: FWER 100% over 200 runs. It was diagnosed with evidence (post-hoc,
  labelled):
  1. Permuting a feature within a session leaks same-day future information. Shifting a feature 30 minutes forward
     gives δ up to +17 pp; shifting it backward gives ≈ 0, like the real features.
  2. The pre-registered strata pool the 2022 and 2024 blocks, so slow regime features (30m/60m EMA200) pick up a
     between-block confound.
* **The pre-registered synthetic zero-drift null also failed**: 10 of 14 seeds have a Holm-passing feature (≤ 1 of 20 is allowed). The run stopped at 14 of the 20 registered seeds to free memory; no remaining seed can change the outcome. The cause is the generator: Black–Scholes at one vol per session, with the real U-shaped intraday vol profile, is not a martingale at the decision times. Synthetic premiums drift +0.9% per 30 min at 09:45 and −0.6% midday, and premium-state features track that drift. A compass-v2-style generator therefore cannot calibrate a screen of premium-chart features; a variance-clock generator would.
* A corrected design ("S1A-T": strata split by block and half-hour, leak-free cross-session null) is calibrated:
  FWER 3.0% (6 of 200 leak-free runs). On it the real data also give **0 of 40**. On the flawed synthetic generator it also over-detects (6 of 9 seeds), for the generator reason above.
* A miscalibrated screen can only create false passes, so the Stage-1 conclusion stands: no option-chart feature has
  incremental, executable value.

## 3. Stage 2 — the strategies (`reports/STAGE2.md`)

* Stage 2-S was not built: PREREG §5.2 builds it only from Stage-1 passers, and there were none.
* Stage 2-C ran all 23 one-factor-at-a-time variants. Centre: B cross on the 5m MID chart, exit 3. The variants
  change the entry (A–H), the MTF model (A–F) or the exit (1–10).
* Plus an underlying-only reference: 9,269–24,144 trades a variant (MTF A/F: 513/477).

**All 23 are negative net. None has a CI above 0.**

| variant | n | net / trade [95% CI] | gross | mid-to-mid | win | PF | L60 | beats random-time null / random-side null |
|---|---|---|---|---|---|---|---|---|
| centre B 5m + exit 3 | 9,269 | −1.30% [−2.9, +0.8] | −0.9% | +0.5% | 26% | 0.69 | −0.69% | 100% / 95% |
| entry F (B + VWAP + und. EMA21) | 7,745 | **−0.92%** [−2.8, +1.6] | −0.5% | +1.0% | 27% | 0.78 | −0.24% | 100% / 100% |
| exit 4 (9/20 cross) | 7,379 | **−0.92%** [−3.4, +2.1] | −0.5% | +1.0% | 28% | 0.86 | −0.68% | 100% / 100% |
| exit 10 (combination) | 9,486 | −1.17% [−2.7, +0.9] | −0.8% | +0.6% | 25% | 0.70 | −0.58% | 100% / 90% |
| MTF D (weighted 1–60m) | 1,814 | −1.02% [−2.3, +0.5] | −0.8% | +0.4% | 27% | 0.62 | −0.79% | 95% / 95% |
| worst: MTF A (sequential 5→15) | 513 | −3.65% [−5.5, −1.8] | −3.3% | −1.9% | 27% | 0.65 | −3.01% | 0% / 0% |
| reference: underlying-only cross, exit 3 | 7,322 | −1.60% [−3.5, +0.8] | −1.1% | +0.4% | 23% | 0.64 | −0.83% | — |

What this says:
1. **Timing has some value, costs take more.**
   * The better EMA entries beat random entries with the same exit at the 95–100th percentile, and their
     mid-to-mid return is positive (+0.4 to +1.0%).
   * But the round trip costs ≈ 1.3% of premium in spread (≈ $24 a trade) plus fees, so net is −0.9% to −2.1%.
   * The baselines (Phase 1) showed the same.
2. **The option chart adds nothing over the underlying.**
   * The option-chart cross (centre, −1.30%) and the underlying-only cross (−1.60%) are within each other's CIs.
     Stage 1 measured this directly.
   * Exit 6 (HTF loss) is mathematically identical to exit 3 for a no-MTF entry (STAGE2 note), and the logs agree
     trade for trade.
3. **MTF filters do not help.** Each cuts trades by 70–95% without raising net expectancy above the centre's CI.
   Requiring a fresh 15m trigger (MTF A) is the worst variant.
4. **Positioning (GEX, walls) hurts slightly** (entry G −2.0%). **Fixed-bracket exits are worst** (exit 8 −2.5%).
5. **Day type matters, but it is not known in advance.**
   * Trend-following exits make money on trend days and lose on flat days. Exit 4: trend +10.3% [+4.2, +18.8]
     (n = 2,224), flat −5.8%, high-vol −5.4%. The centre: trend +2.7%, flat −3.3%.
   * Day labels use the whole session's path (compass-v2 classify_session), so this is description, not a
     tradable filter.
6. **Regimes**: centre −0.8% (2024) / −1.8% (2022); entry F −0.2% / −1.6%. No variant is positive in both blocks
   with a CI above 0.
7. **By ticker / DTE / side** (full tables in STAGE2):
   * 0DTE is the only bucket with wide two-sided CIs (±10–15 pp), and none is positive at 95%.
   * 8–200 DTE are reliably negative (≈ −1%: spread + theta).
   * Puts did better than calls in the sample (centre −0.3% vs −2.3%). That is regime-dependent and inside the
     CIs.

## 4. Stage 3 — walk-forward, PBO, DSR, robustness (`reports/STAGE3.md`)

* **Walk-forward** (anchored, 1-session embargo; best train expectancy within the 23 variants):
  * The chosen variants were exit 8 → 2022-05, MTF B → 2024-03, MTF D → 2024-04, exit 4 → 2024-05.
  * Every fold's best training variant was already negative (−0.3% to −1.0%).
  * **OOS: n = 2,892, −2.21% [−4.8, +0.9] net**, win 26%, PF 0.67, net −$101k on 1-lot trades, return on premium
    deployed −1.8%, max DD −$118k, Sharpe/day annualised −2.5, Sortino −4.2, max losing streak 105, mean hold
    73 min (median 40).
* **PBO** 0.12. It is low because the family's ranking is stable (all negative), not because anything works.
* **DSR** 0.000 at N = 1,208 ledger trials.
* **§7 DEV bar: FAILED.** CI > 0, win/payoff, DSR, both blocks positive and ≥ 2 day types all fail. Only n ≥ 150 and
  PBO < 0.3 pass.
* **Sensitivity and ablation** were run as a diagnostic (amendment A4; there was no candidate) on entry F, MTF D and
  entry G: **none survives** the §6 rule (expectancy > 0 at +1 tick and at 60 s latency, and > 0 in ≥ 70% of parameter neighbours). Every look of all three variants is negative, and 0% of neighbours are positive.

**Sensitivity:**
* +1 tick slippage costs 0.5–0.8 pp.
* SPXW fee $0.65 / $1.65 moves results by ±0.01 pp.
* |delta| 0.30 / 0.50 moves them by ±0.1 pp.
* EMA lengths one step either side cost 0–1.5 pp, and none improves.
* Strict 2N warm-up changes nothing.
* The TRADE-chart trigger is no better: entry F −0.76% (n = 4,570) against −0.92% on MID.
* 60 s latency is 0.2–0.7 pp *better* than L0c: premium partly rebounds after a sell-on-weakness exit, as in Phase 1.

**Ablation** (paired, session-clustered):
* **VWAP** is the only leg that helps even marginally: removing it costs −0.33 pp [−0.8, +0.0]; removing both underlying legs costs −0.38 [−0.9, −0.0].
* **Option-chart vs underlying trigger**: replacing the option-chart trigger by the underlying's own cross (same legs) costs −0.21 pp [−1.6, +1.1], i.e. no measurable value from the option chart.
* **Timeframes**: removing any one from MTF D moves results by ≤ 0.17 pp, and removing the MTF filter entirely by −0.27 [−1.8, +1.7].
* **GEX**: removing the GEX leg *improves* entry G by +0.98 pp [−0.4, +3.4].

Full tables: STAGE3 §"Sensitivity and ablation"; look-level trade logs: `v2data/ema/results/stage3/robust/`.

## 5. What works, what does not, what is uncertain

* **Works (relatively, not absolutely)**:
  * EMA-cross entries time the premium better than random entries with the same exit (95–100th percentile of both
    nulls for the centre, F, exit 4 and exit 10).
  * VWAP-side confirmation is the strongest single confirmation (δ +3.8 pp, nominal).
  * Trend-following exits capture trend days.
  * None of this survives the spread: the edge over random entry (≈ +0.7–1.1 pp) is smaller than the round-trip cost
    (≈ 1.3% spread + fees at 0.40 delta).
* **Does not work**:
  * Option-chart EMA states and triggers as incremental information over the underlying (Stage 1, and the reprice
    control).
  * Stacking timeframes (S1B; MTF A–F).
  * GEX/wall filters.
  * RVOL, opening-range, PDH/PDL, premarket, BOS, P/C OI and ATM-IV confirmations.
  * Every exit (1–10) as a standalone fix.
* **Uncertain**:
  * 0DTE: the variance is too large to conclude either way, with CIs of ±10–15 pp per variant.
  * Regime coverage is two 3-month blocks (2022 bear, 2024 bull). The VALIDATION window was not used, because
    nothing qualified.
  * The VWAP-side lead and the trend-day asymmetry are hypotheses, not findings.

## 6. What remains untested (so "impossible" is not claimed) and what would settle it

1. **Cheaper execution**: limit/mid-peg entries instead of crossing the spread. Every result here pays the full
   spread, and mid-to-mid returns are positive for the better variants. This needs a passive-fill model (queue
   position) that the minute panel cannot support. The 100 ms store or live paper fills would.
2. **Predicting trend days in advance** (trend-following exits made +10% on trend days): a pre-registered day-type
   classifier from information known at 10:00 (gap, opening-range width, overnight futures, VIX term structure),
   tested on fresh DEV data.
3. **The VWAP-side lead**: a single pre-registered test of B 5m + VWAP side, with S1A-T strata and the leak-free
   null, on new DEV sessions (e.g. 2023-03..05 and 2023-10..12, outside LOCKED).
4. **Configurations outside the stored universe**:
   * other liquid single names;
   * LEAPs > 200 DTE and |delta| < 0.30 on 31+ DTE (not stored);
   * 0DTE × 60m × EMA200 (untestable: strikes are listed 9–19 sessions before expiry);
   * the TRADE chart outside 0–7 DTE (prints too sparse).
5. **Holding overnight** (the registered overnight variant is defined only for a candidate), **short premium /
   spreads** (out of scope: long premium only) and **other horizons**.
6. **Exact L2 fills** were never needed. In Phase 1, L2 was 0.06–0.24 pp *better* than L0c on 23,000 paired trades,
   far too little to change any sign here.

**Reproduce**, from `slayer/research/ema-mtf`:
```
python3 -m stage1.events --block {A,B}
python3 -m stage1.events --block {A,B} --patch-pcoi
python3 -m stage1.run {analyse,perm,synth}
python3 -m stage1.diag_perm
python3 -m stage1.diag_tod
python3 -m stage1.diag_tod_synth
python3 -m stage1.report
python3 -m stage2.run --family S2C --blocks A,B
python3 -m stage2.report
python3 -m stage3.wf --family S2C
python3 -m stage3.run_robust --variants S2C-entryF,S2C-mtfD,S2C-entryG
python3 -m stage3.report
python3 -m etests.run
```
