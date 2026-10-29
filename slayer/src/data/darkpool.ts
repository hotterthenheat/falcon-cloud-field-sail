/* The simulator's dark-pool story (shelves, print reads, a posture) for Dossier and the contract score, and the
   sector map the flow pages share. Trace's live dark pool reads traceLive. */

import type { Grade } from './stockOverview';
import { postureGrade } from './traceLean';
import type {
  DarkPoolLevel,
  DarkPoolPrint,
  DarkPoolView,
  Posture,
} from '../types/darkpool';

/* sector identity colours, muted so the numbers carry the ranking; index ETFs file under Financial Services */
export const SECTOR_UNIVERSE: { sector: string; color: string; weight: number; tickers: string[] }[] = [
  { sector: 'Financial Services', color: '#7DD3A8', weight: 3.2, tickers: ['SPY', 'QQQ', 'IWM', 'JPM', 'BAC', 'GS', 'MS', 'SCHW', 'BLK', 'V'] },
  { sector: 'Technology', color: '#7EA6F0', weight: 2.4, tickers: ['NVDA', 'AAPL', 'MSFT', 'AMD', 'AVGO', 'TSM', 'MU', 'ORCL', 'INTC', 'CRM'] },
  { sector: 'Healthcare', color: '#E88A8A', weight: 1.1, tickers: ['UNH', 'LLY', 'JNJ', 'PFE', 'ABBV', 'MRK', 'TMO', 'CVS', 'ABT', 'ZTS'] },
  { sector: 'Consumer Cyclical', color: '#E8C468', weight: 0.95, tickers: ['TSLA', 'AMZN', 'HD', 'MCD', 'NKE', 'SBUX', 'LOW', 'TJX', 'BABA', 'EBAY'] },
  { sector: 'Industrials', color: '#9B8FE8', weight: 0.8, tickers: ['CAT', 'GE', 'BA', 'HON', 'UNP', 'DE', 'LMT', 'UPS', 'ETN', 'CSX'] },
  { sector: 'Communication Services', color: '#B48FE0', weight: 0.7, tickers: ['META', 'GOOGL', 'NFLX', 'DIS', 'T', 'VZ', 'CMCSA', 'SPOT', 'TMUS', 'CHTR'] },
  { sector: 'Consumer Defensive', color: '#6ECFC4', weight: 0.5, tickers: ['WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MDLZ', 'CL', 'MNST', 'KMB'] },
  { sector: 'Utilities', color: '#E0D080', weight: 0.32, tickers: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'PCG', 'CEG'] },
  { sector: 'Real Estate', color: '#E89AC0', weight: 0.3, tickers: ['PLD', 'AMT', 'EQIX', 'SPG', 'O', 'PSA', 'CCI', 'DLR', 'VICI', 'IRT'] },
  { sector: 'Energy', color: '#E8A56E', weight: 0.3, tickers: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'MPC', 'PSX', 'VLO', 'LNG'] },
  { sector: 'Basic Materials', color: '#93B87A', weight: 0.24, tickers: ['LIN', 'SHW', 'FCX', 'NEM', 'APD', 'NUE', 'DOW', 'ECL', 'ALB', 'EMN'] },
];

/** Every sector the terminal files, with its dot colour */
export const SECTOR_LIST: { sector: string; color: string }[] = SECTOR_UNIVERSE.map(s => ({ sector: s.sector, color: s.color }));

let sectorIndex: Map<string, { sector: string; color: string }> | null = null;

/** A ticker's sector and dot colour: the one sector map for the terminal; null for names not filed */
export function sectorOf(ticker: string): { sector: string; color: string } | null {
  if (!sectorIndex) {
    sectorIndex = new Map();
    for (const cfg of SECTOR_UNIVERSE) {
      for (const t of cfg.tickers) sectorIndex.set(t, { sector: cfg.sector, color: cfg.color });
    }
  }
  return sectorIndex.get(ticker.toUpperCase()) ?? null;
}

/* a print's conviction in the four words, on classify's own tiers; the figure never reaches a digit */
export const gradeOfConviction = (conviction: number): Grade => (conviction >= 85 ? 'strong' : conviction >= 68 ? 'good' : conviction >= 55 ? 'caution' : 'poor');

/* the posture's side and its grade share one threshold (traceLean), so a lean graded "poor" is always Balanced */
export const POSTURE_WORD: Record<Posture, string> = { ACCUMULATING: 'Accumulating', DISTRIBUTING: 'Distributing', BALANCED: 'Balanced' };
/** The posture in one phrase — "accumulating · strong", or "balanced" alone (a poor lean is no lean) */
export const postureRead = (view: Pick<DarkPoolView, 'posture' | 'netPosturePct'>): string =>
  view.posture === 'BALANCED' ? 'balanced' : `${POSTURE_WORD[view.posture].toLowerCase()} · ${postureGrade(view.netPosturePct)}`;

/** The market's dark tape: every name's crosses, newest first, with the market's own facts */
export interface DarkTapeView {
  prints: DarkPoolPrint[];
  views: Map<string, DarkPoolView>;
  names: string[];
  dpSharePct: number;
  netPosturePct: number;
  posture: Posture;
  totalNotional: number;
  crosses: number;
  strongest: (DarkPoolLevel & { ticker: string }) | null;
  largest: DarkPoolPrint | null;
}
