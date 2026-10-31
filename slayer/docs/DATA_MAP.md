# Data map: which key feeds which box

> **Status (2026-10-31): a dated snapshot, not a live map.** §1 and §2 describe the code as it stood on
> **2026-10-29, 12:15 UTC**, and §3 was re-checked on 2026-10-31 (its **FIXED** marks). It is not regenerated as the code
> changes. Read every `file:line` below as "near here on 2026-10-29": the line numbers have drifted, and some named
> functions have since been removed (`uwOnlyDesk`, `sheetChain` and `spxBook.ts` on 2026-10-31; the guard they stood for
> is `theta.ts thetaUseHere()`). For what a box reads now, follow the route in `src/App.tsx` to its data module and
> check `docs/DATA_SOURCES.md`, which is kept current.

This map was built from the code as it stood on 2026-10-29, 12:15 UTC, while seven fixers were editing the tree. Read it with `docs/PAGE_CONTRACT.md` §1–§2 and `docs/DATA_SOURCES.md`.

**How it was built.** Every route in `src/App.tsx` was traced to its components, stores and data modules, and from there to the vendor path each one calls. All 39 terminal routes were also loaded in Playwright against the dev server. Every `/api/uw/*` and `/api/theta/*` request was answered locally (UW with `{"data":[]}`, Theta with `terminal_down`), so the run cost the UW key nothing. The first-wave URLs it recorded are quoted below. Because the answers were empty, only the first wave fired; requests that depend on data (expiries, a sector, a chain) are taken from the code.

**Legend.**

| Mark | Meaning |
|---|---|
| **UW** | Unusual Whales, through `uwCall`/`uwSwr` (`data/whales.ts`), the proxy at `server/uwProxy.mjs` and the hub at `server/hub.mjs` |
| **TH** | ThetaData, through `thetaCall` (`data/theta.ts`), either directly or via `thetaGet` (`data/thetaFeed.ts`), then the proxy at `server/thetaProxy.mjs` |
| **calc(X)** | Computed in the browser from X |
| **LS / IDB** | Browser storage: localStorage, or IndexedDB (`data/uwStore.ts`) |

**Navigation.** `components/layout/DeskKeep.tsx:7` keeps every visited room mounted: pulse, terrain, compass, weigher, practice, dossier, pinpoint and trace. A hidden room keeps its hooks, so its timers **keep running across navigation**. Only Settings, Start and Community unmount when you leave. Module stores survive in every case. The "Nav" column below records which of the two applies (*kept* or *unmounts*).

---

## 1. Route by route

### /pulse: Workspace (`pages/workspace/Pulse.tsx`)

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| Every tile's book: levels, exposure, walls, the day's change | UW | `/stock/{t}/stock-state`, `/greek-exposure/strike`, `/iv-rank`, `/volatility/term-structure`, `/interpolated-iv`, `/spot-exposures/strike?limit=500&page=N`, `/ohlc/1m?limit=1800` (`data/book/load.ts:300-313`) | `ensureBook` every 30 s (`Pulse.tsx:221`); book stale after 90 s board / 45 s full (`book/store.ts:14-15`) | kept |
| Tile prices (`tiles/parts.tsx`) | TH | `/stock/snapshot/trade?symbol=T`, `/index/snapshot/price?symbol=T`; `/{stock\|index}/history/eod` 12 days for the prior close (`thetaQuote.ts:177,189`) | 1 s tick, 3 s / 15 s / 60 s freshness by session (`thetaQuote.ts:158-164,345`) | kept |
| Trade tile: Compass picks and the watched chain | TH | `useThetaBook` (Compass scan, see /compass); `loadLiveChain` (see /weigher) | Chain every 20 s (`tiles/trade.tsx:123`); scan every 8 s (`thetaBook.ts:855`) | kept |
| Market tile: news, congress, insiders, earnings, stocks | UW | See /dossier/news, /dossier/congress and /dossier/insiders | feedStore cadences | kept |

### /terrain (`pages/terrain/Terrain.tsx`)

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| Head price and change | TH | `thetaChartBars`, last bar painted with the live print `/stock/snapshot/trade?symbol=A,B,…` / `/index/snapshot/price?symbol=…` (`thetaTape.ts:406-407`); prior close from `/…/history/eod` (`thetaTape.ts:154`) | Print 1 s in session, 60 s outside (`thetaTape.ts:434`) | kept |
| Candles (all timeframes) | TH | `/{stock\|index}/history/ohlc?…&interval={grain}&start_time&end_time` per session window (`thetaTape.ts:145`) | 15 s live, 5 min closed (`thetaTape.ts:217`) | kept |
| Off-session bid/ask fallback | TH | `/stock/snapshot/quote?symbol=T` (`sessionQuote.ts:27`) | 15 s (`sessionQuote.ts:37`) | kept |
| Confluence pills | calc(TH 1m rth tape) | – | With the tape | kept |
| Exposure rail, walls, flip, supreme, flow lane | UW, calc | Book paths as in /pulse, for each tab name (3 books recorded: SPY, QQQ, AAPL), plus `/stock/{t}/spot-exposures` | Book cadence | kept |
| **Rail spot marker and the levels' spot** | **UW** | `peekSpot` → `/stock/{t}/stock-state` (`Terrain.tsx:182`, `paneLevels(railData.spot)`) | Book cadence | kept |
| **Compare legend price** | **UW** | `peekSpot(c.ticker)` (`Terrain.tsx:1358-1360`) | Book cadence | kept |
| **Expected-move cone** | **UW first**, TH fallback | `/stock/{t}/volatility/term-structure` and `/interpolated-iv`; TH `/option/snapshot/greeks/first_order?…&strike_range=1` and `/option/list/expirations` (`coneFeed.ts:105-106,136,173,204`) | Cached 60 s (`coneFeed.ts:199`) | kept |
| Earnings and news markers | UW | `/earnings/*`, `/news/headlines` | feedStore | kept |

### /compass: Board, /compass/:id (Setup), /compass/blotter, /compass/tracker

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| The scan: setups, spots, sparks | TH | `/option/snapshot/greeks/first_order?symbol=T&expiration={E\|*}&right=both&strike_range={16\|4}` (`thetaBook.ts:331`); underlying bars `/…/history/ohlc` (1 m and 5 m) (`thetaBook.ts:488-491`, `compassModel.ts:182,229`); OI `/option/snapshot/open_interest` (`compassModel.ts:271`); `/option/history/quote` for the last 31 min (`compassModel.ts:366`) | Tick every 8 s on the 5-minute grid, 09:45–15:00 ET (`thetaBook.ts:855`) | kept (the scan runs while any `useThetaBook` reader is mounted, Pulse included) |
| Card quotes | TH | Greeks/quote snapshot per contract (`thetaBook.ts:621`) | 3 s (`thetaBook.ts:665`) | kept |
| Contract chart and second-order greeks (Setup) | TH | `/option/history/ohlc?…&interval=1m\|5m` (`thetaBook.ts:562`); `/option/snapshot/greeks/second_order` (`thetaBook.ts:703`) | 15 s / 60 s (`thetaBook.ts:573`); 15 s (`:712`) | kept |
| Blotter / Tracker paths and fills | TH | `/option/history/quote?…&interval=1m`, then `1s` around the fill (`compassLedger.ts:188,192`) | Timer (`compassLedger.ts:236`) | kept |
| Tape rail | UW | `/option-trades?limit=500` (recorded; `components/compass/TapeRail.tsx:192`) | 4 s live (`traceLive.ts:22`) | kept |
| NameDesks "Pinpoint" box | UW | Book (levels) | Book cadence | kept |
| **NameDesks "Terrain" box: "Last" and session range** | **UW** | `deskTape` → `/stock/{t}/ohlc/1m?limit=1800` (`NameDesks.tsx:88,140`) | Book cadence | kept |
| NameDesks "Trace" box | UW | `/option-trades?ticker_symbol=T&limit=40` | 8 s (`traceLive.ts:117`) | kept |
| NameDesks (unseen) | UW | `usePinpointFeed(cash)` → `startPinpoint`, **37 one-shot vendor reads** (`NameDesks.tsx:69` → `vendorFeed.ts:409-449`) | Once | kept |

### /weigher (`pages/weigher/WeigherDesk.tsx`)

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| Chain: NBBO, sizes, greeks, IV, spot | TH | `/option/snapshot/greeks/first_order?…&right=both&strike_range=N` and `/option/snapshot/quote?…&right=both&strike_range=N` (`weigherDesk.ts:582-583`) | 1 s while options trade, 60 s outside (`WeigherDesk.tsx:667`) | kept |
| Expiries | TH, IDB | `/option/list/expirations?symbol=R` (`weigherDesk.ts:520`), kept copy re-dated when the terminal is down | On name change | kept |
| Slow fields: OI, day OHLC, prior close | TH | `/option/snapshot/ohlc`, `/option/snapshot/open_interest` (`weigherDesk.ts:767-768`); `/option/history/eod` (`:426,453`) | With the chain | kept |
| Entry range | TH | `/option/at_time/quote` (`weigherDesk.ts:474`) | On demand | kept |
| Watched legs | TH | `/option/snapshot/quote?symbol&expiration` (`weigherDesk.ts:392`) | 8 s (`WeigherDesk.tsx:1274`) | kept |
| Premium chart (contract lens) | TH | `/option/history/ohlc?…&interval={tf}` per window; `/option/history/eod` 200 days (`weigherTape.ts:60,68`) | 20 s (`weigherTape.ts:114`) | kept |
| Stock chart | TH | As on Terrain | As on Terrain | kept |
| Position card dealer map and "our two cents" | UW | Book (levels), plus `/stock/SPY/spot-exposures` | Book cadence; 3 s pump (`WeigherDesk.tsx:100`) | kept |
| Top-net list | UW | `/market/top-net-impact?limit=30` (`WeigherDesk.tsx:706`) | 8 s | kept |

### /practice: /paper, /backtest(/:id(/report)), /journal(/…)

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| Paper: name quote | TH | `/stock/snapshot/quote?symbol=T` or `/index/snapshot/price` (`paper/thetaFeed.ts:85`) | 2 s beat; 60 s out of session (`paper/thetaFeed.ts:251,228`) | kept (the runner is in the shell) |
| Paper: chain and expiries | TH | `/option/snapshot/quote?symbol&expiration` (`:165`); `/option/list/expirations` (`:117`) | 2 s | kept |
| Paper: chart walls and flip | UW | Book (`pages/paper/Desk.tsx:109`) | Book cadence | kept |
| Backtest replay | TH | `/{root}/history/ohlc` (`review/history.ts:227,267`); `/option/list/contracts/quote` (`:341`); `/option/history/quote` (`:416,441`); `/option/history/ohlc` (`:503`); `/option/list/expirations`, `/option/list/dates/quote` (`:546,557`) | On demand; retry 15 s (`pages/review/Desk.tsx:62`) | kept |
| Journal | LS | – | – | kept |

### /dossier: UW only (`pages/record/*`)

| Route | Boxes → vendor paths | Cadence |
|---|---|---|
| /dossier/news | Headlines `/news/headlines?limit=100&page=N` (`liveRecord.ts:184`); econ calendar `/market/economic-calendar`; earnings day `/earnings/{premarket\|afterhours}?date=D&limit=100&page=0`; FDA, daily report, POTUS posts and schedule (`vendorFeed.ts:513-516`); "biggest move" `/screener/stocks?ticker=<sorted set>` (`liveQuote.ts:381`) | News 60 s / 120 s / 600 s (`liveRecord.ts:606`); others 5 min / 15 min (`:607`); vendorFeed **once** |
| /dossier/earnings, /:ticker | 10 days × 2 slots `/earnings/{slot}?date=D&limit=500&page=0`; per name `/earnings/T`, `/screener/stocks?ticker=T`, `/insider/transactions?ticker_symbol=T`, `/congress/recent-trades?ticker=T&limit=200`, `/stock/T/stock-state`, `/info`, `/option-contracts?limit=500`; vol stats and term distribution (vendorFeed) | Fortnight 15 min / 30 min; clock 60 s (`earningsFeed.ts:957-958`); reactions 60 s (`:323`); wire 5 min (`:244`) |
| /dossier/insiders, /:person | `/insider/transactions?transaction_codes[]=P…`, `…S…&min_value=1000000`, `?limit=500&page=N`; a person `?reporter_cik\|owner_name=…&start_date={NY day −N}` (`liveRecord.ts:828-843`); market buys and sells | 5 min / 15 min |
| /dossier/congress, /:member | `/congress/recent-trades?limit=200[&date=cursor]`, `/congress/politicians?…`, `/congress/late-reports`, `/congress/congress-trader?name=…&date_from={NY day −365}` | 5 min / 15 min |
| /dossier/stocks, /:ticker | Board `/screener/stocks?ticker=<fixed 12-name chunks>` (recorded); name file: `stockFile.ts` (1d closes `?limit=18`, flow alerts `newer_than={NY midnight}`, dark `?date=D&min_premium\|min_size`, `/ohlc/1m?limit=1000`) plus vendorFeed `stockJobs` (22 reads, **once**) | Screen 2 min / 15 min (`stockFile.ts:551`); stocks 2 min / 10 min (`liveFiles.ts:935`); re-render 10 s (`StockName.tsx:303`) |
| /dossier/institutions, shorts, etfs (+ files) | `/institutions`, `/institution/{h}/holdings\|sectors`; `/short_screener…`, `/shorts/T/*`; `/etfs/T/info\|in-outflow\|holdings\|weights\|exposure` | etfs 30 min / 60 min; inst and shorts once (`liveFiles.ts:934-939`) |
| Every /dossier page | Nav quote `/stock/SPY/stock-state` (UW quote on UW rooms) | 15 s (`liveQuote.ts:219`) |

**ThetaData on /dossier:** none recorded. Every guard holds on this room (see §3).

### /pinpoint: /map, /agenda, /board, /compare. UW only

| Box | Vendor | Path(s) | Cadence | Nav |
|---|---|---|---|---|
| Spot on every box | UW | `peekSpot` (book state) (`useRoomSpot.ts:14`); Board price refresh `/screener/stocks?ticker=<live names>` (`book/day.ts:41`) | 500 ms local read (`useRoomSpot.ts:8`); screener 10 s (`book/day.ts:24`, `Board.tsx:525`) | kept |
| The book: strike map, exposure field, levels, chains | UW | Book core plus full mode: `/oi-per-strike`, `/flow-per-strike`, `/greek-exposure/expiry`, `/greek-exposure/strike-expiry?expiry=E`, `/spot-exposures/expiry-strike?expirations[]=E&limit=500`, `/option-contracts?limit=500&expiry=E&page=N` (`book/load.ts:36-41,98,155,204,527-555,737`) | `ensureBook` 30 s, prices 10 s (`book/feed.ts:55-56`); scan 10 s (`MapDesk.tsx:39`) | kept |
| MapReadings: max pain, NOPE, Δ/vega flow, flow per expiry; LiveDesk vendor rows | UW | 37 `pinJobs` paths (`vendorFeed.ts:409-449`, all recorded on /pinpoint/map) | **Once per page load** (`vendorFeed.ts:638`) | kept |
| Board (20 names) | UW | Book core × 20 names (**140 requests at load**; 175 recorded in 15 s) | 10 s scan | kept |
| Compare | UW | Book plus `/oi-per-strike`, `/flow-per-strike` | 10 s | kept |
| Rate, holidays | Constant | `core/carry.ts` `DEFAULT_R`, `core/calendar.ts` (by the owner's rule) | – | – |

### /trace/*: UW only (`data/traceLive.ts`)

| Route | Boxes → vendor paths | Cadence |
|---|---|---|
| live-tape | Stream `/option-trades?limit=500&…filters&newer_than={session start−1}[&older_than={close}]` (`traceLive.ts:381`); alerts `/option-trades/flow-alerts?limit=40[&older_than=close]`; day panel: tide `/market/market-tide?interval_5m=false`, top `/screener/option-contracts?limit=20&order=premium…`, big alerts `…&min_premium=5000000&newer_than={08:00Z}&older_than={close}` | Stream 8 s busy / 10 s idle / 30 s off-session (`traceLive.ts:322`, beat); others 8 s / 30 s (`:117,115`) |
| screener | `/screener/option-contracts?limit=200&order=…` | 8 s |
| net-flow | `/market/top-net-impact?limit=40`; tide; pane `/stock/T/net-prem-ticks`, `/stock/T/ohlc/1m?limit=1000` | 30 s (`traceLive.ts:1487`) |
| footprints, watchers | `/screener/option-contracts…`, `/stock/SPX/spot-exposures`; OI pairing `/stock/T/oi-change?limit=500&date=D&order=…`, `/option-contract/{occ}/historic?limit=3` | 8 s; OI once a date |
| intervals | `/stock/T/net-prem-ticks`; nav quote | 30 s |
| odte | `/net-flow/expiry?moneyness=…&tide_type=…&expiration=zero_dte` × 4 | 30 s |
| multi-leg | `/option-trades/multi-leg?limit=200[&ticker_symbol][&older_than=close]`; legs `/option-trades/multi-leg/{id}/legs` | 20 s (`traceLive.ts:1442`) |
| compare | Per name: `/screener/option-contracts?ticker_symbol=T&limit=80…`, `/option-trades?ticker_symbol=T&limit=300`, `/option-trades/multi-leg?ticker_symbol=T&limit=80`, `/stock/T/flow-per-expiry`, `/net-prem-ticks`, `/ohlc/1m?limit=1000` | 8 s / 30 s |
| dark-pool | `/darkpool/recent?limit=200[&date&order_by=premium]`, `/lit-flow/recent`, a name `/darkpool/T?limit=200`, `/darkpool/T/price-levels`, `/lit-flow/T`, `/stock/T/quote` | 8 s live; fixed day once |
| tracker | `/option-contract/{occ}/historic`, `/option-contract/{occ}/flow` | 8 s |

### Other routes

| Route | Data |
|---|---|
| /settings | Feed probes: TH `/calendar/today` and UW `/stock/SPY/stock-state`, every 30 s (`Settings.tsx:941,964-965`). Unmounts on leave. |
| /start | Account and plan only. Unmounts. |
| /community | LS only (`data/room.ts`); no invented posts. Unmounts. |

---

## 2. The shell (mounted on every terminal page)

| Piece | Calls | How often |
|---|---|---|
| `main.tsx` boot | `applyStoredDefaults`, `bootAnalytics`, `bootSync` (account storage via Supabase); no vendor calls | Once |
| `App.tsx` | Prefetches the shell and first-page **code** (no feeds); pointer/focus warmers | On intent |
| `warmRooms.ts` | Route **code** only (`warmIdle` order `/pulse … /settings`); its top comment says no feed starts. Note that a loaded chunk's module top level runs: `listedNames.ts` hydrates and seeds lists, and `traceLive.ts:1969` registers a reader. No requests. | Idle |
| `AppShell` `openFeeds()` | Opens the proxy gate (`feedGate.ts`) | While mounted |
| SideNav clocks | NY clock 1 s and session words 1 s (`SideNav.tsx:75,109`); local only | 1 s |
| Nav quote (`NavQuote.tsx:42-79`) | TH `/stock/snapshot/trade` / `/index/snapshot/price` plus EOD on Theta rooms; on Trace, Pinpoint and Dossier the UW quote `/stock/{t}/stock-state` (with `/quote` when the state is stale) | TH 1 s tick, 3 s fresh; UW 15 s |
| Watchlist drawer | Same split as the nav quote, for every listed name **only while open** (`WatchlistDrawer.tsx:290-291`); walls from the UW book already in hand | 1 s / 15 s |
| AlertWatcher | Theta rooms: TH prices; UW rooms: UW quotes. Level alerts read the UW book; **indicator and script alerts read UW book candles** (`AlertWatcher.tsx:28-31`); flow alerts `/option-trades?ticker_symbol=T&limit=200` (low lane) (`:46`) | Beat 15 s (`:69`); prints 30 s |
| AlertsDrawer | Re-arm price = `liveSpotOf` (**UW** quote) on every room (`AlertsDrawer.tsx:211`) | On click |
| PaperRunner | `paper/thetaFeed` beat (TH quotes) and order judging (`paper/store.ts:281`) | 2 s; lease 2.5 s |
| AlertToasts, EditorDockGate, SiteFooter | Local (`SiteFooter` market state 30 s) | – |
| CommandPalette | Ticker universe (bundled lists; TH `/stock/list/symbols` and `/option/list/symbols` on Theta rooms) (`listedNames.ts:110`) | When opened |
| feedStore global tick | `refreshDue` for every shown book (`feedStore.ts:164`) | 10 s |

---

## 3. Rule violations found (11)

**Re-checked 31 Oct 2026 against 710a78f+ (Exposure series).** Marked **FIXED** where the code no longer does it; the rest stand as written.

### R1. ThetaData code paths reachable from Trace, Pinpoint and Dossier

**Status:** confirmed. No request leaves, because `thetaCall` refuses on `/(trace|pinpoint|dossier)` at `theta.ts:91-93`. The three local guards disagree, though, so these paths run as far as that refusal.

- **Index books.** Trace → `traceLive` → `liveQuote` → `uwBook` → `book/load.loadCore` → `book/tape.thetaTape`, which calls TH `/…/history/ohlc` and `/…/snapshot/*` (`book/load.ts:320,324` → `book/tape.ts:95,101`). The guard `uwOnlyDesk()` at `spotGexBook.ts:16` omits `/trace`.
- **Guards.** **FIXED:** `uwOnlyDesk()` (`spotGexBook.ts:12`), `listedNames` (`:131`) and `coneFeed` (`:206,219`) all read the one rule, `theta.ts thetaUseHere()`, which covers `/trace`.
- **Theta OI fallback.** **FIXED:** `awaitSpotGex` and the Theta-OI book are gone from `book/load.ts`. Was: Trace → the same chain → `awaitSpotGex` at `book/load.ts:353-357`. This waits up to 4 s on Trace for a refused Theta read, so an index book (SPX) on Trace is slower to load or fails.
- **Ticker lists.** Trace → `TickerSearch` → `listedNames.ensureListed` → TH `/stock/list/symbols` (`listedNames.ts:110`). Its guard at `:130` omits `/trace`.
- **Cone and chart.** `coneFeed.fromTheta` (`coneFeed.ts:204`) and `StrikeChart`'s `thetaChartBars` branch (`StrikeChart.tsx:342,780`) use `uwOnlyDesk()`, so on Trace they take the Theta branch and draw nothing.
- **Hidden rooms.** PaperRunner (`paper/thetaFeed.ts:251`) and every hidden Theta room (DeskKeep) keep calling `thetaCall` while the reader is on a UW room.

### R2. UW stand-in for Theta on Theta pages

1. **Terrain compare legend.** The legend price is the UW book spot (`Terrain.tsx:1358-1360`). Confirmed.
2. **Terrain exposure rail.** The rail's spot marker and every level distance use the UW spot (`Terrain.tsx:182`, `paneLevels(railData.spot, …)`), beside a Theta head price. Suspected: the exposure is UW's by rule, but the price line is a price.
3. **Compass NameDesks "Terrain" box.** "Last {price}" and the session low–high come from UW 1-minute bars (`components/compass/NameDesks.tsx:88-95,140`). Confirmed.
4. **Expected-move cone (Terrain, Weigher, Compass charts).** The IV is UW's term structure and interpolated IV first, with Theta only as a fallback (`coneFeed.ts:204`). IV is a Theta item on these pages. Confirmed.
5. **Alerts re-arm.** The re-arm price is the UW quote on every room (`AlertsDrawer.tsx:211`), while the watcher judges the same alert against the Theta price on Theta rooms (`AlertWatcher.tsx:86-91`). Confirmed.
6. **Indicator and script alerts.** They run on UW book candles even on Theta rooms (`AlertWatcher.tsx:28-31`). Confirmed.
7. **FIXED (removed).** **The reverse substitution: Theta standing in for UW exposure.** When UW returns no strikes, the "UW book" is built from Theta OI, labelled `call_gex`/`put_gex`, with `g = spot²·0.01` and `call_gex = callOi / g` (`book/load.ts:353-370`). That is OI divided by dollar-gamma units, not GEX. Confirmed in code. It reaches Terrain, Compass, Weigher and Paper.
8. **Stale header comment.** `weigherChain.ts:1-3` says the Weigher chain falls back to UW, but `sheetChain` has no caller. Comment only.

### R3. Constants, defaults and seeded values shown as data

1. **FIXED.** An index with no stock-state now takes the live rows' own price with `prev_close: 0`, so the day change reads "—" (`book/load.ts:336-347`). Was: **Index day change pinned at zero.** An index book with no UW stock-state gets `prev_close = price` (`book/load.ts:340`), and later `prev = … || num(state.open) || spot` (`:407`). Both make the day change +0.00%. The screener fallback does the same (`:349`). For SPX and NDX on Pinpoint (no Theta fallback there), the day change reads 0.00% while it is shown as data. Confirmed in code; not seen live, because the dev run returned empty answers.
2. **FIXED (deleted).** `buildDeskChain` and `FALLBACK_IV` are gone (only a comment in `WeigherDesk.tsx:106` names it). Was: **Fabricated chain generator, still shipped.** `weigherDesk.buildDeskChain` (`weigherDesk.ts:169-302`) hashes OI (`:194-196`), volume, spread, last, high, low and sizes (`:225-246`), and `FALLBACK_IV = 0.3` is used at `:161,165,176`. It is unreachable today: `materialize` always sets `liveBook: true` (`book/levels.ts:396`) and `snapshotAtOpen` returns null (`levelview.ts:75-88`). `ContractPremiumPane`'s modelled path (`ContractPremiumPane.tsx:528-532`) is also unused, because both callers pass `traded`. Latent; delete it.
3. **Strike volume of zero.** (Still: `exposure.ts:97`; `StrikeExposure.volume` is a number, so a blank needs a type change in `types/gex.ts`.) On the live book, strike volume is `0` whenever `flowVol` has no row (`exposure.ts:144`), and board-mode books never read flow-per-strike (`book/load.ts:304`). Suspected: 0 is shown as a volume.
4. **FIXED.** `thetaQuote.readPrint` drops a print without a timestamp (`price > 0 && at > 0`). Was: **Untimed quotes stamped "now".** An NBBO with no timestamp is stamped as the time it was read (`thetaQuote.ts:132`, `|| Date.now()`). Confirmed.
5. **FIXED.** `K_DEFAULT` is gone from `coneFeed.ts`. Was: **Cone scale constant.** `K_DEFAULT = 0.68` replaces the vendor's own move/IV ratio when it is out of range (`coneFeed.ts:47,90-99`). Suspected: a constant inside a drawn cone.
6. **Synthetic index bid/ask.** An index's paper quote carries `bid = ask = price` (`paper/thetaFeed.ts:94-97`). Confirmed in code; whether it is displayed was not checked.

### R4. Vendor fields mislabelled

1. **Dark-pool cross as the stock's price.** On Trace Dark Pool, when `/stock/T/quote` fails, the stock's "spot" is the newest dark-pool cross price (`traceLive.ts:986`), and the distances to the levels are drawn from it. Confirmed.
2. **FIXED (removed with R2.7).** **Theta OI labelled as gamma exposure** (`book/load.ts:363`; see R2.7).
3. **Terrain head change from a mid.** The change is computed from the NBBO mid when the session has no print, while the price cell shows "—" (`Terrain.tsx:779-783`). Suspected.

---

## 4. Per-viewer URLs (7)

The stream poll has already been fixed in the tree: `traceLive.ts:584` now asks the newest page with no cursor and filters `msOf(r) >= sinceMs` client-side.

| # | file:line | Param | Built from | Canonical form |
|---|---|---|---|---|
| U1 | `thetaTape.ts:406-407` | `symbol=A,B,C` | This viewer's wanted names, in insertion order | One request per symbol (the same URL as `thetaQuote.ts:189`), or a sorted list |
| U2 | `book/day.ts:41` | `ticker=…` (chunks of 50) | Names whose book is live in this browser and were not asked in the last 10 s | Fixed sorted chunks of the Board universe (`boardNames.ts`), regardless of local state |
| U3 | `LiveTape.tsx:500` | `older_than` (ms) | A jump time past now is clamped to `Date.now()` | Floor to the minute; a jump past now is "latest" (no cursor) |
| U4 | `traceLive.ts:733` (`loadOlder`), `:1906` (`olderAlerts`), `:1917` (`olderSpreads`), `:1942` (`olderDark`), `:237` (`useNameSpreads`), stream gap walk (~`:589`) | `older_than` | The oldest row this viewer holds, +1 ms / +1 s. It comes from the data, but each viewer's first page differs by when it loaded. | Floor `older_than` to the minute (`floor(oldest/60 000)·60 000 + 60 000`) and dedupe by id. Low lane, 30-min proxy TTL: low priority. |
| U5 | `compassModel.ts:366` | `start_time` / `end_time` | The viewer's clock −31 min to now | Already floored to the minute, so it is acceptable. Better: the session-open boundary (`start_time=09:30:00`) with a client-side slice. |
| U6 | `vendorFeed.ts:455` | `/seasonality/{month}/performers` | The browser-local month (`new Date().getMonth()`) | The NY month (`nyParts().month`) |
| U7 | `LiveTape.tsx:674-676` | `newer_than` | `Date.UTC(y,m,d,8,0)`: shared by all viewers, but wrong after DST ends on 1 Nov (03:00 ET) | `nyWallTime(y,m,d,4,0)` |

Why this matters: the hub keeps every distinct path warm for 2 minutes after its last ask (`hub.mjs` `WANT_MS = 120_000`), so each unique URL also costs background refresh budget, not just one call.

---

## 5. Duplicate fetchers (9)

| # | Data | URL variants (file:line) | Winner |
|---|---|---|---|
| D1 | UW 1-minute stock bars | `/ohlc/1m?limit=1800` (`book/load.ts:312`); `?limit=1000` (`stockFile.ts:570`, `traceLive.ts:1592`); `?date=D&limit=1000` (`traceLive.ts:902,1703`) | `?limit=1800`. `stockFile.ts:85` already claims it is "shared with Pinpoint", but it is not. |
| D2 | UW per-name option tape | `/option-trades?ticker_symbol=T&limit={40\|200\|300}` (`traceLive.ts:213` via NameDesks, default and Compare); `limit=200` low lane (`AlertWatcher.tsx:46`) | `limit=200`, sliced client-side |
| D3 | UW top net impact | `limit=30` (`WeigherDesk.tsx:706`), `limit=40` (`NetFlow.tsx:55`) | `limit=40` |
| D4 | UW stock price | `/stock/T/stock-state` (`liveQuote`, book, Settings, `earningsFeed.ts:1126`); `/stock/T/quote` (`traceLive.ts:873`, `liveQuote.ts:123`, vendorFeed `quote`); `/screener/stocks?ticker=…` (`book/day.ts:41`, `book/load.ts:346`, `liveQuote.ts:381`) | `stock-state` as the one live price; screener only for bulk boards in fixed chunks |
| D5 | Theta stock or index last | `?symbol=T` (`thetaQuote.ts:189`, `book/tape.ts:99`); `?symbol=A,B,…` (`thetaTape.ts:406`) | Single-symbol (also fixes U1) |
| D6 | Theta option NBBO | Per contract (`thetaQuote.ts:222`); `right=both&strike_range=N` (`weigherDesk.ts:583`); whole expiry (`paper/thetaFeed.ts:165`, `weigherDesk.ts:392`); inside greeks (`thetaBook.ts:331,621`) | Whole-expiry `/option/snapshot/quote?symbol&expiration`, sliced by each reader |
| D7 | Theta 1-minute underlying bars | `thetaTape.ts:145` (rth 09:30:00–15:59:59, 6 days); `book/tape.ts:95` (09:30:00–16:15:00, 4 or 8 days, 5 windows); `compassModel.ts:182,229`; `review/history.ts:227,267` | `thetaTape`'s windows and day spans |
| D8 | Theta first-order greeks | `strike_range=span` (`weigherDesk.ts:582`), `16` / `4` (`thetaBook.ts:331`), `1` (`coneFeed.ts:136`), per strike (`thetaBook.ts:621`) | One `strike_range` (16) per expiry |
| D9 | UW spot exposures, OI change | `/spot-exposures/strike` (vendorFeed) vs `?limit=500&page=0` (`book/load.ts:41`); `/spot-exposures/expiry-strike?limit=200` (vendorFeed) vs `?limit=500&page=N` (`book/load.ts:98`); `/oi-change?limit=40` (vendorFeed) vs `?limit=500&date=D&order=…` (`traceLive.ts:1033`) | The book's paged forms; vendorFeed reads the book's copy |

---

## 6. Logic red flags (9)

1. **Pinpoint vendor rows freeze after the first read.** `vendorFeed.start` runs once per key (`vendorFeed.ts:638`), so on Pinpoint the NOPE line, the Δ/vega flow minutes, max pain and the per-expiry flow never refresh while they are shown as the session's live line. The Dossier stock rows behave the same way. Confirmed.
2. **Hidden Theta rooms report "offline".** A hidden Terrain or Weigher tape counts the `uw_only` refusal as "offline" (`thetaTape.ts:149,261`; `weigherDesk.ts:609` returns `offline: true`). Coming back from Trace, Pinpoint or Dossier, the box says "ThetaData offline — reconnecting" for up to 15 s although the terminal is up. Confirmed.
3. **Paper orders stop being judged on UW rooms.** On Trace, Pinpoint and Dossier `thetaCall` refuses, so `isFresh` (8 s) fails and working paper orders are not judged, without saying so (`paper/thetaFeed.ts:257`, `paper/store.ts:281`). Code path confirmed; the fill impact is suspected.
4. **Day-panel start drifts with DST.** The Live Tape day panel's start is 08:00 UTC, which is 04:00 ET only while daylight time is in force; from 1 Nov 2026 it is 03:00 ET (`LiveTape.tsx:676`). Confirmed.
5. **UW key budget bursts.** The Board loads 20 names × 7 reads = 140 at once (175 requests recorded in 15 s). Compass NameDesks fires 37 one-shot vendor reads per name that Compass never draws (`NameDesks.tsx:69`). Terrain loads 3 books (24 requests). Confirmed by the recording.
6. **Kept rooms keep polling.** DeskKeep keeps each room's timers alive while hidden: the Compass scan every 8 s (`thetaBook.ts:855`), Trace polls every 4 to 30 s, the Pinpoint scan every 10 s. Only `document.hidden` is checked, never whether the room is the one on screen. Confirmed; this is the price of "keeps working across navigation".
7. **Possible Weigher greek units mismatch.** Weigher Theta greeks: `theta / 365` and `vega / 100` (`weigherDesk.ts:645-646`; `thetaBook.ts:115`) assume ThetaData's theta is annual and its vega is per 1.00 of vol. Suspected; check one live row, since the dev server has no terminal.
8. **Cone fallback on Trace.** `coneFeed` and `StrikeChart` use `uwOnlyDesk()`, which omits `/trace`, while `thetaCall` blocks Trace. Charts on Trace get the Theta branch and draw nothing, rather than the UW branch (R1). Confirmed.
9. **FIXED** with R3.1. **Index day change on Pinpoint reads 0.00%.**

---

## 7. Units checked live (Unusual Whales exposure routes)

Read through the dev proxy on 31 Oct 2026 (SPY, the 2026-11-02 expiry, the 10/30 close, price 755.72):

| Route · field | Against | Result |
|---|---|---|
| `spot-exposures/expiry-strike` `call_gamma_oi`, `put_gamma_oi` | Σ Γ·OI·100 over `option-contracts?expiry=` × S²·1% at the row's `price` | **Dollars per 1%, dealer sign** (calls +, puts −). 755C: 260.9 shares × 755.72²·0.01 = 1.49M, the row says 1,490,009.88; 755P: 17,743.9 × 5,711 = 101.34M, the row says −101,337,832.54. Exact. |
| `spot-exposures/expiry-strike` `*_gamma_ask`, `*_gamma_bid` | the same columns' signs | **Dealer-signed**: `call_gamma_ask` < 0, `call_gamma_bid` > 0, `put_gamma_ask` < 0 (with `put_gamma_oi`), `put_gamma_bid` > 0 (755: −381.6M / +465.3M / −784.7M / +750.1M). A customer buy at the ask makes dealers shorter gamma on either right, so the flow book adds them to the OI figure (`exposureSegs.rowMeasures`, `scale.stampFlow`), and a put contract count grows with ask buying (`scale.dealerPuts`). |
| `greek-exposure/strike-expiry` `call_gex`, `put_gex` | Σ Γ·OI·100 off the same contracts | **Shares (Γ·OI·100), dealer sign**, so `book/scale.ts nodeFrom` × S²·1% is right. But not priced at the current price: the ratio vendor ÷ Γ·OI·100 runs smoothly 0.64 (748C) → 1.01 (760C) → 1.28 (763C), the same on the puts, as a gamma priced near 760 would — the morning snapshot's price. Scaled by today's S² it is ~25% off at the money (755C: 197.2 × 5,711 = 1.13M against 1.49M), so it stands in only until the spot-exposure rows land, as the book does. |
| `greek-exposure/strike-expiry` `call_delta`, `put_delta` | Δ·OI·100 | **Shares, holder's sign** (put delta negative), from the same earlier price (755C 4,374 vs 3,422; 755P −97,199 vs −162,997). `nodeFrom` turns the put leg and scales × S. |
| `option-contracts` `gamma`, `vega` | Black-Scholes at the quoted vol | One long contract, per share; vega per 1.00 of vol ÷ 100 (per vol point) — the golden's `bsVega` reproduces the fixture's 775C/758P vega within 1% once both are at one price. |
| `stock/SPY/info` | — | `has_dividend: true` and no `dividend_yield`: the carry's q stays 0 for SPY (and SPX) — `core/carry.ts` takes a name's yield only from that field. |

