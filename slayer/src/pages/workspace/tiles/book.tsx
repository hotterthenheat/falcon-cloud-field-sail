/*
  Pulse's book tiles, each one instrument over the live dealer book: the book, key levels, the range, where it
  closes, at the wall, targets, where the walls are heading, and head to head.
*/

import { holdShort } from '../../../data/wall';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import BookRead from '../../../components/gex/BookRead';
import ExposureLedger from '../../../components/gex/ExposureLedger';
import ExposureMatrix from '../../../components/gex/ExposureMatrix';
import KeyLevelsRail from '../../../components/gex/KeyLevelsRail';
import WallHeading from '../../../components/gex/WallHeading';
import { GREEK_PICK_OPTIONS, pickGreeks } from '../../../components/gex/exposureView';
import { heatLaneColor } from '../../../components/gex/heatmap';
import { ladderExpiryOptions, LADDER_RANGES } from '../../../components/gex/ladderControls';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME, THERMAL_WARM } from '../../../components/gex/paletteInk';
import { useFocus } from '../../../context/FocusContext';
import { expiryFor } from '../../../core/calendar';
import { snapshotOf } from '../../../data/uwBook';
import { AGENDA_ORDERS, type AgendaOrder, type Target } from '../../../data/agenda';
import { fmtDollars } from '../../../data/ahead';
import { buildCompare, buildCompareSide, partnerFor, regimeWord, type CompareSide } from '../../../data/compare';
import type { StrikeWindow } from '../../../data/exposure';
import { fmtTwin, twinFamilyFor, twinLabel, twinPrice, type TwinLensKey } from '../../../data/indexTwins';
import { useResolvedTheme } from '../../../theme/theme';
import type { ExposureExpiry } from '../../../types/gex';
import type { TileControl, TileProps, TileState, WorkspaceCtx } from '../tile';
import { useDeskClock } from '../useDeskClock';
import { agendaOf, buildingOf, clockNow, keyLevelsOf, surface30 } from './derive';
import { TileHeads, TileNoBook, TileRead, TileRow, TileRows, dirInk, fmtStrike, signedPct, useDoor } from './parts';

const SILVER = 'rgb(var(--silver))';
const same = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;
/** A strike kept in the tile: a second click lets it go */
const useKept = () => {
  const [kept, setKept] = useState<number | null>(null);
  const keep = useCallback((strike: number) => setKept(k => (same(k, strike) ? null : strike)), []);
  return [kept, keep] as const;
};

/* ------------------------------------------------------------------ the book */

export type BookView = 'matrix' | 'calendar';
/** The view a tile's settings name — anything that is not the calendar is the matrix (a desk saved with the old ladder) */
export const bookViewOf = (view: unknown): BookView => (view === 'calendar' ? 'calendar' : 'matrix');
const VIEW_OPTIONS: TileControl['options'] = [
  { value: 'matrix', label: 'Matrix', hint: 'One row a strike — puts, calls and the net, a figure and its bar in every cell' },
  { value: 'calendar', label: 'Calendar', hint: 'Every strike and expiry a capsule — the book across the dates' },
];
const GREEK_OPTIONS: TileControl['options'] = [...GREEK_PICK_OPTIONS.filter(o => o.value !== 'all'), ...GREEK_PICK_OPTIONS.filter(o => o.value === 'all')].map(o => ({ value: o.value, label: o.label, hint: o.hint }));
const STRIKE_OPTIONS: TileControl['options'] = LADDER_RANGES.filter(r => r !== 25).map(r => ({ value: String(r), label: `${r} each side`, hint: r === 30 ? 'The whole book' : `${r} strikes above spot and ${r} below` }));
const SPAN_OPTIONS: TileControl['options'] = [
  { value: 'week', label: 'This week', hint: 'Every expiry inside the week' },
  { value: 'next', label: 'The next seven', hint: 'The nearest seven expiries' },
];
/** How many expiries the calendar draws at most, by how many greeks stand side by side (the Map's own ceiling) */
const CEILING: Record<number, number> = { 1: 8, 2: 8, 3: 8, 4: 8, 5: 7, 6: 6, 7: 5, 8: 4, 9: 4, 10: 3 };

export const bookControls = ({ state }: { ctx: WorkspaceCtx; state: TileState }): TileControl[] => [
  { id: 'view', label: 'View', options: VIEW_OPTIONS, title: 'How the book is drawn' },
  { id: 'greek', label: 'Greek', options: GREEK_OPTIONS, title: 'Which hedging the book weighs' },
  bookViewOf(state.view) === 'calendar' ? { id: 'span', label: 'Expiries', options: SPAN_OPTIONS, title: 'How far out the calendar runs' } : { id: 'expiry', label: 'Expiry', options: ladderExpiryOptions().map(o => ({ value: o.value, label: o.label, hint: o.hint })), title: 'Which contracts the book weighs' },
  { id: 'strikes', label: 'Strikes', options: STRIKE_OPTIONS, title: 'How many strikes around spot' },
];

export const BookTile = ({ ctx, state, set }: TileProps) => {
  const view = bookViewOf(state.view);
  const greeks = useMemo(() => pickGreeks([String(state.greek ?? 'gex')]), [state.greek]);
  const rings = (Number(state.strikes) || 10) as StrikeWindow;
  const expiry = (state.expiry as ExposureExpiry) ?? '0DTE';
  const span = state.span === 'next' ? 'next' : 'week';
  const paper = useResolvedTheme() === 'light';
  const [kept, keep] = useKept();
  const surface = surface30(ctx.snapshot);

  /* what fits: the calendar reports how many expiries it can print at its width — an empty capsule is never drawn */
  const [fit, setFit] = useState(Infinity);
  const onFit = useCallback((_key: string, n: number | null) => setFit(n ?? Infinity), []);

  /* THE TILE'S EXPIRY, as the book's columns: one date (the nearest the book holds), every one, or the calendar's run */
  const expiries = useMemo(() => {
    if (!surface) return [];
    const all = surface.expiries.map((_, i) => i);
    if (view === 'calendar') {
      const weekEnd = surface.expiries.reduce((last, e, i) => (e.dte <= 5 ? i : last), 0);
      const through = span === 'week' ? weekEnd : Math.min(6, all.length - 1);
      return all.slice(0, Math.min(through + 1, CEILING[Math.min(10, Math.max(1, greeks.length))] ?? 3));
    }
    if (expiry === 'ALL') return all;
    const want = ladderExpiryOptions().find(o => o.value === expiry)?.date?.getTime();
    if (want == null) return [0];
    let best = 0;
    surface.expiries.forEach((e, i) => {
      if (Math.abs(expiryFor(e.dte).date.getTime() - want) < Math.abs(expiryFor(surface.expiries[best].dte).date.getTime() - want)) best = i;
    });
    return [best];
  }, [surface, view, expiry, span, greeks.length]);
  const shown = useMemo(() => (view === 'calendar' ? expiries.slice(0, Math.max(1, fit)) : expiries), [view, expiries, fit]);

  /* the read's own pointer feed — the row under the pointer, straight from the instrument */
  const pointedRef = useRef<((strike: number | null) => void) | null>(null);
  const subscribePointed = useCallback((fn: (strike: number | null) => void) => {
    pointedRef.current = fn;
    return () => {
      if (pointedRef.current === fn) pointedRef.current = null;
    };
  }, []);
  const onPointer = useCallback((cell: { strike: number } | null) => pointedRef.current?.(cell?.strike ?? null), []);

  if (!surface) return <TileNoBook ticker={ctx.ticker} />;
  const common = { surface, liveSpot: ctx.snapshot.spot, greeks, rings, palette: 'thermal' as const, selectedStrike: kept, onSelectStrike: keep, onPointer };
  return (
    <div className="relative h-full min-h-0" data-book-tile={view}>
      {view === 'matrix' ? <ExposureMatrix {...common} expiries={shown} /> : <ExposureLedger {...common} expiries={shown} fitKey={ctx.ticker} onFit={onFit} paper={paper} />}
      {/* THE READ — the Map's own glass card over the right of the book, in the tile's first greek */}
      {!!state.read && <BookRead surface={surface} snapshot={ctx.snapshot} greek={greeks[0] ?? 'gex'} mode="thermal-yellow" expiries={shown} afterBell={false} rings={rings} selectedStrike={kept} subscribePointed={subscribePointed} onKeep={keep} onClose={() => set({ read: false })} />}
    </div>
  );
};

/* ------------------------------------------------------------------ key levels */

const LENSES: TwinLensKey[] = ['etf', 'index', 'futures'];
export const levelsControls = ({ ctx }: { ctx: WorkspaceCtx; state: TileState }): TileControl[] => {
  const fam = twinFamilyFor(ctx.ticker);
  if (!fam) return [];
  const spot = ctx.exposure.levels.spot;
  return [{ id: 'lens', label: 'Prices in', options: LENSES.map(k => ({ value: k, label: twinLabel(fam, k), hint: fmtTwin(twinPrice(fam, k, spot, spot)) })), title: 'The instrument the levels are priced in' }];
};

export const LevelsTile = ({ ctx, state }: TileProps) => {
  const rows = keyLevelsOf(ctx.snapshot);
  const fam = twinFamilyFor(ctx.ticker);
  const lens: TwinLensKey = fam && LENSES.includes(state.lens as TwinLensKey) ? (state.lens as TwinLensKey) : 'etf';
  const shown = useMemo(() => {
    if (!rows) return [];
    if (!fam || lens === 'etf') return rows;
    const etfSpot = rows.find(r => r.kind === 'spot')?.price ?? ctx.exposure.levels.spot;
    const spotTwin = twinPrice(fam, lens, etfSpot, etfSpot);
    return rows.map(r => {
      const price = twinPrice(fam, lens, r.price, etfSpot);
      return { ...r, price, distPct: r.kind === 'spot' ? 0 : ((price - spotTwin) / (spotTwin || 1)) * 100 };
    });
  }, [rows, fam, lens, ctx.exposure.levels.spot]);
  if (!rows) return <TileNoBook ticker={ctx.ticker} />;
  const { spot, callWall, putWall, flip } = ctx.exposure.levels;
  const above = spot >= flip;
  return (
    <div className="h-full min-h-0 flex flex-col" data-levels-tile>
      <TileRows>
        <KeyLevelsRail rows={shown} maxPressure={rows.reduce((a, l) => Math.max(a, l.pressure), 1)} priceFormat={fam && lens !== 'etf' ? fmtTwin : undefined} />
      </TileRows>
      <TileRead testId="levels">
        {ctx.ticker} is {above ? 'above' : 'below'} the flip at {fmtStrike(flip)}, where dealer hedging {above ? 'slows moves down' : 'pushes moves along'}. The call wall is {fmtStrike(callWall)}, the put wall {fmtStrike(putWall)}.
      </TileRead>
    </div>
  );
};

/* the range, where it closes and at the wall stood here until 2026-10-17 — gone with the Ahead and At-the-wall pages */

/* ------------------------------------------------------------------ targets */

const pct = (v: number) => `${Math.round(v * 100)}%`;

const ROLE_INK: Record<string, string> = { 'call wall': CALL_WALL, 'put wall': PUT_WALL, supreme: SUPREME, flip: FLIP };
const kindOf = (t: Target) => (t.role ? 'named' : t.isShelf ? 'shelf' : t.isWall ? 'thin' : 'trapdoor');
export const targetsControls = (): TileControl[] => [{ id: 'order', label: 'Ranked by', options: AGENDA_ORDERS.map(o => ({ value: o.value, label: o.label, hint: o.hint })), title: 'The order of the list' }];

export const TargetsTile = ({ ctx, state, size }: TileProps) => {
  const order = (state.order as AgendaOrder) ?? 'matters';
  const agenda = agendaOf(ctx.snapshot, order);
  const door = useDoor();
  const { focusOn } = useFocus();
  if (!agenda) return <TileNoBook ticker={ctx.ticker} />;
  const wide = size.room !== 'small';
  /** # · strike · reached · holds · at stake (the stake's lane only where there is room for it) */
  const cols = wide ? '26px minmax(0,1fr) 46px 86px 104px' : '26px minmax(0,1fr) 46px 60px';
  const maxStake = Math.max(1, ...agenda.targets.map(t => t.stake));
  const inSession = clockNow().inSession;
  return (
    <div className="h-full min-h-0 flex flex-col" data-targets-tile>
      <TileHeads columns={cols}>
        <span>#</span>
        <span>Strike</span>
        <span className="text-right">{inSession ? 'Reached' : 'Next'}</span>
        <span className="text-right">Holds</span>
        {wide && <span>At stake</span>}
      </TileHeads>
      <TileRows>
        {agenda.targets.map(t => {
          const kind = kindOf(t);
          const first = agenda.first[0]?.strike === t.strike;
          return (
            <TileRow
              key={t.strike}
              columns={cols}
              testId={String(t.strike)}
              title={`${t.words} — open the Agenda on ${fmtStrike(t.strike)}`}
              onClick={() => {
                focusOn(t.strike, ctx.ticker);
                door('/pinpoint/agenda');
              }}
            >
              <span className={first ? 'font-bold' : 'text-textSecondary'} style={first ? { color: SUPREME } : undefined}>
                #{t.rank}
              </span>
              <span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                <span className="text-t12 font-bold text-textPrimary">{fmtStrike(t.strike)}</span>
                {kind !== 'thin' && (
                  <span className="text-t8 uppercase tracking-widest" style={{ color: t.role ? ROLE_INK[t.role] : t.isShelf ? 'rgb(var(--text-muted))' : THERMAL_WARM }}>
                    {t.role ?? (t.isShelf ? 'shelf' : 'trapdoor')}
                  </span>
                )}
                <span className="text-t9 text-textMuted">{signedPct(t.distancePct)}</span>
              </span>
              <span className="text-right text-textPrimary">{pct(t.reach)}</span>
              <span className="flex items-center justify-end gap-1.5 font-semibold" style={{ color: t.isShelf ? SILVER : kind === 'trapdoor' ? THERMAL_WARM : 'rgb(var(--text-muted))' }}>
                {t.isShelf ? holdShort(t.hold) : '—'}
                {wide && (
                  <span className="relative block h-[5px] w-[32px] rounded-full bg-ink/[0.06] overflow-hidden" aria-hidden>
                    {kind === 'trapdoor' ? <span className="absolute inset-0 rounded-full" style={{ background: THERMAL_WARM, opacity: 0.35 }} /> : <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.isShelf ? t.hold : 0) * 100}%`, background: SILVER, opacity: 0.85 }} />}
                  </span>
                )}
              </span>
              {wide && (
                <span className="relative h-[30px] flex items-center">
                  <span className="absolute inset-y-[12px] left-0 right-12 rounded-full bg-ink/[0.04]" />
                  <span className="absolute inset-y-[12px] left-0 rounded-full" style={{ width: `calc(${(t.stake / maxStake) * 100}% - ${(t.stake / maxStake) * 48}px)`, background: heatLaneColor(t.isWall ? -t.stake : t.stake, maxStake, 'thermal-yellow', 0.35) }} />
                  <span className="absolute right-0 text-t10 text-textPrimary">{fmtDollars(t.stake)}</span>
                </span>
              )}
            </TileRow>
          );
        })}
      </TileRows>
      <TileRead testId="targets">{agenda.sentence}</TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ where the walls are heading */

export const HeadingTile = ({ ctx }: TileProps) => {
  const clock = useDeskClock();
  const data = buildingOf(ctx.snapshot);
  if (!data) return <TileNoBook ticker={ctx.ticker} />;
  return <WallHeading data={data} clock={clock} bare fill />;
};

/* ------------------------------------------------------------------ head to head */

const againstOf = (ctx: WorkspaceCtx, state: TileState) => {
  const asked = typeof state.against === 'string' ? state.against : '';
  return asked && asked !== ctx.ticker ? asked : partnerFor(ctx.ticker);
};
export const pairAgainst = againstOf;
export const pairControls = ({ ctx, state }: { ctx: WorkspaceCtx; state: TileState }): TileControl[] => {
  const partner = partnerFor(ctx.ticker);
  const names = [...new Set([partner, ...PAIR_NAMES])].filter(t => t !== ctx.ticker);
  const value = againstOf(ctx, state);
  return [{ id: 'against', label: 'Against', title: 'The second name', options: (names.includes(value) ? names : [value, ...names]).map(t => ({ value: t, label: t, hint: t === partner ? `${ctx.ticker}'s usual pair` : undefined })) }];
};

/* The names offered as the second side, beside the name's usual pair */
const PAIR_NAMES = ['SPY', 'QQQ', 'IWM', 'AAPL', 'NVDA'];

const levelWords = (l: { strike: number; distPct: number } | null) => (l ? `${fmtStrike(l.strike)} · ${signedPct(l.distPct)}` : '—');

export const PairTile = ({ ctx, state }: TileProps) => {
  const b = againstOf(ctx, state);
  const cmp = useMemo(() => {
    try {
      const clock = clockNow();
      const sa = buildCompareSide(ctx.snapshot, clock);
      const snapB = snapshotOf(b);
      const sb = snapB ? buildCompareSide(snapB, clock) : null;
      return sa && sb ? buildCompare(sa, sb, clock) : null;
    } catch {
      return null;
    }
  }, [ctx.snapshot, b]);
  if (!cmp) return <TileNoBook ticker={ctx.ticker} />;
  const cols = 'minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr)';
  const flipOf = (s: CompareSide) => (s.flip != null && s.flipDistPct != null ? { strike: s.flip, distPct: s.flipDistPct } : null);
  const rows: { read: string; a: ReactNode; b: ReactNode }[] = [
    { read: 'Today', a: <span className={dirInk(cmp.a.changePct)}>{signedPct(cmp.a.changePct)}</span>, b: <span className={dirInk(cmp.b.changePct)}>{signedPct(cmp.b.changePct)}</span> },
    { read: cmp.inSession ? 'Move left today' : 'A day’s move', a: `±${cmp.a.sigmaLeftPct.toFixed(2)}%`, b: `±${cmp.b.sigmaLeftPct.toFixed(2)}%` },
    { read: 'Call wall', a: levelWords(cmp.a.callWall), b: levelWords(cmp.b.callWall) },
    { read: 'Put wall', a: levelWords(cmp.a.putWall), b: levelWords(cmp.b.putWall) },
    { read: 'Flip', a: levelWords(flipOf(cmp.a)), b: levelWords(flipOf(cmp.b)) },
    { read: 'Likeliest close', a: cmp.a.closes ? fmtStrike(cmp.a.closes.strike) : '—', b: cmp.b.closes ? fmtStrike(cmp.b.closes.strike) : '—' },
    { read: 'Dealers', a: `${regimeWord(cmp.a)} moves`, b: `${regimeWord(cmp.b)} moves` },
  ];
  return (
    <div className="h-full min-h-0 flex flex-col" data-pair-tile={`${cmp.a.ticker}:${cmp.b.ticker}`}>
      <TileHeads columns={cols}>
        <span />
        <span className="text-right text-textPrimary font-bold">{cmp.a.ticker}</span>
        <span className="text-right text-textPrimary font-bold">{cmp.b.ticker}</span>
      </TileHeads>
      <TileRows>
        {rows.map(r => (
          <TileRow key={r.read} columns={cols} height={28}>
            <span className="font-sans text-t11 text-textSecondary truncate">{r.read}</span>
            <span className="text-right text-textPrimary truncate">{r.a}</span>
            <span className="text-right text-textPrimary truncate">{r.b}</span>
          </TileRow>
        ))}
      </TileRows>
      <TileRead testId="pair">{cmp.sentence}</TileRead>
    </div>
  );
};
