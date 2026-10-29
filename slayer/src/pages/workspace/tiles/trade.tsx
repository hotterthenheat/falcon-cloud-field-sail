/*
  The trade tiles: Compass's own calls (a card opens that setup's page), the live chain (a strike unfolds its
  weigh-up and the book's read), and the Weigher's two lists — what you hold and what you watch — marked at the
  live vendor quotes.
*/

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import SetupScanCard from '../../../components/compass/SetupScanCard';
import { CHAIN_COLUMNS, ChainCard, DEFAULT_COLS, type ChainCol } from '../../../components/weigher/ChainGrid';
import { ListGrid, usdSigned, type ListRow } from '../../../components/weigher/PositionsList';
import { expiryFor, isoDate, today } from '../../../core/calendar';
import { buildBook } from '../../../data/bookAtStrike';
import { setupIdOf } from '../../../data/compass';
import { currentPicks } from '../../../data/compassModel';
import { costOf } from '../../../data/positionCurve';
import { readPosition, useAllPositions, type Position, type Verdict } from '../../../data/positions';
import { returnsOf, tickWatchlist, useWatchlist } from '../../../data/watchlist';
import { blankChain, loadLiveChain, type DeskChain } from '../../../data/weigherDesk';
import { peekMark, useMarks } from '../../../data/weigherChain';
import { snapshotOf } from '../../../data/uwBook';
import { SCANNERS, SLEEVES, isScannerEligible, type OptionRight, type ScannerKey, type Setup, type SleeveKey } from '../../../types/compass';
import type { ExposureProfileData } from '../../../types/gex';
import type { WatchedContract } from '../../../types/watchlist';
import type { TileControl, TileProps, TileState, WorkspaceCtx } from '../tile';
import { profile30 } from './derive';
import { TileEmpty, TileRead, dirInk, useDoor } from './parts';

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/* ------------------------------------------------------------------ Compass setups */

const sleeveOfState = (state: TileState): SleeveKey => (SLEEVES.some(s => s.key === state.sleeve) ? (state.sleeve as SleeveKey) : 'weekly');
const scanOfState = (state: TileState, sleeve: SleeveKey): ScannerKey => (SCANNERS.some(s => s.key === state.scan) && isScannerEligible(state.scan as ScannerKey, sleeve) ? (state.scan as ScannerKey) : 'top-setups');

export const setupsControls = ({ state }: { ctx: WorkspaceCtx; state: TileState }): TileControl[] => {
  const sleeve = sleeveOfState(state);
  return [
    { id: 'sleeve', label: 'Expiry', title: 'How far out the contracts run', options: SLEEVES.map(s => ({ value: s.key, label: `${s.label} · ${fmtDay(expiryFor(s.dte).date)}`, hint: s.blurb })) },
    { id: 'scan', label: 'Scan', title: 'Which scan ranks the cards', options: SCANNERS.filter(s => isScannerEligible(s.key, sleeve)).map(s => ({ value: s.key, label: s.label, hint: s.blurb })) },
  ];
};

/** The cards, kept: they re-render when the sweep hands a new ranking, never on the desk's one-second tick */
const Cards = memo(({ ranked, expiryChip, onOpen }: { ranked: Setup[]; expiryChip: string; onOpen: (s: Setup) => void }) => (
  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2 content-start" data-tile-rows>
    {ranked.map((s, i) => (
      <div key={s.id} className="animate-soft-in flex flex-col min-w-0 [&>button]:flex-1">
        <SetupScanCard setup={s} rank={i + 1} selected={false} onSelect={onOpen} onAnalysis={onOpen} expiryChip={expiryChip} />
      </div>
    ))}
  </div>
));
Cards.displayName = 'Cards';

export const SetupsTile = ({ ctx, state }: TileProps) => {
  const door = useDoor();
  const sleeve = sleeveOfState(state);
  const scanner = scanOfState(state, sleeve);
  const ranked = useMemo(() => currentPicks().filter(s => (sleeve === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE')), [sleeve, ctx.revision]);
  const expiryChip = useMemo(() => expiryFor(SLEEVES.find(s => s.key === sleeve)?.dte ?? 5).label, [sleeve]);
  const open = useCallback((s: Setup) => door(`/compass/${setupIdOf({ ticker: s.ticker, strike: s.strike, right: s.right, scanner, sleeve })}`), [door, scanner, sleeve]);
  if (ranked.length === 0) return <TileEmpty words="Nothing cleared the bar on this scan and expiry." />;
  const top = ranked[0];
  return (
    <div className="h-full min-h-0 flex flex-col" data-setups-tile>
      <Cards ranked={ranked} expiryChip={expiryChip} onOpen={open} />
      <TileRead testId="setups">
        {ranked.length} {ranked.length === 1 ? 'setup' : 'setups'} cleared the bar. First: {top.contract} — {top.headline}
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ the chain */

const CHAIN_DTES = [0, 2, 7, 30];
export const chainDteOf = (state: TileState): number => {
  const n = Number(state.dte);
  return Number.isFinite(n) && state.dte !== undefined && state.dte !== '' ? n : expiryFor(2).dte;
};
export const chainControls = ({ state }: { ctx: WorkspaceCtx; state: TileState }): TileControl[] => {
  const picked = chainDteOf(state);
  const days = [...new Set([...CHAIN_DTES.map(d => expiryFor(d).dte), picked])].sort((a, b) => a - b);
  return [
    {
      id: 'right',
      label: 'Side',
      title: 'Calls or puts',
      options: [
        { value: 'C', label: 'Calls', hint: 'The right to buy', tone: 'bull' },
        { value: 'P', label: 'Puts', hint: 'The right to sell', tone: 'bear' },
      ],
    },
    {
      id: 'dte',
      label: 'Expiry',
      title: 'How far out the chain runs',
      options: days.map(d => {
        const e = expiryFor(d);
        return { value: String(e.dte), label: e.dte === 0 ? `Today · ${fmtDay(e.date)}` : `${fmtDay(e.date)} · ${e.weekday}`, hint: e.dte === 0 ? 'The contracts that expire at the bell' : `${e.sessions} sessions out` };
      }),
    },
  ];
};

/* The listed chain, live (ThetaData, else the vendor's listed contracts), re-read every 20 seconds */
const CHAIN_MS = 20_000;
function useLiveChain(ticker: string, dte: number): DeskChain {
  const [chain, setChain] = useState<DeskChain>(() => blankChain(ticker, dte));
  useEffect(() => {
    let dead = false;
    setChain(blankChain(ticker, dte));
    const pull = () => void loadLiveChain(ticker, dte, 20).then(next => {
      if (!dead) setChain(next);
    });
    pull();
    const id = window.setInterval(pull, CHAIN_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [ticker, dte]);
  return chain;
}

const COLS_BY_ROOM: Record<TileProps['size']['room'], string[]> = { small: ['mark', 'itm'], medium: ['mark', 'delta', 'iv', 'itm'], large: DEFAULT_COLS };

export const ChainTile = ({ ctx, state, size }: TileProps) => {
  const right: OptionRight = state.right === 'P' ? 'P' : 'C';
  const dte = chainDteOf(state);
  const [sel, setSel] = useState<number | null>(null);
  const chain = useLiveChain(ctx.ticker, dte);
  const cols: ChainCol[] = useMemo(() => CHAIN_COLUMNS.filter(c => COLS_BY_ROOM[size.room].includes(c.key)), [size.room]);
  /* OUR TWO CENTS ON EVERY STRIKE — the dealer book's read, where the tile has the width for it */
  const book = useMemo(() => {
    const profile = profile30(ctx.snapshot);
    return profile ? buildBook(ctx.ticker, profile) : null;
  }, [ctx.snapshot, ctx.ticker]);
  const bookAt = useCallback((strike: number) => book?.rows.get(strike) ?? null, [book]);
  const onSelect = useCallback((strike: number, clicks?: number) => {
    // the second click of a double is not a second toggle
    if ((clicks ?? 1) >= 2) return;
    setSel(cur => (cur != null && Math.abs(cur - strike) < 1e-9 ? null : strike));
  }, []);
  return (
    <div className="h-full min-h-0 flex flex-col" data-chain-tile>
      <div className="flex-1 min-h-0">
        <ChainCard chain={chain} right={right} sel={sel} onSelect={onSelect} cols={cols} centerKey={`${ctx.ticker}:${dte}`} inlineDrill book={size.room === 'small' ? undefined : bookAt} />
      </div>
      <TileRead testId="chain">
        {ctx.ticker} options are charging for a move of ±{chain.expectedMovePct.toFixed(1)}% by {fmtDay(chain.expiry.date)}
        {chain.expiry.dte === 0 ? ', today’s bell' : ` — ${chain.expiry.sessions} ${chain.expiry.sessions === 1 ? 'session' : 'sessions'} out`}. Press a strike for its weigh-up.
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ positions & watchlist */

export const positionsControls = (): TileControl[] => [
  {
    id: 'show',
    label: 'Show',
    title: 'Which rows',
    options: [
      { value: 'both', label: 'Both', hint: 'What you hold, then what you watch' },
      { value: 'own', label: 'Positions', hint: 'The contracts you own or sold' },
      { value: 'watch', label: 'Watchlist', hint: 'The contracts you are watching' },
    ],
  },
];

export const PositionsTile = ({ ctx, state }: TileProps) => {
  const door = useDoor();
  const watchlist = useWatchlist();
  const positions = useAllPositions();
  const marksRev = useMarks(useMemo(() => [...positions.map(p => ({ ticker: p.ticker, expiry: p.expiry })), ...watchlist.filter(w => w.status === 'open').map(w => ({ ticker: w.ticker, expiry: w.expiry }))], [positions, watchlist]));
  /* the desk's sweep marks the watchlist's closes and settles what has expired */
  useEffect(() => {
    tickWatchlist();
  }, [ctx.snapshot]);
  const ownRows = useMemo<ListRow[]>(
    () =>
      [...positions]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map<ListRow>(p => {
          const live = peekMark(p.ticker, p.expiry, p.strike, p.right);
          const value = live && live.mark > 0 ? live.mark : null;
          const sign = p.side === 'long' ? 1 : -1;
          const cost = costOf(p);
          const total = value != null && cost ? (value - cost.value) * sign * 100 * p.contracts : null;
          const totalR = value != null && cost && cost.value > 0 ? ((value - cost.value) / cost.value) * sign : null;
          return { kind: 'own', id: p.id, p, value, total, totalR, today: null, todayR: null };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, ctx.snapshot, marksRev]
  );
  const watchRows = useMemo<ListRow[]>(() => {
    const rank = (w: WatchedContract) => (w.status === 'open' ? 0 : 1);
    return [...watchlist].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt).map<ListRow>(w => ({ kind: 'watch', id: w.id, w, r: returnsOf(w) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, ctx.snapshot, marksRev]);
  const show = state.show === 'own' || state.show === 'watch' ? state.show : 'both';
  const rows = useMemo(() => (show === 'own' ? ownRows : show === 'watch' ? watchRows : [...ownRows, ...watchRows]), [show, ownRows, watchRows]);

  /* whether dealer hedging works with each contract today — a book a name, built once a sweep */
  const hedgeOf = useMemo(() => {
    const books = new Map<string, ExposureProfileData | null>();
    return (row: ListRow): Verdict | null => {
      const c = row.kind === 'watch' ? row.w : row.p;
      const live = row.kind === 'watch' ? row.w.status === 'open' : c.expiry >= isoDate(today());
      if (!live) return null;
      let prof = books.get(c.ticker);
      if (prof === undefined) {
        try {
          const snap = c.ticker === ctx.ticker ? ctx.snapshot : snapshotOf(c.ticker);
          prof = snap ? profile30(snap) : null;
        } catch {
          prof = null;
        }
        books.set(c.ticker, prof);
      }
      if (!prof) return null;
      const pos: Position = row.kind === 'own' ? row.p : { id: row.w.id, ticker: row.w.ticker, strike: row.w.strike, right: row.w.right, side: 'long', contracts: row.w.size, expiry: row.w.expiry, entry: row.w.addedMark, source: 'you', addedAt: row.w.addedAt };
      return readPosition(pos, prof).verdict;
    };
  }, [ctx.snapshot, ctx.ticker]);

  const pick = useCallback(
    (row: ListRow) => {
      const c = row.kind === 'watch' ? row.w : row.p;
      door('/weigher', { weigh: { ticker: c.ticker, strike: c.strike, right: c.right, expiry: c.expiry } });
    },
    [door]
  );

  if (rows.length === 0) return <TileEmpty words={show === 'watch' ? 'Nothing watched yet. Press + on a strike in the Weigher’s chain and it stays here.' : show === 'own' ? 'No positions yet. Add one you own or sold on the Weigher.' : 'Nothing held or watched yet. Add a position, or press + on a strike, on the Weigher.'} door="Open the Weigher" onDoor={() => door('/weigher')} />;
  const total = ownRows.reduce((a, r) => a + (r.kind === 'own' ? r.total ?? 0 : 0), 0);
  const against = rows.filter(r => hedgeOf(r) === 'against').length;
  const openWatch = watchRows.filter(r => r.kind === 'watch' && r.w.status === 'open').length;
  return (
    <div className="h-full min-h-0 flex flex-col" data-positions-tile>
      <div className="flex-1 min-h-0">
        <ListGrid rows={rows} selectedId={null} onPick={pick} hedgeOf={hedgeOf} emptyText="Nothing here yet" testId="pulse-positions" />
      </div>
      <TileRead testId="positions">
        {ownRows.length > 0 && (
          <>
            {ownRows.length} {ownRows.length === 1 ? 'position' : 'positions'}, <span className={`font-mono tnum ${dirInk(total)}`}>{usdSigned(total)}</span> since you added {ownRows.length === 1 ? 'it' : 'them'}.{' '}
          </>
        )}
        {openWatch > 0 && `${openWatch} watched. `}
        {against > 0 ? `Dealer hedging works against ${against} of them today.` : 'Dealer hedging is not working against any of them today.'}
      </TileRead>
    </div>
  );
};

