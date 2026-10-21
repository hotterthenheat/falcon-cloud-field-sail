# The partner's Map, taken whole (2026-10-14)

Noah, with three pictures of newslyer's Map (`hotterthenheat/newslyer`, branch `claude/clever-bell-3gkk1h`, read at
`C:\Users\Dracula\Downloads\newslyer`): "i want all of these things in my map section but fixing up any bugs he has …
dont just look at the images i sent you but the actual file, we will add all of it and more". His Map is sixteen
commits from 2026-10-13 to 10-15 on top of our 10-12 Map. This is what came over, on what seams, what was fixed on the
way, and what stayed his.

## Taken

- **The band in its own strip** above the book, flat controls (`ui/flatDoor.ts`): View · Greek · Legs · Expiries ·
  Strikes · Show · Names · Replay · More · Supreme · The read · How to read · fullscreen, grouped by hairlines; the
  doors drop their words one door at a time to stay one row; two scrolling rows on a phone (`ui/scrollMore.ts`).
  **In the head when the head has the room** (3440: the band rides beside the page's name; `#pinpoint-head-band` in
  `PinpointLayout.tsx`).
- **The book packed to its panes with THE DAY beside it** (`components/gex/DayBox.tsx`): the tape with the levels on
  it (`TapeBox.tsx` — price lines named on the line, a bell a level, the flip's own path, one expected move to the
  close, the kept strike's chip when it is off the scale) over the book's net gamma through the session
  (`BookThroughDay.tsx` — a baseline at zero, ember above, glacier below, spot faint beside it), one clock
  (`dayChart.ts`, `data/dayAxis.ts`, `data/dayHover.ts`), both drawn by lightweight-charts the way Compare's are.
- **The matrix cell** (`ExposureMatrix.tsx`): the figure over a thin bar on a track, **put · call · net under every
  greek** by rest (the Legs card: All · Net · Calls · Puts · Both), the level's word in the row's first cell in the
  strike's ink (`strikeRole.ts`, `StrikeNum.tsx`), the three heaviest bars at full ink, the rows sharing the box down
  to 24px, the keys walking the rows, the hover going on while a strike is kept, Escape letting go.
- **The calendar** (`ExposureLedger.tsx`): the card on a hover and a click, the kept cell's card at the click's point,
  the since-open chips at 11px with the dot where there is no room, the true minus on a short figure, "nothing here"
  for an empty cell, the keys walking the cells, the focus summary line.
- **The profile** (`ExposureProfileView.tsx`, `data/exposureCurve.ts`): dealer gamma re-priced across spot, the
  book's third view — the total as a baseline, a quiet line a date, the walls, the supreme, spot, the zero crossing and
  the kept strike as rules with tags, the figures under the pointer, click to keep the nearest strike.
- **Every column carries its own facts** (`ColumnFacts.tsx`): the price, the change, the flip and its distance in the
  Ruler's unit, the dealers' word, how the flip held today — a narrow column sheds the words before the figures.
- **One price on the page** (`pages/pinpoint/useRoomSpot.ts`, `RoomSpotRule.tsx`): the spot pill, the tape's Last and
  the facts print the same figure; a grid re-renders only when the price crosses a strike.
- **The trader's clock and the levels report in the house's grammar** (`TraderClock.tsx`, `WallReportCard.tsx`): the
  facts on one mono line, one-word phases, a 28px strip whose blocks wear ember and glacier, fifteen-minute blocks on a
  narrow strip, the keys walking the blocks; the report as one table (level · strike · session strip with price's path
  · tests · held · broke · last · gamma since open · **before today** — the base rates off the sessions on hand,
  `data/levelRecord.ts`), levels that share a strike on one row, the whole row keeps the strike, "closed inside the
  expected move N of M" on the head. Side by side from 1880px.
- **More** (`MoreDoor.tsx`): where the book comes from (`BookProvenance.tsx` — the source, the freshness, the formula,
  the sign, the levels and what others call them) and the two exports (`data/exportBook.ts`: the book as CSV, the
  levels as JSON).
- **The Levels card** in the head (`data/levelsScope.ts`, `data/roomLevels.ts`): the walls, the flip and the supreme
  read off today's contracts or every listed date — one reading for every box.
- **The replay** as a bar across the top of the book (`ReplayStrip` `wide`, with its pace), starting at the session's
  own first bar and playing, the head wearing a **Replaying** tag (`replayState.ts`); the rewound legs bounded
  (`data/replay.ts legsOf`).
- **The rest**: every box folds (`FoldDoor.tsx`, `data/boxFold.ts`); `/` keeps a typed strike; jump links on a phone;
  a name taken off is undoable; the first-visit note; a legend under the grid; the guides over the viewport with
  drawings that scroll; the pointer card above the pointer and never off the edge (`ui/PointerCard.tsx`); the Strikes
  menu counting the rows the grid draws; the Colours card off the band and into **Settings › Appearance**
  (`data/ledgerPalette.ts`); the softer calendar curve (`heatmap.ts` gamma 0.6); `AMPLIFY`/`ABSORB` as one pair for
  hedging's two sides across the Map (`paletteInk.ts`).
- **The session cut** (`data/levelview.ts sessionCut`): today is the cash session, 09:30–16:00 New York, never the
  trailing run of bars; and the simulator's history ends at the last close outside the session
  (`core/simulator.ts seedAnchorSec`), so after hours every box of the day walks the last session.

## The seams

His Map reads a market seam (`data/bookMarket.ts`: the house's simulator or Unusual Whales' feed) and a market store
(`context/marketStore.ts`, `pages/pinpoint/useRoomScan.ts`). Ours has neither yet (the data plane is pinned until Noah
says so): the boxes read the simulator through our ten-second scan in `MapDesk.tsx`, and the one price through
`useRoomSpot.ts`, a half-second read of the simulator's price that re-renders a reader only when it moves. When the
feed lands it goes behind these two seams and the boxes need no change.

## Fixed on the way

- **Two names beside each other looped the layout** ("Maximum update depth exceeded"): his column-head measure read
  `scrollWidth`, which is the box's own width when the content does not overflow it, so the host's short head read as
  "the pane and two pixels", the island packed to that, the pane grew, the head read two more. The measure is the
  pieces' own widths now.
- **A visit to the calendar lost the matrix's legs**: his cut wrote `net` into the Legs pick whenever the calendar
  came up. The pick stays the reader's; on the calendar All and Both draw as the net and the matrix takes the pick
  back.
- **After hours the day box drew the evening tape** (16:39 → 23:08): the simulator's history ended at the wall clock.
  Taken with his anchor fix — outside the session the history ends on the last weekday's 15:59.

## Left as his

- The **settle bounce** on page open (`ui/Settle.ts`, the launch gate's `useGateUp`) and his "remove all the motion"
  rule (zero-length folds, no fades): our boxes fade in as the house's do.
- The **stuck strip** of facts under the head (we took the head's facts out on 2026-10-14 at Noah's word).
- His design system's **Helvetica** and the 11px sentence-case labels on every dropdown card site-wide: our cards keep
  the house's 9px tracked labels; the band's flat controls are 11px tracked capitals as his are.
- The **glossary** link on every guide (`/glossary` is his page), `ui/layers.ts` (one Escape stack), `focusBack.ts`
  on the menus, the **Name** mark component.
- The feed-only branches in `data/exposure.ts`, `data/exposureSurface.ts`, `data/ahead.ts` (`todaysDex`,
  `surfaceIn`).

## Measured

Black and paper, 1905×960: the band in its strip (one row, the doors' words trimmed to fit), the book packed to 417px
with the day box beside it at 1172, put · call · net in the matrix, the facts row, both charts on canvas, the clock
and the report side by side; two names: the book at 942 and the day still beside; the profile and the calendar swap in
place; the replay starts at Oct 14 · 09:31 and the head says so. 3440×1440: the band rides the head (room 2297 against
1629 needed). 1440×900: the band two rows, the day beside one name, under two. 390: no sideways scroll, the jump links,
the band's rows scroll. Terrain, Weigher, Agenda, Board, Compare, Dark Pool, Settings, Pulse and Backtest open with no
page errors on the shared controls. tsc 0, theme audit 0, the four proofs hold.
