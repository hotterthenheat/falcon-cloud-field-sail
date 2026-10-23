/*
  The searchable ticker universe: NASDAQ listings + common index ETFs bundled
  from nasdaqTickers.json (6,300+ symbols), completed with the NYSE-listed
  half of the S&P 500 from sp500.ts — the json alone couldn't find JPM, XOM,
  UNH or V (Noah, 2026-08-18). Used by every ticker search menu.
*/

import raw from './nasdaqTickers.json';
import { SP500_NYSE } from './sp500';

export interface TickerListing {
  symbol: string;
  name: string;
}

/* The json carries a few names with HTML entities in them ("McDonald&#39;s
   Corporation" printed as such on the Insiders grid, the partner's review
   2026-09-13) — read once, they are plain words from here on. */
const ENTITY: Record<string, string> = { '&#39;': "'", '&apos;': "'", '&amp;': '&', '&quot;': '"', '&#34;': '"' };
const plain = (s: string) => s.replace(/&(?:#39|apos|amp|quot|#34);/g, m => ENTITY[m] ?? m);
export const NASDAQ_TICKERS = (raw as TickerListing[]).map(t => (/&(?:#\d+|\w+);/.test(t.name) ? { ...t, name: plain(t.name) } : t));

const bySymbol = new Map(NASDAQ_TICKERS.map(t => [t.symbol, t]));
// NYSE S&P members fill the json's gap; the json wins where both know a name.
for (const t of SP500_NYSE) if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, t);

/** Household names pinned to the top of the dropdown and ranked first in
    search — ordered by prominence, not alphabet. Everything else follows
    alphabetically, so the resting list is never a wall of "A" names. */
const FEATURED = [
  'SPY', 'QQQ', 'IWM', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL',
  'AMD', 'NFLX', 'AVGO', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'HOOD', 'MU', 'TSM',
  'INTC', 'ORCL', 'CRM', 'COST', 'ADBE', 'QCOM', 'SOFI',
];

// The bundled json predates a few of these listings — name them ourselves.
const FALLBACK_NAMES: Record<string, string> = {
  META: 'Meta Platforms, Inc.',
  PLTR: 'Palantir Technologies Inc.',
  COIN: 'Coinbase Global, Inc.',
  SMCI: 'Super Micro Computer, Inc.',
  HOOD: 'Robinhood Markets, Inc.',
  SOFI: 'SoFi Technologies, Inc.',
};

const featuredRank = new Map(FEATURED.map((s, i) => [s, i]));
const FEATURED_LISTINGS: TickerListing[] = FEATURED.map(
  s => bySymbol.get(s) ?? { symbol: s, name: FALLBACK_NAMES[s] ?? s }
);

/** Iteration order for the menu and for search: famous first, then the rest
    alphabetically (the NYSE merge would otherwise append after the Z's). */
const UNIVERSE: TickerListing[] = [
  ...FEATURED_LISTINGS,
  ...[...bySymbol.values()]
    .filter(t => !featuredRank.has(t.symbol))
    .sort((a, b) => a.symbol.localeCompare(b.symbol)),
];

export function tickerName(symbol: string): string {
  const sym = symbol.toUpperCase();
  return bySymbol.get(sym)?.name ?? FALLBACK_NAMES[sym] ?? sym;
}

/** Prefix matches first (by symbol), then symbol/name substring matches.
    Featured names outrank the alphabet inside each tier. */
export function searchTickers(query: string, limit = 60): TickerListing[] {
  const q = query.trim().toUpperCase();
  if (!q) return UNIVERSE.slice(0, limit);

  const prefix: TickerListing[] = [];
  const contains: TickerListing[] = [];
  for (const t of UNIVERSE) {
    if (t.symbol.startsWith(q)) prefix.push(t);
    else if (t.symbol.includes(q) || t.name.toUpperCase().includes(q)) contains.push(t);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}

/* ---- THE VENDOR'S OWN NAME FIRST (the re-audit, 2026-10-22) -------------------------------------------------------
   The bundled json is years old: SERV read "ServiceMaster" (it is Serve Robotics), SG, AI and FUN are other companies
   now. The Dossier prefers the name Unusual Whales gives on the stock's own info and falls back to the json only when
   the vendor has none. Names are remembered in this browser for a fortnight (a per-viewer convenience — every read
   still works without it). `tickerName` itself is unchanged for the rest of the terminal. */
const UW_NAMES_KEY = 'slayer.uwNames.v1';
const UW_NAMES_TTL = 14 * 86_400_000;
const uwNames = new Map<string, string>();
const nameListeners = new Set<() => void>();
try {
  const raw0 = typeof localStorage !== 'undefined' ? localStorage.getItem(UW_NAMES_KEY) : null;
  const parsed = raw0 ? (JSON.parse(raw0) as { at: number; names: Record<string, string> }) : null;
  if (parsed && Date.now() - parsed.at < UW_NAMES_TTL) for (const [k, v] of Object.entries(parsed.names ?? {})) uwNames.set(k, v);
} catch {
  /* no storage: names are read again this visit */
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const saveNames = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(UW_NAMES_KEY, JSON.stringify({ at: Date.now(), names: Object.fromEntries(uwNames) }));
    } catch {
      /* storage refused — fine */
    }
  }, 800);
};
/* the vendor writes names in capitals ("SERVE ROBOTICS INC"): sentence them, keeping short capital words that are names.
   ROUND 9: "Cme Group", "Gamestop", "Jpmorgan Chase", "Bny Mellon", "Ishares", "Spdr", "Msci", "Ftse", "Pc Connection" —
   a short all-caps word (three letters or fewer) stays in capitals unless it is a common word, and the brands that are
   not written in plain title case keep their own casing. */
const KEEP_UPPER = new Set(['AG', 'SA', 'NV', 'SE', 'LP', 'LLC', 'PLC', 'ETF', 'ETN', 'ETFS', 'REIT', 'II', 'III', 'IV', 'US', 'USA', 'UK', 'AI', 'NYSE', 'SPDR', 'MSCI', 'FTSE', 'S&P', 'ADR', 'ADS', 'NA', 'BDC', 'ESG', 'NASDAQ']);
const COMMON_SHORT = new Set(['of', 'the', 'and', 'for', 'inc', 'co', 'new', 'one', 'two', 'all', 'big', 'top', 'de', 'la', 'del', 'du', 'des', 'le', 'el', 'in', 'on', 'at', 'by', 'to', 'an', 'a', 'or', 'ltd', 'bio', 'gas', 'oil', 'air', 'sun', 'art', 'car', 'bay', 'sea', 'box', 'key', 'red', 'pet', 'go', 'gap', 'tex', 'its', 'net', 'web', 'lab', 'max', 'pro', 'fit', 'far', 'day', 'way', 'man', 'son', 'sons', 'old', 'hub', 'cap', 'mid', 'low', 'high', 'fund', 'tr', 'cl', 'cos', 'ord', 'shs', 'adj', 'sr', 'jr', 'st', 'ave', 'la', 'van', 'von', 'den', 'der', 'und', 'et', 'y', 'e', 'i', 'o', 'up', 'out', 'my', 'we', 'us']);
const BRAND_CASE: Record<string, string> = {
  gamestop: 'GameStop', jpmorgan: 'JPMorgan', ishares: 'iShares', ipath: 'iPath', proshares: 'ProShares', vaneck: 'VanEck', wisdomtree: 'WisdomTree',
  blackrock: 'BlackRock', paypal: 'PayPal', ebay: 'eBay', youtube: 'YouTube', linkedin: 'LinkedIn', fedex: 'FedEx', exxonmobil: 'ExxonMobil',
  "mcdonald's": "McDonald's", mcdonalds: "McDonald's", mckesson: 'McKesson', mccormick: 'McCormick', abbvie: 'AbbVie', nvidia: 'NVIDIA', jetblue: 'JetBlue',
  hubspot: 'HubSpot', doordash: 'DoorDash', coreweave: 'CoreWeave', applovin: 'AppLovin', crowdstrike: 'CrowdStrike', servicenow: 'ServiceNow',
  datadog: 'Datadog', moneylion: 'MoneyLion', sofi: 'SoFi', robinhood: 'Robinhood', ipg: 'IPG', directv: 'DirecTV', duPont: 'DuPont', dupont: 'DuPont',
  'at&t': 'AT&T', 'p&g': 'P&G', 'h&r': 'H&R', 'l3harris': 'L3Harris', 'iheartmedia': 'iHeartMedia', 'irobot': 'iRobot', 'iqiyi': 'iQIYI', 'nextera': 'NextEra',
  'globalfoundries': 'GlobalFoundries', 'marketaxess': 'MarketAxess', 'firstenergy': 'FirstEnergy', 'centerpoint': 'CenterPoint', 'novocure': 'NovoCure',
  nasdaq: 'Nasdaq',
};
const CONNECTORS = new Set(['of', 'and', 'the', 'for', 'de', 'la', 'du', 'des', 'del', 'et', 'und', 'on', 'in', 'at', 'by', 'to']);
const casedWord = (w: string): string => {
  const lower = w.toLowerCase();
  if (BRAND_CASE[lower]) return BRAND_CASE[lower];
  if (KEEP_UPPER.has(w.toUpperCase()) && w.length <= 6) return w.toUpperCase();
  /* a short all-caps word is an initialism (CME, BNY, PC, IBM) unless it is a common word */
  const letters = w.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 2 && letters.length <= 3 && !COMMON_SHORT.has(lower.replace(/[^a-z]/g, '')) && /^[A-Za-z&.]+$/.test(w)) return w.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};
const titled = (s: string): string =>
  s === s.toUpperCase() && /[A-Z]{3}/.test(s)
    ? s
        .split(/(\s+|-|\/)/)
        .map((w, i) => (/^(\s+|-|\/)$/.test(w) || !w ? w : i > 0 && CONNECTORS.has(w.toLowerCase()) ? w.toLowerCase() : casedWord(w)))
        .join('')
        .replace(/\bInc\b\.?/g, 'Inc.')
        .replace(/\bCorp\b\.?/g, 'Corp.')
        .replace(/\bCo\b\.?(?=\s|$)/g, 'Co.')
    : s;

/** A vendor name in capitals, cased the house's way (brands and initialisms kept) */
export const titleCompany = (s: string): string => titled(s);

/** Remember the vendor's own name for a symbol (the stock's info) */
export function rememberCompanyName(symbol: string, name: string | null | undefined): void {
  const sym = symbol.toUpperCase();
  const n = (name ?? '').trim();
  if (!n || n.toUpperCase() === sym) return;
  const v = titled(n);
  if (uwNames.get(sym) === v) return;
  uwNames.set(sym, v);
  saveNames();
  nameListeners.forEach(fn => fn());
}

/** Names another vendor read already carries (the earnings calendar's, a screener row's) — kept only where the stock's own
    info has not given one, so a name cell need not ask for it (round 9: the Insiders page asked /info per ticker) */
export function rememberCompanyNames(pairs: readonly (readonly [string, string | null | undefined])[]): void {
  let changed = false;
  for (const [symbol, name] of pairs) {
    const sym = symbol.toUpperCase();
    const n = (name ?? '').trim();
    if (!sym || !n || n.toUpperCase() === sym || uwNames.has(sym)) continue;
    uwNames.set(sym, titled(n));
    changed = true;
  }
  if (!changed) return;
  saveNames();
  nameListeners.forEach(fn => fn());
}

/** The vendor's name if known, then the bundled listing's, then the symbol */
/* names remembered by an earlier visit were cased by the old rule ("Cme Group") — re-cased once, from their capitals */
let recased = false;
const recaseStored = () => {
  if (recased) return;
  recased = true;
  for (const [k, v] of uwNames) uwNames.set(k, titled(v.toUpperCase()));
};
export function companyName(symbol: string): string {
  recaseStored();
  const sym = symbol.toUpperCase();
  return uwNames.get(sym) ?? tickerName(sym);
}

/** True when the symbol is on the bundled listing — a name off it (an OTC symbol on a filing) is not asked of the vendor */
export const isListed = (symbol: string): boolean => bySymbol.has(symbol.toUpperCase());

/** True when the vendor's own name for the symbol is known */
export const hasVendorName = (symbol: string): boolean => uwNames.has(symbol.toUpperCase());

export function subscribeCompanyNames(fn: () => void): () => void {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

/* ---- A COMPANY NAMED IN A HEADLINE (the re-audit, 2026-10-22) -----------------------------------------------------
   The wire leaves many company stories untagged ("COCA-COLA SAYS DENTSU CONTINUES…", "Medpace Slumps On Solid Report").
   A headline's company is found by the listing's own name with its legal form taken off ("The Coca-Cola Company" →
   Coca-Cola), written as the listing writes it or in capitals. A name that is also plain English (Target, Visa, Square,
   General, Energy…) is never matched alone — a missing tag costs less than a story filed under the wrong company. */
const LEGAL = /(?<![\w-])(?:the|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|llc|lp|l\.p|plc|sa|s\.a|nv|n\.v|ag|se|holdings?|group|class [a-c]|common stock|ordinary shares|ads|adr|american depositary shares?|depositary shares?|units?|warrants?|rights?)(?![\w-])\.?/gi;
const PLAIN_WORDS = new Set(
  'target visa square general energy western eastern southern northern american national united global international first second new great capital financial digital mobile express charter pioneer liberty progressive sterling fortune reliance summit frontier heritage pinnacle premier insight quantum vertex nexus alliance atlantic pacific century patriot universal trinity phoenix genesis matrix vector spectrum horizon compass anchor beacon bridge element evolution fusion galaxy impact legacy momentum origin paragon precision signal spirit sunrise titan unity venture vista zenith marathon discovery dynamic strategic emerald diamond crystal golden silver harmony gaming energy power solar water health care medical services systems solutions technologies technology industries resources partners trust bank bancorp financial insurance realty properties investment investors security securities brands foods motors airlines communications networks software therapeutics pharmaceuticals biosciences sciences acquisition opportunity growth income value select advisors management market markets stock stocks shares index fund funds street wall today report earnings results quarter outlook guidance price prices target rating ratings deal deals merger sale sales news daily weekly online direct plus prime smart open clear simple best better central standard royal crown eagle falcon lion tiger bear bull apex core edge peak point line link path wave flow form base cloud data info life live home house world earth ocean river lake forest mountain valley island harbor coast north south east west carbon green blue black white orange purple gold iron steel copper oil gas mining metals chemical chemicals materials equipment products services entertainment media sports games travel hotels restaurants retail stores nasdaq nyse dow amex cboe s&p russell institutions enterprises associates logistics analytics labs innovations devices instruments robotics semiconductors diagnostics biotech bio pharma therapeutics hospitality residential commercial industrial infrastructure aerospace defense automotive transport transportation shipping marine air space'
    .split(' '),
);
let nameIndex: Map<string, { words: string[]; ticker: string }[]> | null = null;
const coreOf = (name: string): string[] =>
  name
    .replace(/&#?\w+;/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(LEGAL, ' ')
    .replace(/[,.]+(?=\s|$)/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&-]+$/g, ''))
    .filter(Boolean);
function buildNameIndex(): Map<string, { words: string[]; ticker: string }[]> {
  if (nameIndex) return nameIndex;
  const idx = new Map<string, { words: string[]; ticker: string }[]>();
  const seenCore = new Map<string, string>();
  for (const t of bySymbol.values()) {
    if (!/^[A-Z]{1,5}$/.test(t.symbol)) continue;
    const name = uwNames.get(t.symbol) ?? t.name;
    const words = coreOf(name);
    if (!words.length || words.length > 4) continue;
    const plain = words.every(w => PLAIN_WORDS.has(w.toLowerCase()) || w.length < 3);
    if (plain) continue;
    if (words.length === 1) {
      const w = words[0];
      const marked = /[a-z][A-Z]|-|&|\d/.test(w);
      if (!marked && (w.length < 6 || w === w.toUpperCase())) continue;
    }
    const key = words.join(' ').toLowerCase();
    /* one company per name: a warrant or a second class shares its name — the shortest symbol stands */
    const had = seenCore.get(key);
    if (had && had.length <= t.symbol.length) continue;
    seenCore.set(key, t.symbol);
    const first = words[0].toLowerCase();
    const list = (idx.get(first) ?? []).filter(e => e.words.join(' ').toLowerCase() !== key);
    list.push({ words, ticker: t.symbol });
    idx.set(first, list);
  }
  nameIndex = idx;
  return idx;
}

/** The listed companies a headline names by their own name, in the order they appear (at most four) */
export function companiesInHeadline(headline: string): string[] {
  const idx = buildNameIndex();
  const caps = headline === headline.toUpperCase();
  const toks = headline.split(/\s+/).map(w => w.replace(/^[^A-Za-z0-9&]+|(?:'s|’s)?[^A-Za-z0-9&-]*$/g, ''));
  const out: string[] = [];
  for (let i = 0; i < toks.length && out.length < 4; i++) {
    const cands = idx.get(toks[i].toLowerCase());
    if (!cands) continue;
    let best: { words: string[]; ticker: string } | null = null;
    for (const c of cands) {
      if (i + c.words.length > toks.length) continue;
      const ok = c.words.every((w, k) => (caps ? toks[i + k] === w.toUpperCase() : toks[i + k] === w || (w === w.toLowerCase() && toks[i + k].toLowerCase() === w)));
      if (ok && (!best || c.words.length > best.words.length)) best = c;
    }
    if (best && !out.includes(best.ticker)) {
      out.push(best.ticker);
      i += best.words.length - 1;
    }
  }
  return out;
}
