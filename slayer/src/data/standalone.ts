import { useSyncExternalStore } from 'react';
import { EMBEDDED } from '../embed';

/*
==================================================
  SLAYER TERMINAL - THE ROOMS THAT STAND ALONE (data/standalone.ts)

  The Terrain redesign (Noah, 2026-10-30, with openmarket's chart beside ours: "our side bar for our other pages just
  takes up space … how can we make sure a user can flip to other pages easily but still be the terrain page its own
  standalone"). A chart room that stands alone has the whole window: the rail leaves the frame and WAITS at the left
  edge — the pointer at the edge slides it over the chart, never into it (the chart is never resized by it), and it
  slides back when the pointer leaves. Two more doors to every page stay on the room itself: the mark at the head of
  the tab strip opens the pages as a menu, and ⌘K is the palette as everywhere.

  A preference, kept per room and carried by the account (the partner tree's data/sync.ts; here, this machine). Terrain stands alone by rest; a room not
  named here keeps the rail in its frame. In the landing's window (embed.ts) nothing stands alone — the films were
  recorded with the folded rail.
==================================================
*/

const KEY = 'slayer_standalone_rooms';
/** The rooms that may stand alone, by the path they begin with — Terrain first; a chart room joins by its path */
export const STANDALONE_ROOMS: readonly string[] = ['/terrain'];
const BY_REST: Record<string, boolean> = { '/terrain': true };

type Rooms = Record<string, boolean>;
const read = (): Rooms => {
  try {
    const raw = localStorage.getItem(KEY);
    const got = raw ? (JSON.parse(raw) as unknown) : null;
    return got && typeof got === 'object' ? { ...BY_REST, ...(got as Rooms) } : { ...BY_REST };
  } catch {
    return { ...BY_REST };
  }
};
let current: Rooms = read();
const subs = new Set<() => void>();

/** The standalone room a path is in, or null */
export const standaloneRoomOf = (pathname: string): string | null => STANDALONE_ROOMS.find(r => pathname === r || pathname.startsWith(`${r}/`)) ?? null;

/** Whether the room stands alone — never in the landing's window */
export const standsAlone = (room: string | null): boolean => !!room && !EMBEDDED && !!current[room];

export const setStandalone = (room: string, on: boolean): void => {
  current = { ...current, [room]: on };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage off — the choice lives for the session */
  }
  subs.forEach(f => f());
};

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** Whether the page at `pathname` stands alone right now */
export const useStandalone = (pathname: string): boolean => {
  const rooms = useSyncExternalStore(subscribe, () => current, () => current);
  const room = standaloneRoomOf(pathname);
  return !!room && !EMBEDDED && !!rooms[room];
};
