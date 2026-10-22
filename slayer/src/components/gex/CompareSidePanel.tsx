/*
==================================================
  SLAYER TERMINAL - A NAME'S READ BESIDE THE RULER
  (components/gex/CompareSidePanel.tsx)

  The partner's cut of Compare (through Noah,
  2026-10-18): "remove the head to head section and
  instead have two collapse tabs on the two books
  one ruler section, one on each side, which
  showcases the info for each ticker." So the Head
  to head box is gone, and each name's read — the
  book card's sections in its order: the book (the
  net, the sentence, the four levels), the six
  heaviest and what each did over a window, the
  strike (its legs, its other greeks), today's
  contracts over each window, to the close — stands
  in a panel on its own side of the ruler, SPY's at
  the left edge, QQQ's at the right. The comparison
  lives where the eye makes it: across the ruler
  between them.

  Each panel folds to a slim tab on the box's edge
  with the name on it; which sides stand open is
  remembered (slayer_compare_sides). On a phone the
  two reads stack under the ruler as plain cards.
  A strike pressed anywhere keeps it on the ruler,
  the page's shared focus.

  THE QUIET SHEET (Noah, 2026-10-18: "these cards
  are way too colorful ... i didnt want an exact
  replica of the previous collapse"): the panel is
  a fact sheet, not the book card again. Every
  figure stands in the primary ink; colour lives in
  two small places only — a level's name tag in its
  family's tint (put wall · call wall · supreme ·
  flip) and a change's glyph (▲ green, ▼ red, the
  percent itself white). The levels and the six
  heaviest are hairline tables, the strike's other
  greeks a two-by-two of dot-leader rows, today's
  windows one row of seven figures under their
  labels, and the net's one accented word
  (amplifies · absorbs) a silver tag.
==================================================
*/

import { holdLabel } from '../../data/wall';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildExposureProfile } from '../../data/exposure';
import { GREEKS, GREEK_UNIT } from '../../data/exposureSurface';
import { distanceIn, fmtShared, sharedUnit, GREEK_LABEL, WINDOW, type Compare, type CompareSide, type Greek } from '../../data/compare';
import type { DistanceUnit } from '../../data/atr';
import { fmtUsd } from '../../data/gex';
import { replayRange, snapshotAt } from '../../data/replay';
import type { ExposureProfileData, StrikeExposure } from '../../types/gex';
import { Change, READ_WINDOWS } from './ChangeMark';
import { toneBadge, type Tone } from '../ui/tones';
import Fact from '../ui/Fact';

/** The panel's width open, and its tab's width folded */
export const SIDE_W = 320;
export const SIDE_TAB_W = 28;

const SILVER = 'rgb(var(--silver))';
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const pct = (v: number) => `${Math.round(v * 100)}%`;

type Side = 'a' | 'b';

interface Props {
  side: Side;
  s: CompareSide;
  cmp: Compare;
  unit: DistanceUnit;
  greek: Greek;
  /** Every greek on the ruler. Each one has its own supreme; one row per greek when there is more than one. */
  greeks?: Greek[];
  /** The name's chip — the first follows the frame, the second holds its own */
  chip: ReactNode;
  /** The shared focus when it is this name's */
  focus: number | null;
  onPick: (strike: number, ticker: string) => void;
  open: boolean;
  onToggle: () => void;
  /** On a phone: a card under the ruler, no tab */
  stacked?: boolean;
  /** The ruler on the whole screen: the panel wears the page's ground with it */
  full?: boolean;
}

const Cap = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-end justify-between gap-2 pt-3 pb-1 border-b border-borderSubtle/60">
    <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.14em] text-textMuted whitespace-nowrap truncate">{children}</span>
    {aside}
  </div>
);

/** A name's tag — a level's family at chip scale (the house's tone badge), the net's word in silver */
const Tag = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`inline-flex w-fit shrink-0 items-center rounded px-1 h-[14px] border font-mono text-[8px] font-semibold uppercase tracking-widest whitespace-nowrap ${toneBadge[tone]}`}>
    {children}
  </span>
);

/** The levels' table: tag · strike · distance · dollars, a hairline under each row */
const LEVEL_COLS = 'grid grid-cols-[72px_minmax(0,1fr)_52px_68px] items-center gap-x-1.5 h-6 border-b border-borderSubtle/40 last:border-b-0';
/** The heaviest's table: rank · strike (+ its role) · dollars · what it did over the window */
const HEAVY_COLS = 'grid grid-cols-[14px_minmax(0,1fr)_68px_60px] items-center gap-x-1.5 h-6 border-b border-borderSubtle/40 last:border-b-0';

const CompareSidePanel = ({ side, s, cmp, unit, greek, greeks, chip, focus, onPick, open, onToggle, stacked = false, full = false }: Props) => {
  const U = sharedUnit(unit);
  const L = GREEK_LABEL[greek];
  const [win, setWin] = useState('15m');
  const winIdx = Math.max(0, READ_WINDOWS.findIndex(w => w.key === win));

  /* TODAY'S CONTRACTS OVER EACH WINDOW — the minute grid, seven books back (the read card's own) */
  const hist = useMemo<(ExposureProfileData | null)[] | null>(() => {
    const range = replayRange(s.ticker);
    if (!range) return null;
    return READ_WINDOWS.map(w => {
      const back = w.min === Infinity ? range.length : w.min * 60;
      if (back > range.length && w.min !== Infinity) return null;
      return buildExposureProfile(snapshotAt(s.snapshot, range, Math.max(0, range.length - back)), '0DTE', WINDOW);
    });
  }, [s]);
  const thenAt = (i: number, strike: number): number | null => hist?.[i]?.strikes.find(r => r.strike === strike)?.[greek].net ?? null;

  const dist = (price: number) => {
    const d = distanceIn(price - s.spot, s.spot, U, s.scales);
    return d == null ? '—' : fmtShared(d, U);
  };
  const net = s.rows[greek].reduce((acc, r) => acc + r.value, 0);
  const flipAt = s.flip;
  const regimeWord =
    flipAt == null || !(flipAt > 0) ? (net >= 0 ? 'amplifies' : 'absorbs') : Math.abs(s.spot - flipAt) / flipAt <= 0.0005 ? 'either way' : s.spot > flipAt ? 'absorbs' : 'amplifies';
  const rowOf = (strike: number): StrikeExposure | undefined => s.strikes.find(r => r.strike === strike);
  const valueAt = (strike: number | null, g: Greek = greek): number | null => (strike == null ? null : rowOf(strike)?.[g].net ?? null);
  const roleOf = (strike: number): { word: string; tone: Tone } | null =>
    strike === s.levels.supreme ? { word: 'supreme', tone: 'supreme' }
    : strike === s.levels.callWall ? { word: 'call wall', tone: 'bull' }
    : strike === s.levels.putWall ? { word: 'put wall', tone: 'bear' }
    : strike === s.levels.flip ? { word: 'flip', tone: 'white' }
    : s.strikes.find(r => r.pin)?.strike === strike ? { word: 'pin', tone: 'neutral' }
    : null;
  const heaviest = useMemo(() => [...s.strikes].sort((x, y) => Math.abs(y[greek].net) - Math.abs(x[greek].net)).slice(0, 6), [s, greek]);
  const strike = focus ?? s.supreme[greek].strike;
  const kept = focus != null;
  const front = rowOf(strike);
  const watchKind = s.watch ? (s.watch.role ?? (s.watch.isShelf ? 'shelf' : s.watch.isWall ? 'thin' : 'trapdoor')) : '';
  const others = GREEKS.filter(g => g !== greek);

  /* EVERY FIGURE IN THE PRIMARY INK — a missing one muted; no ramp, no family colour on a number */
  const Money = ({ v, bold = false, size = 11 }: { v: number | null; bold?: boolean; size?: number }) => (
    <span className={`font-mono tnum tabular-nums ${bold ? 'font-bold' : ''} ${v == null ? 'text-textMuted' : 'text-textPrimary'}`} style={{ fontSize: size }}>
      {v == null ? '—' : fmtUsd(v)}
    </span>
  );
  const Door = ({ k }: { k: number }) => (
    <button
      type="button"
      onClick={() => onPick(k, s.ticker)}
      title={focus === k ? 'Let go of this strike' : 'Keep this strike on the ruler'}
      className="font-mono text-[12px] font-semibold tnum tabular-nums leading-none hover:underline underline-offset-2 decoration-ink/30 text-textPrimary"
      style={focus === k ? { color: SILVER } : undefined}
      data-side-strike={k}
      data-kept={focus === k || undefined}
    >
      {fmtStrike(k)}
    </button>
  );
  const Level = ({ word, tone, k, g = greek }: { word: string; tone: Tone; k: number | null; g?: Greek }) => (
    <div className={LEVEL_COLS} data-side-level={word}>
      <Tag tone={tone}>{word}</Tag>
      {k == null ? (
        <span className="col-span-3 font-mono text-[11px] text-textMuted">none</span>
      ) : (
        <>
          <Door k={k} />
          <span className="font-mono text-[10px] tnum tabular-nums text-textMuted text-right">{dist(k)}</span>
          <span className="text-right"><Money v={valueAt(k, g)} /></span>
        </>
      )}
    </div>
  );

  const windowRail = (
    <span className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Window" data-side-window={win}>
      {READ_WINDOWS.map((w, i) => {
        const on = w.key === win;
        const off = hist ? hist[i] == null : true;
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => setWin(w.key)}
            aria-pressed={on}
            disabled={off}
            title={off ? 'Before the open' : `What today's contracts did over the last ${w.key === 'open' ? 'session' : w.key}`}
            className={`px-1 h-4 rounded font-mono text-[9px] tnum tabular-nums transition-colors ${on ? 'bg-ink/[0.1] text-textPrimary' : off ? 'text-textMuted/40 cursor-default' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
            data-side-win={w.key}
          >
            {w.key}
          </button>
        );
      })}
    </span>
  );

  const body = (
    <div className="flex flex-col gap-0.5 px-3 pb-3" data-side-body>
      {/* THE BOOK — the net on one line, its word the sheet's one accent */}
      <Cap>
        The book · {L} · per {GREEK_UNIT[greek]}
      </Cap>
      <div className="pt-2 flex items-center gap-2 min-w-0">
        <span className="font-mono text-[17px] font-bold tnum tabular-nums text-textPrimary" data-side-net>
          {fmtUsd(net)}
        </span>
        <span className="text-[11px] text-textMuted whitespace-nowrap">net {L}</span>
        {/* THE TAG AGREES WITH THE READ (the ship pass, 2026-10-22): it was the net's sign alone, so AAPL wore AMPLIFIES
            over "dips get absorbed" — spot above its flip absorbs whatever the book nets to. It is the regime at spot
            (the read's), within a hair of the flip "either way", and only for gamma — amplify/absorb is gamma's word. */}
        {greek === 'gex' && <Tag tone="holo">{regimeWord}</Tag>}
      </div>
      <p className="pb-1.5 text-[11px] leading-snug text-textSecondary" data-side-read>
        {s.read}
      </p>
      <div className="flex flex-col" data-side-levels>
        <Level word="put wall" tone="bear" k={s.putWall.strike} />
        <Level word="call wall" tone="bull" k={s.callWall.strike} />
        <Level word="flip" tone="white" k={s.flip} />
        {(greeks && greeks.length > 1 ? greeks : [greek]).map(g => (
          <Level key={g} word={greeks && greeks.length > 1 ? GREEK_LABEL[g] : 'supreme'} tone="supreme" k={s.supreme[g].strike} g={g} />
        ))}
      </div>

      {/* HEAVIEST TODAY — a hairline table: rank · strike · dollars · the window's change */}
      <Cap aside={windowRail}>
        Heaviest · {L}
      </Cap>
      <div className="flex flex-col" data-side-heaviest>
        <div className={`${HEAVY_COLS} sticky top-0 z-10 bg-panel text-[9px] uppercase tracking-widest text-textMuted`}>
          <span>#</span>
          <span>Strike</span>
          <span className="text-right tabular-nums">Net</span>
          <span className="text-right">Change</span>
        </div>
        {heaviest.map((r, i) => {
          const role = roleOf(r.strike);
          return (
            <div key={r.strike} className={HEAVY_COLS} data-side-heavy={r.strike}>
              <span className="font-mono text-[10px] tnum tabular-nums text-textMuted">{i + 1}</span>
              <span className="min-w-0 flex items-center gap-1.5 whitespace-nowrap">
                <Door k={r.strike} />
                {role && <Tag tone={role.tone}>{role.word}</Tag>}
              </span>
              <span className="text-right"><Money v={r[greek].net} /></span>
              <span className="font-mono text-[10px] tnum tabular-nums text-right text-textPrimary whitespace-nowrap">
                <Change now={r[greek].net} then={thenAt(winIdx, r.strike)} quiet />
              </span>
            </div>
          );
        })}
      </div>

      {/* THE STRIKE — its legs on one line, its other greeks two by two */}
      <Cap>
        The strike · {fmtStrike(strike)} · {kept ? 'kept' : greeks && greeks.length > 1 ? `${GREEK_LABEL[greek]} supreme` : 'the supreme'}
      </Cap>
      {front ? (
        <div className="pt-1.5 flex items-baseline gap-2 font-mono text-[11px] tnum tabular-nums whitespace-nowrap text-textPrimary" data-side-legs>
          <span className="text-[9px] uppercase tracking-wider text-textMuted">{L}</span>
          <span>
            <span className="text-textMuted">puts</span> {fmtUsd(front[greek].put)}
          </span>
          <span>
            <span className="text-textMuted">calls</span> {fmtUsd(front[greek].call)}
          </span>
          <span className="ml-auto font-bold text-[12px]">{fmtUsd(front[greek].net)}</span>
        </div>
      ) : (
        <p className="pt-1.5 text-[11px] text-textMuted">Off the book's window.</p>
      )}
      <div className="pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5" data-side-greeks>
        {others.map(g => (
          <Fact key={g} label={GREEK_LABEL[g]} value={<Money v={valueAt(strike, g)} />} />
        ))}
      </div>

      {/* TODAY'S CONTRACTS — one row of seven figures under their labels */}
      <Cap>Today's contracts · {L} · each window</Cap>
      <div className="pt-1 grid grid-cols-7 font-mono tnum tabular-nums" data-side-windows>
        {READ_WINDOWS.map((w, i) => (
          <span key={w.key} className="flex flex-col leading-tight min-w-0">
            <span className="text-[9px] text-textMuted">{w.key}</span>
            <span className="text-[10px] text-textPrimary whitespace-nowrap">{front ? <Change now={front[greek].net} then={thenAt(i, strike)} quiet /> : <span className="text-textMuted">—</span>}</span>
          </span>
        ))}
      </div>

      {/* TO THE CLOSE */}
      <Cap>{cmp.inSession ? 'To the close' : 'The next session'}</Cap>
      <div className="pt-1 flex flex-col gap-0.5">
        <Fact
          label="Expected move"
          value={
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-bold">±${s.sigmaLeft.toFixed(2)}</span>
              <span className="text-[10px] text-textMuted">±{s.sigmaLeftPct.toFixed(2)}%</span>
            </span>
          }
        />
        <Fact
          label="Likeliest close"
          value={
            s.closes ? (
              <span className="inline-flex items-baseline gap-1.5">
                <Door k={s.closes.strike} />
                <span className="text-[10px] text-textMuted">{s.closes.odds.toFixed(0)}% of the time</span>
              </span>
            ) : (
              <span className="text-textMuted">none</span>
            )
          }
        />
        <Fact
          label="Watch first"
          value={
            s.watch ? (
              <span className="inline-flex items-baseline gap-1.5">
                <Door k={s.watch.strike} />
                <span className="text-[10px] text-textMuted">
                  {watchKind} · {pct(s.watch.reach)} reached{s.watch.isShelf ? ` · ${holdLabel(s.watch.hold)}` : ''}
                </span>
              </span>
            ) : (
              <span className="text-textMuted">none</span>
            )
          }
        />
        <Fact label="Expires at the bell" value={s.bellShare != null ? <span>{s.bellShare}% <span className="text-[10px] text-textMuted">of the hedging</span></span> : '—'} />
      </div>
      <div className="pt-3 font-mono text-[9px] uppercase tracking-widest text-textMuted" data-side-foot>
        {s.strikes.length} strikes · {s.expiryCount} {s.expiryCount === 1 ? 'expiry' : 'expiries'}
      </div>
    </div>
  );

  /* ON A PHONE — a card under the ruler, the chip in its head, no tab */
  if (stacked)
    return (
      <div className="min-w-0 border border-borderSubtle rounded-md bg-panel" data-compare-side={side} data-side-open>
        <div className="px-3 pt-3 flex items-center">{chip}</div>
        {body}
      </div>
    );

  const Fold = side === 'a' ? (open ? ChevronLeft : ChevronRight) : open ? ChevronRight : ChevronLeft;
  const edge = side === 'a' ? 'border-r' : 'border-l';
  return (
    <div
      className={`relative shrink-0 min-h-0 flex flex-col ${edge} border-borderSubtle/60 ${full ? 'bg-canvas' : 'bg-panel'} transition-[width] duration-200 ease-out motion-reduce:transition-none overflow-hidden`}
      style={{ width: open ? SIDE_W : SIDE_TAB_W }}
      data-compare-side={side}
      data-side-open={open || undefined}
    >
      {open ? (
        <>
          <div className={`shrink-0 flex items-center gap-2 px-3 pt-3 ${side === 'b' ? 'flex-row-reverse' : ''}`} style={{ width: SIDE_W }}>
            {chip}
            <button
              type="button"
              onClick={onToggle}
              title={`Fold ${s.ticker}'s read to the edge`}
              aria-label={`Fold ${s.ticker}'s read`}
              className={`${side === 'b' ? 'mr-auto' : 'ml-auto'} inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors`}
              data-side-fold
            >
              <Fold className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ width: SIDE_W }}>
            {body}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          title={`Open ${s.ticker}'s read`}
          aria-label={`Open ${s.ticker}'s read`}
          className="flex-1 min-h-0 flex flex-col items-center gap-2 py-3 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] transition-colors"
          style={{ width: SIDE_TAB_W }}
          data-side-tab
        >
          <Fold className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-[10px] font-bold tracking-widest" style={{ writingMode: 'vertical-rl', transform: side === 'a' ? 'rotate(180deg)' : undefined }}>
            {s.ticker}
          </span>
        </button>
      )}
    </div>
  );
};

export default CompareSidePanel;
