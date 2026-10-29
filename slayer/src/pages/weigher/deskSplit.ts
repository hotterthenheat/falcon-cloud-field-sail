/* The Weigher's sash: the top window's height (chart and chain) is the reader's, dragged on the sash under it, double-click resets,
   kept in this browser in pixels. Read by the desk and its skeleton. */

const KEY = 'slayer_weigher_top';
export const DESK_TOP_DEFAULT = 560;
const DESK_TOP_MIN = 320;
const DESK_TOP_MAX = 1200;

export const clampDeskTop = (v: number): number => Math.round(Math.min(DESK_TOP_MAX, Math.max(DESK_TOP_MIN, v)));

export function readDeskTop(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= DESK_TOP_MIN && v <= DESK_TOP_MAX ? Math.round(v) : DESK_TOP_DEFAULT;
  } catch {
    return DESK_TOP_DEFAULT;
  }
}

export function saveDeskTop(v: number): void {
  try {
    localStorage.setItem(KEY, String(clampDeskTop(v)));
  } catch {
    /* storage off — the height lives for the session */
  }
}

/** The frame's two rows: the chain window at its height, the cards under it one fixed pane that scrolls inside */
export const deskRows = (top: number): string => `${top}px 460px`;
