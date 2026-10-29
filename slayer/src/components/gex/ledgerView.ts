/* Which view a book opens on: the matrix, calendar or profile. The Map opens on the matrix and then remembers the reader's pick;
   a stored pick of the retired ladder opens the host's first view. Kept apart from ExposureField so the Map's skeleton can read it cheaply. */

export type LedgerView = 'calendar' | 'matrix' | 'profile';
type LedgerHost = 'map' | 'tile';

const KEY: Record<LedgerHost, string> = { map: 'slayer_map_view', tile: 'slayer_ledger_view' };
const FIRST: Record<LedgerHost, LedgerView> = { map: 'matrix', tile: 'calendar' };
/** The views a host offers — the Map's ladder went with the matrix's return */
/* The profile: dealer gamma across spot, the curve the flip is read off. */
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
