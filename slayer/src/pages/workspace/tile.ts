/*
==================================================
  SLAYER TERMINAL - PULSE · WHAT A TILE IS
  (pages/workspace/tile.ts)

  THE DESK REBUILT (Noah, 2026-09-30: "practically
  delete every card, preset and widget. keep the
  ability on how the cards move around. we need
  proper presets, proper widget displays, proper
  headers for specific widgets, full screen …
  bringing you to the page with the back to pulse
  button"). What was wrong with the twelve it had:
  every one was a PAGE SHRUNK INTO A BOX — the tile's
  head, then the page's own head again (a guide door,
  a row of facts, a row of control cards), so the
  instrument began far down the tile and was drawn
  too small to read.

  THE CONTRACT every tile keeps:

    ONE INSTRUMENT, ONE READ   no guide door, no facts
                               grid, no second head —
                               the page has those
    ITS CONTROLS ARE THE HEAD'S  declared as data
                               (`controls`), drawn by
                               the one head as the
                               house's dropdown cards;
                               the head folds them
                               when the tile is narrow
    IT KNOWS ITS ROOM          `size.room` — small ·
                               medium · large — and
                               `size.short`
    ITS SETTINGS ARE ITS OWN   `state`, kept with the
                               instance on the desk,
                               so two copies differ
                               and the door can carry
                               what the tile showed
    ITS DOOR IS A PAGE         `page` — the real page,
                               on the tile's name,
                               with the way back to
                               Pulse; never a takeover
                               of its own

  THE CHART IS THE ONE EXCEPTION, at Noah's word
  (2026-10-02: "i dont like how you changed the pulse
  chart and removed the indicators, and button layout
  … look like the prev one"): it keeps its own
  taskbar on the tape and lifts ITS OWN FULLSCREEN
  (`fullscreen`), where its indicators live. Its page
  (Terrain) moves into the tile's menu.
==================================================
*/

import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ExposureProfileData } from '../../types/gex';
import type { MarketSnapshot } from '../../types/market';
import type { CompassView } from '../../types/compass';

/** What the desk hands every tile about the name it is on */
export interface WorkspaceCtx {
  ticker: string;
  /** The snapshot this context was built from — a tile that derives its own view (its own expiry, its own greek)
      rebuilds from it */
  snapshot: MarketSnapshot;
  /** Bumped with every feed tick */
  revision: number;
  /** The 1s heat tick */
  pulseTick: number;
  /** Today's book, ten strikes each side — the levels every tile reads */
  exposure: ExposureProfileData;
  /** The Compass board for this name's universe — built the first time a tile asks */
  setups: CompassView;
}

/** A tile's own settings — kept with the instance on the desk */
export type TileState = Record<string, string | number | boolean | undefined>;

export interface TileSize {
  /** The body's box, to the nearest 20px (a tile's width glides with the sidebar — the body is not re-rendered a frame) */
  w: number;
  h: number;
  room: 'small' | 'medium' | 'large';
  short: boolean;
}

/** One choice the head draws for a tile — the house's dropdown card */
export interface TileControl {
  /** The key in the tile's state */
  id: string;
  label: string;
  options: { value: string; label: string; hint?: string; tone?: 'bull' | 'bear' }[];
  /** A heading inside the card */
  title?: string;
}

export interface TileProps {
  ctx: WorkspaceCtx;
  state: TileState;
  set: (patch: TileState) => void;
  size: TileSize;
  /** The tile's own door — for a row inside the body that leads to the page */
  open: () => void;
  /** A tile that lifts its own fullscreen (`fullscreen`): bumped each time the head's fullscreen button is pressed */
  lift?: number;
  /** Change the name this tile is on — the head's own pick, handed to a body that offers it too (the chart, in fullscreen) */
  pickTicker?: (ticker: string) => void;
}

/* The group You went with its tiles (2026-10-02): alerts and the tracker left the desk, and the clock stands under Market */
export type WidgetGroup = 'Market' | 'The book' | 'Trade' | 'Practice';
export const WIDGET_GROUPS: WidgetGroup[] = ['Market', 'The book', 'Trade'];

export interface TilePage {
  /** The page's address — by the tile's settings when it has more than one page (insiders or Congress) */
  path: string | ((state: TileState) => string);
  /** "the Map" — said on the door */
  label: string;
  /** Set the page up to show what the tile showed (a view pick, an expiry) before it opens */
  prepare?: (state: TileState, ctx: WorkspaceCtx) => void;
  /** A query for the address, when the page reads one */
  search?: (state: TileState, ctx: WorkspaceCtx) => string;
  /** What the page is handed on arrival (the route's state), beside the way back */
  state?: (state: TileState, ctx: WorkspaceCtx) => Record<string, unknown>;
  /** The door opens something that is not a route — your alerts are a drawer over whatever page you are on */
  run?: () => void;
}

/** A switch on the tile's head — one thing shown over the instrument or not (The read) */
export interface TileToggle {
  /** The key in the tile's state */
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
}

export interface WidgetDef {
  key: string;
  title: string;
  group: WidgetGroup;
  icon: LucideIcon;
  /** One line — the picker's, and the head's tooltip */
  says: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  /** The tallest it may be, in grid rows: past it the tile is empty surface */
  maxH: number;
  /** It follows a name — the head carries the scope chip. A tile about the whole market (the wire, your journal) does not */
  named: boolean;
  defaults?: TileState;
  /** The settings as they stand, when a default is not a constant (the chart's interval opens on the desk's own, from
      Settings) — what the head's cards show and the body draws */
  resolve?: (state: TileState) => TileState;
  controls?: (p: { ctx: WorkspaceCtx; state: TileState }) => TileControl[];
  toggles?: TileToggle[];
  /** The page it opens. None: the tile has no door (the session clock) */
  page?: TilePage;
  /** THE TILE LIFTS ITS OWN FULLSCREEN (the chart only): the head's button is the fullscreen glyph and hands the body a
      token (`lift`); its page, if it has one, is offered in the tile's menu instead */
  fullscreen?: boolean;
  Body: ComponentType<TileProps>;
  /** The tile standing in its own shape for the frame it takes to mount */
  skeleton: () => ReactNode;
}
