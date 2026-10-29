import { useLedgerPalette } from '../../data/ledgerPalette';
import { bellDay } from '../../data/bookWindow';
import { pressureInks } from './paletteInk';
/*
==================================================
  SLAYER TERMINAL - HOW TO READ THE TRADER'S CLOCK
  (components/gex/ClockGuide.tsx)

  The card behind the clock's "How to read" door
  (Noah, 2026-09-06: "the traders clock and levels
  held need one too"). Two figures in the clock's
  own hand — the 78 blocks, the phase names, the
  silver NOW, a phase in focus with its card — and
  today's clock in plain words.
==================================================
*/

const INK = 'rgb(var(--text-primary))';
const INK_2 = 'rgb(var(--text-secondary))';
const INK_3 = 'rgb(var(--text-muted))';
const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const LIVE = 'rgb(var(--select))';
/* the pressure pair as tokens (2026-09-16: an SVG attribute reads a var(), measured) — since 2026-10-17 the Map's
   palette's own pair (paletteInk.ts pressureInks), read in the figure that draws them */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '"Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/* The schedule as the clock draws it: 78 five-minute blocks, 09:30 to 16:00 */
const BLOCKS = 78;
const PHASES = [
  { key: 'open', name: 'The open', from: 0, to: 6, weight: 0.75, push: 'along' },
  { key: 'morning', name: 'The morning', from: 6, to: 24, weight: 0.5, push: null },
  { key: 'lunch', name: 'Lunch', from: 24, to: 54, weight: 0.3, push: 'back' },
  { key: 'charm', name: 'Charm window', from: 54, to: 72, weight: 0.7, push: 'along' },
  { key: 'turn', name: 'The turn', from: 72, to: 76, weight: 0.9, push: 'back' },
  { key: 'close', name: 'The close', from: 76, to: 78, weight: 1, push: 'along' },
] as const;
const X0 = 14;
/* THE DRAWINGS AT THEIR OWN SIZE (the re-audit's M1, 2026-10-13): 400 wide, 11px throughout, the phase names on two
   rows as the clock's own are on a phone; a phone scrolls the drawing sideways rather than shrinking it */
const FIG_W = 400;
const SPAN = 372;
const BW = SPAN / BLOCKS;
const bx = (i: number) => X0 + i * BW;
const phaseOf = (i: number) => PHASES.find(p => i >= p.from && i < p.to) ?? PHASES[PHASES.length - 1];
const HOURS = [
  { i: 18, t: '11:00' },
  { i: 30, t: '12:00' },
  { i: 42, t: '13:00' },
  { i: 54, t: '14:00' },
  { i: 66, t: '15:00' },
];

const Label = ({ x, y, children, anchor = 'start', fill = INK_2, size = 11, mono = false, weight = 400 }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end'; fill?: string; size?: number; mono?: boolean; weight?: number }) => (
  <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontFamily={mono ? MONO : SANS} fontSize={size} fontWeight={weight} fill={fill}>
    {children}
  </text>
);

/** The phase names over the strip, on two rows so none run into each other at 11px: the open, lunch and the turn on
    the first, the morning, the charm window and the close on the second */
const Names = ({ y, dim }: { y: number; dim?: string }) => (
  <>
    {PHASES.map((p, i) => {
      const turn = p.key === 'turn';
      const close = p.key === 'close';
      const x = turn ? bx(p.to) - 2 : close ? FIG_W : bx(p.from);
      const word = close ? 'Close' : turn ? 'Turn' : p.key === 'open' ? 'Open' : p.key === 'morning' ? 'Morning' : p.name;
      return (
        <Label key={p.key} x={x} y={i % 2 === 1 ? y + 13 : y} anchor={turn || close ? 'end' : 'start'} fill={dim && dim !== p.key ? INK_3 : INK_2}>
          {word}
        </Label>
      );
    })}
  </>
);

/** FIGURE 1 — the strip: 78 blocks, brighter where hedging pushes harder, NOW in the silver */
const StripFigure = ({ nowBlock }: { nowBlock: number | null }) => (
  <svg viewBox={`0 0 ${FIG_W} 156`} width={FIG_W} height={156} role="img" aria-label="The trading day as 78 five-minute blocks with the phase names above; the current block is silver" data-guide-figure="strip">
    <Names y={14} />
    {Array.from({ length: BLOCKS }, (_, i) => {
      const p = phaseOf(i);
      const now = nowBlock === i;
      const a = Math.min(0.8, 0.1 + p.weight * 0.3);
      return (
        <g key={i}>
          <rect x={bx(i) + 0.5} y={36} width={BW - 1} height={16} rx={1.5} fill={now ? LIVE : SILVER} fillOpacity={now ? 1 : a} />
          {now && <rect x={bx(i) - 0.5} y={35} width={BW + 1} height={18} rx={2} fill="none" stroke={LIVE} strokeWidth="1" />}
        </g>
      );
    })}
    {HOURS.map(h => (
      <Label key={h.t} x={bx(h.i)} y={64} anchor="middle" fill={INK_3} mono>
        {h.t}
      </Label>
    ))}
    <Label x={bx(0)} y={64} fill={INK_3} mono>
      09:30
    </Label>
    <Label x={bx(BLOCKS)} y={64} anchor="end" fill={INK_3} mono>
      16:00
    </Label>
    {/* What the shades mean */}
    <rect x={X0} y={79} width={10} height={10} rx={1.5} fill={SILVER} fillOpacity={0.4} />
    <Label x={X0 + 16} y={84}>a brighter block: dealer hedging pushes harder there</Label>
    <rect x={X0} y={97} width={10} height={10} rx={1.5} fill={SILVER} fillOpacity={0.19} />
    <Label x={X0 + 16} y={102}>a dim block: a quiet stretch, price tends to sit still</Label>
    <rect x={X0} y={115} width={10} height={10} rx={1.5} fill={LIVE} />
    <Label x={X0 + 16} y={120}>the silver block is right now</Label>
    <Label x={X0} y={142} fill={INK_3}>five minutes a block, fifteen on a phone · the names are the phases</Label>
  </svg>
);

/** FIGURE 2 — a phase in focus, the rest blurred, its card above the block under the pointer */
const FocusFigure = () => {
  const { amplifies: EMBER, absorbs: GLACIER } = pressureInks(useLedgerPalette());
  const hov = 61; // 14:35
  const cardX = bx(hov) - 130;
  const cardW = 220;
  return (
    <svg viewBox={`0 0 ${FIG_W} 170`} width={FIG_W} height={170} role="img" aria-label="The charm window kept in focus, the other phases dimmed, and the card that opens over a block" data-guide-figure="focus">
      <Names y={70} dim="charm" />
      {Array.from({ length: BLOCKS }, (_, i) => {
        const p = phaseOf(i);
        const inFocus = p.key === 'charm';
        const a = inFocus ? (i === hov ? 0.9 : 0.5) : 0.07;
        return <rect key={i} x={bx(i) + 0.5} y={92} width={BW - 1} height={16} rx={1.5} fill={SILVER} fillOpacity={a} />;
      })}
      {/* The card above the hovered block, clear of the names */}
      <path d={`M${bx(hov) + BW / 2} 92 v-34`} stroke={SILVER} strokeOpacity="0.6" />
      {/* the card's own tokens — on paper it was a black card with the page's ink on it, unread (the audit's M14) */}
      <rect x={cardX} y={14} width={cardW} height={44} rx={6} fill="rgb(var(--card))" stroke="rgb(var(--border-muted))" />
      <Label x={cardX + 10} y={28} fill={INK} mono weight={700}>
        14:35
      </Label>
      <Label x={cardX + 52} y={28} fill={INK_2}>
        Charm window · 14:00 to 15:30
      </Label>
      <circle cx={cardX + 15} cy={46} r={3.5} fill={EMBER} />
      <Label x={cardX + 23} y={46} fill={INK_2}>
        hedges unwind · pushes moves along
      </Label>
      <Label x={X0} y={126} fill={SILVER}>a phase name keeps the phase · a block keeps the minute</Label>
      <circle cx={X0 + 4} cy={142} r={3.5} fill={EMBER} />
      <Label x={X0 + 13} y={142}>pushes moves along: the open, the charm window, the close</Label>
      <circle cx={X0 + 4} cy={158} r={3.5} fill={GLACIER} />
      <Label x={X0 + 13} y={158}>pushes back: lunch and the turn · the morning depends on the flip</Label>
    </svg>
  );
};

interface ClockGuideProps {
  /** The block that is now, 0..77, or null outside the session */
  nowBlock: number | null;
  /** The clock's own current read — the sentence under the strip */
  line: string;
  bellShare: number | null;
  pin: number | null;
  supreme: number | null;
  charmStrike: number | null;
}

const ClockGuide = ({ nowBlock, line, bellShare, pin, supreme, charmStrike }: ClockGuideProps) => (
  <div className="px-3 py-3 flex flex-col gap-3" data-clock-guide-card>
    <div>
      <p className="text-t12 font-semibold text-textPrimary">The strip · the trading day, five minutes at a time</p>
      <p className="mt-0.5 text-t115 leading-relaxed text-textSecondary">
        The strip runs from 09:30 to 16:00 New York time, one block per five minutes. Brighter blocks are the parts of the day when dealer hedging pushes hardest on price: the open, the last ninety minutes, the close. Dim blocks are the quiet middle, when price tends to sit still. The silver block is right now. The names above are the day's phases, a rule of thumb; the numbers in them are today's.
      </p>
      <div className="mt-2 rounded-md border border-borderSubtle/60 bg-panel px-2 py-2 overflow-x-auto scroll-row">
        <StripFigure nowBlock={nowBlock} />
      </div>
    </div>
    <div>
      <p className="text-t12 font-semibold text-textPrimary">Using it · hover, keep, and read the card</p>
      <p className="mt-0.5 text-t115 leading-relaxed text-textSecondary">
        Hover any block and a card tells you the minute, its phase, and what dealers tend to do then. Click the block to keep it. Click a phase name above the strip to keep the whole phase in focus and dim the rest. Click anywhere else to go back to now. The line under the strip always says what the kept minute, the kept phase, or right now means for today.
      </p>
      <div className="mt-2 rounded-md border border-borderSubtle/60 bg-panel px-2 py-2 overflow-x-auto scroll-row">
        <FocusFigure />
      </div>
    </div>
    <div className="border-t border-borderSubtle/60 pt-2.5">
      <p className="text-t11 text-textMuted">Today's clock, in words</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        <li className="text-t115 leading-relaxed text-textSecondary">{line}</li>
        {bellShare != null && (
          <li className="text-t115 leading-relaxed text-textSecondary">
            <span className="font-mono tnum text-textPrimary">{bellShare}%</span> of all the name's hedging, every expiry counted, sits in contracts that expire at {bellDay().head === 'Expires today' ? "today's close" : `the close on ${bellDay().head.replace('Expires ', '')}, the next session`} — the same figure as the Board's "{bellDay().head}".
          </li>
        )}
        {(pin != null || supreme != null) && (
          <li className="text-t115 leading-relaxed text-textSecondary">
            {pin != null && (
              <>
                Through lunch price tends to stick to <span className="font-mono tnum text-textPrimary">{fmtStrike(pin)}</span>.{' '}
              </>
            )}
            {supreme != null && (
              <>
                The supreme, the strike with the most hedging, is <span className="font-mono tnum text-textPrimary">{fmtStrike(supreme)}</span>.
              </>
            )}
            {charmStrike != null && (
              <>
                {' '}
                In the charm window the unwind is strongest at <span className="font-mono tnum text-textPrimary">{fmtStrike(charmStrike)}</span>.
              </>
            )}
          </li>
        )}
      </ul>
    </div>
    <p className="text-t11 text-textMuted">The clock is New York time, the real one, not the replayed day.</p>
  </div>
);

export default ClockGuide;
