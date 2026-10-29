/*
  Where an anchored dropdown lands, as plain arithmetic (testable without a DOM). Menus are portalled to the body so
  an overflow-hidden pane cannot clip them, and anchored by edges so they need not be measured before placing.
*/

export type MenuSide = 'bottom' | 'top' | 'left' | 'right';

/** A fixed-position box. Only the anchored edges are set. */
export interface MenuBox {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Space between the trigger and its menu. */
const MENU_OFFSET = 4;
/** The least a menu may keep to the window's own edge. */
export const MENU_EDGE = 8;
/** Below this a side is not worth opening on; used only to decide a flip, never to refuse to open. */
const MENU_MIN_USEFUL = 160;
/** A menu never runs taller than this share of the window. */
const MENU_MAX_SHARE = 0.7;
/** The menu's CSS min-width: a right-anchored menu's left edge is this far away and must stay on screen. */
const MENU_MIN_WIDTH = 210;

/** Just the fields of a DOMRect this needs, so a test need not fake the rest. */
interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Place a menu against its trigger. `side` is a preference: the returned side says where it actually opened. */
export function placeMenu(
  rect: AnchorRect,
  side: MenuSide,
  vw: number,
  vh: number,
  /** The menu's real width when known; the far-edge clamp assumes it. */
  menuWidth: number = MENU_MIN_WIDTH,
  /** 'end' pins the right edges (opens leftward); 'start' pins the left edges (opens rightward, inside its own pane). */
  align: 'start' | 'end' = 'end',
  /** A box smaller than the window the menu may not leave (its own pane); the window stays the outer bound. */
  bounds?: AnchorRect
): { box: MenuBox; side: MenuSide } {
  let s = side;
  const frame: AnchorRect = bounds
    ? {
        left: Math.max(0, bounds.left),
        top: Math.max(0, bounds.top),
        right: Math.min(vw, bounds.right),
        bottom: Math.min(vh, bounds.bottom),
      }
    : { left: 0, top: 0, right: vw, bottom: vh };
  const below = frame.bottom - rect.bottom - MENU_OFFSET - MENU_EDGE;
  const above = rect.top - frame.top - MENU_OFFSET - MENU_EDGE;
  const roomRight = frame.right - rect.right - MENU_OFFSET - MENU_EDGE;
  const roomLeft = rect.left - frame.left - MENU_OFFSET - MENU_EDGE;

  /* flip only when the other side is better: in a window too short for both, staying put wins */
  if (s === 'bottom' && below < MENU_MIN_USEFUL && above > below) s = 'top';
  else if (s === 'top' && above < MENU_MIN_USEFUL && below > above) s = 'bottom';
  else if (s === 'right' && roomRight < MENU_MIN_WIDTH && roomLeft > roomRight) s = 'left';
  else if (s === 'left' && roomLeft < MENU_MIN_WIDTH && roomRight > roomLeft) s = 'right';

  const ceiling = vh * MENU_MAX_SHARE;
  /* the floor keeps a menu at an edge from collapsing; the ceiling wins in a window too short for either */
  const cap = (room: number) => Math.min(ceiling, Math.max(MENU_MIN_USEFUL, room));

  /* the horizontal anchor is clamped at both ends, using the menu's width for the far end */
  const leftMin = frame.left + MENU_EDGE;
  const leftMax = Math.max(leftMin, frame.right - menuWidth - MENU_EDGE);
  const rightMin = vw - frame.right + MENU_EDGE;
  const rightMax = Math.max(rightMin, vw - frame.left - menuWidth - MENU_EDGE);
  const anchorRight = (v: number) => Math.min(Math.max(rightMin, v), rightMax);
  const anchorLeft = (v: number) => Math.min(Math.max(leftMin, v), leftMax);

  const hAnchor = align === 'start' ? { left: anchorLeft(rect.left) } : { right: anchorRight(vw - rect.right) };
  if (s === 'bottom') {
    return { side: s, box: { ...hAnchor, top: rect.bottom + MENU_OFFSET, maxHeight: cap(below) } };
  }
  if (s === 'top') {
    return {
      side: s,
      box: { ...hAnchor, bottom: Math.max(vh - frame.bottom + MENU_EDGE, vh - rect.top + MENU_OFFSET), maxHeight: cap(above) },
    };
  }
  /* side-docked: the menu hangs from the trigger's top edge */
  const beside = frame.bottom - rect.top - MENU_EDGE;
  if (s === 'right') {
    return { side: s, box: { left: anchorLeft(rect.right + MENU_OFFSET), top: rect.top, maxHeight: cap(beside) } };
  }
  return {
    side: s,
    box: { right: anchorRight(vw - rect.left + MENU_OFFSET), top: rect.top, maxHeight: cap(beside) },
  };
}
