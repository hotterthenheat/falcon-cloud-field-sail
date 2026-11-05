# EDGE-T log (2026-11-05): the 2026-11-05 trend-down day's lessons, tested on DEV

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10–14. Long calls/puts only. Pre-registration `specs/PREREG.md` @ 0bfff6f
(H1 4 variants, H2 2, H3 7, registered before any fetch); amendment A1 @ 4b72f5e (the 09:30 chain board is empty, so a
09:31 trigger executes at 09:32; found in a 2-session smoke test, before the DEV run); amendment A2 @ 72ef423 (a second
synthetic null at the real 5-minute vol profile, because the registered flat-vol generator makes ~31 H1 trades where
reality makes ~270; added during the run, before any full-DEV null). Global ledger: 13 variants + 3 spec lines.
Full tables: `results/DEV.md`. Look-ahead test: `results/lookahead.txt`. Nulls: `results/synthetic_null.json`.

## Data and code
- `ht.py`: triggers, contract pick, 1-second paths, RULES.md fill/exit engine, H3 cells. Uses EDGE's 0DTE chain boards and
  1-minute bars (`v2data/edge/`, read only). It never opens a locked day: `day_bars` refuses one, and the two DEV days whose
  prior session is locked (2022-10-03, 2024-09-03) get no H1 σ_prev. Own cache `v2data/edge-t/q1s/`: change-only int-cent
  1-second NBBO from the decision to 15:51. 180 MB of the 1 GB budget; disk free 3.3 → 2.9 GB.
- Execution (= RULES.md): fill = the ask in force at t + 2 s, only if sane (spread ≤ 12% of mid, both sizes ≥ 2), else
  skip. Exits are checked every 10 s on sane quotes: stop at −35%; once the peak bid reaches +50%, trail 25% off the
  peak; flat at 15:50. The exit fill is the bid in force at decision + 2 s. Fee $0.65 per side, reported both ways.
- **DEV coverage: 430 of 656 DEV sessions** (1,155 root-sessions with chain + bars). The sessions run in a seeded random
  order (seed 20261105), and the run was stopped at 12:07 ET on the lead's instruction. The live terminal snapshots had
  gone ~2 min stale while my 1-request-in-flight fetch ran, so I stopped it (PID 8167, killed by me), with about 2,430
  requests made, one at a time. The 430 sessions are therefore a random subsample, cut on time, not on outcome. H3b (the
  H3 cells on EDGE's E3 entries) was registered as optional and was not run (no terminal before 16:05 ET), so it counts 0.

## Results (DEV, 430 sessions, net of fee, session-clustered 95% CI)
| variant | n | win | exp net [95%] | no fee | payoff | shuffle beats | synthetic beats flat / profile (FDR) |
|---|---:|---:|---:|---:|---:|---:|---:|
| H1-k0.30-d0.20 | 271 | 34% | −7.4% [−15.5, +2.3] | −5.5% | 1.39 | 85% | 49% / 6% (1%/1%) |
| H1-k0.30-d0.35 | 269 | 36% | −6.6% [−13.6, +1.1] | −5.6% | 1.28 | 64% | 39% / 8% (1%/3%) |
| H1-k0.60-d0.20 | 32 | 44% | +2.0% [−16.5, +23.7] | +3.1% | 1.41 | 62% | 64%* / 65% |
| H1-k0.60-d0.35 | 31 | 42% | −2.2% [−20.8, +17.6] | −1.6% | 1.25 | 63% | 64%* / 44% |
| H2-d0.35 (RULES.md) | 427 | 33% | −10.1% [−16.7, −3.2] | −8.9% | 1.26 | 96% | 6% / 42% (0%) |
| H2-d0.20 | 520 | 29% | −13.2% [−19.6, −6.0] | −10.8% | 1.34 | 94% | 3% / 39% (0%) |
| H3-TR-off-sane (= H1-k0.30-d0.35) | 269 | 36% | −6.6% [−13.6, +1.1] | −5.6% | 1.28 | 64% | 39% / 8% |
| H3-TR-off-raw | 269 | 36% | −6.3% [−13.4, +1.4] | −5.4% | 1.32 | 72% | 42% / 10% |
| H3-TR-rev-sane | 269 | 36% | −6.6% [−13.5, +1.3] | −5.6% | 1.30 | 59% | 39% / 8% |
| H3-TR-rev-raw | 269 | 35% | −6.3% [−13.3, +1.5] | −5.4% | 1.34 | 67% | 43% / 9% |
| H3-TP-off-sane | 269 | 38% | −5.2% [−11.3, +1.1] | −4.2% | 1.30 | 56% | 49% / 15% |
| H3-TP-off-raw | 269 | 38% | −4.9% [−11.0, +1.3] | −4.0% | 1.31 | 62% | 50% / 19% |
| H3-TP-rev-sane | 269 | 37% | −5.3% [−11.4, +0.9] | −4.4% | 1.31 | 52% | 48% / 14% |
| H3-TP-rev-raw | 269 | 37% | −5.1% [−11.1, +1.1] | −4.2% | 1.32 | 58% | 49% / 17% |
\* The flat null trades about 0 times per run at k = 0.60, so it is not informative there. PBO (CSCV, 16 blocks): H1
0.72, H2 1.00 (2 configurations), H3 0.81. DSR at N = 608 ledger trials: ≤ 0.19 everywhere (0.000 for every variant
with a negative Sharpe). Shuffle-null FDR 0–0.5%; synthetic FDR 0–6%, ≤ 3% except the degenerate flat k = 0.60 cells.
Nothing passes the DEV bar. Nothing goes to VALIDATION, nothing is frozen, and LOCKED was not touched.

## Trend-day dependence (the key question)
- **H1, opening drive (k0.30-d0.35):** range days (|SPX O→C| < 0.5%) n152 −14.9% net; 0.5–1.5% days n98 +6.0%; > 1.5%
  days n19 −4.7%. First-15-minute direction held: n169 +0.4%; failed: n100 −18.3%. Drive side = the day's side: n169
  +1.2%; against it: n100 −19.7%. On a day of ≥ 0.5% where the drive side matched the day: n88 about +16%, $ +4.2k. The
  other trades lose $16.1k. **Yes: the reversal- and range-day losses eat the trend-day wins about 4 to 1, and even the
  "held" days only break even.**
- **H2, the live rule (d0.35):** 46 DEV sessions had a trigger. Only 12 of them made money. On days that closed > 1.5% from
  the open: n322 −4.7%. On days that pushed past 1.5% but closed 0.5–1.5% from the open: n102 −26.2%. The rule re-enters
  after every stop (median 7, max 31 trades per day), and the −35% stop is hit by ordinary 0DTE noise even on strong trend
  days: 2020-03-09 (−4.2% day), 2020-03-16 (−4.9%) and 2020-03-20 (−5.3%) all lost. **It loses even on the days it was
  built for.**
- **H3, exits:** take-profit vs trail: TP at 1.5× minus base +1.4% [−2.7, +5.1] per trade. The fixed 1.5× TP did not
  hurt on DEV. After a TP exit, 57% of contracts later showed a sane bid ≥ +150%, but the 25% trail gave those runs back
  anyway (TR on the same trades +45% vs TP +49%). The 5-minute 0.40% reversal exit fired on 7 of 269 index trades and
  made no difference (+0.0% [−0.6, +0.6]); on index ETFs the rule almost never fires, so the stock-put lesson cannot be
  tested on this entry set. Raw vs sane stops: raw +0.28% [+0.03, +0.58]. Raw was slightly *better*, see artefacts.

## Execution artefacts
- The 09:30:00 0DTE chain board has no valid quotes (SPY/QQQ always, SPXW on 1/3 of days); hence A1.
- 10% of H1 fills (28–30 of 300) are skipped because the quote at 09:32–09:35 + 2 s is not sane. Most of those are
  one-lot sizes, not wide spreads.
- Raw vs sane stops (28 of 269 trades differ; 14 raw stops fire earlier): most "insane" quotes are a 1-lot **ask** on a
  penny-wide market, which is harmless. The real blowouts look like the live XSP case: SPXW 2760P 2020-04-15 09:32:42,
  7.3/11.0 1×1 (40% wide); SPXW 4610P 2022-01-14 09:36:42, 5.3/9.7 (59% wide). There the raw stop fired, but the sale at
  bid + 2 s got a recovered bid (−19.6% / −20.4%), while the sane path rode the contract down to −34% / −45%. The live
  damage comes from *filling at* the blown-out one-lot bid. A stop decided on it and sold 2 s later costs nothing on
  average.
- No EDGE-T stop or entry fell in 10:00:00–10:00:06 (H2 never triggered at the 10:00 mark; H1 trades open 09:32–09:35).

## Checks
`tests_lookahead_t.py` (`results/lookahead.txt`, 150 root-sessions):
- Identical results with later bars, boards and quotes replaced by noise: H1 triggers 150/150, H2 marks 88/88,
  selections 100/100, exits 306/306 (all 9 exit rules).
- Canaries caught: forming-bar trigger 43/43, board stamped t 100/100, exit peeking 60 s ahead 306/306.

The A2 null at the real 5-minute vol profile reproduces the real H1 trigger count (245 vs 270). It beats the real
trades: −0.4% vs −6.6%. Real 0DTE contracts at 09:32 are dearer than Black-Scholes at the ATM IV, so the real fills
lose ~6 points a trade more than a fair-priced, no-edge world.

## Verdict
The day's lessons do not generalise. The opening drive (H1) makes money only on days that keep going, and it does not
pick those days in advance. Shuffled sides beat it 15–36% of the time, and a zero-drift world beats it 92–94% of the
time. The live trend-day rule (H2) loses on 34 of its 46 DEV trigger days, including the large trend days, because the
−35% stop and the 25% trail on 0DTE premium get chopped and the rule re-enters again and again. Exit-rule changes
move expectancy by ≤ 1.6 points a trade; every cell stays negative. Variants tried by EDGE-T: 13 (H1 4, H2 2, H3 7),
all in the ledger. The run covered 430 of 656 DEV sessions; finishing the other 226 (after 16:05 ET) cannot lift any
CI's lower bound from about −11..−17% to above 0.
