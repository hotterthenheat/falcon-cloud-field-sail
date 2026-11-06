# EMA-MTF data coverage (measured, not assumed)

Everything here was read from the ThetaData terminal (127.0.0.1:25503, ≤ 2 requests in flight), the Unusual Whales
API (1 in flight) and the compass-v2 100 ms store, on 2026-11-06. Scripts: `edata/coverage.py` (warm-up study),
`edata/coverage_report.py` (tables, §4–5), `edata/depth_ema.py` (`reports/depth_ema.md`, §1–2), `edata/validate.py`
and `edata/latency_cal.py` (§6), `edata/panel.py` (the DEV panel, §7). No LOCKED session was fetched (`edata/common.py
guard` refuses H1/H2/≥2026-07-01 and 2026-H1; `etests/test_data.py`).

## 1. History depth per root and data type

Combined with compass-v2 `data/DEPTH.md` (SPY/QQQ/SPXW) and the new probes (`reports/depth_ema.md`: IWM, the SPX AM
root, 1-minute OHLC, index OHLC):

| data | SPY | QQQ | IWM | SPXW | SPX (AM root) |
|---|---|---|---|---|---|
| option NBBO (tick, 1m snapshots) | 2012-06 | 2012-06 | 2012-06 | 2014 (none 2012) | 2017–18 (none 2016) |
| option trades / 1-minute OHLC | 2012-06 | 2012-06 | 2012-06 | 2014 | 2018 (none 2016) |
| option greeks 1m (first_order: IV, delta) | ~2020 | 2012 | 2018 (none 2016) | ~2018 | 2018 |
| option open interest (daily) | 2012-06 | 2012-06 | 2012-06 | 2014 | 2016 |
| underlying 1m | stock 2018–2020 (CTA tape) | 2012-06 | ~2018 (CTA) | SPX index 2017 (no volume) | SPX index 2017 |
| same-day (0DTE) expiry every session | 2023 (68% of 2022 sessions) | 2023 (68% in 2022) | 2025 (89% in 2024, 62% in 2023) | 2023 (88% in 2022) | never trades on its date |

Same-day expiry share by year (sessions with an expiration on that date): SPY 28% (2016) → 68% (2022) → 100%
(2023+); QQQ 21% → 68% → 100%; IWM 21% → 63% (2022) → 62% (2023) → 89% (2024) → 100% (2025); SPXW 42% → 88% →
100%. **So the 0DTE bucket for IWM is only complete from 2025; DEV 0DTE results for IWM are Mon/Wed/Fri-weighted.**

**Unusual Whales** (this key): flow alerts refused before 2023-12-06 (re-verified for IWM: 2023-12-05 → HTTP 403
`historic_data_access_missing`; 2023-12-07 → rows). Alerts are stamped at `created_at` (publication) — the only honest
availability time; `start_time` is the first print inside and is often hours earlier. Consequence: **flow features
exist only in DEV block A (2024) and VALIDATION, not in block B (2022)**; UW spot GEX per minute the same; UW daily
greek exposure is last-~250-days only; UW headlines start 2026-08-06 (all LOCKED).

## 2. GEX / DEX / vanna / charm historically — computable from the terminal

Yes, for every session since greeks exist (§1): the morning **open-interest report for every expiration**
(`option/history/open_interest expiration=*`, ~2 s) × the vendor's **IV of every contract**
(`option/history/greeks/first_order expiration=*`, any interval ≥ 1 minute, one day per request; 30 minutes used:
~13 s for SPY's 35 expirations × 255 strikes) → Black–Scholes gamma/delta/vanna/charm at the vendor's underlying price
→ Pinpoint's dealer-signed exposures (`engine/positioning.py`; definitions in STRATEGY_SPEC §12, dealer long calls /
short puts, SPX AM root counted until 09:30 of its date). Built for every DEV eval session of the panel (`gx.parquet`
aggregates, `gxp.parquet` per-strike profile within ±5%). Example SPY 2024-04-17 10:00: net dealer GEX −$10.3B per 1%
(0DTE −$0.19B), gamma flip 513.0 vs spot 505.3, call wall 510, put wall 500; QQQ 2024-04-09: −$1.1B, flip 443.4 vs
441.8. Sign checks and the $/1% formula are unit-tested (`etests/test_data.py`).

The compass-v2 store (`v2data/sessions/*/{R}_greeks_1m + _oi`) holds only the **first two expirations** of 20 scattered
sessions: its GEX is a 0–1 DTE partial book and cannot stand in for the full book (the panel's `gx` uses all of them).
What is **observed** (OI by strike, IV surface, volume, prints, UW alerts) and what is **inferred** (anything that needs
the dealer-side assumption: signed GEX/DEX/vanna/charm, flip, walls, hedge flows) are separate columns
(`obs_*` vs `inf_*`) and separate PREREG feature groups. Intraday OI is unknown (the report is the prior close).

## 3. How much of its own chart a contract has — the sample

Coverage sample (fixed before measuring; `edata/coverage.py`): 7 DEV sessions (2022-03-16, 2022-05-10, 2022-11-17,
2023-03-29, 2023-10-19, 2024-04-23, 2024-11-18), roots SPY, QQQ, IWM, SPXW, SPX; per DTE bucket the largest-OI listed
expiration; strikes nearest |delta| 0.30 and 0.50 (and 0.15 on the first three sessions) for calls and puts at 10:00 →
**766 contracts, 31,650 contract-days**. Per contract: its quote/trade listing dates, every 1-minute trade-print bar
over the last 62 fetchable sessions + the session to 10:30, and the 1-minute two-sided-quote mask of the last ≤ 27
calendar days. (After the third session the shared terminal slowed to 5–10 s a request — other workers' load and a
terminal restart at 04:21 — so the remaining four sessions were cut *before measurement* to |delta| 0.30/0.50 and no
quote request; two-sided quote share measured 99.2–100% on the first 402 contracts, so listed quote days are taken as
quoted all day for the other 364 — an assumption, stated.)

Medians by root × bucket (`coverage_report`; "stored life" = sessions of the contract's own history inside the 62-session
window — **a strike is often listed only when the underlying approaches it**, so life is shorter than the expiry's):

| root | bucket | n | DTE | stored life (sessions) | 2-sided quote share | trade minutes/day (last 5) | empty 1m trade bars (last 5 sessions) | empty 1m trade bars (D, 09:30–10:30) |
|---|---|---|---|---|---|---|---|---|
| SPY | 0 | 28 | 0 | 10 | 99.8% | 183 | 53% | 0% |
| SPY | 1-7 | 34 | 2 | 33 | 100% | 238 | 39% | 0% |
| SPY | 8-30 | 34 | 24 | 62 | 100% | 108 | 72% | 40% |
| SPY | 31-90 | 34 | 59 | 62 | 100% | 36 | 91% | 75% |
| SPY | 91+ | 34 | 123 | 62 | 100% | 18 | 95% | 95% |
| QQQ | 0 | 28 | 0 | 9 | 100% | 112 | 71% | 0% |
| QQQ | 1-7 | 34 | 2 | 33 | 100% | 162 | 58% | 0% |
| QQQ | 8-30 | 34 | 24 | 35 | 100% | 70 | 82% | 65% |
| QQQ | 31-90 | 34 | 59 | 37 | 100% | 18 | 95% | 94% |
| QQQ | 91+ | 34 | 123 | 62 | 100% | 11 | 97% | 97% |
| IWM | 0 | 18 | 0 | 10 | 100% | 64 | 84% | 8% |
| IWM | 1-7 | 34 | 2 | 33 | 100% | 78 | 80% | 24% |
| IWM | 8-30 | 34 | 24 | 50 | 100% | 57 | 85% | 72% |
| IWM | 31-90 | 34 | 59 | 58 | 100% | 16 | 96% | 90% |
| IWM | 91+ | 34 | 220 | 62 | 100% | 2 | 99% | 100% |
| SPXW | 0 | 34 | 0 | 19 | 99.4% | 56 | 86% | 0% |
| SPXW | 1-7 | 34 | 2 | 36 | 100% | 49 | 87% | 39% |
| SPXW | 8-30 | 34 | 15 | 62 | 100% | 6 | 98% | 97% |
| SPXW | 31-90 | 34 | 51 | 62 | 100% | 2 | 100% | 100% |
| SPXW | 91+ | 34 | 133 | 33 | 100% | 0 | 100% | 100% |
| SPX (AM) | 1-7 | 16 | 1 | 62 | 99.2% | 20 | 95% | 42% |
| SPX (AM) | 8-30 | 30 | 29 | 62 | 100% | 8 | 98% | 98% |
| SPX (AM) | 31-90 | 34 | 59 | 43 | 100% | 3 | 99% | 100% |
| SPX (AM) | 91+ | 34 | 123 | 62 | 100% | 2 | 99% | 99% |

**Trade-print vs NBBO-mid.** NBBO mid exists essentially every minute of every listed session for every contract
sampled (99.2–100%). Trade prints do not: outside 0DTE and SPY/QQQ 1–7 DTE most 1-minute trade bars are empty
(72–100% on a typical session), SPXW 8+ DTE and all SPX AM contracts print a few minutes a day. The median wall-clock
span of the last 21 one-minute trade bars is 0.05 sessions for SPY/QQQ/SPXW 0DTE but 0.2–1.8 sessions for SPY/QQQ
31+ DTE, 2.8–14 sessions for SPXW 8+ DTE, 3–6 sessions for SPX AM: **a 1-minute "EMA21" on such a chart summarises one
to fourteen days of sporadic prints**. The TRADE-density rule (≥ 80% of the last 2×21 bars non-empty) holds at 5m for
SPY 0DTE 93% / 1–7 97% / 8–30 62%, QQQ 0DTE 75% / 1–7 82%, SPXW 0DTE 82% / 1–7 38%, IWM 0DTE 61% / 1–7 71%, and
≤ 29% everywhere else. Hence STRATEGY_SPEC §3: **MID is the primary chart for every test; TRADE is a replication arm
only on 0–7 DTE (plus SPY 8–30) where it is dense.**

## 4. Warm-up availability: EMA × timeframe × bucket (all roots pooled, as of 10:30 on the sampled session)

T = ≥ 80% of sampled contracts warm (testable), P = 20–80% (partial), U = < 20% (untestable). Primary rule: bars ≥ N
(SMA-seeded EMA defined); strict: ≥ 2N. MID bars are bar-end two-sided quotes; TRADE bars are non-empty print bars.

### 4.1 MID, primary (≥ N)
| bucket | TF | EMA5 | EMA9 | EMA15 | EMA20 | EMA21 | EMA50 | EMA100 | EMA200 |
|---|---|---|---|---|---|---|---|---|---|
| 0 (n=108) | 1m | T 100% | T 100% | T 100% | T 100% | T 100% | T 100% | T 97% | T 97% |
| 0 | 5m | T 100% | T 100% | T 97% | T 97% | T 97% | T 97% | T 89% | T 87% |
| 0 | 15m | T 97% | T 97% | T 97% | T 97% | T 97% | T 89% | T 87% | P 76% |
| 0 | 30m | T 97% | T 97% | T 97% | T 89% | T 89% | T 87% | P 76% | P 36% |
| 0 | 60m | T 97% | T 89% | T 89% | T 87% | T 87% | P 79% | P 36% | **U 0%** |
| 1-7 (n=152) | 1m–30m | T ≥ 93% everywhere | | | | | | | |
| 1-7 | 60m | T 100% | T 100% | T 100% | T 100% | T 100% | T 99% | T 93% | T 82% |
| 8-30 (n=166) | 1m–60m | T ≥ 93% everywhere | | | | | | | |
| 31-90 (n=170) | 1m–30m | T ≥ 88% everywhere | | | | | | | |
| 31-90 | 60m | T 97% | T 96% | T 96% | T 96% | T 96% | T 94% | T 89% | T 81% |
| 91+ (n=170) | 1m–60m | T ≥ 85% everywhere | | | | | | | |

### 4.2 MID, strict (≥ 2N) — the cells that change
0DTE: 15m EMA100 P 76%, 15m EMA200 P 36%, 30m EMA50 P 76%, 30m EMA100 P 36%, **30m EMA200 U 0%**, 60m EMA50 P 36%,
**60m EMA100/200 U 0%**. 1–7: 60m EMA200 P 38%. 8–30: 60m EMA200 P 48%. 31–90: 60m EMA200 P 46%. 91+: 60m EMA200
P 52%. Everything else T.

### 4.3 TRADE, primary (≥ N non-empty bars)
| bucket | TF | EMA5 | EMA9 | EMA15 | EMA20 | EMA21 | EMA50 | EMA100 | EMA200 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 1m | T 100% | T 100% | T 100% | T 100% | T 100% | T 100% | T 95% | T 85% |
| 0 | 5m | T 100% | T 100% | T 97% | T 97% | T 97% | T 96% | P 79% | P 57% |
| 0 | 15m | T 97% | T 97% | T 97% | T 97% | T 96% | T 81% | P 60% | U 13% |
| 0 | 30m | T 97% | T 97% | T 96% | T 89% | T 89% | P 69% | P 27% | U 5% |
| 0 | 60m | T 97% | T 89% | T 87% | T 84% | T 83% | P 51% | U 8% | U 0% |
| 1-7 | 1m | T 100% | T 100% | T 100% | T 100% | T 100% | T 99% | T 99% | T 94% |
| 1-7 | 15m | T 100% | T 100% | T 100% | T 100% | T 100% | T 98% | T 91% | P 71% |
| 1-7 | 60m | T 100% | T 100% | T 100% | T 99% | T 99% | T 92% | P 70% | P 38% |
| 8-30 | 1m | T 100% | T 99% | T 99% | T 98% | T 98% | T 94% | T 85% | P 70% |
| 8-30 | 60m | T 99% | T 98% | T 98% | T 97% | T 97% | T 89% | P 67% | P 35% |
| 31-90 | 1m | T 97% | T 97% | T 95% | T 92% | T 91% | P 76% | P 65% | P 48% |
| 31-90 | 60m | T 97% | T 95% | T 91% | T 86% | T 85% | P 65% | P 39% | P 23% |
| 91+ | 1m | T 89% | T 85% | T 80% | P 78% | P 77% | P 65% | P 51% | P 37% |
| 91+ | 60m | T 87% | T 81% | P 78% | P 73% | P 73% | P 53% | P 39% | U 18% |

TRADE strict (≥ 2N) is U for: 0DTE 5m EMA200, 15m EMA100/200, 30m EMA100/200, 60m EMA50/100/200; 1–7 60m EMA200;
8–30 60m EMA200; 31–90 30m/60m EMA200; 91+ 5m–60m EMA200 and 60m EMA100. Full tables: `python3 -m edata.coverage_report`.
**"Warm" on TRADE is not "usable"**: §3's staleness applies; a warm TRADE EMA on a 31+ DTE contract is mostly old prints.

### 4.4 Per root (MID primary unless stated)
* **0DTE, any root: 60m EMA200 0% (MID) — untestable.** 30m EMA200: SPY 21%, QQQ 14%, IWM 33%, SPXW 68%. 15m
  EMA200: SPY 64%, QQQ 71%, IWM 78%, SPXW 88%. The binding constraint is the strike's listing, not the expiry: a 0DTE
  ATM strike typically existed for only 9–19 sessions.
* 60m EMA200 strict (2N = 400 hourly bars ≈ 57 sessions): 0–62% for every root and bucket (cap of the 62-session
  window and strike listing) — **untestable under the strict rule anywhere except as partial**.
* SPXW 91+: 60m EMA200 62%, strict 18%. SPY 91+: 5m EMA200 91%.
* TRADE, SPXW 31–90 and 91+: 1m EMA200 3%, 5m EMA200 0–3%, 60m EMA21 35–65% — untestable on prints.
* LOCKED-truncated history: on 2022-11-17 the chart can only start 2022-10-03 (33 sessions; 2022-07..09 is LOCKED H2):
  60m EMA200 MID warm for 75% (vs 85–100% elsewhere). The same applies to any session within ~31 sessions after a
  LOCKED window (2022-10 to mid-Nov 2022, 2024-09 to mid-Oct 2024, 2025-04 to mid-May 2025), so **DEV/VALIDATION
  blocks were placed outside those windows** (PREREG §2: VALIDATION starts 2025-07-01).

## 5. Verdict: which configurations are untestable and why

| configuration | status | why |
|---|---|---|
| 0DTE × 60m × EMA200 (any series) | **untestable** | 0% of contracts have 200 hourly bars: strikes are listed 9–19 sessions before |
| 0DTE × 60m × EMA100, 30m × EMA200 | partial (14–68% by root) | same |
| 0DTE × 30m/60m × EMA100–200, strict 2N | **untestable** | 0% |
| any bucket × 60m × EMA200, strict 2N | partial at best (≤ 62%) | the 62-session window, strike listing |
| TRADE series, 8+ DTE (all SPXW 8+, SPX AM, IWM/QQQ 31+) | **not usable** even where "warm" | prints are hours–days apart; density rule fails (0–29%) |
| TRADE series, 0DTE × 15m+ × EMA100/200 | untestable/partial | too few non-empty bars |
| SPX AM root, 0DTE | **does not exist** (stops trading the session before its date; settles at the open) | — |
| IWM 0DTE before 2025 | partial sample (Mon/Wed/Fri-weighted) | listing |
| UW flow / UW GEX features in 2022 (block B) | **untestable** | UW history starts 2023-12-06 |
| 91+ DTE beyond 200 DTE, and 31+ DTE at \|delta\| < 0.30 | not stored | budget; strike band |
| everything else in MID (1m–60m × EMA5–EMA200, buckets 1–7 to 91+; 0DTE up to 15m EMA100 / 60m EMA21) | testable | ≥ 80% warm |

So the brief's long-timeframe EMAs (1h EMA 50–200) are testable on the option's own chart **only on 1+ DTE
contracts and only with the NBBO-mid chart**; on 0DTE they do not exist. Trade-print charts are testable only for
0–7 DTE on SPY/QQQ/SPXW (and IWM 0DTE).

## 6. Data validation

| check | result |
|---|---|
| 1-minute NBBO snapshot stamped T = NBBO in force at T | 22,230/22,230 identical to the 100 ms store as-of (SPY 2024-04-17, 0–1 DTE) |
| **1-minute grid with start_time 09:30:02** | **NOT a 2 s grid**: rows stamped :02 carry the :00 NBBO (100% equal to the store at :00, 42.7% at :02). Found before any baseline ran; the panel's `q2` files were deleted, fills come from 1-second quotes (PREREG A1) |
| 1-second NBBO (edata/fills.py) at bar end + 2 s | 4,392/4,392 identical to the 100 ms store |
| SIP trade bars (edata/sip.py) vs terminal option/history/ohlc (SPY 0DTE 2024-03-01, 11,404 bars) | same bar set; O, C, V, N 100.00% identical; H 99.83%, L 99.89% (the terminal's ±5% phantom-print filter) |
| 2-second NBBO drift after a bar end (100 ms store, 2.08M contract-minutes, 20 DEV sessions) | buy +0.17% of mid (SPY +0.04%, QQQ +0.05%, SPXW +0.30%), sell +0.05%; median spread 2.44% (SPY 1.77%, QQQ 2.19%, SPXW 3.08%); after a 5-minute premium rise the buy drift is +0.07%, after a fall +0.20% |

## 7. The DEV panel built for Phase 1/2 (`edata/panel.py`)

Block A (eval 2024-03-01..2024-05-31, 64 sessions; warm-up from 2023-11-29), roots SPY, QQQ, IWM, SPXW: per
root-session the 1-minute bar-end NBBO of every expiration in use (0DTE, every 1–7 DTE expiration, the largest-OI
expiration of 8–30 / 31–90 / 91–200), 15-minute snapshots for those expirations' earlier life (warm-up for 15m/30m/60m),
1-minute SIP trade bars of all of them, the full positioning book every 30 minutes (eval sessions), OI, and 1-minute
underlying bars 04:00–16:00. SPY block A: 1.8–2.6 MB per eval session, 1.2–1.4 MB per history session.
**Status at hand-off: block A is complete** — 126 sessions × 4 roots (64 eval + 62 warm-up), 0 failed root-sessions,
577 MB; UW flow alerts for every eval session (SPY/QQQ/IWM; SPX/SPXW return none under those tickers), 9 MB; 1-second
fill quotes for the ~6,800 contract-days the baselines traded, 469 MB (`v2data/ema/fills`, reusable by Phase 2). The
whole EMA store is 1.1 GB of the 2.5 GB budget.

**Phase 2 update (EMA-2, 2026-11-06).**
* **Block B is complete**: eval 2022-03-01..05-31 (64 sessions), warm-up from 2021-11-30 (62 sessions), 4 roots,
  504 root-sessions, 0 failed, 504 MB. It was fetched 03:54–06:52 ET at one request in flight under
  `edata/windowed.py`, which stops the fetch before 09:15 ET and resumes it after 16:05 ET.
* **Hist OI**: the morning OI reports for the 20 sessions before each block (`edata/oi_hist.py`) feed the S1C P/C OI
  median.
* **VALIDATION**: the pre-declared fallback window 2025-07-01..09-30 (PREREG §9b item 12: the full 2025-H2 would not
  fit the budget) is being fetched with the same code by `edata/chain.py`, under the same window guard. No outcome is
  computed from it before a candidate is frozen.

Phase 1's original note: **Block B (2022-03..05) is planned (STRATEGY_SPEC §15, PREREG §2) and
NOT fetched**: `cd slayer/research/ema-mtf && V2_THETA_SLOTS=1 python3 -m edata.panel --block B` (resumable, ≈3–4 h
at one request in flight; respect the 09:15–16:05 ET one-in-flight window on live days). The machine's free disk
moved between 3.3 and 8.1 GB during the session because of other workers; the fetcher stops itself below 3 GB.
