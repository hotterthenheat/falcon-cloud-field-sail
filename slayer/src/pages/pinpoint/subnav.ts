import { ClipboardList, LayoutGrid, Map, Scale, type LucideIcon } from 'lucide-react';

/** Pinpoint subpage registry — drives the sub-tab bar and command palette. */
interface GexSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

/* Pinpoint's pages: Map (MapDesk.tsx), Agenda (Targets and Building), Board and Compare. Old paths redirect to the Map (App.tsx);
   the two books are the Map's own switch (its Sources & units card holds what the retired Books page showed). */
export const GEX_SUBPAGES: GexSubpage[] = [
  {
    path: '/pinpoint/map',
    label: 'Map',
    subtitle: 'The book by strike and expiry, the day’s clock, and how the levels held',
    icon: Map,
  },
  {
    /* The Agenda: Targets and Building as one page with two faces, switched at the head. */
    path: '/pinpoint/agenda',
    label: 'Agenda',
    subtitle: 'Every strike in the order it matters, and what the overnight open interest built',
    icon: ClipboardList,
  },
  {
    path: '/pinpoint/board',
    label: 'Board',
    subtitle: 'Every name at a glance: hedging, flip, nearest wall, supreme, what expires today',
    icon: LayoutGrid,
  },
  {
    path: '/pinpoint/compare',
    label: 'Compare',
    subtitle: 'Two names side by side, both books on one ruler',
    icon: Scale,
  },
];
