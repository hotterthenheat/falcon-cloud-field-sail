/* Live Unusual Whales rows, in the shapes the Dossier pages render. */

import type { NewsItem, NewsCategory } from './news';
import { AMOUNT_BRACKETS, summariseCongress } from './congress';
import type { CongressFeed, CongressTrade, InsiderTrade, Member, Party, ReportOwner, ReportType, TxCode, AssetKind } from '../types/record';
import type { EconEvent } from './newsroom';
import type { UwCongress, UwEcon, UwNews, UwPolitician } from './whales';
import { TX_CODES } from './insiders';
import { UNIVERSE } from './universe';
import { companiesInHeadline, displayName, tickerName } from './tickers';
import { daysBetween, nyDayOf, nyDaysAgo } from './nyDate';
import { nyClock } from '../core/nyTime';
import { econImpact } from './econImpact';

/* a bare vendor date is a New York calendar day; the distance is counted in calendar days (data/nyDate.ts) */
const daysAgo = (iso?: string): number => nyDaysAgo(iso, 0);

/* the entity names, then the bare ampersand last — "&amp;lt;" must read "&lt;", not "<" */
const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const sentimentOf = (s: string | null | undefined): number | null => {
  const v = (s ?? '').trim().toLowerCase();
  if (v === 'positive' || v === 'bullish') return 0.55;
  if (v === 'negative' || v === 'bearish') return -0.55;
  if (v === 'neutral') return 0;
  return null;
};

/* The beat comes from the headline's own words: guidance needs a company changing an outlook, macro needs the economy,
   a central bank, rates, prices or the whole market; a company story of no named beat is Product. */
const EARNINGS_RE =
  /\b(?:first|second|third|fourth) quarter (?:(?:of )?(?:fiscal )?(?:year )?(?:\d{4} )?)(?:financial )?(?:results|earnings)\b|\bfiscal (?:year )?\d{4} (?:\w+ )?(?:quarter )?results\b|\bearnings?\b|\beps\b|\bq[1-4]\b|\b(?:first|second|third|fourth)[- ]quarter (?:results|profit|loss|revenue|sales|earnings)|\bquarterly (?:results|profit|loss|revenue|sales|earnings)\b|\b(?:profit|revenue|sales|net income|net loss)s? (?:rose|rises|fell|falls|jumps?|drops?|beats?|miss(?:es)?|tops?|surges?|slumps?|climbs?|declines?)\b|\b(?:beats?|miss(?:es)?|tops?) (?:estimates|expectations|forecasts|consensus)\b|\breports? (?:results|fiscal)\b|\bfiscal (?:\d{4}|q[1-4]|first|second|third|fourth|year) (?:results|earnings)/i;
const GUIDANCE_RE =
  /\b(?:raises?|raised|lifts?|lifted|boosts?|boosted|lowers?|lowered|cuts?|trims?|trimmed|reaffirms?|reaffirmed|reiterates?|reiterated|maintains?|withdraws?|withdrew|suspends?|narrows?|narrowed|updates?|issues?|initiates?|sets?|sees)\b[^.;]{0,40}\b(?:guidance|outlook|forecast)\b|\b(?:guidance|outlook|forecast)\b[^.;]{0,25}\b(?:raised|lowered|cut|above|below|ahead of|short of|for (?:fy|fiscal|q[1-4]|20\d\d|the (?:full )?year|full[- ]year))\b|\b(?:fy|full[- ]year)\s?'?\d{0,4}\s(?:guidance|outlook)\b/i;
const ANALYST_RE = /\btarget price\b|\bprice targets?\b|\bpt to\b|\b(?:rating|ratings)\b|\breiterat\w* (?:at )?(?:buy|sell|hold|neutral|outperform|underperform|overweight|underweight)\b|\bupgrades?\b|\bupgraded\b|\bdowngrades?\b|\bdowngraded\b|price target|\bpt\b(?= (?:to|raised|cut|lowered))|\b(?:initiates?|initiated|resumes?|starts?) coverage|\banalysts? (?:say|says|see|expect|rate|raise|cut)|\b(?:overweight|underweight|outperform|underperform|buy rating|sell rating|neutral rating)\b/i;
const MA_RE = /\bacqui(?:re|res|red|ring|sition)s?\b|\bmerger\b|\bmerge\b|\bbuyout\b|\btakeover\b|\btender offer\b|\bto buy\b[^.;]{0,30}\bfor \$|\b(?:agrees?|agreed|deal) to (?:buy|sell|acquire|merge)\b|\bspin[- ]?off\b|\bdivest/i;
const REG_RE = /\bsec\b|\bregulat|\bantitrust\b|\bdoj\b|\bftc\b|\bfda\b|\bprobe\b|\binvestigat|\blawsuit|\bclass action\b|\blitigation\b|\bsues?\b|\bsued\b|\bcourt\b|\bjudge\b|\bsettle(?:s|d|ment)\b|\bfined?\b|\bpenalt/i;
const MACRO_RE =
  /\$MACRO\b|\bfed\b|\bfomc\b|\bpowell\b|\bcpi\b|\bppi\b|\bpce\b|inflation|\bpayrolls?\b|jobs report|jobless claims|unemployment|\bgdp\b|recession|central bank|\becb\b|\bboj\b|\bboe\b|\bpboc\b|\brate (?:cut|hike)s?\b|interest rates?|treasury yields?|bond yields?|\byields? (?:rise|fall|jump|climb|slide)|\btariffs?\b|trade war|\bcrude\b|\bbrent\b|\boil (?:prices?|surpasses|tops|jumps|falls|rises|slides)|\bopec\b|the dollar\b|consumer confidence|consumer sentiment|\bpmi\b|retail sales|housing starts|home sales|\b(?:the|us|u\.s\.|global|world|china's|chinese|german|germany's|uk|britain's|euro(?:zone|pe's)?|japan's|japanese|india's|american) econom(?:y|ies)\b|\beconomic (?:data|growth|slowdown|outlook|activity|indicators?|calendar|report|figures|contraction|recovery)\b|government shutdown|\bdeficit\b|\bchancellor\b|\btreasury secretary\b|\bs&p 500\b|\bnasdaq composite\b|\bdow jones\b|\bwall street\b|global markets|\b(?<!'s )stocks (?:tumble|rally|fall|rise|slide|surge|drop|climb|sink|slump)/i;

/* Policy words need their policy sense: the President by office or name, Congress acting, sterling the currency. */
const GOV_RE =
  /\b(?:government (?:shutdown|spending|debt|bonds?|data|officials?|says|said|plans?|policy|funding)|(?:federal|us|u\.s\.|state|national|eu|china's|japan's) government|congress(?:ional)? (?:passes|passed|votes?|voted|approves?|approved|leaders?|republicans|democrats|bill|hearing|budget|funding)|(?:the )?senate (?:passes|passed|votes?|voted|approves?|bill|confirms?)|house (?:passes|votes|republicans|democrats)|white house|(?:the|us|u\.s\.|french|russian|chinese|ukrainian|south korean|mexican|brazilian) president\b(?! (?:and|&|of (?:the )?(?:company|sales|operations|marketing|engineering|global|north|asia|europe|investor)))|president (?:trump|biden|xi|putin|zelensk(?:y|iy)|macron|lula|erdogan|milei|sheinbaum|lee)|trump|biden|(?:trump|biden|the) administration|election|parliament|prime minister|(?:finance|foreign|trade|economy|defense|defence|energy) minister|ministry of|cabinet (?:reshuffle|meeting|approves)|lawmakers?|legislation|bill (?:passes|signed)|sanctions?|embargo|war\b(?! (?:room|chest|game))|ceasefire|nato|united nations|imf|world bank|g7|g20|(?:federal|state|national|government|eu) budget|budget (?:deficit|bill|talks|vote|proposal)|tax (?:cut|hike|bill|plan)|debt ceiling|stimulus|regulators?|commodit(?:y|ies) (?:prices?|markets?)|gold (?:prices?|futures|rises|falls|climbs|slips)|silver prices?|copper prices?|natural gas (?:prices?|futures)|bitcoin (?:price|falls|rises|slides|jumps|tops|drops)|crypto(?:currency|currencies)? market|futures (?:rise|fall|edge|point)|stock futures|equit(?:y|ies) markets?|markets? (?:open|close|rally|slump|wrap)|asian (?:stocks|markets)|european (?:stocks|markets)|ftse (?:100|250)?|dax|nikkei (?:225|average|index|stock average|(?:rises|falls|gains|drops|climbs|slips|ends|closes))|hang seng|kospi|sensex|yuan|yen\b|euro\b(?![- ]?(?:pacific|net|bank))|sterling (?:rises|falls|slips|gains|weakens|strengthens|hits|drops|climbs|against|edges)|pound sterling|forex)\b/i;

/* Geopolitics, currencies, rates, auctions and economic data are Macro; a launch or release is Product; else General. */
const GEO_RE = /\b(?:israel(?:i|is)?|gaza|hamas|hezbollah|west bank|ukrain(?:e|ian|ians)|kyiv|kremlin|russia(?:n|ns)?|moscow|putin|zelensk(?:y|iy)|iran(?:ian)?|tehran|syria|yemen|houthis?|red sea|north korea|pyongyang|taiwan strait|missiles?|drone strikes?|airstrikes?|troops|military (?:strikes?|action|operations?|escalation|build-?up|exercises?|drills?|offensive|aid|spending|junta)|invasion|ceasefire|truce|peace (?:talks|deal|plan)|nato|sanctions?|geopolitic\w*|trade (?:officials|talks|ministers?|negotiat\w+|truce|deal)|bank of (?:korea|japan|england|canada|israel|mexico|thailand)|reserve bank|central bank|finance ministry|bls|bureau of labor)\b/i;
const FX_RE = /\b(?:fx|forex|currenc(?:y|ies)|(?:us )?dollar(?: index)?|dxy|greenback|euro(?:zone)?|pound sterling|sterling(?= (?:rises|falls|slips|gains|weakens|strengthens|hits|drops|climbs|against|edges|trades))|yen|yuan|renminbi|rupee|swiss franc|loonie|aussie dollar|kiwi dollar|peso|lira)\b(?![- ]denominated (?:bond|debt))/i;
const RATES_RE = /\b(?:(?:t-|treasury |government |sovereign |\d+-(?:month|week|year) )bills?|government bonds?|sovereign bonds?|bunds?|gilts?|btps?|oats|jgbs?|treasur(?:y|ies)|yields?|bid[- ]to[- ]cover|(?:bill|bond|debt|treasury) auctions?|swap rates?|repo|interest rates?|rate (?:cut|hike|decision|path|outlook)s?|policy rate|basis points|bps)\b|\b(?:italy|italian|spain|spanish|germany|german|france|french|uk|britain|japan|eurozone|greece|portugal|ireland|belgium|austria|netherlands|dutch|finland|us|u\.s\.)\b[^.;]{0,40}\bbills?\b/i;
const DATA_RE = /\b(?:pmi|purchasing managers|gdp|cpi|ppi|pce|inflation|deflation|payrolls?|unemployment|jobless|claims|retail sales|industrial (?:output|production)|factory (?:orders|output)|durable goods|trade (?:balance|deficit|surplus)|current account|housing starts|building permits|home sales|consumer (?:confidence|sentiment|prices)|business (?:confidence|climate|sentiment)|ifo|zew|tankan|inventor(?:y|ies)|stockpiles?|natural gas|nat gas|crude|brent|wti|gasoline|survey|index (?:rose|fell|rises|falls|climbs|slips|jumps|drops)|economic data)\b/i;
const PRODUCT_RE = /\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|releases?d?|rolls? out|rolled out|rollout|debut(?:s|ed)?|new (?:product|model|version|service|feature|chip|phone|platform|app)|ships?|shipping|recalls?|recalled|availability|now available|partners? with|partnership|collaborat\w+|deploy(?:s|ed|ment)?|pilot|beta|preview|upgrade[sd]? (?:its|the) (?:app|platform|service)|update[sd]? (?:its|the) (?:app|platform|service)|approval for|wins? (?:contract|order|deal)|contract|orders?)\b/i;

const SOFT_RE = /\b(?:dinner|gala|banquet|party|celebrit(?:y|ies)|red carpet|wedding|birthday|award show|podcast|talk show|espn|halloween|costume|stephen a\. smith)\b/i;
const categoryOf = (headline: string, tags: string[] | undefined, hasTicker: boolean): NewsCategory => {
  const s = `${headline} ${(tags ?? []).join(' ')}`;
  if (/\$MACRO\b/i.test(s)) return 'Macro';
  if (!hasTicker && INDEX_MOVE_RE.test(headline)) return 'Macro';
  /* a broker's note is the analyst beat even when it names a quarter ("HSBC cuts target price on X after Q3") */
  if (/\btarget price\b|\bprice targets?\b|\bupgrades?\b|\bupgraded\b|\bdowngrades?\b|\bdowngraded\b/i.test(headline)) return 'Analyst';
  /* An economic release with no company as its subject is Macro before any guidance or earnings rule is tried. */
  const hardMacro = /\b(?:fed|fomc|cpi|ppi|pce|gdp|payrolls?|pmi|ecb|boj|boe|tariffs?)\b/i.test(s);
  if (!hasTicker && (DATA_RE.test(s) || ((MACRO_RE.test(s) || RATES_RE.test(s) || GEO_RE.test(s)) && !EARNINGS_RE.test(s) && !MA_RE.test(s)))) return 'Macro';
  if (hasTicker && hardMacro && DATA_RE.test(s) && !EARNINGS_RE.test(headline)) return 'Macro';
  if (hasTicker && GUIDANCE_RE.test(s)) return 'Guidance';
  if (EARNINGS_RE.test(s)) return 'Earnings';
  if (ANALYST_RE.test(s)) return 'Analyst';
  if (MA_RE.test(s)) return 'M&A';
  if (REG_RE.test(s)) return 'Regulatory';
  /* the economy, a central bank, prices or the whole market — and only when no company is the subject */
  if (MACRO_RE.test(s) && !hasTicker) return 'Macro';
  if (MACRO_RE.test(s) && /\b(?:fed|fomc|cpi|ppi|pce|gdp|payrolls?|ecb|boj|tariffs?)\b/i.test(s)) return 'Macro';
  /* No ticker is not macro: a story is macro only when it is about the economy, rates, markets or policy; an unlisted
     company's release is a company story. */
  /* a celebrity, a dinner or a show at the White House is not policy */
  if (!hasTicker && SOFT_RE.test(headline) && !DATA_RE.test(s) && !RATES_RE.test(s)) return 'General';
  if (!hasTicker && (GOV_RE.test(s) || GEO_RE.test(s) || FX_RE.test(s) || RATES_RE.test(s) || DATA_RE.test(s))) return 'Macro';
  if (PRODUCT_RE.test(s)) return 'Product';
  return 'General';
};

/* The move at publish, on dayChange.ts's convention: the regular session's move and the extended move kept apart;
   before the open, only the pre-market move. */
interface MetaBar {
  c?: string | number;
  date?: string;
  mt?: string;
}
interface PublishMove {
  /** The regular session's move when the story crossed, or null when it cannot be read (or the session had not opened) */
  day: number | null;
  /** The pre-market or after-hours move at publish, or null in the session */
  ext: number | null;
  extWord: 'pre-market' | 'after hours' | null;
  /** before the open: the last session's own change, labelled with that session's date */
  last: { pct: number; date: string } | null;
  /** After the bell, the regular close the day's move needs a prior close for — and its date */
  needs: { ticker: string; date: string; close: number } | null;
}
const pctOf = (a: number, b: number): number => Number((((a - b) / b) * 100).toFixed(2));
/* A story that crossed after its meta's last regular session and before the open has no session move yet: it carries
   the extended move and the last session's change, dated. */
function publishMove(meta: UwNews['meta'], ticker: string | null, priorClose: (ticker: string, before: string) => number | null, publishedAt?: string): PublishMove {
  const none: PublishMove = { day: null, ext: null, extWord: null, last: null, needs: null };
  if (!ticker || !meta) return none;
  const node = meta[ticker] as { curr?: MetaBar; prev?: MetaBar } | undefined;
  const curr = Number(node?.curr?.c);
  const prev = Number(node?.prev?.c);
  if (!(curr > 0) || !(prev > 0)) return none;
  const mt = String(node?.curr?.mt ?? 'regular').toLowerCase();
  const prevDate = String(node?.prev?.date ?? '').slice(0, 10);
  const storyDay = publishedAt ? nyDayOf(publishedAt) : null;
  const lastOf = (): PublishMove['last'] => {
    const before = prevDate ? priorClose(ticker, prevDate) : null;
    return before && before > 0 ? { pct: pctOf(prev, before), date: prevDate } : null;
  };
  const needsOf = prevDate ? { ticker, date: prevDate, close: prev } : null;
  if (mt.startsWith('reg') || mt === 'r') return { ...none, day: pctOf(curr, prev) };
  if (mt.startsWith('pre')) return { ...none, ext: pctOf(curr, prev), extWord: 'pre-market', last: lastOf(), needs: needsOf };
  /* post-market bar on a later New York day: the story crossed overnight, before the open */
  if (storyDay && prevDate && storyDay > prevDate) return { ...none, ext: pctOf(curr, prev), extWord: 'after hours', last: lastOf(), needs: needsOf };
  /* post-market: prev is the session's regular close; the day's move is that close against the close before its date */
  const before = prevDate ? priorClose(ticker, prevDate) : null;
  return { day: before && before > 0 ? pctOf(prev, before) : null, ext: pctOf(curr, prev), extWord: 'after hours', last: null, needs: needsOf };
}

/* The wire's tags are loose: a headline it marks $MACRO is macro, and an untagged one naming a large cap by its company
   name gets that name; the rest keep the wire's tags. */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the full company name as written ("Tesla", "Bank of America", "NVIDIA" or "Nvidia"), or in an all-caps headline —
   never a first word alone ("Advanced", "Home", "Bank" would tag half the wire) */
const COMPANY_RE = UNIVERSE.filter(u => u.name.length >= 4 && u.name !== u.ticker).map(u => {
  const proper = u.name === u.name.toUpperCase() ? u.name.charAt(0) + u.name.slice(1).toLowerCase() : u.name;
  return { ticker: u.ticker, re: new RegExp(`\\b(?:${esc(u.name)}|${esc(proper)}|${esc(u.name.toUpperCase())})\\b`) };
});
/* The short names the wire writes for companies whose listed names it never uses; each unambiguous as written. */
const SHORT_NAMES: [string, string][] = [
  ['Western Digital', 'WDC'], ['Abbott', 'ABT'], ['Johnson & Johnson', 'JNJ'], ['Procter & Gamble', 'PG'], ['Eli Lilly', 'LLY'],
  ['Goldman Sachs', 'GS'], ['Morgan Stanley', 'MS'], ['JPMorgan', 'JPM'], ['Bank of America', 'BAC'], ['Wells Fargo', 'WFC'],
  ['Citigroup', 'C'], ['ExxonMobil', 'XOM'], ['Exxon', 'XOM'], ['Chevron', 'CVX'], ['ConocoPhillips', 'COP'], ['Pfizer', 'PFE'],
  ['Merck', 'MRK'], ['AbbVie', 'ABBV'], ['Bristol Myers', 'BMY'], ['Bristol-Myers', 'BMY'], ['UnitedHealth', 'UNH'],
  ['Boeing', 'BA'], ['Lockheed Martin', 'LMT'], ['Northrop Grumman', 'NOC'], ['General Dynamics', 'GD'], ['Caterpillar', 'CAT'],
  ['Deere', 'DE'], ['Walmart', 'WMT'], ['Costco', 'COST'], ['Home Depot', 'HD'], ["McDonald's", 'MCD'], ['Starbucks', 'SBUX'],
  ['Coca-Cola', 'KO'], ['PepsiCo', 'PEP'], ['Disney', 'DIS'], ['Netflix', 'NFLX'], ['Comcast', 'CMCSA'], ['Verizon', 'VZ'],
  ['Intel', 'INTC'], ['Micron', 'MU'], ['Qualcomm', 'QCOM'], ['Broadcom', 'AVGO'], ['Oracle', 'ORCL'], ['Salesforce', 'CRM'],
  ['Cisco', 'CSCO'], ['Palantir', 'PLTR'], ['Nvidia', 'NVDA'], ['NVIDIA', 'NVDA'], ['Tesla', 'TSLA'], ['Amazon', 'AMZN'],
  ['Microsoft', 'MSFT'], ['Alphabet', 'GOOGL'], ['Seagate', 'STX'], ['Texas Instruments', 'TXN'], ['Applied Materials', 'AMAT'],
  ['Lam Research', 'LRCX'], ['General Motors', 'GM'], ['Ford Motor', 'F'], ['American Express', 'AXP'], ['Mastercard', 'MA'],
  ['Thermo Fisher', 'TMO'], ['Medtronic', 'MDT'], ['Honeywell', 'HON'], ['3M', 'MMM'], ['UPS', 'UPS'], ['FedEx', 'FDX'],
  ['BP', 'BP'], ['Shell', 'SHEL'], ['TotalEnergies', 'TTE'], ['Toyota', 'TM'], ['Nike', 'NKE'], ['Visa', 'V'], ['Uber', 'UBER'],
  ['Novo Nordisk', 'NVO'], ['Novo', 'NVO'],
];
/* A company named by a plain word (Apple, Gold) needs company context: a possessive, a suffix, a product or its chief. */
const PLAIN_WORD_CONTEXT: Record<string, RegExp> = {
  AAPL: /\bApple(?:'s|’s)|\bAPPLE(?:'S|’S)|\bApple\s+(?:Inc|Watch|TV|Music|Pay|Intelligence|Vision|stock|shares|CEO)\b|\bAPPLE\s+(?:INC|WATCH|STOCK|SHARES|CEO)\b|\biPhones?\b|\biPad\b|\bMacBook\b|\bApp Store\b|\bTim Cook\b|\bCupertino\b/i,
  SHEL: /\bShell(?:'s|’s)|\bShell\s+(?:plc|PLC|stock|shares|CEO)\b/i,
  V: /\bVisa(?:'s|’s)|\bVisa\s+(?:Inc|stock|shares|CEO)\b|\bVisa (?:and|&) Mastercard\b|\bMastercard (?:and|&) Visa\b/i,
  TGT: /\bTarget(?:'s|’s)|\bTarget\s+(?:Corp|Inc|stock|shares|CEO|stores?)\b/i,
};
const hasCompanyContext = (ticker: string, headline: string): boolean => {
  const re = PLAIN_WORD_CONTEXT[ticker];
  return !re || re.test(headline);
};
const SHORT_NAME_RE = SHORT_NAMES.map(([name, ticker]) => ({ ticker, re: new RegExp(`(?<![\\w&-])(?:${esc(name)}|${esc(name.toUpperCase())})(?:'s|’s)?(?![\\w&-])`) }));

/* A wire tag stands only when the headline writes it as a symbol or names the company by its distinctive word;
   a missing tag costs less than a story under the wrong company. */
const GENERIC = new Set(['first', 'second', 'general', 'united', 'american', 'national', 'global', 'international', 'new', 'the', 'great', 'western', 'eastern', 'southern', 'northern', 'capital', 'financial', 'world', 'canada', 'china', 'japan', 'india', 'europe', 'asia', 'german', 'germany', 'french', 'france', 'british', 'britain', 'european', 'swiss', 'chinese', 'japanese', 'korean', 'russian', 'ukrainian', 'mexican', 'canadian', 'israeli', 'iranian', 'saudi', 'turkish', 'italian', 'spanish', 'dutch', 'irish']);
function borneOut(t: string, headline: string): boolean {
  const T = esc(t);
  if (new RegExp(`\\$${T}\\b|\\(${T}\\)|\\b(?:NASDAQ|NYSE|AMEX|OTC)\\s*:\\s*${T}\\b`, 'i').test(headline)) return true;
  const name = tickerName(t);
  if (!name || name.toUpperCase() === t) return false;
  const core = (name.split(/[\s,]+/)[0] ?? '').replace(/[^A-Za-z0-9.&-]/g, '');
  if (core.length < 4 || GENERIC.has(core.toLowerCase())) return false;
  return new RegExp(`\\b${esc(core)}\\b`, 'i').test(headline);
}
/* An untagged story is filed under a company only when the headline leads with it; a company named further in is a
   mention, never the story's name and never on the board. */
const leadText = (headline: string): string => headline.replace(/^\s*(?:[A-Z][\w\s'-]{0,24}:\s+)?["'“‘(]*/, '');
const leadsWithName = (headline: string, re: RegExp): boolean => {
  const lead = leadText(headline);
  const m = re.exec(lead);
  return !!m && m.index === 0;
};
const firstWordOf = (t: string): RegExp | null => {
  const name = tickerName(t);
  const core = (name?.split(/[\s,]+/)[0] ?? '').replace(/[^A-Za-z0-9.&-]/g, '');
  return core.length >= 2 ? new RegExp(`^${esc(core)}\\b`, 'i') : null;
};
/* A survey sponsor (HSBC, S&P Global, Caixin) or a broker is not the subject: a PMI is economic data, and a broker's
   note is about the name after the verb. */
const SPONSORED_DATA_RE = /\b(?:pmi|purchasing managers'?(?: index)?)\b/i;
const BROKER_LEAD_RE = /^\s*(?:[A-Z][\w&.'-]*\s+){1,4}?(?:raises|lifts|boosts|cuts|lowers|trims|reduces|reiterates|maintains|keeps|initiates|starts|resumes|upgrades|downgrades|assumes|sets|hikes|ups)\b(?=[^.;]{0,60}\b(?:target|rating|coverage|price objective|pt|to (?:buy|sell|hold|neutral|outperform|underperform|overweight|underweight|equal[- ]weight|market perform))\b)/i;
/* An index's level or points is the market's move: no company is its subject, it is Macro and never major. */
const INDEX_MOVE_RE =
  /^\W*(?:breaking:\s*)?(?:(?:u\.?s\.?|britain'?s|uk'?s|germany'?s|france'?s|japan'?s|europe'?s|hong kong'?s|china'?s)\s+)?(?:the\s+)?(?:nasdaq(?: composite| 100)?|dow(?: jones)?(?: industrials| industrial average)?|s&p(?: 500)?(?: e-?mini)?|nyse composite|russell (?:2000|1000|3000)|djia|spx|ndx|ftse(?: 100| 250| mib)?|dax|cac(?: 40)?|nikkei(?: 225)?|topix|hang seng|stoxx(?: 600| europe 600| 50)?|euro stoxx(?: 50)?|kospi|asx(?: 200)?|sensex|nifty(?: 50)?|shanghai composite|csi 300|ibex(?: 35)?|tsx|smi|aex)\b(?:[^.;]|\.(?=\d)){0,40}?\b(?:up|down|rises?|rose|falls?|fell|gains?|loses?|drops?|dropped|climbs?|slips?|jumps?|sinks?|closes?|opens?|ends?|extends?|pares?|turns?|hits?|tops?|record)\b(?:[^.;]|\.(?=\d)){0,40}?(?:\bpoints?\b|\bpts\b|%|\brecord\b|\bhigh\b|\blow\b)/i;
/* A Macro story keeps the vendor's major flag only when it moves prices: central banks and rates, the big data prints,
   tariffs, the fiscal calendar, sanctions, and war or supply news touching oil. Tape ticks never. */
const MACRO_MOVING_RE = new RegExp(
  [
    /* central banks on policy */
    String.raw`\b(?:fed|fomc|federal reserve|powell|ecb|lagarde|boj|bank of japan|ueda|boe|bank of england|bailey|pboc|people's bank of china|bank of canada|snb|rba|reserve bank)\b[^.]{0,80}\b(?:rates?|hikes?|cuts?|decision|policy|inflation|tighten\w*|eas\w+|qe|qt|balance sheet|neutral)\b`,
    String.raw`\binterest rate decision\b|\brate (?:decision|hike|cut)s?\b`,
    /* the big data prints — the US, or a major economy's inflation and growth */
    String.raw`^\W*(?:breaking:\s*)?(?:us|u\.s\.)\b[^.]{0,40}\b(?:cpi|pce|inflation|payrolls?|nonfarm|jobs report|unemployment|jobless claims|gdp|retail sales|pmi|ism|sentiment|durable goods|ppi|housing starts)\b`,
    String.raw`\b(?:eurozone|euro area|china|chinese|japan|uk|britain|germany|german)\b[^.]{0,40}\b(?:cpi|inflation|gdp)\b`,
    String.raw`\bmichigan (?:consumer )?sentiment\b|\bconference board\b[^.]{0,30}\bconfidence\b`,
    /* trade policy */
    String.raw`\btariffs?\b|\btrade (?:deal|war|talks|agreement|deficit)\b|\bexport controls?\b`,
    /* the fiscal calendar */
    String.raw`\b(?:government )?shutdown\b|\bdebt (?:ceiling|limit)\b|\bstimulus\b|\btreasury (?:yields?|auction|refunding)\b|\b10-year yield\b`,
    /* sanctions, and war or supply that touches oil and shipping */
    String.raw`\bsanctions?\b`,
    String.raw`\b(?:hormuz|opec\+?|crude (?:oil )?(?:output|supply|exports?|reserves?)|oil (?:prices?|supply|output|exports?|embargo)|strategic petroleum reserve|spr)\b`,
    String.raw`\biran\b[^.]{0,60}\b(?:strikes?|attacks?|war)\b|\b(?:strikes?|attacks?|war)\b[^.]{0,60}\biran\b`,
  ].join('|'),
  'i',
);
const MACRO_TICK_RE = /\b(?:e-?mini|futures)\b[^.]{0,40}\b(?:fell|rose|up|down|gain|lost|drop)|\bspot (?:gold|silver)\b|\bimbalance\b|\bcurrency strength\b|\byen index\b|\beffective federal funds rate\b|\bfinancial stability report\b|^\W*boj:/i;
const macroMoves = (headline: string): boolean => MACRO_MOVING_RE.test(headline) && !MACRO_TICK_RE.test(headline);
const INDEX_TAGS = new Set(['NDAQ', 'ICE', 'SPGI', 'CME', 'DJI', 'DIA', 'QQQ', 'SPY', 'IWM', 'CBOE', 'MSCI']);
function storyTickers(headline: string, tags: readonly string[] | undefined): { tickers: string[]; mentions: string[] } {
  if (/\$MACRO\b/i.test(headline)) return { tickers: [], mentions: [] };
  if (INDEX_MOVE_RE.test(headline) && (tags ?? []).every(t => INDEX_TAGS.has(t.trim().toUpperCase()))) return { tickers: [], mentions: [] };
  if (SPONSORED_DATA_RE.test(headline)) return { tickers: [], mentions: [] };
  const broker = BROKER_LEAD_RE.exec(headline);
  if (broker) headline = headline.slice(broker[0].length).replace(/^\s+/, '');
  const tagged = [...new Set((tags ?? []).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z][A-Z0-9.]{0,5}$/.test(t)))].filter(t => borneOut(t, headline));
  if (tagged.length) return { tickers: tagged, mentions: [] };
  const named = [...COMPANY_RE, ...SHORT_NAME_RE].filter(c => c.re.test(headline) && hasCompanyContext(c.ticker, headline)).filter((c, i, all) => all.findIndex(x => x.ticker === c.ticker) === i);
  /* an untagged company story names its company by the listing's own name (tickers.ts companiesInHeadline) */
  const listed = companiesInHeadline(headline).filter(t => !named.some(n => n.ticker === t) && hasCompanyContext(t, headline));
  const subject: string[] = [];
  const mentions: string[] = [];
  for (const n of named) (leadsWithName(headline, n.re) ? subject : mentions).push(n.ticker);
  for (const t of listed) {
    const re = firstWordOf(t);
    (re && re.test(leadText(headline)) ? subject : mentions).push(t);
  }
  return { tickers: subject.slice(0, 1), mentions: [...new Set([...subject.slice(1), ...mentions])].slice(0, 4) };
}

/** The one name a story's move at publish is read on (newsFromWhales' lead ticker) — the only symbol the wire needs a
    regular close for. A currency code or a plain word the vendor tagged ("USD", "P", "FOR", "OUT") is not one. */
const FX_CODES = /^(?:USD|EUR|JPY|GBP|CNY|CNH|CAD|AUD|NZD|CHF|HKD|SGD|KRW|INR|MXN|BRL|ZAR|SEK|NOK|DKK|TRY|RUB|PLN|BTC|ETH)$/;
export function storyLeadTicker(headline: string, tickers: readonly string[] | undefined): string | null {
  const lead = storyTickers(decodeEntities(headline || ''), tickers).tickers[0] ?? null;
  return lead && !FX_CODES.test(lead) ? lead : null;
}

/* Paid placements on the press-release wires (law-firm explainers, advice columns) are not market news: dropped, counted. */
const SPAM_RE =
  /\b(?:criminal defense|defense lawyers?|defense attorneys?|personal injury|injury (?:lawyers?|attorneys?)|dui (?:lawyers?|attorneys?)|divorce (?:lawyers?|attorneys?)|hellonation|law offices? of|accident (?:lawyers?|attorneys?)|estate planning attorney)\b|\|\s*[^|]{0,60}\b(?:lawyers?|attorneys?|law firm|law group)\s*$/i;
/* token-price bot posts and adverts are noise on the wire */
const NOISE_RE =
  /\bon binance\b[^.]{0,80}?(?:macd|stochastic|bollinger|moving averages?|rsi|pivot|oversold|overbought)|\b(?:macd|stochastic|bollinger)\b[^.]{0,80}\bbinance\b|\bmarket worth \$?[\d.,]+ ?(?:billion|million) by 20\d\d\b|\|\s*marketsandmarkets|\bessay writing service\b|\b(?:marathon|athletics integrity|olympic) (?:champion|unit|gold)/i;
const isNewsSpam = (headline: string): boolean => SPAM_RE.test(headline) || NOISE_RE.test(headline);

/* A story is major when the vendor says so, it is about a listed company or the economy, and it is not house-keeping
   (results dates, calls, dividends, conference slots); a figure's decimal point is not a sentence end. */
const ROUTINE_RE =
  /\bconference call\b|\b(?:earnings|results) (?:release|date|call)\b|\b(?:to|will) (?:host|hold|report|announce|release)\b[^.]{0,60}\b(?:results|earnings)\b|\bannounces? (?:the )?(?:date|timing)\b|\btiming of\b[^.]{0,40}\bresults\b|\bto (?:speak|present|participate) at\b|\binvestor (?:conference|day)\b|(?<!\b(?:results|earnings)\b.*)\bdeclares?\b[^.]{0,40}\bdividends?\b(?!.*\b(?:results|earnings)\b)|\b(?:declares?|announces?)\b[^.]{0,30}\b(?:quarterly|regular|monthly|cash) (?:cash )?dividend\b|\bdividend payout\b|\bnames?\b[^.]{0,40}\b(?:vice president|vp|manager|director)\b|\bdeclares?\b(?:[^.]|\.(?=\d)){0,40}\bdividends?\b|\bdividends?\b(?:[^.]|\.(?=\d)){0,20}\bdeclared\b|\b(?:to (?:announce|report|release|host)|announces?|schedules?|sets?)\b(?:[^.]|\.(?=\d)){0,60}\b(?:results|earnings release|conference call|webcast)\b(?:[^.]|\.(?=\d)){0,40}\b(?:on|date|dates|for)\b|\b(?:to )?(?:participate|present) (?:in|at)\b(?:[^.]|\.(?=\d)){0,40}\bconferences?\b|\btokeni[sz]ed\b|\bbinance futures\b|\belected\b(?:[^.]|\.(?=\d)){0,40}\bdirector\b/i;

/* a law firm's solicitation of shareholders, a marketing tie-in or a brand line is never major */
const LAW_AD_RE =
  /\b(?:securities (?:fraud |class action )?(?:investigation|lawsuit|litigation)|class action (?:lawsuit|filed|alert)|(?:investor|shareholder|stockholder) alert|investigation notice|notice of (?:investigation|class action)|levi & korsinsky|rosen law|pomerantz|bronstein,? gewirtz|faruqi|glancy prongay|bragar eagel|kessler topaz|schall law|gross law|portnoy law|halper sadeh|kirby mcinerney|johnson fistel|robbins geller|block & leviton|bernstein liebhard|kaskela|ademi)\b/i;
const PROMO_RE =
  /\b(?:expands?|extends?|renews?|announces?|launches?|unveils?|debuts?)\b(?![^.]{0,50}\b(?:strategic|research|licens\w*|clinical|development)\b)[^.]{0,50}\b(?:collaboration|campaign|sponsorship|brand ambassador|co-?branded|limited[- ]edition)\b|\bfuels? (?:resilience|growth|innovation|success|transformation|creativity)\b/i;

/** The regular close before a date, from the name's regular closes when they are in hand — or null */
type PriorClose = (ticker: string, before: string) => number | null;
const noPrior: PriorClose = () => null;

export function newsFromWhales(rows: UwNews[], priorClose: PriorClose = noPrior): NewsItem[] {
  return rows.filter(r => !isNewsSpam(decodeEntities(r.headline || ''))).map((r) => {
    const headline = decodeEntities(r.headline || '');
    const at = Date.parse(r.created_at);
    const sent = sentimentOf(r.sentiment);
    const { tickers, mentions } = storyTickers(headline, r.tickers);
    const ticker = tickers[0] ?? null;
    const category = categoryOf(headline, r.tags, !!ticker);
    const major = !!r.is_major && (!!ticker || (category === 'Macro' && macroMoves(headline))) && !ROUTINE_RE.test(headline) && !LAW_AD_RE.test(headline) && !PROMO_RE.test(headline) && !INDEX_MOVE_RE.test(headline);
    const pm = publishMove(r.meta, ticker, priorClose, r.created_at);
    const moved = pm.day;
    const move = moved ?? 0;
    const stamp = Number.isFinite(at) ? at : 0;
    return {
      id: `uw-${stamp}-${ticker ?? 'macro'}-${headline.slice(0, 48)}`,
      time: Number.isFinite(at) ? nyClock(at, { zone: true }) : '',
      minutesAgo: Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 60_000)) : 0,
      atMs: Number.isFinite(at) ? at : Date.now(),
      source: r.source || 'Wire',
      ticker,
      tickers,
      mentions,
      headline,
      body: [`Reported by ${r.source || 'the wire'}.`],
      category,
      sentiment: sent,
      magnitude: major ? 0.8 : 0.45,
      major,
      prediction: {
        expMove1dPct: move,
        expMove5dPct: move,
        confidencePct: moved != null ? 58 : 0,
        analog: moved != null ? 'The figure is the name\'s regular-session move when the story crossed. Not a forecast.' : '',
        playbook: moved != null
          ? `The figure is how the name had moved on the regular session when the story crossed the wire${pm.ext != null ? `, with the ${pm.extWord} move apart` : ''} — a snapshot at publish, not today's move now, and not a forecast.`
          : pm.last
            ? `The story crossed before the open: the session had not moved yet. The ${pm.extWord} move at publish was ${pm.ext != null ? `${pm.ext > 0 ? '+' : pm.ext < 0 ? '−' : ''}${Math.abs(pm.ext).toFixed(1)}%` : 'not in hand'}; the last session (${pm.last.date.slice(5, 7)}/${pm.last.date.slice(8, 10)}) moved ${pm.last.pct > 0 ? '+' : pm.last.pct < 0 ? '−' : ''}${Math.abs(pm.last.pct).toFixed(1)}% — that day's move, not the story's.`
            : '',
        measured: moved != null,
        extMovePct: pm.ext,
        extWord: pm.extWord,
        lastSession: pm.last,
      },
    };
  });
}

const REGIONS: { re: RegExp; region: EconEvent['region'] }[] = [
  { re: /\beur\b|eurozone|\becb\b/i, region: 'EUR' },
  { re: /\bjpy\b|\bboj\b|japan/i, region: 'JPY' },
  { re: /\bgbp\b|\bboe\b|\buk\b/i, region: 'GBP' },
  { re: /\baud\b|australia/i, region: 'AUD' },
  { re: /\bcny\b|\bchina\b|\bpboc\b/i, region: 'CNY' },
];

/* one impact rule with the month calendar (data/econImpact.ts) */
const impactOf = (title: string): EconEvent['impact'] => econImpact(title);

export function econFromWhales(rows: UwEcon[]): EconEvent[] {
  const nowMs = Date.now();
  const out: EconEvent[] = [];
  for (const r of rows) {
    const at = Date.parse(r.time);
    if (!Number.isFinite(at)) continue;
    const dt = new Date(at);
    const inMinutes = Math.round((at - nowMs) / 60_000);
    if (inMinutes <= -600) continue;
    const region = REGIONS.find(x => x.re.test(r.event))?.region ?? 'USD';
    /* the vendor repeats a release at the same minute: one row per release, keeping the one with the forecast or prior */
    const id = `econ-${at}-${r.event.trim().toLowerCase()}`;
    const dup = out.findIndex(e => e.id === id);
    if (dup >= 0) {
      if (!out[dup].forecast && r.forecast) out[dup].forecast = r.forecast;
      if (!out[dup].previous && r.prev) out[dup].previous = r.prev;
      continue;
    }
    out.push({
      id,
      title: r.event,
      region,
      impact: impactOf(r.event),
      dayLabel: dt.toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' }).replace(',', ''),
      timeLabel: nyClock(dt, { zone: true }),
      atMs: at,
      inMinutes,
      forecast: r.forecast ?? undefined,
      previous: r.prev ?? undefined,
    });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

const chamberOf = (raw?: string): Member['chamber'] => (/senate/i.test(raw || '') ? 'Senate' : 'House');

const partyOf = (raw?: string): Party => {
  const s = (raw || '').toLowerCase();
  if (s.startsWith('dem') || s === 'd') return 'D';
  if (s.startsWith('rep') || s === 'r') return 'R';
  if (s.startsWith('ind') || s === 'i') return 'I';
  return '';
};

const placeOf = (district: string | undefined, chamber: Member['chamber']): { state: string; district?: string } => {
  const d = (district || '').trim();
  const split = d.match(/^([A-Za-z]{2})-(\d+)$/);
  if (split) return { state: split[1].toUpperCase(), district: `${split[1].toUpperCase()}-${split[2]}` };
  if (/^[A-Za-z]{2}$/.test(d)) return { state: d.toUpperCase() };
  if (chamber === 'Senate' && d) return { state: d };
  return { state: '', district: d || undefined };
};

/* a few filings carry the asset or a CUSIP in the type field; the type is the lone code letter on its first line */
const typeOf = (raw?: string): ReportType | null => {
  const s = (raw || '').toLowerCase();
  if (!s) return null;
  const first = s.split(/\n/)[0].trim();
  const code = /^([pse])$/.exec(first)?.[1] ?? /\s([pse])$/.exec(first)?.[1] ?? (/^([pse])\s/.exec(first)?.[1] ?? null);
  if (code && first.length > 1 && !/^(purchase|sale|sell|exchange|buy)/.test(first)) return code === 'p' ? 'Purchase' : code === 'e' ? 'Exchange' : 'Sale';
  if (first.length === 1 && code) return code === 'p' ? 'Purchase' : code === 'e' ? 'Exchange' : 'Sale';
  if (s.includes('exchange')) return 'Exchange';
  if (s.includes('purchase') || /\bbuy\b/.test(s)) return 'Purchase';
  if (s.includes('partial')) return 'Sale (Partial)';
  /* a sale the vendor marks full says so; a bare "Sell" is a sale */
  if (/\bfull\b/.test(s) && (s.includes('sale') || s.includes('sell'))) return 'Sale (Full)';
  if (s.includes('sale') || s.includes('sell')) return 'Sale';
  return null;
};

/* The owner is the issuer field's own word (self, spouse, joint, child, undisclosed), read alone, never a substring. */
const ownerOf = (_notes?: string, issuer?: string): ReportOwner => {
  const s = (issuer || '').toLowerCase().trim();
  if (/^(?:dependent(?: child)?|child|dc)$/.test(s)) return 'Dependent';
  if (/^(?:spouse|sp)$/.test(s)) return 'Spouse';
  if (/^(?:joint|js)$/.test(s)) return 'Joint';
  /* "undisclosed" is the filing not saying whose it is, never the member's own */
  if (/^self$/.test(s)) return 'Self';
  return 'Undisclosed';
};

/** The owner tag in words: "not stated" when the filing does not say */
export const ownerWord = (o: ReportOwner): string => (o === 'Undisclosed' ? 'not stated' : o);

const bracketOf = (amounts: unknown): number | null => {
  const s = typeof amounts === 'string' ? amounts : Array.isArray(amounts) ? amounts.map(String).join(' ') : amounts && typeof amounts === 'object' ? JSON.stringify(amounts) : '';
  if (!s) return null;
  /* "Spouse/DC over $1,000,000" is the rung above $1,000,000, not the one ending at it */
  const over = /\b(?:over|above|more than|greater than)\s*\$?\s*([0-9][0-9,]*)/i.exec(s);
  const nums = over ? [Number(over[1].replace(/,/g, '')) + 1] : [...s.matchAll(/\$?\s*([0-9][0-9,]*)/g)].map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 0);
  const low = nums[0];
  if (!low) return null;
  const exact = AMOUNT_BRACKETS.findIndex(b => low >= b.low && (b.high == null || low <= b.high));
  if (exact >= 0) return exact;
  let best = -1;
  AMOUNT_BRACKETS.forEach((b, i) => {
    if (b.low <= low) best = i;
  });
  return best >= 0 ? best : null;
};

/** "Spouse/DC Over $1,000,000" → 1000000 — an open-ended amount, said as the filing says it */
const overOf = (amounts: unknown): number | null => {
  const s = typeof amounts === 'string' ? amounts : '';
  const m = /\b(?:over|above|more than|greater than)\s*\$?\s*([0-9][0-9,]*)/i.exec(s);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

const OWNER_WORD = /^(joint|spouse|self|undisclosed|not-disclosed|n\/a)$/i;

/** The filing's notes are the asset when the issuer column is an owner word or "undisclosed". */
/* A treasury filed as a bare maturity (", , 13-WEEK, MATURESP10/12/2023 - 01/11/2024", "8-WEEK, MATURES 8/29/23")
   reads as the bill it is: "Treasury Bill (13-Week, matures 01/11/2024)" */
const maturity = (raw: string): string => {
  const s = raw.replace(/^[\s,;]+/, '').trim();
  if (!/\bMATURES?P?\b|MATURESP/i.test(s)) return '';
  /* A maturity is not a bill: only a line naming the Treasury, a bill or the government-securities tag is one. */
  const lead = s.split(/\bMATURES?P?\b|MATURESP|Rate\/Coupon/i)[0].replace(/[\s,;:()\-]+/g, ' ').trim();
  if (!/treasury|t-?bills?|\bbills?\b|\[GS\]|\bUS(?:T|\s?GOVT)\b/i.test(s) && lead.length > 0) return '';
  const term = s.match(/(\d+)-(WEEK|MONTH|YEAR)/i);
  const dates = [...s.matchAll(/(\d{1,2}\/\d{1,2}\/\d{2,4})/g)].map(m => m[1]);
  const end = dates[dates.length - 1];
  const t = term ? `${term[1]}-${term[2][0].toUpperCase()}${term[2].slice(1).toLowerCase()}` : '';
  return `Treasury Bill${t || end ? ` (${[t, end ? `matures ${end}` : ''].filter(Boolean).join(', ')})` : ''}`;
};

/** A filing's placeholder that names no asset ("None", "N/A", "municipal-security 32500", "stock 32500") */
const KIND_ONLY = /^(municipal-security|stock|corporate-bond|other)\s+\d+$/i;
const NO_NAME = /^(none|n\/a|na|null)$/i;

const cleanNotes = (notes?: string): string => {
  if (!notes) return '';
  const bill = maturity(notes);
  if (bill) return bill;
  let s = notes.split(/FILING STATUS:|SUBHOLDING OF:|DESCRIPTION:/i)[0].replace(/\s+/g, ' ').replace(/^[\s,;]+/, '').trim();
  /* a note's coupon and maturity lines are its terms, not its name */
  s = s.replace(/\s*Rate\/Coupon:.*$/i, '').replace(/\s*Matures:.*$/i, '').trim();
  if (KIND_ONLY.test(s)) {
    const kind = s.split(/\s+/)[0].replace(/-/g, ' ');
    s = kind.toLowerCase() === 'stock' ? '' : kind[0].toUpperCase() + kind.slice(1).toLowerCase();
  }
  /* the asset-class tag, closed or cut off by the vendor ("(DVN) [ST]" and "(DVN) [ST") */
  s = s.replace(/\s*\[[A-Za-z]{1,6}\]?\s*$/, '').trim();
  s = s.replace(/\s*\(([A-Z.]{1,6})\)\s*$/, '').trim();
  s = s.replace(/\s+-\s+(Common Stock|Class [A-C] Capital Stock|Ordinary Shares).*$/i, '').trim();
  if (!s || OWNER_WORD.test(s) || /^sp$/i.test(s)) return '';
  return s;
};

const namedAsset = (issuer?: string, ticker?: string, notes?: string): string => {
  const fromNotes = cleanNotes(notes);
  const name = (issuer || '').trim();
  const issuerOk = !!name && !OWNER_WORD.test(name);
  if (fromNotes) return fromNotes;
  if (issuerOk) return name;
  const t = (ticker || '').trim();
  if (!t || NO_NAME.test(t)) return 'Undisclosed';
  return maturity(t) || t;
};

/* The House's asset-type tag ([OP], [ST], …) names the kind outright, so it is read before the notes are cleaned. */
const TAG_KIND: Record<string, AssetKind> = {
  ST: 'Stock',
  PS: 'Stock',
  RS: 'Stock',
  OP: 'Stock Option',
  GS: 'Other',
  CS: 'Corporate Bond',
  /* [AB] is the House's asset-backed-securities code (Pelosi's "REOF XXX, LLC [AB]"), not a corporate bond */
  AB: 'Asset-Backed Security',
  MF: 'Fund',
  EF: 'Fund',
  ET: 'Fund',
  CT: 'Crypto',
};
const assetTagOf = (notes?: string): string | null => {
  const head = (notes || '').split(/FILING STATUS:|SUBHOLDING OF:|DESCRIPTION:/i)[0];
  const tags = [...head.matchAll(/\[([A-Za-z]{2})\]?/g)].map(m => m[1].toUpperCase());
  return tags.length ? tags[tags.length - 1] : null;
};
const assetKindOf = (notes?: string, issuer?: string): AssetKind => {
  const tag = assetTagOf(notes);
  const s = `${notes || ''} ${issuer || ''}`;
  /* Under [GS] a Treasury or federal-agency issue is a government security; any state or local issuer is municipal. */
  if (tag === 'GS' && !/\btreasur(?:y|ies)\b|\bt-?bills?\b|\bu\.?s\.? (?:govt|government|treas\w*)\b|\bunited states\b|\bfnma\b|\bfannie\b|\bfreddie\b|\bfhlmc\b|\bfhlb\b|federal (?:home loan|farm credit)|\bginnie\b|\bgnma\b|\btips\b|\bstrips\b|\bagency\b/i.test(s)) return 'Municipal Security';
  if (tag && TAG_KIND[tag]) return TAG_KIND[tag];
  if (/\btreasury\b|\bt-?bills?\b|\[GS\]/i.test(s)) return 'Other';
  /* A count of calls or puts, an "Option Type:" line or a strike is the contract itself, whatever stock it names. */
  if (
    /\b(call|put)\s+options?\b|\boption\s+type\s*:\s*(call|put)\b|\bstrike(\s+price)?\s*:|\b\d[\d,]*\s+(call|put)s?\b|\b(call|put)s?\b[^.\n]{0,40}\bexp(iration|ires)?\b/i.test(
      s,
    )
  )
    return 'Stock Option';
  if (/\b(call|put)\b|\boptions?\b/i.test(s) && !/common stock/i.test(s)) return 'Stock Option';
  if (/corporate bond|\bnote due\b|\bbond\b|Rate\/Coupon|\bMatures:/i.test(s)) return 'Corporate Bond';
  if (/municipal/i.test(s)) return 'Municipal Security';
  if (/\betf\b|\bmutual fund\b/i.test(s)) return 'Fund';
  if (/crypto|bitcoin|ethereum/i.test(s)) return 'Crypto';
  return 'Stock';
};

/** Every field of a vendor row, keys sorted — two rows are one report only when this matches */
const rowKey = (r: Record<string, unknown>): string =>
  Object.keys(r)
    .sort()
    .map(k => `${k}=${typeof r[k] === 'object' && r[k] != null ? JSON.stringify(r[k]) : String(r[k] ?? '')}`)
    .join('\u0001');
const hashKey = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};

export function congressFromWhales(rows: UwCongress[], people: UwPolitician[] = [], windowDays = 10000): CongressFeed {
  const roster = new Map(people.map(p => [p.politician_id, p]));
  const trades: CongressTrade[] = [];
  /* the vendor repeats some reports word for word (Sen. Boozman's 10/21 filings came back twice each) — a report that
     matches one already read, filing day included, is the same report and is read once */
  /* Rows identical in every field count as many times as the most any one page held them, so paging overlap is not counted
     twice while a member's genuine identical lots are kept. */
  const lots = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const k = rowKey(r as unknown as Record<string, unknown>);
    const page = (r as unknown as { __page?: number }).__page ?? 0;
    const per = lots.get(k) ?? new Map<number, number>();
    per.set(page, (per.get(page) ?? 0) + 1);
    lots.set(k, per);
  }
  const seen = new Map<string, number>();
  let unread = 0;
  let notMembers = 0;
  const notMemberAges: number[] = [];
  const seenOut = new Set<string>();
  for (const r of rows) {
    /* the vendor's congress feed also carries executive-branch filers (the President's OGE reports, most of them
       filed past 45 days) — this is the Congress page, so only House and Senate members are read */
    const traded = daysAgo(r.transaction_date);
    if (traded > windowDays) continue;
    const filed = daysAgo(r.filed_at_date);
    const tradedDay = nyDayOf(r.transaction_date);
    const filedDay = nyDayOf(r.filed_at_date);
    const lag = tradedDay && filedDay ? daysBetween(tradedDay, filedDay) : filed - traded;
    const who = r.politician_id ? roster.get(r.politician_id) : undefined;
    /* The row's own member_type decides: house or senate is a member's report; executive is left out, counted. A row with no
       type is a member's when the person has a directory id or a seat on the roster. */
    const rowType = (r.member_type || '').toLowerCase();
    const rowMember = /house|senate/.test(rowType);
    const known = !!who && (!!who.bioguide_id || /house|senate/i.test(who.chamber || ''));
    if (!rowMember && (rowType || (roster.size && who && !known))) {
      /* once per filing — the paging re-reads the cursor's day */
      const k = rowKey(r as unknown as Record<string, unknown>);
      if (!seenOut.has(k)) {
        seenOut.add(k);
        notMembers += 1;
        notMemberAges.push(traded);
      }
      continue;
    }
    /* the chamber the report itself names; the roster's only when the row names none */
    const chamber = chamberOf(rowMember ? r.member_type : who?.chamber);
    const place = placeOf(who?.district, chamber);
    const member: Member = {
      id: r.politician_id || r.name || 'member',
      name: who?.name || r.name || 'Undisclosed',
      chamber,
      party: partyOf(who?.party),
      state: place.state,
      district: place.district,
      committees: [],
    };
    const type = typeOf(r.txn_type);
    if (!type) {
      unread += 1;
      continue;
    }
    /* When the notes name no asset and the type field carries more than its code, the asset is read from the type field. */
    const txnAsset = (() => {
      if (cleanNotes(r.notes)) return null;
      const raw = String(r.txn_type || '');
      const [first, ...rest] = raw.split(/\n/);
      const head = first.replace(/\s+[PSE](?:\s*\(partial\))?\s*$/i, '').trim();
      if (head.length < 4 || /^(?:purchase|sale|sell|buy|exchange)/i.test(head)) return null;
      const notes = [head, ...rest].join(' ');
      const sym = /\(([A-Z][A-Z0-9.]{0,5})\)/.exec(head)?.[1] ?? '';
      return { notes, sym, owner: /^sp$/i.test(String(r.notes || '').trim()) ? 'spouse' : undefined };
    })();
    const notesUsed = txnAsset ? txnAsset.notes : r.notes;
    const tickerRaw = r.ticker || txnAsset?.sym || '';
    /* A report is every field of it; only a true repeat (every field identical, from paging) is read once. */
    const whole = rowKey(r as unknown as Record<string, unknown>);
    const had = seen.get(whole) ?? 0;
    const allowed = Math.max(1, ...(lots.get(whole)?.values() ?? [1]));
    if (had >= allowed) continue;
    seen.set(whole, had + 1);
    const id = `${member.id}-${r.transaction_date ?? ''}-${hashKey(whole)}${had ? `-${had + 1}` : ''}`;
    trades.push({
      /* the notes join the id: two unnamed treasury bills bought the same day were one row id (duplicate grid rows) */
      id,
      member,
      ticker: tickerRaw && !NO_NAME.test(tickerRaw.trim()) && !maturity(tickerRaw) ? tickerRaw : '',
      assetDescription: namedAsset(r.issuer, tickerRaw || undefined, notesUsed),
      assetKind: assetKindOf(notesUsed, r.issuer),
      type,
      owner: ownerOf(notesUsed, txnAsset?.owner && /^undisclosed$/i.test(String(r.issuer || '').trim()) ? txnAsset.owner : r.issuer),
      bracket: bracketOf(r.amounts),
      amountOver: overOf(r.amounts) ?? undefined,
      lagDays: lag,
      tradedDaysAgo: traded,
      filedDaysAgo: filed,
      late: lag > 45,
      tradedOn: tradedDay ?? undefined,
      filedOn: filedDay ?? undefined,
    });
  }
  return { ...summariseCongress(trades, windowDays), unreadTypes: unread, notMembers, notMemberAges };
}

const CODES = new Set<TxCode>(['P', 'S', 'A', 'M', 'F', 'G', 'D']);

/* The role as filed: a named office first, any other officer title "Officer", then the 10% box, then the board;
   no box and no title is "Other". */
const OFFICER_WORDS = /\b(?:president|pres\.?|chief|cto|cio|cmo|cao|cso|cro|cdo|chro|svp|evp|vp|vice president|treasurer|secretary|controller|comptroller|officer|founder|general manager|head of|managing director|principal)\b/;
const roleOf = (title: string, director: boolean, ten: boolean, officer: boolean): InsiderTrade['role'] => {
  const t = title.toLowerCase();
  /* the three singular offices are the company's own, not a co-holder's, a region's or a subsidiary's */
  const partial = /\bco-?\s?(?:ceo|cfo|coo|chief)\b|\b(?:asia|pacific|apac|emea|europe|americas?|latam|latin america|north america|international|region(?:al)?|division(?:al)?|segment|subsidiary)\b/.test(t);
  if (!partial && /\bceo\b|chief executive/.test(t)) return 'CEO';
  if (!partial && /\bcfo\b|chief financial/.test(t)) return 'CFO';
  if (!partial && /\bcoo\b|chief operating/.test(t)) return 'COO';
  if (/chief legal|general counsel|\bclo\b/.test(t)) return 'Chief Legal Officer';
  if (/\bevp\b|executive vice/.test(t)) return 'EVP';
  if (OFFICER_WORDS.test(t) || (officer && !/^\s*(?:director|chair(?:man|person|woman)?(?: of the board)?)\s*$/.test(t))) return 'Officer';
  if (ten && !director) return '10% owner';
  if (director || /director|\bchair/.test(t)) return 'Director';
  if (ten) return '10% owner';
  return t.trim() && !/see remarks/.test(t) ? 'Officer' : 'Other';
};

/* An open-market row whose security is a swap, preferred, warrant, note or other derivative is not a share trade. */
const NOT_SHARES = /swap|preferred|\bpref\b|warrant|option|\bnotes?\b|debenture|\bbonds?\b|\bright(s)?\b|\bunits?\b|convertible|derivative|futures?|\bsafe\b|restricted stock unit|\brsus?\b|phantom|performance share/i;
const isShareLine = (title?: string | null): boolean => !title || !NOT_SHARES.test(title);

/** The largest share of a company one open-market trade can plausibly be. A filing over it is a unit mix-up, not a trade */
const MAX_CAP_SHARE = 0.25;

type UwInsiderRow = { amount?: number; filing_date?: string; formtype?: string | null; is_10b5_1?: boolean | null; is_director?: boolean; is_officer?: boolean; is_ten_percent_owner?: boolean; officer_title?: string | null; owner_name?: string; price?: string | number | null; shares_owned_after?: number | null; shares_owned_before?: number | null; stock_price?: string | number | null; ticker?: string; transaction_code?: string; transaction_date?: string; id?: string; security_title?: string | null; marketcap?: string | number | null; sector?: string | null; reporter_cik?: string | null; full_name?: string | null; reporter_is_public_company?: boolean | string | null; director_indirect?: string | null; natureofownership?: string | null };

/** What the insider feed read: the rows, and how many it set aside and why — counted, never silent */
interface InsiderRead {
  trades: InsiderTrade[];
  /** Open-market rows that were swaps, preferreds or other non-share securities */
  notShares: number;
  /** Rows whose filed price or size cannot be a trade (ten times the stock's price, or past a quarter of the company) */
  implausible: number;
  /** Rows folded into another: a joint filing's other owners, or an amended re-filing of a trade already read */
  merged: number;
}

export function insidersFromWhales(rows: UwInsiderRow[]): InsiderTrade[] {
  return readInsiders(rows).trades;
}

/* A reporter that is a company or fund (the vendor's public-company flag, or a legal form in the name) is a strategic
   stake, not an insider choosing to buy. */
const ENTITY_RE = /\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.?l\.?c|lp|l\.?p|llp|plc|ag|sa|s\.a|nv|n\.v|se|gmbh|bv|ab|asa|oyj|spa|kk|holdings?|group|partners(?:hip)?|capital|fund|funds|trust|management|advisors?|investments?|ventures|aggregator|foundation|bank|financial|securities)\.?\b/i;
const isEntity = (r: UwInsiderRow): boolean => r.reporter_is_public_company === true || r.reporter_is_public_company === 'true' || ENTITY_RE.test(r.owner_name || '');

/* One trade, one row: a joint Form 4 lists a trade once per owner, and a 4/A restates one; the latest filing stands. */
function dedupeFilings(rows: { t: InsiderTrade; filed: string; cik: string; amended: boolean; indirect: boolean }[]): { trades: InsiderTrade[]; merged: number } {
  const groups: { t: InsiderTrade; filed: string; cik: string; owners: Set<string>; ciks: Set<string>; shared: boolean; amended: boolean }[] = [];
  const byBase = new Map<string, number[]>();
  let merged = 0;
  for (const r of rows) {
    const t = r.t;
    const base = `${t.ticker}|${t.tradedOn ?? ''}|${t.code}|${t.shares}`;
    const list = byBase.get(base) ?? [];
    let hit = -1;
    for (const gi of list) {
      const g = groups[gi];
      const sameReporter = !!r.cik && g.ciks.has(r.cik);
      /* a joint filing's owners hold the shares through one another (indirect) or one of them is the fund itself — two
         people each buying the same size at an offering price are two trades */
      const joint = g.filed === r.filed && Math.abs(g.t.price - t.price) < 1e-6 && !g.owners.has(t.person) && (g.shared || r.indirect || !!t.entity);
      /* an amendment restates the trade (holdings after may be corrected too); two separate filings of one reporter's
         identical lots on different days are not one — so a later filing counts as an amendment only when it is a 4/A */
      const amendment = sameReporter && (r.amended || g.amended) && g.filed !== r.filed;
      /* the same filing read twice, one copy with the reporter's CIK and one without */
      const twin = (sameReporter || g.owners.has(t.person)) && g.filed === r.filed && Math.abs(g.t.price - t.price) < 1e-6 && g.t.heldAfter === t.heldAfter;
      if (joint || amendment || twin) {
        hit = gi;
        break;
      }
    }
    if (hit < 0) {
      groups.push({ t, filed: r.filed, cik: r.cik, owners: new Set([t.person]), ciks: new Set(r.cik ? [r.cik] : []), shared: r.indirect || !!t.entity, amended: r.amended });
      list.push(groups.length - 1);
      byBase.set(base, list);
      continue;
    }
    merged += 1;
    const g = groups[hit];
    g.owners.add(t.person);
    if (r.cik) g.ciks.add(r.cik);
    if (r.amended) g.amended = true;
    /* the latest filing's figures stand (an amendment corrects the price) */
    if (r.filed > g.filed) {
      const owners = g.t.owners;
      g.t = { ...t, owners };
      g.filed = r.filed;
    }
  }
  const trades = groups.map(g => {
    const owners = [...g.owners];
    return owners.length > 1 ? { ...g.t, person: owners[0], owners, entity: g.t.entity } : g.t;
  });
  return { trades, merged };
}

/* Exercise and conversion codes are priced at their strike, so they never take the currency test. */
const EXERCISE_CODES = new Set(['M', 'X', 'C', 'O', 'E', 'H']);
const DERIVATIVE_LINE = /option|warrant|right to buy|convertible|\brsus?\b|restricted stock unit|performance share|phantom/i;
/* A home-currency row is a fact of the issuer: when the vendor calls the US listing an ADR, a row FOREIGN_OFF times
   over it is home-priced (flagged "not USD", out of the dollar totals); far under it is one ordinary share in dollars. */
const DEPOSITARY_LINE = /american depositary|\bads\b|\badrs?\b|ordinary shares?/i;
const FOREIGN_OFF = 2.5;
const over = (price: number, spot: number, k: number): boolean => spot > 0 && price > spot * k;
/** Issuers the vendor's issuer record names as a depositary listing (filled by the live record) */
const knownForeign = new Set<string>();
export function markForeignIssuers(tickers: Iterable<string>): void {
  for (const t of tickers) knownForeign.add(t.toUpperCase());
}
const marketPriced = (r: UwInsiderRow): boolean => {
  const code = (r.transaction_code || '').toUpperCase();
  return !EXERCISE_CODES.has(code) && !DERIVATIVE_LINE.test(r.security_title || '') && (Number(r.price) || 0) > 0 && (Number(r.stock_price) || 0) > 0;
};
/** Issuers with a market-priced row of $250K+ (as filed) FOREIGN_OFF times over the listing — the live record reads their
 *  issuer record */
export function foreignSuspects(rows: UwInsiderRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    const t = (r.ticker || '').toUpperCase();
    if (!t || knownForeign.has(t) || !marketPriced(r)) continue;
    /* only a row big enough to move a total is worth the look-up — $250K or more as filed */
    if (Math.abs(Number(r.amount) || 0) * Number(r.price) < 250_000) continue;
    if (over(Number(r.price), Number(r.stock_price), FOREIGN_OFF)) out.add(t);
  }
  return [...out];
}
function depositaryIssuers(rows: UwInsiderRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r.ticker && DEPOSITARY_LINE.test(r.security_title || '')) out.add(r.ticker.toUpperCase());
  return out;
}

export function readInsiders(rows: UwInsiderRow[]): InsiderRead {
  const out: InsiderTrade[] = [];
  const depositary = depositaryIssuers(rows);
  const meta2: { t: InsiderTrade; filed: string; cik: string; amended: boolean; indirect: boolean }[] = [];
  let notShares = 0;
  let implausible = 0;
  for (const r of rows) {
    /* Form 144 is a notice of a proposed sale, and an unnamed code (J, U, C…) is not an open-market
       trade either: neither maps onto P or S. */
    const form = String(r.formtype || '');
    if (form === '144' || form.startsWith('144')) continue;
    const letter = (r.transaction_code || '').toUpperCase();
    if (!CODES.has(letter as TxCode)) continue;
    const code = letter as TxCode;
    const meta = TX_CODES[code];
    if (meta.openMarket && !isShareLine(r.security_title)) {
      notShares += 1;
      continue;
    }
    const shares = Math.abs(Number(r.amount) || 0);
    const price = Number(r.price) || 0;
    const spot = Number(r.stock_price) || 0;
    const cap = Number(r.marketcap) || 0;
    /* a price ten times the stock's own, or a tenth of it, is a note's face or a unit mix-up, not a share price */
    const tkr = (r.ticker || '').toUpperCase();
    const marketLine = !EXERCISE_CODES.has(code) && !DERIVATIVE_LINE.test(r.security_title || '');
    const homePriced = marketLine && ((knownForeign.has(tkr) && over(price, spot, FOREIGN_OFF)) || (!meta.openMarket && depositary.has(tkr) && over(price, spot, 10)));
    if (meta.openMarket && !homePriced && spot > 0 && price > 0 && (price > spot * 10 || price * 10 < spot)) {
      implausible += 1;
      continue;
    }
    /* One open-market trade worth more than a quarter of the whole company is not a trade (it covers rows with no price). */
    if (meta.openMarket && !homePriced && cap > 0 && shares * price > cap * MAX_CAP_SHARE) {
      implausible += 1;
      continue;
    }
    /* A grant, award or withholding of a foreign-priced issuer at FOREIGN_OFF times the listing is a home-market price:
       flagged, and out of every dollar total. */
    const foreign = homePriced;
    const held = Number(r.shares_owned_after) || 0;
    const before = Number(r.shares_owned_before) || 0;
    const plan = r.is_10b5_1 === true ? 'plan' : r.is_10b5_1 === false ? 'discretionary' : 'unknown';
    /* The holding the trade was of: the filing's own "before" when given, else after + shares for a sale; never 0%. */
    /* A buy is read against the holding it built (after), a sale against the holding it came out of (before). */
    const base = meta.acquires ? (held > 0 ? held : before + shares) : before > 0 ? before : held > 0 ? held + shares : 0;
    const stakePct = base > 0 ? Number(((100 * shares) / base).toFixed(1)) : -1;
    const title = (r.officer_title || '').trim();
    const row: InsiderTrade = {
      id: r.id || `${r.ticker}-${r.owner_name}-${r.transaction_date}-${code}`,
      ticker: r.ticker || '',
      role: roleOf(title, !!r.is_director, !!r.is_ten_percent_owner, !!r.is_officer),
      person: r.owner_name || 'Undisclosed',
      code,
      kind: meta.acquires ? 'BUY' : 'SELL',
      shares,
      price,
      value: foreign ? 0 : Math.round(shares * price),
      foreignPrice: foreign ? { listed: spot, filedValue: Math.round(shares * price) } : undefined,
      indirect: String(r.director_indirect ?? '').toUpperCase() === 'I' ? (r.natureofownership?.trim() || 'indirect') : undefined,
      daysAgo: daysAgo(r.transaction_date || r.filing_date),
      plan,
      clusterCount: 1,
      heldAfter: held,
      stakePct,
      sincePct: price > 0 && spot > 0 && !foreign ? Number((((spot - price) / price) * 100).toFixed(1)) : 0,
      company: displayName(r.full_name) || undefined,
      sector: r.sector?.trim() || undefined,
      marketCap: cap > 0 ? cap : null,
      cik: r.reporter_cik?.trim() || undefined,
      title: title && !/see remarks/i.test(title) ? title : undefined,
      tradedOn: nyDayOf(r.transaction_date || r.filing_date) ?? undefined,
      filedOn: nyDayOf(r.filing_date) ?? undefined,
      entity: isEntity(r) || undefined,
    };
    meta2.push({ t: row, filed: String(r.filing_date ?? ''), cik: (r.reporter_cik ?? '').trim(), amended: /\/A$/i.test(form), indirect: String(r.director_indirect ?? '').toUpperCase() === 'I' });
  }
  const deduped = dedupeFilings(meta2);
  out.push(...deduped.trades);
  const buyers = new Map<string, Set<string>>();
  const sellers = new Map<string, Set<string>>();
  for (const t of out) {
    if (t.daysAgo > 30) continue;
    const bag = t.code === 'P' ? buyers : t.code === 'S' ? sellers : null;
    if (!bag) continue;
    const set = bag.get(t.ticker) ?? new Set<string>();
    for (const p of t.owners ?? [t.person]) set.add(p);
    bag.set(t.ticker, set);
  }
  for (const t of out) {
    if (t.daysAgo > 30) continue;
    if (t.code === 'P') t.clusterCount = buyers.get(t.ticker)?.size ?? 1;
    else if (t.code === 'S') t.clusterCount = sellers.get(t.ticker)?.size ?? 1;
  }
  return { trades: out, notShares, implausible, merged: deduped.merged };
}

