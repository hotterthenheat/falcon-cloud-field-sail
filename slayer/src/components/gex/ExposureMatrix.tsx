/* The exposure matrix, a view of the calendar's box: one row a strike and for each greek the net (or put/call legs,
   per `LEGS`) as a figure over a bar in the Colours ramp; the spot rule splits the strikes above and below price. */

import { levelRoles, type LevelRole } from '../../core/walls';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { HEAT_MODE, heatLadderColor, type HeatMode } from './heatmap';
import RoomSpotRule from './RoomSpotRule';
import { useRoomSpotRead } from '../../pages/pinpoint/useRoomSpot';
import PointerCard, { CardRow, PointerFollowCard, letGoWords } from '../ui/PointerCard';

const letGo = letGoWords();
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { shownGreek } from './retailSign';
import { GREEKS, GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { ABSORB, AMPLIFY, CALL_WALL, EMBER, FLIP, GLACIER, PUT_WALL, SUPREME } from './paletteInk';
import { strikeRole, underlineClass } from './strikeRole';
import StrikeNum, { hasCents } from './StrikeNum';
import { useResolvedTheme } from '../../theme/theme';
import { nearestStrikes, strikeGap } from '../../data/chartMoves';
import type { SurfaceCell } from './exposureView';
import { fmtStrike } from '../../core/format';
import { attachScrollMore } from '../ui/scrollMore';

interface ExposureMatrixProps {
  surface: ExposureSurface;
  liveSpot: number;
  /** False while the book is a replayed minute's: the spot row reads that minute. */
  live?: boolean;
  /** The greeks drawn, in the band's pick — a column group each */
  greeks: Greek[];
  /** Indices into surface.expiries — the band's window, summed per cell */
  expiries: number[];
  /** Strikes each side of spot */
  rings: number;
  hoverStrike?: number | null;
  palette?: 'house' | 'thermal';
  selectedStrike?: number | null;
  marks?: ReadonlyMap<number, string>;
  onPointer?: (cell: SurfaceCell | null, clientX: number, clientY: number) => void;
  onSelectStrike?: (strike: number) => void;
  /** The greek the pointer card reads — the band's lead */
  lead?: Greek;
  /** Which legs the cells carry (the band's Legs card): the net, one leg, or both. */
  legs?: 'net' | 'call' | 'put' | 'both' | 'all';
  /** The table's widest width (strike column plus every leg at MATRIX_COL_W), told to the host to pack panes. */
  /** The expiry window the rows add up ("Oct 23 → Nov 3"), on each greek's head so a row is not read as a level's figure. */
  windowLabel?: string | null;
  /** A level's own figure on hover: rows print the matrix window's sum; where that window differs from the Levels card's
      contracts, the supreme's and walls' GEX cells are marked and their hover adds the Levels figure. Null off those contracts. */
  levelLegsAt?: ((strike: number) => { put: number; call: number; net: number } | null) | null;
  /** The Levels card's contracts in words ("Today · Oct 23") — for the marked cells' hover */
  levelsWords?: string | null;
  /** The rows are coloured by the window's own levels (not the Levels card's) — the head says so */
  windowLevels?: boolean;
  /** The prices the chart's biggest swings turned at. Absent, the whole book. Snapped onto the rows this window actually draws. */
  movePrices?: number[];
  onNatural?: (px: number) => void;
}

type Leg = 'put' | 'call' | 'net';
/* The net alone by default, one column a greek with its bar the whole lane; the Legs card can draw one leg,
   or both with the put's bar growing left and the call's right from the seam. */
const legsOf = (pick: 'net' | 'call' | 'put' | 'both' | 'all'): Leg[] => (pick === 'all' ? ['put', 'call', 'net'] : pick === 'both' ? ['put', 'call'] : [pick]);
const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'vega $', vanna: 'VANNA', charm: 'CHARM', color: 'COLOR', vomma: 'VOMMA', speed: 'SPEED', veta: 'VETA', zomma: 'ZOMMA' };
const SILVER = 'rgb(var(--silver))';
/* Legs in the capsules' inks (ember, glacier); red and green stay for the walls, which are levels. */
const PUT_INK = EMBER;
const CALL_INK = GLACIER;
const ROW_H = 30;
/* Rows share the box down to a floor, with no ceiling; ROW_H is only the first frame's guess. */
/* 24 px: a 12 px figure, its gap and the 3 px track; forty rows scroll in an 870 px box, centred on spot, rather than crush. */
const ROW_MIN = 24;
/* A cell: the figure over a thin bar on a faint track. 120 px holds a level's word and "−$40.5M" at 12 px;
   where nothing stands beside the panes the table fills its pane. */
const MATRIX_COL_W = 120;
/** The narrowest a leg's column is drawn: "−$93.2M" at 12px and the cell's padding */
const LEG_MIN = 80;
/* The card: four rows and one line, wide enough for "Open interest · 18,709 contracts" (the calendar's matches). */
export const CARD_W = 224;
const head = 'font-mono text-t11 font-semibold uppercase tracking-widest';

interface Row {
  strike: number;
  legs: Record<Greek, { put: number; call: number; net: number }>;
}

/* Groups apart: a hairline at each group's left edge, a faint wash on every other group, a little air at the seam. */
/* The dark terminal gets a shade more hairline and wash; the light values stand. */
const groupSkin = (gi: number, first: boolean, last: boolean, paper: boolean) =>
  `${first ? `border-l ${paper ? 'border-borderSubtle' : 'border-borderMuted'} pl-3` : ''} ${last ? 'pr-3' : ''} ${gi % 2 === 1 ? (paper ? 'bg-ink/[0.02]' : 'bg-ink/[0.045]') : ''}`;

const Cell = ({ value, shown, leg, cap, mode, paper, gi, first, last, rowH = ROW_H, heavy = true, level = null }: { value: number; /** the figure printed — the kept value in the reader's sign (retailSign.ts); the ink reads the kept value */ shown: number; leg: Leg; cap: number; mode: HeatMode; paper: boolean; gi: number; first: boolean; last: boolean; /** the row's height — the figure and its track centred in it */ rowH?: number; /** one of the column's three heaviest bars: full ink; the rest a step quieter, so the walls pop */ heavy?: boolean; /** the cell prints the Levels card's figure, not the window's — the ink it is marked in and the hover */ level?: { ink: string; title: string } | null }) => {
  const pending = !Number.isFinite(value);
  const pct = pending ? 0 : Math.min(100, (Math.abs(value) / Math.max(1, cap)) * 100);
  const ink = pending || value === 0 ? 'transparent' : heatLadderColor(value, cap, mode, paper);
  return (
    <td className={`px-2.5 py-0 align-middle ${groupSkin(gi, first, last, paper)}`} data-matrix-leg={leg} data-matrix-level-cell={level ? '' : undefined} title={level?.title}>
      <div className="flex flex-col justify-center" style={{ height: Math.max(ROW_MIN, rowH) - 1 }}>
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          {/* No level words in the cells: walls and supreme show as the strike's ink and on the card; the spacer keeps the figure right. */}
          <span aria-hidden />
          <span className={`font-mono text-t12 tnum leading-none whitespace-nowrap ${leg === 'net' ? 'font-bold text-textPrimary' : 'font-medium text-textPrimary'} ${level ? 'underline decoration-dotted underline-offset-2' : ''}`} style={level ? { textDecorationColor: level.ink } : undefined}>{pending ? '—' : fmtUsd(shown)}</span>
        </div>
        {/* the track under every figure, the bar on it — the width with the data, the ink with the Colours switch */}
        <span className={`relative block w-full h-[3px] mt-[5px] rounded-full ${paper ? 'bg-ink/[0.1]' : 'bg-ink/[0.08]'}`} data-matrix-track>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: ink, opacity: heavy ? 1 : 0.72 }} data-matrix-heavy={heavy || undefined} />
        </span>
      </div>
    </td>
  );
};

const ExposureMatrix = ({ surface, liveSpot, live = true, greeks, expiries, rings, hoverStrike, palette = 'house', selectedStrike, marks, onPointer, onSelectStrike, lead: leadProp, legs: legsPick = 'net', onNatural, windowLabel = null, levelLegsAt = null, levelsWords = null, windowLevels = false, movePrices }: ExposureMatrixProps) => {
  const mode: HeatMode = palette === 'thermal' ? 'thermal-yellow' : HEAT_MODE;
  const paper = useResolvedTheme() === 'light';
  const shownGreeks = useMemo(() => GREEKS.filter(g => greeks.includes(g)), [greeks]);
  /* the pane's width and its strike column's, measured below — declared here, the legs read them */
  const [strikeColW, setStrikeColW] = useState(0);
  const [boxW, setBoxW] = useState(0);
  /* The legs picked, and the legs that fit: a pane too narrow for all three (LEG_MIN each) shows the net, and the head says so.
     The natural width is always the picked legs', so a host never holds a pane narrow. */
  const PICKED = useMemo(() => legsOf(legsPick), [legsPick]);
  const LEGS = useMemo<Leg[]>(() => {
    if (PICKED.length < 3 || boxW <= 0) return PICKED;
    const per = (boxW - (strikeColW || 84)) / (Math.max(1, shownGreeks.length) * PICKED.length);
    return per < LEG_MIN ? ['net'] : PICKED;
  }, [PICKED, boxW, strikeColW, shownGreeks.length]);
  const lead: Greek = leadProp && shownGreeks.includes(leadProp) ? leadProp : shownGreeks[0] ?? 'gex';
  const cols = 1 + shownGreeks.length * LEGS.length;
  /* The expiries drawn are the host's list, so every view sums the same book. */
  const shownIdx = useMemo(() => (expiries.length ? expiries.filter(i => i >= 0 && i < surface.expiries.length) : [Math.max(0, surface.expiries.findIndex(e => e.dte === 0))]), [expiries, surface]);
  /* Rows split at the room's live price: the count of strikes at or over it, re-rendered only when that count changes;
     the pill between reads the price itself (RoomSpotRule). */
  const splitAt = useRoomSpotRead(surface.ticker, sp => surface.strikes.filter(s => s >= (sp ?? liveSpot ?? surface.spot)).length, Object.is, live);
  const { above, below } = useMemo(() => {
    const desc = [...surface.strikes].sort((a, b) => b - a);
    return {
      above: desc.slice(0, splitAt).slice(-Math.max(1, rings)),
      below: desc.slice(splitAt).slice(0, Math.max(1, rings)),
    };
  }, [surface, rings, splitAt]);
  const rowFor = (strike: number): Row => {
    const si = surface.strikes.indexOf(strike);
    const legs = {} as Row['legs'];
    for (const g of GREEKS) {
      let put = 0, call = 0, net = 0;
      const waiting = !!surface.priced?.[g]?.length && !shownIdx.some(e => surface.priced[g][e] !== false);
      if (si >= 0 && !waiting)
        for (const e of shownIdx) {
          if (surface.priced?.[g]?.[e] === false) continue;
          put += surface.put[g][e]?.[si] ?? 0;
          call += surface.call[g][e]?.[si] ?? 0;
          net += surface.net[g][e]?.[si] ?? 0;
        }
      legs[g] = waiting ? { put: Number.NaN, call: Number.NaN, net: Number.NaN } : { put, call, net };
    }
    return { strike, legs };
  };
  const rowsAbove = useMemo(() => above.map(rowFor), [above, surface, shownIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowsBelow = useMemo(() => below.map(rowFor), [below, surface, shownIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => [...rowsAbove, ...rowsBelow], [rowsAbove, rowsBelow]);
  /* THE SCALES — each column against its own heaviest among the rows shown: a bar's length and its ink read the same */
  const caps = useMemo(() => {
    const m = {} as Record<Greek, Record<Leg, number>>;
    for (const g of GREEKS) {
      const fin = (leg: Leg) => rows.map(r => r.legs[g][leg]).filter(n => Number.isFinite(n));
      m[g] = {
        put: Math.max(1, ...fin('put')),
        call: Math.max(1, ...fin('call')),
        net: Math.max(1, ...fin('net')),
      };
    }
    return m;
  }, [rows]);

  const levels = surface.levels;
  /* Each column's three heaviest bars at full ink, the rest a step down. */
  const heavyBy = useMemo(() => {
    const out: Record<string, Set<number>> = {};
    for (const g of shownGreeks)
      for (const leg of LEGS) out[`${g}|${leg}`] = new Set([...rows].sort((a, b) => Math.abs(b.legs[g][leg]) - Math.abs(a.legs[g][leg])).slice(0, 3).map(r => r.strike));
    return out;
  }, [rows, shownGreeks, LEGS]);
  const cents = useMemo(() => hasCents(rows.map(r => r.strike)), [rows]);
  const pinStrike = surface.front.strikes.find(r => r.pin)?.strike;
  /* Every role, in LEVEL_ORDER (core/walls.ts), inked by the first. */
  const tagFor = (strike: number): { word: string; ink: string } | null => {
    const roles = levelRoles(strike, { supreme: levels.supreme, callWall: levels.callWall, putWall: levels.putWall, flip: levels.flipFound === false ? null : levels.flip });
    if (roles.length) return { word: roles.join(' · '), ink: ROLE_INKS[roles[0]] };
    return strike === pinStrike ? { word: 'pin', ink: 'rgb(var(--text-muted))' } : null;
  };
  const ROLE_INKS: Record<LevelRole, string> = { supreme: SUPREME, 'call wall': CALL_WALL, 'put wall': PUT_WALL, flip: FLIP };

  /* The kept strike, the ladder's rule: no hover card while one is kept; a click off the rows lets it go. */
  const keptStrike = selectedStrike ?? null;
  const pinned = keptStrike != null;
  const keptRef = useRef(keptStrike);
  keptRef.current = keptStrike;
  useEffect(() => {
    if (!pinned) return;
    const h = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (t?.closest('[data-matrix-row],[data-ladder-row],[data-cell],[data-strike],[data-profile-panel],[data-dropdown],[data-dropdown-card],[role="menu"],[data-focus-chip],[data-guide-door],button,a,input,select,textarea')) return;
      if (keptRef.current != null) onSelectStrike?.(keptRef.current);
    };
    /* Escape lets go too, first and alone (the calendar's rule). */
    const k = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented || keptRef.current == null) return;
      if ((ev.target as Element | null)?.closest?.('input,textarea,select,[role="menu"],[role="dialog"]')) return;
      ev.preventDefault();
      onSelectStrike?.(keptRef.current);
    };
    document.addEventListener('click', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('click', h);
      document.removeEventListener('keydown', k);
    };
  }, [pinned, onSelectStrike]);

  /* The pointer card: one mounted element per hover, tracking the pointer itself. */
  const [hovered, setHovered] = useState<number | null>(null);
  const [card, setCard] = useState<{ strike: number; x: number; y: number } | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  /* A click keeps the card on its row (an offset from the row's box, re-read on scroll and resize) until the strike is let go;
     a strike kept from elsewhere anchors at the strike cell's right edge. */
  const [keptAt, setKeptAt] = useState<{ strike: number; dx: number; dy: number } | null>(null);
  const [keptPos, setKeptPos] = useState<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /* a matrix wider than its box (a narrow pane's panel) fades the edge that has more columns behind it (.scroll-fade) */
  useEffect(() => {
    const el = scrollRef.current;
    return el ? attachScrollMore(el) : undefined;
    // the columns come and go with the greeks, the expiries and the legs shown
  }, [greeks.length, expiries.length, legsPick]);
  useLayoutEffect(() => {
    if (keptStrike == null) {
      setKeptPos(null);
      return;
    }
    const box = scrollRef.current;
    const at = keptAt && Math.abs(keptAt.strike - keptStrike) < 1e-9 ? keptAt : null;
    const read = () => {
      const row = box?.querySelector<HTMLElement>(`[data-matrix-row="${keptStrike}"]`);
      if (!row) {
        setKeptPos(null);
        return;
      }
      const r = row.getBoundingClientRect();
      /* Only while its row is on screen; the head's chip keeps the strike meanwhile. */
      const b = box?.getBoundingClientRect();
      const seen = r.bottom > 0 && r.top < window.innerHeight && (!b || (r.bottom > b.top && r.top < b.bottom));
      if (!seen) {
        setKeptPos(null);
        return;
      }
      const td = row.firstElementChild?.getBoundingClientRect();
      setKeptPos({ x: r.left + (at ? at.dx : (td?.width ?? 80) + 8), y: r.top + (at ? at.dy : r.height / 2) });
    };
    read();
    box?.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, { capture: true, passive: true });
    return () => {
      box?.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, { capture: true });
    };
  }, [keptStrike, keptAt, rows]);
  const rowCard = (r: Row, start: { x: number; y: number }, still = false) => {
    const tag = tagFor(r.strike);
    const you = marks?.get(r.strike);
    const si = surface.strikes.indexOf(r.strike);
    const distPct = ((r.strike - surface.spot) / surface.spot) * 100;
    const l = r.legs[lead];
    const ink = heatLadderColor(l.net, caps[lead].net, mode, paper);
    const oi = si >= 0 ? shownIdx.reduce((s, e) => s + (surface.oi[e]?.[si] ?? 0), 0) : 0;
    const pct = (v: number, max: number) => `${Math.round((Math.abs(v) / Math.max(1, max)) * 100)}%`;
    const title = (
      <>
        {fmtStrike(r.strike)}
        {tag && (
          <span className="text-t11 uppercase tracking-widest font-normal" style={{ color: tag.ink }}>
            {tag.word}
          </span>
        )}
        {you && (
          <span className="text-t11 uppercase tracking-widest font-normal" style={{ color: SILVER }}>
            you
          </span>
        )}
      </>
    );
    const aside = `${distPct >= 0 ? '+' : '−'}${Math.abs(distPct).toFixed(2)}% · ${distPct >= 0 ? 'above' : 'below'} spot`;
    /* The card ends in plain words; the percent is of the column's heaviest. */
    const empty = Math.abs(l.put) < 1e-9 && Math.abs(l.call) < 1e-9;
    const verdict = empty ? 'nothing here · no hedging at this strike' : lead === 'gex' ? (l.net >= 0 ? 'peak · hedging amplifies a move here' : 'well · hedging absorbs a move here') : l.net >= 0 ? 'the put side wins here' : 'the call side wins here';
    const verdictInk = empty ? 'rgb(var(--text-muted))' : l.net >= 0 ? AMPLIFY : ABSORB;
    const body = (
      <>
        <CardRow k="Put" v={fmtUsd(shownGreek(lead, l.put))} sub={pct(l.put, caps[lead].put)} ink={PUT_INK} />
        <CardRow k="Call" v={fmtUsd(shownGreek(lead, l.call))} sub={pct(l.call, caps[lead].call)} ink={CALL_INK} />
        <CardRow k={`Net · ${GREEK_LABEL[lead]}`} v={fmtUsd(shownGreek(lead, l.net))} sub={empty ? 'nothing' : l.net >= 0 ? 'put-heavy' : 'call-heavy'} ink={empty ? 'rgb(var(--text-muted))' : ink} />
        {oi > 0 && <CardRow k="Open interest" v={Math.round(oi).toLocaleString()} sub="contracts" />}
      </>
    );
    const words = <span style={{ color: verdictInk }}>{verdict}</span>;
    return still ? (
      <PointerCard x={start.x} y={start.y} still dense width={CARD_W} testId="data-matrix-card" testValue={r.strike} title={title} aside={aside} foot={<>{words}<span className="block mt-0.5 text-t11 uppercase tracking-wider text-textMuted">kept · {letGo}</span></>}>
        {body}
      </PointerCard>
    ) : (
      <PointerFollowCard start={start} dense width={CARD_W} testId="data-matrix-card" testValue={r.strike} title={title} aside={aside} foot={words}>
        {body}
      </PointerFollowCard>
    );
  };
  /* Hover still reads other rows while a strike is kept: one card at a time, the kept one back when the pointer leaves. */
  const cardRow = card && !(keptStrike != null && Math.abs(card.strike - keptStrike) < 1e-9) ? rows.find(r => Math.abs(r.strike - card.strike) < 1e-9) ?? null : null;
  const keptRow = pinned ? rows.find(r => Math.abs(r.strike - keptStrike) < 1e-9) ?? null : null;

  /* Keyboard: the table is one tab stop; ↑ ↓ walk strikes, Home/End jump, Enter/Space keeps the row. The walk starts on the kept
     strike, else just over spot, and shows only under :focus-visible. */
  const [keyRow, setKeyRow] = useState<number | null>(null);
  const rowId = (strike: number) => `matrix-${surface.ticker}-${String(strike).replace('.', '_')}`;
  const walkTo = (strike: number) => {
    setKeyRow(strike);
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-matrix-row="${strike}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    const b = row.getBoundingClientRect();
    const td = row.firstElementChild?.getBoundingClientRect();
    const x = b.left + (td?.width ?? 80) + 8;
    const y = b.top + b.height / 2;
    setHovered(strike);
    setCard({ strike, x, y });
    onPointer?.({ strike, e: shownIdx[0] ?? 0 }, x, y);
  };
  const leaveKeys = () => {
    setKeyRow(null);
    setHovered(null);
    setCard(null);
    onPointer?.(null, 0, 0);
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || !rows.length) return;
    const i = keyRow == null ? -1 : rows.findIndex(r => Math.abs(r.strike - keyRow) < 1e-9);
    let next: Row | undefined;
    if (e.key === 'ArrowDown' || e.key === 'j') next = rows[Math.min(rows.length - 1, i + 1)];
    else if (e.key === 'ArrowUp' || e.key === 'k') next = rows[Math.max(0, i - 1)];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    else if ((e.key === 'Enter' || e.key === ' ') && keyRow != null) {
      e.preventDefault();
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-matrix-row="${keyRow}"]`);
      const b = row?.getBoundingClientRect();
      const td = row?.firstElementChild?.getBoundingClientRect();
      if (b) setKeptAt({ strike: keyRow, dx: (td?.width ?? 80) + 8, dy: b.height / 2 });
      onSelectStrike?.(keyRow);
      return;
    } else return;
    e.preventDefault();
    if (next) walkTo(next.strike);
  };

  /* the box opens with price in the middle of it, once per name */
  const spotRef = useRef<HTMLTableRowElement | null>(null);
  /* Columns hold still: a fixed layout, the strike column at its widest possible row (measured off the head's reserve),
     the legs sharing the rest, so changing figures never nudge columns. */
  const [reserve, setReserve] = useState<HTMLSpanElement | null>(null);
  const [strikeWord, setStrikeWord] = useState<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (!reserve) return;
    const read = () => {
      /* the widest strike, or the column's own word if that is wider — the column is never narrower than its head */
      const w = Math.ceil(Math.max(reserve.offsetWidth, strikeWord?.offsetWidth ?? 0) + 14); // pl-2 + pr-1.5
      setStrikeColW(prev => (prev === w ? prev : w));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(reserve);
    return () => ro.disconnect();
  }, [reserve, strikeWord]);
  /* A leg's column as drawn: the box past the strike column, shared by the legs; under the figure, gap and 40 px of lane it stacks. */
  const legW = boxW > 0 ? (boxW - (strikeColW || 84)) / Math.max(1, shownGreeks.length * LEGS.length) : MATRIX_COL_W;
  /* a column too narrow for its unit on the head (four names on a laptop): the greek alone there */
  const stacked = legW < 96;
  /* The head's words by room (7.2 px a character at 11 px): greek, leg and unit; greek and leg; or the greek alone. Never a wrap. */
  const headRoom = legW * LEGS.length;
  const headChars = (g: (typeof shownGreeks)[number], withUnit: boolean) =>
    `${GREEK_LABEL[g]}${LEGS.length === 1 ? ` · ${LEGS[0]}` : ''}${withUnit ? ` · ${GREEK_UNIT[g]}` : ''}`.length;
  const headFits = (withUnit: boolean) => headRoom >= Math.max(0, ...shownGreeks.map(g => headChars(g, withUnit))) * 7.2 + 16;
  const headTier: 'full' | 'leg' | 'greek' = stacked ? 'greek' : headFits(true) ? 'full' : LEGS.length === 1 && headFits(false) ? 'leg' : 'greek';
  /* The pane's natural width, told to the host: the strike column as measured and every leg at its widest. */
  const natural = strikeColW > 0 ? strikeColW + shownGreeks.length * PICKED.length * MATRIX_COL_W : 0;
  /* Before paint, so a new pane reports its width and centres on the price in its first frame. */
  useLayoutEffect(() => {
    if (natural > 0) onNatural?.(natural);
  }, [natural, onNatural]);
  /* Rows share the box: its height less the head and spot row, over the rows, between ROW_MIN and ROW_H. */
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [rowH, setRowH] = useState(ROW_H);
  const centredFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    /* re-centred once the rows take their height too — centred at the first height, the rows then shrank under it */
    /* A new name re-centres on its own price; the key is spent only once the price row is on the page, so late rows still centre. */
    const row = spotRef.current;
    const box = row?.closest('[data-matrix-scroll]') as HTMLElement | null;
    if (!row || !box || !rows.length) return;
    const key = `${surface.ticker}|${rowH}|${rows.length}|${rows[0]?.strike}`;
    if (centredFor.current === key) return;
    centredFor.current = key;
    let top = Math.max(0, row.offsetTop - box.clientHeight / 2);
    /* No row half under the sticky head: the first row starts whole. */
    const head = theadRef.current?.offsetHeight ?? 0;
    if (top > 0) {
      for (const el of box.querySelectorAll<HTMLElement>('[data-matrix-row]')) {
        if (el.offsetTop >= top + head - 1) {
          top = Math.max(0, el.offsetTop - head);
          break;
        }
      }
    }
    box.scrollTop = top;
  }, [surface.ticker, rows, rowH]);
  /* the pixels the even share leaves over, one each to as many rows, spread down the table — the last row ends on the
     box's foot */
  const [rowExtra, setRowExtra] = useState(0);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const read = () => {
      const head = theadRef.current?.offsetHeight ?? 32;
      const spot = spotRef.current?.offsetHeight ?? 28;
      /* the collapsed table counts each row's 1px rule inside its height — a pixel taken off for it left 40px under the last row */
      const room = box.clientHeight - head - spot;
      const n = Math.max(1, rows.length);
      const next = Math.max(ROW_MIN, Math.floor(room / n));
      const extra = next * n <= room ? Math.min(n - 1, room - next * n) : 0;
      setRowH(prev => (prev === next ? prev : next));
      setRowExtra(prev => (prev === extra ? prev : extra));
      setBoxW(prev => (prev === box.clientWidth ? prev : box.clientWidth));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, [rows.length]);

  const moveSet = movePrices ? new Set(nearestStrikes(movePrices, rows.map(r => r.strike), strikeGap(rows.map(r => r.strike)))) : null;
  const renderRow = (r: Row) => {
    const at = rows.indexOf(r);
    const plus = rowExtra > 0 && Math.floor(((at + 1) * rowExtra) / rows.length) > Math.floor((at * rowExtra) / rows.length) ? 1 : 0;
    const on = keptStrike === r.strike;
    const lit = hoverStrike === r.strike || hovered === r.strike;
    const walked = keyRow != null && Math.abs(keyRow - r.strike) < 1e-9;
    const role = strikeRole(r.strike, { supreme: levels.supreme, callWall: levels.callWall, putWall: levels.putWall, flip: levels.flipFound === false ? Number.NaN : levels.flip, pin: pinStrike, owned: !!marks?.has(r.strike) });
    const tag = tagFor(r.strike);
    const you = marks?.get(r.strike);
    const moved = !!moveSet?.has(r.strike);
    return (
      <tr
        key={r.strike}
        id={rowId(r.strike)}
        aria-label={`${fmtStrike(r.strike)}${tag ? ` · ${tag.word}` : ''}${you ? ' · you own' : ''}${moved ? ' · a chart move turned here' : ''} · net ${GREEK_LABEL[lead]} ${fmtUsd(shownGreek(lead, r.legs[lead].net))}`}
        onPointerEnter={ev => {
          if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
          leaveTimer.current = 0;
          setHovered(r.strike);
          setCard(c => (c && c.strike === r.strike ? c : { strike: r.strike, x: ev.clientX, y: ev.clientY }));
          onPointer?.({ strike: r.strike, e: shownIdx[0] ?? 0 }, ev.clientX, ev.clientY);
        }}
        onPointerLeave={ev => {
          onPointer?.(null, ev.clientX, ev.clientY);
          if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
          leaveTimer.current = window.setTimeout(() => {
            leaveTimer.current = 0;
            setHovered(h => (h === r.strike ? null : h));
            setCard(c => (c && c.strike === r.strike ? null : c));
          }, 70);
        }}
        onClick={ev => {
          const b = ev.currentTarget.getBoundingClientRect();
          setKeptAt({ strike: r.strike, dx: ev.clientX - b.left, dy: ev.clientY - b.top });
          onSelectStrike?.(r.strike);
        }}
        className={`relative border-b border-borderSubtle/30 transition-colors ${onSelectStrike ? 'cursor-pointer' : ''} ${on ? 'bg-ink/[0.05]' : lit ? 'bg-ink/[0.04]' : ''} ${moved ? 'bg-silver/[0.1]' : ''} ${pinned && !on ? 'opacity-60' : ''} ${moveSet && moveSet.size > 0 && !moved && !on ? 'opacity-40' : ''}`}
        style={{ height: rowH + plus, ...(moved ? { boxShadow: 'inset 2px 0 0 0 rgb(var(--silver))' } : on ? { boxShadow: `inset 2px 0 0 0 ${SILVER}` } : walked ? { boxShadow: 'inset 0 0 0 2px rgb(var(--silver) / var(--ring-a))' } : {}) }}
        data-matrix-row={r.strike}
        data-chart-move={moved || undefined}
        data-kept={on || undefined}
        data-walked={walked || undefined}
        title={you}
      >
        {/* The strike at the far left, its column no wider than its widest row. */}

        {/* Extra foot room lifts the strike onto its figures' line (the cells stack a 3 px beam under the figure). */}
        <td className={`pl-2 pr-1.5 ${rowH < 20 ? 'pt-0 pb-1' : 'pt-0.5 pb-2'} leading-tight bg-inset text-right font-mono text-t11 font-semibold tnum text-textPrimary whitespace-nowrap`}>
          {/* The level as the strike's ink (strikeRole.ts); words after it widened the column for every strike. */}
          <span
            className={`${role.ink ? 'font-bold' : on || lit ? 'text-textPrimary' : ''} ${underlineClass(role.underline)}`}
            style={role.ink ? { color: role.ink } : undefined}
            title={role.words.length ? `${fmtStrike(r.strike)} · ${role.words.join(' · ')}` : undefined}
            data-matrix-role={role.words.length ? role.words.join(' · ') : undefined}
          >
            <StrikeNum v={r.strike} cents={cents} />
          </span>
        </td>
        {shownGreeks.map((g, gi) =>
          LEGS.map((leg, li) => {
            const lvl = g === 'gex' && windowLabel && role.ink && (r.strike === levels.supreme || r.strike === levels.callWall || r.strike === levels.putWall) ? levelLegsAt?.(r.strike) ?? null : null;
            /* Every row is the matrix window's figure; a level's own figure lives on the cell's hover and the level chips. */
            const v = r.legs[g][leg];
            return (
              <Cell
                key={`${g}-${leg}`}
                value={v}
                shown={shownGreek(g, v)}
                leg={leg}
                cap={caps[g][leg]}
                mode={mode}
                paper={paper}
                gi={gi}
                first={li === 0}
                last={li === LEGS.length - 1}
                rowH={rowH + plus}
                heavy={heavyBy[`${g}|${leg}`]?.has(r.strike) ?? true}
                level={lvl ? { ink: role.ink!, title: `${fmtStrike(r.strike)} ${leg} · ${fmtUsd(shownGreek(g, v))} — this row adds up the matrix window, ${windowLabel} · on the Levels card's contracts (${levelsWords ?? 'its scope'}) alone, the figure the level is named by: ${fmtUsd(shownGreek(g, lvl[leg]))}` } : null}
              />
            );
          })
        )}
      </tr>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      {moveSet && (
        <div className="shrink-0 h-7 flex items-center gap-2 px-3 border-b border-borderSubtle font-mono text-t11 text-textSecondary whitespace-nowrap overflow-x-auto" data-matrix-moves={movePrices?.length ?? 0}>
          {movePrices && movePrices.length > 0 ? `${movePrices.length} biggest ${movePrices.length === 1 ? 'move' : 'moves'} on the chart` : 'No swing on the chart yet'}
          {movePrices && movePrices.length > 0 && <span className="text-textMuted">· {movePrices.map(s => s.toFixed(2)).join(' · ')}</span>}
        </div>
      )}
    <div
      ref={scrollRef}
      className="overflow-auto flex-1 min-h-0 scroll-fade"
      tabIndex={0}
      role="group"
      aria-label="The book by strike — the arrow keys walk the strikes, Enter keeps one"
      aria-activedescendant={keyRow != null ? rowId(keyRow) : undefined}
      onFocus={e => {
        if (e.target !== e.currentTarget || keyRow != null || !e.currentTarget.matches(':focus-visible')) return;
        const start = keptStrike ?? above[above.length - 1] ?? rows[0]?.strike;
        if (start != null) walkTo(start);
      }}
      onBlur={e => {
        if (e.target === e.currentTarget) leaveKeys();
      }}
      onKeyDown={onKeys}
      data-matrix-scroll
      data-exposure-matrix={surface.ticker}
      data-matrix-palette={palette}
    >
      <table className="border-collapse" style={{ width: '100%', minWidth: (strikeColW || 84) + shownGreeks.length * LEGS.length * LEG_MIN, tableLayout: strikeColW ? 'fixed' : 'auto' }}>
        {strikeColW > 0 && (
          <colgroup>
            <col style={{ width: strikeColW }} />
            {shownGreeks.map(g => LEGS.map(leg => <col key={`${g}-${leg}`} />))}
          </colgroup>
        )}
        <thead ref={theadRef} className="sticky top-0 z-10 bg-panel shadow-[0_8px_8px_-8px_rgba(0,0,0,0.55)]">
          <tr>
            <th className={`${head} !tracking-normal pl-2 pr-1.5 pt-2 pb-1 text-right text-textSecondary border-b border-borderSubtle bg-panel`}>
              {/* The column's width is reserved for the widest row, set invisibly, so a wall's words moving never move the columns. */}
              <span ref={setReserve} aria-hidden className="invisible block h-0 w-max overflow-hidden whitespace-nowrap normal-case tracking-normal text-t11 font-semibold tnum">
                {cents ? `${Math.floor(Math.max(...rows.map(r => r.strike), 0))}.00` : rows.map(r => fmtStrike(r.strike)).reduce((a, b) => (b.length > a.length ? b : a), '')}
              </span>
              <span ref={setStrikeWord}>Strike</span>
            </th>
            {shownGreeks.map((g, gi) => (
              <th
                key={g}
                colSpan={LEGS.length}
                /* The head's cells carry the panel ground: a sticky head is only as opaque as its cells. */
                className={`${head} px-2 pt-2 pb-1 text-center border-b border-l bg-panel ${paper ? 'border-borderSubtle' : 'border-borderMuted'} ${g === lead && shownGreeks.length > 1 ? 'text-silver' : 'text-textPrimary'}`}
                data-matrix-group={g}
                data-lead={g === lead || undefined}
                /* The silver head is the greek the pointer card reads, and says so. */
                title={`${g === lead && shownGreeks.length > 1 ? `The greek the card reads · ${GREEK_UNIT[g]}` : GREEK_UNIT[g]}${windowLabel ? (windowLevels ? ` · each row adds up the matrix window, ${windowLabel} (the Expiries card), and the coloured rows are that window's own call wall, put wall and supreme — the Levels card (${levelsWords ?? 'its scope'}) names its own on the rest of the page` : ` · each row adds up the matrix window, ${windowLabel} (the Expiries card) — not the Levels card's contracts, so a level's row can differ from the level's own figure`) : ''}`}
              >
                {/* One leg, one head: with the net alone the leg rides the greek's head ("GEX · net · 1% move"). */}
                {/* A narrow column wears the greek alone; its unit is in the title. */}
                <span className="inline-block max-w-full whitespace-nowrap truncate align-bottom" data-matrix-head-tier={headTier}>
                  {GREEK_LABEL[g]}
                  {headTier !== 'greek' && (
                    <span className="text-textSecondary font-medium normal-case tracking-normal">
                      {LEGS.length === 1 ? ` · ${LEGS[0]}` : ''}
                      {headTier === 'full' ? ` · ${GREEK_UNIT[g]}` : ''}
                    </span>
                  )}
                  {windowLabel && headTier !== 'greek' && (
                    <span className="text-warn font-medium normal-case tracking-normal" data-matrix-window>
                      {' '}
                      · {windowLabel}
                    </span>
                  )}
                </span>
                {/* The legs' words on the same head row: Chromium does not paint a second sticky <tr> opaque in a collapsed-border table. */}
                {LEGS.length > 1 && (
                  <span className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${LEGS.length}, minmax(0, 1fr))` }} data-matrix-legs>
                    {LEGS.map(leg => (
                      <span key={leg} className={`pr-0.5 text-right ${leg === 'net' ? 'text-textPrimary' : 'text-textSecondary'}`}>
                        {leg}
                      </span>
                    ))}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsAbove.map(renderRow)}
          <tr ref={spotRef} data-matrix-spot>
            {/* The rule under the net columns alone, the strike column's cell empty. */}
            {/* …and across the whole pane when the legs are narrow, where the price pill is wider than one stacked leg. */}
            {!stacked && <td aria-hidden />}
            <td colSpan={stacked ? cols : cols - 1} className="px-2 py-1">
              <RoomSpotRule ticker={surface.ticker} fallback={liveSpot ?? surface.spot} centre live={live} />
            </td>
          </tr>
          {rowsBelow.map(renderRow)}
        </tbody>
      </table>
      {cardRow && card && <Fragment key="card">{rowCard(cardRow, card)}</Fragment>}
      {keptRow && keptPos && !cardRow && <Fragment key="kept">{rowCard(keptRow, keptPos, true)}</Fragment>}
    </div>
    </div>
  );
};

export default ExposureMatrix;
