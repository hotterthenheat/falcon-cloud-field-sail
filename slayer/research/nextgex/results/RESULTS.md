# NEXTGEX results (pre-registration `1bc5b7d`, DISCOVERY written down in `0262a01` before the CALIBRATION look)

Data: SPXW 0DTE 1-minute NBBO boards, same-day OI and SPX 1-minute bars, 1,005 sessions (764 DISCOVERY 2020-02-18 ..
2023-12-29, 241 CALIBRATION 2024); SPY 586, QQQ 564, IWM 442 sessions as replication. Decision times 10:00 / 12:00
/ 14:00 / 15:00 ET. No session on or after 2025-01-01 was scored (asserted in code). Labels: quotes, OI, bars OBS;
priced odds, forward, priced move, fly prices CALC; the H1.3 correction MODEL; outcome = 15:59-bar close, OBS-proxy.
All CIs: day-clustered bootstrap, 2,000 resamples. Full numbers: `RESULTS.json`; DISCOVERY-only pass:
`RESULTS_DISC_ONLY.json`, `DISCOVERY.md`.

## Verdict

**No pre-registered primary test passed. Neither concept is a validated new market read on SPX.**

| primary test (SPXW) | DISCOVERY | CALIBRATION 2024 | Holm p | verdict |
|---|---|---|---|---|
| H1.1 realised / priced, close beyond ±1 priced move | 0.954 [0.877, 1.031] | 0.917 [0.790, 1.040] | 0.36 | FAIL: the board's odds are close to honest |
| H1.3 DISCOVERY-fit correction, Brier gain on 2024 | (in-sample 0.00011) | 0.00000 [-0.00020, +0.00020] | 0.49 | FAIL: nothing to correct |
| H2.1 butterfly excess payoff per 1 sd of strike OI, 14:00 | +0.0024 [-0.0021, +0.0075] (floor 0.0102) | +0.0073 [-0.0027, +0.0168] | 0.36 | FAIL: no measurable pin |

## Concept 1: calibrated odds

What the data say, plainly:

1. **The SPX same-day board's priced odds are nearly honest.** Pooled 2020-2024, the board priced a close beyond
   ±1 move at 15.2% (down) / 14.9% (up); it happened 14.3% [12.6, 15.9] / 14.2% [12.6, 15.8]. Beyond ±2 moves:
   priced 3.45% / 1.92%, happened 3.26% / 1.79%. The PIT histogram is flat to within a point per decile (outer two
   deciles 18.3% DISCOVERY, 17.8% CALIBRATION, vs 20% if perfect). The variance premium the earlier ledger measured
   (EDGE-L realised/implied 0.91) lives mostly in the body, not in mispriced tail odds.
2. **The far-upside overpricing seen in DISCOVERY did not hold.** DISCOVERY: a close beyond +2.5 moves was priced
   0.79% and happened 0.29% (R 0.36 [0.13, 0.67]); calls there returned $0.17 per $1 of mid. 2024: R 1.22
   [0.25, 2.45], calls $0.82 per $1. A rally year erased it. Not reported as a finding.
3. **A correction learnt on 2020-2023 does nothing for 2024 on SPX** (Brier 0.0837 both; log score -0.0002).
4. **The ETF boards price wider moves than SPX on the same days** (replication roots, reported, not part of the
   pass/fail): ±1-move tails happened 0.70x (SPY), 0.65x (QQQ), 0.71x (IWM) as often as priced in 2024, and the
   DISCOVERY-fit correction lowered their 2024 Brier with CIs above 0 (SPY +0.00071 [0.00008, 0.00129], QQQ
   +0.00097 [0.00023, 0.00163], IWM +0.0024 [0.0013, 0.0035]). On the 359 / 226 common SPX-SPY days, SPY's
   straddle priced a move 8% / 11% wider (as a share of price) than SPXW's, and the realised frequency at SPY's
   wider ±1 level fell accordingly (post-hoc diagnostic, not registered). Likely contract design, not a free lunch:
   ETF options are American, physically settled, exercisable on after-hours news until 17:30, and sit on a $0.01
   tick; our outcome (the 16:00 close) ignores the after-hours exposure their price includes. A new registry entry
   would be needed before this is called anything.
5. **Slayer's own density overstates the tails.** An app-style quadratic smile (the `data/weigherDensity.ts`
   convention, approximated) priced the ±1-move tails at 15.6% where the board's own vertical spreads said 15.1%;
   realised / app-priced = 0.924 [0.852, 1.000] DISCOVERY and 0.856 [0.738, 0.978] in 2024. The model-free
   vertical-spread odds are closer to what happens than the curve the app draws today.
6. Null calibration: closes drawn from each session-time's own priced distribution gave R = 1.002 (200 runs), and
   the bootstrap CI covered 1 in 97.5% of runs: the measurement is not what made the board look honest.

**Classification.** A *description of risk* that passes as "the board is honest within about ±8% on SPX", not as a
miscalibration to exploit, and not a trading edge. The product value is the receipt (how often priced odds came
true), not a corrected forecast.

## Concept 2: pin gravity

* H2.1 failed in both splits; DISCOVERY year signs +, +, - (2023 negative); the permutation null's 95th percentile
  (0.0045) is above the real beta (0.0024); every variant (gamma-weighted OI, 12:00, 15:00) has a CI covering 0;
  the closest, gamma-weighted OI at 15:00 in DISCOVERY (+0.0066 [-0.0000003, +0.0133], one-sided p 0.025, one of 6
  unregistered-for-decision variants), covers 0 again in 2024 (+0.0042 [-0.0128, +0.0222]).
* H2.2 (descriptive): the largest-OI strike within 1 move closed within half a strike 13.9% of DISCOVERY days vs
  11.2% priced, 14.6% vs 12.1% in 2024 (ratio 1.21 [0.85, 1.57]). Against flies at the same distance from spot:
  +0.017 [-0.002, +0.035] DISCOVERY, +0.035 [+0.001, +0.071] 2024. A hint, not evidence.
* ETFs: H2.1 beta negative in DISCOVERY (SPY -0.012 [-0.023, -0.001], IWM -0.024 [-0.050, -0.001]): if anything,
  closes avoid large-OI strikes. Consistent with the unreviewed "pinning to amplification" note in SHORTLIST.md.
* Permutation-null pass rate at a one-sided 5% CR0 t-test: 7.5% (slightly liberal; the bootstrap CIs are the
  decision statistic).

**Classification.** Fails. Slayer's current "pin" label (largest OI within 1% with dealers long gamma) has no support
in this test; it should either carry a "not measured to attract price" note or be measured before it is shown as a
magnet.

## Counting

3 primary tests (all fail), 2 split looks each; secondaries: 10 z-cells x 4 times x 2 splits (H1.2), 10 x 2 (H1.5),
6 fly variants x 2 splits (H2.1/H2.3), 3 replication roots. One post-hoc diagnostic (SPX vs SPY common days),
labelled. CALIBRATION was opened once.
