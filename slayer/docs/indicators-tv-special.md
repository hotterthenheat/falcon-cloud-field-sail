# The standard desks' special built-ins: candlestick patterns, volume profiles, pivots and auto levels

This covers the built-in indicators that are not a plain line or oscillator. It lists the published set, what we
added, and what we skipped and why. The behaviour, inputs, defaults and maths follow the public help-centre
definitions and the Pine reference. The wording and colours are ours.

Where they live in the library:

- **Candlestick patterns** shelf: *All candlestick patterns*, then one Pine script per pattern.
- **Profiles and levels** shelf: the volume profiles, the pivots and the auto tools.

Each item has its settings under Inputs / Style / Visibility. The new `choice` input kind added a select to
`IndicatorSettings.tsx`.

## Data — what every number is made from

| Indicator | Built from |
|---|---|
| Candlestick patterns | This chart's own bars (OHLC). |
| Volume profiles | **An approximation from bars, not from trades.** Each bar's volume is spread evenly over its high–low range, by overlap with each row. A bar counts as *up* volume when it closed at or above its open, and as *down* volume when it closed below. The bars are the name's one-minute bars wherever the chart already holds them for that span; otherwise this chart's own bars (or day bars on a day chart). The legend says which. No new request is made. The stock trade tape the server reads (`tapeServer.ts`) keeps only the venue mix and the large off-exchange prints, not volume at each price, so it cannot feed a profile without a new heavy read, and it is not used. |
| Pivot points standard | This chart's own bars, grouped by the session module's periods: `tradingDayOf` for the trading day, with the overnight joining the morning it opens into; then week from Monday, month, quarter and year. *Regular hours only* (the default) builds the previous period's high, low and close from regular-session bars, which is how the standard desks' day bars are built. |
| Pivots high/low, zig zag, auto fib, pitchfork | This chart's own bars. |

## Candlestick patterns — all added

Definitions are in `src/data/builtinScriptsCandles.ts` (Pine). The proof is `scripts/candle-patterns-proof.ts`, run on
hand-built candles for every pattern.

**Common geometry (built-in defaults):**

- A body is long or small compared with its own 14-bar EMA.
- A shadow counts once it exceeds 5% of the body.
- A doji's body is at most 5% of its range.
- A hammer's or star's shadow is at least 2× its body.
- A marubozu's shadows are each at most 5% of its body.
- A spinning top's shadows are each at least 34% of its range.
- A long shadow is more than 75% of the range.

**Trend rule.** Default: the close against the 50-bar SMA. Alternatives: the close against the SMA50 together with the
SMA50 against the SMA200, or no detection at all.

| Pattern | | Pattern | |
|---|---|---|---|
| Abandoned Baby (bearish / bullish) | added | Inverted Hammer | added |
| Dark Cloud Cover | added | Kicking (bearish / bullish) | added |
| Doji | added | Long Lower Shadow | added |
| Doji Star (bearish / bullish) | added | Long Upper Shadow | added |
| Downside Tasuki Gap | added | Marubozu Black / White | added |
| Dragonfly Doji | added | Morning Doji Star | added |
| Engulfing (bearish / bullish) | added | Morning Star | added |
| Evening Doji Star | added | On Neck | added |
| Evening Star | added | Piercing | added |
| Falling Three Methods | added | Rising Three Methods | added |
| Falling Window | added | Rising Window | added |
| Gravestone Doji | added | Shooting Star | added |
| Hammer | added | Spinning Top Black / White | added |
| Hanging Man | added | Three Black Crows | added |
| Harami (bearish / bullish) | added | Three White Soldiers | added |
| Harami Cross (bearish / bullish) | added | Tri-Star (bearish / bullish) | added |
| | | Tweezer Top / Bottom, Upside Tasuki Gap | added |

That is 44 patterns. Each single script carries an alert condition.

**All candlestick patterns** has the trend rule, the pattern type (Both / Bullish / Bearish) and one switch per
pattern. It is a **chart indicator**, not a Pine script, for a measured reason: all 44 patterns at once is about 90
statements per bar, and the Pine runtime ran past its 200 ms budget at bar 384 of 840 on Terrain. The chart indicator
lives in `src/data/candlePatterns.ts`. It parses the same Pine conditions with the runtime's own parser, turns them into
closures (nothing is evaluated from text), and runs them over the same helper series, which use the runtime's
`ta.sma`/`ta.ema`. The proof checks that it equals every single script, mark for mark, under all three trend rules. It
covers 1,000 bars well inside 150 ms.

**Not in the published set, so not added:** Belt Hold, Three Inside Up/Down, Three Outside Up/Down. The standard
desks' candlestick list does not include them.

## Volume profiles — added as indicators

The maths is in `src/data/volumeAtPrice.ts`, a new shared helper; worker L's drawing profiles may import it. The
drawing is `tvProfilesPrimitive.ts`. The proof is `scripts/volume-at-price-proof.ts`.

**Shared rules for all four profiles:**

- **Rows layout:** number of rows (default 24) or ticks per row; tick = $0.01; capped at 400 rows.
- **Volume shown:** Up/Down (default), Total or Delta.
- **POC:** the row with the most volume.
- **Value area:** 70% by default. It grows from the POC one row at a time: the heavier of the next row above and the
  next row below joins. On a tie, the row nearer the POC wins, then the row above. This is the standard desks'
  published rule.
- **VAH / VAL:** the outer edges of the value area.
- **Toggles:** POC, value area, extend POC right.
- **Width %:** how wide the widest row draws.

| Indicator | Status |
|---|---|
| Visible Range Volume Profile | added. Docked right (or left), 30% wide, rebuilt as the view moves. |
| Session Volume Profile | added. One profile per trading day (session module), All or Regular hours. Intraday only. |
| Periodic Volume Profile | added. One per Day / Week / Month. |
| Auto Anchored Volume Profile | added. Anchor: Auto (the session intraday, the month on day bars), Highest high, Lowest low or Highest volume over N bars. |
| Session Volume Profile HD | covered by the Session profile with chosen rows; no automatic zoom-dependent detail. |
| Fixed Range / Anchored Volume Profile | drawing tools, owned by worker L, built on the same helper. |
| Developing POC / developing VA lines | skipped (not added). |

## Pivots and auto levels

The maths is in `src/data/tvLevels.ts`. The drawing is `tvLevelsPrimitive.ts`. The proof is `scripts/tv-levels-proof.ts`.

| Indicator | Status |
|---|---|
| Pivot Points Standard | added. Six types, each to the published formulas: Traditional (P, R/S1–5), Fibonacci (P, R/S1–3), Woodie (uses the current open), Classic (R/S1–4), DM (3 levels, chosen by the previous close vs open) and Camarilla (R/S1–5). Timeframe: Auto (day up to 15-minute bars, week up to the day, month above), Daily, Weekly, Monthly, Quarterly, Yearly. Pivots back: 15. Labels and prices at the left of each rung. The live period runs to the right edge. |
| Pivot Points High Low | added. Left/right bars 10/10 for highs and lows, with the price at each swing. A high must be above the bars to its left and at least as high as those to its right. |
| Zig Zag | added. Deviation 5%, pivot legs 10 (half on each side). An opposite swing past the deviation starts a leg; a further swing in the same direction moves the point. Optional dashed live leg to the furthest bar since. Labels: price, change (absolute and %), cumulative volume of the leg. |
| Auto Fib Retracement | added. A zig zag whose threshold is ATR(10) ÷ close × 100 × deviation (3), depth 10, over its last leg. Levels 0…1 plus 1.618, 2.618, 3.618 and 4.236, each switchable. Reverse, extend left/right, prices. |
| Auto Fib Extension | added. Over the last three zig-zag points A, B, C: C + (B − A) × level. |
| Auto Pitchfork | added. Original, Schiff and Modified Schiff on the last three zig-zag points. Median plus the 0.5 and 1 parallels by default; 0.25, 0.382, 0.618 and 0.75 are switchable. *Inside* is not added: its geometry is not documented. |
| Williams Fractals | the fractal support/resistance built-in; worker N ships it as a Pine indicator. Not duplicated here. |
| Auto Trendlines | skipped: not found in the published built-in list. |
| Auto Chart Patterns (head and shoulders and others) | skipped (not added). |
| Technical Ratings | skipped (not added). Computable from this chart's bars, and left for the Pine shelf owners (workers M and N). |
| Price Target | skipped — needs analyst price targets, which neither feed gives the chart. |

## Files

- **New:**
  - `src/data/builtinScriptsCandles.ts`
  - `src/data/candlePatterns.ts`
  - `src/data/volumeAtPrice.ts`
  - `src/data/tvLevels.ts`
  - `src/components/gex/tvSpecialItems.ts`
  - `src/components/gex/useTvSpecialLayer.ts`
  - `src/components/gex/tvProfilesPrimitive.ts`
  - `src/components/gex/tvLevelsPrimitive.ts`
  - three proofs
- **Small edits:**
  - `builtinScripts.ts`: group union and one spread line.
  - `indicatorItems.ts`: one spread line.
  - `indicatorLooks.ts`: `choice` and `quiet` input kinds.
  - `IndicatorSettings.tsx`: the select.
  - `IndicatorLegend.tsx`: choice names and quiet inputs.
  - `ScriptLibrary.tsx`: two shelves.
  - `StrikeChart.tsx`: keys, inks, one hook call and the legend line.
  - `pages/terrain/setups.ts`: the keys.
  - `scripts/run-proofs.mjs`.
