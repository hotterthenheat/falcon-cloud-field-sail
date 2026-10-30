/* Everything marked on Trace and what it has done since: one grid for every option mark, ranked by how far each
   moved. A mark off today's book keeps its "then"; kept dark crosses have their own box. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQParam } from '../../components/trace/addressCut';
import { useTicker } from '../../context/MarketDataContext';
import { contractKey, crossOfWatch, useWatch, type WatchSource, type WatchedContract, type WatchedCross, type WatchedItem, type WatchedPrint, type WatchedStructure } from '../../context/WatchContext';
import CrossDrilldown, { IntentTag } from '../../components/trace/CrossDrilldown';
import type { DarkPoolPrint } from '../../types/darkpool';

/** The options under watch — every kind but a dark cross */
type WatchedOption = Exclude<WatchedItem, WatchedCross>;
import { dayLean, ensureSpots, expiredAtBell, fmtCount as num, liveSpotOf, occOf, traceHeld, sessionIsoAt, tapeSessionIso, useContractDays, useLiveBook, useMarkNow, usd as fmtUsd, type ContractDayNow } from '../../data/traceLive';
import { nyClock, nyParts } from '../../core/nyTime';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import { spreadLegRow, SPREAD_KINDS, type SpreadKind, type SpreadTrade } from '../../data/flowBook';
import { SpreadCard } from './MultiLeg';
import ContractCell from '../../components/trace/ContractCell';
import { DOOR, DOOR_GROUP_TEXT } from '../../components/trace/door';
import { directionInk, earnMarks, weightInk } from '../../components/trace/earnedInk';
import FlowSearch, { searchMiss, matchesContract, normSymbol, parseContractQuery } from '../../components/trace/FlowSearch';
import ReadDoor from '../../components/trace/ReadDoor';
import WatchStar from '../../components/trace/WatchStar';
import TraceBox, { Champion, Fact, TraceGrid } from '../../components/trace/TraceBox';
import { TrackerGuide } from '../../components/trace/TraceGuide';
import { nextCountDay } from '../../components/trace/dayWords';

const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const signedNum = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v))}`;
const pct = (now: number, then: number) => (then > 0 ? ((now - then) / then) * 100 : 0);
/** The floor for ranking a % move: a price of 5¢ and up that moved 5¢ or more */
const MIN_MOVE_PRICE = 0.05;
const MIN_MOVE_ABS = 0.05;

const SOURCE_LABEL: Record<WatchSource, string> = {
  tape: 'Live Tape',
  screener: 'Screener',
  footprints: 'Footprints',
  watchers: 'Watchers',
  windows: 'Intervals',
  'multi-leg': 'Multi-Leg',
  card: 'the card',
  'dark-pool': 'Dark pool',
};

/** "14:07 ET" today, "10/27 14:07 ET" for an older mark */
function markedAt(ms: number): string {
  const d = nyParts(ms);
  const t = nyParts(new Date());
  const hm = nyClock(ms, { zone: true });
  const sameDay = d.year === t.year && d.month === t.month && d.day === t.day;
  return sameDay ? hm : `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')} ${hm}`;
}

/** The lean as the Lean cell would say it, in its ink, for a then → now pair */
const leanWord = (askPct: number, side?: { ask: number; bid: number; mid: number }) => {
  if (side) {
    const l = dayLean({ askPct, volume: side.ask + side.bid + side.mid, sideVol: side });
    if (l.lean === 'UNSIDED') return { text: Number.isFinite(l.mid) ? `MID ${Math.round(l.mid)}%` : '—', ink: 'text-textMuted' };
    if (l.lean === 'EVEN') return { text: 'EVEN', ink: 'text-textMuted' };
    /* the share the rule is called on: the side's share of the sided contracts */
    return { text: l.lean === 'ASK' ? `ASK ${Math.round(l.askSided)}%` : `BID ${Math.round(l.bidSided)}%`, ink: 'text-textPrimary' };
  }
  /* the rule decides on the unrounded share; only the printed number is rounded, so 54.6% is EVEN, never "ASK 55%" */
  const l = dayLean({ askPct, volume: 0 }).lean;
  const mid = l === 'EVEN' || l === 'UNSIDED';
  const a = Math.round(askPct);
  return {
    text: l === 'UNSIDED' ? '—' : mid ? 'EVEN' : l === 'BID' ? `BID ${100 - a}%` : `ASK ${a}%`,
    ink: mid ? 'text-textMuted' : 'text-textPrimary',
  };
};

/** The OCC symbols a mark may be under — its own, else built from its parts (an index's weekly root first) */
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW', VIX: 'VIXW' };
function occCandidates(w: { ticker: string; strike: number; right: 'C' | 'P'; expiry: string; occ?: string }): string[] {
  if (w.occ) return [w.occ.toUpperCase()];
  const roots = WEEKLY_ROOT[w.ticker] ? [WEEKLY_ROOT[w.ticker], w.ticker] : [w.ticker];
  return roots.map(r => occOf(r, w.strike, w.right, w.expiry)).filter((x): x is string => !!x);
}
/** A marked contract as a book row from its own session's historic row; what it does not carry stays unknown */
function bookOfDay(w: { ticker: string; strike: number; right: 'C' | 'P'; expiry: string; at: { spot: number } }, occ: string, d: ContractDayNow): BookContract {
  const sided = d.sideVol.ask + d.sideVol.bid;
  return {
    key: `own-${occ}`,
    optionSymbol: occ,
    ticker: w.ticker,
    sector: null,
    sectorColor: null,
    strike: w.strike,
    right: w.right,
    expiry: w.expiry,
    dte: 0,
    spot: w.at.spot,
    otmPct: NaN,
    last: d.last,
    chgPct: NaN,
    lastAt: '—',
    lastAtMin: 0,
    volume: d.volume,
    oi: d.oi,
    deltaOI: 0,
    deltaOIPct: 0,
    premium: d.premium,
    iv: 0,
    ivChg: 0,
    volOverOI: d.oi > 0 ? d.volume / d.oi : 0,
    sweepPct: 0,
    multiPct: 0,
    floorPct: 0,
    askPct: sided > 0 ? (d.sideVol.ask / sided) * 100 : NaN,
    prevOI: 0,
    prevAvgFill: 0,
    oiStreak: 0,
    volGtOiStreak: 0,
    earnDays: null,
    sideVol: d.sideVol,
  };
}
const isoOfExpiry = (e: string) => {
  const m = e.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : e.slice(0, 10);
};

/** The watched dollars, never fill × size × 100. Older marks stored the vendor's total_premium under that name. */
function watchedPremium(w: WatchedPrint & { total_premium?: number }): number | undefined {
  if (typeof w.premium === 'number' && Number.isFinite(w.premium)) return w.premium;
  if (typeof w.total_premium === 'number' && Number.isFinite(w.total_premium)) return w.total_premium;
  return undefined;
}

/** A marked structure as the card's trade: its own id and the dollars that were kept, no fill made up */
function tradeOfWatch(w: WatchedStructure): SpreadTrade {
  const prefix = `s:${w.ticker}:`;
  const id = w.key.startsWith(prefix) ? w.key.slice(prefix.length) : w.key;
  const kind: SpreadKind = SPREAD_KINDS.some(k => k.key === w.spreadKind) ? (w.spreadKind as SpreadKind) : 'custom';
  const label = SPREAD_KINDS.find(k => k.key === kind)?.label ?? w.spreadKind;
  return {
    id,
    minute: 0,
    time: w.time,
    ticker: w.ticker,
    kind,
    strikesLabel: w.strikesLabel,
    expiry: w.expiry,
    dte: w.dte,
    size: w.size,
    net: w.net,
    shape: label,
    netPremium: w.netPremium ?? 0,
    netKnown: w.netPremium != null,
    premium: w.gross ?? w.premium,
    maxLoss: null,
    maxProfit: null,
    iv: 0,
    delta: 0,
    theta: NaN,
    spot: w.at.spot,
    legs: [],
    units: w.units,
    legsState: 'pending',
    namedBy: 'vendor',
  };
}

const Dash = () => <span className="text-textSecondary">—</span>;

/** Index option roots: the feed has no stock price for them, so an index mark's spot reads "—", never "$0.00" */
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'XND', 'RUT', 'RUTW', 'MRUT', 'VIX', 'VIXW', 'DJX', 'OEX', 'XEO']);

/** Fixed widths for the figure columns, which would otherwise clip; the rest share the room */
const WIDTHS: Record<string, number> = { then: 150, money: 84, since: 124, spot: 196, vol: 84, oi: 80, lean: 120 };
const FLEXES: Record<string, number> = { ticker: 1, contract: 2.2, marked: 1.6 };


interface TrackRow {
  /** An option under watch: a contract, a print or a structure */
  w: WatchedOption;
  /** The contract on today's book, when the book carries it */
  live: BookContract | null;
  /** Its price now against the price marked (last, or the print's fill), % */
  chg: number | null;
  spotThen: number;
  spotNow: number | null;
  spotChg: number | null;
  volAdded: number | null;
  /** Why volume added is not a number: the mark was in an earlier session (today's whole volume is then shown) */
  volWord?: string;
  /** The price now, the same field as the price marked (a contract's close, a print's newest fill), and when */
  nowPrice: number | null;
  nowAt: string | null;
  nowSrc?: 'close' | 'fill';
  oiDelta: number | null;
  leanThen: number | null;
  /** A print's contract day by side when it was marked */
  sideThen?: { ask: number; bid: number; mid: number };
  /** The day the next open-interest count lands, while none has since the mark */
  oiNext?: string;
  leanNow: number | null;
  /** The contract's day by side now, when its own day was read */
  sideNow?: { ask: number; bid: number; mid: number };
  /** Why there is no "now": it expired, or it has not traded today */
  nowNote?: string;
  /** The sort: the price move when the book can give one, else the underlying's */
  moved: number;
}

const FlowTracker = () => {
  const navigate = useNavigate();
  const { activeTicker } = useTicker();
  const { watched, toggle: toggleWatch } = useWatch();
  /* the options under watch feed the grid; the dark crosses have a box of their own */
  const options = useMemo(() => watched.filter((w): w is WatchedOption => w.kind !== 'cross'), [watched]);
  const crosses = useMemo(() => watched.filter((w): w is WatchedCross => w.kind === 'cross').sort((a, b) => b.watchedAt - a.watchedAt), [watched]);
  const crossRowKey = useCallback((w: WatchedCross) => w.key, []);
  const [openCross, setOpenCross] = useState<DarkPoolPrint | null>(null);
  /** The open contract or print: its watch key, so two prints of one contract do not share a card */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** A structure has no book row — its own card, from the mark */
  const [openStruct, setOpenStruct] = useState<WatchedStructure | null>(null);
  const [legTrade, setLegTrade] = useState<SpreadTrade | null>(null);
  const [legKey, setLegKey] = useState<string | null>(null);
  const crossColumns = useMemo<Column<WatchedCross>[]>(
    () => [
      {
        key: 'mark',
        header: '',
        sortValue: () => 0,
        render: w => (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              toggleWatch(w);
            }}
            title="Let go of this cross"
            className="p-1 rounded text-silver hover:bg-ink/[0.06] transition-colors"
            data-cross-unwatch={w.key}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden>
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        ),
      },
      {
        key: 'name',
        header: 'Name',
        sortValue: w => w.ticker,
        render: w => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={w.ticker} size={15} />
            <span className="font-bold text-textPrimary">{w.ticker}</span>
          </span>
        ),
      },
      { key: 'time', header: 'Time ET', sortValue: w => w.time, render: w => <span className="text-textSecondary">{w.time}</span> },
      { key: 'price', header: 'Price', align: 'right', sortValue: w => w.price, render: w => <span className="font-bold text-textPrimary">${w.price.toFixed(2)}</span> },
      {
        key: 'vs',
        header: 'vs spot then',
        align: 'right',
        sortValue: w => w.vsSpotPct,
        render: w => <span className={w.vsSpotPct > 0 ? 'text-bull' : w.vsSpotPct < 0 ? 'text-bear' : 'text-textMuted'}>{`${w.vsSpotPct > 0 ? '+' : w.vsSpotPct < 0 ? '−' : ''}${Math.abs(w.vsSpotPct).toFixed(2)}%`}</span>,
      },
      { key: 'shares', header: 'Shares', align: 'right', sortValue: w => w.size, render: w => <span className="text-textPrimary">{num(w.size)}</span> },
      { key: 'dollars', header: 'Dollars', align: 'right', sortValue: w => w.notional, render: w => <span className="text-textPrimary">{fmtUsd(w.notional)}</span> },
      { key: 'venue', header: 'Venue', sortValue: w => w.venue, render: w => <span className="text-textSecondary">{w.venue}</span> },
      {
        key: 'read',
        header: 'Read',
        sortValue: w => w.intent,
        render: w => (
          <IntentTag intent={w.intent} />
        ),
      },
      {
        key: 'says',
        header: 'What it says',
        render: w => (
          <span className="block text-t11 text-textSecondary truncate" title={w.read}>
            {w.read}
          </span>
        ),
      },
    ],
    [toggleWatch]
  );
  /* the search is in the address (?q=) and takes a contract too */
  const [query, setQuery] = useQParam();

  /* an empty tracker asks nothing */
  const contractPack = useLiveBook(activeTicker, options.length > 0);
  /* the marks' names' live prices, the "now" beside each mark's spot then; a landing re-renders the rows */
  const markNames = useMemo(() => [...new Set(options.map(w => w.ticker.toUpperCase()))].sort().join(','), [options]);
  const [spotRev, setSpotRev] = useState(0);
  useEffect(() => {
    if (!markNames) return;
    let live = true;
    const read = () => void ensureSpots(markNames.split(',')).then(() => live && setSpotRev(n => n + 1));
    read();
    const id = window.setInterval(() => {
      if (!traceHeld()) read();
    }, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [markNames]);
  const book = contractPack.rows;
  const [guideOpen, setGuideOpen] = useState(false);

  /* today's book by contract key: the "now" a row is measured against when the book carries it */
  const byKey = useMemo(() => {
    const m = new Map<string, BookContract>();
    for (const r of book) m.set(contractKey(r), r);
    return m;
  }, [book]);
  /* each mark reads its own contract's session, never another page's book */
  const occs = useMemo(() => options.filter(w => w.kind !== 'structure').flatMap(w => occCandidates(w as { ticker: string; strike: number; right: 'C' | 'P'; expiry: string; occ?: string })), [options]);
  const days = useContractDays(occs).rows;
  const markNow = useMarkNow(useMemo(() => options.filter(w => w.kind !== 'structure').map(w => {
    const o = w as WatchedContract | WatchedPrint;
    return { key: o.key, kind: o.kind, ticker: o.ticker, strike: o.strike, right: o.right, expiry: o.expiry, occ: o.occ ?? occCandidates(o)[0] };
  }), [options])).rows;
  const todayIso = tapeSessionIso();

  const nq = normSymbol(query);

  const rows = useMemo<TrackRow[]>(
    () =>
      options
        .filter(w => nq === '' || (w.kind === 'structure' ? normSymbol(w.ticker) === normSymbol(parseContractQuery(query)?.ticker ?? query) || normSymbol(w.ticker).includes(nq) : matchesContract(query, { ticker: w.ticker, strike: w.strike, right: w.right, expiry: w.expiry })))
        .map(w => {
          const isIndex = INDEX_ROOTS.has(w.ticker.toUpperCase());
          const spotNow = isIndex ? null : liveSpotOf(w.ticker) || null;
          const spotThen = w.at.spot;
          const spotChg = spotNow != null && spotThen > 0 ? pct(spotNow, spotThen) : null;
          if (w.kind === 'structure') {
            return { w, live: null, chg: null, spotThen, spotNow, spotChg, volAdded: null, nowPrice: null, nowAt: null, oiDelta: null, leanThen: null, leanNow: null, moved: spotChg ?? 0 };
          }
          const cands = occCandidates(w);
          const occ = cands.find(o => days[o]) ?? cands[0];
          const own: ContractDayNow | null = occ ? days[occ] ?? null : null;
          const booked = byKey.get(contractKey(w)) ?? null;
          const now = markNow[w.key];
          /* the card's row: the contract's own screener row, else the book, else its own day */
          const live: BookContract | null = now?.book ?? booked ?? (own && own.iso === todayIso ? bookOfDay(w, occ!, own) : null);
          const markDay = sessionIsoAt(w.watchedAt);
          /* like with like: a contract's close against its close, a print's fill against the newest fill */
          let nowPrice: number | null = null;
          let nowAt: string | null = null;
          let nowVol: number | null = null;
          let nowOi: number | null = null;
          let nowDay: string | null = null;
          if (w.kind === 'contract') {
            const b = now?.book ?? (booked && booked.optionSymbol ? booked : null);
            if (b) {
              nowPrice = b.last > 0 ? b.last : null;
              nowAt = b.lastAt && b.lastAt !== '—' ? b.lastAt : null;
              nowVol = b.volume;
              nowOi = b.oi;
              nowDay = b.lastDay ?? todayIso;
            }
          } else if (now?.trade) {
            nowPrice = now.trade.fill > 0 ? now.trade.fill : null;
            nowAt = now.trade.time.slice(0, 5);
            nowVol = now.trade.volume;
            nowOi = now.trade.oi;
            nowDay = now.trade.day;
          }
          const then = w.kind === 'contract' ? w.at.last : w.fill;
          const chg = nowPrice != null && then > 0 ? pct(nowPrice, then) : null;
          const expired = expiredAtBell(isoOfExpiry(w.expiry), w.ticker);
          const nowNote = nowPrice != null ? undefined : expired ? 'expired' : own ? `no print today · last ${own.iso.slice(5).replace('-', '/')}` : undefined;
          /* volume added is never negative: now less then within the mark's session; an older mark shows today's whole */
          const sameDay = nowDay != null && nowDay === markDay;
          const diff = nowVol != null && sameDay ? nowVol - w.at.volume : null;
          const volAdded = diff != null && diff >= 0 ? diff : null;
          const volWord = nowVol != null && !sameDay ? `${num(nowVol)} today` : undefined;
          return {
            w,
            live,
            chg,
            spotThen,
            spotNow,
            spotChg,
            volAdded,
            volWord,
            nowPrice,
            nowAt,
            nowSrc: w.kind === 'contract' ? ('close' as const) : ('fill' as const),
            oiDelta: nowOi != null ? nowOi - w.at.oi : null,
            /* a mark in the running session has no newer count to compare yet */
            oiNext: markDay === tapeSessionIso() ? nextCountDay(markDay) : undefined,
            leanThen: w.kind === 'contract' ? w.at.askPct : w.kind === 'print' && w.at.daySide && w.at.daySide.ask + w.at.daySide.bid > 0 ? (w.at.daySide.ask / (w.at.daySide.ask + w.at.daySide.bid)) * 100 : null,
            sideThen: w.kind === 'print' ? w.at.daySide : undefined,
            leanNow: live ? live.askPct : null,
            sideNow: live?.sideVol,
            nowNote,
            moved: chg ?? spotChg ?? 0,
          };
        })
        .sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, byKey, nq, spotRev, days, todayIso, markNow]
  );

  /* Three registers per column, measured over what is on screen. */
  const marks = useMemo(
    () => ({
      chg: earnMarks(rows, r => r.chg ?? 0),
      spot: earnMarks(rows, r => r.spotChg ?? 0),
      vol: earnMarks(rows, r => r.volAdded ?? 0),
      oi: earnMarks(rows, r => r.oiDelta ?? 0),
    }),
    [rows]
  );

  /* one card per mark: a print keeps its own key, so the first print of a contract is not every print of it */
  const drillList = useMemo(() => {
    const out: BookContract[] = [];
    for (const r of rows) {
      if (r.w.kind === 'structure' || !r.live) continue;
      out.push(r.live.key === r.w.key ? r.live : { ...r.live, key: r.w.key });
    }
    return out;
  }, [rows]);
  const clips = useMemo(() => {
    const m = new Map<string, { size: number; fill: number; side: 'ASK' | 'BID' | 'MID'; time: string; multi?: boolean; premium?: number; sweep: boolean }>();
    for (const r of rows) {
      if (r.w.kind !== 'print') continue;
      m.set(r.w.key, { size: r.w.size, fill: r.w.fill, side: r.w.side, time: r.w.time, multi: r.w.multi, premium: watchedPremium(r.w), sweep: !!r.w.sweep });
    }
    return m;
  }, [rows]);
  const clipFor = useCallback((row: BookContract) => clips.get(row.key), [clips]);
  const openRow = useCallback((r: TrackRow) => {
    if (r.w.kind === 'structure') {
      setOpenKey(null);
      setLegTrade(null);
      setLegKey(null);
      setOpenStruct(r.w);
      return;
    }
    setOpenStruct(null);
    if (!r.live) return;
    setOpenKey(r.w.key);
  }, []);
  const keyOf = useCallback((r: TrackRow) => r.w.key, []);
  /* an expired contract dims; a print off the book is usual, and a structure never had one */
  const dimGone = useCallback((r: TrackRow) => (r.w.kind !== 'structure' && r.nowNote === 'expired' ? 'opacity-50' : undefined), []);

  const columns = useMemo<Column<TrackRow>[]>(
    () => [
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.w.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={r.w.key} make={() => r.w} noun={r.w.kind} />
            <CompanyLogo ticker={r.w.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.w.ticker}</span>
          </span>
        ),
      },
      {
        key: 'contract',
        header: 'Contract',
        align: 'right',
        sortValue: r => (r.w.kind === 'structure' ? 0 : r.w.strike),
        /* a structure in the contract cell's shape: strikes bold, the strategy as its word, the expiry muted */
        render: r =>
          r.w.kind === 'structure' ? (
            <span className={`group/door inline-flex items-baseline gap-1.5 pb-[2px] ${DOOR}`}>
              <span className={`font-mono text-xs font-bold text-textPrimary tnum ${DOOR_GROUP_TEXT}`}>{r.w.strikesLabel}</span>
              <span className={`font-mono text-t11 font-semibold text-textPrimary ${DOOR_GROUP_TEXT}`}>{r.w.spreadKind}</span>
              <span className={`font-mono text-t11 text-textSecondary tnum ${DOOR_GROUP_TEXT}`}>{r.w.expiry}</span>
            </span>
          ) : (
            <ContractCell strike={r.w.strike} right={r.w.right} expiry={r.w.expiry} />
          ),
      },
      {
        key: 'marked',
        header: 'Marked',
        sortValue: r => r.w.watchedAt,
        render: r => (
          <span className="text-t11 text-textPrimary whitespace-nowrap">
            {markedAt(r.w.watchedAt)} <span className="text-textSecondary">· {SOURCE_LABEL[r.w.from]}</span>
          </span>
        ),
      },
      {
        key: 'then',
        header: 'Then',
        align: 'right',
        sortValue: r => (r.w.kind === 'contract' ? r.w.at.last : r.w.kind === 'print' ? r.w.fill : Math.abs(r.w.net)),
        /* what was marked: a contract's last, a print as it printed, a structure as it traded */
        render: r => {
          const w = r.w;
          if (w.kind === 'contract')
            return (
              <span className="text-textSecondary">
                last <span className="text-textPrimary">${w.at.last.toFixed(2)}</span> <span className="text-t11">{w.at.lastAt ? `${w.at.lastAt} fill` : `as of ${markedAt(w.watchedAt)}`}</span>
              </span>
            );
          if (w.kind === 'print')
            return (
              <span className="text-textSecondary">
                <span className="text-textPrimary">{num(w.size)}</span> @ <span className="text-textPrimary">${w.fill.toFixed(2)}</span>{' '}
                <span className={`text-t11 ${w.side === 'MID' ? 'text-textMuted' : 'text-textPrimary'}`}>
                  {w.side === 'ASK' ? 'BUY' : w.side === 'BID' ? 'SELL' : 'MID'}
                  {w.sweep ? ' · SWEEP' : ''}
                </span>
              </span>
            );
          return (
            <span className="text-textSecondary" title={w.units == null ? 'Marked before the structure was read from its legs — the size and price are as listed' : `${w.units} units at the net a unit`}>
              <span className="text-textPrimary">{num(w.size)}×</span> @ <span className="text-textPrimary">{w.net === 0 ? '—' : `$${Math.abs(w.net).toFixed(2)}`}</span>{' '}
              <span className="text-t11">{w.net === 0 ? '' : w.net > 0 ? 'debit' : 'credit'}</span>
            </span>
          );
        },
      },
      {
        key: 'money',
        header: 'Then $',
        align: 'right',
        sortValue: r => (r.w.kind === 'contract' ? r.w.at.premium : r.w.premium),
        /* the dollars behind the mark: the print's or structure's premium, a contract's day when marked */
        render: r => {
          const w = r.w;
          if (w.kind === 'structure') {
            /* the net that changed hands; a mark taken before the structure was settled carried only the gross */
            if (w.netPremium != null) return <span className="text-textPrimary" title={w.gross != null ? `${fmtUsd(w.gross)} across every leg` : undefined}>{fmtUsd(Math.abs(w.netPremium))} <span className="text-t11 text-textSecondary">{w.netPremium > 0 ? 'paid' : 'collected'}</span></span>;
            return <span className="text-textSecondary" title="Marked before the net was kept — this is the gross of every leg, not what changed hands">{fmtUsd(w.premium)} <span className="text-t11">gross</span></span>;
          }
          return <span className="text-textPrimary">{fmtUsd(w.kind === 'contract' ? w.at.premium : w.premium)}</span>;
        },
      },
      {
        key: 'since',
        header: 'Now · since',
        align: 'right',
        sortValue: r => r.chg ?? -Infinity,
        render: r =>
          r.nowPrice != null ? (
            <span className="text-textPrimary" title={r.nowSrc === 'close' ? "The screener's close for this contract now, against its close when you marked it" : "The contract's newest trade, against the print you marked — a fill against a fill"}>
              ${r.nowPrice.toFixed(2)} {r.nowAt && <span className="text-t11 text-textSecondary">{r.nowAt}</span>} <span className={`text-t11 ${directionInk(r.chg ?? 0, marks.chg)}`}>{signedPct(r.chg ?? 0)}</span>
            </span>
          ) : r.w.kind === 'structure' ? (
            <Dash />
          ) : (
            <span className="text-t11 text-textMuted" title={r.nowNote === 'expired' ? 'The contract expired at its bell — it no longer trades' : r.nowNote ? 'The contract has not printed in today’s session' : 'Its day is still being read'}>
              {r.nowNote ?? '…'}
            </span>
          ),
      },
      {
        key: 'spot',
        header: 'Spot then → now',
        align: 'right',
        sortValue: r => r.spotChg ?? -Infinity,
        render: r =>
          r.spotNow == null ? (
            r.spotThen > 0 ? <span className="text-textPrimary">${r.spotThen.toFixed(2)}</span> : <span className="text-textMuted">—</span>
          ) : (
            <span className="text-textPrimary">
              ${r.spotThen.toFixed(2)} <span className="text-textSecondary">→</span> <span className="text-textPrimary">${r.spotNow.toFixed(2)}</span>{' '}
              <span className={`text-t11 ${directionInk(r.spotChg ?? 0, marks.spot)}`}>{signedPct(r.spotChg ?? 0)}</span>
            </span>
          ),
      },
      {
        key: 'vol',
        header: 'Vol added',
        align: 'right',
        sortValue: r => r.volAdded ?? -Infinity,
        render: r =>
          r.volAdded != null ? (
            <span className={weightInk(r.volAdded, marks.vol)}>+{num(r.volAdded)}</span>
          ) : r.volWord ? (
            <span className="text-textSecondary" title="Marked in an earlier session — the volume since cannot be split from that session's, so today's whole volume is shown">
              {r.volWord}
            </span>
          ) : (
            <Dash />
          ),
      },
      {
        key: 'oi',
        header: 'OI since',
        align: 'right',
        sortValue: r => r.oiDelta ?? -Infinity,
        render: r =>
          r.oiNext && !r.oiDelta ? (
            <span className="text-t11 text-textMuted whitespace-nowrap" title={`Open interest is counted once a day, the morning after the trading — the count after this session's trading is set the morning of ${r.oiNext}`}>
              next count {r.oiNext}
            </span>
          ) : r.oiDelta == null ? (
            <Dash />
          ) : (
            <span className={directionInk(r.oiDelta, marks.oi)}>{signedNum(r.oiDelta)}</span>
          ),
      },
      {
        key: 'lean',
        header: 'Lean then → now',
        align: 'right',
        sortValue: r => r.leanNow ?? -1,
        render: r => {
          if (r.leanNow == null && r.leanThen == null) return <Dash />;
          const then = r.leanThen != null || r.sideThen ? leanWord(r.leanThen ?? NaN, r.sideThen) : null;
          const now = r.leanNow != null || r.sideNow ? leanWord(r.leanNow ?? NaN, r.sideNow) : null;
          return (
            <span className="font-mono text-t11 font-semibold uppercase tracking-wide tnum whitespace-nowrap">
              {then ? <span className={then.ink}>{then.text}</span> : <span className="text-textSecondary">—</span>}
              <span className="text-textSecondary"> → </span>
              {now ? <span className={now.ink}>{now.text}</span> : <span className="text-textSecondary">—</span>}
            </span>
          );
        },
      },
    ],
    [marks]
  );


  const total = options.length;
  const counts = useMemo(
    () => ({
      contracts: options.filter(w => w.kind === 'contract').length,
      prints: options.filter(w => w.kind === 'print').length,
      structures: options.filter(w => w.kind === 'structure').length,
    }),
    [options]
  );
  /* the mark that moved most, the one building the most interest, the one unwinding the most */
  const champs = useMemo(() => {
    const label = (r: TrackRow) => (r.w.kind === 'structure' ? `${r.w.ticker} ${r.w.strikesLabel}` : `${r.w.ticker} ${r.w.strike}${r.w.right}`);
    const priced = rows.filter(r => r.chg != null);
    /* a penny is not a move: rank a % move only on a price and a move of 5¢ or more */
    const thenOf = (r: TrackRow): number | null => (r.w.kind === 'contract' ? r.w.at.last : r.w.kind === 'print' ? r.w.fill : null);
    const real = (r: TrackRow) => {
      const then = thenOf(r);
      return then != null && r.nowPrice != null && then >= MIN_MOVE_PRICE && Math.abs(r.nowPrice - then) >= MIN_MOVE_ABS - 1e-9;
    };
    const moved = priced.filter(real).reduce<TrackRow | null>((a, r) => (Math.abs(r.chg!) >= 0.05 && (a === null || Math.abs(r.chg!) > Math.abs(a.chg!)) ? r : a), null);
    const building = priced.reduce<TrackRow | null>((a, r) => ((r.oiDelta ?? 0) > 0 && (a === null || r.oiDelta! > a.oiDelta!) ? r : a), null);
    const unwinding = priced.reduce<TrackRow | null>((a, r) => ((r.oiDelta ?? 0) < 0 && (a === null || r.oiDelta! < a.oiDelta!) ? r : a), null);
    return { moved, building, unwinding, label };
  }, [rows]);

  const read = useMemo<ReactNode>(() => {
    /* the body below says it, with the doors to the pages that keep a row */
    if (total === 0) return null;
    const parts = [
      counts.contracts ? `${counts.contracts} contract${counts.contracts === 1 ? '' : 's'}` : '',
      counts.prints ? `${counts.prints} print${counts.prints === 1 ? '' : 's'}` : '',
      counts.structures ? `${counts.structures} structure${counts.structures === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    const gone = rows.filter(r => r.w.kind !== 'structure' && r.nowNote === 'expired').length;
    const m = champs.moved;
    return (
      <>
        <RichRead text={`${what} under watch${gone ? `, ${gone} expired` : ''}. `} />
        {m ? (
          <>
            <RichRead text="Moved most since its mark: " />
            <ReadDoor onOpen={() => openRow(m)}>{champs.label(m)}</ReadDoor>
            <RichRead text={`, [[${signedPct(m.chg!)}]] ${m.w.kind === 'print' ? "— the contract's newest fill against the print's" : "— the screener's close now against its close at the mark"}.`} />
          </>
        ) : (
          <RichRead text="Nothing has moved since its mark yet — a move is ranked once a price of 5¢ and up has moved 5¢ or more." />
        )}
      </>
    );
  }, [total, counts, rows, champs, openRow]);

  const searchRows = useMemo(
    () =>
      options.map(w => ({
        ticker: w.ticker,
        strike: w.kind === 'structure' ? 0 : w.strike,
        right: w.kind === 'structure' ? ('C' as const) : w.right,
        premium: w.kind === 'contract' ? w.at.premium : w.premium,
      })),
    [options]
  );

  const selectedKey = openStruct?.key ?? openKey;
  const legRows = useMemo(() => (legTrade ? legTrade.legs.map((_, i) => spreadLegRow(legTrade, i)) : []), [legTrade]);

  return (
    <>
      <TraceBox
        title="Under watch"
        sub="Everything you marked on Trace — and what it has done since · a row opens its card"
        testId="tracker"
        data={{ watched: total, rows: rows.length }}
        foldOnPhone
        guide={{ title: 'How to read the watch', door: 'What a mark and the since columns mean', body: <TrackerGuide />, testId: 'tracker-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Under watch" testId="watched">
              {nq ? `${num(rows.length)} of ${total}` : total}
            </Fact>
            <Fact label="Contracts · prints · structures" testId="kinds">
              {counts.contracts} <span className="text-textSecondary">·</span> {counts.prints} <span className="text-textSecondary">·</span> {counts.structures}
            </Fact>
            {champs.building && champs.building !== champs.moved && (
              <Champion label="Building" ink="bull" onOpen={() => openRow(champs.building!)} testId="building">
                {champs.label(champs.building)} · {signedNum(champs.building.oiDelta!)} OI
              </Champion>
            )}
            {champs.unwinding && champs.unwinding !== champs.moved && (
              <Champion label="Unwinding" ink="bear" onOpen={() => openRow(champs.unwinding!)} testId="unwinding">
                {champs.label(champs.unwinding)} · {signedNum(champs.unwinding.oiDelta!)} OI
              </Champion>
            )}
            {champs.moved && (
              <Champion label="Moved most" ink="supreme" onOpen={() => openRow(champs.moved!)} testId="moved">
                {champs.label(champs.moved)} · {signedPct(champs.moved.chg!)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="marks" tickersOnly />
          </>
        }
        sentence={read}
      >
        {total === 0 ? (
          /* the empty state is a sentence with doors, not a grid */
          <div className="border-t border-borderSubtle px-5 pt-5 pb-6 text-t12 text-textSecondary leading-relaxed" data-tracker-empty>
            Nothing is under watch. The mark at the left of any row on the <ReadDoor onOpen={() => navigate('/trace/live-tape')}>Live Tape</ReadDoor>, the <ReadDoor onOpen={() => navigate('/trace/screener')}>Screener</ReadDoor> or any other Trace page keeps it here, with what it has done since.
          </div>
        ) : (
          <TraceGrid rows={rows} columns={columns} widths={WIDTHS} flexes={FLEXES} rowKey={keyOf} onRowClick={openRow} selectedKey={selectedKey} rowClass={dimGone} autoHeight emptyText={query.trim() && total > 0 ? searchMiss(query, 'mark') : "Nothing under watch on that name"} testId="tracker" />
        )}
      </TraceBox>

      {/* the kept dark crosses, each with its figures and read; stands only when one is kept */}
      {crosses.length > 0 && (
        <TraceBox
          title="Dark crosses under watch"
          sub="The off-exchange crosses you kept, newest first — the read as it was when you kept it · a row opens the cross's card"
          testId="tracker-crosses"
          data={{ crosses: crosses.length }}
          facts={
            <>
              <Fact label="Crosses" testId="crosses">
                {num(crosses.length)} <span className="text-textMuted">· {new Set(crosses.map(w => w.ticker)).size} names</span>
              </Fact>
              <Fact label="Dark dollars" testId="dark-dollars">
                {fmtUsd(crosses.reduce((a, w) => a + w.notional, 0))}
              </Fact>
            </>
          }
          controls={<></>}
          sentence={<RichRead text={`${num(crosses.length)} ${crosses.length === 1 ? 'cross' : 'crosses'} kept from the dark pool — the mark on a row or on the cross's card lets it go.`} />}
        >
          <TraceGrid rows={crosses} columns={crossColumns} widths={CROSS_WIDTHS} flexes={CROSS_FLEX} prose={CROSS_PROSE} rowKey={crossRowKey} onRowClick={w => setOpenCross(crossOfWatch(w))} autoHeight emptyText="" testId="tracker-crosses" />
        </TraceBox>
      )}
      <CrossDrilldown print={openCross} view={null} onClose={() => setOpenCross(null)} />

      {openStruct && (
        <SpreadCard
          trade={tradeOfWatch(openStruct)}
          onClose={() => setOpenStruct(null)}
          onLeg={(legs, i) => {
            const t = { ...tradeOfWatch(openStruct), legs };
            setLegTrade(t);
            setLegKey(`${t.id}-l${i}`);
          }}
        />
      )}
      <BookDrill list={drillList} openKey={openKey} onOpen={setOpenKey} clipFor={clipFor} />
      <BookDrill
        list={legRows}
        openKey={legKey}
        onOpen={k => {
          setLegKey(k);
          if (k === null) setLegTrade(null);
        }}
      />
    </>
  );
};

/* the kept crosses' columns: the name, the minute, the figures and the read as kept */
const CROSS_FLEX: Record<string, number> = { says: 2 };
const CROSS_PROSE = ['says'];
const CROSS_WIDTHS: Record<string, number> = { mark: 40, name: 112, time: 80, price: 88, vs: 100, shares: 96, dollars: 96, venue: 108, read: 128 };

export default FlowTracker;
