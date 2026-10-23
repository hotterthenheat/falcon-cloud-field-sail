import { BarChart3, Building2, CalendarClock, Landmark, Library, Newspaper, Percent, PieChart, type LucideIcon } from 'lucide-react';

/*
  THE DOSSIER (renamed 2026-09-28, Noah: "dossier it is"; the Record from
  2026-09-09): the file on a name — what never
  appears on the tape — the news, the earnings dates, what the people who run
  a company did with their own shares, what members of Congress reported
  trading. News and Earnings moved here from the top level; Insiders and
  Congress are the partner's two pages (his "Keyhole" and "Disclosures")
  rebuilt in the house. Stocks is the synthesis. Institutions, Shorts and
  ETFs read the same way — head, cards, sentence, the names to know, the
  grid. The economic calendar, the FDA date and the IPO live on News, under
  The day. They are not a page of their own.
*/
export interface RecordSubpage {
  path: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  /** Where the page's facts come from, named in the head so the kind of record is never in doubt */
  source: string;
}

export const RECORD_SUBPAGES: RecordSubpage[] = [
  { path: '/dossier/news', label: 'News', subtitle: 'The day’s wire — where each story came from, what it does to the name, and the numbers behind it', icon: Newspaper, source: 'Wire' },
  { path: '/dossier/earnings', label: 'Earnings', subtitle: 'The fortnight’s prints — what the options price into each one against what the name typically does, and the move once it is out', icon: CalendarClock, source: 'Earnings calendar' },
  { path: '/dossier/insiders', label: 'Insiders', subtitle: 'What the people who run these companies did with their own shares — and whether they chose to', icon: Building2, source: 'SEC Form 4 · filed within two business days of the trade' },
  { path: '/dossier/congress', label: 'Congress', subtitle: 'What members of Congress reported trading, and how long they took to say so', icon: Landmark, source: 'STOCK Act reports · due within 45 days of the trade' },
  /* Stocks joined the Record (Noah, 2026-09-10): every name and sector screened on the four sleeves — the synthesis, so it reads last */
  { path: '/dossier/stocks', label: 'Stocks', subtitle: 'The house list’s names and their sectors screened on the trend, the numbers and the money — the news is shown on a name’s page, not scored · the strongest first', icon: BarChart3, source: 'Our screens · trend, numbers, money' },
  { path: '/dossier/institutions', label: 'Institutions', subtitle: 'The largest 13F houses and their largest lines. A line is shares, a call, or a put — the filing does not name the strike', icon: Library, source: '13F filings · the largest houses' },
  { path: '/dossier/shorts', label: 'Shorts', subtitle: 'Short interest against the float, and how many days of volume would cover it', icon: Percent, source: 'Short interest · the latest report' },
  { path: '/dossier/etfs', label: 'ETFs', subtitle: 'What the fund holds, and whether money came in or left', icon: PieChart, source: 'Fund holdings · five-day flow' },
];
