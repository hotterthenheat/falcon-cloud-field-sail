/* The trade tiles: Compass's own calls (a card opens that setup's page), the live chain (a strike unfolds its
   weigh-up and the book's read), and the Weigher's two lists — what you hold and what you watch — marked at the
   live vendor quotes. */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import SetupScanCard from '../../../components/compass/SetupScanCard';
import { CHAIN_COLUMNS, ChainCard, DEFAULT_COLS, type ChainCol } from '../../../components/weigher/ChainGrid';
import { ListGrid, usdSigned, type ListRow } from '../../../components/weigher/PositionsList';
import { expiryFor, isoDate, MONTHS, today } from '../../../core/calendar';
import { buildBook } from '../../../data/bookAtStrike';
import { setupIdOf } from '../../../data/compass';
import { useThetaBook } from '../../../data/thetaBook';
import { costOf } from '../../../data/positionCurve';
import { readPosition, useAllPositions, type Position, type Verdict } from '../../../data/positions';
import { returnsOf, tickWatchlist, useWatchlist } from '../../../data/watchlist';
import { blankChain, loadLiveChain, type DeskChain } from '../../../data/weigherDesk';
import { peekThetaMark, useThetaMarks, useThetaStatus } from '../../../data/thetaQuote';
import { AsOf, EmptyBox, LoadingBox, asOfText } from '../../../components/ui/states';
import { snapshotOf } from '../../../data/uwBook';
import { SLEEVES, type OptionRight, type Setup, type SleeveKey } from '../../../types/compass';
import type { ExposureProfileData } from '../../../types/gex';
import type { WatchedContract } from '../../../types/watchlist';
import type { TileControl, TileProps, TileState, WorkspaceCtx } from '../tile';
import { profile30 } from './derive';
import { TileEmpty, TileRead, dirInk, useDoor } from './parts';

/* an expiry's calendar date (the date object is the day itself, not an instant) */
const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/* ------------------------------------------------------------------ Compass setups */

/* the scan runs two expiries: today's and this week's */
const SCAN_SLEEVES = SLEEVES.filter(s => s.key === 'odte' || s.key === 'weekly');
const sleeveOfState = (state: TileState): SleeveKey => (state.sleeve === 'odte' ? 'odte' : 'weekly');

export const setupsControls = (): TileControl[] => [
  { id: 'sleeve', label: 'Expiry', title: 'How far out the contracts run', options: SCAN_SLEEVES.map(s => ({ value: s.key, label: `${s.label} · ${fmtDay(expiryFor(s.dte).date)}`, hint: s.blurb })) },
];

/** The cards, kept: they re-render when the scan hands a new ranking */
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

/* Compass's own scan, run on the terminal's live quotes while the tile is on the desk (data/thetaBook.ts) */
export const SetupsTile = ({ state }: TileProps) => {
  const door = useDoor();
  const sleeve = sleeveOfState(state);
  const view = useThetaBook(sleeve);
  const today = view.setups;
  const earlier = today.length === 0 ? view.earlier : null;
  const ranked = earlier ? earlier.setups.filter(s => (sleeve === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE')) : today;
  const expiryChip = useMemo(() => expiryFor(SLEEVES.find(s => s.key === sleeve)?.dte ?? 5).label, [sleeve]);
  const open = useCallback((s: Setup) => door(`/compass/${setupIdOf({ ticker: s.ticker, strike: s.strike, right: s.right, scanner: 'top-setups', sleeve })}`), [door, sleeve]);
  if (ranked.length === 0) {
    if (view.status === 'down') return <EmptyBox title="ThetaData offline" reason="Compass scans on the terminal’s live quotes. The cards come back when it answers." />;
    if (view.status === 'loading') return <LoadingBox shape="block" className="h-full p-2" label="Compass is scanning" />;
    return <TileEmpty words="Nothing cleared the bar on this expiry yet." />;
  }
  const top = ranked[0];
  return (
    <div className="h-full min-h-0 flex flex-col" data-setups-tile>
      <Cards ranked={ranked} expiryChip={expiryChip} onOpen={open} />
      <TileRead testId="setups">
        {earlier ? <AsOf at={earlier.at} prefix="last scan" className="mr-1.5" /> : null}
        {view.status === 'down' ? <span className="text-warn">ThetaData offline. </span> : null}
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
  /* Our two cents on every strike — the dealer book's read, where the tile has the width for it */
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
        {chain.kept && chain.takenAt ? <AsOf at={chain.takenAt} className="mr-1.5" /> : null}
        {chain.offline ? <span className="text-warn">ThetaData offline. </span> : null}
        {chain.rows.length > 0 && chain.expectedMovePct > 0 ? (
          <>
            {ctx.ticker} options are charging for a move of ±{chain.expectedMovePct.toFixed(1)}% by {fmtDay(chain.expiry.date)}
            {chain.expiry.dte === 0 ? ', today’s bell' : ` — ${chain.expiry.sessions} ${chain.expiry.sessions === 1 ? 'session' : 'sessions'} out`}. Press a strike for its weigh-up.
          </>
        ) : chain.rows.length > 0 ? (
          'Press a strike for its weigh-up.'
        ) : (
          `Reading ${ctx.ticker}’s chain for ${fmtDay(chain.expiry.date)}.`
        )}
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
  /* every contract's real-time NBBO off the terminal; a kept mark (terminal down) is stamped with its instant */
  const marksRev = useThetaMarks(useMemo(() => [...positions, ...watchlist.filter(w => w.status === 'open')].map(c => ({ ticker: c.ticker, expiry: c.expiry, strike: c.strike, right: c.right })), [positions, watchlist]));
  const theta = useThetaStatus();
  /* the desk's sweep marks the watchlist's closes and settles what has expired */
  useEffect(() => {
    tickWatchlist();
  }, [ctx.snapshot]);
  const ownRows = useMemo<ListRow[]>(
    () =>
      [...positions]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map<ListRow>(p => {
          const held = peekThetaMark(p.ticker, p.expiry, p.strike, p.right);
          const value = held && held.value.mark > 0 ? held.value.mark : null;
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
          const snap = c.ticker === ctx.ticker && ctx.snapshot ? ctx.snapshot : snapshotOf(c.ticker);
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
  /* the total over the rows that have a mark; a row with none is not a zero */
  const priced = ownRows.filter(r => r.kind === 'own' && r.total != null);
  const total = priced.reduce((a, r) => a + (r.kind === 'own' ? r.total ?? 0 : 0), 0);
  /* the oldest kept mark on the tile, while the terminal is down */
  const keptAt = theta === 'down' ? rows.reduce<number | null>((m, r) => {
    const c = r.kind === 'watch' ? r.w : r.p;
    const h = peekThetaMark(c.ticker, c.expiry, c.strike, c.right);
    return h && !h.live ? Math.min(m ?? Infinity, h.value.read) : m;
  }, null) : null;
  const against = rows.filter(r => hedgeOf(r) === 'against').length;
  const openWatch = watchRows.filter(r => r.kind === 'watch' && r.w.status === 'open').length;
  return (
    <div className="h-full min-h-0 flex flex-col" data-positions-tile>
      <div className="flex-1 min-h-0">
        <ListGrid rows={rows} selectedId={null} onPick={pick} hedgeOf={hedgeOf} emptyText="Nothing here yet" testId="pulse-positions" />
      </div>
      <TileRead testId="positions">
        {theta === 'down' && <span className="text-warn">ThetaData offline{keptAt ? ` · marks ${asOfText(keptAt)}` : ' · no marks'}. </span>}
        {ownRows.length > 0 && (
          priced.length > 0 ? (
            <>
              {ownRows.length} {ownRows.length === 1 ? 'position' : 'positions'}, <span className={`font-mono tnum ${dirInk(total)}`}>{usdSigned(total)}</span> since you added {ownRows.length === 1 ? 'it' : 'them'}{priced.length < ownRows.length ? ` (${priced.length} marked)` : ''}.{' '}
            </>
          ) : (
            <>{ownRows.length} {ownRows.length === 1 ? 'position' : 'positions'}, not marked yet. </>
          )
        )}
        {openWatch > 0 && `${openWatch} watched. `}
        {against > 0 ? `Dealer hedging works against ${against} of them today.` : 'Dealer hedging is not working against any of them today.'}
      </TileRead>
    </div>
  );
};

