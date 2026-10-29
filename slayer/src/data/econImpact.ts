/* One impact rule for an economic release, read by the month calendar and the News page (the vendor sends none). */
const HIGH = /\b(?:cpi|consumer price|ppi|producer price|payrolls?|nonfarm|nfp|unemployment rate|fomc|fed(?:eral)? (?:funds|rate|interest)|\bfed\b|rate decision|interest rate|gdp|pce|retail sales|ism)\b/i;
const MEDIUM = /\b(?:pmi|jobless|claims|sentiment|confidence|survey|housing|home sales|building permits|durable goods|industrial production|jolts|job openings|trade balance|empire state|philly fed|philadelphia fed|chicago pmi|beige book|import prices|export prices|wholesale|business inventories|factory orders)\b/i;

export type EconImpact = 'high' | 'medium' | 'low';

export const econImpact = (title: string): EconImpact => (HIGH.test(title) ? 'high' : MEDIUM.test(title) ? 'medium' : 'low');
