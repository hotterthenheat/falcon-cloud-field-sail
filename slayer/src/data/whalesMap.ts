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
import { tickerName } from './tickers';
import { daysBetween, nyDayOf, nyDaysAgo } from './nyDate';

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
const ANALYST_RE = /\bupgrades?\b|\bupgraded\b|\bdowngrades?\b|\bdowngraded\b|price target|\bpt\b(?= (?:to|raised|cut|lowered))|\b(?:initiates?|initiated|resumes?|starts?) coverage|\banalysts? (?:say|says|see|expect|rate|raise|cut)|\b(?:overweight|underweight|outperform|underperform|buy rating|sell rating|neutral rating)\b/i;
const MA_RE = /\bacqui(?:re|res|red|ring|sition)s?\b|\bmerger\b|\bmerge\b|\bbuyout\b|\btakeover\b|\btender offer\b|\bto buy\b[^.;]{0,30}\bfor \$|\b(?:agrees?|agreed|deal) to (?:buy|sell|acquire|merge)\b|\bspin[- ]?off\b|\bdivest/i;
const REG_RE = /\bsec\b|\bregulat|\bantitrust\b|\bdoj\b|\bftc\b|\bfda\b|\bprobe\b|\binvestigat|\blawsuit|\bclass action\b|\blitigation\b|\bsues?\b|\bsued\b|\bcourt\b|\bjudge\b|\bsettle(?:s|d|ment)\b|\bfined?\b|\bpenalt/i;
const MACRO_RE =
  /\$MACRO\b|\bfed\b|\bfomc\b|\bpowell\b|\bcpi\b|\bppi\b|\bpce\b|inflation|\bpayrolls?\b|jobs report|jobless claims|unemployment|\bgdp\b|recession|central bank|\becb\b|\bboj\b|\bboe\b|\bpboc\b|\brate (?:cut|hike)s?\b|interest rates?|treasury yields?|bond yields?|\byields? (?:rise|fall|jump|climb|slide)|\btariffs?\b|trade war|\bcrude\b|\bbrent\b|\boil (?:prices?|surpasses|tops|jumps|falls|rises|slides)|\bopec\b|the dollar\b|consumer confidence|consumer sentiment|\bpmi\b|retail sales|housing starts|home sales|\beconom(?:y|ic|ies)\b|government shutdown|\bdeficit\b|\bchancellor\b|\btreasury secretary\b|\bs&p 500\b|\bnasdaq composite\b|\bdow jones\b|\bwall street\b|global markets|\b(?<!'s )stocks (?:tumble|rally|fall|rise|slide|surge|drop|climb|sink|slump)/i;

const categoryOf = (headline: string, tags: string[] | undefined, hasTicker: boolean): NewsCategory => {
  const s = `${headline} ${(tags ?? []).join(' ')}`;
  if (/\$MACRO\b/i.test(s)) return 'Macro';
  if (GUIDANCE_RE.test(s)) return 'Guidance';
  if (EARNINGS_RE.test(s)) return 'Earnings';
  if (ANALYST_RE.test(s)) return 'Analyst';
  if (MA_RE.test(s)) return 'M&A';
  if (REG_RE.test(s)) return 'Regulatory';
  /* the economy, a central bank, prices or the whole market — and only when no company is the subject */
  if (MACRO_RE.test(s) && !hasTicker) return 'Macro';
  if (MACRO_RE.test(s) && /\b(?:fed|fomc|cpi|ppi|pce|gdp|payrolls?|ecb|boj|tariffs?)\b/i.test(s)) return 'Macro';
  return 'Product';
};

const sessionMove = (meta: UwNews['meta'], ticker: string | null): number | null => {
  if (!ticker || !meta) return null;
  const node = meta[ticker];
  const curr = Number(node?.curr?.c);
  const prev = Number(node?.prev?.c);
  if (!(curr > 0) || !(prev > 0)) return null;
  return Number((((curr - prev) / prev) * 100).toFixed(2));
};

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
/* A WIRE TAG MUST BE BORNE OUT BY ITS HEADLINE: the vendor tags by bare word — "AI", "Gold" (Barrick), "Bond",
   "CPI", "FUTURE" (FutureFuel), "Tesla Eyes" (Second Sight). A tag stands when the headline writes it as a symbol
   ($T, (T), NASDAQ: T) or names the company by its distinctive word; otherwise it is dropped — a missing tag costs
   less than a story filed under the wrong company. */
const GENERIC = new Set(['first', 'second', 'general', 'united', 'american', 'national', 'global', 'international', 'international', 'new', 'the', 'great', 'western', 'eastern', 'southern', 'northern', 'capital', 'financial']);
function borneOut(t: string, headline: string): boolean {
  const T = esc(t);
  if (new RegExp(`\\$${T}\\b|\\(${T}\\)|\\b(?:NASDAQ|NYSE|AMEX|OTC)\\s*:\\s*${T}\\b`, 'i').test(headline)) return true;
  const name = tickerName(t);
  if (!name || name.toUpperCase() === t) return false;
  const core = (name.split(/[\s,]+/)[0] ?? '').replace(/[^A-Za-z0-9.&-]/g, '');
  if (core.length < 4 || GENERIC.has(core.toLowerCase())) return false;
  return new RegExp(`\\b${esc(core)}\\b`, 'i').test(headline);
}
function storyTickers(headline: string, tags: readonly string[] | undefined): string[] {
  if (/\$MACRO\b/i.test(headline)) return [];
  const tagged = [...new Set((tags ?? []).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z][A-Z0-9.]{0,5}$/.test(t)))].filter(t => borneOut(t, headline));
  if (tagged.length) return tagged;
  const named = COMPANY_RE.find(c => c.re.test(headline));
  return named ? [named.ticker] : [];
}

export function newsFromWhales(rows: UwNews[]): NewsItem[] {
  return rows.map((r) => {
    const headline = decodeEntities(r.headline || '');
    const at = Date.parse(r.created_at);
    const sent = sentimentOf(r.sentiment);
    const major = !!r.is_major;
    const tickers = storyTickers(headline, r.tickers);
    const ticker = tickers[0] ?? null;
    const moved = sessionMove(r.meta, ticker);
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
      headline,
      body: [`Reported by ${r.source || 'the wire'}.`],
      category: categoryOf(headline, r.tags, !!ticker),
      sentiment: sent,
      magnitude: major ? 0.8 : 0.45,
      major,
      prediction: {
        probUpPct: 50,
        expMove1dPct: move,
        expMove5dPct: move,
        confidencePct: moved != null ? 58 : 0,
        analog: moved != null ? 'The figure is the session so far. Not a forecast.' : '',
        playbook: moved != null ? 'The figure is how the name has traded today. Not a forecast, and not a trade on its own.' : '',
        measured: moved != null,
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

const impactOf = (title: string): EconEvent['impact'] =>
  /cpi|nfp|nonfarm|payroll|fomc|\bfed\b|\bgdp\b|\bpce\b|interest rate/i.test(title) ? 'high' : /pmi|claims|sentiment|confidence|survey|retail sales|housing/i.test(title) ? 'medium' : 'low';

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
    out.push({
      id: `econ-${at}-${r.event}`,
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
  if (code && first.length > 1 && !/^(purchase|sale|sell|exchange|buy)/.test(first)) return code === 'p' ? 'Purchase' : code === 'e' ? 'Exchange' : 'Sale (Full)';
  if (first.length === 1 && code) return code === 'p' ? 'Purchase' : code === 'e' ? 'Exchange' : 'Sale (Full)';
  if (s.includes('exchange')) return 'Exchange';
  if (s.includes('purchase') || /\bbuy\b/.test(s)) return 'Purchase';
  if (s.includes('partial')) return 'Sale (Partial)';
  if (s.includes('sale') || s.includes('sell')) return 'Sale (Full)';
  return null;
};

const ownerOf = (notes?: string, issuer?: string): ReportOwner => {
  const s = `${notes || ''} ${issuer || ''}`.toLowerCase();
  if (s.includes('dependent') || s.includes('child')) return 'Dependent';
  if (s.includes('spouse')) return 'Spouse';
  if (/\bjoint\b/.test(s)) return 'Joint';
  return 'Self';
};

const bracketOf = (amounts: unknown): number | null => {
  const s = typeof amounts === 'string' ? amounts : Array.isArray(amounts) ? amounts.map(String).join(' ') : amounts && typeof amounts === 'object' ? JSON.stringify(amounts) : '';
  if (!s) return null;
  const nums = [...s.matchAll(/\$?\s*([0-9][0-9,]*)/g)].map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 0);
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

const OWNER_WORD = /^(joint|spouse|self|undisclosed|not-disclosed|n\/a)$/i;

/** The filing's notes are the asset when the issuer column is an owner word or "undisclosed". */
/* A treasury filed as a bare maturity (", , 13-WEEK, MATURESP10/12/2023 - 01/11/2024", "8-WEEK, MATURES 8/29/23")
   reads as the bill it is: "Treasury Bill (13-Week, matures 01/11/2024)" */
const maturity = (raw: string): string => {
  const s = raw.replace(/^[\s,;]+/, '').trim();
  if (!/\bMATURES?P?\b|MATURESP/i.test(s)) return '';
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

const assetKindOf = (notes?: string, issuer?: string): AssetKind => {
  const s = `${notes || ''} ${issuer || ''}`;
  if (/\btreasury\b|MATURESP|\bMATURES\b/i.test(s)) return 'Other';
  if (/\b(call|put)\b|\boptions?\b/i.test(s) && !/common stock/i.test(s)) return 'Stock Option';
  if (/corporate bond|\bnote due\b|\bbond\b/i.test(s)) return 'Corporate Bond';
  if (/municipal/i.test(s)) return 'Municipal Security';
  if (/\betf\b|\bmutual fund\b/i.test(s)) return 'Fund';
  if (/crypto|bitcoin|ethereum/i.test(s)) return 'Crypto';
  return 'Stock';
};

export function congressFromWhales(rows: UwCongress[], people: UwPolitician[] = [], windowDays = 10000): CongressFeed {
  const roster = new Map(people.map(p => [p.politician_id, p]));
  const trades: CongressTrade[] = [];
  /* the vendor repeats some reports word for word (Sen. Boozman's 10/21 filings came back twice each) — a report that
     matches one already read, filing day included, is the same report and is read once */
  const seen = new Set<string>();
  let unread = 0;
  for (const r of rows) {
    /* the vendor's congress feed also carries executive-branch filers (the President's OGE reports, most of them
       filed past 45 days) — this is the Congress page, so only House and Senate members are read */
    if (r.member_type && !/house|senate/i.test(r.member_type)) continue;
    const traded = daysAgo(r.transaction_date);
    if (traded > windowDays) continue;
    const filed = daysAgo(r.filed_at_date);
    const tradedDay = nyDayOf(r.transaction_date);
    const filedDay = nyDayOf(r.filed_at_date);
    const lag = tradedDay && filedDay ? daysBetween(tradedDay, filedDay) : filed - traded;
    const who = r.politician_id ? roster.get(r.politician_id) : undefined;
    const chamber = chamberOf(who?.chamber || r.member_type);
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
    const id = `${member.id}-${r.ticker}-${r.transaction_date}-${r.txn_type}-${r.amounts ?? ''}-${r.filed_at_date ?? ''}-${(r.notes ?? '').slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    trades.push({
      /* the notes join the id: two unnamed treasury bills bought the same day were one row id (duplicate grid rows) */
      id,
      member,
      ticker: r.ticker && !NO_NAME.test(r.ticker.trim()) && !maturity(r.ticker) ? r.ticker : '',
      assetDescription: namedAsset(r.issuer, r.ticker, r.notes),
      assetKind: assetKindOf(r.notes, r.issuer),
      type,
      owner: ownerOf(r.notes, r.issuer),
      bracket: bracketOf(r.amounts),
      lagDays: lag,
      tradedDaysAgo: traded,
      filedDaysAgo: filed,
      late: lag > 45,
      committeeOverlap: null,
      tradedOn: tradedDay ?? undefined,
      filedOn: filedDay ?? undefined,
    });
  }
  return { ...rollCongress(trades, windowDays), unreadTypes: unread };
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
      totalLow += b.low;
      if (totalHigh !== null) totalHigh = b.high == null ? null : totalHigh + b.high;
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
  if (/\bceo\b|chief executive/.test(t)) return 'CEO';
  if (/\bcfo\b|chief financial/.test(t)) return 'CFO';
  if (/\bcoo\b|chief operating/.test(t)) return 'COO';
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

type UwInsiderRow = { amount?: number; filing_date?: string; formtype?: string | null; is_10b5_1?: boolean | null; is_director?: boolean; is_officer?: boolean; is_ten_percent_owner?: boolean; officer_title?: string | null; owner_name?: string; price?: string | number | null; shares_owned_after?: number | null; shares_owned_before?: number | null; stock_price?: string | number | null; ticker?: string; transaction_code?: string; transaction_date?: string; id?: string; security_title?: string | null; marketcap?: string | number | null; sector?: string | null; reporter_cik?: string | null; full_name?: string | null };

/** What the insider feed read: the rows, and how many it set aside and why — counted, never silent */
export interface InsiderRead {
  trades: InsiderTrade[];
  /** Open-market rows that were swaps, preferreds or other non-share securities */
  notShares: number;
  /** Rows whose filed price or size cannot be a trade (ten times the stock's price, or past a quarter of the company) */
  implausible: number;
}

export function insidersFromWhales(rows: UwInsiderRow[]): InsiderTrade[] {
  return readInsiders(rows).trades;
}

export function readInsiders(rows: UwInsiderRow[]): InsiderRead {
  const out: InsiderTrade[] = [];
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
    if (meta.openMarket && spot > 0 && price > 0 && (price > spot * 10 || price * 10 < spot)) {
      implausible += 1;
      continue;
    }
    /* THE SIZE AGAINST THE COMPANY (the data audit, 2026-10-22): the price check above needs the stock's price, and 130
       rows carry none — UUU's $5,134 "price" on a $16M company read as $93M of buying, SVRE added $13B on a $1.16M
       company. One open-market trade worth more than a quarter of the whole company is not a trade. */
    if (meta.openMarket && cap > 0 && shares * price > cap * MAX_CAP_SHARE) {
      implausible += 1;
      continue;
    }
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
    out.push({
      id: r.id || `${r.ticker}-${r.owner_name}-${r.transaction_date}-${code}`,
      ticker: r.ticker || '',
      role: roleOf(title, !!r.is_director, !!r.is_ten_percent_owner, !!r.is_officer),
      person: r.owner_name || 'Undisclosed',
      code,
      kind: meta.acquires ? 'BUY' : 'SELL',
      shares,
      price,
      value: Math.round(shares * price),
      daysAgo: daysAgo(r.transaction_date || r.filing_date),
      plan,
      clusterCount: 1,
      heldAfter: held,
      stakePct,
      sincePct: price > 0 && spot > 0 ? Number((((spot - price) / price) * 100).toFixed(1)) : 0,
      company: r.full_name?.trim() || undefined,
      sector: r.sector?.trim() || undefined,
      marketCap: cap > 0 ? cap : null,
      cik: r.reporter_cik?.trim() || undefined,
      title: title && !/see remarks/i.test(title) ? title : undefined,
      tradedOn: nyDayOf(r.transaction_date || r.filing_date) ?? undefined,
    });
  }
  const buyers = new Map<string, Set<string>>();
  const sellers = new Map<string, Set<string>>();
  for (const t of out) {
    if (t.daysAgo > 30) continue;
    const bag = t.code === 'P' ? buyers : t.code === 'S' ? sellers : null;
    if (!bag) continue;
    const set = bag.get(t.ticker) ?? new Set<string>();
    set.add(t.person);
    bag.set(t.ticker, set);
  }
  for (const t of out) {
    if (t.daysAgo > 30) continue;
    if (t.code === 'P') t.clusterCount = buyers.get(t.ticker)?.size ?? 1;
    else if (t.code === 'S') t.clusterCount = sellers.get(t.ticker)?.size ?? 1;
  }
  return { trades: out, notShares, implausible };
}

export const EMPTY_LIVE_CONGRESS = EMPTY_CONGRESS;
