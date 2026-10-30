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
    subtitle: 'Trade today’s option chains with pretend money, filled at ThetaData’s live bid and ask',
    icon: LineChart,
  },
  {
    path: '/practice/backtest',
    label: 'Backtest',
    subtitle: 'Replay a past session minute by minute on ThetaData’s recorded quotes, and trade its chain',
    icon: History,
  },
  {
    path: '/practice/journal',
    label: 'Journal',
    subtitle: 'Every trade on its day — paper, backtest or a journal of your own — what each day, week, month and year made',
    icon: NotebookPen,
  },
];
