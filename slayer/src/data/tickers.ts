/* The searchable ticker universe: the bundled NASDAQ listings and index ETFs (nasdaqTickers.json), completed with the
   NYSE half of the S&P 500 (sp500.ts). Used by every ticker search. */

import { useSyncExternalStore } from 'react';
import raw from './nasdaqTickers.json';
import { SP500_NYSE } from './sp500';
import { directoryEntry, directoryName, directoryReady, loadDirectory, searchDirectory, subscribeDirectory } from './symbolDirectory';

export interface TickerListing {
  symbol: string;
  name: string;
}

/* a few bundled names carry HTML entities ("McDonald&#39;s"); they are decoded once here */
const ENTITY: Record<string, string> = { '&#39;': "'", '&apos;': "'", '&amp;': '&', '&quot;': '"', '&#34;': '"' };
const plain = (s: string) => s.replace(/&(?:#39|apos|amp|quot|#34);/g, m => ENTITY[m] ?? m);
const NASDAQ_TICKERS = (raw as TickerListing[]).map(t => (/&(?:#\d+|\w+);/.test(t.name) ? { ...t, name: plain(t.name) } : t));

const bySymbol = new Map(NASDAQ_TICKERS.map(t => [t.symbol, t]));
// NYSE S&P members fill the json's gap; the json wins where both know a name.
for (const t of SP500_NYSE) if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, t);

/** Household names first in the dropdown and in search, by prominence; everything else follows
    alphabetically */
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
  SPX: 'S&P 500 Index',
  SPXW: 'S&P 500 Index',
  NDX: 'Nasdaq-100 Index',
  NDXP: 'Nasdaq-100 Index',
  RUT: 'Russell 2000 Index',
  RUTW: 'Russell 2000 Index',
  VIX: 'Cboe Volatility Index',
  VIXW: 'Cboe Volatility Index',
  XSP: 'S&P 500 Mini Index',
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

/* The symbol directory (data/symbolDirectory.ts) is the current name of every listing; the bundled list is the
   name before it loads. A name asked for starts its load, after first paint. */
let directoryAsked = false;
const askDirectory = () => {
  if (directoryAsked) return;
  directoryAsked = true;
  const go = () => void loadDirectory();
  if (typeof window === 'undefined') go();
  else if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback(go, { timeout: 1500 });
  else setTimeout(go, 200);
};

export function tickerName(symbol: string): string {
  const sym = symbol.toUpperCase();
  if (!directoryReady()) askDirectory();
  return directoryName(sym) || bySymbol.get(sym)?.name || FALLBACK_NAMES[sym] || sym;
}

/** Exact symbol first, then symbols that start with it, then names, then the rest — most traded first inside each
    tier (the symbol directory once loaded; the bundled list before). */
export function searchTickers(query: string, limit = 60): TickerListing[] {
  const q = query.trim().toUpperCase();
  if (directoryReady()) return searchDirectory(query, { limit }).map(e => ({ symbol: e.symbol, name: e.name || tickerName(e.symbol) }));
  askDirectory();
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

/* ---- the vendor's own name first ----
   The bundled list is years old, so the Dossier prefers the vendor's name off the stock's info, kept a fortnight here. */
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
/* The vendor writes names in capitals: they are sentence-cased, a short all-caps word (three letters or fewer) staying
   in capitals unless common, and brands keeping their own casing. */
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
  nasdaq: 'Nasdaq', eni: 'Eni', tsmc: 'TSMC', asml: 'ASML', xpeng: 'XPeng', unitedhealth: 'UnitedHealth', ge: 'GE',
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

/* Every name the Dossier prints goes through displayName: marks and share-class lines dropped, the house
   casing, and the legal suffix dropped in the short form. */
const MIXED_FIX: Record<string, string> = { eli: 'Eli', spdr: 'SPDR', 's&p': 'S&P', msci: 'MSCI', ftse: 'FTSE', etf: 'ETF', etfs: 'ETFs', etn: 'ETN', reit: 'REIT', adr: 'ADR', nyse: 'NYSE' };
const NOT_INITIALISM = new Set(['ELI']);
const MARKS_RE = /\s*(?:\((?:r|R|tm|TM)\)|®|™)/g;
const CLASS_LINE_RE = /\s*[-–—]?\s*(?:\b(?:Class|Series) [A-Z]\b\s*)?(?:Common Stock|Ordinary Shares?|Common Shares?|Subordinate Voting Shares|American Depositary Shares?(?:\s.*)?|Sponsored ADRs?|ADRs?|Depositary Shares?(?:\s.*)?)\s*$/i;
const CLASS_TAIL_RE = /\s*[-–—,]?\s*\b(?:Class|Series|Cl) [A-Z]\b\.?\s*$/i;
const LEGAL_TAIL_RE = /(?:\s*,)?\s+(?:(?:&|and)\s+Co(?:mpany)?\.?|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|plc|P\.?L\.?C\.?|N\.\s?V\.?|NV|S\.\s?A\.?|SA|AG|SE|LLC|L\.?P\.?|A\/S|ASA|S\.?p\.?A\.?|Holdings? (?:Inc\.?|Corp\.?|Ltd\.?))\s*$/i;
const FUNDISH = /\b(?:ETF|ETN|Trust|Fund|Portfolio|Index|Shares)\b/i;
const caseWord = (w: string): string => {
  if (!w || /^\s+$/.test(w)) return w;
  const lower = w.toLowerCase();
  const bare = lower.replace(/[,.;:]+$/, '');
  const tail = lower.slice(bare.length);
  if (BRAND_CASE[bare]) return BRAND_CASE[bare] + tail;
  if (MIXED_FIX[bare]) return MIXED_FIX[bare] + tail;
  if (NOT_INITIALISM.has(w.toUpperCase().replace(/[,.;:]+$/, ''))) return bare.charAt(0).toUpperCase() + bare.slice(1) + tail;
  return w;
};
/** The one name the Dossier prints for a company; `legal` keeps "Inc." for a quoted filing */
export function displayName(raw: string | null | undefined, form: 'short' | 'legal' = 'short'): string {
  let n = plain(String(raw ?? '')).replace(MARKS_RE, '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  n = titled(n);
  n = n.split(/(\s+|\/)/).map(caseWord).join('');
  for (let i = 0; i < 3; i++) {
    const was = n;
    n = n.replace(CLASS_LINE_RE, '').replace(CLASS_TAIL_RE, '').trim();
    if (n === was) break;
  }
  if (form === 'short' && !FUNDISH.test(n)) {
    for (let i = 0; i < 3; i++) {
      const was = n;
      n = n.replace(LEGAL_TAIL_RE, '').replace(/[\s,]+$/, '').trim();
      if (n === was || !n) break;
    }
    n = n.replace(/^The (?=\S+\s+\S)/, '');
  }
  return n || plain(String(raw ?? '')).trim();
}

/** A vendor name in capitals, cased the house's way (brands and initialisms kept) */
export const titleCompany = (s: string): string => displayName(s);

/** Remember the vendor's own name for a symbol (the stock's info) */
export function rememberCompanyName(symbol: string, name: string | null | undefined): void {
  const sym = symbol.toUpperCase();
  const n = (name ?? '').trim();
  if (!n || n.toUpperCase() === sym) return;
  const v = titled(n);
  if (uwNames.get(sym) === v) return;
  uwNames.set(sym, v);
  saveNames();
  bumpNames();
}

/** Names another read already carries (the earnings calendar's, a screener row's), kept where the stock's info has none */
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
  bumpNames();
}

const INDEX_NAMES: Record<string, string> = {
  SPX: 'S&P 500',
  SPXW: 'S&P 500 Weeklys',
  NDX: 'Nasdaq 100',
  NDXP: 'Nasdaq 100 Weeklys',
  RUT: 'Russell 2000',
  RUTW: 'Russell 2000 Weeklys',
  VIX: 'CBOE Volatility Index',
  VIXW: 'VIX Weeklys',
  XSP: 'Mini-S&P 500',
  DJX: 'Dow Jones',
  OEX: 'S&P 100',
  XEO: 'S&P 100 European',
  MRUT: 'Mini Russell 2000',
};

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
  const known = INDEX_NAMES[sym];
  const n = uwNames.get(sym) ?? known ?? tickerName(sym);
  if (!n) return sym;
  return n.toUpperCase() === sym ? n : displayName(n);
}
/** The company's name for a header or a tooltip, re-read as names land; '' when only the symbol is known */
export function useCompanyName(symbol: string | null | undefined): string {
  useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  if (!symbol) return '';
  const n = companyName(symbol);
  return n && n.toUpperCase() !== symbol.toUpperCase() ? n : '';
}
/** "NVDA · NVIDIA" — a symbol with its name when one is known */
export const symbolWithName = (symbol: string): string => {
  const n = companyName(symbol);
  return n && n.toUpperCase() !== symbol.toUpperCase() ? `${symbol} · ${n}` : symbol;
};
/** The legal form of the company's name — for a line that quotes the filing */

/** True when the symbol is on the bundled listing — a name off it (an OTC symbol on a filing) is not asked of the vendor */
export const isListed = (symbol: string): boolean => bySymbol.has(symbol.toUpperCase()) || !!directoryEntry(symbol);

/** True when the vendor's own name for the symbol is known */
export const hasVendorName = (symbol: string): boolean => uwNames.has(symbol.toUpperCase());

export function subscribeCompanyNames(fn: () => void): () => void {
  nameListeners.add(fn);
  return () => nameListeners.delete(fn);
}

const nameAsked = new Set<string>();
const nameQueue: string[] = [];
const nameOut = new Set<string>();
let nameBusy = 0;
/** True while the symbol's name is queued or being read */
export const companyNamePending = (symbol: string): boolean => nameOut.has(symbol.toUpperCase());
let namesRev = 0;
/** Bumps when a company name is remembered or an ask finishes. Search menus subscribe to this. */
export const companyNamesRev = (): number => namesRev;
const bumpNames = () => {
  namesRev += 1;
  nameListeners.forEach(fn => fn());
};
/* the directory landing names every row at once */
subscribeDirectory(bumpNames);
function pumpCompanyNames(): void {
  while (nameBusy < 3 && nameQueue.length) {
    const sym = nameQueue.shift()!;
    nameBusy += 1;
    void import('./whales')
      .then(m => m.whalesStock(sym))
      .then(info => {
        const row = info && typeof info === 'object' ? (info as { full_name?: string; short_name?: string }) : null;
        const full = row ? String(row.full_name || row.short_name || '') : '';
        if (full) rememberCompanyName(sym, full);
      })
      .catch(() => {
        nameAsked.delete(sym);
      })
      .finally(() => {
        nameBusy -= 1;
        nameOut.delete(sym);
        bumpNames();
        pumpCompanyNames();
      });
  }
}
/** Ask /stock/{symbol}/info for names the listing does not have. The screener's full_name comes back empty. The
    directory names nearly every listing, so the vendor is asked only once it has loaded and still lacks the name. */
export function askCompanyNames(symbols: readonly string[]): void {
  if (!directoryReady()) {
    const held = [...symbols];
    void loadDirectory().then(() => {
      if (directoryReady()) askCompanyNames(held);
    });
    return;
  }
  for (const raw of symbols) {
    const sym = raw.toUpperCase();
    if (!/^[A-Z0-9.]{1,6}$/.test(sym) || nameAsked.has(sym) || hasVendorName(sym) || INDEX_NAMES[sym]) continue;
    if (tickerName(sym).toUpperCase() !== sym) continue;
    nameAsked.add(sym);
    nameOut.add(sym);
    nameQueue.push(sym);
  }
  pumpCompanyNames();
}

/* An untagged headline's company, by the listing's name without its legal form; a name that is also plain
   English (Target, Visa, General) never matches alone. */
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

/* ---- people in the vendor's capitals ----
   Form 4 names come surname first in capitals and are printed as said; an entity takes the company casing. */
const ENTITY_WORD = /\b(?:LLC|L\.?L\.?C|LP|L\.P|LTD|INC|CORP|CORPORATION|COMPANY|CO|FUND|FUNDS|TRUST|PARTNERS|PARTNERSHIP|CAPITAL|HOLDINGS?|GROUP|MANAGEMENT|ADVISORS?|INVESTMENTS?|ASSOCIATES|FOUNDATION|BANK|PLC|SA|AG|NV|LIMITED|VENTURES|ESTATE|MASTER|OPPORTUNIT(?:Y|IES)|STRATEGIES|EQUITY|LLP)\b\.?/i;
const NAME_SUFFIX = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'MD', 'PHD', 'ESQ']);
const SURNAME_PARTICLE = new Set(['ST', 'VAN', 'VON', 'DE', 'DEL', 'DELLA', 'DA', 'DI', 'LA', 'LE', 'DU', 'MAC', 'MC', 'O', 'DOS', 'DAS', 'TEN', 'TER']);
const casePersonWord = (w: string): string => {
  if (!w) return w;
  const bare = w.replace(/[.,]+$/, '');
  const tail = w.slice(bare.length);
  const up = bare.toUpperCase();
  if (NAME_SUFFIX.has(up)) return (up === 'JR' || up === 'SR' ? up.charAt(0) + up.slice(1).toLowerCase() + '.' : up) + (tail === '.' ? '' : tail);
  if (up.length === 1) return up + tail;
  const one = (part: string) => {
    const lower = part.toLowerCase();
    if (/^mc[a-z]{2,}/.test(lower)) return 'Mc' + lower.charAt(2).toUpperCase() + lower.slice(3);
    if (/^o'[a-z]/.test(lower)) return "O'" + lower.charAt(2).toUpperCase() + lower.slice(3);
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return bare.split('-').map(one).join('-') + tail;
};
/** A person or a filer as printed: "COHEN RYAN" → "Ryan Cohen"; an entity cased as a company; mixed case kept */
export function personDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;
  if (ENTITY_WORD.test(s)) return displayName(s, 'legal');
  /* "LAST, FIRST MIDDLE" or "LAST FIRST MIDDLE [SUFFIX]" */
  const comma = s.indexOf(',');
  let last: string[];
  let rest: string[];
  if (comma > 0) {
    last = s.slice(0, comma).trim().split(' ');
    rest = s.slice(comma + 1).trim().split(' ').filter(Boolean);
  } else {
    const words = s.split(' ');
    if (words.length < 2) return casePersonWord(s);
    let k = 1;
    while (k < words.length - 1 && SURNAME_PARTICLE.has(words[k - 1].toUpperCase().replace(/\.$/, ''))) k += 1;
    last = words.slice(0, k);
    rest = words.slice(k);
  }
  const suffix = rest.filter(w => NAME_SUFFIX.has(w.toUpperCase().replace(/[.,]$/, '')));
  const lastSuffix = last.filter(w => NAME_SUFFIX.has(w.toUpperCase().replace(/[.,]$/, '')));
  const given = rest.filter(w => !suffix.includes(w));
  const surname = last.filter(w => !lastSuffix.includes(w));
  return [...given, ...surname, ...lastSuffix, ...suffix].map(casePersonWord).join(' ');
}
/** A place in the vendor's capitals ("UNITED STATES") as a reader writes it ("United States") */
export function placeDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s !== s.toUpperCase()) return s;
  const small = new Set(['of', 'and', 'the', 'da', 'de', 'la']);
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-')))
    .join(' ')
    .replace(/\bUsa\b/, 'USA')
    .replace(/\bUk\b/, 'UK');
}
