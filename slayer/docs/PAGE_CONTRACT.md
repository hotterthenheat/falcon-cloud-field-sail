# The page contract

Every page in the terminal meets these rules. Read this with `docs/DATA_SOURCES.md` before changing a page.

## 1. Real data only

- Every number on screen comes from Unusual Whales or ThetaData, each where §2 says it is the source. A value computed
  from real inputs (a Black-Scholes greek, a sum of real rows) is real; label what it is computed from.
- No constants posing as data. A missing value shows `—` with the reason, never a stand-in (a default IV, a guessed
  price, a seeded series, a sample row).
- A product that cannot run on real data (futures: neither key carries them) is not in the navigation.

## 2. ThetaData is the real-time source where it is the rule

- **ThetaData powers** the real-time quotes, NBBO, chains, greeks, IV, intraday bars and history on Terrain, Weigher,
  Compass and Practice (Paper fills, Backtest replay), and live stock and index prices elsewhere in the shell.
- **Unusual Whales powers** Trace and the Dossier entirely, Pinpoint's greeks, exposure, levels and flow, and the
  exposure, levels and flow data any page reads. ThetaData gives Pinpoint only its live price and chart candles.
  `thetaCall` enforces this per page (`docs/DATA_SOURCES.md`).
- No page substitutes one vendor for the other. With the terminal down, a ThetaData box shows "ThetaData offline —
  reconnecting" over the last data it had, stamped as of when it was taken, and stops calling until the breaker in
  `data/theta.ts` lets it try again.
- Production reaches the account's one always-on terminal through the relay (`docs/theta-terminal.md`).

## 3. Always loaded

- The page's frame (header, controls, table and chart boxes at their final size) draws at once. Data fills in place:
  no blank page, no layout shift when it lands.
- Moving between pages keeps what is already loaded (the stores are module-level and survive navigation).
- On a reload or a later visit, `uwSwr(path, on)` in `data/whales.ts` hands over the answer this browser kept
  (`data/uwStore.ts`, IndexedDB) with its instant, then the fresh one. A kept answer is shown "as of 10:42 ET" until
  the fresh one lands; it is never shown as live.
- A failed refresh keeps the last data on screen and says in one line what failed.
- No request while the tab is hidden; polling follows the market session.

## 4. The interface

- The number first; the explanation goes in one hover or the page guide, not in a paragraph above the data.
- Every time is New York time and says so (`ET`).
- At 390 px wide: no horizontal page scroll, tap targets at least 40 px, and the first row of data above the fold.
- Loading, empty and error states use the shared components in `components/ui` (`Skeleton`, `skeletonKit`, `Fault`,
  `Working`), so they look the same everywhere.
- The shared states live in `components/ui/states.tsx`:
  - `<AsOf at={savedAt} />` — the stamp a kept answer wears ("as of 10:42 ET", or "as of Oct 28, 15:59 ET" for an
    earlier day). Pass the `savedAt` that `uwSwr`'s callback hands over; it renders nothing while `at` is null (live).
    Props: `at`, `prefix?` (default "as of"), `className?`, `title?`. `asOfText(at, prefix?)` gives the same words as a
    string.
  - `<LoadingBox shape="table|chart|block|lines" rows? label? className? style? />` — a box's first frame, the shape
    of what is coming. Size it from the host so nothing shifts when the data lands.
  - `<EmptyBox title reason? action? compact? className? style? />` — nothing to show, and why in one line.
  - `<ErrorBox what detail? onRetry? compact? className? style? />` — the data failed and nothing is kept to show.
  - `<FailLine what? at? onRetry? className? />` — one line over data still on screen after a refresh failed
    ("The refresh failed · showing as of 10:42 ET · Retry").
  - `<BoxState loading? error? empty? shape? rows? emptyTitle? emptyReason? errorWhat? onRetry?>{children}</BoxState>`
    — picks one of the above, or the children once there is data.
- The stale state is one rule and one tag (`data/freshness.ts`, `components/ui/Freshness.tsx`): `useFreshness(at,
  source, { down })` → `live | stale | reconnecting | unknown`, and `<Freshness at source down? showLive? named? />`,
  which shows nothing while fresh, "Stale · as of 10:42 ET" past the source's window (`STALE_MS`: quotes 45 s, flow
  90 s, book 3 min, Compass 30 s, the record 15 min in a session; longer with none moving) and "Reconnecting · as of …"
  while the feed is down. The Compass head wears it for every Compass page.
- What the data paths answered is kept in `data/pathHealth.ts` (the quote and flow clients report every answer); the
  status page (`/status`) and the outage banner (`data/banner.ts`) read only that, never a guess.
- A small control keeps its drawn size and takes the class `tap-40` (index.css): on a touch screen its hit area
  reaches 40 px around its centre. `DropdownSelect` triggers carry it already.
- Real-time stock, index and option prices come from `data/thetaQuote.ts` (ThetaData snapshots):
  `useThetaPrice(t)` → `{ held, status }` (`held.value.price`, `prevClose`, `todayClose`, `read`; `held.live` false
  is the last reading kept from before, stamp it with `asOfText(held.value.at)`, the print's own instant), `useThetaPrices(names)`,
  `useThetaMarks(contracts)` + `peekThetaMark(t, expiry, strike, right)` for an option's NBBO mid, `thetaMove(price)`
  for the move from the last regular close, and `useThetaStatus()`. With the terminal down, show the kept price
  stamped and say "ThetaData offline" (`OfflineLine` in `components/layout/NavQuote.tsx`); never a stand-in.
- Moving between pages: a rail link to a page whose code is not loaded holds the current page until it is
  (`components/layout/RouteHold.tsx`; wrap other link groups in `data-route-hold` for the same). Route code is fetched
  on pointer or focus over any link and at idle for a reader inside the terminal (`data/warmRooms.ts`).

## 5. Locked by tests

- Each area's math has a golden test in `scripts/golden/<area>-golden.ts`. It replays recorded Unusual Whales answers
  (`scripts/golden/uwFixtures.ts`, fixtures in `scripts/fixtures/golden/<set>/`) with the clock pinned to the
  recording instant, and checks the computed numbers against values checked by hand against the raw rows.
- CI runs every golden test. A change that moves a number fails the build until the expected value is rechecked.

## 6. Unusual Whales budget

The key allows 3 concurrent requests across every visitor. A page asks for each path once, shares it across readers
(`uwCall` already dedupes), loads detail on demand rather than for every row, and never polls faster than the vendor
updates. Every path the browser calls is on the allowlist in `server/uwProxy.mjs`.
