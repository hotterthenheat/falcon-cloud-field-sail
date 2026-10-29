/* Which pages sit under each product: read by the side rail's tree and the phone menu, so both always agree. */

import { GEX_SUBPAGES } from '../../pages/pinpoint/subnav';
import { RECORD_SUBPAGES } from '../../pages/record/subnav';
import { TRACE_SUBPAGES } from '../../pages/trace/subnav';

interface NavLeaf {
  path: string;
  label: string;
}

/** The pages nested under a product while you are inside it */
const SUBPAGES: Record<string, NavLeaf[]> = {
  '/pinpoint': GEX_SUBPAGES.map(p => ({ path: p.path, label: p.label })),
  '/dossier': RECORD_SUBPAGES.map(p => ({ path: p.path, label: p.label })),
  /* Trace's pages */
  '/trace': TRACE_SUBPAGES.map(p => ({ path: p.path, label: p.label })),
};

/** Compass's pages: the board, the Tracker, and "Inside the contract" once one is chosen (it points at the last
    contract page landed on, the store's `chosenId`). */
export const subpagesFor = (path: string, pathname: string, chosenId: string | null): NavLeaf[] | undefined => {
  if (path === '/compass') {
    const m = pathname.match(/^\/compass\/([^/?#]+)/);
    const reserved = m != null && (m[1] === 'tracker' || m[1] === 'blotter');
    const here = m && !reserved ? m[1] : null;
    const id = here ?? chosenId;
    return [
      { path: '/compass', label: 'The scan' },
      ...(id ? [{ path: `/compass/${id}`, label: 'Inside the contract' }] : []),
      { path: '/compass/blotter', label: 'Blotter' },
      { path: '/compass/tracker', label: 'Tracker' },
    ];
  }
  return SUBPAGES[path];
};
