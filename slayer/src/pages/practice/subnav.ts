import { History, LineChart, NotebookPen, type LucideIcon } from 'lucide-react';

/** PRACTICE's pages — drives the sidebar, the page's head, the palette and the page titles. ONE SECTION since 2026-09-26
    (Noah: "should paper trading and backtesting be in the same section and should they also carry the same journal" —
    yes to both; "the live chart should be called paper and the overhead can be called practice"): what was Paper › Live
    Chart and Review › Backtest · Journal, under one head — the same engine, the same order card, the same chart, on two
    clocks (today's, and a replayed day's), with ONE journal that reads either book. */
export interface PracticeSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

export const PRACTICE_SUBPAGES: PracticeSubpage[] = [
  {
    path: '/practice/paper',
    label: 'Paper Trade',
    subtitle: 'Trade today’s live option quotes with pretend money — options off the chain, filled at the live bid and ask',
    icon: LineChart,
  },
  {
    path: '/practice/backtest',
    label: 'Backtest',
    subtitle: 'Paused until real minute-by-minute option history is wired in',
    icon: History,
  },
  {
    path: '/practice/journal',
    label: 'Journal',
    subtitle: 'Every trade on its day — paper or backtest — what each day, week, month and year made, and the trades behind it',
    icon: NotebookPen,
  },
];
