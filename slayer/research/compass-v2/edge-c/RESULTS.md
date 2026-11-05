# EDGE-C results (2026-11-05): K5's siblings and mechanism, and C1 close-flow — nothing survives, nothing frozen

Pre-registration: `specs/PREREG.md` @ a6619ab (before any outcome); amendment A1 @ 9efe5ec (after the red team's
look-ahead finding: no challenger rows on any pre-open mark — the engine written before the notice already used only
the real chain at the mark). Ledger: /home/user/falcon-cloud-field-sail/research-v2-ledger.md (EDGE-C rows).
Data written: /home/user/falcon-cloud-field-sail/v2data/edge-c (≈ 25 MB of the 1 GB budget): XSP overnight 1-min
chains and SPY pre-market NBBO for the 120 DEV nights, 1-second NBBO of every called contract, results.
Code: `common.py` (splits, raw-chain reader, BS/parity, terminal client 1-in-flight), `overnight.py` (the K5 rule and
siblings, nulls, FOUNDATION-sim protocol execution), `s4.py` (mechanism), `c1.py` (close flow), `k5rows.py` (the rows
artefact, diagnostic only), `fetch_dev.py`.

## Data honesty
- DEV for S1–S4 = the 120 pre-2025, non-locked nights the challenger's raw cache covers (2020-02..04, 2022-02..05,
  2022-10, 2024-07). The terminal has **no SPXW GTH quotes 00:00–09:15 in 2020** (evening 20:15–23:59 only), so the
  after-midnight tests run on 2022 + 2024-07 (82 nights); **XSP GTH quotes exist only from 2024-07** (13 DEV nights);
  **NDXP has no GTH quotes at all**; **no futures feed** exists (404), and the SPX index prints 0.0 overnight.
- Every overnight universe is built from the chain quotes at the mark, with the chain's own parity spot at the mark
  and the prior session's 15:59 close; no day-D bar is read anywhere. Locked days are filtered by name before any
  file is opened. VALIDATION was not looked at: nothing passed DEV.

## The K5 rule rebuilt honestly (reference, not a trial)
| path | n | win (TP) | expectancy net of fee | gross |
|---|---:|---:|---:|---:|
| K5ref minute path (fill = ask 1 min after the mark, bracket on minute bids) | 82 | 32% [22, 41] | **−20.0% [−31.1, −8.4]** | −19.8% |
| K5ref protocol (FOUNDATION sim, 1-s NBBO, +2 s, displayed size) | 82 | 26% [17, 35] | **−13.1% [−22.8, −3.1]** | −12.8% |
| synthetic zero-drift night, same contracts (200 reps) | 82 | 28% | −19.9% (p95 −12.0%) | |
K5ref sits at the 49th percentile of the no-edge synthetic null: the rule's P&L is exactly what a 1.50×/0.4678 bracket
on a 0.15Δ option costs with zero drift. The challenger rows on the same DEV days give K5 10 calls, 100% wins — the
tapeOf look-ahead the red team found (`results/k5rows_dev_calls.csv`), recorded as the artefact.

## Siblings (DEV, minute path unless stated; 95% session-clustered CIs; fee $0.65/side included)
| test | n | win (TP) | expectancy net | nulls (synthetic pct / shuffled pct) | verdict |
|---|---:|---:|---:|---|---|
| S1a evening 20:15–23:55 | 90 | 23% [14, 32] | −13.8% [−23.1, −4.6] | 91st / 20th | FAIL |
| S1a protocol (1-s) | 90 | 8% [2, 13] | −9.9% [−15.8, −4.2] | | FAIL |
| S1b 22:00–23:55 | 79 | 16% [9, 25] | −14.3% [−23.2, −5.3] | 85th / 4th | FAIL |
| S1c \|g\| ≥ 0.10% | 80 | 22% [14, 32] | −15.0% [−24.4, −5.3] | 87th / 5th | FAIL |
| S1d spread ≤ 4% | 57 | 33% [21, 46] | −7.4% [−19.3, +4.1] | 97.5th / 73rd (n 10) | FAIL (best S1; still negative) |
| S2a XSP K5-literal | 10 | 30% [0, 60] | −36.5% [−70.4, −1.1] | 8th / 68th | FAIL (XSP data only 2024-07) |
| S2b XSP spread ≤ 15% | 13 | 38% [15, 62] | −23.4% [−53.6, +7.5] | 51st / 47th | FAIL |
| S2c XSP 0.15–0.30Δ | 13 | 38% [15, 62] | −16.7% [−49.4, +14.4] | 41st / 70th | FAIL |
| S2 NDXP | 0 | | | | not testable (no GTH quotes) |
| S3a side from XSP parity | 13 | 46% [23, 69] | −4.2% [−32.5, +24.4] | 92nd / 43rd | FAIL (n) |
| S3b side from SPY pre-market, 04:00–05:55 | 81 | 31% [21, 41] | −16.9% [−27.5, −6.1] | 75th / 24th | FAIL |
| S3c side from the prior day's close-to-close | 84 | 37% [26, 48] | −13.9% [−25.0, −2.8] | 81st / 14th | FAIL |
Protocol execution (FOUNDATION sim, 1-s NBBO, +2 s, displayed size), all filled: S3b 81 → 21% [12, 30], −16.1%
[−25.9, −5.9]; S2a 10 → 10%, −8.8% [−36.8, +15.9]; S3a 13 → 46%, −2.0% [−30.4, +25.8] (median displayed size 36–58).
Nulls: shuffled-side (200 draws) and synthetic zero-drift (200 reps) false-pass rates are 0–2.5% on every variant:
the pipeline is calibrated. In the evening the move's side is *worse* than a coin flip (S1a–c at the 4th–20th
percentile of the shuffled null): mild reversion, not continuation. PBO (CSCV, 16 blocks): S1 0.23, S2 0.47, S3 0.02
(all variants negative, so PBO is moot); DSR 0.00 for every variant (N = 230 trials in the ledger).

## S4 — the mechanism ("the SPXW GTH ask lags the parity-implied fair value after a move")
S4a, SPXW DEV (18,888 mark-rows, 82–92 nights): y_h = Δln(mid) of the 0.15Δ same-side option over h, on x1 = the move
already made and x2 = the contemporaneous parity move (cluster-robust SEs). β2 ≈ 106–120 = BS leverage |Δ|·S/mid, so the
option tracks the parity spot *contemporaneously*. The lag term:
| window | signal | h=5 β1 (t) | h=15 β1 (t) | h=30 β1 (t) | β1/β2 at h=5 |
|---|---|---|---|---|---|
| after midnight | last 5-min move | +4.8 (1.8) | −0.6 (−0.3) | −2.9 (−0.9) | 0.045 |
| after midnight | overnight move so far (K5's signal) | −0.1 (−1.0) | −0.1 (−0.4) | −0.1 (−0.1) | −0.001 |
| evening | overnight move so far | −0.1 (−1.5) | −0.4 (−2.3) | −0.9 (−2.2) | −0.001 |
| morning 06:00–09:00 | last 5-min move | −1.8 (−0.9) | −5.5 (−2.2) | −5.1 (−1.2) | −0.016 |
The only positive coefficient (after midnight, 5 min, t 1.8) is 4.5% of the contemporaneous beta and gone by 15 min:
a typical 0.05% move "owes" the option ≤ 0.2% of premium against a 7% spread. On K5's own signal there is no catch-up at
any horizon, and in the evening the same-side option *underperforms* after a move. The ask-based and bid-vs-ask versions
agree (`results/s4a_lag_SPXW_DEV.csv`). XSP (S4d, 11 nights): β1 ≤ 0 at every horizon (t −2.4 at h=30 on the overnight
signal). S4b: after midnight the SPXW NBBO is unchanged minute-to-minute on 6–19% of minutes (regular hours 6–12%),
median spread/mid 3.3–4.9% (regular 2.7–3.6%); the evening is stickier (33–38% unchanged) and is where the rule loses
most. **Verdict: no sticky re-marking to harvest; overnight SPXW quotes are live and move with the parity spot.** S4c
(rows' greeks attribution) is withdrawn — the rows carry the look-ahead.

## C1 close flow (SPY, QQQ, SPXW 0DTE; decision 15:00; Stage A on the underlying, no option look)
| look | n (root-sessions) | signed drift 15:00→15:55 | perm p | hit |
|---|---:|---:|---:|---:|
| C-G0 charm flow sign, all | 1654 / 570 sess | +0.6 bp [−2.3, +3.6] | .30 | 50.0% |
| C-G1 \|F\| ≥ med20 and (short gamma or ≥ 0.5 EM from the flip) | 739 | −1.4 bp [−4.7, +2.2] | .86 | 47.8% |
| CV-G0 charm + vanna | 1654 | +0.5 bp [−2.3, +3.6] | .31 | 50.1% |
| CV-G1 | 746 | −0.8 bp [−4.1, +2.8] | .72 | 48.9% |
The computed dealer hedging flow is "buy" on 89–96% of sessions (dealers long decaying OTM calls), so the signal is
nearly a constant long bias, and the underlying does not drift with it (2020 +42 bp on 34 sessions is the only positive
cell; 2022–2024 −0.5 to −2.5 bp). The gate fails on all four looks; the 8 registered Stage B option variants were not run.

## Verdicts
- K5: the rule, rebuilt without the look-ahead, loses −13% to −20% a trade on DEV and equals the no-edge null.
- S1–S3: every sibling is negative (11 variants, 0 positive); XSP/NDXP/futures could not add power (data absent).
- S4: the claimed mechanism is absent — the option re-marks with the parity spot within the minute; the only lag is
  4.5% of the move over 5 minutes, worth ≤ 0.2% of premium.
- C1: no close-flow drift; fails at the gate.
- Nothing goes to VALIDATION, nothing is frozen, the blind scorer has nothing from EDGE-C.
