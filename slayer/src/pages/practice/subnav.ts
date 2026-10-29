import { History, LineChart, NotebookPen, type LucideIcon } from 'lucide-react';

/** PRACTICE's pages — drives the sidebar, the page's head, the palette and the page titles. ONE SECTION: what was
    Paper › Live Chart and Review › Backtest · Journal, under one head — the same engine, the same order card, the
    same chart, on two clocks (today's, and a replayed day's), with ONE journal that reads either book. */
interface PracticeSubpage {
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
