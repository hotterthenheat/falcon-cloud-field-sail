# Drawing tools: TradingView parity, phase 1 (2026-11-01)

TradingView's left toolbar has eight groups: cursors, trend line tools, Gann and Fibonacci tools, patterns, prediction
and measurement, geometric shapes, annotation and icons. The list below comes from TradingView's help centre. It compares
each tool with what the Terrain chart has. We copy the behaviour only. The icons, colours and names on screen are our own.

**Files.** The tool families, icons, hotkeys and preferences are in `src/components/gex/drawTools.tsx`. The rail, its
fly-outs, its switches and the favourites bar are in `DrawRailTools.tsx`. The settings dialog is `DrawSettings.tsx`. The
original 34 kinds are drawn in `drawingsPrimitive.ts` and `drawingKinds.ts`. The phase-1 kinds are in
`drawingKindsMore.ts`, which builds each kind once as a list of pieces; drawing and hit testing both read that same list.
The pure maths is in `drawingGeometry.ts`, and `scripts/drawing-geometry-proof.ts` proves it.

## Tools: TradingView's list against ours

✓ = we had it before, **new** = added in phase 1, — = phase 2

| Group | TradingView | Ours |
|---|---|---|
| Lines | Trend line, Ray, Extended line, Horizontal line, Horizontal ray, Vertical line, Cross line | ✓ |
| | Info line, Trend angle | **new** (the info line shows Δ, Δ%, bars, time and angle; the trend angle shows on-screen degrees) |
| Channels | Parallel channel | ✓ |
| | Regression trend, Flat top/bottom, Disjoint channel | **new** (regression: least squares on closes, ±2σ) |
| Pitchforks | Pitchfork, Schiff, Modified Schiff | **new** (median line, tines at ±0.5 and warning lines at ±1) |
| | Inside pitchfork | — (TradingView's own pages disagree on where its origin sits) |
| Fibonacci | Retracement, Trend-based extension, Fib channel | ✓ |
| | Time zone, Speed resistance fan, Circles, Spiral, Wedge | **new** |
| | Trend-based fib time, Speed resistance arcs, Pitchfan | — |
| Gann | Gann box, Gann square fixed, Gann fan | **new** (fan from 8/1 to 1/8 against the anchors' 1×1) |
| | Gann square | — |
| Patterns | XABCD, ABCD, Head and shoulders, Triangle pattern, Three drives | **new** (each seals itself on its last pivot; XABCD prints AB/XA, BC/AB, CD/BC, AD/XA) |
| | Cypher | — |
| Elliott | Impulse (12345), Correction (ABC) | **new** |
| | Triangle (ABCDE), Double combo (WXY), Triple combo (WXYXZ) | — |
| Cycles | Cyclic lines, Time cycles, Sine line | — |
| Forecasting | Long and short position, Anchored VWAP, Price range, Date range, Date and price range | ✓ |
| | Position forecast | **new** ("Forecast": target, Δ, Δ%, bars and time to it) |
| | Bars pattern, Ghost feed, Sector, Fixed range and anchored volume profile | — |
| Shapes | Rectangle, Rotated rectangle, Path, Circle, Ellipse, Polyline, Triangle, Curve, Brush, Highlighter, Arrow, Arrow marks up and down | ✓ |
| | Arc | **new** (circle through three points) |
| | Double curve, Arrow marker | — |
| Annotation | Text, Note, Callout, Price label | ✓ |
| | Signpost, Flag mark | **new** |
| | Price note, Pin, Table, Comment, Image, Posts | — |
| Icons | Icons, emoji, stickers | **new**: "Emoji stamp" with 20 Unicode emoji. The system font draws them, so none of TradingView's artwork is used |

Phase 1 adds 28 kinds. The chart now has 62.

## The toolbar and the workflow

| TradingView | Ours |
|---|---|
| Grouped left toolbar, a fly-out per group, favourite stars | ✓ before phase 1. Seven families now (Patterns and Icons are new). Each fly-out shows the tool's hotkey |
| Favourites bar | **new**: tick it in the favourites list to get a floating row of starred tools |
| Floating toolbar on a selected drawing | ✓ (colour, text colour, width, style, lock, delete). **New**: settings and clone buttons |
| Settings dialog: Style, Text, Coordinates, Visibility | **new**. Style: ink, width, dash. Text: words, or a caption on any mark, plus text ink. Coordinates: price per anchor and a step of one bar. Visibility: show or hide, and every timeframe or this one only |
| Magnet, weak and strong; Ctrl flips it while drawing | **new**: snaps to the nearest open, high, low or close on screen. Weak mode only snaps within 18 px |
| Stay in drawing mode | **new** rail switch |
| Lock all, Hide all (Ctrl+Alt+H), Remove all | **new** lock all and hide all. Remove all (the eraser) was already there |
| Hotkeys: Alt+T, Alt+H, Alt+V, Alt+C, Alt+F, Alt+Shift+R | **new**, plus Alt+I for the info line. They act on the chart the pointer was last over |
| Shift constrain | **new**: lines snap to 45°, rectangles, ellipses, circles and Gann boxes become squares or circles |
| Shift+click measure | **new**: Shift+click starts a date and price range, and the next click places it |
| Clone (Ctrl+drag) | **new** as a button on the floating toolbar, offset by three bars. Ctrl+drag is phase 2 |
| Per-symbol persistence, undo | ✓ (localStorage per symbol, wrapped in try/catch; Ctrl+Z) |
| Object tree, drawing templates, sync across layouts, alerts on drawings | — |

## Phase 2

- Tools: Inside pitchfork, Pitchfan, Trend-based fib time, Fib speed resistance arcs, Gann square, Cypher, the Elliott triangle and combinations, the cycle tools, Bars pattern, Ghost feed, volume profiles, Double curve, Price note, Pin, Table and an anchored (screen-fixed) text.
- Each tool's own levels in the settings dialog: fib ratios, pitchfork levels, Gann angles and the regression's σ multiple, all editable and toggleable.
- Object tree with reorder, rename, hide and lock per row. Drawing templates (save and apply a style). Ctrl+drag clone. Snap to indicators.
- Visibility by timeframe range (TradingView's per-interval ticks). Today the choice is every timeframe or one.
