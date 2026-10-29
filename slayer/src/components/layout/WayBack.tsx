/* A page opened from elsewhere carries a way back: the opener navigates with `state: { wayBack: '/pulse' }` and this pill reads it
   (route state, so going deeper drops it and Back restores it). */

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

/** How the origin is named on the pill */
const NAMES: Record<string, string> = {
  '/pulse': 'Pulse',
  '/pinpoint': 'the Map',
  '/pinpoint/map': 'the Map',
  '/pinpoint/board': 'the Board',
  '/pinpoint/agenda': 'the Agenda',
  '/pinpoint/compare': 'Compare',
};
/* a Dossier name page is named by the name; any other origin is plainly "back" */
const nameFor = (to: string): string => {
  if (NAMES[to]) return NAMES[to];
  /* a name's page under the Dossier: earnings or the stock overview */
  const m = to.match(/^\/(?:dossier|record)\/(?:earnings|stocks)\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]).toUpperCase();
  return '';
};

type WayBackState = { wayBack?: string };

/* The pill floats at the top centre of the content column, the one strip every page head leaves empty; measured off
   <main>, since the sidebar's width animates. */
const useMainCentre = () => {
  const [left, setLeft] = useState<{ centre: number; edge: number } | null>(null);
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    const read = () => {
      const r = main.getBoundingClientRect();
      setLeft({ centre: r.left + r.width / 2, edge: r.left });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(main);
    window.addEventListener('resize', read);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);
  return left;
};

const WayBack = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const to = (location.state as WayBackState | null)?.wayBack;
  const at = useMainCentre();
  if (!to || at == null) return null;
  const name = nameFor(to);
  /* Terrain has no head (its panes run to the top edge), so its pill sits at the foot's left */
  const low = location.pathname.startsWith('/terrain');
  return (
    <button
      onClick={() => navigate(to)}
      title={name ? `Back to ${name}` : 'Back'}
      data-way-back={to}
      style={{ left: low ? at.edge + 12 : at.centre }}
      data-way-back-at={low ? 'foot' : 'head'}
      className={`group fixed ${low ? 'bottom-2.5' : 'top-[60px] md:top-3 -translate-x-1/2'} z-[70] inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full border border-borderMuted bg-panel/90 backdrop-blur-sm font-mono text-t11 font-semibold text-textSecondary hover:text-textPrimary hover:bg-panelHover shadow-lg shadow-black/40 transition-colors animate-soft-in`}
    >
      <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" />
      {name ? `Back to ${name}` : 'Back'}
    </button>
  );
};

export default WayBack;
