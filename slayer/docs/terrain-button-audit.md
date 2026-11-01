# Terrain button audit (2026-11-01)

The owner asked: "make sure every button works and is real data." This is a record of every control on `/terrain`
that was clicked. The tests were Playwright scripts against the dev server, run at 1440×900 and 390×844 (touch), in the
dark and the light theme. One browser ran at a time. The ThetaData terminal was off for the whole audit, so every
chart bar, every live price, and the reads that come only from the terminal show their offline state. Those reads are
marked **Theta-off**. They were not failures.

How each control was judged:
- The script clicked the control, then looked for an effect: a URL change, a menu or dialog opening, a saved
  preference, new text, or a DOM change outside the page's own ticking.
- It recorded any console error.
- It searched any newly shown text for sample or placeholder words (sample, demo, lorem, John Doe, placeholder, mock).
  Every hit was read by hand. The only hit on Terrain was the library's note that the physics reads were "tested out of
  sample", which is the statistical term and not fake content.

**Result keys.** OK: works, and its content comes from our feeds. Fixed: a defect found and fixed in this change.
Theta-off: the control works, but what it shows waits on the terminal. By design: an inert state that is meant to be
inert.

## Counts

| | Controls |
|---|---|
| Tested | 455 |
| OK | 435 |
| Fixed (defects found, fixed, re-tested) | 13 |
| Theta-off (control works; its content or placement waits on the terminal) | 7 |
| Open issues | 0 |

Every control is counted once, in its first applicable column. A control that was both Fixed and Theta-off is counted
as Fixed. The phone and light-theme passes re-ran the same controls and are not counted a second time.

## Defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 1 | Leaving Terrain (the wordmark, ⌘K → any page, Sign in) or dropping panes with the layout door threw `PAGEERROR Error: Object is disposed` once per pane. The overnight layer's unmount cleanup detached its primitive from a chart that StrikeChart had already removed, and that asked the dead chart for a frame. | `useOvernightLayer.ts` / `overnightLayer.ts`: the layer knows its chart (`isOn`). On unmount it is let go without touching a removed chart. A rebuilt chart drops the old layer. |
| 2 | In a 3-pane desk (the default) the strike rail is 180 px wide. In its Ladder view the Expiry card covered every view tab and pushed the × past the rail's edge, so there was no way to another view and no close button. | `ProfilePanel.tsx`: in a thin rail with a host card, the card gets its own head row (`HEAD_TOP_3`). The ladder canvas starts under that row. |
| 3 | In a narrow rail the view tabs past the edge (Calendar … Prints) could only be reached with a sideways scroll. A plain mouse wheel did nothing on the bar-less row. | `ui/scrollMore.ts`: the vertical wheel scrolls a sideways row while that row has room to move. It only does this on rows that do not scroll vertically. |
| 4 | The node-look picker (Beads / Heat / Both / Ribbon) could not be reached on Terrain. It lived only in the overlays menu, and a pane with the indicator library does not show that menu. | `ScriptLibrary.tsx`: a "Draw" row under Exposure trails, on the Chart tools shelf (×4 buttons). |
| 5 | The Extended hours and Session breaks toggles could not be reached on Terrain, for the same reason. | `ScriptLibrary.tsx`: both rows added to "On the chart". An overlay the host never set reads as its default (both default on). |
| 6 | In the Events room, the expiry rows were buttons that navigated to `/terrain`, which is the page already open, so a click did nothing. | `EventsRoom.tsx`: expiry rows are plain lines with no hover and no false promise of a click. |
| 7 | In the Events room, macro figures were printed raw: "Prev 7100000", "Prev -105600000000". | `EventsRoom.tsx`: big bare counts are shortened (7.1M, −105.6B). The numbers are unchanged and still come from the same feed. |
| 8 | In a narrow pane, the replay card's "Back to live" broke onto two lines inside its 24 px button. | `ReplayStrip.tsx`: the door does not wrap. |

## Tab strip, sidebar, top rows (1440)

| Control | n | Result |
|---|---|---|
| Wordmark `>slayer_terminal` → front page | 1 | Fixed (#1) |
| Desks door (hover and click) | 1 | OK |
| Desks door search field | 1 | OK, filters desks and names |
| Desks by field: Indices, Megacaps, Technology, Semiconductors, Software, Banks, Energy, Health, Consumer | 9 | OK, each loads its four names into a 4-pane desk |
| Your desks: recall a saved desk | 1 | OK |
| Your desks: Forget | 1 | OK |
| Tab (select) | 1 | OK |
| Tab × (close; the last tab stays, with a reason) | 1 | OK |
| + Add a tab, its search field, a name row | 3 | OK, the 5-tab cap shows "n of 5" |
| Market sessions clock (dialog) | 1 | OK, from our session module |
| Clock door: New York, Local | 3 | OK, saved in desk prefs |
| ⌘K door, its field, a destination | 3 | OK |
| Sign-in door | 1 | OK, opens /signin. That page says the account service is not set up on this build, which is honest. Leaving Terrain: Fixed (#1). |
| Sidebar: edge reveal, keep notch, collapse to icons, stand-alone notch | 4 | OK |

## Ticker bar (1440)

| Control | n | Result |
|---|---|---|
| Symbol picker (S, or click), its search, a name | 3 | OK |
| Timeframe favourites 1m 5m 15m 1h 1D | 5 | OK |
| Timeframe menu door | 1 | OK |
| Timeframe rows: 15 s, 1/2/3/5/10/15/30/45 min, 1/2/4/6/8/12 h, 1 day | 16 | OK |
| Timeframe unit folds (Seconds, Minutes, Hours, Days) | 4 | OK |
| Timeframe stars (keep on / take off the strip) | 16 | OK |
| Chart style door | 1 | OK |
| Styles: Candles, Hollow, Bars, Line, Step line, Area, Baseline | 7 | OK |
| Scales: Linear, Log, Percent, Indexed to 100 | 4 | OK |
| Bar clocks: Time, Range $0.50, Range $2, Volume 10k, Volume 50k | 5 | OK |
| Export PNG | 1 | OK |
| Layout door | 1 | OK |
| Layout shapes (1, 2h, 2v, 3B, 3h, 3L, 3T, 3v, 4g, 4h, 4L, 4T, 6g, 6v) | 14 | OK. The 1-chart shape used to throw on dropped panes: Fixed (#1). |
| Sync: Symbol, Interval, Crosshair, Time | 4 | OK |
| Desk name field, Save | 2 | OK, appears under Your desks |
| Desk door; Colours; Session; units (dollars, % of spot, ATR, implied 1-day σ) | 7 | OK |
| Link chip, link letter | 2 | OK |
| Indicators door | 1 | OK, see the library section |
| Alerts bell | 1 | OK |
| Alert chips: Call wall, Put wall, Flip, Supreme, Cone high/low, VWAP, EMA 9/21/50, RSI 70/30, GEX flips sign, New supreme, News lands, Wall ±2/±4, $250K/$1M/$5M | 20 | OK, each arms and disarms. The 8-per-pane cap says so. |
| Alert price field and Set | 2 | OK |
| Candle theme door + 13 themes | 14 | OK |
| Snapshot door + Save (download), Copy (clipboard image/png), Open in a new tab | 4 | OK |
| Replay (P) + Back to live | 2 | OK. Picking a replay bar: Theta-off (no bars). Narrow-pane wrap: Fixed (#8). |
| Pinned bar buttons: Matrix, Calendar, Strike rail | 3 | OK |
| Panels door | 1 | OK |
| Panels rows: Replay, Fullscreen, Strike rail, Every strike rail, Matrix, Calendar, Surface, Regime, Building, Prints, News, Earnings, Events, Watchlist, Alerts inbox, Pine editor, Scripts | 17 | OK |
| Panels pins (one per row) | 17 | OK, each pins and unpins its bar button |

## Keyboard (as documented in the UI)

| Key | Result |
|---|---|
| 1 / 2 / 3 / 4 / 6 | OK, layout 1 / 2h / 3B / 4g / 6g |
| R, ⇧R | OK, this pane's rail; every rail |
| P | OK, replay on and off |
| F, Esc | OK, takeover and out |
| Ctrl+K, ⌘K | OK, palette opens; Esc closes |
| Alt+T / H / V / C / F / I | OK, Trendline, Horizontal line, Vertical line, Crossline, Fib retracement, Info line in hand |
| S | OK, symbol picker |
| Alt+R (reset view) | Theta-off: no bars to reset, so nothing visible changes |

## Dock rooms (Panels → each room; 1440 dock and phone sheet)

| Room / control | n | Result |
|---|---|---|
| Dock head ×, grip (drag 380 → 502 px) | 2 | OK |
| Matrix: Settled, Live, Greek multi-pick (All, GEX, DEX, vega $, vanna, charm, color, vomma, speed, veta, zomma, Clear), Expiries picker | 15 | OK, our book store (UW chain) |
| Calendar: the same four doors | 4 | OK |
| Expiries picker: Next session, This week, Nearest n, From, Through, month ‹ ›, expiry days | 7 | OK. Days with no listed expiry are inert by design. |
| Surface: Gamma lens | 1 | OK, our book |
| Surface: Skew lens, Drift lens | 2 | Theta-off: "the market data terminal is not answering" |
| Regime room | 1 | Theta-off: the VIX term structure waits on the terminal |
| Building: Expiry, Show, Wall-now term, steady-strike folds | 4 | OK, from our OI-change reader |
| Prints: Less/More by type, Less/More by venue | 2 | OK. The option prints by type and the venue split are Theta-off. |
| News | 0 | OK, honest empty state ("No headline on SPY on the wire today") |
| Earnings: This desk, Watchlist, All, Major, week ‹ ›, five day jumps, search, Before, After, Sector, company row → Dossier | 16 | OK, from our earnings feed |
| Events: This desk, All, Major, All/Macro/Earnings/Expiries, macro row → Dossier news, report row → Dossier earnings | 9 | OK |
| Events: expiry rows | 1 | Fixed (#6) |
| Events: macro "Prev"/forecast figures | — | Fixed (#7) |

## Strike rail beside the chart

| Control | n | Result |
|---|---|---|
| View tabs: Ladder, Matrix, Calendar, Surface, Regime, Building, Prints | 7 | OK at 1 pane. At 3 panes: Fixed (#2, #3). All 7 are now reached with a plain wheel and a click. |
| × Hide this rail | 1 | OK. Unreachable from Ladder at 3 panes before: Fixed (#2). |
| Ladder: Expiry card, Lanes, Vol, How to read | 4 | OK |
| Matrix/Calendar: Settled, Live, Greek, Expiries | 4 | OK |
| Surface: Gamma / Skew / Drift lens switch | 3 | OK (the Skew and Drift content is Theta-off) |
| Building: Expiry, Show | 2 | OK |
| Prints: Less / More | 2 | OK |
| Book table (arrow keys walk, Enter keeps a strike) | 1 | OK |
| Column head (Supreme chip, read door, one-greek pick) | 3 | By design: it folds away with one name and unfolds when a second name stands beside it (`Fold open={many}`). Not counted. |

## Chart chrome

| Control | n | Result |
|---|---|---|
| Field key Live / Settled | 2 | OK, the field mode is saved |
| Expand (F) / Collapse | 2 | OK |
| Reset view button | 1 | OK |
| Charting-by-TradingView attribution link | 1 | OK |

## Indicator library and legend

| Control | n | Result |
|---|---|---|
| Shelves: Recently used, Favourites, My scripts, Slayer, Physics reads, Technicals, Chart tools | 7 | OK. The empty shelves say how to fill them. |
| On/off toggles: 5 Slayer, 5 Physics, 18 Technicals, 15 chart overlays, 15 chart indicators | 58 | OK, each on → off with no error |
| Extended hours, Session breaks rows (within the 58) | — | Fixed (#5) |
| Node look: Beads, Heat, Both, Ribbon | 4 | Fixed (#4). Each is saved as `nodeLook` and pressed. |
| Star, search, gear (settings), Close | 4 | OK |
| Write your own | 1 | OK. Disabled off fullscreen, with the reason on hover. |
| Legend: eye, settings (Inputs / Style / Visibility tabs), fold, unfold, remove | 7 | OK |
| Legend values | — | Theta-off (∅: no bars) |

## Drawing tools

| Control | n | Result |
|---|---|---|
| Rail door, Select, Move to top/left, Hide the tools | 4 | OK |
| Family flyouts: Trend, Fib, Patterns, Measure, Shapes, Words, Icons, Favourites | 8 | OK |
| Tool picks (16 trend, 11 fib, 7 patterns, 7 measure, 14 shapes, 6 words, 1 stamp) | 62 | OK, each tool goes in hand |
| Placing each tool on the chart | 62 | Theta-off. A mark needs a price scale, and with no bars the series has none. To prove the tools themselves, the test set synthetic candles on the pane's series, in the test browser only, through the dev build's `window.__charts`. Nothing ships. Under that harness, 62/62 placed, including the 5–7-point patterns. |
| Magnet, Stay in drawing mode, Lock all, Hide all | 4 | OK |
| Favourites: star a tool, favourites list, "Show the favourites bar", pick from the bar, put the bar away | 5 | OK |
| Every-tool sheet: search, 8 tabs, a tile | 3 | OK |
| Style bar on a selected mark: line colour, line style, settings (Style / Text / Coordinates / Visibility), clone, delete | 5 | OK (with the synthetic candles) |
| Delete selected, Clear all | 2 | OK |

## Phone 390×844 (touch), dark and light

| Control | n | Result |
|---|---|---|
| App bar: Menu, quick switch, search | 3 | OK |
| Tab, +, clock | 3 | OK |
| Pane toolbar (two rows): Timeframe, Chart style, Indicators, Replay, Alerts, Link, Candle theme, Snapshot | 8 | OK, all hit-testable |
| Symbol picker, Live/Settled, Expand/Collapse, drawing rail | 6 | OK |
| Panels sheet: 9 room tabs and its close | 10 | OK. No horizontal overflow, and no control off screen in any room. |

## Gates

- `bash /tmp/qa/ci-local.sh` → CI_LOCAL_OK
- `npx vite build` → built
- Smoke `/terrain`: 1440 `err=0 nan=0 vendor=0 overflow=false`; 390 `err=0 nan=0 vendor=0 overflow=false`
- The full sweep re-run after the fixes, 1440 dark: 0 console errors. Before the fixes it logged 3× "Object is disposed".
