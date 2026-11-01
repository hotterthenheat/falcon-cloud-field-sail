# Terrain UI port from the partner tree (2026-11-01)

The owner wanted Terrain to look and behave like the partner's Terrain, except for three things that stay ours:
our math and data feeds, the TradingView-derived features (indicator legend, settings and library, the drawing tools
and their toolbar), and the content of the strikes panel. This file lists each partner UI piece and what happened to it.
"Ported" means the look and the behaviour came across. Every number on screen still comes from our feeds.

## Page shell and top rows

| Partner piece (commit) | Status | Notes |
|---|---|---|
| Standalone room: sidebar waits at the left edge, a rest at the edge slides it over the page, the keep/stand-alone notches (data/standalone.ts, SideNav overlay; 50405ea) | Ported | `src/data/standalone.ts`, SideNav `overlay`/`room`, AppShell. The waiting rail is clipped so nothing shows past its edge. The partner's spacer glide is left out; the rail just leaves the frame. |
| Wordmark `>slayer_terminal` in the foil at the strip's lead when standalone (4a11c33) | Ported | Uses the galaxy ink on paper. |
| Desks door: monitor glyph with chevron, opens on hover, search, your desks, desks by field (4a11c33) | Ported | `DesksDoor.tsx` taken whole, with our type tokens. |
| Tab strip: 40px row, 32px tabs on the row's floor, rounded tops, lifted ground and silver hairline, 26px "+" (b608857) | Ported | The tab's price and change still come from our NavQuote (our feed). The phone keeps its 32px boxes. |
| Strip end: ⌘K search door and the account avatar (b608857) | Ported | The words "Search anything" show only from 2xl, so the clock fits beside them. |
| One ground: the strip and the bar take the active tape's ground only when it matches the page's ground (b608857, cc8f686) | Ported | Uses `data-terrain-top`, `data-chart-chrome` and `data-chart-ground`. |
| Row line hairline (4a11c33) | Ported | `.row-line` in index.css, for both themes. |
| Ticker bar, 44px: the active pane portals its identity and a tall toolbar into it (b608857) | Ported | Pane `barSlot` and ChartToolbar `tall`. The other panes show the in-chart legend: number, Replay, symbol, timeframe, price, change. |
| Tall toolbar: 28px triggers, style chip showing the shape in use and opening on hover, a row that never wraps (b608857, 2136793) | Ported | |
| Timeframe tray, measured from openmarket: favourites, chevron menu on hover, unit sections that fold, stars, the active rung shown by ink alone in dark and a pill on paper (61ede58, 33d42ee, 0b879c6, b942fc3) | Ported | `TimeframeTray`/`TimeframeRows` and `data/tfFavourites.ts`. Favourites use our old pin key, so readers keep their pins. Only timeframes we serve are listed. |
| Price leaves the bar (61ede58) | Ported | The tab strip prints the price. |
| Layout door on the bar after the style: bordered shape glyph, opens on hover (2136793, 4a11c33) | Ported | Kept ours: the ceiling stays at 6 panes (our layoutShapes and its proof). The partner goes up to 8. |
| Right cluster: Indicators door in the partner's style, 32px squares (Alerts, Theme, Snapshot), the pinned panels, the Panels word (24dda10) | Ported | The link chip and Compare sit on the left after the style, as the partner has them. |
| Slow hover word (SlowTip: no delay, 300ms drop in and out, one word at a time) (24dda10, d487fe6, bfce19c) | Ported | `components/ui/SlowTip.tsx`, verbatim. |
| Menus that open on hover (useHoverOpen) (2136793) | Ported | Verbatim. |

## Panels and dock

| Partner piece | Status | Notes |
|---|---|---|
| Panels menu: 508px two-column card, section heads, 32px rows, key capsules, pins, blocked rows with their reason (24dda10) | Ported | `BarPanelsMenu` in ChartToolbar. |
| Pins on the bar (data/barPins.ts) (24dda10, 4fc9c65) | Ported | Pinned by default: Replay, Matrix, Calendar, Strike rail. |
| Dock: a column at the desk's right edge, one room at a time, the charts giving way, the partner's head (glyph chip, title, sub, name, × with slow word), a grip, a remembered width per room (bfce19c, 86a0bcc, ecd17c3) | Ported | `dockStore.ts` and `DeskDock.tsx`. Widths are 316 to 820. |
| Dock rooms | Our content | Matrix, Calendar and Surface are our strike rail views (ExposureField on our book store, plus the Skew and Drift lenses). Regime, Building and Prints are our rail boards. News uses our wire. Earnings and Events are the rooms ported earlier. |
| Net flow room (Trace's pane) | Skipped | NetFlowPane is tied to Trace's page state. It is reachable on Trace. |
| Rows for Replay, Fullscreen, Watchlist and Alerts inbox; Scripts added by the toolbar (24dda10) | Ported | We also added Strike rail (R), Every strike rail (⇧R) and the Pine editor. |
| Phone: RailDoor line under the chart (57a7484) | Replaced | The phone strip's end has one Panels door that opens the dock as a sheet, with every room as a tab. The chart now runs to the bottom of the screen. |

## Foot, chart and takeover

| Partner piece | Status | Notes |
|---|---|---|
| Sessions clock and timezone door (260a099) | Ported, moved | At the tab strip's end, because the owner asked for the foot strip to go. The clock is our session module (`SessionsClock.tsx`). The timezone door offers New York and Local; the partner's London, Tokyo and UTC need the chart clock to read any zone (`chartTime`), which is not done. |
| Foot strip under the charts | Removed | Its controls moved. Layout and the new Desk door (Colours, Session, Units) are on the ticker bar. Desks is at the strip's lead. Strike rails, Earnings and Events are in Panels. The clock and timezone are at the strip's end. Pine is a Panels row. |
| Foil price tag on the axis (260a099) | Ported | `price-foil` with `.sig-foil`, and the galaxy on a light tape. This is a StrikeChart chrome change. |
| Record's edge card (260a099) | Skipped | It needs history-extension hooks inside StrikeChart. The other workers were in that file, so it was left alone. |
| 8–11px default bar pitch (f5262be) | Ported | Changes `pitchPx` only. The partner's walls-only-while-drawn autoscale was not ported because it changes scale behaviour. |
| Wheel zoom glide (b608857) | Skipped | This is chart behaviour, kept out of StrikeChart this round. |
| Takeover: only the symbol, the tray, Indicators and the way out (c6d73e5) | Ported | ChartToolbar `takeover`. Kept ours: the strike rail stays beside a fullscreen chart, because strike content is ours. |
| Editor opens off full screen; the shell steps in by `--editor-w` (c6d73e5) | Ported | |
| Desk drawing rail, one rail for the desk (DeskDrawRail; 56908d6) | Kept ours | The drawing toolbar is one of the owner's exceptions. |
| Paper theme: every foil surface uses the galaxy (b942fc3) | Ported | index.css. |
| Rail tabs in FilterTabs sm (9f7b3c8, 57a7484) | Kept ours | Strike content is an owner exception. |

## Files touched

New files: `components/ui/SlowTip.tsx`, `components/ui/useHoverOpen.ts`, `data/barPins.ts`, `data/tfFavourites.ts`,
`data/standalone.ts`, `pages/terrain/DeskDoor.tsx`, and this document.

Changed files: `ChartToolbar.tsx`, `TickerTabStrip.tsx`, `ScopeChip.tsx` (adds a `tall` prop), `Terrain.tsx`, `DeskDock.tsx`,
`dockStore.ts`, `DesksDoor.tsx`, `LayoutDoor.tsx`, `SideNav.tsx`, `AppShell.tsx`, `index.css`. In `StrikeChart.tsx`, chrome only: `pitchPx`
values and the price tag's markup and selectors.
