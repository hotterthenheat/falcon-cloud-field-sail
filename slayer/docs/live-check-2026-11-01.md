# Live check — Sunday 1 Nov 2026, 19:40–21:30 ET (worker R)

Every check ran on real data and nothing else. The terminal was serving Friday 30 Oct, the last regular session, and
the overnight that opened at 20:00 ET. Unusual Whales was live. No seeded or test candles were used. The dev server
was on port 5198 from this branch: origin/main 2219a2e, with main 565d4b5 merged before the gates.
Screenshots are in `photos/port-R/`, at 1440×900 and at 390×844.

| # | Item | Verdict |
|---|------|---------|
| 1 | Drawing with the desk rail | **PASS** (one defect found on the way: see FIXED-B) |
| 2 | M–Z indicators | **PASS** |
| 3 | Net flow dock room | **PASS** |
| 4 | Surface Skew / Drift lenses and the Regime room | **PASS** |
| 5 | Exposure nodes, Levels look | **PASS** (see the note) |
| 6 | Time axis named "Oct 29" twice | **FIXED** (A) |
| 7 | Overnight bars and shading | **PASS against tonight's feed** (see the note) |
| + | Coordinator: NVDA/TSLA/AMD without pre/post | **FIXED** (C) |
| + | Coordinator: VIX 404s | **FIXED** (D) |

## 1. Drawing (DeskDrawRail) on SPY 15m — PASS
- Ten kinds were placed with the rail's tools on Thursday and Friday's SPY candles: trend line, fib retracement,
  pitchfork, XABCD, Gann box, long position, fixed-range volume profile, date-and-price range (the ruler) and a text note.
  Every one drew with real values:
  - the fib levels: 769.57 down to 763.53
  - the long position: Long 755.44, Qty 95, R:R 2.00, open P&L +$159.49 at 757.12
  - the volume profile: 77.61M over 51 bars, VAH 758.20, POC 756.37, VAL 751.93
  - the ruler: +4.19, +0.56%, 17 bars, 4h 15m
- The style bar was tested on the trend line: colour (#9CA3AF), width (3 px), clone (two in store), lock (the clone
  locked) and delete (back to one).
- Object tree: it listed all 9 drawings. Hide and show from the tree were stored.
- Undo and redo stepped through the hide and show, then removed and restored the text and the ruler: 9 → 8 → 7 → 9.
- After a reload the stored drawings were byte-identical and drew on the same candles. Shots: `1-drawings-1440.png`,
  `1-drawings-after-reload-1440.png`, `1-2-drawings-indicators-390.png`.

## 2. M–Z indicators on SPY 15m (1000 real bars) — PASS
- All eight drew with legend values and no console error:
  - Stochastic RSI 97.69 / 94.43
  - TRIX −1.06
  - Vortex 1.07 / 0.9114
  - Williams Alligator
  - Volatility Stop 755.24
  - VWMA 755.42
  - Ultimate Oscillator 64.29
  - Technical Ratings 0.2242
- Each one was then run through the Pine runtime on the same 1000 bars, with the 200 ms budget:

  | Indicator | Run time |
  |---|---|
  | Stochastic RSI | 25–37 ms |
  | TRIX | 9 ms |
  | Vortex | 14–16 ms |
  | Alligator | 18–22 ms |
  | Volatility Stop | 15–24 ms |
  | VWMA | 7–11 ms |
  | Ultimate Oscillator | 22–28 ms |
  | Technical Ratings | 29–38 ms |

  No value was non-finite after warm-up.
- The cap of two own panes is enforced, so the sub-pane ones were checked two at a time. Shots: `2-indicators-A/B/C-1440.png`.

## 3. Net flow room — PASS
The check compared net calls − net puts in the room with the Net drift line's last value. The window and the filters
were the same (Any print · Legs out · OTM · Both sides · DTE 0–60 · ≥$50K).

| Name | Net calls | Net puts | Net (room) | Net drift (chart) |
|---|---|---|---|---|
| SPY, 09:30–16:14 | 4,073,930 | −298,160 | **4,372,090** | **4,372,090** |
| SPX (index), 09:30–16:15 | 2,966,260 | 294,578 | **2,671,682** | **2,671,682** |

On SPX the totals matched at every step while the tape read back (+2.6M, +385K, −271K, +895K, +3.9M, +2.67M).
Shots: `3-netflow-SPY-1440/390.png`, `3-netflow-SPX-1440.png`.

## 4. Surface Skew and Drift, and the Regime room — PASS
These were checked on SPY and SPX, in the dock, at both sizes. There was no NaN, no error and no overflow.
- **Skew (SPY):** ATM 16.79, RR25 −3.81, FLY25 +0.11, as of Fri 4:15 PM, with the term structure and the surface grid.
- **Drift (SPY):** charm Buy $3.7B, vanna Buy $4.2B, by strike and by expiry.
- **Regime:** contango 0.935, the VIX term structure 19.33 / 19.25 / 19.42 / 20.78 / 22.20, the 1-year percentiles,
  and the VIX/VIX3M and VIX9D/VIX ratio lines.

Shots: `4-surface-skew-*.png`, `4-surface-drift-*.png`, `4-regime-SPY-*.png`.

## 5. Levels look — PASS (note)
There are two switches.
- **The rail's Settled/Live (the book):** it changes which strikes are named.
  - SPY: Settled shows 760 / 755 / 750. Live shows 760 / 750 / 740, and the walls move to 758 and 745.
  - QQQ: Settled shows 690 alone at −$6.9B. Live shows 700 / 695 / 690.
- **The chart's own Live/Settled pill (the field's model):** it changes the values, but this weekend's ranking was the
  same strike set in both models on all three names.
  - SPY 760: −$932M → −$1.0B. SPY 755: −$611M → −$594M.
  - QQQ 680: −$1.1B → −$951M.
  - AAPL's two books barely differ, as the rail's own numbers show.

No label stacked on SPY, QQQ or AAPL at 5m or 15m at 1440, nor on SPY at 390. Shots: `5-levels-*.png`. The 1440 files
are the pill toggle; the rail-toggle frames were overwritten by them.

## 6. FIXED (A) — the axis named a day twice
- **Cause:** lightweight-charts weighs each bar against the previous one on UTC's calendar, so the first bar of a UTC
  day becomes a Day tick. The overnight's 20:00 New York bar is 00:00 UTC. Our formatter names a tick in the reader's
  zone, so it named that tick for the day it still was in New York: "Oct 29 … Oct 29". Oct 30 never got a name.
- **Fix:** StrikeChart now builds its chart with `createZonedChart` (chartTime.ts). That is a horizontal-scale
  behaviour whose `fillWeightsForPoints` reads the library's ladder on the chosen zone's wall clock
  (`zoneWeights.ts`). A change of zone re-weighs the bars already drawn (`rezoneAxis`).
- **Proof:** `scripts/chart-zone-proof.ts`.
  - UTC weights reproduce Oct 29/Oct 29; New York's weights give Oct 29/Oct 30.
  - Each tick sits on the first bar of its day.
  - The fall-back DST change works.
  - Incremental weighing equals whole.
- **Live:** shots `6-axis-before-1440.png` (old: 14:00 · Oct 29 · 02:00) and `6-axis-after-1440.png` (Oct 30 at
  midnight); Tokyo in `6-axis-tokyo-1440.png`. The view stays put when the zone changes. A/B on SPX showed the same
  double, and it is fixed the same way.

## FIXED (B) — the pane died when the pointer rested on the flow pane during a load
- **Symptom:** "SPY COULD NOT DRAW — Value is null". This was reproduced 3 of 3 times with plain createChart, so it is
  not caused by A.
- **Cause:** the flow histogram got a new `autoscaleInfoProvider` through `applyOptions` on every run. While those
  options were pending, the full history landed and another series' setData re-indexed the time scale. The library's
  hit test then re-coloured stale items, and the lookup came back null.
- **Fix:** the provider is set once, when the series is created, and reads a ref. After the fix it was 0 of 3, with
  the pointer on either pane.

## 7. Overnight (after 20:00 ET) — PASS against tonight's feed
- **Stocks:** neither stock feed has SPY or QQQ overnight prints tonight; the overnight tape holds 0 bars. Merged main
  shows the badge "Overnight · open". The empty gap carries no note. The after-hours band is shaded through 20:00.
- **SPX:** the overnight line built from options is drawing live from the 20:15 GTH session. It read 7613.43 against
  Friday's close of 7580.07, after the Nov tick. The index tape itself has no overnight bars.

Shots: `7-overnight-SPY/QQQ/SPX-1440.png` and `-390.png`.

## FIXED (C) — NVDA, TSLA and AMD showed the regular session only
- **Reproduced:** in one page, sweeping names on 5m. In 3 of 3 sweeps NVDA's chart stopped at Fri 15:55 even though
  its after-hours tape held 960 bars (`peekTape`). The request windows were identical to AAPL's, and every 5m window
  answered 200 with data.
- **Cause:** the history filled the chart's 1000-bar window before the heavy name's after-hours tape was cleaned. When
  that tape landed, the drawn count moved by exactly one (1001 → 1000). The data pass took any change of one for "a new
  bar", so it updated only the newest bar and never drew the session.
- **Fix:** `tailOnly` (barPass.ts) allows an in-place update only when the bars are the drawn ones plus at most one
  newer bar. Anything else is set again. Proof: `scripts/bar-pass-proof.ts`.
- **Also:** `wantChartTape` now asks the drawn grain's tapes before the one-minute tapes, so the pre-market and the
  after-hours are no longer queued behind the minute tapes' reads.
- **After:** a sweep of AAPL, SPY, QQQ, NVDA, TSLA, AMD, MSFT and AVGO showed every name with pre and post, ending
  19:55.
- **Remains:** a cold name still takes about 10 s to show its extended sessions. Those windows wait up to 4 s for the
  lead session, then for the terminal's queue.

## FIXED (D) — VIX logged 404s
- **Cause:** `/api/exposure/hist` answered 404 for a day it cannot rebuild. VIX and SPX have no stock bars to rebuild
  from. The browser printed one console error for each day in view.
- **Fix:** it now answers 200 with an empty series. The page already reads that as none and asks Unusual Whales.
  A proof case was added to `scripts/exposure-hist-proof.ts`.

## Not fixed
Typing a symbol in the switcher can preview a name Unusual Whales does not know, and that logs one 404 (seen for
`/api/uw/stock/AMFC/info` while typing "AMD").

## Gates
- `ci-local.sh`: CI_LOCAL_OK.
- `vite build`: OK.
- Smoke on /terrain and /pulse at 1440 and 390: err=0, nan=0, vendor=0, overflow=false.
