/*
==================================================
  SLAYER TERMINAL - PINNED OR TRENDING, IN ONE SENTENCE
  (components/gex/RegimeLine.tsx)

  The eighth audit's retail finding: no page answered the first question a newcomer asks — "is this name pinned or
  trending today?". One plain sentence under the Pinpoint head, for the name the desk is on, built from the regime (the
  sign of the scope's net gamma) and the flip — levelsFor's own values, so it can never disagree with the Board, the
  Map, the Agenda or Compare. Nothing while the scope's levels are provisional.

  Beside it, "First time here?" — the words Pinpoint uses (supreme, trapdoor, shelf, charm, NOPE…), one line each.
==================================================
*/

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useLevelsFor } from '../../data/levelsFor';
import { FLIP_RULE } from '../../data/flipLevel';
import { peekGammaPriced } from '../../data/uwBook';
import { nyClock } from '../../core/nyTime';
import { useLevelsScope } from '../../data/levelsScope';
import GuideFocus from '../ui/GuideFocus';
import { FIRST_TIME, GLOSSARY } from './glossary';
import { LONG_GAMMA, SHORT_GAMMA } from './paletteInk';
import type { TickerLevels } from '../../data/levelsFor';

const fmtK = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/** The sentence, from the one source of levels — null while they are provisional */
export function regimeSentence(lv: TickerLevels | null): { lead: string; rest: string; tone: 'LONG' | 'SHORT' } | null {
  if (!lv || !lv.complete || !lv.regime) return null;
  const t = lv.ticker;
  const flip = lv.flip;
  if (lv.regime === 'SHORT') {
    const until =
      flip == null
        ? `there is no flip within 10%, so that holds across the whole range`
        : flip > lv.spot
          ? `until ${t} gets back above ${fmtK(flip)} (the flip)`
          : `until ${t} crosses ${fmtK(flip)} (the flip), where that changes`;
    return { lead: 'Dealers are short gamma', rest: `: moves tend to run rather than be absorbed, ${until}.`, tone: 'SHORT' };
  }
  const near = Math.abs(lv.supreme - lv.spot) / lv.spot <= 0.02 ? ` near ${fmtK(lv.supreme)} (the supreme)` : '';
  const until =
    flip == null
      ? 'with no flip within 10%'
      : flip < lv.spot
        ? `while ${t} holds above ${fmtK(flip)} (the flip)`
        : `until ${t} crosses ${fmtK(flip)} (the flip)`;
  return { lead: 'Dealers are long gamma', rest: `: moves tend to be absorbed and price tends to pin${near}, ${until}.`, tone: 'LONG' };
}

const RegimeLine = ({ ticker }: { ticker: string | null | undefined }) => {
  const scope = useLevelsScope();
  const lv = useLevelsFor(ticker, scope);
  const said = regimeSentence(lv);
  const priced = lv ? peekGammaPriced(lv.ticker, lv.date) ?? peekGammaPriced(lv.ticker, null) : null;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-3 min-w-0 -mt-1" data-regime-line={said?.tone ?? 'pending'}>
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-textSecondary" title={`Read off ${lv?.scopeLabel ?? 'the Levels card'}: the regime is the sign of net gamma on those contracts, the flip where it changes. ${GLOSSARY.flip}`}>
        <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted mr-2">Pinned or trending?</span>
        {said ? (
          <>
            <span className="font-semibold" style={{ color: said.tone === 'SHORT' ? SHORT_GAMMA : LONG_GAMMA }}>
              {said.lead}
            </span>
            {said.rest}
            {lv && <span className="text-textMuted"> · {lv.ticker} · {lv.scopeLabel}</span>}
            {/* TWO CROSSINGS, SAID (the ninth audit's M4): the flip keeps its crossing; the other is named, never swapped in silently */}
            {lv?.flip != null && lv.flipSecond != null && (
              <span className="text-textMuted" title={FLIP_RULE} data-flip-second={lv.flipSecond}>
                {' '}· a second flip at {fmtK(lv.flipSecond)} — the profile crosses twice
              </span>
            )}
            {/* A LEVEL THAT CHANGED STRIKE TODAY, SAID (the ninth audit: the call wall 765 at 12:55, 762 at 13:08, no note) */}
            {lv && lv.moves.length > 0 && (
              <span className="text-textMuted" data-level-moves={lv.moves.length} title={lv.moves.map(m => `${m.level} moved ${fmtK(m.from)} → ${fmtK(m.to)} at ${nyClock(m.at)} ET`).join('\n')}>
                {' '}· {lv.moves.slice(-2).map(m => `${m.level} moved ${fmtK(m.from)} → ${fmtK(m.to)} at ${nyClock(m.at)}`).join(' · ')}
              </span>
            )}
            {/* THE PRICING MINUTE (the eighth audit: 765 read $53M on the Map and $38M on the Agenda, minutes apart) — every
                strike figure on these pages is the vendor's row priced at this minute and price; a later load re-prices it */}
            {priced && (
              <span className="text-textMuted" title="The vendor re-prices every strike's gamma each minute at the live price: figures read at another minute (another page, a reload) differ by that drift" data-priced-at={priced.at}>
                {' '}· strikes priced {nyClock(priced.at)} ET at {priced.price.toFixed(2)}
              </span>
            )}
          </>
        ) : (
          <span className="text-textMuted">{ticker ? `Reading ${ticker}'s levels…` : '…'}</span>
        )}
      </p>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-pressed={open}
        className="hit shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] aria-pressed:text-textPrimary transition-colors"
        title="The words Pinpoint uses, one line each"
        data-first-time
      >
        <HelpCircle className="w-3 h-3" />
        First time here?
      </button>
      <GuideFocus open={open} onClose={() => setOpen(false)} title="The words on Pinpoint" testId="first-time" viewport width={520}>
        <dl className="px-3 py-2.5 grid gap-y-2" data-first-time-card>
          {FIRST_TIME.map(w => (
            <div key={w.term}>
              <dt className="text-[11px] font-semibold text-textPrimary">{w.term}</dt>
              <dd className="text-[11px] leading-snug text-textSecondary">{w.says}</dd>
            </div>
          ))}
        </dl>
      </GuideFocus>
    </div>
  );
};

export default RegimeLine;
