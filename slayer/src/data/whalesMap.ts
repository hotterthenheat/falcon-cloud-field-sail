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

const daysAgo = (iso?: string): number => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'");

const sentimentOf = (s: string): number => (s === 'positive' || s === 'bullish' ? 0.55 : s === 'negative' || s === 'bearish' ? -0.55 : 0);

const categoryOf = (headline: string, tags: string[] | undefined, hasTicker: boolean): NewsCategory => {
  const s = `${headline} ${(tags ?? []).join(' ')}`;
  /* WHOLE WORDS (the ship pass, 2026-10-22): /eps/ matched "stEPS" and filed "China steps up 'grey zone' tactics" under
     Earnings; /earn/ caught "learn", /quarter/ "headquarters" */
  if (/\bearnings?\b|\beps\b|\bquarter(?:ly)?\b|\bq[1-4]\b|\bfiscal\b|\brevenues?\b/i.test(s)) return 'Earnings';
  if (/\bguid(?:ance|es|ed)?\b|\boutlook\b|\bforecasts?\b/i.test(s)) return 'Guidance';
  if (/\bupgrade|\bdowngrade|price target|\banalysts?\b|\binitiat(?:es|ed) coverage/i.test(s)) return 'Analyst';
  if (/\bacqui|\bmerger\b|\bbuyout\b|\btakeover\b|\bdeal\b/i.test(s)) return 'M&A';
  if (/\bsec\b|\bregulat|\bantitrust\b|\bdoj\b|\bftc\b|\bprobe\b|\blawsuit|\blitigation\b|\bsues?\b|\bcourt\b|\bsettle(?:s|d|ment)?\b/i.test(s)) return 'Regulatory';
  if (/\bfed\b|fomc|\bcpi\b|inflation|payroll|jobs report|\bgdp\b/i.test(s) || !hasTicker) return 'Macro';
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

const typeOf = (raw?: string): ReportType | null => {
  const s = (raw || '').toLowerCase();
  if (!s) return null;
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
  s = s.replace(/\s*\[[A-Za-z]{1,6}\]\s*$/, '').trim();
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
  for (const r of rows) {
    const traded = daysAgo(r.transaction_date);
    if (traded > windowDays) continue;
    const filed = daysAgo(r.filed_at_date);
    const tradedMs = r.transaction_date ? Date.parse(r.transaction_date) : NaN;
    const filedMs = r.filed_at_date ? Date.parse(r.filed_at_date) : NaN;
    const lag = Number.isFinite(tradedMs) && Number.isFinite(filedMs) ? Math.round((filedMs - tradedMs) / 86_400_000) : filed - traded;
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
    if (!type) continue;
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
    });
  }
  return rollCongress(trades, windowDays);
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

const roleOf = (title: string, director: boolean, ten: boolean): InsiderTrade['role'] => {
  const t = title.toLowerCase();
  if (ten) return '10% owner';
  if (/\bceo\b|chief executive/.test(t)) return 'CEO';
  if (/\bcfo\b|chief financial/.test(t)) return 'CFO';
  if (/\bcoo\b|chief operating/.test(t)) return 'COO';
  if (/legal|counsel/.test(t)) return 'Chief Legal Officer';
  if (/evp|executive vice/.test(t)) return 'EVP';
  if (director || /director/.test(t)) return 'Director';
  return 'Director';
};

export function insidersFromWhales(rows: { amount?: number; filing_date?: string; formtype?: string | null; is_10b5_1?: boolean | null; is_director?: boolean; is_ten_percent_owner?: boolean; officer_title?: string; owner_name?: string; price?: string | number | null; shares_owned_after?: number | null; shares_owned_before?: number | null; stock_price?: string | number | null; ticker?: string; transaction_code?: string; transaction_date?: string; id?: string }[]): InsiderTrade[] {
  const out: InsiderTrade[] = [];
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
    const shares = Math.abs(Number(r.amount) || 0);
    const price = Number(r.price) || 0;
    const spot = Number(r.stock_price) || 0;
    /* a "price" ten times the stock's own, or a tenth of it, is a note's face or a unit mix-up, not a share price — a
       SAFE filed at $2,000,000 "a share" read as $15.7 trillion of buying (the retail pass, 2026-10-22) */
    if (meta.openMarket && spot > 0 && price > 0 && (price > spot * 10 || price * 10 < spot)) continue;
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
    out.push({
      id: r.id || `${r.ticker}-${r.owner_name}-${r.transaction_date}-${code}`,
      ticker: r.ticker || '',
      role: roleOf(r.officer_title || '', !!r.is_director, !!r.is_ten_percent_owner),
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
  return out;
}

export const EMPTY_LIVE_CONGRESS = EMPTY_CONGRESS;
