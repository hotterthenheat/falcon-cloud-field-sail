/* The Board: every name the desk covers, one row each, the reads the Map makes for one name; click a row and the Map
   becomes that name. The grid is AG Grid (sorting, resizing, pinned columns, virtualised rows, a token theme); the
   meaningful cells are React renderers. */

import { daySigmaOfIv } from '../../data/expectedMove';
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
import { useBookRev, peekEntry, bookStatus } from '../../data/book/store';
import { usePinpointFeed } from '../../data/book/feed';
import { peekIv, peekDaySigma } from '../../data/book/move';
import { refreshBoardPrices } from '../../data/book/day';
import { ensureBook } from '../../data/book/load';
import { useNameUnit } from '../../data/distanceUnits';
import { fmtDistance } from '../../data/atr';
import { bellDay, cadenceWords, dayWordOf, expirySpan, longDay, recordDay, recordPossessive, todayScopeLabel } from '../../data/bookWindow';
import { buildBoardRow, netGexTitle, type BoardRow } from '../../data/board';
import { strikeTag, todayWords } from '../../data/agenda';
import { addBoardName, removeBoardName, useBoardNames } from '../../data/boardNames';
import { isOptionRoot, useListedRev } from '../../data/listedNames';
import { tickerName } from '../../data/tickers';
import TickerLookup from '../../components/ui/TickerLookup';
import useFocusTrap from '../../components/ui/useFocusTrap';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { REGIME_WORDS } from '../../data/flipGauge';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CALL_WALL, FLIP, LONG_GAMMA, PUT_WALL, SHORT_GAMMA, SUPREME, THERMAL_WARM } from '../../components/gex/paletteInk';
import { fmtDollars } from '../../data/ahead';
import { chanceLabel } from '../../data/wall';
import { nyClock } from '../../core/nyTime';
import { bellNone, BELL_NONE_TITLE } from '../../data/flipLevel';
import { callWallWordsAt, levelRoles, putWallWordsAt, wallPlace } from '../../core/walls';
import { BOARD_TTL_MS, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { ReadMiss } from './BookDown';
import { kindTip } from '../../components/gex/glossary';
import { LivePrice } from '../../components/gex/LivePrice';
import { AsOf, EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { Skeleton } from '../../components/ui/Skeleton';
import { fmtStrike } from '../../core/format';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal */
const ROLE_INK: Record<string, string> = { 'call wall': CALL_WALL, 'put wall': PUT_WALL, supreme: SUPREME, flip: FLIP };
const WARM = THERMAL_WARM;

/** The board sweeps on the scan tier — a bird's-eye view must not vibrate per tick */
const SCAN_INTERVAL_MS = 10_000;
/* The grid's theme and modules are the house's (components/ui/houseGrid.ts) — the Record's tables wear the same */
const MODULES = GRID_MODULES;
const THEME = GRID_THEME;
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

/* The Board reads the Ruler: a distance in dollars, percent or the day's 1σ; with no scale for the unit, dollars. */
const Dist = ({ ticker, spot, pct }: { ticker: string; spot: number; pct: number }) => {
  const unit = useNameUnit(ticker);
  /* within the one tolerance (core/walls.ts wallPlace, 0.05%) a level is AT price — never "−$0.00" */
  if (Math.abs(pct) < 0.05) return <>at price</>;
  if (unit === '%') return <>{fmtPct(pct)}</>;
  const delta = (pct / 100) * spot;
  return <>{fmtDistance(delta, spot, unit, { atr: null, sigma: unit === 'σ' ? peekDaySigma(ticker) ?? daySigmaOfIv(spot, peekIv(ticker) ?? 0) : null })}</>;
};

// ---- cell renderers: the house grammar inside the grid -----------------------

/** What the grid hands every cell renderer (AgGridReact `context`) */
interface BoardContext {
  remove: (ticker: string) => void;
}

/* The × that takes a name off the board: a native handler, so stopPropagation at the target keeps the grid's own row
   listener from opening the name. Shown on the row's hover (index.css). */
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

/* today's strikes not in yet: the cell is the house's loading line (components/ui Skeleton), the height of the read it
   stands for, so the row does not jump when the read lands */
const Pending = ({ data }: { data: BoardRow }) => (
  <span
    role="status"
    aria-label={`${data.ticker}: loading`}
    className="flex flex-col justify-center gap-1.5 w-full py-0.5"
    title={data.scope === 'ALL' ? `Still loading every expiry's contracts on ${data.ticker}` : `Still loading ${data.ticker}'s front expiry`}
    data-board-pending
  >
    <Skeleton line className="h-2.5 w-[70%] max-w-[88px]" />
    <Skeleton line className="h-2 w-[45%] max-w-[56px] opacity-70" />
  </span>
);

const NameCell = ({ data, context }: ICellRendererParams<BoardRow, unknown, BoardContext>) =>
  data ? (
    <span className="flex items-center gap-2 font-mono w-full">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="text-t12 font-bold text-textPrimary">{data.ticker}</span>
      {context?.remove && <RemoveName ticker={data.ticker} remove={context.remove} />}
    </span>
  ) : null;

/* the day's change, not the after-hours move (on its own labelled line); a zero change is neutral */

/* the live price is ThetaData's (components/gex/LivePrice.tsx); the levels' own price sits under it */
const SpotCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  return (
    <span className="flex flex-col justify-center leading-[14px] font-mono text-t12">
      <LivePrice ticker={data.ticker} compact />
      <span className="text-t10 text-textMuted tnum whitespace-nowrap" title="The price the feed marked this name's rows at — every distance on the board is measured from it">
        levels at {data.spot.toFixed(2)}
      </span>
    </span>
  );
};

const YoursCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  if (!data.yours.positions) return <span className="font-mono text-t10 text-textMuted">—</span>;
  return (
    <span className="font-mono text-t11 tnum tabular-nums text-silver">
      {data.yours.contracts} contract{data.yours.contracts === 1 ? '' : 's'} · {data.yours.positions} position{data.yours.positions === 1 ? '' : 's'}
    </span>
  );
};

/* A name whose "Today" is a later expiry says so in the cell: the date stands beside the figure. */
const ExpiryMark = ({ data }: { data: BoardRow }) => {
  const dated = data.levelsDate;
  const word = data.scope === 'ALL' ? 'all expiries' : dated && !dayWordOf(dated) ? (expirySpan([dated]) ?? dated) : null;
  if (!word) return null;
  return (
    <span className="block font-mono text-t9 leading-[11px] font-normal text-textMuted whitespace-nowrap" title={data.scope === 'ALL' ? `${data.ticker} is read off every listed expiry` : `${data.ticker} has no contracts expiring ${todayScopeLabel() === 'Today' ? 'today' : 'in the next session'} — this column reads its nearest expiry, ${word}`} data-board-expiry={data.scope === 'ALL' ? 'ALL' : dated}>
      {word}
    </span>
  );
};

/* the hedging in one word under the net: absorbs or amplifies, "on the flip" a hair either side of it (0.05%) */
const RegimeWord = ({ data }: { data: BoardRow }) => {
  if (!data.regime) return <span className="block text-t10 font-normal text-textMuted">balanced</span>;
  if (data.flipDistPct != null && Math.abs(data.flipDistPct) < 0.05) return <span className="block text-t10 font-normal text-textSecondary" title="Price is on the flip — dealer hedging can tip either way">on the flip</span>;
  const w = REGIME_WORDS[data.regime];
  return (
    <span className="block text-t10 font-normal" style={{ color: data.regime === 'SHORT' ? SHORT_GAMMA : LONG_GAMMA }} title={`${w.label.toLowerCase()} — ${w.blurb}${data.flip != null ? `; the flip at ${fmtStrike(data.flip)} is where that changes` : '; no flip within ±10%'}`}>
      {data.regime === 'SHORT' ? 'amplifies moves' : 'absorbs moves'}
    </span>
  );
};

const FlipCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data && data.flip != null ? (
    <TickFigure value={data.flip} className="inline-flex items-baseline gap-2 font-mono">
      <span className="text-t11 font-semibold" style={{ color: FLIP }}>
        {fmtStrike(data.flip)}
      </span>
      {data.flipDistPct != null && <span className="text-t10 text-textSecondary"><Dist ticker={data.ticker} spot={data.spot} pct={data.flipDistPct} /></span>}
    </TickFigure>
  ) : data ? (
    <span className="font-mono text-t10 text-textMuted" title={`No flip within ±10%: dealers are ${data.regime === 'LONG' ? 'long' : 'short'} gamma across the whole range`}>
      none nearby
    </span>
  ) : null;

/* every level the nearest wall is, in the one order (core/walls.ts levelRoles); two lines when it is more than one */
/** The roles in the one order, the two walls on one strike said once: "supreme · call & put wall" */
const shortRoles = (roles: readonly string[]): string[] => {
  if (!(roles.includes('call wall') && roles.includes('put wall'))) return [...roles];
  const out: string[] = [];
  for (const r of roles) {
    if (r === 'put wall') continue;
    out.push(r === 'call wall' ? 'call & put wall' : r);
  }
  return out;
};

const WallCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (data?.pending) return <Pending data={data} />;
  if (!data) return null;
  const roles = levelRoles(data.nearest.strike, { supreme: data.supreme, callWall: data.callWall, putWall: data.putWall });
  const ink = (r: string) => (r === 'supreme' ? SUPREME : r === 'call wall' ? CALL_WALL : PUT_WALL);
  /* where the wall sits, in words (a put wall above price is overhead hedging, not a floor) */
  const place = wallPlace(data.nearest.strike, data.spot);
  const placeWords = [
    `${fmtStrike(data.nearest.strike)} · ${roles.join(' · ')} · ${place === 'at' ? 'at price' : `${place} price`}`,
    ...(roles.includes('call wall') ? [`Call wall: ${callWallWordsAt(place, data.nearestNet)}.`] : []),
    ...(roles.includes('put wall') ? [`Put wall: ${putWallWordsAt(place, data.nearestNet)}.`] : []),
    ...(roles.includes('supreme') ? ['Supreme: the strike with the most hedging of all — price is drawn to it near expiry.'] : []),
  ].join('\n');
  const label = (
    <span className="text-t9 font-bold uppercase tracking-wide leading-[11px] whitespace-normal" title={placeWords}>
      {/* both walls on one strike read "call & put wall" */}
      {shortRoles(roles).map((r, i) => (
        <span key={r} style={{ color: ink(r === 'call & put wall' ? 'call wall' : r) }}>
          {i > 0 && <span className="text-textMuted"> · </span>}
          {r}
        </span>
      ))}
    </span>
  );
  const figs = (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap" title={placeWords}>
      <span className="text-t11 font-semibold text-textPrimary">{fmtStrike(data.nearest.strike)}</span>
      <span className="text-t10 text-textSecondary"><Dist ticker={data.ticker} spot={data.spot} pct={data.nearest.distPct} /></span>
    </span>
  );
  /* always two lines — the role words, then the strike and how far */
  return (
    <span className="flex flex-col justify-center leading-[14px] font-mono tnum tabular-nums min-w-0">
      {label}
      {figs}
    </span>
  );
};

/** The agenda's #1 for the name: the strike in its kind's ink, reached · holds, the dollars at stake */
const WatchCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data) return null;
  if (data.pending) return <Pending data={data} />;
  const w = data.watch;
  if (!w) return <span className="font-mono text-t10 text-textMuted">—</span>;
  /* every level the strike is, in the one order */
  /* one classifier, the Agenda's */
  const kind = strikeTag(w);
  const ink = w.roles?.length ? ROLE_INK[w.roles[0]] : w.role ? ROLE_INK[w.role] : kind === 'shelf' ? 'rgb(var(--text-muted))' : kind === 'trapdoor' ? WARM : undefined;
  /* TWO LINES, so nothing truncates ("$8(" at 1440): the strike and its kind, then the chance, the size and the dollars */
  return (
    <span className="flex flex-col justify-center leading-[14px] font-mono tnum tabular-nums min-w-0">
      <span className="inline-flex items-baseline gap-2">
        <span className="text-t11 font-semibold text-textPrimary">{fmtStrike(w.strike)}</span>
        {kind && (
          <span className="text-t8 uppercase tracking-wide leading-[10px] whitespace-normal" style={{ color: ink }} title={kindTip(w.roles?.[0] ?? kind)}>
            {w.roles?.length ? shortRoles(w.roles).join(' · ') : kind}
          </span>
        )}
      </span>
      <span className="text-t10 leading-[12px] text-textSecondary whitespace-normal">
        {/* a strike the session already traded through is reached, not a chance */}
        {w.atPrice ? 'at price' : w.today ? <span title={`Today's session has already traded through ${fmtStrike(w.strike)}${w.today.tests != null ? ` — ${todayWords(w.today)}` : ''}; ${chanceLabel(w.reach)} to touch it again`}>reached today</span> : `${chanceLabel(w.reach)} ${w.horizon ? `reached ${w.horizon}` : 'reached'}`}
        {w.isShelf && (
          <>
            {' · '}
            <span style={{ color: SILVER }}>{w.hold >= 0.995 ? 'top wall' : `${holdShortOf(w.hold)} top wall`}</span>
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
    <span className="inline-flex flex-col justify-center leading-[14px] font-mono text-t11 font-bold tnum tabular-nums" style={{ color: SUPREME }}>
      {fmtStrike(data.supreme)}
      <ExpiryMark data={data} />
    </span>
  ) : null;

/* Net GEX in the retail sign: positive = dealers long gamma = absorbs (green), negative amplifies (red); when the net
   and the side of the flip disagree, the hover says so. */
const NetCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending ? (
    <Pending data={data} />
  ) : data ? (
    <TickFigure value={data.netGex} title={netGexTitle(data.netGex, data.regime)} className={`inline-flex flex-col justify-center leading-[14px] font-mono text-t11 font-semibold ${data.netGex > 0 ? 'text-bull' : data.netGex < 0 ? 'text-bear' : 'text-textMuted'}`}>
      <span>
        {data.netGex > 0 ? '+' : ''}
        {fmtUsd(data.netGex)}
      </span>
      <RegimeWord data={data} />
      <ExpiryMark data={data} />
    </TickFigure>
  ) : null;

const BellCell = ({ data }: ICellRendererParams<BoardRow>) =>
  !data ? null : data.bellShare != null ? (
    <span className="inline-flex items-center gap-2 font-mono tnum tabular-nums w-full" title={`${data.bellShare}% — ${bellDay().tip(data.ticker)}`}>
      <span className="text-t11 text-textPrimary w-8 text-right">{data.bellShare}%</span>
      <span className="flex-1 h-[3px] rounded-full bg-ink/[0.06] overflow-hidden">
        <span className="block h-full rounded-full" style={{ width: `${data.bellShare}%`, background: SUPREME, opacity: 0.7 }} />
      </span>
    </span>
  ) : (
    data.bellWhy === 'none' ? (
      <span className="inline-block whitespace-normal leading-[13px] font-mono text-t10 text-textMuted" title={BELL_NONE_TITLE(data.ticker)}>
        {bellNone()}
      </span>
    ) : (
      <Pending data={data} />
    )
  );

const CrossCell = ({ data }: ICellRendererParams<BoardRow>) =>
  data?.pending || data?.crossPending ? (
    <Pending data={data} />
  ) : data ? (
    <span
      className="font-mono text-t11 tnum tabular-nums text-textSecondary"
      title={data.crossWhy ?? `${recordPossessive().replace(/^t/, 'T')} session against ${data.crossFlip != null ? `the ${fmtStrike(data.crossFlip)} flip of ` : ''}${data.crossLabel}`}
    >
      {data.crossWhy ? (data.crossWhy.startsWith('The session has not opened') ? 'opens 9:30' : 'not available') : data.crossings == null ? (data.crossEarly ? 'counts from 9:40' : '—') : data.crossFlip == null ? 'no flip' : `crossed ${data.crossings}×`}
    </span>
  ) : null;

/** The session's closes as one quiet line — the day's shape, not a chart */
const SparkCell = ({ data }: ICellRendererParams<BoardRow>) => {
  if (!data || data.spark.length < 2) return <span className="font-mono text-t10 text-textMuted">—</span>;
  const W = 56;
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

/* The phone's Board is cards, one a name, with every read a phone needs first: price and change, regime, flip and how
   far, the nearest wall, the supreme, net GEX. */
const PhoneCard = ({ row, onOpen, onRemove }: { row: BoardRow; onOpen: (t: string) => void; onRemove: (t: string) => void }) => {
  const label = (t: string, title?: string) => (
    <span className="text-t9 uppercase tracking-widest text-textMuted" title={title}>
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
      <div className="flex items-start gap-2 min-w-0">
        <CompanyLogo ticker={row.ticker} size={18} />
        {/* the day's change wraps under the price rather than cut */}
        <span className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-t13 font-bold text-textPrimary">{row.ticker}</span>
          <span className="text-t13">
            <LivePrice ticker={row.ticker} compact />
          </span>
          <span className="text-t10 text-textMuted tnum">levels at {row.spot.toFixed(2)}</span>
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
        <div className="mt-1 text-t11 text-textMuted">Reading the levels…</div>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-t11 tnum">
          <div className="flex flex-col min-w-0">
            {label('Hedging', 'What dealer hedging does at the current price')}
            <span style={{ color: row.regime === 'SHORT' ? SHORT_GAMMA : row.regime === 'LONG' ? LONG_GAMMA : undefined }} className="whitespace-normal break-words">
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
            {/* two lines, nothing cut: the strike and how far first, every level it is under it, wrapping */}
            <span className="flex flex-col min-w-0" data-board-card-wall>
              <span>
                <span className="font-semibold text-textPrimary">{fmtStrike(row.nearest.strike)}</span> <span className="text-textSecondary"><Dist ticker={row.ticker} spot={row.spot} pct={row.nearest.distPct} /></span>
              </span>
              <span className="text-t9 font-bold uppercase tracking-wider leading-tight flex flex-wrap gap-x-1">
                {levelRoles(row.nearest.strike, { supreme: row.supreme, callWall: row.callWall, putWall: row.putWall }).map((r, i) => (
                  <span key={r} style={{ color: r === 'supreme' ? SUPREME : r === 'call wall' ? CALL_WALL : PUT_WALL }}>
                    {i > 0 && <span className="text-textMuted">· </span>}
                    {r}
                  </span>
                ))}
              </span>
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            {label(row.scope === 'ALL' ? 'Supreme · all' : 'Supreme', row.scope === 'ALL' ? `The strike with the most hedging on ${row.ticker}, every listed expiry` : `The strike with the most hedging on ${row.ticker}, this name's front expiry`)}
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
  /* the names on the board — the list the user keeps */
  const stored = useBoardNames();
  const listedRev = useListedRev();
  const names = useMemo(() => stored.filter(isOptionRoot), [stored, listedRev]);
  usePinpointFeed(names[0]);
  const bookRev = useBookRev();
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [scanAt, setScanAt] = useState('');
  const lastRef = useRef(0);
  const runRef = useRef(0);
  /* One name per macrotask: rows land as they are built, and a run that is overtaken (the list changed, a new scan) stops
     where it is. */
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
          /* the same row (data/board.ts keeps a name's row until its own book moves) leaves the grid alone */
          if (prev[at] === row) return prev;
          const next = prev.slice();
          next[at] = row;
          return next;
        });
      setTimeout(step, 0);
    };
    step();
  }, []);
  /* every name's read starts at once, in the board's order, so each kept copy paints without waiting on the rows built before it */
  useEffect(() => {
    names.forEach(n => ensureBook(n, 'board'));
  }, [names]);
  /* a book landing in pieces emits many times a second: one rebuild per burst; a row whose own book did not move is
     handed back unchanged (data/board.ts buildBoardRow) and leaves the grid alone */
  useEffect(() => {
    const id = window.setTimeout(() => {
      lastRef.current = Date.now();
      rebuild(names, true);
    }, 120);
    return () => window.clearTimeout(id);
  }, [names, rebuild, bookRev]);
  useEffect(() => {
    /* the prices every scan, in one call (uwBook refreshBoardPrices); the levels on their own cadence */
    refreshBoardPrices(names);
    const id = window.setInterval(() => {
      lastRef.current = Date.now();
      refreshBoardPrices(names);
      rebuild(names, false);
    }, SCAN_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [names, rebuild]);

  /* the filter takes any number of names ("SPY QQQ nvda" or commas): a row stays if a token starts its symbol or name */
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

  /* The columns fill the width (flex); the name stays pinned at a fixed width. Headers in plain English. */
  /* every head explains itself on hover, one sentence each */
  /* On a phone the name stays pinned and narrow and the reads a phone needs first come straight after it; the long ones
     leave the grid. Anything past the screen scrolls inside the grid. */
  const phone = useIsPhone();
  const anyMine = rows.some(r => r.yours.positions > 0);
  const recKey = `${recordDay().date}|${recordDay().isToday}|${recordDay().done}|${bellDay().head}|${todayScopeLabel()}`;
  const columnDefs = useMemo<ColDef<BoardRow>[]>(() => {
    const cols: ColDef<BoardRow>[] = [
      { headerName: 'Name', field: 'ticker', pinned: 'left', width: phone ? 92 : 96, cellRenderer: NameCell, sortable: true, headerTooltip: 'The stock or fund. Click a row to open it on the Map' },
      { headerName: 'Price', field: 'spot', flex: 1.1, minWidth: 132, cellRenderer: SpotCell, comparator: (a: number, b: number) => a - b, headerTooltip: todayScopeLabel() === 'Today' ? "The last price and today's change" : "The regular-session close — the price the levels were read at, and every distance on the board is measured from it — and the session's change; the after-hours move is beside it, labelled" },
      { headerName: 'Net GEX', field: 'netGex', flex: 0.8, minWidth: 108, cellRenderer: NetCell, comparator: (a: number, b: number) => Math.abs(a) - Math.abs(b), headerTooltip: "Net GEX on this name's own levels, dollars per 1% move, and what dealer hedging does at the current price: positive absorbs moves, negative amplifies them. Each name can be today or every expiry." },
      {
        headerName: 'Flip · how far',
        field: 'flipDistPct',
        flex: 0.9,
        minWidth: 112,
        cellRenderer: FlipCell,
        sort: 'asc',
        headerTooltip: "The flip: the price where the name's net gamma, re-priced at that price, crosses zero — where dealer hedging switches between absorbing and amplifying moves — and how far it is from the current price. Names closest to their flip — as a share of price, whatever the ruler prints — come first; \"none nearby\" means no crossing within 10%, and those come last",
        // Closest to flipping first — the names that can change character next
        comparator: (a: number | null, b: number | null) => Math.abs(a ?? 1e9) - Math.abs(b ?? 1e9),
      },
      {
        headerName: 'Nearest wall',
        field: 'nearest',
        flex: 1.4,
        minWidth: 132,
        cellRenderer: WallCell,
        cellDataType: false,
        headerTooltip: 'The nearer of the two walls and how far it is. The call wall is the strike with the most call gamma: while dealers are long gamma there it tends to slow a rise (above price it is a lid; once price is through it, it can act as support). The put wall is the strike with the most put gamma: below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling',
        comparator: (a: BoardRow['nearest'], b: BoardRow['nearest']) => Math.abs(a.distPct) - Math.abs(b.distPct),
      },
      { headerName: 'Supreme', field: 'supreme', flex: 0.5, minWidth: 84, cellRenderer: SupremeCell, headerTooltip: "The strike with the most hedging on this name, on that name's own levels." },
      {
        headerName: 'Watch first',
        field: 'watch',
        flex: 1.6,
        minWidth: 152,
        cellRenderer: WatchCell,
        cellDataType: false,
        headerTooltip: `The one price to watch first: the strike price is most likely to reach with the most hedging behind it. "Reached" is the chance price gets there ${todayScopeLabel() === 'Today' ? 'today' : 'in the next session'}; "0.85× top wall" is its size against the biggest wall on this name; the dollar figure is the hedging parked there`,
        // The name whose first target matters most, first
        comparator: (a: BoardRow['watch'], b: BoardRow['watch']) => (a ? a.reach * a.stake : -1) - (b ? b.reach * b.stake : -1),
      },
      { headerName: bellDay().head, field: 'bellShare', flex: 0.7, minWidth: 80, cellRenderer: BellCell, headerTooltip: `${bellDay().tip("the name")}. A dash means nothing on the name expires that day` },
      /* the session on record, named: before today's open these are the last session's */
      { headerName: recordDay().isToday ? 'Flip crossed today' : `Flip crossed · ${longDay(recordDay().date)}`, field: 'crossings', flex: 0.9, minWidth: 108, cellRenderer: CrossCell, headerTooltip: `How many times price crossed the flip in ${recordPossessive()} session: one-minute closes changing side of it — the same count the Map's report prints on its flip row ("crossed N×"). The flip is the one of the contracts that were live in that session (after the close, or before the next open, that session's own book, not the next session's). The more crossings, the less either side of it means` },
      { headerName: recordDay().isToday ? (recordDay().done ? 'Today' : 'Today so far') : longDay(recordDay().date), field: 'spark', flex: 0.5, minWidth: 72, cellRenderer: SparkCell, cellDataType: false, sortable: false, headerTooltip: recordDay().isToday ? 'The price path since the open' : `The price path through ${longDay(recordDay().date)}'s session` },
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
    /* every column on screen at 1440: narrower columns, long cells wrap, "Your positions" only once a name carries one */
    if (!phone) return anyMine ? cols : cols.filter(c => c.field !== 'yours');
    const order = ['ticker', 'spot', 'netGex', 'flipDistPct', 'nearest', 'supreme', 'bellShare'];
    return order.map(f => cols.find(c => c.field === f)).filter((c): c is ColDef<BoardRow> => !!c).map(c => (c.field === 'ticker' ? c : { ...c, flex: undefined, width: c.minWidth }));
    // the heads name the session on record and the bell's day — they roll at the open and the close (recKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, recKey, anyMine]);
  /* a long head wraps to two lines rather than cut */
  const defaultColDef = useMemo<ColDef<BoardRow>>(() => ({ sortable: true, resizable: true, suppressMovable: true, headerClass: 'bg-chip', wrapHeaderText: true, autoHeaderHeight: true, wrapText: true, autoHeight: true }), []);

  const open = (e: RowClickedEvent<BoardRow>) => {
    if (!e.data) return;
    changeTicker(e.data.ticker);
    ensureBook(e.data.ticker, 'full', true);
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
  const keptAt = stamps.reduce<number | null>((best, e) => (e?.keptAt ? (best == null ? e.at : Math.min(best, e.at)) : best), null);
  const bookDown = names.length > 0 && stamps.length > 0 && stamps.every(e => e?.status === 'error');
  /* how many names are still reading: a row waiting on its levels, or a name with no row yet whose read has not failed */
  const rowOf = new Map(rows.map(r => [r.ticker, r]));
  const missing = names.filter(n => !rowOf.has(n.toUpperCase()));
  const failed = missing.filter(n => bookStatus(n) === 'error');
  /* a read that answered, and answered with no listed contracts for the name: nothing to draw, said once */
  const empty = missing.filter(n => {
    const e = peekEntry(n);
    return e?.status === 'live' && !!e.expiriesAt && e.expiries.length === 0 && e.all.length === 0;
  });
  const waiting = missing.filter(n => !failed.includes(n) && !empty.includes(n));
  const loading = rows.filter(r => r.pending).length + missing.length - failed.length - empty.length;
  const shown = names.length - loading - failed.length - empty.length;
  /* the one status: a kept copy's "as of", else when the board last swept (and, out of session, the close the levels
     are from). The prices' ThetaData state is said once, on the name strip above (RegimeLine), not again here. */
  const cadence = cadenceWords().replace(/^as of /, 'levels from ');
  return (
    /* the board is as tall as its rows: every name shows, the page scrolls, never the grid */
    <div className="border border-borderSubtle rounded-md overflow-clip flex flex-col" data-board>
      <div className="shrink-0 flex items-center gap-3 flex-wrap px-2 py-1.5 bg-panel border-b border-borderSubtle/70" data-board-toolbar>
        <span className="font-mono text-t9 uppercase tracking-widest text-textSecondary">The names on your board</span>
        <span
          className={`font-mono text-t9 uppercase tracking-widest tnum tabular-nums ${loading > 0 ? 'text-textSecondary' : 'text-textMuted'}`}
          title="Closest to its flip (as a % of price) first · click a name to open it on the Map"
          aria-live="polite"
          data-board-count
        >
          {loading > 0 ? `loading ${loading} of ${names.length}` : `${shown} name${shown === 1 ? '' : 's'}`}
          {failed.length > 0 && <span className="text-warn"> · {failed.length} failed</span>}
          {empty.length > 0 && <span> · {empty.length} no data</span>}
          <span className="max-lg:hidden"> · closest to its flip first</span>
        </span>
        <input
          value={quick}
          onChange={e => setQuick(e.target.value)}
          placeholder="Filter · SPY QQQ NVDA"
          aria-label="Filter names — as many as you like, spaces or commas between"
          title="As many names as you like, spaces or commas between"
          className="ml-auto flex-1 min-w-[9rem] sm:flex-none sm:w-44 slayer-field"
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
            <span className="text-t11 font-semibold text-textPrimary">Add a name</span>
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
                <div className="px-2.5 py-1.5 border-b border-borderSubtle text-t10 text-textMuted">Add a name to the board — it stays until you take it off</div>
                <TickerLookup
                  onPick={sym => {
                    addBoardName(sym);
                    changeTicker(sym);
                    ensureBook(sym, 'full', true);
                    setAdding(false);
                    navigate('/pinpoint/map');
                  }}
                />
              </div>,
              document.body
            )}
        </span>
        <span className="basis-full flex items-center gap-x-2 gap-y-1 flex-wrap font-mono text-t9 uppercase tracking-widest text-textMuted tnum tabular-nums" data-board-status>
          {keptAt != null ? (
            <AsOf at={keptAt} title="Some rows are this browser's kept copies, shown while their fresh reads land" />
          ) : (
            <>
              <StaleMark at={bookAt} ttlMs={BOARD_TTL_MS} fault={bookDown ? 'failed' : null} />
              {scanAt && <span>updated {scanAt}</span>}
            </>
          )}
          <span>{keptAt != null || scanAt ? '· ' : ''}{cadence}</span>
        </span>
      </div>
      {bookDown && rows.length === 0 ? (
        <ReadMiss onRetry={() => names.forEach(t => ensureBook(t, 'full'))} />
      ) : phone ? (
        <div data-board-cards>
          {rows.length === 0 && <p className="px-3 py-4 font-mono text-t11 text-textSecondary">Still reading the book</p>}
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
      /* more to the right, said: a fade says the grid scrolls on, and the scrollbar stays up */
      <div ref={boardWrapRef} className={`slayer-board relative ${rows.length === 0 && waiting.length > 0 ? '[&_.ag-center-cols-viewport]:!min-h-0 [&_.ag-body-viewport]:!min-h-0 [&_.ag-center-cols-container]:!min-h-0 [&_.ag-pinned-left-cols-container]:!min-h-0' : ''}`} data-more-right={moreRight || undefined}>
        {moreRight && <span aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-3 w-16 z-20 bg-gradient-to-l from-panel via-panel/70 to-transparent" />}
        <AgGridProvider modules={MODULES}>
          <AgGridReact<BoardRow>
            ref={gridRef}
            theme={THEME}
            domLayout="autoHeight"
            rowData={rows}
            onRowDataUpdated={e => {
              if (e.api.getDisplayedRowCount() > 0) e.api.hideOverlay();
              /* every cell redraws when a row lands (renderers read `pending` and the bell's reason), and the sort is re-applied */
              e.api.refreshCells({ force: true });
              e.api.onSortChanged();
            }}
            overlayNoRowsTemplate='<span class="font-mono text-t11 text-textSecondary">Still reading the book</span>'
            /* while names are still reading, their loading rows stand under the head instead of the overlay */
            suppressNoRowsOverlay={waiting.length > 0}
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
      {/* a name with no row yet is a loading row of its own: its logo and symbol, the reads as loading lines */}
      {!phone && waiting.length > 0 && !(bookDown && rows.length === 0) && (
        <div role="status" aria-label={`Loading ${waiting.length} more name${waiting.length === 1 ? '' : 's'}`} className="border-t border-borderSubtle/70" data-board-waiting>
          {waiting.map(n => (
            <div key={n} className="flex items-center h-11 border-b border-borderSubtle/40 last:border-b-0" data-board-waiting-row={n}>
              <span className="flex items-center gap-2 w-[96px] shrink-0 px-3 font-mono">
                <CompanyLogo ticker={n} size={16} />
                <span className="text-t12 font-bold text-textSecondary">{n}</span>
              </span>
              {/* one loading line a column, the way the row's reads will sit */}
              <span className="flex-1 min-w-0 flex items-center" aria-hidden>
                {[0.62, 0.5, 0.55, 0.7, 0.4, 0.66, 0.45, 0.5, 0.6].map((w, i) => (
                  <span key={i} className={`flex-1 min-w-0 px-3 ${i > 5 ? 'max-xl:hidden' : ''}`}>
                    <Skeleton line className="h-2.5" style={{ width: `${w * 100}%` }} />
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      {phone && waiting.length > 0 && rows.length > 0 && <LoadingBox shape="lines" rows={2} label={`Loading ${waiting.length} more names`} className="border-t border-borderSubtle/70" />}
      {(failed.length > 0 || empty.length > 0) && !(bookDown && rows.length === 0) && (
        <div className="border-t border-borderSubtle/70 divide-y divide-borderSubtle/50" data-board-misses>
          {failed.length > 0 && (
            <ErrorBox compact what={`${failed.join(', ')} did not load`} detail="The feed did not answer for these names. The board asks again on its own." onRetry={() => failed.forEach(t => ensureBook(t, 'full', true))} />
          )}
          {empty.length > 0 && <EmptyBox compact title={`No options data · ${empty.join(', ')}`} reason="The feed answered with no listed contracts for these names, so there are no levels to read." />}
        </div>
      )}
    </div>
  );
};

export default Board;
