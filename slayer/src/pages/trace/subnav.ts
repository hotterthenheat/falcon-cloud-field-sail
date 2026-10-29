import { Radio, Bookmark, SlidersHorizontal, Footprints, Eye, EyeOff, Clock, Zap, Layers, Scale, Columns2, type LucideIcon } from 'lucide-react';

/** Trace subpage registry: drives the sidebar tree and the command palette. */
interface TraceSubpage {
  path: string;
  label: string;
  subtitle: string;
  /** The head's one line under the name: short and true (the subtitle stays the page's description elsewhere) */
  line: string;
  icon: LucideIcon;
}

export const TRACE_SUBPAGES: TraceSubpage[] = [
  {
    path: '/trace/live-tape',
    label: 'Live Tape',
    subtitle: 'Streaming options prints, dark-pool crosses & session flow',
    line: 'Options prints as they cross, and the session’s net flow',
    icon: Radio,
  },
  /* The market's dark-pool crosses; the tape's rail keeps them too */
  {
    path: '/trace/dark-pool',
    label: 'Dark Pool',
    subtitle: 'Off-exchange crosses with the read attached — who is behind them, the shelves they left & where the dark money went',
    line: 'Off-exchange crosses, the price shelves they leave and who is behind them',
    icon: EyeOff,
  },
  /* The book pages, all reading flowBook's one day book */
  {
    path: '/trace/screener',
    label: 'Screener',
    subtitle: "The whole day's option book — screens, filters & every contract that traded",
    line: 'The day’s option book — every contract that traded, screened and filtered',
    icon: SlidersHorizontal,
  },
  {
    path: '/trace/net-flow',
    label: 'Net Flow',
    subtitle: 'Which way each name’s money leans — net premium ranked & charted through the session',
    line: 'Net premium by name, ranked and charted through the session',
    icon: Scale,
  },
  {
    path: '/trace/odte',
    label: '0DTE',
    subtitle: 'The same-day money — net call & put premium flowing through the session',
    line: 'Contracts that expire today — net call and put premium through the session',
    icon: Zap,
  },
  {
    path: '/trace/multi-leg',
    label: 'Multi-Leg',
    subtitle: 'The tape reconstructed into structures — spreads, their legs & their defined risk',
    line: 'The tape rebuilt into spreads, their legs and their defined risk',
    icon: Layers,
  },
  {
    /* /trace/windows redirects here (App.tsx) */
    path: '/trace/intervals',
    label: 'Intervals',
    subtitle: 'The day cut into quarter-hour intervals — where the volume actually landed',
    line: 'The day in quarter hours — where the volume landed',
    icon: Clock,
  },
  {
    path: '/trace/footprints',
    label: 'Footprints',
    subtitle: 'What the flow left standing — overnight position builds & unwinds, contract by contract',
    line: 'Overnight open interest — what the flow built or unwound, contract by contract',
    icon: Footprints,
  },
  {
    path: '/trace/watchers',
    label: 'Watchers',
    subtitle: 'The desk watching the tape — a contract surfaces the moment there’s a reason to look',
    /* the eye, not the bell: the bell is the reader's own alerts */
    line: 'Contracts flagged the moment a reason fires',
    icon: Eye,
  },
  /* Two names side by side on one cut, with the same facts every other Trace page prints */
  {
    path: '/trace/compare',
    label: 'Compare',
    subtitle: 'Two names side by side — net flow, the same-day money, the book, the footprints, the structures & the tape, on one cut',
    line: 'Two names side by side, on the same cut',
    icon: Columns2,
  },
  /* The Tracker is always last: what you already marked, not a place you start */
  {
    path: '/trace/tracker',
    label: 'Tracker',
    subtitle: 'Bookmarked prints & contracts under live watch',
    line: 'Your bookmarked prints and contracts, under watch',
    icon: Bookmark,
  },
];
