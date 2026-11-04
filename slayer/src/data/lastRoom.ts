/* The last rail room the reader actually opened. The start page leads with it; Pulse leads until one has been opened.
   Not the Settings "opens on" page — that is where a launch door lands, and it can stay the start page. */

const KEY = 'slayer.lastRoom';

/* Longest first, so /practice/paper is not read as a shorter room. */
const ROOMS = ['/practice/paper', '/practice/backtest', '/practice/journal', '/pinpoint', '/dossier', '/compass', '/terrain', '/weigher', '/trace', '/pulse'] as const;

/** The start-page card a path belongs to, or null for the start page, settings, and the site. */
export function roomOf(path: string): string | null {
  const p = path.split('?')[0];
  return ROOMS.find(r => p === r || p.startsWith(`${r}/`)) ?? null;
}

/** Remember a room. The start page and everything outside the rail are ignored, so opening Start does not erase the last room. */
export function noteLastRoom(path: string): void {
  const room = roomOf(path);
  if (!room) return;
  try {
    localStorage.setItem(KEY, room);
  } catch {
    /* storage off: Pulse leads for this visit */
  }
}

/** The last room, if it is still one of the rail rooms. */
export function readLastRoom(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && (ROOMS as readonly string[]).includes(v) ? v : null;
  } catch {
    return null;
  }
}
