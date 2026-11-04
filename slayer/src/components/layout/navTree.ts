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

/** Compass's pages. "Inside the contract" is only the contract you are on — leaving that page drops the row. */
export const subpagesFor = (path: string, pathname: string): NavLeaf[] | undefined => {
  if (path === '/compass') {
    const m = pathname.match(/^\/compass\/([^/?#]+)/);
    const reserved = m != null && (m[1] === 'tracker' || m[1] === 'blotter' || m[1] === 'review' || m[1] === 'study');
    const here = m && !reserved ? decodeURIComponent(m[1]) : null;
    return [
      { path: '/compass', label: 'The scan' },
      ...(here ? [{ path: `/compass/${here}`, label: 'Inside the contract' }] : []),
      { path: '/compass/blotter', label: 'Blotter' },
      { path: '/compass/tracker', label: 'Tracker' },
      { path: '/compass/review', label: 'Review' },
      { path: '/compass/study', label: 'Study' },
    ];
  }
  return SUBPAGES[path];
};
