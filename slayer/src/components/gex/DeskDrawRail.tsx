/* THE DESK'S DRAWING RAIL — Noah's (his DeskDrawRail.tsx, 2026-10-30/31: "i want one big toolbar on the side no matter the
   layout"), ported whole: ONE rail for Terrain's desk, a full-height column at its left edge, the same on a one-up and a
   four-up; the panes draw none. It drives the ACTIVE pane by name (drawTools.tsx `drawChartFor`) and wears what that
   pane's drawing is doing — switch panes and the rail follows. His size, measured on openmarket: a 48px rail, every cell a
   36×36 face at its centre, 20px glyphs, the groups 17px apart with a hairline between, the housekeeping at the foot; on a
   short window the rows stay 36 and the rail scrolls. Hidden, it is a slim tab at the edge (the `open` every rail keeps).

   His three clusters, with our tools inside them:
     THE TOOLS        the cursor, a button a family (his seven; our patterns, cycles and icons sit in the closest of them), the search, the star
     THE SWITCHES     his ruler (date and price range, one shot), his magnet (ours: off → weak → strong), our stay in
                      drawing mode, his lock every mark, his hide every mark (our sync drawings is the object tree's
                      head switch — it says whose list that is)
     THE HOUSEKEEPING our object tree, undo and redo; his remove every mark (a second press within three seconds
                      confirms), hide the rail, and the active pane's number on a desk of more than one
   The lists and the sheet fly out into the desk's box (`host`). Not on a phone: one pane there, with its sheet door; the
   takeover (one pane on the whole screen) keeps the pane's own rail. */

import { useEffect, useRef, useState } from 'react';
import { ChevronsLeft, Eye, EyeOff, ListTree, Lock, LockOpen, MousePointer2, Pencil, Redo2, Ruler, Trash2, Undo2 } from 'lucide-react';
import DrawRailTools, { BIG_CELL, DrawSheet, MagnetGlyph, RailRule, StayGlyph, railFace } from './DrawRailTools';
import { drawChartFor, setDrawPref, setRailPrefs, useDrawChartState, useDrawToolPrefs, useRailPrefs } from './drawTools';
import type { DrawingKind } from './drawingsPrimitive';

interface Props {
  /** The active pane's name — StrikeChart's `paneId`, 'terrain:1' … */
  pane: string | null;
  /** The desk's box: the lists and the sheet fly out into it, and are clamped inside */
  host: HTMLElement | null;
  /** The pane's number on a desk of more than one — printed at the rail's foot so the reader knows whose marks these are */
  label?: string;
  /** What the foot says on hover */
  title?: string;
  /** The active tape's ground and colour, as the strips above it wear them (Terrain's top rows) — none: the page's own chrome */
  ground?: 'dark' | 'light';
  bg?: string;
}

/** The rail's width when open and when hidden — a host's fit rules may read these */
export const DESK_RAIL_W = 48;
export const DESK_RAIL_HIDDEN_W = 14;
const CONFIRM_MS = 3000;

const CELL = `inline-flex items-center justify-center rounded transition-colors ${BIG_CELL}`;
const G = 'w-5 h-5';
const face = (on: boolean, disabled = false) => (disabled ? 'text-textSecondary opacity-30 cursor-default' : railFace(on));

const DeskDrawRail = ({ pane, host, label, title, ground, bg }: Props) => {
  const rail = useRailPrefs();
  const prefs = useDrawToolPrefs();
  const state = useDrawChartState(pane);
  const [sheetOpen, setSheetOpen] = useState(false);
  /* REMOVE ALL asks once: the first press arms the bin for three seconds, the second empties the tape */
  const [armedClear, setArmedClear] = useState(false);
  const clearTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    []
  );
  /* a different pane under the rail: an armed bin stands down */
  useEffect(() => setArmedClear(false), [pane]);
  const chart = () => drawChartFor(pane);
  const pick = (kind: DrawingKind) => {
    setSheetOpen(false);
    chart()?.arm(kind);
  };
  const removeAll = () => {
    if (!armedClear) {
      setArmedClear(true);
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setArmedClear(false), CONFIRM_MS);
      return;
    }
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    setArmedClear(false);
    chart()?.clear();
  };

  if (!rail.open) {
    /* the way back — a slim column holding one tab, mid-height, so a hidden rail is one click from found */
    return (
      <div className="relative shrink-0 self-stretch" style={{ width: DESK_RAIL_HIDDEN_W }} data-desk-rail="hidden">
        <button
          type="button"
          onClick={() => setRailPrefs({ open: true })}
          title="Show the drawing tools"
          aria-label="Show the drawing tools"
          data-chart-rail
          className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-md border border-l-0 border-borderMuted bg-panel/80 px-1 py-2.5 text-textSecondary hover:text-textPrimary shadow-lg shadow-black/40 transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const none = state.count === 0;
  const magnet = prefs.magnet;
  const nextMagnet = magnet === 'off' ? 'weak' : magnet === 'weak' ? 'strong' : 'off';
  const magnetWords =
    magnet === 'off'
      ? 'Magnet off — click for the weak magnet (snaps near a bar’s open, high, low or close)'
      : magnet === 'weak'
        ? 'Weak magnet — click for the strong magnet (always snaps); hold Ctrl to flip it while drawing'
        : 'Strong magnet — click to turn the magnet off; hold Ctrl to flip it while drawing';
  return (
    <div
      data-chart-rail
      data-desk-rail="open"
      data-chart-chrome={ground ? '' : undefined}
      data-chart-ground={ground}
      className="shrink-0 self-stretch flex flex-col border-r border-borderMuted bg-panel select-none"
      style={{ width: DESK_RAIL_W, background: bg }}
    >
      {/* one scrolling column; on a short window the rows stay 36 and it scrolls */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] flex flex-col pt-1">
        {/* THE TOOLS */}
        <button
          type="button"
          onClick={() => chart()?.select()}
          title="Select — click a drawing to move or delete it"
          aria-label="Select"
          aria-pressed={state.drawing && state.tool === 'select'}
          className={`${CELL} ${face(state.drawing && state.tool === 'select')}`}
          data-desk-rail-select
        >
          <MousePointer2 className={G} />
        </button>
        <DrawRailTools dock="left" big drawing={state.drawing} drawTool={state.tool} onPick={pick} host={host} sheetOpen={sheetOpen} onSheet={setSheetOpen} />

        {/* THE SWITCHES */}
        <RailRule dock="left" big />
        <button
          type="button"
          onClick={() => pick('measure')}
          title="Measure — a date and price range, one shot"
          aria-label="Measure"
          aria-pressed={state.drawing && state.tool === 'measure'}
          className={`${CELL} ${face(state.drawing && state.tool === 'measure')}`}
          data-desk-rail-measure
        >
          <Ruler className={G} />
        </button>
        <button type="button" onClick={() => setDrawPref({ magnet: nextMagnet })} title={magnetWords} aria-label={magnetWords} aria-pressed={magnet !== 'off'} className={`${CELL} ${face(magnet !== 'off')}`} data-draw-magnet={magnet}>
          <MagnetGlyph strong={magnet === 'strong'} className={G} />
        </button>
        <button
          type="button"
          onClick={() => setDrawPref({ stay: !prefs.stay })}
          title={prefs.stay ? 'Stay in drawing mode — on: a placed mark leaves the tool in hand' : 'Stay in drawing mode — off: a placed mark hands back the pointer'}
          aria-label="Stay in drawing mode"
          aria-pressed={prefs.stay}
          className={`${CELL} ${face(prefs.stay)}`}
          data-draw-stay
        >
          <StayGlyph className={G} />
        </button>
        <button
          type="button"
          onClick={() => chart()?.lockAll()}
          disabled={none}
          title={none ? 'Lock every drawing — none on this chart yet' : state.locked ? 'Unlock every drawing' : 'Lock every drawing in place'}
          aria-label={state.locked ? 'Unlock all drawings' : 'Lock all drawings'}
          aria-pressed={state.locked}
          className={`${CELL} ${face(state.locked, none)}`}
          data-draw-lock-all
        >
          {state.locked ? <Lock className={G} /> : <LockOpen className={G} />}
        </button>
        <button
          type="button"
          onClick={() => setDrawPref({ hideAll: !prefs.hideAll })}
          title={prefs.hideAll ? 'Show every drawing again (Ctrl+Alt+H)' : 'Hide every drawing — kept, not deleted (Ctrl+Alt+H)'}
          aria-label={prefs.hideAll ? 'Show all drawings' : 'Hide all drawings'}
          aria-pressed={prefs.hideAll}
          className={`${CELL} ${face(prefs.hideAll)}`}
          data-draw-hide-all
        >
          {prefs.hideAll ? <EyeOff className={G} /> : <Eye className={G} />}
        </button>

        {/* THE HOUSEKEEPING, at the foot */}
        <div className="mt-auto" aria-hidden />
        <RailRule dock="left" big />
        <button
          type="button"
          onClick={() => chart()?.toggleTree()}
          title="Object tree — every drawing on this chart: rename, hide, lock, reorder, delete"
          aria-label="Object tree"
          aria-pressed={state.treeOpen}
          className={`${CELL} ${face(state.treeOpen)}`}
          data-draw-tree-door
        >
          <ListTree className={G} />
        </button>
        <button type="button" onClick={() => chart()?.undo()} disabled={!state.canUndo} title="Undo the last drawing change (Ctrl+Z)" aria-label="Undo" className={`${CELL} ${face(false, !state.canUndo)}`} data-draw-undo>
          <Undo2 className={G} />
        </button>
        <button type="button" onClick={() => chart()?.redo()} disabled={!state.canRedo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo" className={`${CELL} ${face(false, !state.canRedo)}`} data-draw-redo>
          <Redo2 className={G} />
        </button>
        <button
          type="button"
          onClick={removeAll}
          disabled={none}
          title={none ? 'Remove every drawing — none on this chart yet' : armedClear ? 'Press again to remove every drawing' : 'Remove every drawing'}
          aria-label={armedClear ? 'Press again to remove every drawing' : 'Remove every drawing'}
          className={`${CELL} ${none ? face(false, true) : armedClear ? 'bg-bear/20 text-bear' : face(false)}`}
          data-desk-rail-clear={armedClear ? 'armed' : undefined}
        >
          <Trash2 className={G} />
        </button>
        <button
          type="button"
          onClick={() => setRailPrefs({ open: false })}
          title="Hide the tools — the small tab at the edge brings them back"
          aria-label="Hide the tools"
          className={`${CELL} text-textMuted hover:text-textPrimary hover:bg-ink/[0.04]`}
          data-desk-rail-hide
        >
          <ChevronsLeft className={G} />
        </button>
        {label && (
          /* whose marks: the active pane's number — a desk of one needs no reminder */
          <span title={title} className="inline-flex items-center justify-center h-[18px] shrink-0 w-full font-mono text-t10 tnum text-textMuted" data-desk-rail-pane={label}>
            {label}
          </span>
        )}
      </div>
      {sheetOpen && host && (
        <DrawSheet
          host={host}
          dock="left"
          drawTool={state.drawing ? state.tool : 'select'}
          onPick={pick}
          onClose={() => setSheetOpen(false)}
          onTree={() => {
            setSheetOpen(false);
            if (!state.treeOpen) chart()?.toggleTree();
          }}
        />
      )}
    </div>
  );
};

export default DeskDrawRail;
