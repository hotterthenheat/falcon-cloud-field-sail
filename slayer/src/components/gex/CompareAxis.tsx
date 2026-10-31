/* Compare's ruler box: two names' hedging cannot share a price axis, so they share distance from each name's own spot
   (percent, ATRs or expected moves). CompareRuler draws a lane; this box owns the head, controls, reach sums and fullscreen. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import { fmtDollars, fmtStrike } from '../../data/ahead';
import { GREEK_LABEL, GREEK_WORDS, REACH_OPTIONS, type Compare, type Greek, type Reach } from '../../data/compare';
import DropdownMulti from '../ui/DropdownMulti';
import { GREEK_PICK_OPTIONS } from './exposureView';
import type { DistanceUnit } from '../../data/atr';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import ExpiryCard from '../ui/ExpiryCard';
import { GuideDoor } from '../ui/GuideFocus';
import { ladderExpiryOptions } from './ladderControls';
import type { ExposureExpiry } from '../../types/gex';
import RulerLane, { inView, layout, rulerWords, tickWords, type NodeCard } from './CompareRuler';
import { useResolvedTheme } from '../../theme/theme';
import { AXIS_H, AXIS_HEADS_H, AXIS_READ_H } from './compareSkeletons';
import { TickFigure } from '../ui/liveRead';

/** The thermal ramp's two voices, for the words that name them */
/* The head's other cards: the Map's Expiry card and the calendar's Colours card. */
const PALETTE_OPTIONS: DropdownOption<'thermal' | 'house'>[] = [
  { value: 'thermal', label: 'Thermal', hint: 'Yellow in the middle, red where hedging amplifies a move, blue where it absorbs one' },
  { value: 'house', label: 'House', hint: 'Gold where hedging amplifies, ice where it absorbs' },
];

interface Props {
  cmp: Compare;
  unit: DistanceUnit;
  reach: Reach;
  onReach: (r: Reach) => void;
  /* The lanes drawn, in the book's order (one, some or all five), and the pick behind the card (exposureView.ts rules). */
  greeks: Greek[];
  greekPick: string[];
  onGreekPick: (values: string[]) => void;
  /** Which contracts THIS name weighs. The other name keeps its own. */
  expiryA: ExposureExpiry;
  expiryB: ExposureExpiry;
  onExpiryA: (e: ExposureExpiry) => void;
  onExpiryB: (e: ExposureExpiry) => void;
  /** The capsules' ramp — the calendar's Colours card */
  palette: 'house' | 'thermal';
  onPalette: (p: 'house' | 'thermal') => void;
  focusA: number | null;
  focusB: number | null;
  onPick: (strike: number, ticker: string) => void;
  onGuide: () => void;
  guideOpen: boolean;
  /** The box moved to the whole viewport (Compare.tsx owns the move) */
  full: boolean;
  onFull: (full: boolean) => void;
}

/** What each name holds on one side of spot within the ruler's reach, and who is heavier there. */
interface ReachSide {
  neg: number;
  pos: number;
  total: number;
}
const sumSide = (rows: { d: number; value: number }[], R: number, above: boolean): ReachSide => {
  let neg = 0;
  let pos = 0;
  for (const r of rows) {
    if (!(above ? r.d > 0 && r.d <= R : r.d < 0 && r.d >= -R)) continue;
    if (r.value < 0) neg += -r.value;
    else pos += r.value;
  }
  return { neg, pos, total: neg + pos };
};
const heavierWords = (a: ReachSide, b: ReachSide, na: string, nb: string) => {
  if (a.total <= 0 && b.total <= 0) return { lead: 'nothing on either', tail: '' };
  if (a.total <= 0 || b.total <= 0) return { lead: `only ${a.total > 0 ? na : nb}`, tail: fmtDollars(Math.max(a.total, b.total)) };
  const ratio = Math.max(a.total, b.total) / Math.min(a.total, b.total);
  const lead = ratio < 1.15 ? 'about even' : `${a.total >= b.total ? na : nb} ${ratio.toFixed(1)}× heavier`;
  return { lead, tail: `${fmtDollars(a.total)} vs ${fmtDollars(b.total)}` };
};

const CompareAxis = ({ cmp, unit, reach, onReach, greeks, greekPick, onGreekPick, expiryA, expiryB, onExpiryA, onExpiryB, palette, onPalette, focusA, focusB, onPick, onGuide, guideOpen, full, onFull }: Props) => {
  const paper = useResolvedTheme() === 'light';
  /* several lanes side by side, or the one drawing */
  const all = greeks.length > 1;
  /* the sub line's two inks follow the capsules' ramp */
  /* The two poles as words read the tokens: the ramp's own inks are too faint on paper. */
  const WARM = palette === 'house' ? 'rgb(var(--ember))' : 'rgb(var(--thermal-warm))';
  const COOL = palette === 'house' ? 'rgb(var(--glacier))' : 'rgb(var(--thermal-cool))';
  const greek: Greek = greeks[0] ?? 'gex';
  const greekKey = greeks.join(',');
  const words = GREEK_WORDS[greek];
  /* The ruler is the same whatever the greek — the strikes are the same — so one layout serves the head */
  const lay = useMemo(() => layout(cmp, unit, reach, greek), [cmp, unit, reach, greek]);
  const limit = Math.max(0, lay.maxD - lay.R);
  const scrollable = lay.maxD > lay.R;
  /* The window's target along the ruler (0 = spot), shared by every lane. */
  const [want, setWant] = useState(0);
  useEffect(() => setWant(0), [cmp.a.ticker, cmp.b.ticker, reach]);
  const target = Math.max(-limit, Math.min(limit, want));
  const view = inView(lay, target);
  const scale = view.scale(greek);

  /* The node card (fullscreen): one open across the box. A click anywhere closes it, heard in the capture phase so a click
     on another capsule then opens that one; Esc closes it before Esc leaves fullscreen. */
  const [card, setCard] = useState<NodeCard | null>(null);
  useEffect(() => setCard(null), [cmp.a.ticker, cmp.b.ticker, greekKey, full]);
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCard(null);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-node-card],[data-axis-canvas]')) return;
      setCard(null);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [card]);
  /* Several greeks on the page share the single drawing's height; fullscreen gives them the screen. */
  /* both books are the vendor's, and its per-strike exposure carries no vega — VEX would draw $0 capsules */
  const greekGroups = useMemo(() => [{ title: 'What the capsules measure', options: GREEK_PICK_OPTIONS }], []);

  /* What sits within reach, for each greek on the ruler. */
  const reachFacts = useMemo(() => {
    return greeks.map(g => {
      const L = g === greek ? lay : layout(cmp, unit, reach, g);
      const up = heavierWords(sumSide(L.a.rows, L.R, true), sumSide(L.b.rows, L.R, true), cmp.a.ticker, cmp.b.ticker);
      const down = heavierWords(sumSide(L.a.rows, L.R, false), sumSide(L.b.rows, L.R, false), cmp.a.ticker, cmp.b.ticker);
      return { g, up, down };
    });
  }, [lay, cmp, unit, reach, greek, greeks]);

  const laneProps = { cmp, unit, reach, want, onWant: setWant, focusA, focusB, onPick, card, onCard: full ? setCard : undefined, palette };

  return (
    <section className={`relative flex flex-col min-w-0 ${full ? 'h-full min-h-0' : ''}`} data-compare-axis data-ruler={lay.U} data-reach={reach} data-greeks={greekKey} data-offset={target.toFixed(3)} data-scrollable={scrollable || undefined} data-full={full || undefined}>
      {/* THE HEAD */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap shrink-0">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3 flex-wrap">
            {full && (
              <button type="button" onClick={() => onFull(false)} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-t10 text-textSecondary hover:text-textPrimary transition-colors" title="Back to the page (Esc)" data-axis-back>
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            )}
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary whitespace-nowrap">The two books on one ruler</h3>
            <GuideDoor open={guideOpen} onClick={onGuide} title="What the two sides and the ruler mean" testId="compare-guide" />
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {all ? (
              <>Each strike at its distance from its own spot · {cmp.a.ticker} grows left, {cmp.b.ticker} right · one lane per greek, one window for all {greeks.length} · dashed is each flip</>
            ) : (
              <>
                Each strike at its distance from its own spot · {cmp.a.ticker} grows left, {cmp.b.ticker} right · longer is more {GREEK_LABEL[greek]} · <span style={{ color: COOL }}>{palette === 'house' ? 'ice' : 'blue'}</span> {words.neg}, <span style={{ color: WARM }}>{palette === 'house' ? 'gold' : 'orange'}</span> {words.pos} · dashed is each flip
              </>
            )}
          </p>
        </div>
        {/* Three facts; the ruler's unit and the strikes beyond it live in the lane heads. */}
        <dl className="grid grid-cols-3 gap-x-6">
          <div>
            <dt className="text-t10 text-textMuted">Shown</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum tabular-nums text-textPrimary whitespace-nowrap" data-axis-shown>
              {Math.abs(target) < 1e-6 ? `±${tickWords(lay.R, lay.U).replace(/^[+−]/, '')}` : `${tickWords(target - lay.R, lay.U)} to ${tickWords(target + lay.R, lay.U)}`}
            </dd>
          </div>
          {reachFacts.length === 1 ? (
            <>
              <div title={reachFacts[0].up.tail ? `${GREEK_LABEL[greek]} above spot within reach · ${cmp.a.ticker} vs ${cmp.b.ticker} · ${reachFacts[0].up.tail}` : undefined}>
                <dt className="text-t10 text-textMuted whitespace-nowrap">Overhead</dt>
                <dd className="mt-0.5 font-mono text-t12 tnum tabular-nums text-textPrimary whitespace-nowrap" data-axis-reach-up>
                  {reachFacts[0].up.lead}
                </dd>
              </div>
              <div title={reachFacts[0].down.tail ? `${GREEK_LABEL[greek]} below spot within reach · ${cmp.a.ticker} vs ${cmp.b.ticker} · ${reachFacts[0].down.tail}` : undefined}>
                <dt className="text-t10 text-textMuted whitespace-nowrap">Below</dt>
                <dd className="mt-0.5 font-mono text-t12 tnum tabular-nums text-textPrimary whitespace-nowrap" data-axis-reach-down>
                  {reachFacts[0].down.lead}
                </dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt className="text-t10 text-textMuted whitespace-nowrap">Overhead</dt>
                <dd className="mt-0.5 font-mono text-t11 leading-snug tnum tabular-nums text-textPrimary" data-axis-reach-up>
                  {reachFacts.map(f => (
                    <span key={f.g} className="block whitespace-nowrap" title={f.up.tail || undefined}>
                      <span className="text-textMuted">{GREEK_LABEL[f.g]} </span>
                      {f.up.lead}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-t10 text-textMuted whitespace-nowrap">Below</dt>
                <dd className="mt-0.5 font-mono text-t11 leading-snug tnum tabular-nums text-textPrimary" data-axis-reach-down>
                  {reachFacts.map(f => (
                    <span key={f.g} className="block whitespace-nowrap" title={f.down.tail || undefined}>
                      <span className="text-textMuted">{GREEK_LABEL[f.g]} </span>
                      {f.down.lead}
                    </span>
                  ))}
                </dd>
              </div>
            </>
          )}
          {/* On a phone the flips are named here: a ~140 px lane has no room for the flip chip. */}
          {(cmp.a.flip != null || cmp.b.flip != null) && (
            <div className="md:hidden col-span-3 mt-2">
              <dt className="text-t10 text-textMuted">Flips · the dashed lines</dt>
              <dd className="mt-0.5 font-mono text-t12 tnum tabular-nums text-textPrimary whitespace-nowrap" data-axis-flips>
                {cmp.a.ticker} {cmp.a.flip != null ? fmtStrike(cmp.a.flip) : '—'} <span className="text-textMuted">·</span> {cmp.b.ticker} {cmp.b.flip != null ? fmtStrike(cmp.b.flip) : '—'}
              </dd>
            </div>
          )}
        </dl>
        {/* The fullscreen door at the head's far right, where the calendar's and chart's sit. */}
        <div className="shrink-0 h-6 flex items-center">
          <button
            type="button"
            onClick={() => onFull(!full)}
            aria-pressed={full}
            title={full ? 'Leave fullscreen (Esc)' : 'Fullscreen'}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
            data-axis-full
          >
            {full ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="px-5 pb-2 flex items-center gap-2 flex-wrap shrink-0" data-axis-controls>
        <ExpiryCard label={cmp.a.ticker} value={expiryA} choices={ladderExpiryOptions(cmp.a.ticker)} onChange={onExpiryA} title={`Which expiries ${cmp.a.ticker} weighs. ${cmp.b.ticker} keeps its own.`} testId="compare-expiry-a" />
        <ExpiryCard label={cmp.b.ticker} value={expiryB} choices={ladderExpiryOptions(cmp.b.ticker)} onChange={onExpiryB} title={`Which expiries ${cmp.b.ticker} weighs. ${cmp.a.ticker} keeps its own.`} testId="compare-expiry-b" />
        <DropdownSelect label="Reach" value={reach} options={REACH_OPTIONS} onChange={onReach} title="How far the ruler runs, in the day's expected moves" testId="reach" />
        <DropdownMulti label="Greek" values={greekPick} groups={greekGroups} onChange={onGreekPick} emptyWord="All" title="One, some, or all four — a lane each, on one ruler" testId="compare-greek" align="start" />
        {/* No Colours card on paper: the paper ramps are one journey whatever the palette. */}
        {!paper && <DropdownSelect label="Colours" value={palette} options={PALETTE_OPTIONS} onChange={onPalette} title="What the colours mean" testId="compare-colours" />}
        <span className="ml-auto font-mono text-t9 uppercase tracking-widest text-textMuted whitespace-nowrap" title={unit === '$' ? 'Dollars do not compare across names, so the ruler reads percent here' : undefined} data-axis-ruler-words>
          {rulerWords(lay.U)}
          {lay.U === '%' && unit === '$' ? ' · not dollars' : ''}
        </span>
      </div>

      {all ? (
        /* ALL FIVE — one lane per greek on the same ruler, the same window; on the page
           the five stand in the single drawing's height (heads + drawing + read), so the
           box does not move when the card flips between one greek and all */
        <div
          className={`min-h-0 px-3 pb-3 grid gap-2 ${full ? 'flex-1' : 'shrink-0'}`}
          /* Lanes no narrower than 200 px (under the ruler's drawing floor they drew blank); they wrap to rows instead. */
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gridAutoRows: 'minmax(0, 1fr)', height: full ? undefined : AXIS_HEADS_H + AXIS_H + AXIS_READ_H + 12 /* the pb-3 */ }}
          data-axis-all
        >
          {greeks.map(g => (
            <div key={g} data-theme={paper ? 'light' : 'dark'} className={`min-w-0 min-h-0 flex flex-col border border-borderSubtle/60 rounded-md overflow-hidden ${paper ? 'bg-inset' : 'bg-panel'}`} data-axis-lane-box={g}>
              <RulerLane {...laneProps} greek={g} compact />
            </div>
          ))}
        </div>
      ) : (
        <>

          {/* Each name at its own end: its spot, its longest capsule and what lies beyond the ruler. */}
          <div className="sticky top-0 z-10 bg-panel px-5 flex items-center justify-between gap-4 font-mono text-t10 tnum tabular-nums shrink-0 whitespace-nowrap" style={{ height: AXIS_HEADS_H }} data-axis-heads>
            {/* Short enough to read whole ("max", "+N off"); the full words on hover. */}
            <span className="min-w-0 truncate text-textSecondary" data-axis-head="a" title={`${cmp.a.ticker}: the levels are read at ${cmp.a.spot.toFixed(2)}, the price the feed marked its rows at · its longest capsule is ${fmtDollars(scale.a)} of ${GREEK_LABEL[greek]}${view.off.a > 0 ? ` · ${view.off.a} strikes lie beyond the ruler` : ''}`}>
              <span className="font-bold text-textPrimary">{cmp.a.ticker}</span> · <TickFigure value={cmp.a.spot}>{cmp.a.spot.toFixed(2)}</TickFigure> · <span className="text-textMuted">max {fmtDollars(scale.a)}</span>
              {view.off.a > 0 && <span className="text-textMuted"> · +{view.off.a} off</span>}
            </span>
            <span className="min-w-0 truncate text-right text-textSecondary" data-axis-head="b" title={`${cmp.b.ticker}: the levels are read at ${cmp.b.spot.toFixed(2)}, the price the feed marked its rows at · its longest capsule is ${fmtDollars(scale.b)} of ${GREEK_LABEL[greek]}${view.off.b > 0 ? ` · ${view.off.b} strikes lie beyond the ruler` : ''}`}>
              {view.off.b > 0 && <span className="text-textMuted">+{view.off.b} off · </span>}
              <span className="text-textMuted">max {fmtDollars(scale.b)}</span> · <TickFigure value={cmp.b.spot}>{cmp.b.spot.toFixed(2)}</TickFigure> · <span className="font-bold text-textPrimary">{cmp.b.ticker}</span>
            </span>
          </div>

          {/* THE DRAWING — a fixed height on the page, the rest of the screen in fullscreen */}
          {/* A dark island on the dark terminal (the heat ramp is cut for a dark ground); on paper the soft inset grey,
   and the canvas draws its paper inks with every capsule edged (CompareRuler PAPER_INKS). */}
          {/* Fullscreen wears the page's own ground; docked it is the dark island. */}
          <div data-theme={paper ? 'light' : 'dark'} className={`${full ? 'bg-canvas flex-1 min-h-0 flex flex-col' : `${paper ? 'bg-inset border-y border-borderSubtle' : 'bg-panel'} shrink-0 rounded-md`}`} data-ruler-island>
            <RulerLane {...laneProps} greek={greek} height={full ? undefined : AXIS_H} />
          </div>

          {!full && <div className="h-3 shrink-0" aria-hidden />}
        </>
      )}
    </section>
  );
};

export default CompareAxis;
