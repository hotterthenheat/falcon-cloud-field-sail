# Terrain panels — the rules, and the matrix that proves them

The desk's rules for where things live (kept from the 7c3778a pass, and extended here):

1. **Strike rooms open in the ACTIVE pane's own rail**, beside that pane (dockStore `RAIL_VIEW_OF_ROOM`, Terrain's
   `dockRow`). The right dock holds only desk-level rooms (news, earnings, events) and gives way before it would crush
   a chart (`dockRoomFor`). A strike room left in storage is shut on load, never shown in the dock.
2. **On in the pane's config means a column at that pane's right edge, always** — the rail, its failure card, a
   loading card, or a folded strip that says why. Never nothing, never in another pane. ProfilePanel follows any change
   of its box.
3. **One drawing rail, never a floating tab.** Docked, the desk draws Noah's DeskDrawRail at its left edge; the
   takeover mounts the same rail at its own left edge; the phone has a pencil in the pane header (`PaneDrawDoor`).
   StrikeChart is always `hostRail` on Terrain, so a pane never draws its own pencil tab over the tape. Hidden, the
   rail's 14px gutter is itself the door back; nothing hangs past it onto a chart.
4. **Every pane has its own search.** The pane header's symbol (the "1 SPY · 15m" legend on a split desk, the symbol
   chip elsewhere) and the small glass beside it open the name search on THAT pane: the pane becomes active and the
   pick lands there (every pane with Symbol sync on). The sheet's head says which chart ("Chart 2", "· synced").
   A letter typed opens it on the active pane — in the takeover, on the pane on screen. The ticker bar's search and
   ⌘K keep the active pane.
5. **Keys act on the pane you can see.** In the takeover every pane key (`r`, `s`, `d`, `p`, `-`/`=`, letters, ⌘K)
   acts on the expanded pane; `[` `]` do nothing there (they used to move the keys onto a pane under the overlay).

## The matrix

Run with Playwright against the dev server (ThetaData off — charts show the honest offline state, which is all this
needs). Every layout count and shape (1 · 2h 2v · 3B 3h 3L 3T 3v · 4g 4h 4L 4T · 6g 6v) × strike rail off / one pane
/ every pane × dock shut / open (news), at 1440×900 and 1920×1080; for each shape with rails off: `]` (active
switching) → `r` (rail on the active pane only) → `⇧R` on → `⇧R` off → the last pane's own search door → window
resize to −300×−100 and back → takeover in (`f`), rail hidden in the takeover, a letter typed in the takeover, out
(Esc). Plus a strike room (`heat`) left in storage, and the phone at 390×844.

Each state checks: horizontal overflow; panes overlapping each other; the dock or the desk rail over a chart; any
pencil tab over a chart; corner chips on the pane's legend or read line; a pane clipped (on the unstacked desk) or
crushed under 200px; a rail outside its pane or a chart box running under its rail; the config's rail flag against
the rail on screen (menu says on, UI off); the bar's pane against the active pane; a pane without its own search; the
search's target against the pane it was opened on.

| Check | Before (7c3778a) | After |
| --- | --- | --- |
| Pane without its own search door (every layout, both sizes, phone) | 168 states | 0 |
| A pane's search opens on that pane and makes it active | no door to test | every shape, 1440 + 1920 |
| Floating pencil tab over the tape — phone | 1 (compact sheet door at the left edge) | 0 (pencil in the pane header) |
| Floating pencil tab over the tape — takeover, rail hidden | yes (the pane's own slim tab at the left edge, `hostRail` was off in the takeover) | 0 (the desk rail's gutter door) |
| Desk rail hidden: tab hanging past its 14px column onto pane 1 | ~7px over the chart | 0 (the gutter is the door) |
| Letter typed in the takeover opens the search | no (the takeover's own `aria-modal` blocked it) | yes, on the expanded pane |
| `[` `]` in the takeover moved the keys to a hidden pane | yes | no-op in the takeover |
| Corner chips (book switch, field key) on the heaviest-strike read line, narrow panes (6g, 4-up) | overlapped (seen on 6g pane 5) | chips drop under the read line below 720px |
| `r` hits the wrong pane after `]` | 0 | 0 |
| `⇧R` on / off leaves a rail out of sync | 0 | 0 |
| Config rail on but no rail shown / off but shown | 0 | 0 |
| Dock over a chart, panes overlapping, horizontal overflow | 0 | 0 |
| Strike room left in storage opens in the right dock | 0 | 0 |
| Takeover stuck open after Esc | 0 | 0 |

Two first-run hits were the test's own and are not flaws: an unsized 300px overlay canvas reads wider than its
clipped chart box, and below `xl` (1140px) the panes stack and the page scrolls by design.

Re-run: `node matrix.cjs <tag>` (the script lives in the session scratchpad; it seeds `slayer_terrain_v1`,
`slayer_terrain_dock_v1` and `slayer_draw_rail`, then probes the DOM boxes listed above).
