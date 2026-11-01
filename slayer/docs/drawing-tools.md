# Drawing tools: TradingView parity (phase 1 and 2, 2026-11-01)

TradingView's drawing toolbar, as its help centre lists it ("Drawing tools available on TradingView"), against the
Terrain chart. We copy behaviour, inputs and defaults only. The icons, colours and words on screen are our own; the
icons, emoji and stickers are plain Unicode drawn by the reader's own system font.

**Files.** The tool families, icons, hotkeys and preferences: `src/components/gex/drawTools.tsx`. The rail, its fly-outs,
its switches, the favourites bar and the every-tool sheet: `DrawRailTools.tsx`. The settings dialog (Style, Inputs,
Levels, Text, Coordinates, Visibility and the Template menu): `DrawSettings.tsx`. The object tree: `DrawObjectTree.tsx`.
Templates: `drawTemplates.ts`. Sync drawings: `drawingSync.ts`. Each tool's levels, inputs and the visibility ranges:
`drawingLevels.ts`. The kinds are drawn and hit in `drawingsPrimitive.ts` (the first 13), `drawingKinds.ts` (the
everyday set), `drawingKindsMore.ts` (phase 1) and `drawingKindsTv.ts` (phase 2). Phase 1 and 2 build each kind once as
a list of pieces; drawing and hit testing both read that list. The pure maths is `drawingGeometry.ts`, and
`scripts/drawing-geometry-proof.ts` proves it (registered in `scripts/run-proofs.mjs`). StrikeChart.tsx carries the
wiring only.

**Data.** Every number a tool prints comes from the chart's own bars (the volume profiles, the anchored VWAP and its σ,
the range volume, a position's open P&L at the last close, the regression and its R) or from the reader's own anchors.
Nothing is invented: a profile over a range with no bars says so. The ghost feed draws the path the reader clicked,
candle by candle, with the chart's own average bar range — no random prices.

## Tools

✓ = had it before phase 2 · **new** = phase 2 · ✗ = not built (why)

| Group | TradingView | Ours |
|---|---|---|
| Cursors | Cross, Dot, Arrow | ✓ the chart's crosshair; the rail's pointer selects |
| | Eraser | ✓ the rail's bin (selected) and eraser (all); Delete/Backspace |
| | Demonstration, Magic | ✗ (presentation cursors, not drawings) |
| Lines | Trend line, Ray, Info line, Extended line, Trend angle, Horizontal line, Horizontal ray, Vertical line, Cross line | ✓ |
| | Trend line options: extend left/right, price range · % · bars · angle stats, price labels, middle point | **new** (Inputs tab; also on the ray, arrow, info line, trend angle) |
| Channels | Parallel channel, Regression trend, Flat top/bottom, Disjoint channel | ✓ |
| | Regression settings: deviation, upper/lower on or off, Pearson's R | **new** |
| Pitchforks | Pitchfork, Schiff, Modified Schiff | ✓ |
| | Inside pitchfork | **new** (origin halfway between points 1 and 2, median along them, point 3 sets the spread — TradingView's help) |
| | Style picker, levels (±0.25 … ±2) on/off and custom | **new** |
| Fibonacci | Retracement, Trend-based extension, Channel, Time zone, Speed resistance fan, Circles, Spiral, Wedge | ✓ |
| | Trend-based fib time | **new** (from point 3, the first leg's bar span × 0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.618, 4.236) |
| | Fib speed resistance arcs | **new** (centred on point 1, radii a ratio of the trend line; Full circles option) |
| | Pitchfan | **new** (rays from point 1 through the B–C span at ±0.382, ±0.5, ±0.618, ±1) |
| | Every fib tool's levels: on/off, edit, add, reset | **new** (Levels tab; retracement also reverse, extend left/right) |
| Gann | Gann box, Gann square fixed, Gann fan | ✓ |
| | Gann square | **new** (free price/bar ratio: grid, fan from the origin, quarter arcs, bars · points · per-bar ratio; Reverse) |
| | Gann fan angles on/off and custom | **new** |
| Patterns | XABCD, ABCD, Head and shoulders, Triangle, Three drives | ✓ |
| | Cypher | **new** (prints AB/XA, XC/XA, CD/XC — B 0.382–0.618, C 1.13–1.414, D 0.786) |
| Elliott | Impulse (12345), Correction (ABC) | ✓ |
| | Triangle (ABCDE), Double combo (WXY), Triple combo (WXYXZ) | **new** (the triangle draws its two sides and their apex) |
| Cycles | Cyclic lines | **new** (repeats the anchors' bar gap to the right edge) |
| | Time cycles | **new** (an arc a cycle on the anchor's price, alternate cycles shaded) |
| | Sine line | **new** (point 1 a crest, point 2 the next trough: half a period apart) |
| Forecasting | Long and short position | ✓; **new** settings: account size, risk %, lot size → quantity, cash at target and stop, open P&L at the last close |
| | Position forecast | ✓ ("Forecast") |
| | Bars pattern | **new** (two anchors pick the bars, a third sets the copy down; HL bars, OC bars or a line of close/open/high/low/HL2; mirrored, flipped) |
| | Ghost feed | **new** (clicked path, a candle a bar at the chart's own average range or the reader's) |
| | Sector | **new** (origin, time point, price point; Δ, Δ%, bars) |
| Volume-based | Anchored VWAP | ✓; **new** settings: source (HLC/3, HL/2, OHLC/4, close), σ bands ×1 ×2 ×3 |
| | Fixed range volume profile | **new** (the chart's bars between the anchors: 24 rows, up/down split, POC, value area 70%, VAH, VAL — all editable) |
| | Anchored volume profile | **new** (from the anchor's bar to the last bar) |
| Measurers | Price range, Date range, Date and price range | ✓; **new**: the range's volume (on by default) |
| Shapes | Rectangle, Rotated rectangle, Path, Circle, Ellipse, Polyline, Triangle, Arc, Curve | ✓ |
| | Double curve | **new** (an S through both ends, bent by point 3) |
| Brushes and arrows | Brush, Highlighter, Arrow, Arrow marks up/down | ✓; **new**: the brush's fill, the path's head at the start too |
| | Arrow marker | **new** (a filled arrow, dragged tail to head) |
| Annotation | Text, Note, Callout, Price label, Signpost, Flag | ✓ |
| | Anchored text | **new** (fixed on the screen, not on a bar) |
| | Price note, Pin, Table, Comment | **new** (table: cells split on `|`, rows on `;`) |
| Content | Icons, emoji, stickers | ✓ emoji; **new** icon set (monochrome Unicode in the mark's ink) and sticker set (emoji on a rimmed badge) |
| | Image, X posts and ideas | ✗ — need file storage and a social feed we do not have; not built (no placeholders) |

Phase 1 made 62 kinds; phase 2 adds 24, so the chart has **86**.

## The toolbar and the workflow

| TradingView | Ours |
|---|---|
| Grouped toolbar, fly-outs, favourites, favourites bar | ✓ (seven families; the sheet lists all 86 with search) |
| Floating toolbar on a selected drawing (colour, text, width, style, settings, clone, lock, delete) | ✓ |
| Settings dialog | ✓ Style, Text, Coordinates, Visibility; **new** Inputs (each tool's own settings above) and Levels |
| Per-tool level editing | **new**: fib ratios on/off, edit, add, remove, reset; Gann fan angles; pitchfork lines; regression σ |
| Drawing templates | **new**: Template menu in the dialog — save as, apply, delete, star one as the tool's default for new marks, apply the tool's own defaults. Kept in the browser |
| Object tree | **new**: every drawing on the tape, top of stack first — select, rename (double-click or pencil), hide, lock, bring forward/send backward (or drag a row), delete. A side panel; a bottom sheet on a narrow pane (its door is in the sheet there) |
| Visibility by timeframe range | **new**: seconds, minutes, hours, days, weeks, months — each on/off with a from–to range. Older marks kept to one timeframe still read |
| Clone: Ctrl+drag / Alt+drag | **new** (Ctrl, ⌘ or Alt held: a body drag moves a copy; the floating toolbar's clone stays) |
| Undo / redo | **new**: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, fifty steps a tape, and rail buttons. (Before, undo was keyed by the ticker while saves were keyed by the tape, so a tape's undo could miss.) |
| Sync drawings | **new**: rail switch. On (default): every pane on the same symbol shows the same drawings and a change in one appears in the others at once — this also stops a pane with a stale list from writing it over a newer one. Off: each pane keeps its own set (seeded from the shared one) |
| Magnet weak/strong, stay in drawing mode, lock all, hide all, hotkeys, Shift constrain, Shift+click measure | ✓ |
| Alerts on drawings, snap to indicators | ✗ not built |
