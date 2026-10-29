import { ClipboardList, LayoutGrid, Map, Scale, type LucideIcon } from 'lucide-react';

/** Pinpoint subpage registry — drives the sub-tab bar and command palette. */
interface GexSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

/* Pinpoint's pages: Map (MapDesk.tsx), Agenda (Targets and Building), Board and Compare. Old paths redirect to the Map (App.tsx). */
export const GEX_SUBPAGES: GexSubpage[] = [
  {
    path: '/pinpoint/map',
    label: 'Map',
    subtitle: 'The book by strike and expiry — the matrix first, then the day’s clock, how the levels held',
    icon: Map,
  },
  {
    /* The Agenda: Targets and Building as one page with two faces, switched at the head. */
    path: '/pinpoint/agenda',
    label: 'Agenda',
    subtitle: 'Every strike in the order it matters, and what the overnight open-interest count added to the book — two faces, switched at the head',
    icon: ClipboardList,
  },
  {
    path: '/pinpoint/board',
    label: 'Board',
    subtitle: 'Every name at a glance — which way dealers are hedging, the flip, the nearest wall, the supreme, what expires today',
    icon: LayoutGrid,
  },
  {
    path: '/pinpoint/compare',
    label: 'Compare',
    subtitle: 'Two names side by side — the same reads head to head, both books on one ruler, the two tapes on one percent axis',
    icon: Scale,
  },
];
