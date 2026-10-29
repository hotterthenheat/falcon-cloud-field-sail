import {
  Activity,
  Crosshair,
  Compass,
  Radar,
  Scale,
  ScrollText,
  Users,
  CandlestickChart,
  Settings,
  History,
  LineChart,
  NotebookPen,
  Dumbbell,
  type LucideIcon,
} from 'lucide-react';
import type { GlyphName } from '../ui/glyphPaths';

/* The rail is grouped by the question a trader asks, in order: Home (Pulse, Alerts), Market (Terrain, Trace, Dossier),
   The Book (Pinpoint), Trade (Compass, Weigher), Practice (Paper, Backtest, Journal), and More (Community, Settings)
   at the bottom. */
export type NavGroup = 'Home' | 'Market' | 'The book' | 'Trade' | 'Practice' | 'More';

/* Each desk's own muted categorical ink: identity, not meaning, so none is the live, where-you-are, supreme or
   direction ink; neighbours sit apart on the wheel. */
export const NAV_INK = {
  alerts: '#E9A23B',
  compass: '#4FB8B8',
  weigher: '#A78BFA',
  trace: '#F0925A',
  pulse: '#E86F8A',
  terrain: '#86B98B',
  pinpoint: '#7CC4E8',
  record: '#8EA2F5',
  tracker: '#5DBFA0',
  community: '#D98BB5',
  settings: '#C2B280',
  backtest: '#D4A5FF',
  journal: '#E6B566',
  /* Paper: apart on the wheel from its neighbours */
  paperDesk: '#62B6CB',
} as const;

export interface NavItem {
  path: string;
  label: string;
  code: string;
  /** the line icon — the palette, a page's head, the sub-navs (and the rail for a page without a glyph: Settings) */
  icon: LucideIcon;
  /** The page's glyph (ui/PageGlyph.tsx), shared by the landing, the rail and the phone menu; Settings keeps its line
      icon. */
  glyph?: GlyphName;
  /** The desk's own ink — its icon wears it (NAV_INK) */
  ink: string;
  description: string;
  group: NavGroup;
}

export const NAV_ITEMS: NavItem[] = [
  // ── Home ──
  {
    path: '/pulse',
    label: 'Pulse',
    code: '01',
    icon: Activity,
    glyph: 'pulse',
    ink: NAV_INK.pulse,
    description: 'The live market desk — chart, dealer pressure & key levels, arranged your way',
    group: 'Home',
  },
  // ── Market ──
  {
    path: '/terrain',
    label: 'Terrain',
    code: '02',
    icon: CandlestickChart,
    glyph: 'terrain',
    ink: NAV_INK.terrain,
    description: 'Charts only — one to four books side by side, one set of controls',
    group: 'Market',
  },
  {
    path: '/trace',
    label: 'Trace',
    code: '03',
    icon: Radar,
    glyph: 'trace',
    ink: NAV_INK.trace,
    description: 'Options flow & dark-pool intelligence — what the prints actually mean',
    group: 'Market',
  },
  {
    path: '/dossier',
    label: 'Dossier',
    code: '04',
    icon: ScrollText,
    glyph: 'dossier',
    ink: NAV_INK.record,
    description: 'The file on a name — its news, its earnings, what insiders filed, what Congress disclosed, how it screens',
    group: 'Market',
  },
  // ── The book ──
  {
    path: '/pinpoint',
    label: 'Pinpoint',
    code: '05',
    icon: Crosshair,
    glyph: 'pinpoint',
    ink: NAV_INK.pinpoint,
    description: 'GEX & dealer-positioning system',
    group: 'The book',
  },
  // ── Trade ──
  {
    path: '/compass',
    label: 'Compass',
    code: '06',
    icon: Compass,
    glyph: 'compass',
    ink: NAV_INK.compass,
    /* the rail tooltip and palette hint read this: we do not say we grade */
    description: 'Contracts scored on the live quotes — same day and one to seven days out',
    group: 'Trade',
  },
  {
    path: '/weigher',
    label: 'Weigher',
    code: '07',
    icon: Scale,
    glyph: 'weigher',
    ink: NAV_INK.weigher,
    description: 'Chart, chain and watchlist on one desk — pick a contract, watch it, and the record follows',
    group: 'Trade',
  },
  // ── Practice ──
  {
    path: '/practice/paper',
    /* "Paper Trade", never "Paper" alone */
    label: 'Paper Trade',
    code: '08',
    icon: LineChart,
    glyph: 'paper',
    ink: NAV_INK.paperDesk,
    description: 'Trade today’s option chains with pretend money on live ThetaData quotes — a practice account',
    group: 'Practice',
  },
  {
    path: '/practice/backtest',
    label: 'Backtest',
    code: '09',
    icon: History,
    glyph: 'backtest',
    ink: NAV_INK.backtest,
    description: 'Replay a past session on ThetaData’s recorded quotes and trade its option contracts with pretend money — test an edge',
    group: 'Practice',
  },
  {
    path: '/practice/journal',
    label: 'Journal',
    code: '10',
    icon: NotebookPen,
    glyph: 'journal',
    ink: NAV_INK.journal,
    description: 'Every trade you closed — paper or backtest — on its day, with your own words on it',
    group: 'Practice',
  },
  // ── More ──
  {
    path: '/community',
    label: 'Community',
    code: '11',
    icon: Users,
    glyph: 'community',
    ink: NAV_INK.community,
    description: 'The room — traders, their setups & the record they build',
    group: 'More',
  },
  {
    path: '/settings',
    label: 'Settings',
    code: '12',
    icon: Settings,
    ink: NAV_INK.settings,
    description: 'How the terminal looks, what the desk opens on, what it says out loud',
    group: 'More',
  },
];

export const NAV_GROUPS: NavGroup[] = ['Home', 'Market', 'The book', 'Trade', 'Practice', 'More'];

/** Each group's face: an icon, a one-line answer to "what is this group for", and its caption on the rail — null
    for the two that stand without one (Home at the top, More at the bottom) */
export const NAV_GROUP_META: Record<NavGroup, { icon: LucideIcon; hint: string; caption: string | null }> = {
  Home: { icon: Activity, hint: 'The desk you land on', caption: null },
  Market: { icon: CandlestickChart, hint: 'What the market is doing, and what happened', caption: 'Market' },
  'The book': { icon: Crosshair, hint: 'The book: every open option contract on a name, and the dealer hedging it implies — where that hedging pushes', caption: 'The book' },
  Trade: { icon: Compass, hint: 'What to trade, and which contract', caption: 'Trade' },
  Practice: { icon: Dumbbell, hint: 'Trade with pretend money — today’s prices or a past market — and look back', caption: 'Practice' },
  More: { icon: Settings, hint: 'The room, and how the terminal is set', caption: null },
};

export const itemsByGroup = (group: NavGroup): NavItem[] =>
  NAV_ITEMS.filter(i => i.group === group);
