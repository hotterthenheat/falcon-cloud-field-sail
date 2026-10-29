/* The wire's types. Every story comes off the vendor's headlines (liveRecord.ts); nothing here is invented. */

/** 'General' is a story of no beat the headline names */
export type NewsCategory = 'Earnings' | 'Guidance' | 'Analyst' | 'Macro' | 'M&A' | 'Product' | 'Regulatory' | 'General';

export interface NewsPrediction {
  /** Model P(ticker closes up next session), 0–100 */
  probUpPct: number;
  /** Signed expected move, next session, % */
  expMove1dPct: number;
  /** Signed expected move, five sessions, % */
  expMove5dPct: number;
  /** Model confidence in the read, 0–100 */
  confidencePct: number;
  /** The historical base rate behind the number */
  analog: string;
  /** What to do with it */
  playbook: string;
  /** False when the named stock had no session print at publish */
  measured?: boolean;
  /** The pre-market or after-hours move at publish, kept apart from the session's (null in the session) */
  extMovePct?: number | null;
  extWord?: 'pre-market' | 'after hours' | null;
  /** A story that crossed before the open: the last session's own change, with that session's date (never the story's day) */
  lastSession?: { pct: number; date: string } | null;
}

export interface NewsItem {
  id: string;
  time: string;
  minutesAgo: number;
  /** Release timestamp, epoch ms — the drip's clock and the alert's ref. */
  atMs: number;
  source: string;
  /** null = macro / index-level. The first name, when a headline names several. */
  ticker: string | null;
  /** Every name on the headline */
  tickers?: string[];
  /** Companies the headline names but is not about (an untagged story that does not lead with them) — never the
      story's name, never on the board */
  mentions?: string[];
  headline: string;
  /** The story's paragraphs under the headline, as the provider sends them */
  body: string[];
  /** Where the story ran, when the provider gives it */
  url?: string;
  category: NewsCategory;
  /** −1…+1 */
  sentiment: number;
  /** 0…1 — how market-moving the item is */
  magnitude: number;
  /** Unusual Whales flags the headline as major (is_major) */
  major?: boolean;
  prediction: NewsPrediction;
}

export { newsPulse } from './liveRecord';

