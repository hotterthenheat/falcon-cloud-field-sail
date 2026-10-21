/*
==================================================
  SLAYER TERMINAL - THE CASE FOR A STRIKE
  (components/weigher/StrikeCase.tsx)

  Noah, 2026-10-07, approving the list: the Weigher's
  strike reads like a Compass card, but in more
  detail — the word and its line; for it and against
  it; what has to happen, with the levels in the way;
  if not this one, which; the same strike down the
  calendar; what to look at for the horizon the expiry
  sets. The Stats, the Greeks and the book at the
  strike stay in the chain's dropdown (ChainGrid's
  weigh-up, BookBlock); the case itself stands IN THE
  POSITION CARD since 2026-10-10 (his partner: the
  dropdown was too small a window for it), while the
  picked contract is not on the list.

  The words are data/strikeCase.ts's; this file only
  lays them out — the four public words in their inks
  (GradeMeter), dot-leader Fact rows for the figures,
  plain sentences one a line, the alternatives as
  doors into their own dropdown.
==================================================
*/

import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import CardTabs from '../ui/CardTabs';
import Fact from '../ui/Fact';
import { GRADE_INK } from '../ui/GradeMeter';
import { buildStrikeCase, type Alt, type Word } from '../../data/strikeCase';
import type { DeskChain, DeskContract } from '../../data/weigherDesk';
import type { ExposureProfileData } from '../../types/gex';
import type { Book } from '../../data/bookAtStrike';
import type { OptionRight } from '../../types/compass';

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const HEAD = 'font-mono text-[10px] font-bold uppercase tracking-widest text-textSecondary';
const DOOR = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border border-borderSubtle font-mono text-[10px] uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-textPrimary/40 transition-colors';

/** The word, as a small capsule in its ink */
const WordChip = ({ word, small = false }: { word: Word; small?: boolean }) => (
  <span className={`inline-flex items-center rounded-full border border-current/40 font-mono font-bold uppercase ${small ? 'h-4 px-1.5 text-[8px] tracking-[0.12em]' : 'h-5 px-2 text-[9px] tracking-[0.14em]'} ${GRADE_INK[word]}`} data-strike-word={word}>
    {word}
  </span>
);

/** Plain sentences, one a line, a short mark in front of each */
const Reasons = ({ title, items, ink, empty }: { title: string; items: string[]; ink: string; empty: string }) => (
  <div className="flex flex-col gap-2 min-w-0" data-strike-reasons={title}>
    <span className={HEAD}>{title}</span>
    {items.length ? (
      <ul className="flex flex-col gap-2.5">
        {items.map(t => (
          <li key={t} className="flex items-start gap-2.5 text-[12px] leading-relaxed text-textPrimary">
            <span className={`mt-[9px] w-2.5 h-px shrink-0 ${ink}`} aria-hidden="true" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-[12px] text-textMuted">{empty}</span>
    )}
  </div>
);

const AltDoor = ({ alt, says, onPick, testId }: { alt: Alt | null; says: string; onPick: (alt: Alt) => void; testId: string }) =>
  alt ? (
    <button type="button" onClick={() => onPick(alt)} className="flex items-start gap-3 text-left rounded-md border border-borderSubtle px-3.5 py-3 hover:border-textPrimary/40 hover:bg-ink/[0.03] transition-colors min-w-0" data-strike-alt={testId}>
      <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-textMuted" aria-hidden="true" />
      <span className="flex flex-col gap-1.5 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[12px] font-semibold tnum text-textPrimary">
            {fmtStrike(alt.strike)}
            {alt.right} · {alt.expiry}
          </span>
          <span className="font-mono text-[11px] tnum text-textSecondary">${alt.mark.toFixed(2)}</span>
          <WordChip word={alt.word} />
        </span>
        <span className="text-[11.5px] leading-relaxed text-textSecondary">{alt.reason}</span>
      </span>
    </button>
  ) : (
    <span className="flex items-center rounded-md border border-dashed border-borderSubtle px-3.5 py-3 text-[12px] text-textMuted" data-strike-alt={`${testId}-none`}>
      {says}
    </span>
  );

interface Props {
  ticker: string;
  c: DeskContract;
  right: OptionRight;
  chain: DeskChain;
  profile: ExposureProfileData | null;
  book: Book | null;
  /** the desk's sweep — the case is rebuilt on it */
  tick: number;
  /** a door's pick: this strike or another, on this expiry or another — the desk points itself there and says so */
  onPickAlt: (strike: number, dte: number) => void;
}

/* ONE PART AT A TIME (Noah's partner, 2026-10-10: "we have to scroll quite a bit for the user to see it all"): the
   word and its line stay on top, the verdict; under them the case's five parts as the house's card tabs — the way the
   Compass card opens on "Why we chose this" — each of a size that fits the position card without a scroll. The tab the
   reader is on is KEPT across strikes (a module-level memory: the card remounts on every contract), so comparing two
   strikes is press, press. */
type Part = 'why' | 'needs' | 'instead' | 'calendar' | 'horizon';
const PARTS: readonly { value: Part; label: string }[] = [
  { value: 'why', label: 'Why' },
  { value: 'needs', label: 'What it needs' },
  { value: 'instead', label: 'If not this' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'horizon', label: 'Horizon' },
];
let lastPart: Part = 'why';

const StrikeCase = ({ ticker, c, right, chain, profile, book, tick, onPickAlt }: Props) => {
  const k = useMemo(
    () => buildStrikeCase({ ticker, c, right, chain, profile, book }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, c.strike, right, chain, profile, book, tick]
  );
  const [part, setPartState] = useState<Part>(lastPart);
  const setPart = (p: Part) => {
    lastPart = p;
    setPartState(p);
  };
  const pick = (alt: Alt) => onPickAlt(alt.strike, alt.dte);
  const moveInk = k.needs.movePct >= 0 ? 'text-bull' : 'text-bear';
  return (
    /* `whitespace-normal`: a grid's cells are one line each; a sentence here wraps wherever the case stands */
    <div className="flex-1 flex flex-col gap-3.5 whitespace-normal" data-strike-case={`${fmtStrike(c.strike)}${right}`}>
      {/* THE WORD AND ITS LINE — the verdict, always in view */}
      <div className="flex items-start gap-2.5">
        <WordChip word={k.word} />
        <p className="text-[12.5px] leading-snug text-textPrimary" data-strike-line>
          {k.line}
        </p>
      </div>

      {/* THE PARTS */}
      <div data-strike-tabs={part}>
        <CardTabs<Part> options={PARTS} value={part} onChange={setPart} ariaLabel="The case, part by part" />
      </div>

      <div key={part} className="flex-1 flex flex-col gap-4 pt-1 animate-soft-in" data-strike-part={part}>
        {/* WHY — for it, against it; one under the other, a sentence wants the width */}
        {part === 'why' && (
          <>
            <Reasons title="For it" items={k.forIt} ink="bg-bull" empty="Nothing speaks for it today." />
            <Reasons title="Against it" items={k.againstIt} ink="bg-bear" empty="Nothing stands against it today." />
          </>
        )}

        {/* WHAT IT NEEDS */}
        {part === 'needs' && (
          <div className="flex flex-col gap-3" data-strike-needs>
            <div className="flex flex-col gap-1 pr-2">
              <Fact big label="Needs" value={`${k.needs.movePct >= 0 ? '+' : '−'}${Math.abs(k.needs.movePct).toFixed(2)}%`} valueCls={moveInk} />
              <Fact big label="By" value={k.needs.sessions <= 0 ? 'the bell' : k.needs.sessions === 1 ? 'tomorrow' : `${k.needs.sessions} sessions`} />
              <Fact big label="The options price" value={`±${k.needs.expectedMovePct.toFixed(2)}%`} />
              <Fact big label="A usual day" value={k.needs.usualDayPct != null ? `${k.needs.usualDayPct.toFixed(2)}%` : '—'} />
            </div>
            <p className="text-[12px] leading-relaxed text-textSecondary">{k.needs.sentence}</p>
            {k.needs.path.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap" data-strike-path>
                <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">In the way</span>
                {k.needs.path.map(p => (
                  <span key={p.price} className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded border border-borderSubtle font-mono text-[11px] tnum text-textSecondary">
                    <span className="text-textPrimary">{fmtStrike(p.price)}</span>
                    <span>{p.name}</span>
                    {p.inTen != null && <span className="text-textMuted">· {p.inTen} in 10 past it</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* IF NOT THIS ONE — the two doors; a door swaps the case and opens the chain on it */}
        {part === 'instead' && (
          <div className="flex flex-col gap-2" data-strike-instead>
            <span className={HEAD}>Another strike, or another expiry</span>
            <div className="grid grid-cols-1 gap-2">
              <AltDoor alt={k.instead.strike} says="No strike near it reads better on this expiry." onPick={pick} testId="strike" />
              <AltDoor alt={k.instead.expiry} says="No other expiry reads better for this strike." onPick={pick} testId="expiry" />
            </div>
            {k.instead.strike && (
              <button type="button" onClick={() => pick(k.instead.strike!)} className={`${DOOR} w-fit`} data-strike-door="instead">
                Open {fmtStrike(k.instead.strike.strike)}
                {k.instead.strike.right} instead
              </button>
            )}
          </div>
        )}

        {/* THE SAME STRIKE DOWN THE CALENDAR */}
        {part === 'calendar' && (
          <div className="flex flex-col gap-2" data-strike-calendar>
            <span className={HEAD}>The same strike down the calendar</span>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-borderSubtle">
                  {['Expiry', '', 'Premium', 'Breakeven', 'Decay/day', 'Priced', ''].map((h, i) => (
                    <th key={i} className={`py-1 pr-3 font-mono text-[9px] font-normal uppercase tracking-wider text-textMuted ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {k.calendar.map(r => (
                  <tr
                    key={r.dte}
                    onClick={() => !r.current && onPickAlt(c.strike, r.dte)}
                    className={`border-b border-borderSubtle/60 ${r.current ? 'bg-silver/[0.06]' : 'cursor-pointer hover:bg-ink/[0.03]'}`}
                    data-strike-cal={r.dte}
                    data-current={r.current || undefined}
                  >
                    <td className="py-2 pr-3 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{r.label}</td>
                    <td className="py-2 pr-3 font-mono text-[9px] uppercase tracking-wider text-textMuted whitespace-nowrap">{r.horizon}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] font-semibold tnum text-textPrimary">${r.mark.toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] tnum text-textSecondary">{fmtStrike(Math.round(r.breakeven * 100) / 100)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] tnum text-bear">${r.decayDay.toFixed(2)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-[12px] tnum text-textSecondary">±{r.expectedMovePct.toFixed(2)}%</td>
                    <td className="py-2 pr-2 text-right">
                      <WordChip word={r.word} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FOR THE HORIZON */}
        {part === 'horizon' && (
          <div className="flex flex-col gap-2" data-strike-horizon={k.horizon.name}>
            <span className={HEAD}>{k.horizon.name}</span>
            <div className="flex flex-col gap-2.5 pr-2">
              {k.horizon.items.map(it => (
                <div key={it.k} className="flex flex-col gap-0.5 min-w-0">
                  <Fact big label={it.k} value={it.v} />
                  {it.sub && <span className="text-[11px] leading-snug text-textMuted">{it.sub}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* THE DOORS the row already has stay the row's: the + for the watchlist, the card's Watch it and Add a position */}
      <span className="mt-auto pt-2 text-[10.5px] text-textMuted">Words, not advice: the book as it stands, read for a buyer of this contract.</span>
    </div>
  );
};

export default StrikeCase;
