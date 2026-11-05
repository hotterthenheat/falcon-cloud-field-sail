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
null mean −3.4%, pass rate 3%; E6 P2 null mean −12.2%, pass rate 0%; E3 gex<0-Z1 (50 runs) null mean −6.1%,
p95 +1.1%, pass rate 0%. Shuffled-signal pass rates 0–0.5% everywhere. The pipeline does not manufacture
passes (FDR <= 5%).

Reading: E1 (intraday momentum into the close) is the mechanism with the best published support; on 1-second fills
its momentum side is slightly better than a coin (beats 86–96% of shuffled draws for the trailing/vol exits) but the
size is ~2–3% a trade against a ~10–14% round-trip cost of a 0DTE 0.35Δ option in the last 35 minutes (half the
DEV triggers had no contract inside the 8% spread gate). Conditioning on negative dealer GEX adds nothing. E2 has
too few triggers (125 < 150) and loses. E6 (pin) is worse than a coin. None goes to VALIDATION.

### E3 GAMMA-BREAK (DEV, 2,058 opening-range breaks with a gated contract)
| variant | n | win | expectancy net [95%] | no fee | payoff | shuffled: real beats |
|---|---:|---:|---:|---:|---:|---:|
| gex<0-Z1 | 976 | 18% | −5.0% [−15.8, +6.6] | −3.5% | 4.13 | 68% |
| gex<0-Z2 | 976 | 42% | −7.4% [−11.2, −3.3] | −6.0% | 0.87 | 57% |
| gex>=0-Z1 (contrast) | 1,082 | 16% | −2.7% [−13.8, +9.4] | −1.2% | 4.90 | 86% |
| gex>=0-Z2 (contrast) | 1,082 | 40% | −6.5% [−10.7, −2.4] | −5.0% | 1.05 | 48% |
PBO 1.00 (2 variants), DSR 0.00. The sign of prior-close dealer GEX (OI-based, dealers long calls / short puts) does
not separate continuation from failure: short-gamma breaks are no better than long-gamma breaks or a coin.

## 3. Checks
- Look-ahead (after the red team's K5 finding): `tests_lookahead.py` recomputes 400 recorded triggers per hypothesis
  with every later bar and chain quote hidden — identical for E1, E2, E3, E6; a canary that reads the bar starting at t
  is caught; run_trade asserts each underlying-rule bar closed before the decision second. The only full-day read is
  the ">= 300 bars" guard, which removes exactly the 20 scheduled half-days (exchange calendar, known in advance).
- Parity with FOUNDATION's 100 ms engine (46 E1 trades on sessions in both stores): same fill on 46/46, same exit
  on 24/46; mean return +53.2% (EDGE, 1 s) vs +44.9% (FOUNDATION): 1-second sampling misses sub-second touches of
  stops/trails, so EDGE's numbers are, if anything, optimistic. Every hypothesis is negative anyway.
- Long calls/puts only (owner constraint): every E-trade is a single long option, buy to open / sell to close.

## 4. Verdict
No EDGE hypothesis clears DEV, so nothing went to VALIDATION and nothing is frozen for the locked test. K5, the only
historical pocket, was killed by the red team (pre-open marks saw day D's 09:30 open); EDGE's DEV reproduction of it
inherits that leak and is void. The common failure: in 0DTE index options the round trip at the ask/bid on 1-second
quotes costs ~5–15% of premium, and the directional information in these mechanisms (where it exists at all: E1's
trailing exit beats a coin in 86% of draws) is worth ~2–4% a trade.

## 5. Variants tried by EDGE (all logged): 23
E1 8 (6 + 2 GEX), E2 4, E3 4 (2 + 2 contrast), E6 2, K5 DEV reproduction 1, port/look-ahead checks 2 (not trials),
synthetic nulls 4 runs. Prior trials before v2: 155 (challenger) + 112 (nov4) + 9 (dont-chase).
