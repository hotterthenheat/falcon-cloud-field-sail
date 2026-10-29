/* How every house name grades: the head's facts, the controls, the sector rotation, then the grid of names (price, day,
   year, the three pillars as bars with their words, the grade and the read). States, never orders. */

import { companyName, displayName, searchTickers } from '../../data/tickers';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import { FeedFallback } from '../../components/ui/liveRead';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import { CoSub } from '../../components/record/CoName';
import CompanyLogo from '../../components/ui/CompanyLogo';
import Sparkline from '../../components/compass/Sparkline';
import { SectorMark } from '../../components/trace/SectorMark';
import { StocksGuide } from '../../components/record/StocksGuide';
import { useBoardNames } from '../../data/boardNames';
import { aboveFifty, buildSectorBoard, type SectorRow, type StockPick, type StockSleeves, type StockVerdict } from '../../data/stocks';
import { peekBatchQuote, useBatchQuote, useLiveStocks, useScreenerQuotes, type BatchQuote } from '../../data/liveFiles';
import { peekQuote } from '../../data/liveQuote';
import { nyClock, nyIsoDate, nySessionPhase } from '../../core/nyTime';
import { isTradingDay } from '../../core/calendar';
import { shortDay as shortDayWord } from '../../data/nyDate';
import { gradeHelp, gradeOfComposite, type Grade } from '../../data/stockOverview';
import { Controls, HeadFact, PhoneFold, RecordHead, RecordPanel, Summary } from '../../components/record/RecordFrame';
import { lookup, SECTORS, UNIVERSE, type Sector } from '../../data/universe';
import { searchListed } from '../../data/listedNames';
import { ROTATION_SECTORS } from './recordSkeletons';
import { phonePin } from '../../components/record/pagedGrid';
import { CardLine, PhoneCards, usePhoneCards } from '../../components/record/PhoneCards';
import { signedPct } from './money';

type ScreenPick = 'all' | Grade;
type SectorPick = 'all' | Sector;
type NamesPick = 'all' | 'board';

/** User-facing screen words — the data's read, never an instruction */
/* the four words, off the name page's own cuts; strong wears a ring, it is the rare one */
const gradeOfPick = (p: StockPick): Grade => gradeOfComposite(p.composite);
const SCREEN_DOT: Record<Grade, string> = { strong: 'bg-bull ring-2 ring-bull/30', good: 'bg-bull', caution: 'bg-warn', poor: 'bg-bear' };
const GRADE_RANK: Grade[] = ['strong', 'good', 'caution', 'poor'];
const GRADE_WORD_INK: Record<Grade, string> = { strong: 'text-bull', good: 'text-bull', caution: 'text-warn', poor: 'text-bear' };
const SLEEVE_NAME: Record<keyof StockSleeves, string> = { momentum: 'The trend', quality: 'The numbers', flow: 'The money', news: 'The news' };

const SCREEN_OPTIONS: DropdownOption<ScreenPick>[] = [
  { value: 'all', label: 'Every screen', short: 'All', hint: 'Strong, good, caution and poor' },
  { value: 'strong', label: 'Strong', hint: 'Nearly everything lines up at once — rare on purpose' },
  { value: 'good', label: 'Good', hint: 'The measures with a number point the same way' },
  { value: 'caution', label: 'Caution', hint: 'The measures disagree — a catalyst decides' },
  { value: 'poor', label: 'Poor', hint: 'The data argues against the name' },
];
const SECTOR_OPTIONS: DropdownOption<SectorPick>[] = [{ value: 'all', label: 'Every sector', short: 'All', hint: 'The ten sectors the universe files' }, ...SECTORS.map(s => ({ value: s, label: s }))];
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'The whole universe' },
  { value: 'board', label: 'Your board', hint: 'The names on your Board' },
];

/* Which way relative strength moves over two windows, apart from the ladder's rank; LEADING is the
   ladder's top only (ties share it). */
const PHASE_WORD: Record<SectorRow['phase'], string> = { LEADING: 'RISING', IMPROVING: 'TURNING UP', WEAKENING: 'ROLLING OVER', LAGGING: 'FALLING' };
const PHASE_INK: Record<SectorRow['phase'], string> = { LEADING: 'text-bull', IMPROVING: 'text-flip', WEAKENING: 'text-warn', LAGGING: 'text-bear' };
const PHASE_BAR: Record<SectorRow['phase'], string> = { LEADING: 'bg-bull', IMPROVING: 'bg-flip', WEAKENING: 'bg-warn', LAGGING: 'bg-bear/80' };

/** The two consumer sectors by their second word on a card 150px wide — the mark and the grid carry the whole name */
const SHORT_SECTOR: Partial<Record<Sector, string>> = { 'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples' };

const NO_SECTOR: SectorRow = { sector: 'Technology', score: 1, rs1w: 0, rs1m: 0, breadthPct: 0, count: 0, ret1w: null, ret1m: null, phase: 'LAGGING' };
/** Search shows this many listed names; warrants, units, rights and preferreds are left out */
const SEARCH_ROWS = 40;
const COMMON_SYMBOL = /^[A-Z]{1,5}(\.[AB])?$/;
const ROW_H = 56;
const GRID_ROWS = 12;
const dirInk = (v: number) => (v >= 0 ? 'text-bull' : 'text-bear');
/** "A, B and C" — never "A and B and C" */
const listPhrase = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/* ---- cells --------------------------------------------------------------------- */

/** A company name we actually have. The ticker itself is not a name. */
const filedName = (ticker: string, raw?: string | null): string => {
  const booked = companyName(ticker);
  if (booked && booked.toUpperCase() !== ticker.toUpperCase()) return booked;
  const row = displayName(raw);
  return row && row.toUpperCase() !== ticker.toUpperCase() ? row : '';
};

const NameCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
        <CoSub ticker={data.ticker} fallback={filedName(data.ticker, data.name)} />
      </span>
    </span>
  ) : null;

const SectorCell = ({ data }: ICellRendererParams<StockPick>) => {
  if (!data) return null;
  const house = lookup(data.ticker);
  const sector = house?.sector ?? (data.listedOnly ? null : data.sector);
  return sector ? (
    <span className="flex items-center gap-1.5 min-w-0 text-t11 text-textSecondary" title={sector}>
      <SectorMark sector={sector} />
      <span className="min-w-0 truncate">{sector}</span>
    </span>
  ) : (
    <span className="font-mono text-t10 text-textMuted" title="Sector is not filed for this name">—</span>
  );
};

/* the rows' prices come in bulk off the screener (liveFiles.useScreenerQuotes); a name off the screen shows a dash */
const batchWords = (b: BatchQuote): string => {
  if (b.live) return `${b.price.toFixed(2)}${b.tapeAt ? ` · ${nyClock(b.tapeAt, { zone: true })}` : ''}`;
  return b.ext != null ? `${b.price.toFixed(2)} close · ${b.ext.toFixed(2)} outside the session${b.tapeAt ? ` ${nyClock(b.tapeAt, { zone: true })}` : ''}` : `${b.price.toFixed(2)} close`;
};
/* an extended move under 0.005% is not shown */
const EXT_FLOOR = 0.005;
const batchExt = (b: BatchQuote, ticker: string): string | null => (b.live || b.extPct == null || Math.abs(b.extPct) < EXT_FLOOR ? null : `${sessionWord(b, ticker)} ${b.extPct >= 0 ? '+' : '−'}${Math.abs(b.extPct).toFixed(2)}%`);
/* Pre-market only once a pre-market print exists: the name's live quote says so, or its screener row is already dated
   today before the open on a trading day. Otherwise the move is the last session's after hours. */
const sessionWord = (b: BatchQuote, ticker: string): 'pre-market' | 'after hours' => {
  const q = peekQuote(ticker);
  if (q) return q.phase === 'pre' ? 'pre-market' : 'after hours';
  const today = nyIsoDate();
  const [y, m, d] = today.split('-').map(Number);
  return isTradingDay(new Date(y, m - 1, d)) && nySessionPhase() === 'before' && b.rowDate === today ? 'pre-market' : 'after hours';
};
const LastCell = ({ data }: ICellRendererParams<StockPick>) => {
  const b = useBatchQuote(data?.ticker);
  if (!data) return null;
  const px = b?.price ?? (data.price > 0 ? data.price : 0);
  if (!(px > 0)) return <span className="font-mono text-t11 text-textMuted" title="No price on the feed">—</span>;
  const title = b ? batchWords(b) : data.extPrice != null ? `${data.price.toFixed(2)} close · ${data.extPrice.toFixed(2)} outside the session` : `${data.price.toFixed(2)}`;
  return <span className="font-mono text-t11 tnum text-textPrimary" title={title}>${px.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
};
const TodayCell = ({ data }: ICellRendererParams<StockPick>) => {
  const b = useBatchQuote(data?.ticker);
  if (!data) return null;
  if (data.listedOnly && !b) return <span className="font-mono text-t11 text-textMuted" title="No screen on this name">—</span>;
  const pre = b ? !b.live : false;
  const chg = b ? b.pct ?? data.changePct : data.changePct;
  const ext = b ? batchExt(b, data.ticker) : data.extPct != null && Math.abs(data.extPct) >= EXT_FLOOR ? `after hours ${data.extPct >= 0 ? '+' : '−'}${Math.abs(data.extPct).toFixed(2)}%` : null;
  const day = b && !b.live ? ` (${b.date})` : '';
  return (
    <span className="flex flex-col items-end justify-center h-full leading-tight" title={`${pre ? `The last session's change${day}` : "The regular session's change"}${ext ? ` · ${ext}, kept apart` : ''}`}>
      <span className={`font-mono text-t11 tnum ${dirInk(chg)}`}>{signedPct(chg, 2)}</span>
      {ext ? <span className="font-mono text-t8 tnum text-textMuted whitespace-nowrap">{ext.replace('after hours', 'AH').replace('pre-market', 'pre')}</span> : null}
    </span>
  );
};
const TrendCell = ({ data }: ICellRendererParams<StockPick>) => {
  if (!data || data.trend.length < 2) return <span className="font-mono text-t10 text-textMuted">—</span>;
  const first = data.trend[0];
  const last = data.trend[data.trend.length - 1];
  const chg = first > 0 ? ((last - first) / first) * 100 : 0;
  return (
    <span className="flex items-center gap-1.5 cursor-help" title={`The closes a year ago, six, three and one month ago, a week ago and now: ${data.trend.map(v => v.toFixed(2)).join(' → ')} — ${signedPct(chg)} over the span`}>
      <Sparkline data={data.trend} up={last >= first} width={56} height={20} />
      <span className={`font-mono text-t9 tnum ${dirInk(chg)}`}>{signedPct(chg, 1)}</span>
    </span>
  );
};

/** A sleeve as a bar against the 50 line. A quiet sleeve was not on the feed and stays out of the screen. */
const sleeveCell =
  (key: keyof StockSleeves) =>
  ({ data }: ICellRendererParams<StockPick>) => {
    if (!data) return null;
    if (data.quiet.includes(key)) return <span className="font-mono text-t10 text-textMuted" title="Not on this feed — left out of the screen">—</span>;
    const v = data.sleeves[key];
    const g = gradeOfComposite(v);
    /* the grade word beside the bar, the measures it is read from on hover */
    const note = data.sleeveNotes?.[key];
    return (
      <span className="flex items-center gap-1.5 h-full w-full pr-2 cursor-help" title={`${SLEEVE_NAME[key]} reads ${g} (${v > 50 ? 'above the 50 line — for the name' : 'below the 50 line — against it'})${note ? `. ${note}` : ''}`} data-sleeve={key} data-grade={g}>
        <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
          <span className={`absolute left-0 top-0 h-full rounded-full ${v > 50 ? 'bg-bull' : 'bg-bear/70'}`} style={{ width: `${v}%` }} />
        </span>
        <span className={`shrink-0 font-mono text-t8 uppercase tracking-widest ${GRADE_WORD_INK[g]}`}>{g}</span>
      </span>
    );
  };

/* the grade's ingredients in one hover */
const pickHelp = (p: StockPick): string =>
  gradeHelp({
    composite: p.composite,
    pillars: [
      { key: 'trend', score: p.sleeves.momentum, inRead: !p.quiet.includes('momentum') },
      { key: 'numbers', score: p.sleeves.quality, inRead: !p.quiet.includes('quality') },
      { key: 'money', score: p.sleeves.flow, inRead: !p.quiet.includes('flow') },
    ],
  });
const ScreenCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    data.listedOnly ? (
      <span className="font-mono text-t10 text-textMuted" title="Listed. No screen — the sleeves were not scored">No screen</span>
    ) : (
    <span className="inline-flex items-center gap-1.5 font-mono text-t10 font-semibold uppercase tracking-wider text-textPrimary cursor-help" title={pickHelp(data)}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SCREEN_DOT[gradeOfPick(data)]}`} />
      {gradeOfPick(data).toUpperCase()}
    </span>
    )
  ) : null;

const WhyCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="block py-1 text-t11 leading-snug text-textSecondary whitespace-normal break-words line-clamp-3" title={data.thesis}>
      {data.thesis}
    </span>
  ) : null;

/* the phone card: the name, the price and the day, the grade and the three pillars' words */
const StockCard = (p: StockPick) => {
  const g = gradeOfPick(p);
  const sleeve = (k: keyof StockSleeves, label: string) =>
    p.quiet.includes(k) ? null : (
      <span key={k} title={p.sleeveNotes?.[k]}>
        {label} <span className={GRADE_WORD_INK[gradeOfComposite(p.sleeves[k])]}>{gradeOfComposite(p.sleeves[k])}</span>
      </span>
    );
  return (
    <>
      <CardLine
        left={
          <span className="inline-flex items-center gap-2 min-w-0">
            <CompanyLogo ticker={p.ticker} size={16} />
            <span className="font-mono font-bold">{p.ticker}</span>
            <span className="text-t105 text-textMuted truncate"><CoSub ticker={p.ticker} fallback={filedName(p.ticker, p.name)} className="text-t105 text-textMuted truncate" /></span>
          </span>
        }
        right={
          <span className="inline-flex items-baseline gap-2">
            <LastCell {...({ data: p } as ICellRendererParams<StockPick>)} />
            <TodayCell {...({ data: p } as ICellRendererParams<StockPick>)} />
          </span>
        }
      />
      <CardLine
        muted
        left={
          <span className="inline-flex flex-wrap gap-x-2 font-mono text-t9 uppercase tracking-widest">
            {[sleeve('momentum', 'trend'), sleeve('quality', 'numbers'), sleeve('flow', 'money')].filter(Boolean)}
          </span>
        }
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-t10 font-semibold uppercase tracking-wider text-textPrimary">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SCREEN_DOT[g]}`} />
            {g}
          </span>
        }
      />
      <CardLine muted left={<span className="text-t105">{(lookup(p.ticker)?.sector ?? (p.listedOnly ? null : p.sector)) ?? '—'} · {p.thesis}</span>} />
    </>
  );
};

/* ---- the rotation -------------------------------------------------------------- */

/** One sector on the ladder: the rank and mark, the bar as a share of the leader's screen, the direction word, the two windows. A click keeps the grid to its names. */
const SectorCard = ({ s, rank, leader, top, on, onToggle }: { s: SectorRow; rank: number; leader: boolean; top: number; on: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={on}
    title={`${s.count} ${s.count === 1 ? 'name' : 'names'}. Against the board: ${signedPct(s.rs1w).replace('%', ' pts')} on the week, ${signedPct(s.rs1m).replace('%', ' pts')} on the month. ${on ? 'Click to show every sector.' : `Click to keep the grid to ${s.sector}.`}`}
    className={`group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`}
    data-stocks-sector={s.sector}
    data-on={on || undefined}
  >
    <span className="flex items-center gap-1.5 min-w-0 h-[18px]">
      <span className="font-mono text-t9 text-textMuted tnum">{String(rank).padStart(2, '0')}</span>
      <SectorMark sector={s.sector} />
      <span className="text-t11 font-bold text-textPrimary truncate">{SHORT_SECTOR[s.sector] ?? s.sector}</span>
    </span>
    <span className="mt-1.5 block h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
      <span className={`block h-full rounded-full ${leader ? 'bg-supreme' : PHASE_BAR[s.phase]}`} style={{ width: `${Math.round((s.score / top) * 100)}%` }} />
    </span>
    <span className={`mt-1 block h-[12px] font-mono text-t8 uppercase tracking-widest whitespace-nowrap ${leader ? 'text-supreme' : PHASE_INK[s.phase]}`}>{leader ? 'LEADING' : PHASE_WORD[s.phase]}</span>
    {/* the members' real return, and the return against the board said as points */}
    <span className="mt-0.5 block h-[12px] font-mono text-t9 tnum whitespace-nowrap overflow-hidden">
      <span className="text-textMuted">1w </span>
      <span className={s.ret1w != null ? dirInk(s.ret1w) : 'text-textMuted'}>{s.ret1w != null ? signedPct(s.ret1w) : '—'}</span>
      <span className="text-textMuted"> · 1m </span>
      <span className={s.ret1m != null ? dirInk(s.ret1m) : 'text-textMuted'}>{s.ret1m != null ? signedPct(s.ret1m) : '—'}</span>
    </span>
    <span className="mt-0.5 block h-[12px] font-mono text-t8 tnum whitespace-nowrap overflow-hidden text-textMuted">
      <span className={dirInk(s.rs1m)}>{s.rs1m > 0 ? '+' : s.rs1m < 0 ? '−' : ''}{Math.abs(s.rs1m).toFixed(1)} pts</span> vs board, 1m · {s.count} {s.count === 1 ? 'name' : 'names'}
    </span>
  </button>
);

/* ---- the page ------------------------------------------------------------------ */

const Stocks = () => {
  const navigate = useNavigate();
  const phone = usePhoneCards();
  const boardNames = useBoardNames();
  const [screen, setScreen] = useState<ScreenPick>('all');
  const [sector, setSector] = useState<SectorPick>('all');
  const [names, setNames] = useState<NamesPick>('all');

  /* The board is deterministic per session day; the rotation rolls it up */
  const liveBoard = useLiveStocks();
  const picks = liveBoard.picks;
  /* no names, no rotation: with nothing landed the sector ladder was ranking empty sectors ("LEADING" on all ten) and
     the sentence called the leader — the page now says the read did not land, or that it is still reading */
  const failed = liveBoard.status === 'error' || (liveBoard.status === 'live' && picks.length === 0);
  const waiting = liveBoard.status === 'loading' && picks.length === 0;
  const quiet = failed || waiting;
  const sectors = useMemo(() => buildSectorBoard(picks), [picks]);
  /* before any name lands there is no sector; the head says so through `quiet` */
  const top = sectors[0] ?? NO_SECTOR;
  const bottom = sectors[sectors.length - 1] ?? NO_SECTOR;

  /* The cards cut the board; the Filter keeps from the cut */
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return picks.filter(p => (screen === 'all' || gradeOfPick(p) === screen) && (sector === 'all' || p.sector === sector) && (names === 'all' || board.has(p.ticker)));
  }, [picks, screen, sector, names, boardNames]);

  /* The filter reads the names on the cut; any pick keeps its row. Sectors are the Sector control's and the rotation's. */
  const [filter, setFilter] = useState<string[]>([]);
  const [find, setFind] = useState('');
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const byName = new Map(cut.map(p => [p.ticker, p.name]));
    filter.forEach(f => {
      const key = f.replace(/^name:/, '');
      if (!byName.has(key)) byName.set(key, picks.find(p => p.ticker === key)?.name ?? key);
    });
    return [{ title: 'Names on the page', options: [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => ({ value: `name:${t}`, label: t, hint: n, count: cut.some(p => p.ticker === t) ? 1 : 0 })) }];
  }, [cut, filter, picks]);
  const rows = useMemo(() => {
    const query = find.trim();
    const blankOf = (symbol: string, known: string): StockPick => ({
      ticker: symbol,
      name: known || symbol,
      sector: lookup(symbol)?.sector ?? 'Technology',
      price: 0,
      changePct: 0,
      sleeves: { momentum: 0, quality: 0, flow: 0, news: 0 },
      quiet: ['momentum', 'quality', 'flow', 'news'],
      composite: 0,
      verdict: 'HOLD',
      thesis: 'Listed, not on the screen. Open the name for its page.',
      trend: [],
      listedOnly: true,
    });
    if (query) {
      const hits = searchListed('equity', query, SEARCH_ROWS * 2, searchTickers(query, SEARCH_ROWS * 2), companyName).filter(h => COMMON_SYMBOL.test(h.symbol));
      return hits.slice(0, SEARCH_ROWS).map(hit => picks.find(p => p.ticker === hit.symbol) ?? blankOf(hit.symbol, filedName(hit.symbol, hit.name)));
    }
    if (filter.length === 0) return cut;
    const on = new Set(filter);
    return cut.filter(p => on.has(`name:${p.ticker}`));
  }, [cut, filter, find, picks]);

  const facts = useMemo(() => {
    const scored = rows.filter(p => !p.listedOnly);
    const count = (g: Grade) => scored.filter(p => gradeOfPick(p) === g).length;
    const strong = count('strong');
    const good = count('good');
    const weak = count('poor');
    /* price above its 50-day average */
    const placed = scored.map(aboveFifty).filter((v): v is boolean => v != null);
    const breadth = placed.length ? Math.round((placed.filter(Boolean).length / placed.length) * 100) : 0;
    /* A search hit with no screen is not caution. The counts are the scored rows only. */
    return { names: scored.length, strong, good, mixed: scored.length - strong - good - weak, weak, breadth };
  }, [rows]);

  /* The leader is never called a laggard in the same breath: rank and direction are different axes */
  const laggards = sectors.filter(s => s.phase === 'LAGGING' && s.score !== top.score).map(s => s.sector);
  const toggleSector = (s: Sector) => setSector(v => (v === s ? 'all' : s));

  const sentence = useMemo<ReactNode>(
    () => (
      <>
        <span className="text-supreme font-semibold">{top.sector}</span> leads the rotation{sectors[1] ? `, ${sectors[1].sector} close behind` : ''}
        {laggards.length > 0 ? (
          <>
            {' — '}
            <span className="text-bear font-semibold">{listPhrase(laggards)}</span> {laggards.length === 1 ? 'is' : 'are'} falling on both windows
          </>
        ) : (
          ' — no sector is falling on both windows'
        )}
        . <span className="text-textPrimary font-semibold">{facts.breadth}%</span> of the names here sit above their 50-day average;{' '}
        <span className="text-bull font-semibold">{facts.strong + facts.good}</span> read good or better, <span className="text-bear font-semibold">{facts.weak}</span> poor.
      </>
    ),
    [top, sectors, laggards, facts]
  );

  const newsQuiet = picks.length > 0 && picks.every(p => p.quiet.includes('news'));
  /* in the session the column is today; outside it, the last session's date */
  /* the scored names, plus the newest page of the unscreened list — never the whole 26k in one quote */
  const quoteTickers = useMemo(() => picks.map(p => p.ticker), [picks]);
  useScreenerQuotes(quoteTickers);
  /* a house name the screener has no row for (BYDDY) is said, never silently dropped */
  const unscreened = useMemo(() => (liveBoard.status === 'live' && picks.length ? UNIVERSE.filter(u => !picks.some(p => p.ticker === u.ticker)).map(u => u.ticker) : []), [liveBoard.status, picks]);
  /* the day the rows' change belongs to, off the rows' own bulk read */
  const headBatch = useBatchQuote(picks[0]?.ticker);
  const headDate = headBatch ? (headBatch.live ? null : headBatch.date) : picks[0]?.sessionDate && picks[0].sessionDate !== nyIsoDate() ? picks[0].sessionDate : null;
  const dayHead = headDate ? shortDayWord(headDate) : 'Today';

  const columnDefs = useMemo<ColDef<StockPick>[]>(() => {
    const cols: ColDef<StockPick>[] = [
      /* the fixed widths add to ~1130px so the Why column lands inside a laptop's grid instead of past its right edge */
      { headerName: 'Name', field: 'ticker', flex: 1, minWidth: 124, cellRenderer: NameCell, headerTooltip: 'The company — click the row to open the name’s file' },
      { headerName: 'Sector', field: 'sector', width: 118, cellRenderer: SectorCell, headerTooltip: 'The sector the name files under' },
      { headerName: 'Last', field: 'price', width: 84, cellRenderer: LastCell, valueGetter: p => (p.data ? peekBatchQuote(p.data.ticker)?.price || p.data.price : 0), type: 'rightAligned', headerTooltip: 'The last price in the session; the regular close outside it (hover for the extended print, ET)' },
      { headerName: dayHead, field: 'changePct', width: 78, cellRenderer: TodayCell, valueGetter: p => (p.data ? peekBatchQuote(p.data.ticker)?.pct ?? p.data.changePct : 0), type: 'rightAligned', headerTooltip: "The regular session's change (the last session's outside it); the extended move sits under it" },
      { headerName: 'Year', field: 'trend', width: 116, cellRenderer: TrendCell, cellDataType: false, sortable: false, headerTooltip: 'The close a year ago, then six months, three months, a month, a week, and now. Not a daily path.' },
      { headerName: 'Trend', colId: 'momentum', valueGetter: p => p.data?.sleeves.momentum ?? 0, width: 96, cellRenderer: sleeveCell('momentum'), headerTooltip: "Price against its 20-day EMA, RSI, ADX with the week's direction, and the month. Hover for the figures." },
      { headerName: 'Numbers', colId: 'quality', valueGetter: p => p.data?.sleeves.quality ?? 0, width: 96, cellRenderer: sleeveCell('quality'), headerTooltip: 'Earnings growth a year (the slowest of the 1-, 2- and 3-year rates) and the change in share count. Hover for the figures.' },
      { headerName: 'Money', colId: 'flow', valueGetter: p => p.data?.sleeves.flow ?? 0, width: 96, cellRenderer: sleeveCell('flow'), headerTooltip: 'Relative volume and the side of the options premium. Under $1M of premium it is not scored.' },
    ];
    if (!newsQuiet) cols.push({ headerName: 'News', colId: 'news', valueGetter: p => p.data?.sleeves.news ?? 0, width: 88, cellRenderer: sleeveCell('news'), headerTooltip: "The wire's lean on the name. A dash stays out of the screen." });
    cols.push(
      { headerName: 'Screen', field: 'verdict', width: 92, cellRenderer: ScreenCell, comparator: (_a: StockVerdict, _b: StockVerdict, na, nb) => GRADE_RANK.indexOf(na.data ? gradeOfPick(na.data) : 'poor') - GRADE_RANK.indexOf(nb.data ? gradeOfPick(nb.data) : 'poor'), headerTooltip: 'The trend (32%), the numbers (24%) and the money (26%) in one word. Hover a cell for its sums. A state, never an instruction.' },
      { headerName: 'Why', field: 'thesis', flex: 2.4, minWidth: 230, cellRenderer: WhyCell, sortable: false, headerTooltip: 'What is for the name and what is against it' },
    );
    return cols;
  }, [newsQuiet, dayHead]);
  const defaultColDef = useMemo<ColDef<StockPick>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);

  /* the grid stays mounted, so a new cut replays the house soft-in over its window */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cutKey = `${screen}|${sector}|${names}|${filter.join(',')}`;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('animate-soft-in');
    void el.offsetWidth; // the reflow that lets the animation start again
    el.classList.add('animate-soft-in');
  }, [cutKey]);

  /* a row opens the name's own page */
  const open = (e: RowClickedEvent<StockPick>) => {
    if (!e.data) return;
    navigate(`/dossier/stocks/${e.data.ticker}`);
  };

  return (
    <RecordPanel testId="stocks" attrs={{ 'data-screen': screen, 'data-sector': sector, 'data-rows': rows.length }}>
      <RecordHead
        title="How every name screens"
        guide={{ title: 'How to read the screens', door: 'What the measures, the screen and the rotation mean', testId: 'stocks-guide', body: <StocksGuide /> }}
        kept={liveBoard.keptAt}
        line={
          <span title={unscreened.length ? `${unscreened.join(', ')} ${unscreened.length === 1 ? 'is' : 'are'} on the house list with no row on the screener` : undefined}>
            The house list, graded on the trend, the numbers and the money · search finds any listed stock · a row opens the name
          </span>
        }
        facts={
          <>
            <HeadFact label="Names" testId="stocks-names" tip="The names with a screen, by grade. Hover a Screen cell for how a grade is made">
              <span data-stocks-names>
                {quiet ? '—' : <>{facts.names} <span className="text-textMuted">·</span> <span className="text-bull font-semibold">{facts.strong} strong</span> <span className="text-textMuted">·</span> <span className="text-bull">{facts.good} good</span> <span className="text-textMuted">·</span> <span className="text-warn">{facts.mixed} caution</span> <span className="text-textMuted">·</span> <span className="text-bear">{facts.weak} poor</span></>}
              </span>
            </HeadFact>
            <HeadFact label="Above their 50-day" testId="stocks-breadth" tone={quiet ? 'text-textMuted' : facts.breadth >= 55 ? 'text-bull' : facts.breadth <= 40 ? 'text-bear' : undefined} tip="The share of the names whose last price is above their 50-day simple average">
              <span data-stocks-breadth>{quiet ? '—' : `${facts.breadth}%`}</span>
            </HeadFact>
            <HeadFact label="Leading sector" testId="stocks-leader">
              <span data-stocks-leader>
                {quiet ? '—' : (
                  <button type="button" onClick={() => toggleSector(top.sector)} title={`Keep the grid to ${top.sector}`} className="text-supreme font-semibold hover:underline underline-offset-2">
                    {top.sector}
                  </button>
                )}
              </span>
            </HeadFact>
            <HeadFact label="Ranked last" testId="stocks-trailer" tip="The sector whose names grade worst, its direction beside it; it can rank last and still be turning up">
              <span data-stocks-trailer>
                {quiet ? '—' : (
                  <button type="button" onClick={() => toggleSector(bottom.sector)} title={`Keep the grid to ${bottom.sector}`} className="text-bear hover:underline underline-offset-2">
                    {bottom.sector} <span className="text-textMuted font-normal">· {PHASE_WORD[bottom.phase].toLowerCase()}</span>
                  </button>
                )}
              </span>
            </HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the rotation" testId="stocks">
      <Controls testId="stocks">
        <DropdownSelect label="Screen" value={screen} options={SCREEN_OPTIONS} onChange={setScreen} title="Which screens" testId="stocks-screen" />
        <DropdownSelect label="Sector" value={sector} options={SECTOR_OPTIONS} onChange={setSector} title="Which sector" testId="stocks-sector" />
        <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="stocks-names" />
        <input
          value={find}
          onChange={e => setFind(e.target.value)}
          placeholder="Find any listed stock"
          aria-label="Find any listed stock"
          className="h-7 w-44 rounded border border-borderMuted bg-transparent px-2 font-mono text-t11 text-textPrimary placeholder:text-textMuted"
        />
        <DropdownMulti label="Filter" values={filter} groups={filterGroups} onChange={setFilter} title="The names on the page right now — tick any number; only those stay" testId="stocks-filter" />
      </Controls>
      {failed ? <FeedFallback /> : <Summary testId="stocks">{waiting ? 'Reading the screens.' : sentence}</Summary>}
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-stocks-rotation>
        <div className="w-full h-[26px] flex items-center gap-3 text-left text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:py-1.5" data-stocks-rotation-head>
          <span>The rotation</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary max-sm:hidden">sectors ranked by their names' screens · a click keeps the grid to a sector</span>
        </div>
        {/* two on a phone, four on a tablet, five across from a laptop */}
        {quiet ? (
          <div className="h-[70px] flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : 'Reading the screens'}</div>
        ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5" data-sectors={ROTATION_SECTORS}>
          {sectors.map((s, i) => (
            <SectorCard key={s.sector} s={s} rank={i + 1} leader={s.score === top.score} top={top.score} on={sector === s.sector} onToggle={() => toggleSector(s.sector)} />
          ))}
        </div>
        )}
      </div>
      </PhoneFold>
      {/* the grid scrolls inside a fixed window, so its rows virtualise */}
      <div ref={gridRef} className="slayer-board border-t border-borderSubtle" data-stocks-grid>
        {phone ? (
          <PhoneCards rows={rows} rowKey={p => p.ticker} card={StockCard} onOpen={p => navigate(`/dossier/stocks/${p.ticker}`)} empty={failed ? 'This read did not land' : waiting ? 'Reading the screens' : 'No name on this cut'} testId="stocks" resetKey={cutKey} />
        ) : (
        <AgGridProvider modules={GRID_MODULES}>
          <div style={{ height: Math.min(Math.max(rows.length, 3), GRID_ROWS) * ROW_H + 42 }}>
          <AgGridReact<StockPick>
            {...phonePin}
            theme={GRID_THEME}
            rowData={rows}
            rowHeight={ROW_H}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.ticker}
            onRowClicked={open}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
            overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : waiting ? 'Reading the screens' : 'No name on this cut')}
            key={failed ? 'failed' : waiting ? 'waiting' : 'live'}
          />
          </div>
        </AgGridProvider>
        )}
      </div>
      {rows.length > 0 && (
        <div className="px-5 py-2 border-t border-borderSubtle/60 font-mono text-t10 text-textMuted" data-stocks-more>
          {rows.length.toLocaleString()} {rows.length === 1 ? 'name' : 'names'}{find.trim() ? ' found' : ' with a screen · search finds any listed stock'}
        </div>
      )}
    </RecordPanel>
  );
};

export default Stocks;
