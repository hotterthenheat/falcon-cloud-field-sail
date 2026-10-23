/*
  Live Unusual Whales rows, in the shapes the dossier pages already render.
*/

import type { NewsItem, NewsCategory } from './news';
import { AMOUNT_BRACKETS, EMPTY_CONGRESS } from './congress';
import type { CongressFeed, CongressTrade, InsiderTrade, Member, Party, ReportOwner, ReportType, TxCode, AssetKind } from '../types/record';
import type { EconEvent } from './newsroom';
import type { UwCongress, UwEcon, UwNews, UwPolitician } from './whales';
import { TX_CODES } from './insiders';
import { UNIVERSE } from './universe';
import { companiesInHeadline, tickerName } from './tickers';
import { daysBetween, nyDayOf, nyDaysAgo } from './nyDate';
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

const sentimentOf = (s: string): number => (s === 'positive' || s === 'bullish' ? 0.55 : s === 'negative' || s === 'bearish' ? -0.55 : 0);

/* THE BEAT, FROM THE HEADLINE (the retail pass, 2026-10-22). The old rule filed every story without a borne-out ticker
   as Macro — Moderna's vaccine leak, Global Payments, Zurn — and any headline with the word "guidance" as Guidance
   (Anthropic's AI-safety guidance). Each beat now needs its own words: a guidance story names a company raising,
   cutting or reaffirming an outlook; a macro story names the economy, a central bank, rates, prices or the whole
   market. A company story that is none of the five named beats files under Product, the company beat. */
const EARNINGS_RE =
  /\bearnings?\b|\beps\b|\bq[1-4]\b|\b(?:first|second|third|fourth)[- ]quarter (?:results|profit|loss|revenue|sales|earnings)|\bquarterly (?:results|profit|loss|revenue|sales|earnings)\b|\b(?:profit|revenue|sales|net income|net loss)s? (?:rose|rises|fell|falls|jumps?|drops?|beats?|miss(?:es)?|tops?|surges?|slumps?|climbs?|declines?)\b|\b(?:beats?|miss(?:es)?|tops?) (?:estimates|expectations|forecasts|consensus)\b|\breports? (?:results|fiscal)\b|\bfiscal (?:\d{4}|q[1-4]|first|second|third|fourth|year) (?:results|earnings)/i;
const GUIDANCE_RE =
  /\b(?:raises?|raised|lifts?|lifted|boosts?|boosted|lowers?|lowered|cuts?|trims?|trimmed|reaffirms?|reaffirmed|reiterates?|reiterated|maintains?|withdraws?|withdrew|suspends?|narrows?|narrowed|updates?|issues?|initiates?|sets?|sees)\b[^.;]{0,40}\b(?:guidance|outlook|forecast)\b|\b(?:guidance|outlook|forecast)\b[^.;]{0,25}\b(?:raised|lowered|cut|above|below|ahead of|short of|for (?:fy|fiscal|q[1-4]|20\d\d|the (?:full )?year|full[- ]year))\b|\b(?:fy|full[- ]year)\s?'?\d{0,4}\s(?:guidance|outlook)\b/i;
const ANALYST_RE = /\btarget price\b|\bprice targets?\b|\bpt to\b|\b(?:rating|ratings)\b|\breiterat\w* (?:at )?(?:buy|sell|hold|neutral|outperform|underperform|overweight|underweight)\b|\bupgrades?\b|\bupgraded\b|\bdowngrades?\b|\bdowngraded\b|price target|\bpt\b(?= (?:to|raised|cut|lowered))|\b(?:initiates?|initiated|resumes?|starts?) coverage|\banalysts? (?:say|says|see|expect|rate|raise|cut)|\b(?:overweight|underweight|outperform|underperform|buy rating|sell rating|neutral rating)\b/i;
const MA_RE = /\bacqui(?:re|res|red|ring|sition)s?\b|\bmerger\b|\bmerge\b|\bbuyout\b|\btakeover\b|\btender offer\b|\bto buy\b[^.;]{0,30}\bfor \$|\b(?:agrees?|agreed|deal) to (?:buy|sell|acquire|merge)\b|\bspin[- ]?off\b|\bdivest/i;
const REG_RE = /\bsec\b|\bregulat|\bantitrust\b|\bdoj\b|\bftc\b|\bfda\b|\bprobe\b|\binvestigat|\blawsuit|\bclass action\b|\blitigation\b|\bsues?\b|\bsued\b|\bcourt\b|\bjudge\b|\bsettle(?:s|d|ment)\b|\bfined?\b|\bpenalt/i;
const MACRO_RE =
  /\$MACRO\b|\bfed\b|\bfomc\b|\bpowell\b|\bcpi\b|\bppi\b|\bpce\b|inflation|\bpayrolls?\b|jobs report|jobless claims|unemployment|\bgdp\b|recession|central bank|\becb\b|\bboj\b|\bboe\b|\bpboc\b|\brate (?:cut|hike)s?\b|interest rates?|treasury yields?|bond yields?|\byields? (?:rise|fall|jump|climb|slide)|\btariffs?\b|trade war|\bcrude\b|\bbrent\b|\boil (?:prices?|surpasses|tops|jumps|falls|rises|slides)|\bopec\b|the dollar\b|consumer confidence|consumer sentiment|\bpmi\b|retail sales|housing starts|home sales|\b(?:the|us|u\.s\.|global|world|china's|chinese|german|germany's|uk|britain's|euro(?:zone|pe's)?|japan's|japanese|india's|american) econom(?:y|ies)\b|\beconomic (?:data|growth|slowdown|outlook|activity|indicators?|calendar|report|figures|contraction|recovery)\b|government shutdown|\bdeficit\b|\bchancellor\b|\btreasury secretary\b|\bs&p 500\b|\bnasdaq composite\b|\bdow jones\b|\bwall street\b|global markets|\b(?<!'s )stocks (?:tumble|rally|fall|rise|slide|surge|drop|climb|sink|slump)/i;

/* TIGHTER WORDS FOR POLICY (round 8: press releases filed Macro on a bare "president", "congress", "sterling",
   "economy" or "military" — "Acme names Jane Doe President and CEO", "World Congress of…", "Sterling Bancorp…", "the
   creator economy", "a military contract"). Each needs the policy sense: the President by office or name, Congress
   acting, sterling as the currency, an economy that is a country's, the military as a force in action. */
const GOV_RE =
  /\b(?:government (?:shutdown|spending|debt|bonds?|data|officials?|says|said|plans?|policy|funding)|(?:federal|us|u\.s\.|state|national|eu|china's|japan's) government|congress(?:ional)? (?:passes|passed|votes?|voted|approves?|approved|leaders?|republicans|democrats|bill|hearing|budget|funding)|(?:the )?senate (?:passes|passed|votes?|voted|approves?|bill|confirms?)|house (?:passes|votes|republicans|democrats)|white house|(?:the|us|u\.s\.|french|russian|chinese|ukrainian|south korean|mexican|brazilian) president\b(?! (?:and|&|of (?:the )?(?:company|sales|operations|marketing|engineering|global|north|asia|europe|investor)))|president (?:trump|biden|xi|putin|zelensk(?:y|iy)|macron|lula|erdogan|milei|sheinbaum|lee)|trump|biden|(?:trump|biden|the) administration|election|parliament|prime minister|(?:finance|foreign|trade|economy|defense|defence|energy) minister|ministry of|cabinet (?:reshuffle|meeting|approves)|lawmakers?|legislation|bill (?:passes|signed)|sanctions?|embargo|war\b(?! (?:room|chest|game))|ceasefire|nato|united nations|imf|world bank|g7|g20|(?:federal|state|national|government|eu) budget|budget (?:deficit|bill|talks|vote|proposal)|tax (?:cut|hike|bill|plan)|debt ceiling|stimulus|regulators?|commodit(?:y|ies) (?:prices?|markets?)|gold (?:prices?|futures|rises|falls|climbs|slips)|silver prices?|copper prices?|natural gas (?:prices?|futures)|bitcoin (?:price|falls|rises|slides|jumps|tops|drops)|crypto(?:currency|currencies)? market|futures (?:rise|fall|edge|point)|stock futures|equit(?:y|ies) markets?|markets? (?:open|close|rally|slump|wrap)|asian (?:stocks|markets)|european (?:stocks|markets)|ftse (?:100|250)?|dax|nikkei (?:225|average|index|stock average|(?:rises|falls|gains|drops|climbs|slips|ends|closes))|hang seng|kospi|sensex|yuan|yen\b|euro\b(?![- ]?(?:pacific|net|bank))|sterling (?:rises|falls|slips|gains|weakens|strengthens|hits|drops|climbs|against|edges)|pound sterling|forex)\b/i;

/* THE WORLD BEYOND THE FIVE BEATS IS MACRO, AND A STORY OF NO BEAT IS GENERAL (audit round 5, 2026-10-23). Israel and
   Ukraine stories, "US Dollar Recovery… FX", Italy's bill auction, a bid-to-cover, UK natural gas and India's PMI all
   fell through to PRODUCT, the old fallback. Geopolitics, currencies, rates and auctions, and economic data are Macro
   (no single company as the subject); a launch, a release, a rollout is Product; anything else is General. */
const GEO_RE = /\b(?:israel(?:i|is)?|gaza|hamas|hezbollah|west bank|ukrain(?:e|ian|ians)|kyiv|kremlin|russia(?:n|ns)?|moscow|putin|zelensk(?:y|iy)|iran(?:ian)?|tehran|syria|yemen|houthis?|red sea|north korea|pyongyang|taiwan strait|missiles?|drone strikes?|airstrikes?|troops|military (?:strikes?|action|operations?|escalation|build-?up|exercises?|drills?|offensive|aid|spending|junta)|invasion|ceasefire|truce|peace (?:talks|deal|plan)|nato|sanctions?|geopolitic\w*|trade (?:officials|talks|ministers?|negotiat\w+|truce|deal)|bank of (?:korea|japan|england|canada|israel|mexico|thailand)|reserve bank|central bank|finance ministry|bls|bureau of labor)\b/i;
const FX_RE = /\b(?:fx|forex|currenc(?:y|ies)|(?:us )?dollar(?: index)?|dxy|greenback|euro(?:zone)?|pound sterling|sterling(?= (?:rises|falls|slips|gains|weakens|strengthens|hits|drops|climbs|against|edges|trades))|yen|yuan|renminbi|rupee|swiss franc|loonie|aussie dollar|kiwi dollar|peso|lira)\b(?![- ]denominated (?:bond|debt))/i;
const RATES_RE = /\b(?:(?:t-|treasury |government |sovereign |\d+-(?:month|week|year) )bills?|government bonds?|sovereign bonds?|bunds?|gilts?|btps?|oats|jgbs?|treasur(?:y|ies)|yields?|bid[- ]to[- ]cover|(?:bill|bond|debt|treasury) auctions?|swap rates?|repo|interest rates?|rate (?:cut|hike|decision|path|outlook)s?|policy rate|basis points|bps)\b|\b(?:italy|italian|spain|spanish|germany|german|france|french|uk|britain|japan|eurozone|greece|portugal|ireland|belgium|austria|netherlands|dutch|finland|us|u\.s\.)\b[^.;]{0,40}\bbills?\b/i;
const DATA_RE = /\b(?:pmi|purchasing managers|gdp|cpi|ppi|pce|inflation|deflation|payrolls?|unemployment|jobless|claims|retail sales|industrial (?:output|production)|factory (?:orders|output)|durable goods|trade (?:balance|deficit|surplus)|current account|housing starts|building permits|home sales|consumer (?:confidence|sentiment|prices)|business (?:confidence|climate|sentiment)|ifo|zew|tankan|inventor(?:y|ies)|stockpiles?|natural gas|nat gas|crude|brent|wti|gasoline|survey|index (?:rose|fell|rises|falls|climbs|slips|jumps|drops)|economic data)\b/i;
const PRODUCT_RE = /\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|releases?d?|rolls? out|rolled out|rollout|debut(?:s|ed)?|new (?:product|model|version|service|feature|chip|phone|platform|app)|ships?|shipping|recalls?|recalled|availability|now available|partners? with|partnership|collaborat\w+|deploy(?:s|ed|ment)?|pilot|beta|preview|upgrade[sd]? (?:its|the) (?:app|platform|service)|update[sd]? (?:its|the) (?:app|platform|service)|approval for|wins? (?:contract|order|deal)|contract|orders?)\b/i;

const categoryOf = (headline: string, tags: string[] | undefined, hasTicker: boolean): NewsCategory => {
  const s = `${headline} ${(tags ?? []).join(' ')}`;
  if (/\$MACRO\b/i.test(s)) return 'Macro';
  if (!hasTicker && INDEX_MOVE_RE.test(headline)) return 'Macro';
  /* a broker's note is the analyst beat even when it names a quarter ("HSBC cuts target price on X after Q3") */
  if (/\btarget price\b|\bprice targets?\b|\bupgrades?\b|\bupgraded\b|\bdowngrades?\b|\bdowngraded\b/i.test(headline)) return 'Analyst';
  /* THE DATA BEFORE THE OUTLOOK (audit round 6): "EUROZONE OCTOBER COMPOSITE PMI DROPS TO 51.9, LOWER THAN EXPECTED
     FORECAST…" filed under Guidance on the word "forecast" — the guidance rule ran before the macro rules. An economic
     release, a central bank or a rate with no company as its subject is Macro first; guidance and the earnings beat's
     "tops forecasts" need a company to be about. */
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
  /* MACRO MEANS MACRO (the third audit, 2026-10-23): "no ticker" is not the macro beat — "MiniTool ShadowMaker 5.0
     Introduces Cloud Sync", Chery's crash tests and a Warhound launch were filed MACRO and featured as the lead. A story
     with no listed name is macro only when it is about the economy, a central bank, rates, prices, markets, or government
     and policy; a press release from a company the page does not list is a company story — the Product beat. */
  if (!hasTicker && (GOV_RE.test(s) || GEO_RE.test(s) || FX_RE.test(s) || RATES_RE.test(s) || DATA_RE.test(s))) return 'Macro';
  if (PRODUCT_RE.test(s)) return 'Product';
  return 'General';
};

/* THE MOVE AT PUBLISH, ON THE dayChange.ts CONVENTION (the third audit, 2026-10-23). The wire's meta is the name's last
   bar against the bar before it: in the session that is the session's move, but after the bell `curr` is the post-market
   bar and `prev` is TODAY's regular close — so curr − prev was the after-hours move alone (GOOGL "+0.2%" on a −3.15%
   day; 69 of 159 nodes). Now the regular session's move is today's regular close against the close before it (the name's
   regular closes, data/dayChange.ts, when they are in hand), and the extended-hours move is kept apart, named. Before the
   open the session has not moved: only the pre-market move is given. */
interface MetaBar {
  c?: string | number;
  date?: string;
  mt?: string;
}
export interface PublishMove {
  /** The regular session's move when the story crossed, or null when it cannot be read (or the session had not opened) */
  day: number | null;
  /** The pre-market or after-hours move at publish, or null in the session */
  ext: number | null;
  extWord: 'pre-market' | 'after hours' | null;
  /** BEFORE THE OPEN: the last session's own change and its date — said as that day's, never as the story's day */
  last: { pct: number; date: string } | null;
  /** After the bell, the regular close the day's move needs a prior close for — and its date */
  needs: { ticker: string; date: string; close: number } | null;
}
const pctOf = (a: number, b: number): number => Number((((a - b) / b) * 100).toFixed(2));
/* BEFORE THE OPEN IS NOT THE LAST SESSION (the fourth audit, 2026-10-23): "03:18 NVDA … +2.5%" was the 10/21 session —
   the overnight story's meta is still 10/21's post-market bar, so the post-market branch measured 10/21's close against
   10/20's and printed it as the move at publish; NVDA fell −4.4% on 10/22. On dayChange.ts's before-open rule, a story
   that crossed on a New York day after its meta's last regular session (after midnight, before the open) has no session
   move yet: it carries the extended-hours move (pre-market, or the evening's after-hours still standing overnight) and
   the last session's change, labelled with that session's date. */
export function publishMove(meta: UwNews['meta'], ticker: string | null, priorClose: (ticker: string, before: string) => number | null, publishedAt?: string): PublishMove {
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

/* THE STORY'S NAME, CHECKED AGAINST ITS OWN HEADLINE (the ship pass, 2026-10-22): the wire's ticker tags are loose —
   a "$MACRO" Dutch consumer-confidence print came tagged BROS, and "SpaceX, Tesla consider all-stock merger" came with
   no ticker at all. A headline the wire itself marks $MACRO is macro; an untagged one that names a large cap by its
   company name gets that name. Everything else keeps the wire's tags. */
const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* the full company name as written ("Tesla", "Bank of America", "NVIDIA" or "Nvidia"), or in an all-caps headline —
   never a first word alone ("Advanced", "Home", "Bank" would tag half the wire) */
const COMPANY_RE = UNIVERSE.filter(u => u.name.length >= 4 && u.name !== u.ticker).map(u => {
  const proper = u.name === u.name.toUpperCase() ? u.name.charAt(0) + u.name.slice(1).toLowerCase() : u.name;
  return { ticker: u.ticker, re: new RegExp(`\\b(?:${esc(u.name)}|${esc(proper)}|${esc(u.name.toUpperCase())})\\b`) };
});
/* THE SHORT NAMES THE WIRE WRITES (round 8: "Western Digital…" and "Abbott…" stories came untagged and read NO NAME —
   the listing's names are "Western Digital Corporation" (two plain words, skipped by the headline matcher) and "Abbott
   Laboratories" (the wire never writes "Laboratories")). Each entry is a company's usual short name, unambiguous as
   written — capitalised, or in an all-caps headline — and the listed symbol it means. */
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
];
const SHORT_NAME_RE = SHORT_NAMES.map(([name, ticker]) => ({ ticker, re: new RegExp(`(?<![\\w&-])(?:${esc(name)}|${esc(name.toUpperCase())})(?:'s|’s)?(?![\\w&-])`) }));

/* A WIRE TAG MUST BE BORNE OUT BY ITS HEADLINE: the vendor tags by bare word — "AI", "Gold" (Barrick), "Bond",
   "CPI", "FUTURE" (FutureFuel), "Tesla Eyes" (Second Sight). A tag stands when the headline writes it as a symbol
   ($T, (T), NASDAQ: T) or names the company by its distinctive word; otherwise it is dropped — a missing tag costs
   less than a story filed under the wrong company. */
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
/* A NAME IN A HEADLINE IS NOT ITS SUBJECT (the third audit, 2026-10-23): "Waymo, Google and Microsoft Alums Raise $30M…"
   came with no tags and was filed as MSFT · PRODUCT · MAJOR and put on the board, ranked third. An untagged story is
   filed under a company only when the headline LEADS with it ("Tesla Recalls…", "COCA-COLA SAYS…", "Exclusive: Nvidia
   …"); a company named further in is a mention — shown as "mentions MSFT", never the story's name, never on the board. */
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
/* A SPONSOR OR A BROKER IS NOT THE SUBJECT (audit round 5, 2026-10-23): "HSBC India Manufacturing PMI…" was filed as HSBC
   company news and drove "Biggest move · HSBC −2.1%"; "Jefferies Raises OMV Target Price" was filed under JEF. A
   purchasing-managers' survey (HSBC, S&P Global, Caixin, au Jibun Bank…) is economic data with a sponsor's name on it — no
   company is its subject; a broker's note leads with the broker — the subject is the name after the verb, so the
   broker's name is read out of the headline before any tag is checked against it. */
const SPONSORED_DATA_RE = /\b(?:pmi|purchasing managers'?(?: index)?)\b/i;
const BROKER_LEAD_RE = /^\s*(?:[A-Z][\w&.'-]*\s+){1,4}?(?:raises|lifts|boosts|cuts|lowers|trims|reduces|reiterates|maintains|keeps|initiates|starts|resumes|upgrades|downgrades|assumes|sets|hikes|ups)\b(?=[^.;]{0,60}\b(?:target|rating|coverage|price objective|pt|to (?:buy|sell|hold|neutral|outperform|underperform|overweight|underweight|equal[- ]weight|market perform))\b)/i;
/* AN INDEX IS NOT ITS EXCHANGE (round 8: "NASDAQ DOWN 111.60 POINTS" came tagged NDAQ and read MAJOR — like the
   vendor's other bare-word tags). A headline about an index's level or its points is the market's move: no company is
   its subject, it files under Macro, and a tick of the tape is not major news. */
export const INDEX_MOVE_RE =
  /^\W*(?:breaking:\s*)?(?:(?:u\.?s\.?|britain'?s|uk'?s|germany'?s|france'?s|japan'?s|europe'?s|hong kong'?s|china'?s)\s+)?(?:the\s+)?(?:nasdaq(?: composite| 100)?|dow(?: jones)?(?: industrials| industrial average)?|s&p(?: 500)?(?: e-?mini)?|nyse composite|russell (?:2000|1000|3000)|djia|spx|ndx|ftse(?: 100| 250| mib)?|dax|cac(?: 40)?|nikkei(?: 225)?|topix|hang seng|stoxx(?: 600| europe 600| 50)?|euro stoxx(?: 50)?|kospi|asx(?: 200)?|sensex|nifty(?: 50)?|shanghai composite|csi 300|ibex(?: 35)?|tsx|smi|aex)\b(?:[^.;]|\.(?=\d)){0,40}?\b(?:up|down|rises?|rose|falls?|fell|gains?|loses?|drops?|dropped|climbs?|slips?|jumps?|sinks?|closes?|opens?|ends?|extends?|pares?|turns?|hits?|tops?|record)\b(?:[^.;]|\.(?=\d)){0,40}?(?:\bpoints?\b|\bpts\b|%|\brecord\b|\bhigh\b|\blow\b)/i;
/* MACRO IS MAJOR ONLY WHEN IT MOVES MARKETS (round 9: 163 of 665 stories read MAJOR, most of them Macro — "Trump: I have
   not spoken to Elon", "Trump leaves the White House en route to Florida", humanitarian missions, ceasefire dates in one
   town, "BRITAIN'S FTSE 100 DOWN 0.51%"). The vendor flags every geopolitical line major; a Macro story keeps the flag
   only for what moves prices: central banks and rates, the big data prints (inflation, jobs, GDP, retail sales, the
   PMIs and sentiment where the US or a major economy prints them), tariffs and trade policy, the fiscal calendar
   (shutdowns, the debt ceiling, budgets with market stakes), sanctions, and war or supply news that touches oil or the
   Gulf's shipping. The tape's own ticks (index and futures levels, gold's moves, order imbalances, currency-strength
   charts) are never major. */
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
export const macroMoves = (headline: string): boolean => MACRO_MOVING_RE.test(headline) && !MACRO_TICK_RE.test(headline);
const INDEX_TAGS = new Set(['NDAQ', 'ICE', 'SPGI', 'CME', 'DJI', 'DIA', 'QQQ', 'SPY', 'IWM', 'CBOE', 'MSCI']);
function storyTickers(headline: string, tags: readonly string[] | undefined): { tickers: string[]; mentions: string[] } {
  if (/\$MACRO\b/i.test(headline)) return { tickers: [], mentions: [] };
  if (INDEX_MOVE_RE.test(headline) && (tags ?? []).every(t => INDEX_TAGS.has(t.trim().toUpperCase()))) return { tickers: [], mentions: [] };
  if (SPONSORED_DATA_RE.test(headline)) return { tickers: [], mentions: [] };
  const broker = BROKER_LEAD_RE.exec(headline);
  if (broker) headline = headline.slice(broker[0].length).replace(/^\s+/, '');
  const tagged = [...new Set((tags ?? []).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z][A-Z0-9.]{0,5}$/.test(t)))].filter(t => borneOut(t, headline));
  if (tagged.length) return { tickers: tagged, mentions: [] };
  const named = [...COMPANY_RE, ...SHORT_NAME_RE].filter(c => c.re.test(headline)).filter((c, i, all) => all.findIndex(x => x.ticker === c.ticker) === i);
  /* an untagged company story names its company by the listing's own name (data/tickers.ts companiesInHeadline) —
     "COCA-COLA SAYS…" is KO, "Medpace Slumps…" MEDP (the re-audit, 2026-10-22: dozens of NO TICKER rows) */
  const listed = companiesInHeadline(headline).filter(t => !named.some(n => n.ticker === t));
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

/* NOT MARKET NEWS (the re-audit, 2026-10-22): the press-release wires carry paid placements — a criminal-defense firm's
   explainer ("Legal vs. Illegal Insider Trading… | Wichita Criminal Defense Lawyers"), HelloNation advice columns. A
   story from such a source is not a market story and is dropped, counted. */
const SPAM_RE =
  /\b(?:criminal defense|defense lawyers?|defense attorneys?|personal injury|injury (?:lawyers?|attorneys?)|dui (?:lawyers?|attorneys?)|divorce (?:lawyers?|attorneys?)|hellonation|law offices? of|accident (?:lawyers?|attorneys?)|estate planning attorney)\b|\|\s*[^|]{0,60}\b(?:lawyers?|attorneys?|law firm|law group)\s*$/i;
/* NOISE ON THE WIRE (the retail test, round 7: token-price bot posts — "Lido DAO struggles at $0.39 on Binance, below key
   moving averages. MACD at zero…" — a market-research advert, an essay-writing advert and a marathon runner's doping
   suspension filed under WKC sat among the day's stories) */
const NOISE_RE =
  /\bon binance\b[^.]{0,80}?(?:macd|stochastic|bollinger|moving averages?|rsi|pivot|oversold|overbought)|\b(?:macd|stochastic|bollinger)\b[^.]{0,80}\bbinance\b|\bmarket worth \$?[\d.,]+ ?(?:billion|million) by 20\d\d\b|\|\s*marketsandmarkets|\bessay writing service\b|\b(?:marathon|athletics integrity|olympic) (?:champion|unit|gold)/i;
export const isNewsSpam = (headline: string): boolean => SPAM_RE.test(headline) || NOISE_RE.test(headline);

/* "MAJOR" IS EARNED (the retail test, round 7: 138 of 270 stories read MAJOR — the vendor flags conference-call dates,
   "to speak at" notices, routine dividends and press releases on private companies). A story is major when the vendor
   says so AND it is about a named listed company or the economy, AND it is not house-keeping. */
const ROUTINE_RE =
  /\bconference call\b|\b(?:earnings|results) (?:release|date|call)\b|\b(?:to|will) (?:host|hold|report|announce|release)\b[^.]{0,60}\b(?:results|earnings)\b|\bannounces? (?:the )?(?:date|timing)\b|\btiming of\b[^.]{0,40}\bresults\b|\bto (?:speak|present|participate) at\b|\binvestor (?:conference|day)\b|\b(?:declares?|announces?)\b[^.]{0,30}\b(?:quarterly|regular|monthly|cash) (?:cash )?dividend\b|\bdividend payout\b|\bnames?\b[^.]{0,40}\b(?:vice president|vp|manager|director)\b/i;

/** The regular close before a date, from the name's regular closes when they are in hand — or null */
export type PriorClose = (ticker: string, before: string) => number | null;
const noPrior: PriorClose = () => null;

export function newsFromWhales(rows: UwNews[], priorClose: PriorClose = noPrior): NewsItem[] {
  return rows.filter(r => !isNewsSpam(decodeEntities(r.headline || ''))).map((r) => {
    const headline = decodeEntities(r.headline || '');
    const at = Date.parse(r.created_at);
    const sent = sentimentOf(r.sentiment);
    const { tickers, mentions } = storyTickers(headline, r.tickers);
    const ticker = tickers[0] ?? null;
    const category = categoryOf(headline, r.tags, !!ticker);
    const major = !!r.is_major && (!!ticker || (category === 'Macro' && macroMoves(headline))) && !ROUTINE_RE.test(headline) && !INDEX_MOVE_RE.test(headline);
    const pm = publishMove(r.meta, ticker, priorClose, r.created_at);
    const moved = pm.day;
    const move = moved ?? 0;
    const stamp = Number.isFinite(at) ? at : 0;
    return {
      id: `uw-${stamp}-${ticker ?? 'macro'}-${headline.slice(0, 48)}`,
      time: Number.isFinite(at) ? new Date(at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) : '',
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
        probUpPct: 50,
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
    /* THE VENDOR REPEATS EVENTS (the fourth audit, 2026-10-23): the same release at the same minute came twice — one row
       per release, keeping the one that carries the forecast or the prior */
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
      timeLabel: dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }),
      inMinutes,
      forecast: r.forecast ?? undefined,
      previous: r.prev ?? undefined,
    });
  }
  return out.sort((a, b) => a.inMinutes - b.inMinutes);
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

/* A MALFORMED TYPE (the data audit, 2026-10-22): a few filings carry the asset or a CUSIP in the type field —
   "E\n30609A109" (an exchange) or "AutoZone, Inc. Common Stock (AZO) S \n[ST] FILING STATUS…" (a sale). The type is
   the lone code letter on the first line; such rows are read for it, not dropped. */
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
  /* "Sell" is all the vendor says (the re-audit, 2026-10-22): a sale it marks full says so; a bare sell is a sale */
  if (/\bfull\b/.test(s) && (s.includes('sale') || s.includes('sell'))) return 'Sale (Full)';
  if (s.includes('sale') || s.includes('sell')) return 'Sale';
  return null;
};

/* THE OWNER IS THE ISSUER FIELD'S OWN WORD (audit round 6): "Independent Bank Corp." read owner "Dependent" — a
   substring of the notes and the issuer together. The vendor's `issuer` carries the owner (self, spouse, joint, child,
   undisclosed); it is read alone, word by word, and an asset's name there never names an owner. */
const ownerOf = (_notes?: string, issuer?: string): ReportOwner => {
  const s = (issuer || '').toLowerCase().trim();
  if (/^(?:dependent(?: child)?|child|dc)$/.test(s)) return 'Dependent';
  if (/^(?:spouse|sp)$/.test(s)) return 'Spouse';
  if (/^(?:joint|js)$/.test(s)) return 'Joint';
  /* "undisclosed" is the filing not saying whose it is — never the member's own (the third audit, 2026-10-23) */
  if (/^self$/.test(s)) return 'Self';
  return 'Undisclosed';
};

/** The owner tag in words: "not stated" when the filing does not say */
export const ownerWord = (o: ReportOwner): string => (o === 'Undisclosed' ? 'not stated' : o);

const bracketOf = (amounts: unknown): number | null => {
  const s = typeof amounts === 'string' ? amounts : Array.isArray(amounts) ? amounts.map(String).join(' ') : amounts && typeof amounts === 'object' ? JSON.stringify(amounts) : '';
  if (!s) return null;
  /* "Spouse/DC over $1,000,000" is the rung above $1,000,000, not the one ending at it (the re-audit, 2026-10-22) */
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
  /* A MATURITY IS NOT A BILL (audit round 5): "DELL INTL LLC/EMC CORP · Rate/Coupon 5.3% · Matures 2028-…" — a corporate
     note — read "Treasury Bill". Only a line that names the Treasury, a bill, or the government-securities tag is one;
     an issuer named before the maturity is someone else's paper */
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

/* THE FILING'S OWN ASSET-TYPE TAG, READ BEFORE THE NOTES ARE CLEANED (audit round 6): Pelosi's "Apple Inc. - Common
   Stock (AAPL) [OP]" — a call option, $250K–$500K — read "AAPL · Apple Inc. · Purchase", a share trade: the tag was cut
   off by cleanNotes and "Common Stock" in the notes vetoed the option. The House's PTR codes name the kind outright. */
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
export const assetTagOf = (notes?: string): string | null => {
  const head = (notes || '').split(/FILING STATUS:|SUBHOLDING OF:|DESCRIPTION:/i)[0];
  const tags = [...head.matchAll(/\[([A-Za-z]{2})\]?/g)].map(m => m[1].toUpperCase());
  return tags.length ? tags[tags.length - 1] : null;
};
const assetKindOf = (notes?: string, issuer?: string): AssetKind => {
  const tag = assetTagOf(notes);
  const s = `${notes || ''} ${issuer || ''}`;
  /* [GS] IS EVERY GOVERNMENT SECURITY (round 8: munis tagged [GS] read as Treasuries — the tag decided before the muni
     words were read). Under [GS] a Treasury or federal-agency issue stays a government security; every other one — a state,
     a county, a district, an authority, however the filer abbreviates it — is a municipal security. */
  if (tag === 'GS' && !/\btreasur(?:y|ies)\b|\bt-?bills?\b|\bu\.?s\.? (?:govt|government|treas\w*)\b|\bunited states\b|\bfnma\b|\bfannie\b|\bfreddie\b|\bfhlmc\b|\bfhlb\b|federal (?:home loan|farm credit)|\bginnie\b|\bgnma\b|\btips\b|\bstrips\b|\bagency\b/i.test(s)) return 'Municipal Security';
  if (tag && TAG_KIND[tag]) return TAG_KIND[tag];
  if (/\btreasury\b|\bt-?bills?\b|\[GS\]/i.test(s)) return 'Other';
  /* OPTION EVIDENCE WINS OVER THE UNDERLYING'S NAME (audit round 7): Pelosi's untagged "Intel Corporation - Common Stock
     (INTC) 50 call options, Strike: $50" and Sen. Armstrong's "…Common Stock\nOption Type: Call\nStrike price: $80.00"
     read as share trades because "Common Stock" vetoed the option. A count of calls/puts, an "Option Type:" line or a
     strike is the contract itself; only the bare word "call"/"option" stays vetoed by "Common Stock". */
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
  /* ONLY THE PAGING'S OVERLAP IS ONE REPORT (round 8: two identical lots filed the same day were collapsed into one).
     Rows identical in every field are counted per answer they came in (liveRecord marks each row's read, `__page`); a
     report stands as many times as the most any one answer holds it — the overlap between reads is not counted twice,
     a member's genuine identical lots are all kept. */
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
    /* A MEMBER IS WHO THE REPORT SAYS FILED AS ONE (audit round 6, 2026-10-23). The roster's chamber is where the person
       sits NOW: Rep. Van Epps (bioguide V000139, every row member_type "house") is filed "executive" on it, and the old
       roster test dropped his 13 reports silently. The row's own member_type decides: house or senate is a member's
       report and is read; executive is an executive-branch filing (the President's OGE reports, a cabinet secretary's)
       and is left out, counted. A row that names no type is a member's when the person has a Congress directory
       (bioguide) id or a House or Senate seat on the roster — a new appointee (Sen. Alan Armstrong, A000383, first
       report 2026-03-24) keeps the chamber the report names. */
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
    /* THE ASSET IN THE TYPE FIELD (round 9: Richard W. Allen's AutoZone sale read "Not named on the filing" — the vendor
       put "AutoZone, Inc. Common Stock (AZO) S \n[ST] … SUBHOLDING OF: …" in txn_type and "SP" in the notes). When the
       notes name no asset and the type field carries more than its code, the asset (and its symbol) is read from there,
       the trailing transaction code taken off. */
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
    /* ONE REPORT IS EVERY FIELD OF IT (audit round 5, 2026-10-23): the id cut the notes to 40 characters and left out the
       owner (`issuer`: self, spouse, joint…), so a spouse's trade merged into the member's and a call option into the
       stock bought beside it — Whitehouse read 30 of 37, Pelosi 26 / 18 of 28 / 20, the 90-day book 673 of 699. Only a
       true repeat — every field the vendor sent identical (the paging re-reads the cursor's day) — is read once. */
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
      committeeOverlap: null,
      tradedOn: tradedDay ?? undefined,
      filedOn: filedDay ?? undefined,
    });
  }
  return { ...rollCongress(trades, windowDays), unreadTypes: unread, notMembers, notMemberAges };
}

export function rollCongress(trades: CongressTrade[], windowDays: number): CongressFeed {
  let totalLow = 0;
  let totalHigh: number | null = 0;
  let unknownAmounts = 0;
  let purchases = 0;
  let sales = 0;
  let lateFilings = 0;
  for (const t of trades) {
    if (t.bracket == null) unknownAmounts += 1;
    else {
      const b = AMOUNT_BRACKETS[t.bracket];
      totalLow += t.amountOver != null ? t.amountOver + 1 : b.low;
      /* an open-ended amount ("over $1,000,000") has no top, so the sum has none either */
      if (totalHigh !== null) totalHigh = b.high == null || t.amountOver != null ? null : totalHigh + b.high;
    }
    if (t.type === 'Purchase') purchases += 1;
    else if (t.type !== 'Exchange') sales += 1;
    if (t.late) lateFilings += 1;
  }
  const lags = trades.map(t => t.lagDays).sort((a, b) => a - b);
  return { trades, totalLow, totalHigh, unknownAmounts, purchases, sales, lateFilings, overlaps: 0, medianLag: lags.length ? lags[Math.floor(lags.length / 2)] : 0, windowDays };
}

const CODES = new Set<TxCode>(['P', 'S', 'A', 'M', 'F', 'G', 'D']);

/* THE ROLE AS FILED (the data audit, 2026-10-22): every title the five named offices did not catch fell to "Director",
   so 686 rows of presidents, CTOs and controllers read as board members and the Role card could not find them. A
   named office first; any other officer title (or the officer box) is "Officer"; then the 10% box, then the board. A
   filer who ticked none of the boxes and gave no title is "Other" — never a guess. */
const OFFICER_WORDS = /\b(?:president|pres\.?|chief|cto|cio|cmo|cao|cso|cro|cdo|chro|svp|evp|vp|vice president|treasurer|secretary|controller|comptroller|officer|founder|general manager|head of|managing director|principal)\b/;
const roleOf = (title: string, director: boolean, ten: boolean, officer: boolean): InsiderTrade['role'] => {
  const t = title.toLowerCase();
  /* A CO- OR REGIONAL CHIEF IS AN OFFICER (the re-audit, 2026-10-22: "Co-CEO Asia Pacific" filed as the CEO): the three
     singular offices are the company's own, not a co-holder's, a region's, a division's or a subsidiary's */
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

/* COMMON SHARES ONLY ON THE MARKET ROWS (the data audit, 2026-10-22): `common_stock_only=true` still let a cash-settled
   total return swap through — FLUT's "$267M of chosen buying" was swaps. An open-market row whose security is a swap, a
   preferred, a warrant, a note or any derivative is not a share purchase or sale and is not read as one. */
const NOT_SHARES = /swap|preferred|\bpref\b|warrant|option|\bnotes?\b|debenture|\bbonds?\b|\bright(s)?\b|\bunits?\b|convertible|derivative|futures?|\bsafe\b|restricted stock unit|\brsus?\b|phantom|performance share/i;
const isShareLine = (title?: string | null): boolean => !title || !NOT_SHARES.test(title);

/** The largest share of a company one open-market trade can plausibly be. A filing over it is a unit mix-up, not a trade */
const MAX_CAP_SHARE = 0.25;

type UwInsiderRow = { amount?: number; filing_date?: string; formtype?: string | null; is_10b5_1?: boolean | null; is_director?: boolean; is_officer?: boolean; is_ten_percent_owner?: boolean; officer_title?: string | null; owner_name?: string; price?: string | number | null; shares_owned_after?: number | null; shares_owned_before?: number | null; stock_price?: string | number | null; ticker?: string; transaction_code?: string; transaction_date?: string; id?: string; security_title?: string | null; marketcap?: string | number | null; sector?: string | null; reporter_cik?: string | null; full_name?: string | null; reporter_is_public_company?: boolean | string | null; director_indirect?: string | null; natureofownership?: string | null };

/** What the insider feed read: the rows, and how many it set aside and why — counted, never silent */
export interface InsiderRead {
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

/* A REPORTER THAT IS A COMPANY OR A FUND (the re-audit, 2026-10-22): Volkswagen AG's $1.0B RIVN stake and SMFG's JEF
   purchases are code P but are strategic investments and private placements, not an insider choosing to buy with their
   own money. The vendor's public-company flag, or an entity's legal form in the name, marks them. */
const ENTITY_RE = /\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.?l\.?c|lp|l\.?p|llp|plc|ag|sa|s\.a|nv|n\.v|se|gmbh|bv|ab|asa|oyj|spa|kk|holdings?|group|partners(?:hip)?|capital|fund|funds|trust|management|advisors?|investments?|ventures|aggregator|foundation|bank|financial|securities)\.?\b/i;
const isEntity = (r: UwInsiderRow): boolean => r.reporter_is_public_company === true || r.reporter_is_public_company === 'true' || ENTITY_RE.test(r.owner_name || '');

/* ONE TRADE, ONE ROW (the re-audit, 2026-10-22). A joint Form 4 lists the same trade once per reporting owner —
   BTSG's $857M KKR sale came twice (KKR Group Partnership and KKR Phoenix Aggregator), LTH three times — and an amended
   filing (4/A) restates a trade already read (SMFG's JEF buy of 05/01, filed 05/04 and again 06/29). Both overstated the
   90-day totals by about $1.1B. A joint filing: same name, trade day, code, shares and price, filed the same day. An
   amendment: the same reporter, name, trade day, code and shares, filed later — the latest filing stands. */
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
      /* the same filing read twice (one copy carried the reporter's CIK, the other none — BTSG's KKR, 2025-10-22) */
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

/* AN EXERCISE IS PRICED AT ITS STRIKE (audit round 6): Slootman's code-M rows at $8.88 against SNOW's $313.96 read
   "NOT USD", twenty of them out of the dollar totals — an option's strike is in dollars and far under the stock by
   design. Exercise and conversion codes (M, X, C, O and the derivative lines) never take the currency test. */
const EXERCISE_CODES = new Set(['M', 'X', 'C', 'O', 'E', 'H']);
const DERIVATIVE_LINE = /option|warrant|right to buy|convertible|\brsus?\b|restricted stock unit|performance share|phantom/i;
/* A FOREIGN LISTING IS A FACT OF THE ISSUER, not of one row's price (audit round 7: UMC's chairman sold "Common Shares"
   at 142.33 and 145.00 — Taiwan dollars, the TWSE line — beside the NYSE ADR's $18.53, and $229M of false sales passed
   because 7.7× is under the old tenfold test). Two facts mark an issuer whose filings can be in a home currency:
     · the vendor's own issuer record calls the US listing an ADR (/stock/{T}/info issue_type — the live record reads it
       for every issuer with a row FOREIGN_OFF times over its listing, and hands the answer here through
       markForeignIssuers). A row of such an issuer FOREIGN_OFF times over the listing is in the home currency: no ADR
       is worth less than one of its own shares in dollars, and the currencies these issuers file in (TWD, JPY, HKD, INR,
       KRW…) are all several to the dollar. A row far UNDER the ADR is one ordinary share in dollars (BABA's 13.55 beside
       the 8-share ADR's $101.82, BEKE's 5.27 beside the 3-share ADR's $17.24) — that is a dollar price and stays in;
     · its lines are depositary or ordinary shares (TAK's "American Depositary Shares") — weaker, so only a non-market
       row ten times over the listing is read as home-priced (the round-4 rule).
   A home-priced row stays on the page, flagged "not USD", and its value is out of every dollar total. A US stock that
   simply fell (FJET's $8.55 sales beside $0.87 today) is not touched: its issuer record says Common Stock. */
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
    /* Form 144 is a notice of a proposed sale, not an execution. A code the
       book does not name (J, U, C…) is not an open-market buy or sale either —
       mapping those onto P and S put fictional trades on the open-market page. */
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
    /* a "price" ten times the stock's own, or a tenth of it, is a note's face or a unit mix-up, not a share price — a
       SAFE filed at $2,000,000 "a share" read as $15.7 trillion of buying (the retail pass, 2026-10-22) */
    const tkr = (r.ticker || '').toUpperCase();
    const marketLine = !EXERCISE_CODES.has(code) && !DERIVATIVE_LINE.test(r.security_title || '');
    const homePriced = marketLine && ((knownForeign.has(tkr) && over(price, spot, FOREIGN_OFF)) || (!meta.openMarket && depositary.has(tkr) && over(price, spot, 10)));
    if (meta.openMarket && !homePriced && spot > 0 && price > 0 && (price > spot * 10 || price * 10 < spot)) {
      implausible += 1;
      continue;
    }
    /* THE SIZE AGAINST THE COMPANY (the data audit, 2026-10-22): the price check above needs the stock's price, and 130
       rows carry none — UUU's $5,134 "price" on a $16M company read as $93M of buying, SVRE added $13B on a $1.16M
       company. One open-market trade worth more than a quarter of the whole company is not a trade. */
    if (meta.openMarket && !homePriced && cap > 0 && shares * price > cap * MAX_CAP_SHARE) {
      implausible += 1;
      continue;
    }
    /* NOT IN DOLLARS (the fourth audit, 2026-10-23): Takeda's directors filed ordinary-share tax withholdings at 4,931.20 —
       yen — beside the US listing's $20.36, and MARAGANORE JOHN read "$5.68M" for ¥5.68M. A grant, award or withholding
       row of a foreign-priced issuer (see foreignIssuers) whose price is FOREIGN_OFF times the listing's own, open-market rows
       included since round 7, is a home-market price: it stays on the row,
       flagged, and its value is out of every dollar total. */
    const foreign = homePriced;
    const held = Number(r.shares_owned_after) || 0;
    const before = Number(r.shares_owned_before) || 0;
    const plan = r.is_10b5_1 === true ? 'plan' : r.is_10b5_1 === false ? 'discretionary' : 'unknown';
    /* Of the holding this trade was. Prefer the filing's own "before" count.
       A sale's "after" excludes the shares just sold, so the holding it came
       out of is after + shares. A buy's "after" already includes them.
       Unknown when both fields are empty — never 0%, which would read as a
       trade of nothing. */
    /* A BUY is read against the holding it built — the "after" (CRF, 2026-10-22: 484 held, 20,000 bought read as
       4132% of the stake; it is 98% of what they hold now). A SALE against the holding it came out of — the "before". */
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
      company: r.full_name?.trim() || undefined,
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

export const EMPTY_LIVE_CONGRESS = EMPTY_CONGRESS;
