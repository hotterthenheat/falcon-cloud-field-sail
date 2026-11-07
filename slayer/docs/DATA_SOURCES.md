# Data sources — what the keys actually give us

Recorded from the owner on 2026-10-22. **Do not forget this.** Build against this list, not against what an
endpoint name suggests.

## Which vendor powers which page

- **Trace and the Dossier read Unusual Whales only.** No ThetaData call leaves their pages.
- **Pinpoint** reads its greeks, exposure, levels and flow from Unusual Whales, and from ThetaData only its live price
  and chart candles (stock and index snapshots and bars) and the one open-interest read below. No ThetaData greeks on
  Pinpoint.
- **Pinpoint's two books** (owner, 2026-11-07: "pinpoint has 2 models, one is the spot that comes from the keys and then
  another is thetadata math that we use to math dealer flow gex"; spec `docs/TWO_BOOK_SPEC_V2.md`, build
  `docs/TWO_BOOK.md`):
  - **Model 1, the open-interest book**, is Unusual Whales only: `/stock/{t}/spot-exposures/expiry-strike` (every page),
    `/stock/{t}/volatility/stats` (IV30) and `/stock/{t}/option-contracts` (every page: per-contract OI and IV), read on
    the server through the hub's background lane and shared by every viewer (`GET /api/twobook/oi`,
    `server/twoBookApi.mjs`, `src/data/twobook/model1Server.ts`). Its six house metrics are computed by the house engine
    from those rows; no ThetaData read.
  - **Model 2, the flow book**, reads ThetaData on the server: the option prints with the NBBO in force at each
    (`/option/history/trade_quote`, exclusive, with OPRA conditions — the server's option tape, `src/data/tapeServer.ts`,
    which now also classifies every print into the book's signed inventory), the current NBBO of the name's strip
    (`/option/snapshot/quote`, one read per root per board, every expiry the inventory holds, 30 strikes either side) and
    SOFR (`/interest_rate/history/eod`). One board per name on the server, held 20 s (`GET /api/tape/flowbook`,
    `src/data/twobook/flowBook.ts`); the browser asks the server only. Never Unusual Whales, never open interest.
  - Pinpoint also lists the names whose options only ThetaData lists: their flow book is served and their open-interest
    book says it is unavailable.
  - On screen neither vendor is named ("open-interest book", "flow book", "listed open interest", "today's prints").
- **Building's open-interest change** (Pinpoint's Building and Terrain's Building tab) is ThetaData's, allowed by the
  owner on 2026-11-01: the all-expiration open interest (`/option/history/open_interest?expiration=*`) for the two
  latest report dates, every listed contract, compared contract by contract. Read on the server, never by the browser:
  `GET /api/oi-change/<T>` (`server/oiChangeApi.mjs`, arithmetic in `shared/oiChange.mjs`), one request per root per
  report date (SPX reads SPX and SPXW, NDX NDX and NDXP, RUT RUT and RUTW), kept on disk under `.cache/oi-change` and
  shared by every page and viewer, two history reads at once at most. A report is stamped about 06:30 ET for the
  previous close, so the change between reports D−1 and D is session D−1's trading; Building's label names both dates.
  Only when the terminal cannot answer does Building fall back to Unusual Whales' `/stock/{t}/oi-change` list (the
  movers, every page each way), and its hover text says which source is in use. Each contract's change is still valued
  at Unusual Whales' per-contract gamma (`data/building.ts valueOiChange`). Proofs: `scripts/oi-change-proof.mjs`, and
  `scripts/golden/pinpoint-golden.ts` (the recorded Oct 27 and Oct 28 reports against a hand sum, and against the
  vendor's list for the same date: they agree on every contract both carry; the vendor's whole list missed 47 of SPY's
  3,999 moved contracts and 15 of NVDA's 1,687, its first page each way 2,999 and 703).
- **Terrain, Weigher, Compass and Practice** read ThetaData for real-time quotes, NBBO, chains, greeks, bars and
  history, and Unusual Whales for what ThetaData does not carry (exposure, flow, levels).
- The Weigher's per-contract **gamma** is Unusual Whales' (`/stock/{t}/option-contracts` `gamma`, the rows the name's
  book already reads; `src/data/weigherDesk.ts` `withVendorGamma`), set by the owner on 2026-10-31. ThetaData's
  first-order snapshot sends no gamma; the model's gamma stays only where the vendor has no row.
- `thetaCall` in `src/data/theta.ts` enforces this per page (`thetaUseHere`, `thetaAllowedHere`).
- The pricing rate (SOFR, `/interest_rate/history/eod`, `src/data/rateFeed.ts`) and the year's holidays
  (`/calendar/year_holidays`) are reference reads, not greeks or open interest: Pinpoint may ask them too. One shared
  path a day; the hub keeps the answer 24 h. Trace and the Dossier ask nothing: they price at the last rate this browser
  read, then the fixed `DEFAULT_R` (4.2%) in `src/core/carry.ts`, and use the holiday table in
  `shared/marketCalendar.mjs`.

- **Terrain's prints are ThetaData's** (approved 2026-10-31 from the ThetaData audit): the flow pane, the net drift,
  the events lane's print marks and the rail's Prints tab read the server's option tape (`/option/history/trade_quote`,
  every print tagged sweep / spread leg / floor / block / single off its OPRA conditions, sided at the quote), and the
  dark-pool overlay and the Prints tab's venue mix read the server's stock tape (`/stock/history/trade_quote`; today's
  is the merged SIP, fifteen minutes behind). One tape per name on the server (`src/data/tapeServer.ts`,
  `/api/tape/*`), at most two terminal reads at once; the browser asks the server only. **Trace and the Dossier are
  untouched:** their dark-pool room and tape stay on Unusual Whales. Other pages that host the chart keep the vendor's
  tape for the flow pane.

- **The ticker universe** (`src/data/generated/tickerUniverse.json`, written by `scripts/build-ticker-universe.mjs`,
  refreshed daily): every symbol either key lists, with the desks that can serve it. **Terrain** offers what ThetaData
  quotes with bars (a stock or fund quoted in the last 10 sessions with a bar in the last 30 days) and every index it
  priced in the last 10 sessions. **Pinpoint** offers the names whose Unusual Whales expiry list
  (`/stock/{t}/greek-exposure/expiry`, the list Pinpoint reads) has a live date; a name only ThetaData lists options on
  is not offered there. The option desks (Weigher, Paper, Backtest) offer ThetaData roots with a live expiration. The
  build reads ThetaData one request at a time and Unusual Whales one request at a time, 0.45 s apart (about 75 minutes
  for the vendor's expiry walk); `--master <csv>` also writes the full table both vendors' expiry lists sit in.
  `/option-trades/optionable-tickers` ("which symbols have listed options") is API Advanced only on this key (422), so
  the screener (`/screener/stocks`, paged with `offset` as a page number, 500 a page) and the expiry walk stand in.
  **Trace's** search offers the names Unusual Whales lists options on (the `v` flag; Trace reads Unusual Whales only),
  not ThetaData's (`o`, the Weigher, Paper and Backtest).

- **Expiration lists are checked against the contracts** (from the 2026-11-07 ticker audit, `reports/expiry_mismatches.csv`).
  ThetaData's `/option/list/expirations` carries dates no contract was ever listed on (56 on names both vendors carry:
  SPX 2088-07-10 … 2090-06-18, TT 2027-04-16, PWR 2027-08-20, RIO 2031-01-01; about a thousand more on roots only it
  lists) and lags new listings by a session or more (18 dates first quoted on 2026-11-06: SPX 2026-12-15, NDX
  2026-12-14, RUT 2026-11-23, SPY 2027-04-16 …). So the proxy answers every `/option/list/expirations` read — every
  page's and every server reader's, Terrain, the Weigher, Paper and Backtest, Compass, the tapes — with the checked
  list (`server/expiryCheck.mjs`, arithmetic in `shared/expiryEvidence.mjs`): a date from today on is offered only
  with at least one contract behind it in the root's current NBBO snapshot (`/option/snapshot/quote?expiration=*`), its
  current open-interest report (`/option/snapshot/open_interest?expiration=*`) or the contracts quoted on the last
  finished session (`/option/list/contracts/quote?date=D`), and a date those carry that the list lacks is added the
  day its contracts appear. Earlier dates pass as listed. Three reads a root (the snapshot kept 10 minutes, the report
  an hour, the session's list a day), through the same slots as any read; when none answers, the list goes out as the
  last universe build judged it (`expiries.phantom` / `expiries.added` in the generated file), and every verdict is
  logged once a day (`[expiries] SPX: … dropped …`). The universe build does the same with the whole market's quoted
  and traded contracts of the session, so the `o` flag means a live date with contracts.
  Unusual Whales' expiry list has the opposite fault on a few index products (CBTX, CBTXW, SPEQW, SPEQX; ISHP on
  2026-11-06): dates with no exposure and no contract on either vendor. The build lists them (`expiries.noContracts`)
  and every expiry picker hides them (`src/data/expiryListing.ts`, logged once); a date with no exposure yet that does
  have contracts (SPX 2026-12-15, a new listing with no open interest) stays. Two dates Unusual Whales was missing on
  2026-11-06, SUPN 2027-06-17 and XNDX 2026-11-20, are its own omissions (quoted on ThetaData, 40 and 18 contracts):
  nothing in the app can add them to its list, and no page that reads it needs them. Proof:
  `scripts/expiry-evidence-proof.ts` (the audit's cases, recorded in `scripts/fixtures/expiry-audit-2026-11-06.json`);
  against the live terminal, `node scripts/expiry-check-live.mjs`.

Set by the owner on 2026-10-22 (Pinpoint and Dossier on Unusual Whales), 2026-10-29 (Trace on Unusual Whales
only; ThetaData for Pinpoint's live price and candles) and 2026-11-01 (ThetaData's open interest for Building).

## Verified against the live key (2026-10-22)

These are on the list below but the key is refused with "enterprise only" — do not call them:

- `/stock/{t}/ownership` (Who holds the shares) — use `/institution/{t}/ownership` instead
- `/politician-portfolios/*` (annual disclosures, politician portfolios)

Also note:

- `/stock/{t}/greeks?expiry=YYYY-MM-DD` works (greeks for every strike of one expiry). It must be on the proxy's
  allowlist in `server/uwProxy.mjs` — every route the browser calls has to be listed there or the proxy answers 404.
- `/stock/{t}/option-contracts` takes `limit` up to **500** (not 1000) and pages with `page`; without `expiry` it walks
  every listed contract of the name. Pinpoint reads it paged (`whales.ts whalesOptionContractsPaged`) — one expiry, or
  the whole name in one walk when that needs fewer pages (round 6: SPY's Nov 30 / Dec 18 / Dec 31 were cut at 500).
- `/stock/{t}/spot-exposures/expiry-strike` without `expirations[]` returns every expiry's rows (one per strike and
  expiry, 500 a page) — the Board's All-expiries load reads a name's dates in one walk rather than one call a date.
- `/option-trades/exchange-breakdown/{date}` is gated to the API Advanced plan (422 "Missing access for the option tape" on this key) — not called, and the Live Tape's exchange panel is removed. It is the only route the three products used that this key refuses (browser sweep 2026-10-22: 40 pages, 7,621 calls, 146 distinct endpoints, every other one 200).
- Terrain's name search reads a name's report, wire, insiders and Congress in ONE request, `GET /api/name-card/<T>`
  (`server/nameCard.mjs`, behind the `/api/uw` gate): four hub reads of the browser's own allowlisted paths in the
  background lane, a copy up to 10 minutes old reused, the composed card kept 3 minutes server-side and asked at most
  once in 5 minutes per name by the browser (`src/data/nameCard.ts`), only after the pointer rests 450 ms.
- The Congress page needs only `/congress/*` (all open on this key); stock ownership ("Who is in it") reads `/institution/{t}/ownership` (open). The enterprise `/stock/{t}/ownership` and `/politician-portfolios/*` are extras the pages do not depend on.
- **The key allows only 3 concurrent requests, across everyone using it** (UW answers 429 "You have exceeded 3
  concurrent requests" and sometimes 500 past that). `server/uwProxy.mjs` therefore runs at most 3 upstream calls at
  once and queues the rest. A 429 trips one breaker for the whole key: every caller waits out the vendor's
  `Retry-After` (else 1, 2, 4 … 30 s) outside the slots, a viewer at most 8 s, background work not at all; a 429 is
  retried once and a 5xx twice, and the browser is told how long is left (`Retry-After`), so one refusal never
  multiplies into more calls. If the retry still fails the hub serves the last good copy (up to 4× the route's
  freshness, 20 min for a slow route) and says so: every answer carries `Age`, `x-hub-at` (when the vendor answered)
  and `x-hub-held: 1` once it is past its normal stale window, which `data/whales.ts` exposes as `UwAnswer.at`/`held`.
  In production every visitor shares those 3 slots, so the proxy cache is what keeps it usable — a higher plan or a
  shared server-side cache is needed before real traffic.
- **What the hub keeps warm with nobody watching** (`server/hub.mjs`, `.cache/hub-uw.json`): the paths viewers asked
  for more than once, remembered across restarts with the time of their last ask. A path whose date or expiry has
  passed is dropped at once, one nobody asked for in 3 days (`HUB_PIN_IDLE_DAYS`) is dropped, and one nobody asked for
  in a day is refreshed every 5 minutes instead of every minute; nothing is refreshed outside 04:00–20:00 ET on trading
  days (17:00 on early closes, closed on holidays, `shared/marketCalendar.mjs`).
- Futures and the rate strip are not carried: the Trace Futures tab is hidden from the navigation and `/trace/futures` redirects to the Live Tape (the page file is kept).

## Unusual Whales

REST only, at `https://api.unusualwhales.com`, with the bearer token (`UNUSUAL_WHALES_API_KEY`, server-side only —
the browser calls `/api/uw/*` and the proxy adds the token).

No WebSocket. No Kafka. No CME futures. No company profile, dividends, splits, forward estimates, or earnings-call
transcripts. No commodity series, economic-indicator series, forex, or digital-currency bars. No top movers, IPO
calendar, listings list, or analytics windows. No VIX futures term structure. No company-politics feed. No
private-markets feed. No flagged congressional-trade feed. History stops at the plan's lookback.

### Gamma and greeks
- GEX levels
- Greek exposure, by expiry, by strike, and by strike and expiry
- Delta and vega flow each minute, also split by expiry
- GEX each minute, by strike, and by strike and expiry
- The old strike-and-expiry GEX route is deprecated

### Option tape
- Filtered option trades
- Exchange and trade-code breakdown
- Flow alerts, and the trades inside one alert
- Full tape for one day, inside the lookback
- Multi-leg strategies, and the legs of one strategy
- Which symbols have listed options

### One contract
- Last trades, daily history, one-minute bars, volume profile
- Expirations, the chain, and a stance ranking of the contracts

### Nasdaq Options Pulse
- One ticker, the whole market, by sector and industry, and a scanner

### A stock
- Companies in the same sector
- At-the-money chains
- Balance sheet, cash flow, income statement, full financials, fundamental breakdown
- Earnings history
- Flow per expiry, per strike, and per strike each minute
- Recent flows
- The old per-ticker flow-alerts route is deprecated
- Greeks for every strike of one expiry
- 25-delta and 10-delta risk-reversal skew
- Interpolated IV, IV rank, at-the-money term structure
- Max pain, net-premium ticks, NOPE
- Candles
- Open interest per strike, per expiry, the day's changes, and volume plus open interest per expiry
- Option volume and premium, and option volume by price
- The option symbols that existed that day
- Who holds the shares (enterprise only on this key — see above)
- Last state, and the quote: last, bid, ask, and the change by session
- Lit versus off-lit volume by price
- Any technical-indicator series
- How unusual today's stock and option volume is against about 90 sessions
- Realized volatility and the volatility statistics

### Volatility
- A year of interpolated IV as a range, and the same for each expiry
- Anomaly score, character, and context
- Options positioning sentiment, VWKS and AVAR
- Realized-volatility windows and variance-risk-premium windows
- Screeners for rich or cheap vol, character, and positioning

### Market
- Correlations
- Daily market report
- Economic calendar and FDA calendar
- Market-wide insider buy and sell totals
- Market tide, sector tide, ETF tide
- Contracts whose open interest moved the most
- SPDR sector ETF stats
- Top net-premium names
- Total options volume and premium
- Net flow by moneyness and expiry

### Dark pool and lit
- Latest dark-pool prints, and one ticker for one day
- Dark-pool volume by price
- Latest lit prints, and one ticker for one day

### Group flow
- Delta and vega flow for a group, each minute, also split by expiry

### FLEX options
- The contracts, one contract's history, a ticker's history, and the market overview

### ETFs
- Holdings, which ETFs hold a name, inflows and outflows, profile, sector and country weights

### Earnings, shorts, seasonality
- Who reports before the open, who reports after the close, and a ticker's history
- Short screener, rebate and shares available, failures to deliver
- Short interest and float. The v1 route is deprecated. Use v2.
- Short volume and ratio, and short volume by exchange
- The market's average month, the best names in a month, a ticker's average month, and month by year

### Ownership
- Insider transactions, a ticker's insiders, insider flow by ticker and by sector
- Institutions, holdings, sector exposure, latest 13Fs, who holds the options
- Institutional ownership of a ticker
- The old institution-activity route is deprecated
- Congress trades, late reports, one member's reports, the politician list
- Annual disclosures and politician portfolios (enterprise only on this key — see above)

### Other feeds this key opens
- Headlines
- The President's posts and the public schedule
- Crypto: token list, metadata, candles, pair trades, pair candles, pair state, whale trades
- Prediction markets: unusual markets, one market, liquidity, positions, user search, one user, smart money, whales,
  insider signals

### Screeners, alerts, lists
- Unusual contracts, hottest contracts, analyst ratings
- Stock screener and its query language
- Triggered alerts, saved alert configs, the filters, and the query grammar
- Stock and option watchlists: list, create, update, delete, add, and remove
- Which exchange each ticker is on

## ThetaData v3

**Status codes the terminal sends** (read from the v3 jar's `CustomStatusCodes`): 471 PERMISSION, **472 NO_DATA**
(the only one that is an answer about the request: a contract that never quoted that day), 473 UNAUTHENTICATED, 475
TERMINAL_PARSE, 571 SERVER_RESTART, 572 AUTHENTICATION_RESPONSE; older terminals and the relay also send 474
DISCONNECTED and 478 INVALID_SESSION_ID. The hub keeps only 472 among 470–479 (`server/thetaProxy.mjs`
`thetaKeepable`), so an outage code is never served after the terminal is back. A refused login reads
`code: 'terminal_login'` (503) from `/api/theta` while the supervisor says so (`docs/theta-terminal.md`).

The terminal must be running (it runs on the owner's machine, not in a cloud sandbox). REST is
`GET http://127.0.0.1:25503/v3` — 81 paths. Streams are `ws://127.0.0.1:25520/v1/events`. A snapshot is the latest
value. History is the past. At-time is the print that was current at one millisecond. A flat file is the whole
market for one day.

### Stocks, REST
- Every symbol, and which dates exist
- Right now: bar, last trade, national bid and ask, market value
- History: daily bar, intraday bars, every trade, every quote, every trade with the quote that was up
- The trade or the quote at one millisecond
- Whole-market files: every trade with its quote, the daily bars, one-minute quotes

### Options, REST
- Every underlying, which dates exist, every expiration, every strike, and which contracts traded or were quoted
- Right now: bar, last trade, national bid and ask, open interest, market value
- Implied vol from the bid, the mid, and the ask
- Two models: Black-Scholes, and a binomial tree that allows early exercise
- First order: delta, theta, vega, rho, epsilon, lambda
- Second order: gamma, vanna, charm, vomma, veta
- Third order: speed, zomma, color, ultima
- The same sets from the quote, and again on every trade
- History: daily bar, intraday bars, every OPRA trade, every NBBO quote, every trade with the quote that was up,
  daily open interest
- End-of-day greeks, and the same three orders through the day, on both models, from the quote and from the trades
- The trade or the quote at one millisecond
- Whole-market files: every trade with its quote, the daily bars, open interest, one-minute quotes

### Indices, REST
- Every symbol, and which dates exist
- Right now: bar, last price, market value
- History: daily bar, intraday bars, every price print
- The price at one millisecond
- Whole-market file of the daily bars

### Streams
- Stocks: trades, the full trade, quotes, market value
- Options: trades, the full trade, quotes, market value
- Indices: prices, market value

### Extended-hours bars (what is left out)

ThetaData's one-minute stock bars before 09:30 and after 16:00 take their open, high, low and close from every Form T
print, so late reports at an old price draw tall false spikes (SPY on 2026-10-29: near 765.5 after the close, yet
16:09–16:19 highs of 769.36 and 769.5067 from the closing auction's average-price report of 2.2M shares, its
prior-reference-price reports, and size-1 odd lots at the close; before the open, odd lots at Oct 28's 772.31 close).
The chart bars (`data/thetaTape.ts` `pullIntraday`, which Terrain, the Weigher, Paper and Pinpoint's tape draw) and the
book's ThetaData fallback tape (`data/book/tape.ts` `thetaTape`) rebuild a **stock's** pre-market and after-hours bars
from `/stock/history/trade` (`data/thetaEligible.ts`):

- A print sets a bar's price only if every condition it carries (`condition`, `ext_condition1`–`4`) is one ThetaData's
  Trade Conditions table marks as updating the consolidated High, Low and Last, and not as a Late Report. Form T,
  EXTENDED_HOURS_TRADE, TRADE_THRU_EXEMPT and BENCHMARK are neutral. Left out of the price: odd lots, average-price,
  prior-reference-price, cash-sale, sold-last and out-of-sequence reports, closing and derivatively priced prints,
  cancels, and (as ThetaData's own bars do) a print more than 5% from the last accepted one.
- Volume is ThetaData's bar volume: every print counts. A minute with no price-setting print holds the last such price
  of that day; with none earlier that day it has no price and is not drawn.
- One trades request per name and window for the finished days of the last 6 calendar days (cached 6 h by the hub), and
  one for today, read on from the minute the last read reached. Bars older than 6 days, indexes, the regular session
  and the 16:00 close bar are ThetaData's own (the regular session already follows these rules: its bars match them).
- Every history window ends on its last millisecond (`15:59:59.999`, `09:29:59.999`, `19:59:59.999`): the terminal's
  `end_time` is exclusive at the stamp, so an end of `15:59:59` dropped every print stamped 15:59:59.xxx (SPY's
  2026-10-29 15:59 bar read 315,661 shares and a 769.62 high instead of 330,558 and 769.66), and `16:00:00` would
  open the next bar with only its 16:00:00.000 prints.
- Locked by `scripts/golden/extended-golden.ts` (set `extended-2026-10-29`).

### Bad prints on any day (`data/barSanity.ts`)

Bars older than those 6 days still carry bad prints: SPY on 2026-10-23 traded at 761 after the close, yet ThetaData's
17:00 fifteen-minute bar runs 723.5739–787.5169 and its 17:01 minute closes at 728.6713 (Form T odd lots from exchange
57, conditions 4 and 115, which may not set a price). Every intraday chart read (`pullIntraday`; the book tape's
`candlesFrom`, `twoCashSessions`, `parseTape`; a Dossier name's session minutes in `data/stockFile.ts`) runs one rule.
A bar is judged only with at least 3 bars on each side in its own run (no pause over 15 minutes: a session's first bar
is never held against the day before; the newest bars of a live tape wait). Its band is the opens and closes of the 10
bars on each side, less the 3 most extreme at each end; its margin max(8 × their median range, 0.5% of price). An open
or close outside the band by more than the margin, or a high or low past the band and the bar's own body by more than
it, is a bad print. A stock's flagged bar is rebuilt from that bar's own price-setting prints (one small
`/stock/history/trade` read per flagged bar, at most 24 per read, kept); with no prints (an index, UW's bars, the
terminal down) a wick is cut to the body, an open takes the close before it and a close the open after it. Volumes are
never changed and no bar is dropped. Locked by `scripts/golden/bar-sanity-golden.ts` (the bad day, plus the April 2025
crash and rally, two CPI mornings, 5 Aug 2024 and GME's 14 May 2024 opening gap, whose regular sessions are untouched).

### Also in the same REST spec
- Session calendar: today, a date, and the year's holidays
- Treasury-rate history
