import { ClipboardList, LayoutGrid, Map, Scale, type LucideIcon } from 'lucide-react';

/** Pinpoint subpage registry — drives the sub-tab bar and command palette. */
export interface GexSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

/*
  THE BLANK CANVAS (Noah, 2026-09-05): "im thinking about starting the entire
  pinpoint page from scratch… the only decent things we have right now that i
  like is the ranked targets page, and the strike pressure ladder and exposure
  ledger… start off with deleting the exposure profile page and the session
  page." The roadmap that replaced them (the "Pinpoint Roadmap" artifact of the
  same day) is a page read top to bottom, band by band:

    Map       the chart with the levels on it, the strike rail as its price
              axis, one toolbar, one sentence; under it the Calendar (the
              Ledger by expiry) and The Day (the Trader's Clock, the Wall
              Report Card)                      — pages/pinpoint/MapDesk.tsx
    (Ahead    from now to the close — built 2026-09-06, DELETED 2026-10-14
              at Noah's word, dead code; its range and close odds live on
              as the Pulse desk's tiles and in data/ahead.ts)
    (At the wall  does it hold or break — built 2026-09-08, DELETED
              2026-10-14 at Noah's word; the band lives on as the Pulse
              desk's tile, the odds in data/wall.ts)
    Agenda    ONE PAGE, TWO FACES since 2026-10-14 (pages/pinpoint/Agenda.tsx):
              Targets — every strike in the order it matters, with the two
              actions (chart · alert)           — pages/pinpoint/RankedTargets.tsx
              Building — which of the hedging arrived today, strike by
              strike, and where the four levels are heading at today's
              pace (2026-09-07)                 — pages/pinpoint/Building.tsx
    Board     everything at a glance: every name the desk covers, one row
              each; a click opens it on the Map — pages/pinpoint/Board.tsx
    Compare   two names on the same reads, side by side; both books on
              one ruler; the two tapes on one percent axis (2026-09-08)
                                                — pages/pinpoint/Compare.tsx

  Old paths redirect to the Map (App.tsx).
*/
export const GEX_SUBPAGES: GexSubpage[] = [
  {
    path: '/pinpoint/map',
    label: 'Map',
    subtitle: 'The book by strike and expiry — the matrix first, then the day’s clock, how the levels held',
    icon: Map,
  },
  {
    /* THE AGENDA (Noah, 2026-10-14): Targets and Building as one page with two faces, switched at the head — the
       name is mine at his word ("choose a name for the overhead section name") */
    path: '/pinpoint/agenda',
    label: 'Agenda',
    subtitle: 'Every strike in the order it matters today, and what today added to the book — two faces, switched at the head',
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
