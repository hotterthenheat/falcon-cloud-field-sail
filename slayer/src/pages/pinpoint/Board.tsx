/*
==================================================
  SLAYER TERMINAL - THE BOARD
  (pages/pinpoint/Board.tsx)

  Everything at a glance — every name the desk
  covers, one row each, the reads the Map makes for
  one name made for all of them. Click a row and the
  Map becomes that name (the Pinpoint roadmap,
  2026-09-05).

  THE GRID IS AG GRID (community, MIT), not a table
  of our own — Noah, 2026-09-05: "research any
  libraries/ui designs that come prebuilt therefore
  we don't look like a kid learning html/css for the
  first time but an actual large scale company". AG
  Grid is the data grid the large shops ship:
  sorting, resizing, pinned columns, keyboard
  navigation, virtualised rows, and a theming API
  (v33+) that takes our tokens as parameters instead
  of a stylesheet to fight. The cells that carry
  meaning — the name with its logo, the regime word,
  the walls in their inks, the bell's share, the
  session sparkline — are React cell renderers, so
  the house grammar rides inside the grid rather than
  over it.
==================================================
*/

import { holdShort as holdShortOf } from '../../data/wall';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type IRowNode, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../../components/ui/houseGrid';
import { useTicker } from '../../context/MarketDataContext';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import { useBookRev, usePinpointFeed, peekEntry, peekIv, peekDaySigma, dayMoveWords, changeInk } from '../../data/uwBook';
import { useDistanceUnit } from '../../data/distanceUnits';
import { fmtDistance, impliedDaySigma } from '../../data/atr';
import { bellDay, todayScopeLabel } from '../../data/bookWindow';
import { buildBoardRow, netGexTitle, type BoardRow } from '../../data/board';
import { addBoardName, removeBoardName, useBoardNames } from '../../data/boardNames';
import { tickerName } from '../../data/tickers';
import TickerLookup from '../../components/ui/TickerLookup';
import useFocusTrap from '../../components/ui/useFocusTrap';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import { fmtUsd } from '../../data/gex';
import { REGIME_WORDS } from '../../data/flipGauge';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CALL_WALL, FLIP, LONG_GAMMA, PUT_WALL, SHORT_GAMMA, SUPREME, THERMAL_WARM } from '../../components/gex/paletteInk';
import { fmtDollars } from '../../data/ahead';
import { chanceLabel } from '../../data/wall';
import { nyClock } from '../../core/nyTime';
import { useLevelsScope } from '../../data/levelsScope';
import { BELL_NONE, BELL_NONE_TITLE } from '../../data/flipLevel';
import { BOARD_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { kindTip } from '../../components/gex/glossary';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const ROLE_INK: Record<string, string> = { 'call wall': CALL_WALL, 'put wall': PUT_WALL, supreme: SUPREME, flip: FLIP };
const WARM = THERMAL_WARM;

/** The board sweeps on the scan tier — a bird's-eye view must not vibrate per tick */
const SCAN_INTERVAL_MS = 10_000;
/* The grid's theme and modules are the house's (components/ui/houseGrid.ts) — the Record's tables wear the same */
const MODULES = GRID_MODULES;
const THEME = GRID_THEME;
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/* THE BOARD READS THE RULER (the third audit, 2026-10-23: $, % and σ all printed "+1.46%"): a distance from price in
   the desk's unit — dollars, percent, or the day's implied σ (the name's own IV). With no scale for the unit (no ATR on
   this feed) it falls back to dollars rather than print a unit with no number. */
const Dist = ({ ticker, spot, pct }: { ticker: string; spot: number; pct: number }) => {
  const unit = useDistanceUnit();
  if (unit === '%') return <>{fmtPct(pct)}</>;
  const delta = (pct / 100) * spot;
  return <>{fmtDistance(delta, spot, unit, { atr: null, sigma: unit === 'σ' ? peekDaySigma(ticker) ?? impliedDaySigma(spot, peekIv(ticker) ?? 0) : null })}</>;
};
/* the nearest wall with every level it is (core/walls.ts levelRoles) — "Put wall · supreme 769" */
const alsoSupreme = (row: BoardRow) => Math.abs(row.nearest.strike - row.supreme) < 1e-9;

// ---- cell renderers: the house grammar inside the grid -----------------------

/** What the grid hands every cell renderer (AgGridReact `context`) */
interface BoardContext {
  remove: (ticker: string) => void;
}

/* The × that takes a name off the board. A NATIVE handler on the button, not a
   React one: the grid's own row listeners hear the click before React's root
   does, so only a native stopPropagation at the target keeps the row from
   opening the name on the Map. Shown on the row's hover (index.css). */
const RemoveName = ({ ticker, remove }: { ticker: string; remove: (t: string) => void }) => {
  const ref = useCallback(
    (el: HTMLButtonElement | null) => {
      if (!el) return;
      el.onmousedown = e => e.stopPropagation();
      el.onclick = e => {
        e.stopPropagation();
        remove(ticker);
      };
    },
    [ticker, remove]
  );
  return (
    <button ref={ref} type="button" title="Take this name off the board" aria-label={`Take ${ticker} off the board`} className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]" data-board-remove>
      <X className="w-3 h-3" />
    </button>
  );
};

/* TODAY'S STRIKES NOT IN YET (the ship pass, 2026-10-22): until a name's front-date chain lands, its "Today" levels
   would be the whole book's — the cells say they are loading instead of printing the wrong book */
const Pending = ({ data }: { data: BoardRow }) => (
  <span className="font-mono text-[11px] text-textMuted" title={`Still loading the contracts that expire today on ${data.ticker} — the levels appear in a moment`} data-board-pending>
    …
  </span>
);

const NameCell = ({ data, context }: ICellRendererParams<BoardRow, unknown, BoardContext>) =>
  data ? (
    <span className="flex items-center gap-2 font-mono w-full">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="text-[12px] font-bold text-textPrimary">{data.ticker}</span>
      {context?.remove && <RemoveName ticker={data.ticker} remove={context.remove} />}
    </span>
  ) : null;

/* THE DAY'S CHANGE, NOT THE AFTER-HOURS MOVE (the second re-audit, 2026-10-22: SPY −0.00% on a −1.18% day): the regular
   session's change, with the move outside the session on its own labelled line; a zero change is neutral, never green */
const DayChange = ({ data, compact = false }: { data: BoardRow; compact?: boolean }) => {
  const w = dayMoveWords(data.day);
  if (!w) return null;
  const main = data.day?.phase === 'pre' ? data.day.extPct : data.day?.dayPct;
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-mono ${compact ? 'text-[11px]' : 'text-[10px]'} whitespace-nowrap`} title={w.title} data-day-change>
      <span style={{ color: changeInk(main) }}>{w.main}</span>
      {w.ext && <span className="text-textMuted">· {w.ext}</span>}
    </span>
  );
};

const SpotCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data ? (
    <TickFigure value={data.spot} className="inline-flex items-baseline gap-2 font-mono text-[12px]">
      <span className="text-textPrimary">${data.spot.toFixed(2)}</span>
      <DayChange data={data} />
    </TickFigure>
  ) : null;

const YoursCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  if (!data.yours.positions) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  return (
    <span className="font-mono text-[11px] tnum tabular-nums text-silver">
      {data.yours.contracts} contract{data.yours.contracts === 1 ? '' : 's'} · {data.yours.positions} position{data.yours.positions === 1 ? '' : 's'}
    </span>
  );
};

const RegimeCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  if (data.pending) return <Pending data={data} />;
  if (!data.regime) return <span className="font-mono text-[10px] text-textMuted">balanced</span>;
  const w = REGIME_WORDS[data.regime];
  /* a hair either side of the flip is neither regime (data/gex.ts readHeatPattern's AT_FLIP, 0.05%) */
  if (data.flipDistPct != null && Math.abs(data.flipDistPct) < 0.05) return <span className="font-mono text-[11px] text-textSecondary" title="Price is on the flip — dealer hedging can tip either way">on the flip</span>;
  /* The shell's words, not "LONG GAMMA" (2026-09-09): plain English on Pinpoint */
  return (
    <span className="font-mono text-[11px] tnum tabular-nums" style={{ color: data.regime === 'SHORT' ? SHORT_GAMMA : LONG_GAMMA }} title={`${w.label.toLowerCase()} — ${w.blurb}${data.flip != null ? `; the flip at ${fmtStrike(data.flip)} is where that changes` : '; no flip within ±10%'}`}>
      {data.regime === 'SHORT' ? 'amplifying moves' : 'absorbing moves'}
    </span>
  );
};

const FlipCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data && data.flip != null ? (
    <TickFigure value={data.flip} className="inline-flex items-baseline gap-2 font-mono">
      <span className="text-[11px] font-semibold" style={{ color: FLIP }}>
        {fmtStrike(data.flip)}
      </span>
      {data.flipDistPct != null && <span className="text-[10px] text-textSecondary"><Dist ticker={data.ticker} spot={data.spot} pct={data.flipDistPct} /></span>}
    </TickFigure>
  ) : data ? (
    <span className="font-mono text-[10px] text-textMuted" title={`No flip within ±10%: dealers are ${data.regime === 'LONG' ? 'long' : 'short'} gamma across the whole range`}>
      none nearby
    </span>
  ) : null;

const WallCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data ? (
    <span className="inline-flex items-baseline gap-2 font-mono tnum tabular-nums">
      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: data.nearest.kind === 'call' ? CALL_WALL : PUT_WALL }}>
        {data.nearest.kind === 'call' ? 'Call wall' : 'Put wall'}
        {alsoSupreme(data) && <span style={{ color: SUPREME }}> · supreme</span>}
      </span>
      <span className="text-[11px] font-semibold text-textPrimary">{fmtStrike(data.nearest.strike)}</span>
      <span className="text-[10px] text-textSecondary"><Dist ticker={data.ticker} spot={data.spot} pct={data.nearest.distPct} /></span>
    </span>
  ) : null;

/** The agenda's #1 for the name: the strike in its kind's ink, reached · holds, the dollars at stake */
const WatchCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  if (data.pending) return <Pending data={data} />;
  const w = data.watch;
  if (!w) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  const kind = w.role ?? (w.isShelf ? 'shelf' : w.isWall ? null : 'trapdoor');
  const ink = w.role ? ROLE_INK[w.role] : w.isShelf ? 'rgb(var(--text-muted))' : w.isWall ? undefined : WARM;
  /* TWO LINES, so nothing truncates ("$8(" at 1440): the strike and its kind, then the chance, the size and the dollars */
  return (
    <span className="flex flex-col justify-center leading-[14px] font-mono tnum tabular-nums min-w-0">
      <span className="inline-flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-textPrimary">{fmtStrike(w.strike)}</span>
        {kind && (
          <span className="text-[8px] uppercase tracking-widest" style={{ color: ink }} title={kindTip(kind)}>
            {kind}
          </span>
        )}
      </span>
      <span className="text-[10px] text-textSecondary whitespace-nowrap">
        {chanceLabel(w.reach)} reached
        {w.isShelf && (
          <>
            {' · '}
            <span style={{ color: SILVER }}>{holdShortOf(w.hold)} wall</span>
          </>
        )}
        <span className="text-textMuted"> · {fmtDollars(w.stake)}</span>
      </span>
    </span>
  );
};

const SupremeCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data ? (
    <span className="font-mono text-[11px] font-bold tnum tabular-nums" style={{ color: SUPREME }}>
      {fmtStrike(data.supreme)}
    </span>
  ) : null;

/* NET GEX IN THE RETAIL SIGN (the ship pass, 2026-10-22): positive = dealers long gamma = hedging absorbs moves = green;
   negative = short gamma = it amplifies them = red. The row carries the vendor's sign (data/board.ts retailNet). When
   the book's net and the side of the flip disagree, the hover says so in words rather than leaving two reads that look
   like a contradiction. */
const NetCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data ? (
    <TickFigure value={data.netGex} title={netGexTitle(data.netGex, data.regime)} className={`font-mono text-[11px] font-semibold ${data.netGex > 0 ? 'text-bull' : data.netGex < 0 ? 'text-bear' : 'text-textMuted'}`}>
      {data.netGex > 0 ? '+' : ''}
      {fmtUsd(data.netGex)}
    </TickFigure>
  ) : null;

const BellCell = ({ data }: ICellRendererParams<BoardRow>) =>
  !data ? null : data.bellShare != null ? (
    <span className="inline-flex items-center gap-2 font-mono tnum tabular-nums w-full" title={`${data.bellShare}% — ${bellDay().tip(data.ticker)}`}>
      <span className="text-[11px] text-textPrimary w-8 text-right">{data.bellShare}%</span>
      <span className="flex-1 h-[3px] rounded-full bg-ink/[0.06] overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${data.bellShare}%`, background: SUPREME, opacity: 0.7 }} />
      </span>
    </span>
  ) : (
    data.bellWhy === 'none' ? (
      <span className="font-mono text-[10px] text-textMuted" title={BELL_NONE_TITLE(data.ticker)}>
        {BELL_NONE}
      </span>
    ) : (
      <Pending data={data} />
    )
  );

const CrossCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data ? (
    <span
      className="font-mono text-[11px] tnum tabular-nums text-textSecondary"
      title={data.crossWhy ?? `Today's session against ${data.crossFlip != null ? `the ${fmtStrike(data.crossFlip)} flip of ` : ''}${data.crossLabel}`}
    >
      {data.crossWhy ? (data.crossWhy.startsWith('The session has not opened') ? 'opens 9:30' : 'not available') : data.crossings == null ? '—' : `${data.crossings}×`}
    </span>
  ) : null;

/** The session's closes as one quiet line — the day's shape, not a chart */
const SparkCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data || data.spark.length < 2) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  const W = 120;
  const H = 26;
  const min = Math.min(...data.spark);
  const max = Math.max(...data.spark);
  const span = max - min || 1;
  const pts = data.spark.map((v, i) => `${((i / (data.spark.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / span) * (H - 4)).toFixed(1)}`).join(' ');
  const up = data.spark[data.spark.length - 1] >= data.spark[0];
  return (
    <svg width={W} height={H} className="block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'rgb(var(--bull))' : 'rgb(var(--bear))'} strokeOpacity={0.85} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

/* THE PHONE'S BOARD IS CARDS, NOT A GRID (the retail test, 2026-10-22: the phone showed Name / Price / Hedging and hid
   the flip, the walls and the supreme behind a sideways scroll). One card a name, every read a phone needs first on it:
   price and the day's change, the regime, the flip and how far, the nearest wall, the supreme, net GEX. */
const PhoneCard = ({ row, onOpen, onRemove }: { row: BoardRow; onOpen: (t: string) => void; onRemove: (t: string) => void }) => {
  const label = (t: string, title?: string) => (
    <span className="text-[9px] uppercase tracking-widest text-textMuted" title={title}>
      {t}
    </span>
  );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.ticker)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row.ticker);
        }
      }}
      className="px-3 py-2.5 border-b border-borderSubtle/60 active:bg-ink/[0.04] font-mono"
      data-board-card={row.ticker}
    >
      <div className="flex items-center gap-2 min-w-0">
        <CompanyLogo ticker={row.ticker} size={18} />
        <span className="text-[13px] font-bold text-textPrimary">{row.ticker}</span>
        <span className="text-[13px] text-textPrimary tnum">${row.spot.toFixed(2)}</span>
        <span className="min-w-0 truncate">
          <DayChange data={row} compact />
        </span>
        <button
          type="button"
          aria-label={`Take ${row.ticker} off the board`}
          title="Take this name off the board"
          onClick={e => {
            e.stopPropagation();
            onRemove(row.ticker);
          }}
          className="ml-auto shrink-0 inline-flex items-center justify-center w-9 h-9 -mr-2 rounded text-textMuted"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {row.pending ? (
        <div className="mt-1 text-[11px] text-textMuted">Reading the levels…</div>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] tnum">
          <div className="flex flex-col min-w-0">
            {label('Hedging', 'What dealer hedging does at the current price')}
            <span style={{ color: row.regime === 'SHORT' ? SHORT_GAMMA : row.regime === 'LONG' ? LONG_GAMMA : undefined }} className="truncate">
              {row.regime === 'SHORT' ? 'amplifying moves' : row.regime === 'LONG' ? 'absorbing moves' : 'balanced'}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            {label('Net GEX', 'All the dealer hedging added up, dollars per 1% move — positive absorbs, negative amplifies')}
            <span className={row.netGex > 0 ? 'text-bull' : row.netGex < 0 ? 'text-bear' : 'text-textMuted'}>
              {row.netGex > 0 ? '+' : ''}
              {fmtUsd(row.netGex)}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            {label('Flip', 'The price where dealer hedging switches between absorbing and amplifying')}
            {row.flip != null ? (
              <span>
                <span style={{ color: FLIP }} className="font-semibold">
                  {fmtStrike(row.flip)}
                </span>
                {row.flipDistPct != null && <span className="text-textSecondary"> <Dist ticker={row.ticker} spot={row.spot} pct={row.flipDistPct} /></span>}
              </span>
            ) : (
              <span className="text-textMuted">none nearby</span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            {label('Nearest wall', 'The nearer of the call wall (most call gamma) and the put wall (most put gamma)')}
            <span className="truncate">
              <span style={{ color: row.nearest.kind === 'call' ? CALL_WALL : PUT_WALL }} className="text-[9px] font-bold uppercase tracking-wider">
                {row.nearest.kind === 'call' ? 'Call' : 'Put'}
                {alsoSupreme(row) && <span style={{ color: SUPREME }}> · supreme</span>}
              </span>{' '}
              <span className="font-semibold text-textPrimary">{fmtStrike(row.nearest.strike)}</span> <span className="text-textSecondary"><Dist ticker={row.ticker} spot={row.spot} pct={row.nearest.distPct} /></span>
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            {label('Supreme', 'The single strike with the most hedging on it')}
            <span className="font-bold" style={{ color: SUPREME }}>
              {fmtStrike(row.supreme)}
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            {label(bellDay().head, bellDay().tip(row.ticker))}
            <span className="text-textSecondary">{row.bellShare != null ? `${row.bellShare}%` : row.bellWhy === 'none' ? 'none' : '…'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const Board = () => {
  const { changeTicker } = useTicker();
  const navigate = useNavigate();
  /* THE NAMES ON THE BOARD — the list the user keeps (2026-09-09: twelve to
     start, add any listing, take any off) */
  const names = useBoardNames();
  usePinpointFeed(names[0]);
  const bookRev = useBookRev();
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [scanAt, setScanAt] = useState('');
  const lastRef = useRef(0);
  const runRef = useRef(0);
  /* ONE NAME PER MACROTASK: a name the simulator has not seen walks its whole
     history in (~0.6s), a seeded one takes ~20ms — twelve in one go would be
     one long task on every scan. Rows land as they are built; a run that is
     overtaken (the list changed, a new scan) stops where it is. */
  const rebuild = useCallback((list: string[], fresh: boolean) => {
    const run = ++runRef.current;
    if (fresh) setRows(prev => prev.filter(r => list.includes(r.ticker)));
    let i = 0;
    const step = () => {
      if (run !== runRef.current) return;
      if (i >= list.length) {
        /* New York's clock, said as such — the machine's own zone printed 18:xx on a 14:xx market */
        setScanAt(nyClock(Date.now(), { seconds: true, zone: true }));
        return;
      }
      const row = buildBoardRow(list[i++]);
      if (row)
        setRows(prev => {
          const at = prev.findIndex(r => r.ticker === row.ticker);
          if (at < 0) return [...prev, row];
          const next = prev.slice();
          next[at] = row;
          return next;
        });
      setTimeout(step, 0);
    };
    step();
  }, []);
  useEffect(() => {
    lastRef.current = Date.now();
    rebuild(names, true);
  }, [names, rebuild, bookRev]);
  useEffect(() => {
    const id = window.setInterval(() => {
      lastRef.current = Date.now();
      rebuild(names, false);
    }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [names, rebuild]);

  /* THE FILTER takes as many names as you like (Noah, 2026-09-09: "the filter
     only allows you to see one name at a time") — "SPY QQQ nvda" or commas;
     a row stays if any token starts its symbol or sits in its company name */
  const [quick, setQuick] = useState('');
  const tokens = useMemo(() => quick.toUpperCase().split(/[\s,]+/).filter(Boolean), [quick]);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const gridRef = useRef<AgGridReact<BoardRow>>(null);
  useEffect(() => {
    gridRef.current?.api?.onFilterChanged();
  }, [tokens]);
  const isExternalFilterPresent = useCallback(() => tokensRef.current.length > 0, []);
  const doesExternalFilterPass = useCallback((node: IRowNode<BoardRow>) => {
    const t = node.data?.ticker ?? '';
    const name = tickerName(t).toUpperCase();
    return tokensRef.current.some(tok => t.startsWith(tok) || name.includes(tok));
  }, []);

  /* ADD A NAME — the scope chip's menu, on the toolbar */
  const [adding, setAdding] = useState(false);
  const addRootRef = useRef<HTMLSpanElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef: addAnchor, placed: addPlaced } = useAnchoredMenu<HTMLButtonElement>(adding, 'bottom', 288, 'start');
  useFocusTrap(adding, addMenuRef);
  useEffect(() => {
    if (!adding) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (addRootRef.current?.contains(t) || addMenuRef.current?.contains(t)) return;
      setAdding(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAdding(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [adding]);
  const gridContext = useMemo<BoardContext>(() => ({ remove: removeBoardName }), []);

  /* THE COLUMNS FILL THE WIDTH — flex, not fixed pixels (Noah, 2026-09-05:
     "look at all the empty space on the right"). The name stays pinned at a
     fixed width; every other column takes its share of whatever is left.
     Headers in plain English — no jargon on this page. */
  /* EVERY HEAD EXPLAINS ITSELF ON HOVER (the lock walk, Noah, 2026-09-09: "certain
     row headers like 'expires today' need a brief hover description") — one
     sentence each, the grid's own tooltip, in the house clothes (index.css). */
  /* ON A PHONE (the ship pass, 2026-10-22): the name stays pinned and narrow, and the reads a phone needs first — price,
     the nearest wall and how far, the flip, the supreme, net GEX — come straight after it; the long ones (watch first,
     the day's path, crossings, positions) leave the grid there. Anything past the screen scrolls inside the grid. */
  const phone = useIsPhone();
  const levelsScope = useLevelsScope();
  const columnDefs = useMemo<ColDef<BoardRow>[]>(() => {
    const cols: ColDef<BoardRow>[] = [
      { headerName: 'Name', field: 'ticker', pinned: 'left', width: phone ? 92 : 130, cellRenderer: NameCell, sortable: true, headerTooltip: 'The stock or fund. Click a row to open it on the Map' },
      { headerName: 'Price', field: 'spot', flex: 1.6, minWidth: 250, cellRenderer: SpotCell, comparator: (a: number, b: number) => a - b, headerTooltip: "The last price and today's change" },
      { headerName: todayScopeLabel() === 'Today' ? 'Hedging today' : 'Hedging · next session', field: 'regime', flex: 1.1, minWidth: 170, cellRenderer: RegimeCell, headerTooltip: 'What dealer hedging is doing at the current price: absorbing moves when the net GEX beside it is positive (dealers long gamma), amplifying them when it is negative (short gamma). The flip is the price where that changes' },
      { headerName: levelsScope === 'ALL' ? 'Net GEX · all expiries' : `Net GEX · ${todayScopeLabel().toLowerCase()}`, field: 'netGex', flex: 1.1, minWidth: 150, cellRenderer: NetCell, comparator: (a: number, b: number) => Math.abs(a) - Math.abs(b), headerTooltip: 'Net GEX: all the dealer hedging on the name added up, in dollars per 1% move, on the contracts the Levels card picks. Positive (green) tends to absorb moves; negative (red) tends to amplify them' },
      {
        headerName: 'Flip · how far',
        field: 'flipDistPct',
        flex: 1.2,
        minWidth: 140,
        cellRenderer: FlipCell,
        sort: 'asc',
        headerTooltip: "The flip: the price where the name's net gamma, re-priced at that price, crosses zero — where dealer hedging switches between absorbing and amplifying moves — and how far it is from the current price. Names closest to their flip come first; \"none nearby\" means no crossing within 10%, and those come last",
        // Closest to flipping first — the names that can change character next
        comparator: (a: number | null, b: number | null) => Math.abs(a ?? 1e9) - Math.abs(b ?? 1e9),
      },
      {
        headerName: 'Nearest wall',
        field: 'nearest',
        flex: 1.3,
        minWidth: 170,
        cellRenderer: WallCell,
        cellDataType: false,
        headerTooltip: 'The nearer of the two walls and how far it is. The call wall is the strike with the most call gamma: while dealers are long gamma there it tends to slow a rise (above price it is a lid; once price is through it, it can act as support). The put wall is the strike with the most put gamma: below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling, or it can act as a magnet',
        comparator: (a: BoardRow['nearest'], b: BoardRow['nearest']) => Math.abs(a.distPct) - Math.abs(b.distPct),
      },
      { headerName: 'Supreme', field: 'supreme', flex: 0.7, minWidth: 84, cellRenderer: SupremeCell, headerTooltip: 'The supreme: the single strike with the most hedging on it, read off the contracts the Levels card picks (Today or All expiries). The Map, the Agenda and Compare show the same number' },
      {
        headerName: 'Watch first',
        field: 'watch',
        flex: 1.6,
        minWidth: 220,
        cellRenderer: WatchCell,
        cellDataType: false,
        headerTooltip: 'The one price to watch first: the strike price is most likely to reach with the most hedging behind it. "Reached" is the chance price gets there today; "% of the top wall" is its size against the biggest wall on this name; the dollar figure is the hedging parked there',
        // The name whose first target matters most, first
        comparator: (a: BoardRow['watch'], b: BoardRow['watch']) => (a ? a.reach * a.stake : -1) - (b ? b.reach * b.stake : -1),
      },
      { headerName: bellDay().head, field: 'bellShare', flex: 1.2, minWidth: 140, cellRenderer: BellCell, headerTooltip: `${bellDay().tip("the name")}. A dash means nothing on the name expires that day` },
      { headerName: 'Flip crossed today', field: 'crossings', flex: 1.1, minWidth: 150, cellRenderer: CrossCell, headerTooltip: "How many times price crossed the flip in today's session — the flip of the contracts that were live in it (after the close, today's own book, not the next session's). The more crossings, the less either side of it means" },
      { headerName: 'Today so far', field: 'spark', flex: 1.2, minWidth: 140, cellRenderer: SparkCell, cellDataType: false, sortable: false, headerTooltip: 'The price path since the open' },
      {
        headerName: 'Your positions',
        field: 'yours',
        flex: 1,
        minWidth: 120,
        cellRenderer: YoursCell,
        cellDataType: false,
        headerTooltip: 'The contracts you hold on this name',
        comparator: (a: BoardRow['yours'], b: BoardRow['yours']) => a.contracts - b.contracts,
      },
    ];
    if (!phone) return cols;
    const order = ['ticker', 'spot', 'regime', 'netGex', 'flipDistPct', 'nearest', 'supreme', 'bellShare'];
    return order.map(f => cols.find(c => c.field === f)).filter((c): c is ColDef<BoardRow> => !!c).map(c => (c.field === 'ticker' ? c : { ...c, flex: undefined, width: c.minWidth }));
  }, [phone, levelsScope]);
  const defaultColDef = useMemo<ColDef<BoardRow>>(() => ({ sortable: true, resizable: true, suppressMovable: true, headerClass: 'bg-chip' }), []);

  const open = (e: RowClickedEvent<BoardRow>) => {
    if (!e.data) return;
    changeTicker(e.data.ticker);
    navigate('/pinpoint/map');
  };

  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const [moreRight, setMoreRight] = useState(false);
  const measureRight = useCallback(() => {
    const vp = boardWrapRef.current?.querySelector<HTMLElement>('.ag-body-horizontal-scroll-viewport');
    setMoreRight(!!vp && vp.scrollWidth - vp.clientWidth - vp.scrollLeft > 4);
  }, []);
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    el.addEventListener('scroll', measureRight, true);
    window.addEventListener('resize', measureRight);
    return () => {
      el.removeEventListener('scroll', measureRight, true);
      window.removeEventListener('resize', measureRight);
    };
  }, [measureRight, rows.length]);

  const stamps = names.map(n => peekEntry(n));
  const bookAt = stamps.reduce<number | null>((best, e) => (e && e.at > 0 ? (best == null ? e.at : Math.min(best, e.at)) : best), null);
  const bookDown = names.length > 0 && stamps.length > 0 && stamps.every(e => e?.status === 'error');
  return (
    /* THE BOARD IS AS TALL AS ITS ROWS (the ship pass, 2026-10-22): a fixed box showed ~15 of 20 names with a row cut
       at its foot and empty page under it. Every name shows; the page scrolls, never the grid. */
    <div className="border border-borderSubtle rounded-md overflow-clip flex flex-col" data-board>
      <div className="shrink-0 flex items-center gap-3 flex-wrap px-2 py-1.5 bg-panel border-b border-borderSubtle/70" data-board-toolbar>
        <span className="font-mono text-[9px] uppercase tracking-widest text-textSecondary">The names on your board</span>
        <StaleMark at={bookAt} ttlMs={BOARD_TTL_MS} fault={bookDown ? 'failed' : null} />
        <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted tnum tabular-nums" data-board-count>
          {rows.length < names.length ? `still reading ${names.filter(n => !rows.some(r => r.ticker === n)).slice(0, 4).join(' ')}` : `${names.length} names`} · closest to its flip first · click a name to open it on the map
        </span>
        <input
          value={quick}
          onChange={e => setQuick(e.target.value)}
          placeholder="Filter · SPY QQQ NVDA"
          aria-label="Filter names — as many as you like, spaces or commas between"
          title="As many names as you like, spaces or commas between"
          className="ml-auto flex-1 min-w-[9rem] sm:flex-none sm:w-44 h-7 max-sm:h-10 bg-transparent border border-borderSubtle rounded-md px-2 font-mono text-[10px] text-textPrimary placeholder:text-textMuted focus:outline-none focus:border-silver/50"
          data-board-filter
        />
        <span ref={addRootRef} className="relative inline-flex">
          <button
            ref={addAnchor}
            type="button"
            onClick={() => setAdding(v => !v)}
            aria-expanded={adding}
            title="Add a name to the board"
            className={`inline-flex items-center gap-1.5 h-7 max-sm:h-10 px-2.5 rounded-md border bg-chip transition-colors font-mono select-none ${adding ? 'border-silver/50' : 'border-borderSubtle hover:border-borderMuted'}`}
            data-board-add
          >
            <Plus className="w-3 h-3 text-textMuted" />
            <span className="text-[11px] font-semibold text-textPrimary">Add a name</span>
          </button>
          {adding &&
            addPlaced &&
            createPortal(
              <div
                ref={addMenuRef}
                role="dialog"
                aria-label="Add a name to the board"
                style={{ position: 'fixed', ...addPlaced.box }}
                className="z-[120] w-72 border border-borderMuted bg-panel/80 backdrop-blur-xl backdrop-saturate-150 rounded-md shadow-2xl shadow-black/60 overflow-x-hidden overflow-y-auto overscroll-contain animate-slide-in"
                data-board-add-menu
              >
                <div className="px-2.5 py-1.5 border-b border-borderSubtle text-[10px] text-textMuted">Add a name to the board — it stays until you take it off</div>
                <TickerLookup
                  onPick={sym => {
                    addBoardName(sym);
                    setAdding(false);
                  }}
                />
              </div>,
              document.body
            )}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted tnum tabular-nums">updated {scanAt} · every 10s</span>
      </div>
      {bookDown && rows.length === 0 ? (
        <FeedFallback fault="failed" />
      ) : phone ? (
        <div data-board-cards>
          {rows.length === 0 && <p className="px-3 py-4 font-mono text-[11px] text-textSecondary">Still reading the book</p>}
          {[...rows]
            .filter(r => !tokens.length || tokens.some(tok => r.ticker.startsWith(tok) || tickerName(r.ticker).toUpperCase().includes(tok)))
            .sort((a, b) => Math.abs(a.flipDistPct ?? 1e9) - Math.abs(b.flipDistPct ?? 1e9))
            .map(r => (
              <PhoneCard
                key={r.ticker}
                row={r}
                onRemove={removeBoardName}
                onOpen={t => {
                  changeTicker(t);
                  navigate('/pinpoint/map');
                }}
              />
            ))}
        </div>
      ) : (
      /* MORE TO THE RIGHT, SAID (the UI sweep, 2026-10-22): twelve columns run past a laptop's width and the last one
         stood cut at the edge ("$354.9", "Net GEX to") as if broken — a fade now says the grid scrolls on, and the
         scrollbar stays up */
      <div ref={boardWrapRef} className="slayer-board relative" data-more-right={moreRight || undefined}>
        {moreRight && <span aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-3 w-16 z-20 bg-gradient-to-l from-panel via-panel/70 to-transparent" />}
        <AgGridProvider modules={MODULES}>
          <AgGridReact<BoardRow>
            ref={gridRef}
            theme={THEME}
            domLayout="autoHeight"
            rowData={rows}
            onRowDataUpdated={e => {
              if (e.api.getDisplayedRowCount() > 0) e.api.hideOverlay();
              /* EVERY CELL REDRAWS WHEN A ROW LANDS (the audit's B1: the renderers read `pending` and the bell's reason, so
                 a cell whose own field had not changed kept its "…" forever), and the sort is re-applied, so "closest to
                 its flip first" stays true as flips arrive */
              e.api.refreshCells({ force: true });
              e.api.onSortChanged();
            }}
            overlayNoRowsTemplate='<span class="font-mono text-[11px] text-textSecondary">Still reading the book</span>'
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={gridContext}
            getRowId={p => p.data.ticker}
            onRowClicked={open}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={!phone}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
            alwaysShowHorizontalScroll
            onFirstDataRendered={measureRight}
            onGridSizeChanged={measureRight}
          />
        </AgGridProvider>
      </div>
      )}
    </div>
  );
};

export default Board;
