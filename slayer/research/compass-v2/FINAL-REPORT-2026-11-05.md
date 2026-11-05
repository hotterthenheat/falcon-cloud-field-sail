# Compass v2 — 6-hour edge hunt, final report (2026-11-05, 08:15–14:15 UTC)

**Verdict: no tradeable long-only edge found.** ~340 registered trials across 12 hypothesis families; 0 passed DEV
except K5, which passed a blind locked look and was then killed by the red team (replay look-ahead). Every trial,
including failures, is in `research-v2-ledger.md` at the repo root. Owner constraint for the final rounds: long calls
and puts only.

## Method (protocol: /tmp/qa/V2_PROTOCOL.md, copied in spirit below)
- Mechanism stated and spec pre-registered (ledger + git commit) before any outcome.
- Fills: ask in / bid out on the first quote ≥ decision + 2 s, 1-second NBBO (100 ms where stored), displayed size,
  $0.65/contract/side reported both ways. No mid fills.
- Splits: DEV pre-2025 (UW-dependent tests: 2023-12-06..2024-12-31), VALIDATION 2025, LOCKED = H1 ∪ H2 ∪ ≥2026-07-01.
- Nulls on every test: shuffled side, synthetic zero-drift at the real vol, and family-specific nulls (random minute,
  control mornings, non-signal days). Null false-pass rates 0–7%, mostly 2–5% (pipeline calibrated).
- Blind scorer for the locked set (spec only, one look); adversarial red team for survivors; independent pipeline audit.

## Results by family (DEV unless noted; expectancy per trade net of fee)
| Family | Variants | Result | Verdict |
|---|---|---|---|
| B1–B3 no-edge baselines | 3 | −15.9%, +10.6% (CI −9..+30, event-rich sample), +1.0% | reference |
| F1 aggressive option flow (UW) | 3 + 27 exits | underlying +6.9 bp/30 min in 2024, −1.2 bp in 2025; option capture −2.0% (all 27 exits lose) | FAIL |
| F2 news drift | 0 | UW headlines start 2026-08 (inside LOCKED) | untestable |
| F3 dark-pool blocks | 2 | +0.4 / +1.1 bp at 30 min | FAIL |
| K5 overnight SPXW | frozen | blind LOCKED look 76% win, +34% net — **red team: look-ahead** (pre-open marks saw day D's 09:30 open); honest −7.7% [−13.7, −1.5], n=252 | **KILLED** |
| S1–S3 K5 siblings (evening, XSP, other side signals) | 11 | −4% to −37% | FAIL |
| S4 do GTH quotes lag fair value? | mechanism | option tracks parity spot within the minute; lag ≤0.2% of premium vs ~7% spread | mechanism absent |
| C1 dealer close flows | 4 | +0.6 bp, no drift | FAIL |
| E1 momentum into close | 8 | −5% to −12% (side beats coin flip in 86–96% of shuffles) | FAIL |
| E2 reversal after violent open | 4 | −6% to −8% (one 19-trade cell +8.8%) | FAIL |
| E3 gamma-flip break | 4 | −2.7% to −5.0%; gamma sign irrelevant | FAIL |
| E6 pin to max-gamma strike | 2 | −13.6% | FAIL |
| D1/D1b event straddles (CPI/NFP/PPI/FOMC) | 10 | −5% to −23%; realized/implied 0.28–0.35 at 15–50 min | FAIL |
| D2/D2b post-release drift | 8 | −4% to −19%; FOMC +8..+43% CIs incl. 0, VAL negative | FAIL |
| D3 earnings straddle | 3 | DEV +3..+6% (CI incl. 0), VAL −6..−26% | FAIL |
| V1 VWAP pullback (from the owner's 5.8× SPY 768C, Nov 4) | 24 | −15% to +3%, no CI above 0; doubled-rate 20–36% vs zero-drift random walk 24–28% | FAIL |
| L1 buy when forecast vol > implied | 8 | −32% to +17%, n 8–142; realized/implied 0.91 on all days, 0.98 in the top bucket — never > 1 | FAIL |
| L3 vol-shock spillover, M 1–3 DTE re-expression | — | running at deadline | pending |

## What the hunt established
1. **Long short-dated options pay the variance risk premium.** Across all DEV sessions realized vol was ~0.91× the
   0DTE implied; even the days our best forecast flagged as "cheap" reached only 0.98×. Scheduled 08:30 releases
   realize ~0.3× of the priced move. A long-only edge needs days where realized > implied *knowably in advance*; none
   of our forecasts found them.
2. **Directional information exists but is smaller than the cost of owning it.** Momentum-into-close picks the right
   side more often than a coin (86–96% of shuffles), worth ~2–4%/trade; a 0DTE 0.25–0.50Δ round trip costs ~5–15% of
   premium (spread + decay).
3. **The pipeline works.** It caught a fabricated 88% (K5) and a pipeline audit found no look-ahead and no
   edge-hiding bug in v2 code (one small bug biased overnight results *down* 1–4 pts; no verdict changed).

## What would most raise the odds next
- Results of the two tests still running (L3 spillover; same signals on 1–3 DTE options, where cost/premium is lower).
- Record UW headlines and flow live from now (forward-only split) — news and flow can then be tested in ~2 months.
- Data we lack: futures (overnight), longer UW history, closing-imbalance feed.
- If long-only remains a hard constraint and nothing passes, Compass's honest value is analytics (gamma levels, flow,
  the Terrain desk), not trade calls at $240/month.
