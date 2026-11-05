# EDGE-B pre-registration (written before any outcome was computed)

Worker EDGE-B, 2026-11-05. Base origin/main b71a22b. Protocol: /tmp/qa/V2_PROTOCOL.md (items 1-14).
Families owned: F1 informed aggressive options flow, F2 news shock drift, F3 dark-pool block direction.

## 0. Data depth (measured 2026-11-05, before registration)

- UW token history starts **2023-12-06** (vendor reply `historic_data_access_missing`: "earliest date currently
  available ... 2023-12-06", rolling 2-year window). Flow alerts page back with `older_than` to 2023-12-06; the
  `date` param is ignored on that route. Dark pool `/darkpool/{T}?date=` works from 2023-12-06.
- UW news `/news/headlines`: `date`/`older_than` ignored; global paging caps at page 500 x 100 (back to 2026-09-17);
  per-ticker paging ends ~2026-08-06 (AAPL 135 headlines total, NVDA ~300). **All news history lies inside the LOCKED
  TEST (sessions from 2026-07-01).** No DEV, no VALIDATION.
- Splits used exactly as V2_PROTOCOL item 6, truncated by vendor depth:
  DEV = 2023-12-06 .. 2024-12-31 minus 2024-08-01..08-31 (H1 H-2024); VAL = 2025-04-01 .. 2025-12-31
  (2025-01..03 is H2). Nothing from 2022-06..09, 2024-08, 2025-01..03, or >= 2026-07-01 is fetched.
  Disclosure: one probe before registration (`/darkpool/AAPL?date=2025-03-03&limit=3`) returned three
  after-hours AAPL prints from an H2 day (fields only, no outcome computed). It is not used anywhere.

## Common machinery (all families)

- Decision time t0 = the vendor's publication stamp (`created_at` for flow alerts; `executed_at` + 10 s for dark
  pool, the TRF reporting allowance). Entry decision te = ceil_second(t0) + 2 s (latency).
- Quotes: ThetaData 1-second NBBO (`/stock/history/quote`, `/option/history/quote`, interval=1s). A 1-second row
  stamped T is used only for decisions at or after T + 1 s (guards against bucket-end stamping). Fills: buy at the
  ask, sell at the bid, of the first row usable after the decision + 2 s latency. No mid fills.
- Costs: spread (by construction) + $0.65/contract/side; results reported with and without the fee.
- Underlying vol scale: sigma_1s = std of 1-second log mid changes over [t0-30 min, t0); sigma_h = sigma_1s*sqrt(h s).
- Clustered statistics: session-clustered bootstrap (2000 resamples) 95% CI of the mean.
- Session filter: alerts/prints with t0 in 09:45:00-15:00:00 ET on regular sessions; dedupe: the first qualifying
  event per (ticker, direction, session).
- Sampling cap (compute budget, 1 ThetaData request in flight): if a split has more than 2500 qualifying events for
  a variant, a seeded random sample of 2500 (seed 20261105) is used for Stage A; Stage B uses a seeded sample of at
  most 1200 of those.

### Stage A (drift gate) — the mechanism test
Metric: signed underlying mid return dir*(S(te+h)/S(te) - 1), h in {5, 15, 30, 60} min; primary h = 30 min.
Also reported: the same in sigma_h units, and SPY-hedged (r_i - r_SPY) for single names.
Gate to Stage B (per variant, Bonferroni across the family's variants): DEV mean at h=30 > 0, session-clustered 95% CI
lower bound > 0, and permutation p < 0.05/k (k = number of the family's Stage-A variants).
Nulls: (a) shuffled signal: directions permuted across the split's events (same tickers, times, count), 1000 draws;
(b) synthetic zero drift: each event's path redrawn as a driftless Gaussian walk at its own sigma_1s, 200 replicates;
the gate rule applied to every null draw -> null pass rate reported (must be <= 5% or the pipeline is broken).

### Stage B (option capture)
Contract at te: the same underlying, the nearest listed expiration with 1 <= calendar DTE <= 9; for the signal
direction (call if dir=+1, put if dir=-1) and, for the null, the opposite right: the strike whose Black-Scholes |delta|
(from the NBBO mid, underlying mid at te, r = 5%, q = 0) is nearest 0.30 within [0.20, 0.40]; NBBO spread <= 8% of mid;
ask >= $0.20; ask size >= 1; ask <= 2 * S * sigma_1s * sqrt(23400) (one-day move cap). No contract -> no trade.
Exit (adaptive, grid tuned on DEV only; 27 variants = k_t {1.0,1.5,2.0} x k_s {0.75,1.0,1.5} x T {15,30,60} min):
m(t) = dir*(S(t)/S(te)-1) on underlying mids, s = sigma_30.
  target: m >= k_t*s; stop: m <= -k_s*s; break-even trail: once m >= 0.5*k_t*s the stop becomes m <= 0;
  option floor: bid <= 0.40 * entry ask; time stop T; hard flat 15:55 ET. Exit fill = bid 2 s after the trigger row.
Return per trade = (100*bid_x - fee) / (100*ask_e + fee) - 1.
DEV selection: the exit variant with the best DEV mean (fee-inclusive). DEV pass: its mean > 0 with clustered CI
excluding 0; beats >= 95% of shuffled-side nulls (each null draw assigns call/put sides at random and re-selects
its own best exit -> selection-aware); synthetic zero-drift option null (BS reprice at entry IV, entry dollar spread
held, same 27-exit selection) pass rate reported (<= 5%). Also PBO (CSCV, 16 session blocks) over the 27 exits and
deflated Sharpe with the global trial count.
VALIDATION (frozen exit): mean > 0 with clustered CI excluding 0, win >= 55% or mean >= +10%/trade.
Only a DEV+VAL pass is frozen (spec file + commit hash) for the blind scorer. EDGE-B never scores the locked test.

## F1 — informed aggressive short-dated OTM option flow (UW flow alerts)
Mechanism: an informed trader (or a hedger with an urgent view) pays the ask for size in short-dated OTM options
because they expect a move soon. The dealer who sells is short the option and buys/sells the underlying delta at once
(and keeps re-hedging as gamma bites), and the informed party's information itself leaks into the price. Both push the
underlying in the trade's direction over minutes. Expected sign: positive (drift with the call/put direction).
Trigger: alert type call (dir +1) or put (dir -1); UW fetch filter is_ask_side, is_otm, max_dte 7, min_premium 100k;
then locally: total_ask_side_prem/total_premium >= 0.80; has_multileg false; issue_type not Index and ticker not in
{SPX, SPXW, NDX, NDXP, XSP, RUT, RUTW, VIX, VIXW, DJX}; underlying_price >= $10; strike OTM vs underlying_price;
0 <= DTE(expiry - session) <= 7.
Variants (k = 3): F1-A1 total_premium >= $250k (primary); F1-A2 >= $1M; F1-A3 >= $250k and has_sweep.

## F2 — news shock drift (UW headlines)
Mechanism: a ticker-tagged headline moves informed/algorithmic order flow; under-reaction -> drift, over-reaction by
liquidity takers -> reversal within 1-30 min. Expected sign: unknown a priori (two-sided).
**Not testable under the protocol:** UW headline history begins 2026-08-06 (per ticker) / 2026-09-17 (global), all
inside the LOCKED TEST. Zero trials run. Proposal (not applied): record headlines live from now on and use a
forward-only split (first 40 sessions DEV, next 40 VAL, then a fresh locked block), or buy a historical news feed.

## F3 — dark-pool block prints at/through the quote (UW dark pool)
Mechanism: a large off-exchange block printed at or through the NBBO ask (bid) shows a liquidity demander paying the
spread on size — usually one child of a larger parent order; the rest of the parent keeps leaning on the book
(price-impact persistence, Kyle). Expected sign: positive (continuation in the print's direction).
Universe (fixed): SPY QQQ IWM AAPL MSFT NVDA AMZN META GOOGL TSLA AMD NFLX AVGO JPM XOM BA COIN MU INTC SMCI PLTR UBER
DIS WMT. Fetch: `/darkpool/{T}?date=D&min_premium=5000000&limit=500` (paged by older_than if 500).
Trigger: not canceled; sale_cond_codes, ext_hour_sold_codes, trade_settlement, trade_code all null; dir = +1 if
price >= nbbo_ask, -1 if price <= nbbo_bid, else no signal; nbbo_bid < nbbo_ask.
Variants (k = 2): F3-D1 premium >= $5M (primary); F3-D2 premium >= $20M.

## Trial count added by EDGE-B registration
Stage A: F1 3 variants x 4 horizons = 12 looks; F3 2 x 4 = 8 looks. Stage B (only for gate passers): 27 exits each.

## Amendment A1 to F3 (2026-11-05, before any F3 outcome was computed)
Found while counting events (no returns computed): UW's `trade_settlement` is the string `regular` on normal prints
(null on ~30%), and `trade_code` carries `intermarket_sweep` (ISO) on ordinary aggressive prints. "All null" therefore
dropped the normal prints. Amended trigger: trade_settlement in {null, regular}; trade_code in {null,
intermarket_sweep}; sale_cond_codes null (still excludes average_price, contingent, prior_reference_price);
ext_hour_sold_codes null; not canceled. Everything else in F3 unchanged.
