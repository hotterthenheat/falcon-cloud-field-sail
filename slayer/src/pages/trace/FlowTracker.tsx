/*
==================================================
  SLAYER TERMINAL - TRACKER (Trace)

  Everything the reader bookmarked on the Trace
  pages, and what it has done since (Noah,
  2026-09-03: "what do you think should be the
  display format of the bookmarked rows" → "build
  it"). A Compass setup is a thesis with a verdict,
  so the Compass tracker deals in cards. A Trace
  bookmark is a FACT the reader wants to follow up
  on, so this page deals in rows, and the one
  question every row answers is: what has it done
  since I marked it?

  ONE GRID, NOT THREE (Noah, same day, on the first
  cut's three stacked tables: "do you see how the
  columns arent aligned? i know they shouldnt be
  which makes it a lose lose situation"). Two
  tables with different column sets can never line
  up, and pinning widths would align three columns
  and stagger the rest. So there is one table. The
  facts every kind of mark shares — the name, the
  contract, when and where it was marked, its price
  now against then, the underlying then and now,
  volume and interest added, the lean then and now
  — are columns. The facts only one kind carries —
  a print's size, fill and side; a structure's size
  and net; a contract's last — are composed into
  ONE "Then" cell, the way the contract cell
  composes strike, side and expiry. Rows rank by
  how much they moved, whatever they are.

  A contract no longer on today's book sits with
  its THEN intact and its SINCE blank — a bookmark
  is never silently dropped. A print's contract is
  USUALLY off the book (the tape and the book draw
  strikes apart), which is why the underlying's
  move is a column every row can carry.
==================================================
*/

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQParam } from '../../components/trace/addressCut';
import { useMarketData } from '../../context/MarketDataContext';
import { contractKey, crossOfWatch, useWatch, type WatchSource, type WatchedContract, type WatchedCross, type WatchedItem, type WatchedPrint } from '../../context/WatchContext';
import CrossDrilldown from '../../components/trace/CrossDrilldown';
import type { DarkPoolPrint } from '../../types/darkpool';

/** The options under watch — every kind but a dark cross */
type WatchedOption = Exclude<WatchedItem, WatchedCross>;
import { dayLean, ensureSpots, expiredAtBell, liveSpotOf, occOf, traceHeld, sessionIsoAt, tapeSessionIso, useContractDays, useLiveBook, useMarkNow, usd as fmtUsd, type ContractDayNow } from '../../data/traceLive';
import { ctParts, nyClock } from '../../core/nyTime';
import { ensureBook, peekSpot, useBookRev } from '../../data/uwBook';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import { DOOR, DOOR_GROUP_TEXT } from '../../components/trace/door';
import { directionInk, earnMarks, weightInk } from '../../components/trace/earnedInk';
import FlowSearch, { searchMiss, matchesContract, normSymbol, parseContractQuery } from '../../components/trace/FlowSearch';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ReadDoor from '../../components/trace/ReadDoor';
import WatchStar from '../../components/trace/WatchStar';
import TraceBox, { Champion, Fact, TraceGrid } from '../../components/trace/TraceBox';
import { TrackerGuide } from '../../components/trace/TraceGuide';
import { nextCountDay } from '../../components/trace/dayWords';

const num = (v: number) => v.toLocaleString('en-US');
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

/** "8:07 AM CT" today, "10/27 8:07 AM CT" for an older mark — Central, 12-hour */
function markedAt(ms: number): string {
  const d = ctParts(new Date(ms));
  const t = ctParts(new Date());
  const hm = nyClock(ms, { zone: true });
  const sameDay = d.year === t.year && d.month === t.month && d.day === t.day;
  return sameDay ? hm : `${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')} ${hm}`;
}

/** The lean as the Lean cell would say it, in its ink — for a then → now pair. */
const leanWord = (askPct: number, side?: { ask: number; bid: number; mid: number }) => {
  if (side) {
    const l = dayLean({ askPct, volume: side.ask + side.bid + side.mid, sideVol: side });
    if (l.lean === 'UNSIDED') return { text: Number.isFinite(l.mid) ? `MID ${Math.round(l.mid)}%` : '—', ink: 'text-textMuted' };
    if (l.lean === 'EVEN') return { text: 'EVEN', ink: 'text-textMuted' };
    /* the share the rule is called on — the side's share of the SIDED contracts (the Lean cell's figure) */
    return { text: l.lean === 'ASK' ? `ASK ${Math.round(l.askSided)}%` : `BID ${Math.round(l.bidSided)}%`, ink: 'text-textPrimary' };
  }
  /* THE RULE ON THE UNROUNDED SHARE (audit round 4: an ask share of 54.6% was rounded to 55 BEFORE the 55% rule, so the
     mark read "ASK 55%" and the same data now read "EVEN" — a lean change that never happened). The one lean rule
     (traceLive dayLean) decides on the figure as kept; only the printed number is rounded. A share that rounds up to the
     edge but sits under it prints EVEN, never "ASK 55%". */
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
/** A marked contract as a book row, from its OWN session (the vendor's historic row) — the figures it carries, the rest
    unknown, never invented */
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
    prevVolume: 0,
    prevAvgFill: 0,
    prevPremium: 0,
    prevAskPct: 0,
    oiStreak: 0,
    volGtOiStreak: 0,
    earnDays: null,
    prevSpark: [],
    sideVol: d.sideVol,
  };
}
const isoOfExpiry = (e: string) => {
  const m = e.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : e.slice(0, 10);
};

const Dash = () => <span className="text-textSecondary">—</span>;

/** Index option roots — the feed has no stock state or bars for them (/stock/SPXW/stock-state answers 422), so the
    Tracker neither seeds a book for them nor draws a spot: an index mark's spot reads "—", never "$0.00" */
const INDEX_ROOTS = new Set(['SPX', 'SPXW', 'XSP', 'NDX', 'NDXP', 'XND', 'RUT', 'RUTW', 'MRUT', 'VIX', 'VIXW', 'DJX', 'OEX', 'XEO']);

/** Fixed widths for the figure columns (the spot's then → now and its change would otherwise clip); the name, contract and mark share the rest */
const WIDTHS: Record<string, number> = { then: 150, money: 84, since: 124, spot: 196, vol: 84, oi: 80, lean: 120 };
const FLEXES: Record<string, number> = { ticker: 1, contract: 2.2, marked: 1.6 };

// ---- one row shape for every kind of mark ----------------------------------------

interface TrackRow {
  /* an option under watch — a contract, a print or a structure; the dark crosses have their own box (2026-10-19) */
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
  /** The price now — the SAME field as the price marked: the screener's close for a contract, the newest trade's fill
      for a print — and when it was set */
  nowPrice: number | null;
  nowAt: string | null;
  nowSrc?: 'close' | 'fill';
  oiDelta: number | null;
  leanThen: number | null;
  /** A print's contract day by side when it was marked */
  sideThen?: { ask: number; bid: number; mid: number };
  /** The open interest has not been counted again since the mark (the count is set each morning) — the day it will be */
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
  const { marketData, activeTicker } = useMarketData();
  const { watched, toggle: toggleWatch } = useWatch();
  /* THE OPTIONS under watch feed the grid below; the dark crosses have a box of their own (2026-10-19) */
  const options = useMemo(() => watched.filter((w): w is WatchedOption => w.kind !== 'cross'), [watched]);
  const crosses = useMemo(() => watched.filter((w): w is WatchedCross => w.kind === 'cross').sort((a, b) => b.watchedAt - a.watchedAt), [watched]);
  const crossRowKey = useCallback((w: WatchedCross) => w.key, []);
  const [openCross, setOpenCross] = useState<DarkPoolPrint | null>(null);
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
      { key: 'time', header: 'Time', sortValue: w => w.time, render: w => <span className="text-textSecondary">{w.time}</span> },
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
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${w.intent === 'ACCUMULATION' ? 'text-bull' : w.intent === 'DISTRIBUTION' ? 'text-bear' : w.intent === 'HEDGE FLOW' ? 'text-warn' : 'text-textMuted'}`}>
            {w.intent}
          </span>
        ),
      },
      {
        key: 'says',
        header: 'What it says',
        render: w => (
          <span className="block text-[11px] text-textSecondary truncate" title={w.read}>
            {w.read}
          </span>
        ),
      },
    ],
    [toggleWatch]
  );
  /* the search is in the address (?q=) and takes a contract too (the owner, 2026-10-23) */
  const [query, setQuery] = useQParam();
  /** The open card: a contract's key, and the print clip when opened from a print row. */
  const [open, setOpen] = useState<{ key: string; clip?: { size: number; fill: number; side: 'ASK' | 'BID'; time: string; multi?: boolean } } | null>(null);

  /* AN EMPTY TRACKER ASKS NOTHING (audit round 9, minor 6: with no marks it polled two screener routes every 4s) */
  const contractPack = useLiveBook(activeTicker, options.length > 0);
  /* the marks' names' live prices — the "now" beside each mark's spot then (traceLive liveSpotOf) */
  const markNames = useMemo(() => [...new Set(options.map(w => w.ticker.toUpperCase()))].sort().join(','), [options]);
  useEffect(() => {
    if (!markNames) return;
    void ensureSpots(markNames.split(','));
    const id = window.setInterval(() => {
      if (!traceHeld()) void ensureSpots(markNames.split(','));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [markNames]);
  const bookRev = useBookRev();
  const liveBook = contractPack.rows;
  // The shared hold (see LiveHold): the SINCE columns freeze with the tick.
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker, !(contractPack.waiting && contractPack.rows.length === 0));
  const { book, tick } = hold.value;
  const [guideOpen, setGuideOpen] = useState(false);

  /* Today's book by contract key — the "now" every row is measured against when the book carries it */
  const byKey = useMemo(() => {
    const m = new Map<string, BookContract>();
    for (const r of book) m.set(contractKey(r), r);
    return m;
  }, [book]);
  /* EACH MARK BY ITS OWN CONTRACT (the re-audit, 2026-10-22: a contract marked from the Screener read "off today's book"
     because this page looked for it in another page's book) — the contract's own session off the vendor */
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
          if (!isIndex) ensureBook(w.ticker, 'board');
          /* the name's live price — the one every Trace page draws (liveSpotOf), the book's spot only without it */
          const spotNow = isIndex ? null : liveSpotOf(w.ticker) || peekSpot(w.ticker);
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
          /* the card's row: the contract's own screener row, else the page's book, else its own day — the card only */
          const live: BookContract | null = now?.book ?? booked ?? (own && own.iso === todayIso ? bookOfDay(w, occ!, own) : null);
          const markDay = sessionIsoAt(w.watchedAt);
          /* LIKE WITH LIKE: a contract's close against its close, off the screener both times; a print's fill against the
             contract's newest trade, off the tape route both times — never one source against the other */
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
          /* VOLUME ADDED IS NEVER NEGATIVE: within the mark's own session it is now less then, one field; a mark from an
             earlier session has today's whole volume added, and says so */
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
            /* THE COUNT HAS NOT COME YET (audit round 8: "OI since +0" intraday, when the next count is set the morning of
               Mon Oct 26) — a mark in the session still running has no newer count to compare */
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
    [options, byKey, nq, tick, bookRev, days, todayIso, markNow]
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

  /* The card: the contract's live row, with the print's own clip when the
     row was a print. Stepping walks the table's own order. */
  const drillList = useMemo(() => {
    const seen = new Set<string>();
    const out: BookContract[] = [];
    for (const r of rows) {
      if (r.live && !seen.has(r.live.key)) {
        seen.add(r.live.key);
        out.push(r.live);
      }
    }
    return out;
  }, [rows]);
  const clipFor = useCallback((row: BookContract) => (open && row.key === open.key ? open.clip : undefined), [open]);
  const openRow = useCallback((r: TrackRow) => {
    if (!r.live) return;
    const w = r.w;
    setOpen({
      key: r.live.key,
      clip: w.kind === 'print' && w.side !== 'MID' ? { size: w.size, fill: w.fill, side: w.side, time: w.time, multi: w.multi } : undefined,
    });
  }, []);
  const keyOf = useCallback((r: TrackRow) => r.w.key, []);
  /* A contract that has left the book dims; a print's contract being off
     the book is the usual case, and a structure never had one — they don't. */
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
        // A structure's cell in the contract cell's own shape: strikes bold,
        // the strategy as its word, the expiry muted, the same door.
        render: r =>
          r.w.kind === 'structure' ? (
            /* all three parts take the silver under the pointer, as the contract cell's do (2026-09-16) */
            <span className={`group/door inline-flex items-baseline gap-1.5 pb-[2px] ${DOOR}`}>
              <span className={`font-mono text-xs font-bold text-textPrimary tnum ${DOOR_GROUP_TEXT}`}>{r.w.strikesLabel}</span>
              <span className={`font-mono text-[11px] font-semibold text-textPrimary ${DOOR_GROUP_TEXT}`}>{r.w.spreadKind}</span>
              <span className={`font-mono text-[11px] text-textSecondary tnum ${DOOR_GROUP_TEXT}`}>{r.w.expiry}</span>
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
          <span className="text-[11px] text-textPrimary whitespace-nowrap">
            {markedAt(r.w.watchedAt)} <span className="text-textSecondary">· {SOURCE_LABEL[r.w.from]}</span>
          </span>
        ),
      },
      {
        key: 'then',
        header: 'Then',
        align: 'right',
        sortValue: r => (r.w.kind === 'contract' ? r.w.at.last : r.w.kind === 'print' ? r.w.fill : Math.abs(r.w.net)),
        // What was marked, in its own words: a contract's last, a print as
        // it printed, a structure as it traded.
        render: r => {
          const w = r.w;
          if (w.kind === 'contract')
            return (
              <span className="text-textSecondary">
                last <span className="text-textPrimary">${w.at.last.toFixed(2)}</span> <span className="text-[11px]">{w.at.lastAt ? `${w.at.lastAt} fill` : `as of ${markedAt(w.watchedAt)}`}</span>
              </span>
            );
          if (w.kind === 'print')
            return (
              <span className="text-textSecondary">
                <span className="text-textPrimary">{num(w.size)}</span> @ <span className="text-textPrimary">${w.fill.toFixed(2)}</span>{' '}
                <span className={`text-[11px] ${w.side === 'MID' ? 'text-textMuted' : 'text-textPrimary'}`}>
                  {w.side === 'ASK' ? 'BUY' : w.side === 'BID' ? 'SELL' : 'MID'}
                  {w.sweep ? ' · SWEEP' : ''}
                </span>
              </span>
            );
          return (
            <span className="text-textSecondary" title={w.units == null ? 'Marked before the structure was read from its legs — the size and price are as listed' : `${w.units} units at the net a unit`}>
              <span className="text-textPrimary">{num(w.size)}×</span> @ <span className="text-textPrimary">{w.net === 0 ? '—' : `$${Math.abs(w.net).toFixed(2)}`}</span>{' '}
              <span className="text-[11px]">{w.net === 0 ? '' : w.net > 0 ? 'debit' : 'credit'}</span>
            </span>
          );
        },
      },
      {
        key: 'money',
        header: 'Then $',
        align: 'right',
        sortValue: r => (r.w.kind === 'contract' ? r.w.at.premium : r.w.premium),
        // The dollars behind the mark: the print's premium, the structure's,
        // a contract's day when it was marked.
        render: r => {
          const w = r.w;
          if (w.kind === 'structure') {
            /* the net that changed hands; a mark taken before the structure was settled carried only the gross */
            if (w.netPremium != null) return <span className="text-textPrimary" title={w.gross != null ? `${fmtUsd(w.gross)} across every leg` : undefined}>{fmtUsd(Math.abs(w.netPremium))} <span className="text-[11px] text-textSecondary">{w.netPremium > 0 ? 'paid' : 'collected'}</span></span>;
            return <span className="text-textSecondary" title="Marked before the net was kept — this is the gross of every leg, not what changed hands">{fmtUsd(w.premium)} <span className="text-[11px]">gross</span></span>;
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
              ${r.nowPrice.toFixed(2)} {r.nowAt && <span className="text-[11px] text-textSecondary">{r.nowAt}</span>} <span className={`text-[11px] ${directionInk(r.chg ?? 0, marks.chg)}`}>{signedPct(r.chg ?? 0)}</span>
            </span>
          ) : r.w.kind === 'structure' ? (
            <Dash />
          ) : (
            <span className="text-[11px] text-textMuted" title={r.nowNote === 'expired' ? 'The contract expired at its bell — it no longer trades' : r.nowNote ? 'The contract has not printed in today’s session' : 'Its day is still being read'}>
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
              <span className={`text-[11px] ${directionInk(r.spotChg ?? 0, marks.spot)}`}>{signedPct(r.spotChg ?? 0)}</span>
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
            <span className="text-[11px] text-textMuted whitespace-nowrap" title={`Open interest is counted once a day, the morning after the trading — the count after this session's trading is set the morning of ${r.oiNext}`}>
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
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wide tnum whitespace-nowrap">
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

  // ---- the head ------------------------------------------------------------------

  const total = options.length;
  const counts = useMemo(
    () => ({
      contracts: options.filter(w => w.kind === 'contract').length,
      prints: options.filter(w => w.kind === 'print').length,
      structures: options.filter(w => w.kind === 'structure').length,
    }),
    [options]
  );
  /* The champions: the mark that moved most since (a real move, not +0.0%),
     the one building the most interest, the one unwinding the most. */
  const champs = useMemo(() => {
    const label = (r: TrackRow) => (r.w.kind === 'structure' ? `${r.w.ticker} ${r.w.strikesLabel}` : `${r.w.ticker} ${r.w.strike}${r.w.right}`);
    const priced = rows.filter(r => r.chg != null);
    /* A PENNY IS NOT A MOVE (audit round 10, minor 8: "Moved most NVDA 215C +100.0%" was $0.01 → $0.02): a % move is
       ranked only on a price of MIN_MOVE_PRICE and up that moved MIN_MOVE_ABS or more */
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

  const selectedKey = open ? (rows.find(r => r.live?.key === open.key && (open.clip ? r.w.kind === 'print' : r.w.kind === 'contract'))?.w.key ?? null) : null;

  return (
    <>
      <TraceBox
        title="Under watch"
        sub="Everything you marked on Trace — and what it has done since · a row opens its card"
        testId="tracker"
        data={{ watched: total, rows: rows.length }}
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
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="marks" />
          </>
        }
        sentence={read}
      >
        {total === 0 ? (
          /* The empty state is a sentence with doors, not a grid */
          <div className="border-t border-borderSubtle px-5 pt-5 pb-6 text-[12px] text-textSecondary leading-relaxed" data-tracker-empty>
            Nothing is under watch. The mark at the left of any row on the <ReadDoor onOpen={() => navigate('/trace/live-tape')}>Live Tape</ReadDoor>, the <ReadDoor onOpen={() => navigate('/trace/screener')}>Screener</ReadDoor> or any other Trace page keeps it here, with what it has done since.
          </div>
        ) : (
          <TraceGrid rows={rows} columns={columns} widths={WIDTHS} flexes={FLEXES} rowKey={keyOf} onRowClick={openRow} selectedKey={selectedKey} rowClass={dimGone} autoHeight emptyText={query.trim() && total > 0 ? searchMiss(query, 'mark') : "Nothing under watch on that name"} testId="tracker" />
        )}
      </TraceBox>

      {/* THE CROSSES UNDER WATCH (2026-10-19; Noah: "you should also be able to save and bookmark it for it to be seen in
          the tracker"): the dark-pool crosses kept from their cards and rows, each with its figures and its read; a row
          opens the cross's card. Stands only when one is kept. */}
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
          <TraceGrid rows={crosses} columns={crossColumns} widths={CROSS_WIDTHS} flexes={{ says: 2 }} rowKey={crossRowKey} onRowClick={w => setOpenCross(crossOfWatch(w))} autoHeight emptyText="" testId="tracker-crosses" />
        </TraceBox>
      )}
      <CrossDrilldown print={openCross} view={null} onClose={() => setOpenCross(null)} />

      <BookDrill list={drillList} openKey={open?.key ?? null} onOpen={k => setOpen(k ? { key: k } : null)} clipFor={clipFor} tick={tick} />
    </>
  );
};

/* the kept crosses' columns: the name, the minute, the figures and the read as kept */
const CROSS_WIDTHS: Record<string, number> = { mark: 40, name: 112, time: 80, price: 88, vs: 100, shares: 96, dollars: 96, venue: 108, read: 128 };

export default FlowTracker;
