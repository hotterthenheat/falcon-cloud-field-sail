# Data sources — what the keys actually give us

Recorded from the owner on 2026-10-22. **Do not forget this.** Build against this list, not against what an
endpoint name suggests.

## Which vendor powers which page

- **Trace and the Dossier read Unusual Whales only.** No ThetaData call leaves their pages.
- **Pinpoint** reads its greeks, exposure, levels and flow from Unusual Whales, and only its live price and chart
  candles from ThetaData (stock and index snapshots and bars). No ThetaData greeks or open interest on Pinpoint.
- **Terrain, Weigher, Compass and Practice** read ThetaData for real-time quotes, NBBO, chains, greeks, bars and
  history, and Unusual Whales for what ThetaData does not carry (exposure, flow, levels).
- `thetaCall` in `src/data/theta.ts` enforces this per page (`thetaUseHere`, `thetaAllowedHere`). Where the app needs
  a carry rate or the market holidays without ThetaData, it falls back to `src/core/carry.ts` (`DEFAULT_R`) and the
  holiday set in `src/core/calendar.ts`.

Set by the owner on 2026-10-22 (Pinpoint and Dossier on Unusual Whales) and 2026-10-29 (Trace on Unusual Whales
only; ThetaData for Pinpoint's live price and candles).

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

### Bad wicks on any day (`data/barSanity.ts`)

Bars older than those 6 days still carry bad prints: SPY on 2026-10-23 traded at 761 after the close, yet ThetaData's
17:00 fifteen-minute bar runs 723.5739–787.5169 (six Form T odd lots from exchange 57, conditions 4 and 115, which may
not set a price). Every intraday chart read (`pullIntraday`; the book tape's `candlesFrom`, `twoCashSessions`,
`parseTape`; a Dossier name's session minutes in `data/stockFile.ts`) runs one rule: a wick is bad only when it reaches past the bodies of its own bar and of the 10 bars on
each side by more than max(8 × their median range, 0.5% of price). A stock's bad wick is rebuilt from that bar's own
price-setting prints (one small `/stock/history/trade` read per flagged bar, at most 24 per read, kept); with no prints
(an index, UW's bars, the terminal down) it is cut to the bar's body. Opens, closes and volumes are never changed and
no bar is dropped. Locked by `scripts/golden/bar-sanity-golden.ts` (the bad day, plus the April 2025 crash and rally,
two CPI mornings and 5 Aug 2024, whose regular sessions are untouched).

### Also in the same REST spec
- Session calendar: today, a date, and the year's holidays
- Treasury-rate history
