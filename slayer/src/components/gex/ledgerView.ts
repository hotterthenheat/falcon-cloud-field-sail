/*
==================================================
  SLAYER TERMINAL - WHICH VIEW A BOOK OPENS ON
  (components/gex/ledgerView.ts)

  The book by strike and expiry has TWO views: the
  MATRIX (one row per strike, the greeks split put ·
  call · net, a figure and its bar in every cell —
  the August table, back at Noah's word 2026-09-28)
  and the CALENDAR (every cell a capsule). THE LADDER
  IS GONE: off the Map's list on 2026-09-28 ("delete
  the first part … that showcases our current
  ladder"), and removed altogether on 2026-09-30
  ("the ladder is not a thing anymore even on
  pinpoint so remove it completely") — its component
  is deleted, and a pick of it kept in storage opens
  on the host's first view.

    the MAP   opens on the MATRIX, and remembers the
              reader's own pick after that

  The Pulse tile keeps its view with the tile itself
  (workspace/tiles/book.tsx); its door writes the
  MAP's key, so the Map opens on what the tile showed.
  The 'tile' host below is the field mounted with no
  band — nothing mounts it that way today.

  Kept apart from ExposureField so the Map's skeleton
  can ask which shape to stand in as without pulling
  the field's code in with it.
==================================================
*/

export type LedgerView = 'calendar' | 'matrix' | 'profile';
type LedgerHost = 'map' | 'tile';

const KEY: Record<LedgerHost, string> = { map: 'slayer_map_view', tile: 'slayer_ledger_view' };
const FIRST: Record<LedgerHost, LedgerView> = { map: 'matrix', tile: 'calendar' };
/** The views a host offers — the Map's ladder went with the matrix's return */
/* THE PROFILE (the partner's third view, taken 2026-10-14): dealer gamma across spot, the curve the flip is read off */
export const VIEWS_FOR: Record<LedgerHost, LedgerView[]> = { map: ['matrix', 'calendar', 'profile'], tile: ['calendar', 'matrix'] };

export function readLedgerView(host: LedgerHost): LedgerView {
  try {
    const saved = localStorage.getItem(KEY[host]);
    /* a pick this host no longer offers (the Map's old ladder) opens on the host's first */
    if ((saved === 'calendar' || saved === 'matrix' || saved === 'profile') && VIEWS_FOR[host].includes(saved)) return saved;
  } catch {
    /* storage off — the host's first view */
  }
  return FIRST[host];
}

export function writeLedgerView(host: LedgerHost, view: LedgerView): void {
  try {
    localStorage.setItem(KEY[host], view);
  } catch {
    /* private mode — the pick lives for the session */
  }
}
