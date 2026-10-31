import { BarChart3, Building2, CalendarClock, Landmark, Library, Newspaper, Percent, PieChart, type LucideIcon } from 'lucide-react';

/* The Dossier's pages: what never shows on the tape — the wire, the reports, insiders, Congress, holders, shorts. */
interface RecordSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  /** Where the page's facts come from, named in the head so the kind of record is never in doubt */
  source: string;
}

export const RECORD_SUBPAGES: RecordSubpage[] = [
  { path: '/dossier/news', label: 'News', subtitle: 'The day’s wire: every story, where it came from and how the named stock moved', icon: Newspaper, source: 'Wire' },
  { path: '/dossier/earnings', label: 'Earnings', subtitle: 'Two weeks of reports: what the options price against what the name usually moves', icon: CalendarClock, source: 'Earnings calendar' },
  { path: '/dossier/stocks', label: 'Stocks', subtitle: 'The house list graded on the trend, the numbers and the money · strongest first', icon: BarChart3, source: 'Our screens · trend, numbers, money' },
  { path: '/dossier/insiders', label: 'Insiders', subtitle: 'What the people who run companies did with their own shares, and whether they chose to', icon: Building2, source: 'Form 4 filings · filed within two business days of the trade' },
  { path: '/dossier/shorts', label: 'Shorts', subtitle: 'Short interest against the float, and how many days of volume would cover it', icon: Percent, source: 'Short interest · the latest report' },
  { path: '/dossier/congress', label: 'Congress', subtitle: 'What members of Congress reported trading, and how long they took to say so', icon: Landmark, source: 'STOCK Act reports · due within 45 days of the trade' },
  { path: '/dossier/institutions', label: 'Institutions', subtitle: 'The largest 13F houses and their largest lines: shares, calls or puts', icon: Library, source: '13F filings · the largest houses' },
  { path: '/dossier/etfs', label: 'ETFs', subtitle: 'What the fund holds, and whether money came in or left', icon: PieChart, source: 'Fund holdings · five-day flow' },
];
