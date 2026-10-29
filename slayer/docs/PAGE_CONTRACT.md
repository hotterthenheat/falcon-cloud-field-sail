# The page contract

Every page in the terminal meets these rules. Read this with `docs/DATA_SOURCES.md` before changing a page.

## 1. Real data only

- Every number on screen comes from Unusual Whales, or from ThetaData when the local terminal runs. A value computed
  from real inputs (a Black-Scholes greek, a sum of real rows) is real; label what it is computed from.
- No constants posing as data. A missing value shows `—` with the reason, never a stand-in (a default IV, a guessed
  price, a seeded series, a sample row).
- A product that cannot run on real data (futures: neither key carries them) is not in the navigation.

## 2. Production has no ThetaData

The deployed app runs on Vercel, where no ThetaData terminal exists (`/api/theta` answers `terminal_unavailable`).
Every page must be complete on Unusual Whales alone. ThetaData may sharpen a page when it is there (NBBO quotes,
finer bars); it never decides whether the page works. Test every page with the terminal down.

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

## 5. Locked by tests

- Each area's math has a golden test in `scripts/golden/<area>-golden.ts`. It replays recorded Unusual Whales answers
  (`scripts/golden/uwFixtures.ts`, fixtures in `scripts/fixtures/golden/<set>/`) with the clock pinned to the
  recording instant, and checks the computed numbers against values checked by hand against the raw rows.
- CI runs every golden test. A change that moves a number fails the build until the expected value is rechecked.

## 6. Unusual Whales budget

The key allows 3 concurrent requests across every visitor. A page asks for each path once, shares it across readers
(`uwCall` already dedupes), loads detail on demand rather than for every row, and never polls faster than the vendor
updates. Every path the browser calls is on the allowlist in `server/uwProxy.mjs`.
