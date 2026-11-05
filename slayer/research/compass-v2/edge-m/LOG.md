# EDGE-M log (2026-11-05): EDGE's E1/E2 triggers through 1–3 DTE long calls/puts

Protocol /tmp/qa/V2_PROTOCOL.md incl. anti-bias 10–14. Owner constraint: long calls and puts only. Pre-registration
`specs/PREREG.md` @ 3031f3b (M1–M6, before any 1–3 DTE fetch), amendment A1 @ 616c418 (M7/M8 quote guard, null session
set; after the E2 look, before computing M7/M8). Global ledger: 8 variants + 2 spec lines. Full tables: `results/DEV.md`.

## Data and code
- `mdte.py`: EDGE's triggers (`hyp.trig_e1`, `hyp.trig_e2`) and simulator (`sim.run_trade`) unchanged. Per trigger and
  per DTE bucket (0 = same day from EDGE's chain store; 1 = next session's expiry; 2–3 = 2nd, else 3rd session's) a
  1-minute board fetched for minute (t−60)//60, gate |Δ| 0.30–0.45, spread ≤ 5%, bid/ask size ≥ 1, ask ≤ 0.6 EM; both
  sides on 1-second NBBO (ask in / bid out, +2 s). Exits = EDGE's X2/Y2 with stop/arm/trail scaled by ρ = σ_opt/σ_ref
  (σ_ref = median 0DTE σ_opt: E1 0.93, E2 1.36; medians ρ: 0DTE 0.98, 1DTE 0.26, 2–3DTE 0.18).
- Store `v2data/edge-m/` 58 MB (budget 1 GB); EDGE's `v2data/edge/` read only.
- DEV-M (fetch time at 1 request in flight, ~10 s/trigger): E2 all 656 DEV sessions (131 triggers); E1 the pre-registered
  every-2nd-session list (328 sessions), processed in a seeded random order and cut at 1 h 25 min of fetching:
  572 of 1,312 root-sessions, 329 triggers on 275 sessions — a random subsample of DEV, cut on time, not outcome.

## Cost side at entry (same root-day-minute marks, contract nearest target Δ in 0.30–0.45)
| marks | DTE | n | spread % mid | BS theta / trading hour % mid | passes 5% gate | premium (bp of S) |
|---|---|---:|---:|---:|---:|---:|
| E1 15:24 | 0 | 144 | 3.9% | 129% | 67% | 7 |
| E1 15:24 | 1 | 144 | 1.5% | 11.0% | 100% | 27 |
| E1 15:24 | 2–3 | 144 | 1.3% | 5.7% | 100% | 38 |
| E2 09:59 | 0 | 96 | 1.8% | 13.6% | 98% | 20 |
| E2 09:59 | 1 | 96 | 1.5% | 6.7% | 100% | 33 |
| E2 09:59 | 2–3 | 96 | 1.5% | 4.4% | 100% | 40 |
Payoff per 1% favourable underlying move (OLS of option return on signed underlying return): E1 0DTE 275%, 1DTE 118%,
2–3DTE 71%; E2 1DTE 81%, 2–3DTE 74%. Hidden cost: implied vol falls during the hold (median −0.3 vol pt in ~6 min,
76% of E1 2–3DTE trades), which hits the higher-vega 1–3 DTE contracts.

## Results (DEV-M, net of $0.65/side, session-clustered 95% CI)
| variant | n | win | exp net [95%] | no fee | payoff | shuffle beats | synthetic beats (null FDR) |
|---|---:|---:|---:|---:|---:|---:|---:|
| M1 E1 0DTE X2s (control) | 109 | 37% | −11.0% [−20.9, −1.0] | −8.7% | 0.96 | 12% | 76% (0%) |
| M2 E1 1DTE X2s | 267 | 45% | −1.7% [−4.2, +0.9] | −0.7% | 0.93 | 94% | 98% (0%) |
| M3 E1 2–3DTE X2s | 323 | 44% | −1.1% [−2.7, +0.6] | −0.4% | 0.97 | 100% | 100% (0%) |
| M4 E1 2–3DTE overnight → 09:45 | 323 | 15% | −0.7% [−6.4, +6.2] | +0.0% | 5.50 | 88% | 52% (3%) |
| M5 E2 1DTE Y2s | 102 | 45% | −5.2% [−10.5, −0.2] | −4.3% | 0.67 | 90% | 21% (1%) |
| M6 E2 2–3DTE Y2s | 127 | 43% | −9.8% [−14.6, −5.3] | −9.1% | 0.41 | 98% | 0% (1%) |
| M7 = M6 + quote guard (A1) | 127 | 52% | −1.8% [−4.8, +1.1] | −1.0% | 0.69 | 78% | 57% (1%) |
| M8 = M3 + quote guard (A1) | 323 | 44% | −1.2% [−2.8, +0.6] | −0.4% | 0.96 | 98% | 100% (0%) |
PBO (CSCV, M2–M8) 0.67; DSR at N = 308: 0.000 for every variant (all Sharpe/trade < 0). Shuffle-null FDR 0% everywhere.
By year M3: 2020 −5.6%, 2022 −2.5%, 2023 −1.0%, 2024 −0.3%; SPXW +0.9% [−2.2, +4.1] the only root above 0.

## Checks
`tests_lookahead_m.py` (`results/lookahead.txt`): 300 triggers identical with later bars/chain hidden (EDGE's
truncation test); 301/301 contract selections identical from boards truncated to t − 60; 267/267 exits identical on
paths cut at the exit fill; canaries caught (board stamped at t: 103/109 differ; exit peeking 60 s ahead: 100/100).
Execution finding (A1): at 10:00:00–10:00:06 ET (macro releases) 1–3 DTE quotes blow out for seconds (IWM 184P
2023-12-08 0.21/1.75 at 10:00:03 vs 0.94/0.98 at 10:00:07); E2's protocol fill at 10:00:02 buys that ask and the stop
reads that bid. EDGE's 0DTE E2 numbers carry the same artefact. Guarding (act only on quotes ≤ 10% wide) lifts E2
2–3DTE from −9.8% to −1.8%, still negative.

## Verdict
The hypothesis is half right. Going to 1–3 DTE cuts the entry spread from 3.9% to 1.3–1.5% of premium and theta from
~129%/h to 6–11%/h, and E1's direction is real on these marks (M3 beats 100% of shuffles and 100% of zero-drift runs).
But the payoff per unit of underlying move falls in the same proportion (275% → 71% per 1%), so the edge in premium
terms shrinks with the cost: the best variant M3 is −1.1%/trade net (−0.4% gross), CI [−2.7, +0.6]. No variant has
positive DEV expectancy with a CI excluding 0; E2 cannot reach 150 trades. Nothing goes to VALIDATION; nothing frozen;
the locked test was not touched. Variants tried by EDGE-M: 8 (M1–M8), all in the ledger.
