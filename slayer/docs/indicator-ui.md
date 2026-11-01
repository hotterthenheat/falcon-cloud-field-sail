# Indicator UI: the standard we matched

Notes from TradingView's own help pages and Pine docs (2026-11-01). We take the interaction model only. No branding
and no assets: our dark tokens, glacier/ember for calls/puts, and the house gamma-sign inks stay.

## What TradingView does

- **Library ("Indicators, metrics & strategies").** One search box over everything. Categories down the left
  (favourites, personal, built-ins, community). Each row shows a name (plus an author for community scripts) and a
  star to favourite it. Clicking a row adds it to the chart.
- **Legend / status line**, top left of each pane. Each row has the title, then its inputs (inputs set to
  `display.all`; bool and colour inputs are left out), then the live values in each plot's colour. The values track
  the bar under the crosshair, otherwise the last bar. On hover the row shows: eye (hide), settings, source, remove
  (trash), and a "more" menu. A hidden indicator stays listed, dimmed. A chart-level toggle can show or hide all
  titles and values.
- **Settings dialog.** Opens by double-clicking the name, or from the gear or the "more" menu. Tabs:
  - **Inputs:** only when the script declares inputs. Groups, inline pairs and tooltips.
  - **Style:** always present. Per plot: a visibility tick, colour and opacity, thickness and line style. Also a price
    line, "Labels on price scale" and "Values in status line".
  - **Visibility:** always present. Interval ranges (seconds, minutes, hours, days, weeks, months) to draw on.
  - Footer: a **Defaults** menu (reset, save as default), plus Cancel and OK.
- **Panes.** An oscillator gets its own pane with a draggable separator. Each plot's last value sits as a label on
  the price scale, in its colour. The Object Tree lists every indicator with eye and remove.

## What we matched

- **Library.** We added a new **Physics reads** shelf ("Five tested reads") beside Slayer, Technicals and Chart tools.
  Each row shows the physics name, the plain name, and a **CALCULATED** or **MODEL** tag. The star and the on-tick
  were already there. A chart row that is on now has a gear that opens the settings dialog. On a phone the shelves
  become one scrolling row and the Kind and Shelf columns fold away.
- **Legend** (`IndicatorLegend.tsx`). It replaces the old name-and-× chips for every chart indicator (EMAs, VWAP,
  Bollinger, RSI, MACD, ATR, the book lines and the five new reads). Each row has:
  - name, inputs, and live values in the indicator's ink, following the crosshair and falling back to the last bar
  - ∅ when a value is not in, rather than a stale value
  - eye, settings and remove, which go full strength on hover
  - a dimmed row with "off on this timeframe" or the reason it is not drawn here
  - for the physics reads, a context line: band width and shock half-life; regime and distance to the flip; the
    shock's source and threshold
- **Settings dialog** (`IndicatorSettings.tsx`). The **Inputs** tab appears only when the indicator has inputs.
  **Style** has colour, opacity, thickness 1–4, labels on the price scale, and values in the legend. **Visibility**
  has three timeframe bands (minutes, hours, days and up). "Back to defaults" clears the record. Changes apply live,
  and the look is kept per indicator in this browser (`data/indicatorLooks.ts`).
- **Panes.** The efficiency ratio and Amihud take own panes under the existing two-pane cap, with the pane caption and
  the last value on the scale. The efficiency ratio's scale is pinned to 0–1.

## What we skipped, and why

- **OK/Cancel and "save as default."** Changes apply live and stay, the same way every other control on the desk
  works. A second set of defaults would be another store to reason about.
- **Per-plot style rows and line-style picker.** Our multi-line indicators share one ink family. One colour, opacity
  and thickness covers the use; dashes keep meaning (forecast band dashed, next hour dotted).
- **Source view, "more" menu, Object Tree.** Built-in chart indicators have no Pine source. Our scripts open in the
  editor from the library.
- **Second/week/month interval ranges.** The desk serves minute-to-month frames. Three bands cover them without a
  range editor.
- **Draggable pane separators.** The chart library's own stretch factors set the split (tape 64%). A drag handle on
  top of it would fight Terrain's layout door.
- **Pine scripts' legend** (`ScriptLegend.tsx`) is unchanged. It already has name, inputs, eye and remove, and its
  inputs live in the library's form. Live values for script plots are still to do.
- **No "edge", score or win-rate anywhere.** The physics reads are labelled for how they are made, never for how
  good they are.
