/*
==================================================
  SLAYER TERMINAL - HOW TO READ THE CALENDAR
  (components/gex/LedgerGuide.tsx)

  The card behind the Exposure Ledger's "How to
  read" door (Noah, 2026-09-06: "i love this, keep
  it in the design pattern style. i think the
  heatmap needs one as well"). Two figures drawn
  in the ledger's own hand — capsules in a grid,
  strikes down, expiry dates across, the supreme
  starred — and today's calendar read in plain
  words from the live numbers.
==================================================
*/

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { attachScrollMore } from '../ui/scrollMore';
import { fmtUsd } from '../../data/gex';
import type { ExposureSurface, Greek } from '../../data/exposureSurface';
import { heatCellStyle, type HeatMode } from './heatmap';

const INK = 'rgb(var(--text-primary))';
const INK_2 = 'rgb(var(--text-secondary))';
const INK_3 = 'rgb(var(--text-muted))';
const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const SUPREME = 'rgb(var(--supreme))';
const PUT_WALL = 'rgb(var(--bear))';
const CALL_WALL = 'rgb(var(--bull))';
const GRID = 'rgb(var(--ink) / 0.07)'; /* the ink token: on paper the white hairline was none */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '"Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/* THE DRAWINGS IN THE PALETTE ON THE SCREEN (the paying-user audit's H3, 2026-10-13): the figures were painted in the
   thermal ramp's blue and red while the calendar beside them wore the house's ember and glacier — the picture that
   teaches the colours taught the wrong ones. A cell is a signed figure in $M now, painted by the calendar's own
   ramp (the side that pushes a move along is the positive one, the house's sign), its figure printed the calendar's
   way. */
const Paint = createContext<{ mode?: HeatMode; paper: boolean }>({ paper: false });
const FIG_MAX = 256;

const Cell = ({ x, y, w, v, ring }: { x: number; y: number; w: number; v: number; ring?: string }) => {
  const { mode, paper } = useContext(Paint);
  const st = heatCellStyle(v, FIG_MAX, mode, paper);
  return (
    <g>
      <rect x={x} y={y - 7} width={w} height={14} rx={7} fill={String(st.backgroundColor)} />
      {ring && <rect x={x - 1.5} y={y - 8.5} width={w + 3} height={17} rx={8.5} fill="none" stroke={ring} strokeWidth="1.25" />}
      <text x={x + w - 6} y={y + 0.5} textAnchor="end" dominantBaseline="middle" fontFamily={MONO} fontSize="11" fontWeight="600" fill={String(st.color)}>
        {fmtUsd(v * 1e6)}
      </text>
    </g>
  );
};

/* THE DRAWINGS AT THEIR OWN SIZE (the re-audit's M1, 2026-10-13): drawn 368 wide and stretched to the card, their
   8–9.5px type never reached the page's 11px floor and the dates in them were a September that never moved. They are
   400 wide now, 11px throughout, dated from today, and a phone scrolls them sideways rather than shrinking them. */
const FIG_W = 400;

/** A drawing's box: the card's own ground, scrolling sideways where the card is narrower than the drawing — and SAYING SO
    at the edge (ui/scrollMore.ts; 2026-10-14: on a phone the drawing simply stopped mid-word) */
const FigureBox = ({ children }: { children: ReactNode }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => (ref.current ? attachScrollMore(ref.current) : undefined), []);
  return (
    <div ref={ref} className="mt-2 rounded-md border border-borderSubtle/60 bg-panel px-2 py-2 overflow-x-auto scroll-row" data-guide-figure-box>
      {children}
    </div>
  );
};
const Label = ({ x, y, children, anchor = 'start', fill = INK_2, size = 11, mono = false }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end'; fill?: string; size?: number; mono?: boolean }) => (
  <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontFamily={mono ? MONO : SANS} fontSize={size} fill={fill}>
    {children}
  </text>
);

const COLS = [
  { x: 52, head: 'today' },
  { x: 138, head: '+1 day' },
  { x: 224, head: '+3 days' },
  { x: 310, head: '+10 days' },
];
const CELL_W = 80;

/** FIGURE 1 — the grid: a strike per row, an expiry per column, the supreme starred */
const GridFigure = () => {
  /* 495 is the supreme (magenta wins over its call wall's green, the strike column's rule); 493 the put wall */
  const rows = [
    { y: 46, k: '496', ink: INK_2, cells: [-94, -81, -40, -22] },
    { y: 74, k: '495', ink: SUPREME, cells: [-256, -231, -188, -150], ring: 0 },
    { y: 102, k: '494', ink: INK_2, cells: [61, 38, 19, 9] },
    { y: 134, k: '493', ink: PUT_WALL, cells: [131, 104, 96, 70] },
  ] as { y: number; k: string; ink: string; cells: number[]; ring?: number }[];
  return (
    <svg viewBox={`0 0 ${FIG_W} 196`} width={FIG_W} height={196} role="img" aria-label="A grid of capsules: one strike per row, one expiry per column, the heaviest cell ringed in magenta with a star" data-guide-figure="grid">
      {/* Column heads — the dates, today first */}
      {COLS.map((c, i) => (
        <Label key={c.head} x={c.x + CELL_W / 2} y={18} anchor="middle" fill={i === 0 ? INK : INK_3} mono>
          {c.head}
        </Label>
      ))}
      <line x1={52} x2={FIG_W - 10} y1={29.5} y2={29.5} stroke={GRID} />
      {rows.map(r => (
        <g key={r.k}>
          <Label x={44} y={r.y} anchor="end" fill={r.ink} mono>
            {r.k}
          </Label>
          {r.cells.map((v, i) => (
            <Cell key={i} x={COLS[i].x} y={r.y} w={CELL_W} v={v} ring={r.ring === i ? SUPREME : undefined} />
          ))}
        </g>
      ))}
      {/* The heaviest cell's star, left of its strike; the supreme is the strike printed in magenta */}
      <text x={12} y={74.5} textAnchor="middle" dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={INK}>
        ★
      </text>
      {/* Spot, between the rows it sits between — the chip at the line's end */}
      <line x1={52} x2={338} y1={118} y2={118} stroke={INK} strokeOpacity="0.35" strokeDasharray="2 3" />
      <rect x={342} y={112} width={48} height={12} rx={3} fill={INK} />
      {/* the chip is the page's ink, so its figure is the page's ground: on paper the dark figure sat on a dark chip, unread */}
      <text x={366} y={118.5} textAnchor="middle" dominantBaseline="middle" fontFamily={MONO} fontSize="11" className="fill-[#0a0a0a] [[data-theme='light']_&]:fill-canvas">
        493.60
      </text>
      <Label x={52} y={152} fill={INK_3}>
        a strike per row, a date per column · the figure is hedging
      </Label>
      <text x={52} y={168} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={INK_2}>
        ★ heaviest cell
      </text>
      <text x={150} y={168} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={SUPREME}>
        magenta: the supreme
      </text>
      <text x={292} y={168} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={PUT_WALL}>
        red: the put wall
      </text>
      <Label x={52} y={184} fill={INK_3}>
        dotted line: the market
      </Label>
    </svg>
  );
};

/** FIGURE 2 — read across, read down: what stays, what expires at the bell */
const ReadFigure = () => (
  <svg viewBox={`0 0 ${FIG_W} 164`} width={FIG_W} height={164} role="img" aria-label="The same grid: one row stays heavy across every column, another is heavy only today; the today column expires at the bell" data-guide-figure="read">
    {COLS.map((c, i) => (
      <Label key={c.head} x={c.x + CELL_W / 2} y={18} anchor="middle" fill={i === 0 ? INK : INK_3} mono>
        {c.head}
      </Label>
    ))}
    <line x1={52} x2={FIG_W - 10} y1={29.5} y2={29.5} stroke={GRID} />
    {/* A wall that stays: heavy across the row */}
    <Label x={44} y={50} anchor="end" fill={CALL_WALL} mono>
      497
    </Label>
    {COLS.map((c, i) => (
      <Cell key={`a${i}`} x={c.x} y={50} w={CELL_W} v={[-256, -231, -188, -150][i]} />
    ))}
    <path d={`M${COLS[3].x + CELL_W + 3} 43 h5 v14 h-5`} fill="none" stroke={SILVER} />
    {/* A one-day wall: heavy today, gone after */}
    <Label x={44} y={80} anchor="end" fill={INK_2} mono>
      492
    </Label>
    {COLS.map((c, i) => (
      <Cell key={`b${i}`} x={c.x} y={80} w={CELL_W} v={[148, 6, 3, 1][i]} />
    ))}
    <Label x={52} y={108} fill={SILVER}>
      read across → heavy in every column, the level stays for weeks
    </Label>
    <Label x={52} y={124} fill={SILVER}>
      heavy today only → a one-day wall, gone after the bell
    </Label>
    {/* The today column, bracketed */}
    <path d={`M${COLS[0].x} 136 v4 h${CELL_W} v-4`} fill="none" stroke={INK_2} />
    <Label x={52} y={152} fill={INK_2}>
      read down today's column → what expires at the close
    </Label>
  </svg>
);

/** FIGURE — the matrix: a strike per row, its figure beside a bar as long as the hedging there */
const MatrixFigure = () => {
  const { mode, paper } = useContext(Paint);
  const rows = [
    { y: 46, k: '496', ink: INK_2, v: -94 },
    { y: 70, k: '495', ink: SUPREME, v: -256 },
    { y: 94, k: '494', ink: INK_2, v: 61 },
    { y: 130, k: '493', ink: PUT_WALL, v: 131 },
  ];
  const LANE = 236;
  return (
    <svg viewBox={`0 0 ${FIG_W} 196`} width={FIG_W} height={196} role="img" aria-label="Rows of strikes, each with its figure and a bar as long as its hedging; spot is a row of its own" data-guide-figure="matrix">
      <Label x={44} y={18} anchor="end" fill={INK_3} mono>
        Strike
      </Label>
      <Label x={110} y={18} fill={INK_3} mono>
        GEX
      </Label>
      <line x1={8} x2={FIG_W - 10} y1={29.5} y2={29.5} stroke={GRID} />
      {rows.map(r => {
        const st = heatCellStyle(r.v, FIG_MAX, mode, paper);
        return (
          <g key={r.k}>
            <Label x={44} y={r.y} anchor="end" fill={r.ink} mono>
              {r.k}
            </Label>
            <text x={102} y={r.y + 0.5} textAnchor="end" dominantBaseline="middle" fontFamily={MONO} fontSize="11" fill={INK}>
              {fmtUsd(r.v * 1e6)}
            </text>
            <rect x={110} y={r.y - 5} width={Math.max(4, (Math.abs(r.v) / FIG_MAX) * LANE)} height={10} rx={5} fill={String(st.backgroundColor)} />
          </g>
        );
      })}
      {/* spot, a row of its own between the strikes it sits between */}
      <line x1={8} x2={FIG_W - 60} y1={112} y2={112} stroke={INK} strokeOpacity="0.35" strokeDasharray="2 3" />
      <rect x={FIG_W - 56} y={106} width={48} height={12} rx={3} fill={INK} />
      <text x={FIG_W - 32} y={112.5} textAnchor="middle" dominantBaseline="middle" fontFamily={MONO} fontSize="11" className="fill-[#0a0a0a] [[data-theme='light']_&]:fill-canvas">
        493.60
      </text>
      <Label x={8} y={156} fill={INK_3}>
        a strike per row · the bar is the hedging there, its figure beside it
      </Label>
      <text x={8} y={172} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={SUPREME}>
        magenta: the supreme
      </text>
      <text x={130} y={172} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={PUT_WALL}>
        red: the put wall
      </text>
      <text x={238} y={172} dominantBaseline="middle" fontFamily={SANS} fontSize="11" fill={CALL_WALL}>
        green: the call wall
      </text>
      <Label x={8} y={188} fill={INK_3}>
        dotted line: the market
      </Label>
    </svg>
  );
};

/** FIGURE — the profile: the book's gamma if price stood at each level, the zero crossing marked */
const ProfileFigure = () => {
  const { mode, paper } = useContext(Paint);
  const amp = String(heatCellStyle(200, FIG_MAX, mode, paper).backgroundColor);
  const abs = String(heatCellStyle(-200, FIG_MAX, mode, paper).backgroundColor);
  /* a curve from below zero (left) to above it (right), crossing at x=196 */
  const pts = [
    [20, 128],
    [70, 132],
    [120, 120],
    [160, 104],
    [196, 86],
    [240, 64],
    [290, 44],
    [340, 38],
    [384, 42],
  ];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${FIG_W} 196`} width={FIG_W} height={196} role="img" aria-label="A curve of the book's gamma across prices, crossing zero at the zero-gamma line; above zero hedging amplifies a move, below it absorbs one" data-guide-figure="profile">
      <rect x={20} y={20} width={364} height={66} fill={amp} fillOpacity={0.12} />
      <rect x={20} y={86} width={364} height={66} fill={abs} fillOpacity={0.12} />
      <line x1={20} x2={384} y1={86} y2={86} stroke={INK_3} strokeOpacity="0.6" />
      <path d={d} fill="none" stroke={INK} strokeWidth="1.75" />
      <line x1={196} x2={196} y1={20} y2={152} stroke={INK_2} strokeDasharray="3 3" />
      <Label x={200} y={30} fill={INK_2} mono>
        ZERO GAMMA
      </Label>
      <line x1={250} x2={250} y1={20} y2={152} stroke={INK} strokeOpacity="0.45" strokeDasharray="2 3" />
      <Label x={254} y={146} fill={INK_2} mono>
        spot
      </Label>
      <line x1={120} x2={120} y1={20} y2={152} stroke={PUT_WALL} strokeOpacity="0.8" />
      <line x1={330} x2={330} y1={20} y2={152} stroke={CALL_WALL} strokeOpacity="0.8" />
      <Label x={24} y={30} fill={INK_3}>
        amplifies
      </Label>
      <Label x={24} y={146} fill={INK_3}>
        absorbs
      </Label>
      <Label x={20} y={172} fill={INK_3}>
        price runs left to right · the line is the book's gamma if price stood there
      </Label>
      <Label x={20} y={188} fill={INK_3}>
        red rule: the put wall · green rule: the call wall
      </Label>
    </svg>
  );
};

interface LedgerGuideProps {
  surface: ExposureSurface;
  greek: Greek;
  /** The view on the screen — each has its own picture and words */
  view?: 'matrix' | 'calendar' | 'profile';
  /** The capsules' ramp, the figures painted in it */
  mode?: HeatMode;
  paper?: boolean;
}

/** What the guide says for the view on the screen — the title its focus card wears */
export const guideTitle = (view: 'matrix' | 'calendar' | 'profile' = 'calendar') => (view === 'matrix' ? 'How to read the matrix' : view === 'profile' ? 'How to read the profile' : 'How to read the calendar');

const LedgerGuide = ({ surface, greek, view = 'calendar', mode, paper = false }: LedgerGuideProps) => (
  <Paint.Provider value={{ mode, paper }}>
    {view === 'matrix' ? <MatrixWords surface={surface} greek={greek} mode={mode} /> : view === 'profile' ? <ProfileWords surface={surface} mode={mode} /> : <CalendarWords surface={surface} greek={greek} mode={mode} />}
  </Paint.Provider>
);

/** The two sides' colours in words, for the ramp on the screen */
const sideWords = (mode?: HeatMode) => (mode === 'thermal-yellow' ? { absorb: 'Blue', amplify: 'red and orange' } : { absorb: 'Glacier blue', amplify: 'ember orange' });

const InWords = ({ surface, greek }: { surface: ExposureSurface; greek: Greek }) => {
  const label = greek.toUpperCase();
  const supreme = surface.supreme[greek];
  const supremeDate = surface.expiries[supreme.e]?.date ?? '';
  return (
    <li className="text-[11.5px] leading-relaxed text-textSecondary">
      The supreme is <span className="font-mono tnum font-semibold" style={{ color: SUPREME }}>{fmtStrike(supreme.strike)}</span>: <span className="font-mono tnum text-textPrimary">{fmtUsd(Math.abs(supreme.total))}</span> of {label} hedging across the whole book, most of it on{' '}
      <span className="text-textPrimary">{supremeDate}</span>. The chart wears it in magenta.
    </li>
  );
};

const MatrixWords = ({ surface, greek, mode }: { surface: ExposureSurface; greek: Greek; mode?: HeatMode }) => {
  const w = sideWords(mode);
  return (
    <div className="px-3 py-3 flex flex-col gap-3" data-ledger-guide-card data-guide-view="matrix">
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">The matrix · one strike per row, a column per greek</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Each row is a strike, every expiry on the band added together. The figure is how much dealer hedging sits there, and the bar beside it is that figure drawn: the longer, the more. {w.absorb} pushes back against a move through the strike, {w.amplify} pushes it along. A strike's ink names its level: magenta the supreme, green the call wall, red the put wall; a dotted underline marks the gamma pin, a silver one a strike you own. Spot is a row of its own, where price stands.
        </p>
        <FigureBox>
          <MatrixFigure />
        </FigureBox>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">Legs · the net, one side, or both</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Legs, up on the band, draws the net alone, the calls or the puts alone, or both side by side: the put's bar grows left from the seam and the call's right. The card under the pointer always carries both legs, the net and the open interest.
        </p>
      </div>
      <div className="border-t border-borderSubtle/60 pt-2.5">
        <p className="text-[11px] text-textMuted">Today's matrix, in words</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          <InWords surface={surface} greek={greek} />
        </ul>
      </div>
      <p className="text-[11px] text-textMuted">Hover a row for its card · click to keep the strike on every box of the page · click it again, or Esc, to let go · ↑ ↓ or J K walk the rows once the matrix is focused.</p>
    </div>
  );
};

const ProfileWords = ({ surface, mode }: { surface: ExposureSurface; mode?: HeatMode }) => {
  void mode;
  return (
    <div className="px-3 py-3 flex flex-col gap-3" data-ledger-guide-card data-guide-view="profile">
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">The profile · the book's gamma at every price</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Price runs left to right. The line is the dealers' total gamma if price stood at that level, every drawn expiry added together; the quiet lines are the expiries one by one. Above the zero line their hedging amplifies a move; below it, it absorbs one. Where the line crosses zero is the zero-gamma level: the price where the book changes character. It is not the same number as the flip strike on the band, which is the strike where the net by strike changes sign.
        </p>
        <FigureBox>
          <ProfileFigure />
        </FigureBox>
      </div>
      <div className="border-t border-borderSubtle/60 pt-2.5">
        <p className="text-[11px] text-textMuted">Today's profile, in words</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          <li className="text-[11.5px] leading-relaxed text-textSecondary">
            The put wall is <span className="font-mono tnum" style={{ color: PUT_WALL }}>{fmtStrike(surface.levels.putWall)}</span> and the call wall <span className="font-mono tnum" style={{ color: CALL_WALL }}>{fmtStrike(surface.levels.callWall)}</span>; price is at{' '}
            <span className="font-mono tnum text-textPrimary">{surface.spot.toFixed(2)}</span>.
          </li>
        </ul>
      </div>
      <p className="text-[11px] text-textMuted">Hover the plot for the figures at a price · click to keep the nearest strike · ← → walk the curve once the plot is focused.</p>
    </div>
  );
};

const CalendarWords = ({ surface, greek, mode }: { surface: ExposureSurface; greek: Greek; mode?: HeatMode }) => {
  const w = sideWords(mode);
  const label = greek.toUpperCase();
  const net = surface.net[greek];
  const king = surface.king[greek];
  const kingDate = surface.expiries[king.e]?.date ?? '';
  const supreme = surface.supreme[greek];
  const supremeDate = surface.expiries[supreme.e]?.date ?? '';
  /* How much of the calendar expires at the bell */
  const todayIdx = surface.expiries.findIndex(e => e.dte === 0);
  let dies = 0;
  let total = 0;
  for (let e = 0; e < surface.expiries.length; e++) for (let s = 0; s < surface.strikes.length; s++) {
    const v = Math.abs(net[e]?.[s] ?? 0);
    total += v;
    if (e === todayIdx) dies += v;
  }
  const share = total > 0 && todayIdx >= 0 ? Math.round((100 * dies) / total) : null;
  /* The call wall's row, read across */
  const wallIdx = surface.strikes.findIndex(k => Math.abs(k - surface.levels.callWall) < 1e-9);
  const last = surface.expiries.length - 1;
  const wallToday = wallIdx >= 0 && todayIdx >= 0 ? Math.abs(net[todayIdx]?.[wallIdx] ?? 0) : 0;
  const wallFar = wallIdx >= 0 ? Math.abs(net[last]?.[wallIdx] ?? 0) : 0;
  const stays = wallToday > 0 && wallFar >= wallToday * 0.5;

  return (
    <div className="px-3 py-3 flex flex-col gap-3" data-ledger-guide-card data-guide-view="calendar">
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">The grid · one strike per row, one date per column</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Each row is a strike, a price level. Each column is an expiry date, today first and later dates to the right. Each cell is a capsule: the figure inside is how much dealer hedging sits at that strike for that date. Brighter means more. {w.absorb} pushes back against a move there, {w.amplify} pushes it along. The strike printed in magenta is the supreme, the heaviest strike of the whole book and the one the chart wears in magenta; the cell with the star is the heaviest single cell. A strike's ink names its level: green the call wall, red the put wall, magenta the supreme; a dotted underline marks the gamma pin, a silver one a strike you own. Hover a strike for the words.
        </p>
        <FigureBox>
          <GridFigure />
        </FigureBox>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">Reading it · across for how long, down for what expires</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Read across a row to see how long a level lasts. Heavy in every column means the level stays for weeks. Heavy today and empty after means it is a one-day wall that is gone at the bell. Read down today's column to see what expires at the close. The "After the close" choice up top shows the same grid with today's column removed, the calendar as it will stand tomorrow morning.
        </p>
        <FigureBox>
          <ReadFigure />
        </FigureBox>
      </div>
      <div className="border-t border-borderSubtle/60 pt-2.5">
        <p className="text-[11px] text-textMuted">Today's calendar, in words</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          <li className="text-[11.5px] leading-relaxed text-textSecondary">
            The supreme is <span className="font-mono tnum font-semibold" style={{ color: SUPREME }}>{fmtStrike(supreme.strike)}</span>: <span className="font-mono tnum text-textPrimary">{fmtUsd(Math.abs(supreme.total))}</span> of {label} hedging across the whole book, most of it on{' '}
            <span className="text-textPrimary">{supremeDate}</span>. The chart wears it in magenta.
          </li>
          <li className="text-[11.5px] leading-relaxed text-textSecondary">
            The heaviest cell is <span className="font-mono tnum text-textPrimary">{fmtStrike(king.strike)}</span> on <span className="text-textPrimary">{kingDate}</span>, with{' '}
            <span className="font-mono tnum text-textPrimary">{fmtUsd(Math.abs(king.value))}</span> of {label} hedging. That is the star.
          </li>
          {share != null && (
            <li className="text-[11.5px] leading-relaxed text-textSecondary">
              <span className="font-mono tnum text-textPrimary">{share}%</span> of the hedging on this calendar expires today at the close. The rest is still there tomorrow.
            </li>
          )}
          {wallIdx >= 0 && wallToday > 0 && (
            <li className="text-[11.5px] leading-relaxed text-textSecondary">
              The call wall at <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.callWall)}</span> holds <span className="font-mono tnum text-textPrimary">{fmtUsd(wallToday)}</span> today and{' '}
              <span className="font-mono tnum text-textPrimary">{fmtUsd(wallFar)}</span> on {surface.expiries[last]?.date}. {stays ? 'It stays on the calendar.' : 'Most of it is gone after today.'}
            </li>
          )}
        </ul>
      </div>
      <p className="text-[11px] text-textMuted">Hover a cell for its card · click to keep it · click it again, Esc, or anywhere off the grid to let go · the arrows or J K walk the cells once the calendar is focused · Biggest moves, up on the band, keeps only the badged cells sharp — the biggest moves since the open.</p>
    </div>
  );
};

export default LedgerGuide;
