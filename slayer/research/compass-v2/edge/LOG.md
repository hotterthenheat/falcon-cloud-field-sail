# EDGE research log (2026-11-05)

Protocol: /tmp/qa/V2_PROTOCOL.md incl. anti-bias controls 10–14. Base b71a22b. Every variant is in the global
ledger (`/home/user/falcon-cloud-field-sail/research-v2-ledger.md`, snapshot `ledger-snapshot.md`).

## 0. K5 (overnight SPXW, frozen 2026-10-31)
Per anti-bias control 12 (added mid-task) EDGE did **not** score K5 on H2. Hand-off: `specs/K5.spec.md` +
commit c45a7d2; scorer command `BLIND_SCORER=1 SCORER_OUT=<dir> python3 k5_h2.py --h2` (the script refuses
without BLIND_SCORER=1). H2 is built: 123 of 124 sessions (2025-01-08 missing). DEV reproduction on the 320 non-H2
built sessions (no H2 row read): 60 calls, win 83.3% [73.2, 92.2], +37.7%/call [+29.1, +44.6], +37.3% with fees.

## 1. Data and simulator (interim, until FOUNDATION's store covers enough sessions)
- `fetch.py`: per root (SPY, QQQ, IWM, SPXW) and session with a same-day expiry, the 0DTE chain's 1-minute NBBO
  09:30–16:00 (strike_range 14 / SPXW 24), open interest (all expiries; kept <= 31 days), 1-minute underlying bars
  (SPX index for SPXW). DEV = 2020-02-18..04, 2022-02..05, 2022-10, 2023-01..2024-12 minus 2024-08 (656 sessions,
  2,214 root-sessions); VALIDATION = 2025-04..12 (190 sessions, 760 root-sessions). Locked-test periods are never
  fetched. Store: `v2data/edge/` (zstd parquet / npz).
- `sim.py`: decision at t from closed bars and chain quotes stamped <= t − 60 s; buy the ask of the first
  **1-second NBBO** quote >= t + 2 s (bid, ask > 0, ask size >= 1); exits decided per second (or per closed bar),
  filled at the bid of the first 1-second quote >= decision + 2 s; fee $0.65/side both ways. All fills and exits
  of E1–E6 are on 1-second quotes (fetched per contract, 30-minute chunks; `tests_chunk.py`: chunked = full window
  on 1,029 trades). FOUNDATION's store (100 ms quotes + ticks) holds 5 sessions (80 MB each), too few to test on.
- Nulls: `hyp.shuffle_null` (same triggers and times, side by coin; both sides are simulated on real quotes),
  `nullsyn.py` (zero-drift synthetic underlying at the real day's 1-min vol, BS prices at the real ATM IV, real
  median spread; 100 runs).

## 2. Results (DEV)
See `results/*.md` for the full tables (by year, right, root, exit reason).

Net of the $0.65/side fee; 95% session-clustered bootstrap; win = net return > 0. DEV also holds 2022-01 (not
locked; the PREREG text said 2022-02..05 — every hypothesis saw the same set).

| hypothesis / variant | n | win | expectancy net [95%] | no fee | payoff | shuffled null: real beats | PBO | DSR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| E1 z0.5-X1 | 848 | 17% | −8.0% [−21.1, +7.1] | −5.2% | 4.01 | 22% | 0.59 | 0.00 |
| E1 z0.5-X2 (best) | 848 | 40% | −5.5% [−10.5, −0.1] | −2.6% | 1.15 | 86% | | 0.00 |
| E1 z0.5-X3 | 848 | 30% | −8.4% [−15.5, −1.4] | −5.6% | 1.81 | 96% | | 0.00 |
| E1 z1.0-X1 | 490 | 17% | −12.2% [−27.5, +7.5] | −9.6% | 3.62 | 18% | | 0.00 |
| E1 z1.0-X2 | 490 | 39% | −7.0% [−13.3, −0.7] | −4.3% | 1.06 | 58% | | 0.00 |
| E1 z1.0-X3 | 490 | 29% | −9.5% [−19.2, −0.5] | −6.8% | 1.80 | 86% | | 0.00 |
| E1 z0.5-X2 GEX<0 | 449 | 40% | −5.2% [−12.3, +2.1] | −2.3% | 1.14 | 56% | | |
| E1 z1.0-X2 GEX<0 | 263 | 43% | −5.6% [−13.1, +2.2] | −3.0% | 0.96 | 57% | | |
| E2 a0.35-Y1 | 125 | 50% | −7.5% [−14.2, −0.4] | −5.5% | 0.58 | 84% | 0.30 | 0.00 |
| E2 a0.35-Y2 | 125 | 50% | −5.9% [−12.6, +1.0] | −4.0% | 0.63 | 88% | | 0.00 |
| E2 a0.6-Y1 | 19 | 63% | −0.2% [−20.8, +16.6] | +1.8% | 0.58 | 84% | | 0.00 |
| E2 a0.6-Y2 | 19 | 74% | +8.8% [−7.5, +21.0] | +11.0% | 0.74 | 96% | | 0.13 |
| E6 P1 | 428 | 20% | −14.6% [−23.4, −5.4] | −12.1% | 2.61 | 28% | 1.00 | 0.00 |
| E6 P2 | 428 | 34% | −13.6% [−18.2, −9.1] | −11.0% | 0.92 | 10% | | 0.00 |

Synthetic zero-drift nulls (100 runs each): E1 z0.5-X2 null mean −14.2% (p95 −11.3%), pass rate 0%; E2 a0.35-Y2
null mean −3.4%, pass rate 3%. Shuffled-signal pass rates 0–0.5% everywhere. The pipeline does not manufacture
passes (FDR <= 5%).

Reading: E1 (intraday momentum into the close) is the mechanism with the best published support; on 1-second fills
its momentum side is slightly better than a coin (beats 86–96% of shuffled draws for the trailing/vol exits) but the
size is ~2–3% a trade against a ~10–14% round-trip cost of a 0DTE 0.35Δ option in the last 35 minutes (half the
DEV triggers had no contract inside the 8% spread gate). Conditioning on negative dealer GEX adds nothing. E2 has
too few triggers (125 < 150) and loses. E6 (pin) is worse than a coin. None goes to VALIDATION.
