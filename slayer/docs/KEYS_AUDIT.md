# Keys audit: what the two data keys can give, what Slayer uses, and what to build with the rest

Written 2026-11-07 (a Saturday: every "live" answer below is the 2026-11-06 session). Internal memo: it names the
vendors, and the product must not (the on-screen strings were checked and are clean, see §7).

**How this was built.** The product side comes from the code at `a23cdab` (`src/App.tsx` routes, every ThetaData path in
`src/` and `server/`, the Unusual Whales allowlist in `server/uwProxy.mjs`), cross-checked against `docs/DATA_SOURCES.md`
and `docs/DATA_MAP.md`. The vendor side comes from the official specs, downloaded the same day:
Unusual Whales' OpenAPI (`https://api.unusualwhales.com/api/openapi`, 224 GET routes, changelog to 2026-11-03), its
WebSocket, Kafka and Conventions pages; ThetaData's v3 OpenAPI (`https://thetadata.net/docs/openapiv3.yaml`, 81 paths)
and its Subscriptions, Concurrent Requests, Option Greeks and Flat Files pages. **Unusual Whales was probed with 63 GETs
on our key, sequential, 1.5 s apart** (status, shape and history depth only; no key was printed or written). **The
ThetaData terminal was not asked anything**: two research jobs hold it. Its tier is inferred from the repo (evidence in
§1.2).

Legend for the matrix: **Avail.** = does our key get it (yes / no / unknown, with the evidence). **Used** = where the
product reads it. **Effort** = S (under a day), M (days), L (weeks).

---

## 0. The short version

1. **The keys are a retail ThetaData Pro account (options, stocks, indices) and an Unusual Whales API Basic key.** Pro
   ThetaData is the deep one: tick NBBO and every OPRA trade back to 2012-06, greeks of all three orders on both models,
   per-trade greeks, a WebSocket stream and (probably) whole-market flat files. UW Basic is REST only, 3 requests in
   flight for everyone, history from 2023-12-06, no WebSocket (the socket answers 401 "Basic plans ... include REST API
   access only").
2. **Slayer uses ThetaData's breadth well but not its depth.** It reads snapshots, NBBO history, the trade-quote tape,
   open interest and first-order greeks. It never touches the stream, per-trade greeks, second/third-order **history**,
   binomial (American) greeks, `at_time/trade`, the index one-second price history or the flat files. Most of the gap
   is history and per-trade greeks: exactly the data that lets a product **measure and verify** instead of predicting.
3. **130 of UW's 224 GET routes match our allowlist; about 15 of those are never called.** Of the 94 routes not
   allowlisted, about 40 are open on our key and unused (half of them crypto and prediction-market routes). Among the
   useful ones: the **daily full option tape** (the route answers 302 to a signed download), `market/oi-change`,
   `option-activity/unusual`, `sec-filings`, `predictions/ticker/{t}`, and, allowlisted but uncalled, VRP, the
   realized-vol windows and the risk-reversal skew history. The other ~50 are refused (Advanced tier, add-ons,
   enterprise) or deprecated.
4. **Five places compute or mix what a key already gives** (§4). The Weigher takes its gamma from one vendor and its
   delta and IV from the other. The ThetaData greeks are asked with no dividend. The exposure history is rebuilt from
   IV with our own Black-Scholes when the Pro history greeks carry gamma. The tape is tagged on two pages by two
   different rules.
5. **The honest product the data supports is a measuring instrument, not a signal.** The owner's research found no
   validated intraday edge: ~340 trials, one survivor killed for look-ahead
   (`research/compass-v2/FINAL-REPORT-2026-11-05.md`). Retail's real problems are execution cost, decay, implied-move
   pricing and hype. Tick history to 2012 can measure all of them. The top ideas (§5) are a fill-quality audit, a
   per-trade P&L autopsy, a "could you really have made that?" checker, a cost-to-trade map and a backtester that
   always shows the coin-flip baseline.
6. **The biggest risk is not technical.** Both keys are personal-use licences. Showing this data, or numbers derived
   from it, to anyone else needs commercial and redistribution agreements. Those are priced in `docs/launch-costs.md`
   and none is signed (§7).

---

## 1. What the keys are

### 1.1 Unusual Whales: API Basic (or Whale Bundle Basic)

| Fact | Evidence |
|---|---|
| Plan is **Basic** | WebSocket handshake → **401** "WebSocket streaming is not included in your current plan. Basic plans (API Basic and Whale Bundle Basic) include REST API access only" (probe 2026-11-07). Every Advanced-gated route → 403 `advanced_tier_required` or 422 "available with the API Advanced subscription". |
| **3 requests in flight**, across every token and viewer; no daily cap, no per-minute cap | Conventions page ("API Basic, API Advanced, Whale Bundle Basic and Whale Bundle Advanced allow 3 ... The same four plans have no daily request cap"); `DATA_SOURCES.md` (429 "exceeded 3 concurrent"). |
| History from **2023-12-06** | `research/ema-mtf/reports/DATA_COVERAGE.md` (403 `historic_data_access_missing` on 2023-12-05); probe: `spot-exposures?date=2024-01-10` → 200, 547 per-minute rows. Daily `greek-exposure` = last 250 sessions (probe: 2025-11-10..2026-11-06). Headlines only from 2026-08-06. |
| Add-ons **not** on the key | `volatility/vix-term-structure` → 403 `volatility_scope_required`; `politics/fec/*` → 403 `politics_scope_required`; `congress/unusual-trades*`, `private-markets/*` → 422 "premium endpoint"; `futures/*` → 403 `futures_access_required`; `politician-portfolios/*`, `stock/{t}/ownership` → enterprise only. |
| Licence | Public-API page: Basic is "strictly for personal use. Redistribution is not allowed". Conventions: "Redistributing the data to others requires a redistribution license." The Startup tier ($750/mo) permits commercial use; redistribution is Enterprise, custom-priced (`docs/launch-costs.md` ch. 3). |

### 1.2 ThetaData: Pro options, Pro stocks, Pro indices (inferred, not asked)

| Fact | Evidence |
|---|---|
| **Options Pro** | Option NBBO and OPRA trades reach **2012-06** for SPY/QQQ/IWM (Pro only; Standard starts 2016-01-01) (`DATA_COVERAGE.md` §1). The product reads `/option/snapshot/greeks/second_order` (Compass Setup) and `/option/snapshot/greeks/all` (Terrain's `/api/terrain/chain`), both Pro-only. `docs/launch-costs.md`: "Noah chose Pro for both". |
| **Stocks Pro** | QQQ one-minute underlying from 2012-06 (Stocks Standard starts 2016) (`DATA_COVERAGE.md`); `/stock/history/trade` and `/stock/history/trade_quote` are read (Standard or Pro only). |
| **Indices Pro** | SPX index one-minute bars from **2017** (Pro's first date; Standard is 2022-01-01) (`DATA_COVERAGE.md`). NDX real-time needs Indices Pro; NDX **history** starts 2026-05-11 for everyone (Subscriptions page). |
| **8 requests in flight**, account-wide; requests are not rate-limited; one terminal per account | `server/thetaSlots.mjs` (terminal log "Max concurrent requests: 8"); Concurrent Requests page. Queue 16 by default (up to 128), then 429. |
| Streaming | Pro options: **unlimited trade contracts (the full trade stream) and 15,000 quote contracts**. Pro stocks: 2,000 quotes and 20,000 trades (Nasdaq Basic). `theta/config.toml` binds `ws_port=25520`. **Not verified on the key** (no terminal request allowed). |
| Flat files | "Only available to professional users", **the last 7 calendar days only**: option trade_quote ≈1.2 GB/day, option quote ≈38 GB, OI ≈50 MB, EOD ≈150 MB. **Unknown** for our key, and denied by our own proxy on purpose (`shared/thetaPaths.mjs`, `scripts/theta-paths-proof.ts`). |
| Rates | `/interest_rate/history/eod` is read (`src/data/rateFeed.ts`). Its tier is unknown: the Free tier holds 2024 onward, Value holds 1970 onward. |
| Greek conventions | Black-Scholes, **no dividend unless `annual_dividend` / `annual_dividend_amount` is passed**, SOFR by default, **vega and rho per 1.00 of vol (divide by 100)**. That settles `DATA_MAP.md` red flag 7: the Weigher's `vega / 100` is right. The binomial endpoints are Leisen-Reimer, American for every root except the cash-settled index roots. |
| Licence | Subscriber agreement: one individual; "data and derived works may not be redistributed; no third party may be shown the data without written consent" (`docs/launch-costs.md` ch. 2). Commercial bundle quoted to the owner: $1,250/mo for months 1–6, $2,000/mo for months 7–12. |

---

## 2. What the product reads today, page by page

Current as of `a23cdab`. `DATA_MAP.md` (2026-10-29) has the cadences; rows added since then are marked *new*.

| Page | UW (via `/api/uw`, hub-cached) | ThetaData (via `/api/theta` or server modules) |
|---|---|---|
| **Pulse** `/pulse` | Every tile's book: `stock-state`, `greek-exposure/strike`, `iv-rank`, `volatility/term-structure`, `interpolated-iv`, `spot-exposures/strike`, `ohlc/1m`; Market tile: headlines, congress, insiders, earnings | Tile prices: `stock/snapshot/trade`, `index/snapshot/price`, `*/history/eod`; Trade tile: the Compass scan and `chainStore` chains; Vol outlook tile: `/api/vol-outlook/<T>` (*new*: a year of one-minute bars per name, `src/data/volOutlookServer.ts`) |
| **Terrain** `/terrain` | Exposure rail, walls, flip, flow lane (book paths + `spot-exposures`); exposure field from `/api/exposure/*` (the recorder: `spot-exposures/strike`, `spot-exposures/expiry-strike`, `greek-exposure/expiry` every minute); name card `/api/name-card/<T>` (report, wire, insiders, congress); earnings and news markers; cone IV first from UW `term-structure` / `interpolated-iv` | Candles `*/history/ohlc`, extended-hours rebuild `stock/history/trade`, head price `*/snapshot/*`; **option tape** `/api/tape/options` (`option/history/trade_quote` + `history/open_interest`, tagged by `printTags.ts`); **stock tape** `/api/tape/stock` (`stock/history/trade_quote`); Building `/api/oi-change` (`option/history/open_interest expiration=*`); Surface tab `/api/terrain/chain` (`option/snapshot/greeks/all` + `snapshot/open_interest`), `/api/terrain/prior` (`history/greeks/eod`), `/api/terrain/overnight` (`history/quote`, `snapshot/quote`, VIX `index/history/ohlc`); vol regime `/api/regime/vol` (VIX1D…VIX6M, VVIX, SKEW: `index/snapshot/price`, `history/ohlc`, `history/eod`); past-day field `/api/exposure/hist` (`history/open_interest` + `history/greeks/implied_volatility` + bars) |
| **Compass** `/compass`, `/:id`, `blotter`, `tracker`, `review`, `study` | Tape rail `option-trades`; NameDesks: book, `ohlc/1m`, 37 one-shot vendor reads | The engine (`/api/compass`, `compassScan.ts`): `snapshot/greeks/first_order`, `snapshot/quote`, `snapshot/open_interest`, `history/quote`, `at_time/quote`, `calendar/on_date`, bars; Setup: `history/ohlc`, `snapshot/greeks/second_order`, `history/greeks/first_order`, `history/trade`; ledger: `history/quote` 1m then 1s; review scanner `reviewLive.ts` (458 names): `snapshot/greeks/all`, `history/trade_quote` |
| **Weigher** `/weigher` | Per-contract **gamma** from `option-contracts` (`withVendorGamma`); position card book; `top-net-impact` | Chain `snapshot/greeks/first_order` + `snapshot/quote` (1 s), `list/expirations`, `snapshot/ohlc`, `snapshot/open_interest`, `history/eod`, entry range `at_time/quote`, premium chart `history/ohlc` |
| **Practice** paper / backtest / journal | Paper chart walls (book) | Paper quotes `snapshot/quote`, catch-up `history/quote`; backtest replay `list/contracts/quote`, `list/dates/quote`, `history/quote`, `history/ohlc`; Journal: local storage only |
| **Pinpoint** map / agenda / board / compare | Everything except price: book core and full mode (`oi-per-strike`, `flow-per-strike`, `greek-exposure/expiry`, `strike-expiry`, `spot-exposures/expiry-strike`, `option-contracts` paged), `pinJobs` (`greek-flow`, `flow-per-expiry`, `max-pain`, `nope`, `oi-change`, `flex-options`, `volatility/stats`, `term-structure/distribution`), Board screener prices | Live price and candles; Building's OI (`/api/oi-change`); rate and holidays |
| **Trace** (11 pages) | UW only: `option-trades` stream, `flow-alerts`, `market-tide`, `screener/option-contracts`, `top-net-impact`, `net-prem-ticks`, `net-flow/expiry`, `multi-leg` (+legs), `darkpool/*`, `lit-flow/*`, `oi-change`, `option-contract/{id}/historic|flow|intraday`, `stock/SPX/spot-exposures` | none (`thetaCall` refuses on `/trace`) |
| **Dossier** (news, earnings, insiders, congress, stocks, institutions, shorts, ETFs) | UW only: headlines, economic and FDA calendars, POTUS, daily report, earnings, insiders, congress, screener, financials, seasonality, institutions, shorts, ETFs, `volJobs` (vol stats, interpolated IV and its distribution, term distribution, anomaly, character, context, sentiment, short interest) | none |
| Shell (every page) | Nav quote on UW rooms, alerts (flow `option-trades`, level and indicator alerts on UW book candles) | Nav quote on Theta rooms, watchlist prices, ticker universe `*/list/symbols`, Settings probe `calendar/today` |

---

## 3. Gap matrix

### 3.1 ThetaData v3 (81 REST paths + streams)

"Avail." is **yes (Pro)** for every row unless it says otherwise. The tier tables are on the Subscriptions page; the
evidence that we hold Pro is §1.2.

| Family | Endpoints | Used? (where) | Not used → what it could power | Effort |
|---|---|---|---|---|
| **Stock lists** | `list/symbols`, `list/dates/{trade,quote}` | symbols: command palette (`listedNames.ts`); dates: research only | `list/dates`: honest "data available since" labels in Backtest and Journal | S |
| **Stock snapshot** | `ohlc`, `trade`, `quote`, `market_value` | trade, quote: prices everywhere on Theta rooms | `market_value` (the "Market Value" display price, which matters for the licensing route, §7); `ohlc` for session high/low without a bar read | S |
| **Stock history** | `eod`, `ohlc`, `trade`, `quote`, `trade_quote` | eod, ohlc, trade (extended-hours rebuild, `barSanity`), trade_quote (Terrain's stock tape and venue mix) | `history/quote` (tick NBBO): stock spread and quote-stability history; the stock half of a fill audit (idea 1) | S–M |
| **Stock at-time** | `at_time/trade`, `at_time/quote` | no | Fill audit for share trades and assignment price checks (idea 1) | S |
| **Stock flat files** | `trade_quote` (~14 GB/day), `eod` (1.5 MB), `quote` | no; **denied by our proxy** | `eod`: the whole market's daily bars in **one** request (universe scans, breadth). Avail.: **unknown** ("professional users", last 7 days only) | M |
| **Option lists** | `symbols`, `dates`, `expirations`, `strikes`, `contracts/{trade,quote}` | all but `strikes` (backtest, chains, palette) | `list/contracts/trade`: "which contracts actually traded that day" for screens without a chain walk | S |
| **Option snapshot: market** | `ohlc`, `trade`, `quote`, `open_interest`, `market_value` | ohlc, quote, open_interest | `snapshot/trade` (last print per contract: last-sale vs NBBO on every chain row); `market_value` (§7) | S |
| **Option snapshot: greeks, Black-Scholes** | `implied_volatility`, `first_order`, `second_order`, `third_order`, `all` | first_order (Compass, Weigher, cone, `chainStore`); second_order (Compass Setup, Terrain `chainFeed` → `charmDrift`); all (`/api/terrain/chain`, `reviewLive`) | `third_order` (speed, zomma, color, ultima): how a position's gamma and vega themselves move (idea 13). **Weigher gamma** could come from here instead of UW (§4.1) | S–M |
| **Option snapshot: greeks, binomial** | `binomial_greeks/{first,second,third}_order`, `/all` | no | American-style greeks for single stocks and ETFs: early-exercise and assignment risk around ex-dividend dates; correct deltas on deep in-the-money equity puts (ideas 13, 16) | M |
| **Option history: market** | `eod`, `ohlc`, `trade`, `quote`, `trade_quote`, `open_interest` | all six (charts, tapes, ledger, backtest, Building, exposure rebuild) | Already used; the gap is **use**: per-trade fill audit, cost map, hype checker, 0DTE atlas (ideas 1, 4, 5, 9) | — |
| **Option history: greeks, quote-based** | `greeks/eod`, `greeks/all`, `first_order`, `second_order`, `third_order`, `implied_volatility` | eod (Terrain prior surface); first_order (Compass Setup); implied_volatility (`/api/exposure/hist`) | `greeks/all` at an interval: gamma, vanna and charm **as the vendor computed them** for any past minute. Feeds the exposure rebuild (§4.2), P&L attribution (idea 2), the gamma time machine (idea 10) | M |
| **Option history: per-trade greeks** | `trade_greeks/{all,first,second,third}_order`, `trade_greeks/implied_volatility` | no (one research reference) | **The greeks and IV at the instant of every print.** Dollar-delta and dollar-gamma of the tape, signed at the quote; "what risk changed hands" per print (ideas 2, 7) | M |
| **Option history: binomial** | `binomial_greeks/{eod,all,…}`, `binomial_trade_greeks/*` | no | American-model history for single-stock studies | M |
| **Option at-time** | `at_time/quote`, `at_time/trade` | at_time/quote (Weigher entry range, Compass, `modelRiskScan`) | **The fill audit's core read**: the NBBO at the millisecond of a user's fill (idea 1). `at_time/trade`: the last print before that instant | S |
| **Option flat files** | `trade_quote` (~1.2 GB/day), `quote` (~38 GB), `open_interest` (~50 MB), `eod` (~150 MB) | no; denied by our proxy | OI and EOD files: **every optionable name's OI change and day summary in 2 requests a day** (idea 12). Avail.: **unknown**, last 7 days only | M |
| **Index** | `list/symbols`, `list/dates`, `snapshot/{ohlc,price,market_value}`, `history/{eod,ohlc,price}`, `at_time/price`, `flat_file/eod` | snapshot/price, history/eod, history/ohlc (prices, the vol regime, the overnight VIX); history/price research only | `history/price`: SPX's ~1-second prints since 2017 for exact settlement-minute studies (idea 9); `at_time/price` for fill audits against the index | S |
| **Calendar, rates** | `calendar/{today,on_date,year_holidays}`, `interest_rate/history/eod` | all four | — (the product also keeps its own holiday table, §4) | — |
| **Streaming** (`ws://127.0.0.1:25520`) | stock trades, full trade, quotes, market value; option trades, **full trade stream**, quotes, market value; index price, market value | **no** | Replaces the 1 s snapshot polling (Weigher, Paper) and the minute-window `trade_quote` reads (Terrain tape) with pushed prints and quotes. It frees the 8 request slots for history, and the live tape lags by seconds instead of a minute or more for 0DTE expiries (`tapeServer.ts`: a current-day read costs "about a minute"). Avail.: **likely**, not verified | M–L |

### 3.2 Unusual Whales (224 GET routes; 130 match our allowlist)

| Family | Routes | Avail. on our key | Used? (where) | Not used → what it could power | Effort |
|---|---|---|---|---|---|
| **Gex / Greeks** | `greek-exposure` (+`/strike`, `/expiry`, `/strike-expiry`), `spot-exposures` (+`/strike`, `/expiry-strike`), `gex-levels`, `greek-flow` (+`/{expiry}`), `greeks` | yes (sweep 2026-10-22; probe: `greek-exposure` 250 days, `spot-exposures?date=2024-01-10` 547 minute rows, `SPX/spot-exposures/strike` 200) | Pinpoint, Terrain, Pulse books, the recorder; `greek-flow` on Pinpoint | **History**: daily charm/vanna/gamma/delta exposure for a year, and per-minute aggregate exposure (by OI, volume and direction) back to 2023-12, both **unused**. They would serve as the baseline for the gamma time machine (idea 10). `gex-levels` (rebuilt 2026-08-22 on directional volume, with `nearby_flips`) and `greeks?expiry=` are allowlisted but no code calls them | S–M |
| **Stock vol** | `iv-rank`, `volatility/term-structure` (+`/distribution`), `interpolated-iv` (+`/distribution`), `volatility/{realized, realized/windows, stats, anomaly, character, context, option-sentiment, variance-risk-premium (+/windows)}`, `historical-risk-reversal-skew` | yes (probe: all 200; VRP 231 days; RR skew 32 rows) | iv-rank, term-structure, interpolated-iv (books, cone); stats, anomaly, character, context, sentiment, distributions (Dossier and Pinpoint, **one-shot**) | **VRP and its windows, realized windows and RR-skew history: unused.** They power the implied-vs-realized scorecard (idea 6) | S |
| **Vol screeners** | `volatility/{anomaly,character,option-sentiment}/top`, `volatility/vix-term-structure` | the three tops yes (probe 200; `anomaly/top` needs `direction`); vix-term-structure **no** (403, volatility add-on) | no | "Which names' vol is unusual today" lists; the product already builds its own VIX term structure from index prices (`/api/regime/vol`), which is the right call without the add-on | S |
| **Stock flow and positioning** | `flow-per-strike`, `flow-per-expiry`, `flow-per-strike-intraday`, `flow-recent`, `net-prem-ticks`, `nope`, `max-pain`, `options-volume`, `option/stock-price-levels`, `stock-volume-price-levels`, `option-stance`, `unusualness`, `atm-chains`, `option-contracts`, `option-chains`, `expiry-breakdown`, `oi-per-strike`, `oi-per-expiry`, `oi-change`, `option/volume-oi-expiry` | yes (probe: `option-chains` 12,952 symbols, `expiry-breakdown` 35 expiries, `flow-recent` 50, `options-volume` with 7/30-day averages, `unusualness` percentiles; `option-stance` 422 until its `stance` enum is right) | most of the list (Pinpoint, Trace, Weigher, Dossier) | `options-volume` (call/put by side with 7- and 30-day averages, daily history) and `unusualness` (volume percentile vs ~90 sessions): honest "how unusual is today" context. `expiry-breakdown`: one call gives OI and volume per expiry. `flow-per-strike-intraday`, `option/stock-price-levels`, `option-stance` are allowlisted but no code calls them | S |
| **Stock data** | `info`, `stock-state`, `quote`, `ohlc/{size}`, `technical-indicator/{fn}`, `earnings`, `insider-buy-sells`, financials ×5, `{sector}/tickers`, `ownership` | yes, except `ownership` (enterprise) | all but `technical-indicator`, `stock/{t}/earnings`, `insider-buy-sells` | `stock/{t}/earnings`: EPS history to 1996 (probe: AAPL 157 rows). `insider-buy-sells`: insider buying and selling by filing date to 2003. Both serve the event lab (idea 11). **`technical-indicator` is stale**: RSI data ends 2026-08-03 (probe), so do not use it. The product computes its own indicators, which is right | S |
| **Option tape** | `option-trades` (+`query` DSL, new 2026-10-13), `flow-alerts` (+`/{id}`), `multi-leg` (+legs), `full-tape/{date}`, `exchange-breakdown/{date}`, `optionable-tickers` | trades, alerts, multi-leg yes; **full-tape yes** (302 → signed `storage.googleapis.com/.../YYYY-MM-DD-option_trades.zip`, not downloaded); exchange-breakdown and optionable-tickers **no** (422, Advanced) | Trace, Compass tape rail, alerts, Terrain off-Terrain flow pane | **Full tape**: the whole market's tagged option prints for a day, one download, back to our 2023-12 lookback. A nightly market-wide flow archive would cost 1 request a day. It duplicates ThetaData's `trade_quote`, but arrives already tagged (side, sweep, multi-leg, `ticker_open_int`) (ideas 7, 8). `option-trades?query=` would let Trace filters run on the vendor's side | M |
| **One contract** | `option-contract/{id}/{flow,historic,intraday,volume-profile}` | yes (probe 200 on all four) | flow, historic, intraday (Trace) | `volume-profile`: volume at each price with ask/bid/mid/sweep/floor splits, for "where did this contract trade today" (idea 7) | S |
| **Market-wide** | `market-tide`, `{sector}/sector-tide`, `{etf}/etf-tide`, `top-net-impact`, `net-flow/expiry`, `economic-calendar`, `fda-calendar`, `insider-buy-sells`, `daily-report`, **`oi-change`, `correlations`, `sector-etfs`, `total-options-volume`**, `movers` | all yes except `movers` (403, Advanced) | the first nine (Trace, Dossier) | **`market/oi-change`** (the market's biggest OI builds, with the prior day's volume by side), `total-options-volume` (daily market call/put volume and premium), `sector-etfs`, `correlations`: none used, none allowlisted. They make a Pulse "where positions were built" card (idea 12) | S |
| **Screeners** | `screener/{stocks, option-contracts, analysts}`, `stocks/dsl`, `option-activity/unusual` | yes (probe 200) | stocks, option-contracts, analysts | `option-activity/unusual` (with `days_of_oi_increases`, `vol_pctile_15d`, `is_new`): the vendor's "unusual" set, worth **auditing** rather than relaying (idea 8) | S |
| **Dark pool and lit** | `darkpool/{recent,{t},{t}/price-levels}`, `lit-flow/{recent,{t}}` | yes (probe: `darkpool/SPY?date=2024-01-10` 200) | Trace, Dossier | — | — |
| **Group flow, Options Pulse, FLEX, ETFs, seasonality** | `group-flow/*`, `options-pulse/*`, `stock/{t}/options-pulse`, `flex-options/*`, `etfs/*`, `seasonality/*` | yes (`flex-options/market`: 495 days) | FLEX (Pinpoint, list only), ETFs, seasonality (Dossier) | `group-flow` (e.g. mag7 delta/vega flow) and `options-pulse` are allowlisted but no code calls them | S |
| **Ownership and politics** | `insider/*`, `institution(s)/*`, `institution/{n}/activity/v2`, `congress/*`, `congress/unusual-trades*`, `politician-portfolios/*`, `politics/fec/*` | insiders, institutions, congress yes; `unusual-trades` no (premium); `politician-portfolios` no (enterprise); `politics/*` no (add-on) | Dossier, Terrain name card | `institution/{n}/activity/v2`: a holder's quarter-over-quarter changes | S |
| **Filings, news** | `news/headlines`, `potus/*`, **`sec-filings`** (new 2026-10-31, cursor paging) | yes (probe: AAPL filings to 2026-11-06) | headlines, POTUS | **`sec-filings`**: 8-K, 10-Q, Form 4 and 13D/G markers on Terrain's events lane and in the Dossier (idea 15) | S |
| **Prediction markets** | `predictions/{ticker/{t}, unusual, market/*, whales, smart-money, insiders, users}` | yes (probe: `ticker/AAPL`, `unusual` 200) | no; not allowlisted | **"Two markets, one question"**: a prediction market's price for "AAPL above $270 on date X" next to the option surface's risk-neutral probability for the same event (idea 14) | M |
| **Crypto** | `crypto/*` | yes (probe: `whale-transactions` 200 but **stale**, every row 2026-03-02) | no | Out of scope for an options terminal | — |
| **Account features** | `alerts`, `alerts/configuration`, `alerts/filters`, `alerts/query/grammar`, `watchlists/*` | yes (probe 200; one alert config on the account, watchlists empty) | no (Slayer has its own alerts and watchlists) | Not for users: these are the **owner's** UW account objects, not per-user. The grammar documents the vendor's field set | — |
| **Directory** | `stock-directory/ticker-exchanges` | yes (18,909 tickers) | no | Listing exchange per name for the ticker universe | S |
| **Advanced-only** | `companies/*` (profile, dividends, splits, estimates, transcripts), `economy/*`, `forex/*`, `commodities/*`, `digital-currencies/*`, `analytics/*`, `calendar/ipo`, `companies/listings`, `market/movers`, `futures/*`, WebSocket | **no** (403/422/401, probe) | — | The one real loss: **dividends and splits**, which the American-exercise and assignment ideas need (idea 16). The product's carry uses the screener's trailing yield instead | — |
| **Kafka** | 37 topics, incl. `option-quotes`, `option-states`, `live-gex` | no (Startup + Kafka, $3,000/mo) | — | — | — |

**Allowlist hygiene.** These are on the allowlist but refused for our key, so any call is wasted: `/politician-portfolios/*`,
`/stock/{t}/ownership`, `/option-trades/exchange-breakdown/*`. These are allowlisted but no code calls them:
`gex-levels`, `greeks`, `flow-per-strike-intraday`, `option/stock-price-levels`, `option-stance`, `unusualness`,
`volatility/realized(/windows)`, `variance-risk-premium(/windows)`, `historical-risk-reversal-skew`, `options-pulse`,
`group-flow`, `options-volume`, `volume-profile`.

---

## 4. Where the product computes or mixes what a key already gives

### 4.1 Things a key gives directly that we model or take from the other vendor

1. **Weigher gamma from UW, delta and IV from ThetaData.** `src/data/weigherDesk.ts` `withVendorGamma` (owner's call,
   2026-10-31) because "the first-order snapshot sends no gamma". But Pro serves gamma in
   `/option/snapshot/greeks/second_order` and `/all`, and the server already reads `greeks/all` for every Terrain chain
   (`/api/terrain/chain`). One contract's row then holds two vendors' greeks: different timestamps, underlying prices
   and vols. *Fix: read ThetaData's gamma, or reuse `/api/terrain/chain` (S). The owner set this rule, so he has to
   reverse it.*
2. **ThetaData greeks asked with no dividend.** No ThetaData greek request passes `annual_dividend`, so every delta
   and IV for a dividend payer (SPY ~1.0%, high-yield single names) assumes q = 0. Meanwhile the Weigher's own carry
   reads UW's trailing yield (`carryFeed.ts`). *Fix: pass `annual_dividend=<yield>` on the snapshot and history greek
   reads (S).*
3. **Past-day exposure rebuilt with our own Black-Scholes.** `/api/exposure/hist` reads `history/greeks/implied_volatility`
   on a 30-minute grid and recomputes gamma, vanna and charm itself. `history/greeks/all` (Pro) returns the vendor's
   gamma, vanna and charm at the same grid in the same number of requests. UW's `spot-exposures?date=` also gives the
   aggregate per-minute exposure back to 2023-12 as a cross-check. *(M; keep the own model only where the vendor's row
   is missing, and label it as such.)*
4. **Dealer charm/vanna drift.** `charmDrift.ts` computes it from ThetaData's second-order greeks (vendor values, so
   this is fine). UW's `spot-exposures` already carries `charm_per_one_percent_move_{oi,vol,dir}` and
   `vanna_per_one_percent_move_*`, so the same chart can show both and say where they disagree.
5. **Realized vol.** The vol-outlook tile fits on a year of one-minute bars (its own model, which is legitimate). UW's
   `volatility/realized/windows` and `variance-risk-premium` are unused, and they would let the tile show the vendor's
   number beside ours.

### 4.2 The reverse: we take from a vendor what the rule says is the other's, or what we could compute better

- **Expected-move cone on Theta pages reads UW first** (`coneFeed.ts`; `DATA_MAP.md` R2.4, still open).
- **Rate on Trace and the Dossier is a constant 4.2%** (`DEFAULT_R`) while SOFR is one ThetaData read a day. This is
  the rule as written: those rooms ask the terminal nothing. A server-side copy of the hub's daily rate would honour
  the rule (owner decision).
- **Holidays**: a local table (`shared/marketCalendar.mjs`) and `calendar/year_holidays` both exist. Keep the table as
  the fallback, and check it against the endpoint once a year (`scripts/holidays-proof.ts` exists).
- **A standing contradiction**: `docs/launch-costs.md` ch. 3 (2026-09-17) says "never their derived Greek exposure —
  the walls and the flip are computed from ThetaData's chains by our engine", yet Pinpoint, Terrain and Pulse draw
  UW's exposure (`DATA_SOURCES.md`). This matters for licensing. Our own exposure computed from ThetaData is our
  derived work under one licence. UW's exposure shown to users is UW data redistributed. Pick one before launch.

### 4.3 Duplicate fetching of the same data from both vendors

| Data | UW reader | ThetaData reader | Consequence |
|---|---|---|---|
| Underlying price | `stock-state` / `quote` (Pinpoint, Trace, Dossier, the alerts re-arm, Terrain's rail spot) | `snapshot/trade` (other rooms) | Terrain can show two prices for one name at once (`DATA_MAP.md` R2.1–R2.2) |
| One-minute bars | `ohlc/1m` (book, NameDesks, Trace, Dossier, indicator alerts) | `history/ohlc` (charts) | Indicator alerts on Theta rooms judge different bars than the chart shows (R2.6) |
| Option tape and tags | `option-trades` (Trace, tape rail, alerts, non-Terrain flow panes): the vendor's side and sweep tags | `history/trade_quote` (Terrain), tagged by our `printTags.ts` | **The same print can read "sweep" on one page and "single" on another.** Pick one tagger per print and show its rule |
| Off-exchange prints | `darkpool/*` (Trace, Dossier) | `stock/history/trade_quote` venue mix (Terrain) | Two "dark-pool" numbers for one name |
| OI change | `oi-change` (Trace Footprints, Building's fallback) | `history/open_interest` (Building) | Proven to agree (`scripts/golden/pinpoint-golden.ts`); fine |
| IV term and expected move | `term-structure`, `interpolated-iv` | first-order ATM IV | The cone (above) |
| Per-contract greeks | `option-contracts` (Pinpoint, Weigher gamma) | `snapshot/greeks/*` (Weigher, Compass, Terrain) | §4.1 item 1 |
| Exposure | `spot-exposures` (live, recorder) | rebuilt from OI and IV (`/api/exposure/hist`, research `engine/positioning.py`) | Live and past days on Terrain's field come from different models; the field labels the rebuilt day, which is right |

---

## 5. Product ideas from the raw data: the top 15

**Ground rule.** The owner's research tested about 340 pre-registered variants (flow, news, dark pool, gamma flip, pin,
momentum, reversal, event straddles, VWAP, vol forecasts). It found no long-only edge that survives costs (§0 item 5).
Its two findings that matter for product are these. Short-dated long options pay the variance risk premium: realized
vol ran ~0.91× the 0DTE implied, and scheduled releases realized ~0.3× the priced move. And a 0DTE round trip costs
~5–15% of premium. So the defensible products **measure, explain, verify and simulate**. Every idea below avoids
"signals that win". Several of them exist to show users, with our own history, that signals usually don't.

**Scoring.** Value to a retail options trader (V), defensibility, meaning how hard it is to copy without tick history
and the pipeline we already built (D), and feasibility with exactly these keys and the 8-slot terminal (F). Each is
1–5, ranked by V×D×F.

| # | Idea | V | D | F | Score |
|---|---|---|---|---|---|
| 1 | Fill-quality audit | 5 | 5 | 4 | 100 |
| 2 | Trade autopsy (greek P&L attribution) | 5 | 4 | 4 | 80 |
| 3 | Cost-to-trade map | 4 | 4 | 5 | 80 |
| 4 | "Could you really have made that?" checker | 4 | 5 | 4 | 80 |
| 5 | Backtester with the coin-flip baseline always on | 5 | 5 | 3 | 75 |
| 6 | Implied-vs-realized scorecard | 4 | 4 | 4 | 64 |
| 7 | "Did it open?" print verification | 4 | 4 | 4 | 64 |
| 8 | Flow-alert follow-through ledger | 4 | 4 | 3 | 48 |
| 9 | The 0DTE clock atlas | 4 | 4 | 4 | 64 |
| 10 | Gamma time machine with level calibration | 4 | 4 | 3 | 48 |
| 11 | Event lab (CPI, FOMC, earnings) | 4 | 3 | 4 | 48 |
| 12 | Where positions were built (market-wide OI) | 3 | 4 | 3 | 36 |
| 13 | What-if lab on the live surface (third order, American) | 3 | 3 | 4 | 36 |
| 14 | Two markets, one question (prediction markets vs options) | 3 | 5 | 3 | 45 |
| 15 | Filings timeline on the chart | 3 | 2 | 5 | 30 |

Rows follow the sections below, which keep related ideas together. By score the order is: 1; then 2, 3 and 4 (80);
5 (75); 6, 7 and 9 (64); 8, 10 and 11 (48); 14 (45); 12 and 13 (36); 15 (30).

### 1. Fill-quality audit (score 100)
- **Data:** `option/at_time/quote` and `at_time/trade` at the fill's millisecond; `history/quote` (tick NBBO) for the
  minute around it; `history/trade_quote` for what others paid in the same second. Stock and index equivalents for
  share fills and assignment.
- **What the user sees:** for every trade in the Journal or Paper (or a pasted or imported broker fill): the NBBO and
  displayed size at the fill, cents of price improvement or slippage, the effective spread paid as a percent of premium,
  how the same contract printed in the next 60 seconds, and a running "you have paid $X in spread this month".
- **Why retail doesn't have it:** brokers publish Rule 605/606 aggregates, not per-fill NBBO. Tick NBBO history for
  options is expensive and rare. It is also the one number every trader can act on without a forecast.
- **Limits:** needs a fill time to the second (broker exports vary; some give only the minute, so show a band). OPRA
  NBBO is not every venue's book. Showing historical NBBO to users is still display under ThetaData's licence. Data
  older than 15 minutes carries **no OPRA fees** (`launch-costs.md` ch. 2), so this idea is cheap to license on the
  exchange side. Cost: 1–3 requests per fill.

### 2. Trade autopsy: where the money came from (score 80)
- **Data:** `option/history/greeks/all` (first, second and third order on a 1-minute grid) and `history/quote` for the
  holding period; `trade_greeks` at entry and exit prints.
- **What the user sees:** each closed trade's P&L split into direction (delta), convexity (gamma), decay (theta), vol
  (vega, the IV change), the spread paid on entry and exit, and an unexplained residual. "You were right on direction
  (+$140) and paid $95 to theta and $60 to the spread."
- **Why retail doesn't have it:** it needs per-minute greek history, which Pro has and retail platforms don't serve.
  It turns a loss into a lesson, with no forecast involved.
- **Limits:** a Taylor attribution leaves a residual on big moves, so show it, never hide it. The greeks are
  ThetaData's Black-Scholes; American single-stock contracts need the binomial history (M). Cost: about 2 history
  requests per trade, and it runs once.

### 3. Cost-to-trade map (score 80)
- **Data:** the live `snapshot/quote` the chains already read; `history/trade_quote` for where prints actually land
  inside the spread (at the bid, mid or ask) per contract and minute; displayed sizes.
- **What the user sees:** on every chain row, the round-trip cost as a percent of premium. A heat map across strikes and
  expiries shows where trading is cheap. Each contract gets "typical fill: 62% of prints at or inside mid" and "the
  spread widens 3× in the last 10 minutes".
- **Why retail doesn't have it:** chains show bid and ask, not what the spread does to a small account's expectancy.
  The research measured 5–15% for 0DTE round trips. Users rarely see that figure, and the brokers have little reason
  to show it.
- **Limits:** displayed size is not depth. The live part costs no new requests; the history part costs one
  trade_quote read per root and day, cached.

### 4. "Could you really have made that?" checker (score 80)
- **Data:** tick NBBO and prints (`history/quote`, `trade_quote`), `at_time/quote`.
- **What the user sees:** paste a claim ("SPY 768C went 5.8× on Nov 4"). The page shows the contract's bid path, the
  best exit actually available at the bid, the time spent above each multiple, the size on the bid at the high, and
  what a realistic entry and exit (ask in, bid out, 2 s delay) returned.
- **Why retail doesn't have it:** screenshots of last-sale highs drive options social media, and nobody checks them
  against the quote at scale. The owner's own V1 study started from such a claim. Its 24 variants all failed.
- **Limits:** shareable cards that display quotes are redistribution and need the commercial licence. Keep them
  delayed and historical. Cost: 2–4 requests per check.

### 5. Backtester with the coin-flip baseline always on (score 75)
- **Data:** what Practice's backtest already replays (`history/quote` at 1 s, `list/contracts/quote`), plus the
  research harness's nulls: shuffled side, random entry minute and a zero-drift path at real vol
  (`research/compass-v2`).
- **What the user sees:** every backtest result beside the same rules run on random entries with the same costs, a
  confidence interval, and a plain verdict: "indistinguishable from chance", "worse than chance" or "better than
  chance, here is the out-of-sample check". Fills are ask in, bid out on the first quote at least 2 s after the
  decision, with displayed size.
- **Why retail doesn't have it:** retail backtesters fill at mid or last on minute or end-of-day data, and none show
  the null. This is the most defensible asset in the repo, because the pipeline already caught a fabricated 88% win
  rate.
- **Limits:** compute and terminal time (one-day history reads, 8 slots shared). The greeks history is thinner before
  ~2018–2020 (`DATA_COVERAGE.md`). The tool must refuse to rank strategies by in-sample return.

### 6. Implied-vs-realized scorecard (score 64)
- **Data:** ThetaData `history/greeks/eod` (ATM IV per expiry), daily bars since 2012; UW `variance-risk-premium`
  (+windows), `volatility/realized/windows`, `interpolated-iv`, earnings history.
- **What the user sees:** per name and per horizon, how often the priced move was exceeded over years, the average
  ratio of realized to implied, and the same split for earnings weeks and macro days. "SPY's 0DTE priced move was
  exceeded on 31% of days; realized averaged 0.91× implied."
- **Why retail doesn't have it:** platforms show the expected move. They don't show its track record per name over a
  decade.
- **Limits:** it is descriptive. Present it as the price of insurance, not as a sell signal: short premium has fat
  tails, and the page must show the worst days. Cost: once per name, then one row a day.

### 7. "Did it open?" print verification (score 64)
- **Data:** ThetaData's `trade_quote` tape (already tagged and sided in `tapeServer.ts`), next morning's
  `history/open_interest` (already cached by `/api/oi-change`), `trade_greeks` for dollar-delta per print, UW
  `option-contract/{id}/volume-profile`.
- **What the user sees:** yesterday's large prints marked "opened: OI +4,800", "closed: OI −3,100" or "unclear", plus
  each print's dollar-delta and dollar-gamma at its own instant.
- **Why retail doesn't have it:** flow products show prints live and never come back to say whether a print was an
  opening position.
- **Limits:** OI is net per contract per day, so a single print can't be proven an opener. Show "consistent with",
  never "was". The verdict arrives a day late (OI posts about 06:30 ET).

### 8. Flow-alert follow-through ledger (score 48)
- **Data:** UW `flow-alerts` and `option-activity/unusual` from 2023-12-06 (stamped at `created_at`), each alert's
  contract path from ThetaData history at real fills; the full-tape zip for the market-wide base rate.
- **What the user sees:** every alert class's distribution of outcomes at realistic fills: median, quartiles and hit
  rate against a random-contract baseline. One alert's own outcome is shown only inside that distribution, never alone.
- **Why retail doesn't have it:** alert sellers market winners. A neutral, complete ledger is a trust product. The
  owner's F1 family (27 exits) already found that aggressive flow lost after costs.
- **Limits:** publishing UW's alerts and derived statistics needs UW's redistribution licence, and the vendor may
  object. Present it as our measurement of public prints where possible (ThetaData tape). Effort M.

### 9. The 0DTE clock atlas (score 64)
- **Data:** years of 0DTE quotes and bars (SPXW since 2014 and daily from 2023; SPY and QQQ daily from 2023), SPX
  one-second index prices since 2017 (`index/history/price`), `history/greeks/all`.
- **What the user sees:** minute by minute through the session, for each moneyness bucket, the median decay, spread,
  realized range, and the odds of finishing in the money given the price at that minute. "At 14:30, a 10-delta call
  finished in the money 6.8% of days; it costs 12% of premium to round-trip."
- **Why retail doesn't have it:** 0DTE is the most-traded retail product and the least explained one.
- **Limits:** only a few years have daily expiries (SPY from 2023, IWM from 2025). Present it as base rates, never as
  timing advice.

### 10. Gamma time machine with level calibration (score 48)
- **Data:** ThetaData `history/open_interest` (all expiries) × `history/greeks/all` at 30-minute or 1-minute
  resolution, from ~2018. UW `spot-exposures?date=` and `greek-exposure` as a cross-check from 2023-12.
- **What the user sees:** the dealer-exposure map for any past day, with the price path drawn over it. Calibration
  stats show how often the price held, crossed or pinned each kind of level, and how realized vol differed when the
  estimated gamma was positive or negative.
- **Why retail doesn't have it:** "gamma levels" are sold everywhere and almost never measured. The owner's E3
  (gamma sign irrelevant) and E6 (pin −13.6%) results are exactly this measurement.
- **Limits:** the dealer sign is an assumption (dealers long calls and short puts). Intraday OI is unknown, and the
  page must say so in words. Compute: ~13 s per name and day (`DATA_COVERAGE.md` §2), kept on disk.

### 11. Event lab (score 48)
- **Data:** UW `economic-calendar`, earnings history (`stock/{t}/earnings` to 1996), ThetaData history around each
  event (IV before and after, straddle quotes, the realized move).
- **What the user sees:** each CPI, FOMC, NFP or earnings event with the priced move, the realized move, the IV crush,
  and what a straddle bought at the ask and sold at the bid returned, for every past instance.
- **Why retail doesn't have it:** earnings-move pages exist. Execution-honest straddle outcomes over years mostly don't.
- **Limits:** UW's economic calendar is forward-looking, so a history of event dates must be built and kept. D1–D3 in
  the research all failed, so the page teaches pricing, not entries.

### 12. Where positions were built, market-wide (score 36)
- **Data:** UW `market/oi-change` and `total-options-volume` (open on our key, both unused). ThetaData option
  OI and EOD **flat files** (2 requests a day for the whole market, if our tier has them). Otherwise
  `history/open_interest` per root.
- **What the user sees:** each morning, the contracts and names where open interest grew most, with the prior day's
  volume by side and the price action since.
- **Limits:** flat-file access is unverified and covers the last 7 days only, so start the archive the day it works.
  This is the same "did it open" caveat at market scale.

### 13. What-if lab on the live surface (score 36)
- **Data:** `snapshot/greeks/all` (third order: speed, zomma, color, ultima), `snapshot/binomial_greeks/all`
  (American), the real surface rather than a flat vol.
- **What the user sees:** a position's P&L grid over price × time × IV, read off the actual skew. It shows how its
  gamma and vega change as the price moves, and for single stocks the early-exercise boundary.
- **Why retail doesn't have it:** most retail analyzers use one IV for every strike and European pricing.
- **Limits:** the binomial `expiration=*` reads are capped at 101 steps and cost grows with steps², so read them per
  expiry. Dividend dates aren't on our UW tier.

### 14. Two markets, one question (score 45)
- **Data:** UW `predictions/ticker/{t}` (open on our key; markets such as "Will AAPL close above $270?" with
  `event_type`), the option surface's risk-neutral probability for the same strike and date (a call-spread price from
  ThetaData quotes).
- **What the user sees:** the prediction market's price beside the options market's for the same event, and the
  history of the gap.
- **Why retail doesn't have it:** nobody joins these two markets. It is genuinely novel and educational
  (risk-neutral vs crowd probability).
- **Limits:** prediction-market liquidity is thin, and resolution rules differ from option settlement. The gap is not
  an arbitrage for a retail account; say so. Prediction-market data carries its own regulatory and licensing questions.

### 15. Filings timeline on the chart (score 30)
- **Data:** UW `sec-filings` (every EDGAR form, cursor-paged, new 2026-10-31), `insider-buy-sells` history,
  `institution/{n}/activity/v2`.
- **What the user sees:** 8-K, 10-Q/K, Form 4 and 13D/G markers on Terrain's events lane, and in the Dossier's name
  file a "what was filed before the move" view.
- **Limits:** low defensibility (EDGAR is public), but cheap and useful context. Cost: 1 request per name per refresh.

**Also considered, not in the 15:**
- **Intraday positioning with an uncertainty band:** OI-based exposure vs flow-adjusted exposure (UW `*_dir` and
  `*_vol` columns, signed ThetaData volume), showing where they disagree. M.
- **Assignment and pin-risk monitor:** blocked by the missing dividend calendar. Advanced tier, or another source.
- **Streaming upgrade:** infrastructure rather than an idea. It makes ideas 3, 7 and 9 live.

---

## 6. Quick wins (each under a day)

1. **Pass `annual_dividend`** on every ThetaData greek request. The yield is already read into `core/carry.ts`.
   Dividend payers' greeks become right.
2. **Cost-to-trade badge** on Weigher and Paper chain rows: round-trip spread as a percent of mid, from the quotes
   already in hand. No new requests.
3. **Fill check v0 in the Journal**: one `at_time/quote` per trade with a timestamp, showing the NBBO at the fill and
   the slippage in cents. The Weigher already reads this endpoint.
4. **"Opened / closed" marks on yesterday's large Terrain prints** from the OI change `/api/oi-change` already caches
   per contract.
5. **VRP line on Pulse's Vol outlook tile or the Dossier's vol block**: add `/stock/{t}/volatility/variance-risk-premium`
   and `/windows` to the allowlist, one request per name per day.
6. **Market OI builds card** (Pulse or Trace day panel): allowlist `/market/oi-change` and
   `/market/total-options-volume`.
7. **SEC filing markers** on Terrain's events lane: allowlist `/sec-filings`, one request per name.
8. **Allowlist hygiene**: remove the three refused routes (`/politician-portfolios/*`, `/stock/{t}/ownership`,
   `/option-trades/exchange-breakdown/*`), and record that `technical-indicator` (ends 2026-08-03) and
   `crypto/whale-transactions` (2026-03-02) are stale.
9. **Weigher gamma from ThetaData's second order** (or from `/api/terrain/chain`), with an owner sign-off. One
   vendor and one timestamp per row.
10. **One tagger per print**: show the rule a page's "sweep" comes from in the hover (the vendor's flag on Trace, our
    OPRA-condition rule on Terrain), so two pages that disagree say why.

---

## 7. Risks

1. **Licensing: the blocker for any user but the owner.**
   - ThetaData's retail subscriber agreement is for one individual: "data and derived works may not be
     redistributed", with no display to third parties without written consent.
   - UW Basic is personal use only, and its Conventions page says redistribution "requires a redistribution license".
   - So **every page shown to anyone else, including derived numbers like our exposure, needs the commercial
     agreements first.**
   - Priced in `docs/launch-costs.md`: the ThetaData bundle at $1,250/mo, then $2,000; UW Startup at $750/mo for
     commercial use, with redistribution under Enterprise at a custom price.
   - OPRA: real-time redistribution costs $650–1,500/mo plus $1.25 per non-professional user, **unless the data is
     more than 15 minutes delayed**. ThetaData's "Market Value" (penny-randomized) bundle is their proposed route
     around exchange fees and must be written into the contract.
   - **Strategic consequence:** ideas built on history (1, 2, 4, 5, 6, 9, 10, 11) are cheaper and simpler to license
     than live-tape products, and also more defensible.
2. **Vendor naming on screen.** UI strings were grepped for both vendor names. Status lines read "Live data offline —
   reconnecting", and no vendor name was found in rendered strings. (Code comments name them, which is fine.)
3. **Throughput.**
   - UW allows 3 requests in flight **for every viewer combined**. The hub and cache make that workable for one owner,
     not for a user base. Startup raises it to 5 (10 on the annual plan).
   - ThetaData allows 8 slots and one terminal per account, shared with research jobs (`thetaSlots.mjs` already
     reserves slots for the Compass engine).
   - A current-day `trade_quote` read for a 0DTE book can take one to five minutes (`tapeServer.ts`). The stream (§3.1)
     is the structural fix.
4. **History depth.**
   - UW: from 2023-12-06; daily greek exposure 250 days; headlines from 2026-08-06. UW-based studies have about two
     years of data.
   - ThetaData: options and stocks from 2012-06 (SPXW 2014, the SPX AM root 2016–18), one-minute greeks from about
     2018–2020, the SPX index from 2017, NDX history only from 2026-05-11, daily 0DTE only from 2023 (IWM 2025).
   - Flat files reach back 7 days only.
   - Whether ThetaData's history keeps delisted underlyings is a survivorship question still open in
     `launch-costs.md` ch. 2 (contract item 4).
5. **Stale or shifting vendor data.**
   - `technical-indicator` ends 2026-08-03.
   - `whale-transactions` is frozen at 2026-03-02.
   - `gex-levels` changed method on 2026-08-22.
   - `option-trades`' `include_agg_trades` behaviour changed on 2026-10-30.
   - The `x-uw-req-per-minute-*` headers go away after 2026-12-31. Check that nothing reads them.
   - The UW changelog moves weekly. Re-read it before relying on any field.
6. **Claims risk.** No validated edge exists in the research. Any copy that implies the product "finds winning
   trades" contradicts the owner's own ledger and invites regulatory and reputational trouble. Measurement products
   avoid it: they say what happened and what it cost.
7. **Inference presented as observation.** Dealer sign, "opened", "sweep" and exposure walls are all inferences. The
   research already separates `obs_*` from `inf_*`, and the UI should do the same.

---

## 8. What this audit could not verify

- **Anything on the ThetaData terminal.** Not asked, by instruction. Tier (Pro options, stocks and indices) is
  inferred from history depth and from Pro-only endpoints the product already reads successfully. Specifically
  unverified:
  - streaming entitlements;
  - flat-file access;
  - third-order and binomial endpoints;
  - `trade_greeks`;
  - the rates tier;
  - NDX real-time.
- **UW full tape contents.** The route answered 302 to a signed download. The zip was not downloaded, so its size,
  columns and depth are unchecked.
- **UW `option-stance`.** It answered 422 for `stance=bullish`; the valid values were not looked up.
- **Exact licence clauses.** Neither vendor's full subscriber or redistribution terms render as text. This memo relies
  on their public summaries and `docs/launch-costs.md`. A lawyer should read the actual agreements.
- **Per-page UW cadences and counts.** Those are `DATA_MAP.md`'s (2026-10-29) and were not re-measured.

_Probe log (status and shape only) and the downloaded specs were kept in the session scratchpad, not in the repo._
