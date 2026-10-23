/*
  ONE IMPACT RULE FOR AN ECONOMIC RELEASE (audit round 5, 2026-10-23): the month calendar (data/monthCalendar.ts) marked
  a release high or medium by one list, the News page's econ strip (data/whalesMap.ts econFromWhales) high, medium or low
  by another — retail sales was high on one and low on the other. The vendor's calendar carries no impact field, so this
  is the house's one rule, read by both.
*/
const HIGH = /\b(?:cpi|consumer price|ppi|producer price|payrolls?|nonfarm|nfp|unemployment rate|fomc|fed(?:eral)? (?:funds|rate|interest)|\bfed\b|rate decision|interest rate|gdp|pce|retail sales|ism)\b/i;
const MEDIUM = /\b(?:pmi|jobless|claims|sentiment|confidence|survey|housing|home sales|building permits|durable goods|industrial production|jolts|job openings|trade balance|empire state|philly fed|philadelphia fed|chicago pmi|beige book|import prices|export prices|wholesale|business inventories|factory orders)\b/i;

export type EconImpact = 'high' | 'medium' | 'low';

export const econImpact = (title: string): EconImpact => (HIGH.test(title) ? 'high' : MEDIUM.test(title) ? 'medium' : 'low');
