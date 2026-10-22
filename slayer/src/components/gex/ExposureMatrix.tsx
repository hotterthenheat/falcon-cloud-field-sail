/*
==================================================
  SLAYER TERMINAL - THE EXPOSURE MATRIX
  (components/gex/ExposureMatrix.tsx)

  Back at Noah's word (2026-09-28, with the picture
  of the 22 August build: "delete the first part of
  the pinpoint map page that showcases our current
  ladder and replace that with this one"), then made
  A VIEW OF THE CALENDAR'S BOX ("this should have the
  same hover card and top button layout that the
  ladder had with the color palette choice and all …
  the calendar should be a button you can switch up
  top as well like matrix vs calendar"). So it reads
  what the ladder read — the surface under the
  band's expiries, strikes and greeks — and wears
  what the ladder wore: the Colours switch's ramp on
  every bar, the pointer card, the kept strike, the
  wall words on the strike.

  The table it was: one row a strike, and for every
  greek three cells — PUT · CALL · NET — each a
  figure with a thin bar under it, the bar's length
  the cell's share of its column's heaviest and its
  ink that share on the palette's ramp (warm or gold
  where hedging amplifies, cool or ice where it
  absorbs; the August red-and-green on the legs went,
  because red and green mean price direction in this
  house and the leg's name stands in the head). The
  spot rule between the strikes above and below
  price.

  SINCE 2026-10-12 (the partner, through Noah): the
  NET alone on the table, one column a greek filling
  the box, its bar the whole lane; the put and call
  legs stay on the pointer card. `LEGS` says which.
==================================================
*/

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { HEAT_MODE, heatLadderColor, type HeatMode } from './heatmap';
import RoomSpotRule from './RoomSpotRule';
import { useRoomSpotRead } from '../../pages/pinpoint/useRoomSpot';
import PointerCard, { CardRow, PointerFollowCard, letGoWords } from '../ui/PointerCard';

const letGo = letGoWords();
import { fmtUsd } from '../../data/gex';
import { GREEKS, GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { ABSORB, AMPLIFY, CALL_WALL, EMBER, FLIP, GLACIER, PUT_WALL, SUPREME } from './paletteInk';
import { strikeRole, underlineClass } from './strikeRole';
import StrikeNum, { hasCents } from './StrikeNum';
import { useResolvedTheme } from '../../theme/theme';
import type { SurfaceCell } from './exposureView';

interface ExposureMatrixProps {
  surface: ExposureSurface;
  liveSpot: number;
  /** False while the book is a replayed minute's — the spot row reads that minute, not the room (2026-10-14) */
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
  /** Which legs the cells carry (the band's Legs card, 2026-10-13): the net, one leg, or both side by side */
  legs?: 'net' | 'call' | 'put' | 'both' | 'all';
  /** The table's width at its widest — the strike column and every leg's column at MATRIX_COL_W — told to the host,
      which packs the names' panes to it (2026-10-13) */
  onNatural?: (px: number) => void;
}

type Leg = 'put' | 'call' | 'net';
/* THE NET ALONE ON THE TABLE BY REST (the partner through Noah, 2026-10-12: the matrix "only showing the net and on
   hover do we keep the put/call etc" … "the net to fill its container"): one column a greek, as wide as the box lets
   it, its bar the whole lane; the put and call legs live on the pointer card. SINCE 2026-10-13 the band's Legs card can
   draw one leg alone, or BOTH — two columns a greek, the put's bar growing left and the call's right from the seam. */
const legsOf = (pick: 'net' | 'call' | 'put' | 'both' | 'all'): Leg[] => (pick === 'all' ? ['put', 'call', 'net'] : pick === 'both' ? ['put', 'call'] : [pick]);
const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'VEX', vanna: 'VANNA', charm: 'CHARM' };
const SILVER = 'rgb(var(--silver))';
/* THE LEGS IN THE CAPSULES' OWN INKS (the paying-user audit's H8, 2026-10-13): the card said Put in the put wall's red
   and Call in the call wall's green while the calendar's card said them in ember and glacier — one book, two codes. The
   walls keep red and green (they are levels); a leg is the ramp's side */
const PUT_INK = EMBER;
const CALL_INK = GLACIER;
const ROW_H = 30;
/* THE ROWS SHARE THE BOX, the ledger's way, down to this floor (the owner, 2026-10-13: the first row half under the head
   and the last cut at the foot — forty 27px rows never fit an 870px box) — and with no ceiling ("i dont want any
   deadspace": fullscreen left a quarter of every pane empty under 27px rows); ROW_H is only the first frame's guess */
/* 24 since the figure stands over its bar (2026-10-14): a 12px figure, the gap and the 3px track — forty rows of it
   scroll in an 870px box, the spot row centred on open, rather than crush to a hairline to fit */
const ROW_MIN = 24;
/* THE CELL (the owner, 2026-10-14, a picture of the matrix they want: "i like this matrix UI"): the figure over a thin
   bar on a faint track, put, call and net side by side under every greek, the greek and its unit on the group's head.
   120px holds the level's word and "−$40.5M" at 12px with air; where nothing stands beside the panes (the day box
   under the book, fullscreen) the table fills its pane and the tracks take the room. The logic is untouched: the
   same rows, caps, inks and levels; only how a cell is drawn. */
export const MATRIX_COL_W = 120;
/** The narrowest a leg's column is drawn: "−$93.2M" at 12px and the cell's padding */
const LEG_MIN = 80;
/* THE CARD (the owner, 2026-10-13: "the side panel thing is so damn big"): four rows, one line under them, and wide
   enough that "Open interest · 18,709 contracts" prints whole — the calendar's card is the same */
/* a bit smaller than it was (the owner, 2026-10-14) */
export const CARD_W = 224;
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const head = 'font-mono text-[11px] font-semibold uppercase tracking-widest';

interface Row {
  strike: number;
  legs: Record<Greek, { put: number; call: number; net: number }>;
}

/* THE GROUPS APART (Noah, 2026-09-28: "better dividers between each greek section … where the net ends and the put
   begins for another greek there is no appearance of separation, but it also should not cast too much attention"):
   the ladder's pane skin — a hairline at a group's left edge, a faint wash on every other group, a little more air
   at the seam. */
/* A shade more on the dark terminal (Noah: "a slight bit more for the dark mode, the light mode is pretty good") — the
   light values are untouched; the two grounds get their own hairline and wash. */
const groupSkin = (gi: number, first: boolean, last: boolean, paper: boolean) =>
  `${first ? `border-l ${paper ? 'border-borderSubtle' : 'border-borderMuted'} pl-3` : ''} ${last ? 'pr-3' : ''} ${gi % 2 === 1 ? (paper ? 'bg-ink/[0.02]' : 'bg-ink/[0.045]') : ''}`;

const Cell = ({ value, leg, cap, mode, paper, gi, first, last, rowH = ROW_H, heavy = true }: { value: number; leg: Leg; cap: number; mode: HeatMode; paper: boolean; gi: number; first: boolean; last: boolean; /** the row's height — the figure and its track centred in it */ rowH?: number; /** one of the column's three heaviest bars: full ink; the rest a step quieter, so the walls pop */ heavy?: boolean }) => {
  const pct = Math.min(100, (Math.abs(value) / Math.max(1, cap)) * 100);
  const ink = value === 0 ? 'transparent' : heatLadderColor(value, cap, mode, paper);
  return (
    <td className={`px-2.5 py-0 align-middle ${groupSkin(gi, first, last, paper)}`} data-matrix-leg={leg}>
      <div className="flex flex-col justify-center" style={{ height: Math.max(ROW_MIN, rowH) - 1 }}>
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          {/* NO LEVEL WORDS IN THE CELLS (Noah, 2026-10-15, on the matrix in Terrain's panel: "the walls and supreme should
              just be the color of the strike and show on the hover card but not on the actual matrix view") — the words
              that stood here since 2026-10-14 are the strike's ink and the card's; the spacer keeps the figure at the right */}
          <span aria-hidden />
          <span className={`font-mono text-[12px] tnum leading-none whitespace-nowrap ${leg === 'net' ? 'font-bold text-textPrimary' : 'font-medium text-textPrimary'}`}>{fmtUsd(value)}</span>
        </div>
        {/* the track under every figure, the bar on it — the width with the data, the ink with the Colours switch */}
        <span className={`relative block w-full h-[3px] mt-[5px] rounded-full ${paper ? 'bg-ink/[0.1]' : 'bg-ink/[0.08]'}`} data-matrix-track>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: ink, opacity: heavy ? 1 : 0.72 }} data-matrix-heavy={heavy || undefined} />
        </span>
      </div>
    </td>
  );
};

const ExposureMatrix = ({ surface, liveSpot, live = true, greeks, expiries, rings, hoverStrike, palette = 'house', selectedStrike, marks, onPointer, onSelectStrike, lead: leadProp, legs: legsPick = 'net', onNatural }: ExposureMatrixProps) => {
  const mode: HeatMode = palette === 'thermal' ? 'thermal-yellow' : HEAT_MODE;
  const paper = useResolvedTheme() === 'light';
  const shownGreeks = useMemo(() => GREEKS.filter(g => greeks.includes(g)), [greeks]);
  /* the pane's width and its strike column's, measured below — declared here, the legs read them */
  const [strikeColW, setStrikeColW] = useState(0);
  const [boxW, setBoxW] = useState(0);
  /* THE LEGS PICKED, AND THE LEGS THAT FIT (2026-10-14, four names on a 1440 laptop: the Net column was cut off past a
     277px pane): put, call and net need LEG_MIN a column; a pane narrower than that for all three shows the net they add
     to — the matrix's own one-leg head says so ("GEX · net") — and takes all three back the moment it has the room. The
     pane's natural width is always the picked legs', so a host packing the panes never holds one at the narrow width. */
  const PICKED = useMemo(() => legsOf(legsPick), [legsPick]);
  const LEGS = useMemo<Leg[]>(() => {
    if (PICKED.length < 3 || boxW <= 0) return PICKED;
    const per = (boxW - (strikeColW || 84)) / (Math.max(1, shownGreeks.length) * PICKED.length);
    return per < LEG_MIN ? ['net'] : PICKED;
  }, [PICKED, boxW, strikeColW, shownGreeks.length]);
  const lead: Greek = leadProp && shownGreeks.includes(leadProp) ? leadProp : shownGreeks[0] ?? 'gex';
  const cols = 1 + shownGreeks.length * LEGS.length;
  /* THE EXPIRIES DRAWN — the host's list, so every view sums the same book */
  const shownIdx = useMemo(() => (expiries.length ? expiries.filter(i => i >= 0 && i < surface.expiries.length) : [Math.max(0, surface.expiries.findIndex(e => e.dte === 0))]), [expiries, surface]);
  /* THE ROWS SPLIT ROUND THE PRICE NOW (one price on the page, 2026-10-14 — the spot row sat where the ten-second scan
     had left it while the head ticked on): the count of strikes at or over the room's price, re-rendered on only when
     it changes; the pill between them reads the price itself (RoomSpotRule) */
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
      if (si >= 0)
        for (const e of shownIdx) {
          put += surface.put[g][e]?.[si] ?? 0;
          call += surface.call[g][e]?.[si] ?? 0;
          net += surface.net[g][e]?.[si] ?? 0;
        }
      legs[g] = { put, call, net };
    }
    return { strike, legs };
  };
  const rowsAbove = useMemo(() => above.map(rowFor), [above, surface, shownIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowsBelow = useMemo(() => below.map(rowFor), [below, surface, shownIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => [...rowsAbove, ...rowsBelow], [rowsAbove, rowsBelow]);
  /* THE SCALES — each column against its own heaviest among the rows shown: a bar's length and its ink read the same */
  const caps = useMemo(() => {
    const m = {} as Record<Greek, Record<Leg, number>>;
    for (const g of GREEKS) m[g] = { put: Math.max(1, ...rows.map(r => Math.abs(r.legs[g].put))), call: Math.max(1, ...rows.map(r => Math.abs(r.legs[g].call))), net: Math.max(1, ...rows.map(r => Math.abs(r.legs[g].net))) };
    return m;
  }, [rows]);

  const levels = surface.levels;
  /* THE WALLS LOUDER, THE REST QUIETER (idea 9, 2026-10-14): a column's three heaviest bars at full ink, the others a
     step down — the walls pop the way they do on the tape, and nothing else changes */
  const heavyBy = useMemo(() => {
    const out: Record<string, Set<number>> = {};
    for (const g of shownGreeks)
      for (const leg of LEGS) out[`${g}|${leg}`] = new Set([...rows].sort((a, b) => Math.abs(b.legs[g][leg]) - Math.abs(a.legs[g][leg])).slice(0, 3).map(r => r.strike));
    return out;
  }, [rows, shownGreeks, LEGS]);
  const cents = useMemo(() => hasCents(rows.map(r => r.strike)), [rows]);
  const pinStrike = surface.front.strikes.find(r => r.pin)?.strike;
  const tagFor = (strike: number): { word: string; ink: string } | null =>
    strike === levels.supreme ? { word: 'supreme', ink: SUPREME }
    : strike === levels.callWall ? { word: 'call wall', ink: CALL_WALL }
    : strike === levels.putWall ? { word: 'put wall', ink: PUT_WALL }
    : strike === levels.flip ? { word: 'flip', ink: FLIP }
    : strike === pinStrike ? { word: 'pin', ink: 'rgb(var(--text-muted))' }
    : null;

  /* THE KEPT STRIKE — the ladder's rule: no card while one is kept; a click anywhere off the rows lets it go */
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
    /* Escape lets go too, first and alone (the paying-user audit's H6 — the calendar's rule) */
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

  /* THE POINTER CARD — the ladder's, one mounted element per hover, tracking the pointer by itself */
  const [hovered, setHovered] = useState<number | null>(null);
  const [card, setCard] = useState<{ strike: number; x: number; y: number } | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  /* A CLICK KEEPS THE CARD (2026-10-12, with the calendar's): the same card stands on the row where the pointer was
     when it was clicked — an offset from the row's box, read again on scroll and resize — until the strike is let go.
     A strike kept from elsewhere (the panel, the gutter) anchors at the strike cell's right edge. */
  const [keptAt, setKeptAt] = useState<{ strike: number; dx: number; dy: number } | null>(null);
  const [keptPos, setKeptPos] = useState<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
      /* ONLY WHILE ITS ROW IS ON THE SCREEN (2026-10-14, the phone: clamped to the viewport, the card rode the top-left
         corner over the day box and the report as the page scrolled) — the chip in the head keeps the strike meanwhile */
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
          <span className="text-[11px] uppercase tracking-widest font-normal" style={{ color: tag.ink }}>
            {tag.word}
          </span>
        )}
        {you && (
          <span className="text-[11px] uppercase tracking-widest font-normal" style={{ color: SILVER }}>
            you
          </span>
        )}
      </>
    );
    const aside = `${distPct >= 0 ? '+' : '−'}${Math.abs(distPct).toFixed(2)}% · ${distPct >= 0 ? 'above' : 'below'} spot`;
    /* THE CARD ENDS IN PLAIN WORDS, the calendar's way (the owner's walks, 2026-10-14: the matrix is the view the page
       opens on and its card stopped at a count of contracts); the percent says what it is of — the column's heaviest */
    const empty = Math.abs(l.put) < 1e-9 && Math.abs(l.call) < 1e-9;
    const verdict = empty ? 'nothing here · no hedging at this strike' : lead === 'gex' ? (l.net >= 0 ? 'peak · hedging amplifies a move here' : 'well · hedging absorbs a move here') : l.net >= 0 ? 'the put side wins here' : 'the call side wins here';
    const verdictInk = empty ? 'rgb(var(--text-muted))' : l.net >= 0 ? AMPLIFY : ABSORB;
    const body = (
      <>
        <CardRow k="Put" v={fmtUsd(l.put)} sub={pct(l.put, caps[lead].put)} ink={PUT_INK} />
        <CardRow k="Call" v={fmtUsd(l.call)} sub={pct(l.call, caps[lead].call)} ink={CALL_INK} />
        <CardRow k={`Net · ${GREEK_LABEL[lead]}`} v={fmtUsd(l.net)} sub={empty ? 'nothing' : l.net >= 0 ? 'put-heavy' : 'call-heavy'} ink={empty ? 'rgb(var(--text-muted))' : ink} />
        {oi > 0 && <CardRow k="Open interest" v={Math.round(oi).toLocaleString()} sub="contracts" />}
      </>
    );
    const words = <span style={{ color: verdictInk }}>{verdict}</span>;
    return still ? (
      <PointerCard x={start.x} y={start.y} still dense width={CARD_W} testId="data-matrix-card" testValue={r.strike} title={title} aside={aside} foot={<>{words}<span className="block mt-0.5 text-[11px] uppercase tracking-wider text-textMuted">kept · {letGo}</span></>}>
        {body}
      </PointerCard>
    ) : (
      <PointerFollowCard start={start} dense width={CARD_W} testId="data-matrix-card" testValue={r.strike} title={title} aside={aside} foot={words}>
        {body}
      </PointerFollowCard>
    );
  };
  /* THE HOVER GOES ON WHILE A STRIKE IS KEPT (the owner, 2026-10-14: "it should only do that if they click on that strike
     and then it'll stay but for normal should just be an easy hover"): a kept strike keeps its card on its row, and the
     pointer still reads every other row out — one card at a time, the kept one back when the pointer leaves */
  const cardRow = card && !(keptStrike != null && Math.abs(card.strike - keptStrike) < 1e-9) ? rows.find(r => Math.abs(r.strike - card.strike) < 1e-9) ?? null : null;
  const keptRow = pinned ? rows.find(r => Math.abs(r.strike - keptStrike) < 1e-9) ?? null : null;

  /* THE KEYS REACH THE ROWS (the audit's H10, 2026-10-13): the table is one tab stop; ↑ ↓ walk the strikes, Home and End
     jump to the ends, Enter or Space keeps the row — the same card and the same keep a click gives. The walked row lights
     as a hovered one does and wears the house ring; the walk starts on the kept strike, else the strike just over spot,
     and only from the keys (:focus-visible) — a click inside the box focuses it too, and changes nothing. */
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
  /* THE COLUMNS HOLD STILL (2026-10-12, the replay — Noah: "the only thing changing should be the color and
     numbers not the literal node shape or size"): an auto table hands every column a share of the width by what
     its cells say, so a figure growing from "$464.8M" to "-$1.1B" nudged every column half a pixel a step. The
     table is laid out FIXED: the strike column at the width of its widest possible row (measured off the reserve
     in its head), the legs sharing the rest equally. */
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
  /* A LEG'S COLUMN AS DRAWN: the box (or the natural width, if less) past the strike column, shared by the legs; under the
     figure, its gap and 40px of lane it stacks the figure over the bar instead (a phone, four names on a laptop) */
  const legW = boxW > 0 ? (boxW - (strikeColW || 84)) / Math.max(1, shownGreeks.length * LEGS.length) : MATRIX_COL_W;
  /* a column too narrow for its unit on the head (four names on a laptop): the greek alone there */
  const stacked = legW < 96;
  /* THE HEAD'S WORDS BY THE ROOM (Noah, 2026-10-18, a head on two lines — "VANNA · net · 1 vol / pt"): the greek, its
     leg and its unit when the group's width holds them at 11px (7.2px a character, the ledger's own measure); the
     greek and its leg when it holds that; the greek alone when stacked — never a wrap, the unit on the title instead */
  const headRoom = legW * LEGS.length;
  const headChars = (g: (typeof shownGreeks)[number], withUnit: boolean) =>
    `${GREEK_LABEL[g]}${LEGS.length === 1 ? ` · ${LEGS[0]}` : ''}${withUnit ? ` · ${GREEK_UNIT[g]}` : ''}`.length;
  const headFits = (withUnit: boolean) => headRoom >= Math.max(0, ...shownGreeks.map(g => headChars(g, withUnit))) * 7.2 + 16;
  const headTier: 'full' | 'leg' | 'greek' = stacked ? 'greek' : headFits(true) ? 'full' : LEGS.length === 1 && headFits(false) ? 'leg' : 'greek';
  /* THE PANE'S NATURAL WIDTH, told to the host (2026-10-13): the strike column as measured and every leg at its widest */
  const natural = strikeColW > 0 ? strikeColW + shownGreeks.length * PICKED.length * MATRIX_COL_W : 0;
  /* both before paint (2026-10-14): a pane added beside the others reports its width and centres its rows on the price in
     the frame it first stands in, never a frame later */
  useLayoutEffect(() => {
    if (natural > 0) onNatural?.(natural);
  }, [natural, onNatural]);
  const centredFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (centredFor.current === surface.ticker) return;
    centredFor.current = surface.ticker;
    const row = spotRef.current;
    const box = row?.closest('[data-matrix-scroll]') as HTMLElement | null;
    if (!row || !box) return;
    box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
  }, [surface.ticker, rows.length]);

  /* THE ROWS SHARE THE BOX (2026-10-13): the box's height less the head and the spot row, over the rows, floored at
     ROW_MIN and capped at ROW_H — an 870px box holds forty rows at 20px with nothing hidden under the head */
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [rowH, setRowH] = useState(ROW_H);
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

  const renderRow = (r: Row) => {
    const at = rows.indexOf(r);
    const plus = rowExtra > 0 && Math.floor(((at + 1) * rowExtra) / rows.length) > Math.floor((at * rowExtra) / rows.length) ? 1 : 0;
    const on = keptStrike === r.strike;
    const lit = hoverStrike === r.strike || hovered === r.strike;
    const walked = keyRow != null && Math.abs(keyRow - r.strike) < 1e-9;
    const role = strikeRole(r.strike, { supreme: levels.supreme, callWall: levels.callWall, putWall: levels.putWall, flip: levels.flip, pin: pinStrike, owned: !!marks?.has(r.strike) });
    const tag = tagFor(r.strike);
    const you = marks?.get(r.strike);
    return (
      <tr
        key={r.strike}
        id={rowId(r.strike)}
        aria-label={`${fmtStrike(r.strike)}${tag ? ` · ${tag.word}` : ''}${you ? ' · you own' : ''} · net ${GREEK_LABEL[lead]} ${fmtUsd(r.legs[lead].net)}`}
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
        className={`relative border-b border-borderSubtle/30 transition-colors ${onSelectStrike ? 'cursor-pointer' : ''} ${on ? 'bg-ink/[0.05]' : lit ? 'bg-ink/[0.04]' : ''} ${pinned && !on ? 'opacity-60' : ''}`}
        style={{ height: rowH + plus, ...(on ? { boxShadow: `inset 2px 0 0 0 ${SILVER}` } : walked ? { boxShadow: 'inset 0 0 0 2px rgb(var(--silver) / var(--ring-a))' } : {}) }}
        data-matrix-row={r.strike}
        data-kept={on || undefined}
        data-walked={walked || undefined}
        title={you}
      >
        {/* THE STRIKE AT THE FAR LEFT, ITS TAGS AFTER IT, THE COLUMN NO WIDER THAN ITS WIDEST ROW (Noah, 2026-10-12:
            "the strikes should be furthest left" and no empty band — the table sizes the column to its content, the
            cells take the rest) */}
        {/* the strike in the first ink (the owner, 2026-10-14: "strike numbers — what the row IS — are dim grey") */}
        {/* the extra foot room lifts the strike onto its figures' line — the cells stack a 3px beam under the figure, so a
            centred strike sat ~4px below the numbers it names (the UI sweep, 2026-10-22) */}
        <td className={`pl-2 pr-1.5 ${rowH < 20 ? 'pt-0 pb-1' : 'pt-0.5 pb-2'} leading-tight bg-inset text-right font-mono text-[11px] font-semibold tnum text-textPrimary whitespace-nowrap`}>
          {/* THE LEVEL IN THE STRIKE'S INK (strikeRole.ts, 2026-10-13): the words after it made the column as wide as its
              widest label, and every plain strike carried the gap */}
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
          LEGS.map((leg, li) => (
            <Cell key={`${g}-${leg}`} value={r.legs[g][leg]} leg={leg} cap={caps[g][leg]} mode={mode} paper={paper} gi={gi} first={li === 0} last={li === LEGS.length - 1} rowH={rowH + plus} heavy={heavyBy[`${g}|${leg}`]?.has(r.strike) ?? true} />
          ))
        )}
      </tr>
    );
  };

  return (
    <div
      ref={scrollRef}
      className="overflow-auto h-full min-h-0"
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
              {/* THE COLUMN'S WIDTH IS RESERVED (2026-10-12, the replay): the widest row this table can print, set
                  invisibly, so a wall's words moving from row to row never move the column or the cells beside it */}
              <span ref={setReserve} aria-hidden className="invisible block h-0 w-max overflow-hidden whitespace-nowrap normal-case tracking-normal text-[11px] font-semibold tnum">
                {cents ? `${Math.floor(Math.max(...rows.map(r => r.strike), 0))}.00` : rows.map(r => fmtStrike(r.strike)).reduce((a, b) => (b.length > a.length ? b : a), '')}
              </span>
              <span ref={setStrikeWord}>Strike</span>
            </th>
            {shownGreeks.map((g, gi) => (
              <th
                key={g}
                colSpan={LEGS.length}
                /* the head's cells carry the panel's ground themselves (2026-10-14): a sticky head is only as opaque as its
                   cells, and the rows scrolling under a two-row head ghosted through the legs' row */
                className={`${head} px-2 pt-2 pb-1 text-center border-b border-l bg-panel ${paper ? 'border-borderSubtle' : 'border-borderMuted'} ${g === lead && shownGreeks.length > 1 ? 'text-silver' : 'text-textPrimary'}`}
                data-matrix-group={g}
                data-lead={g === lead || undefined}
                /* the silver head is the greek the pointer card reads — said, not left to be guessed (the audit's L8) */
                title={g === lead && shownGreeks.length > 1 ? `The greek the card reads · ${GREEK_UNIT[g]}` : headTier !== 'full' ? GREEK_UNIT[g] : undefined}
              >
                {/* ONE LEG, ONE HEAD (the audit's M4, 2026-10-13): with the net alone on the table the leg's name rides the
                    greek's head — "GEX · net · 1% move" — and the row that said "NET" five times is gone; it comes back
                    with the legs if they ever return */}
                {/* a narrow column wears the greek alone (the paying-user audit, a phone: "VANNA · net · 1 vol pt" on three
                    lines over a 70px column); its unit is in the title */}
                <span className="inline-block max-w-full whitespace-nowrap truncate align-bottom" data-matrix-head-tier={headTier}>
                  {GREEK_LABEL[g]}
                  {headTier !== 'greek' && (
                    <span className="text-textSecondary font-medium normal-case tracking-normal">
                      {LEGS.length === 1 ? ` · ${LEGS[0]}` : ''}
                      {headTier === 'full' ? ` · ${GREEK_UNIT[g]}` : ''}
                    </span>
                  )}
                </span>
                {/* THE LEGS' WORDS ON THE SAME HEAD ROW (2026-10-14): a second <tr> in a sticky head is not painted opaque by
                    Chromium in a collapsed-border table, whatever its cells say — the rows scrolling under it ghosted
                    through "put · call · net"; one row, the words in a grid over their columns, paints whole */}
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
            {/* the rule under the net columns alone, the strike column's cell empty — the pill at the middle of the
                nodes (Noah, 2026-10-12) */}
            {/* …and across the whole pane when the legs are narrow: the price pill is wider than one stacked leg, and it ran
                past the pane's edge (four names at 768, 2026-10-13) */}
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
  );
};

export default ExposureMatrix;
