/* The shared large-cap universe Stocks, News, Earnings, Compass and Trace key off, so cross-module stories line up. */

export type Sector =
  | 'Technology'
  | 'Communication'
  | 'Consumer Discretionary'
  | 'Financials'
  | 'Energy'
  | 'Health Care'
  | 'Industrials'
  | 'Consumer Staples'
  | 'Utilities'
  | 'Materials';

interface UniverseName {
  ticker: string;
  name: string;
  sector: Sector;
}

export const UNIVERSE: UniverseName[] = [
  { ticker: 'AAPL', name: 'Apple', sector: 'Technology' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'Technology' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'Technology' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology' },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'Technology' },
  { ticker: 'TSM', name: 'TSMC', sector: 'Technology' },
  { ticker: 'ASML', name: 'ASML', sector: 'Technology' },
  { ticker: 'CRM', name: 'Salesforce', sector: 'Technology' },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'Communication' },
  { ticker: 'META', name: 'Meta Platforms', sector: 'Communication' },
  { ticker: 'NFLX', name: 'Netflix', sector: 'Communication' },
  { ticker: 'AMZN', name: 'Amazon', sector: 'Consumer Discretionary' },
  { ticker: 'TSLA', name: 'Tesla', sector: 'Consumer Discretionary' },
  /* The Chinese EV complex, as their US listings — the wire's China stories need names to land on */
  { ticker: 'BYDDY', name: 'BYD', sector: 'Consumer Discretionary' },
  { ticker: 'NIO', name: 'NIO', sector: 'Consumer Discretionary' },
  { ticker: 'XPEV', name: 'XPeng', sector: 'Consumer Discretionary' },
  { ticker: 'LI', name: 'Li Auto', sector: 'Consumer Discretionary' },
  { ticker: 'HD', name: 'Home Depot', sector: 'Consumer Discretionary' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Financials' },
  { ticker: 'GS', name: 'Goldman Sachs', sector: 'Financials' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'Financials' },
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'Energy' },
  { ticker: 'CVX', name: 'Chevron', sector: 'Energy' },
  { ticker: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  { ticker: 'OXY', name: 'Occidental', sector: 'Energy' },
  { ticker: 'UNH', name: 'UnitedHealth', sector: 'Health Care' },
  { ticker: 'LLY', name: 'Eli Lilly', sector: 'Health Care' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Health Care' },
  { ticker: 'CAT', name: 'Caterpillar', sector: 'Industrials' },
  { ticker: 'BA', name: 'Boeing', sector: 'Industrials' },
  { ticker: 'GE', name: 'GE Aerospace', sector: 'Industrials' },
  { ticker: 'WMT', name: 'Walmart', sector: 'Consumer Staples' },
  { ticker: 'COST', name: 'Costco', sector: 'Consumer Staples' },
  { ticker: 'PG', name: 'Procter & Gamble', sector: 'Consumer Staples' },
  { ticker: 'NEE', name: 'NextEra Energy', sector: 'Utilities' },
  { ticker: 'LIN', name: 'Linde', sector: 'Materials' },
];

export const SECTORS: Sector[] = [
  'Technology',
  'Communication',
  'Consumer Discretionary',
  'Financials',
  'Energy',
  'Health Care',
  'Industrials',
  'Consumer Staples',
  'Utilities',
  'Materials',
];

export function lookup(ticker: string): UniverseName | undefined {
  return UNIVERSE.find(u => u.ticker === ticker);
}
