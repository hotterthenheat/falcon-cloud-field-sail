/*
==================================================
  SLAYER TERMINAL - THE WORDS ON THE PAGE (Trace)

  Audit round 8 (retail): "standing contracts",
  "own-terms prints", "floor packages", "spread
  legs · no read", Vol/OI, ΔOI, "stock-like" and
  the open-interest day were desk words with no
  plain-English line anywhere. One line under the
  read names the page's words; opened, each says
  what it means in a sentence. A word's hover says
  the same, so a laptop never has to open it.
==================================================
*/

import { SPREAD_LEG_PCT } from '../../data/flowBook';

export type TermKey = 'standing' | 'ownTerms' | 'floor' | 'spreadLegs' | 'volOi' | 'doi' | 'stockLike' | 'oiDay';

export const TERMS: Record<TermKey, { word: string; plain: string }> = {
  standing: {
    word: 'standing contracts',
    plain: "Contracts that still exist — not yet expired. One that expired at today's bell is left out of the counts.",
  },
  ownTerms: {
    word: 'own-terms prints',
    plain: "Dark-pool trades priced by their own terms (contingent, average-price, prior-reference) or in the opening or closing auction, not at the market's quote — they say nothing about buying or selling pressure, so they are shown apart and never read.",
  },
  floor: {
    word: 'floor packages',
    plain: 'Multi-leg packages put together on an exchange floor — often compression trades that net positions down between firms. Their side belongs to the package, not to a bet, so they are set apart and never ranked.',
  },
  spreadLegs: {
    word: 'spread legs · no read',
    plain: `A contract traded as one leg of a multi-leg order (a spread): one leg is bought while another is sold, so a leg's own side says nothing about direction. A contract with ${SPREAD_LEG_PCT}% or more of its day in such orders is counted, but given no lean and never called the biggest bet.`,
  },
  volOi: {
    word: 'Vol/OI',
    plain: "Today's volume divided by the open interest (the contracts outstanding before today). At 1.5× or more, more traded today than was open — new positions were likely built.",
  },
  doi: {
    word: 'ΔOI',
    plain: 'The change in open interest from one daily count to the next — up means positions were opened, down means they were closed. "New" means there was none before.',
  },
  stockLike: {
    word: 'stock-like',
    plain: 'Deep in the money (25% or more) with a month or more to run — it moves almost one-for-one with the stock, so it is usually a stock replacement or a roll, not a bet on direction.',
  },
  oiDay: {
    word: 'the open-interest day',
    plain: "Open interest is counted once a day, before the open — so the newest count shows what the previous session's trading left. Today's trading shows up in tomorrow morning's count.",
  },
};

/** The page's words in one line; opened, one plain sentence each */
const TermLine = ({ keys, testId }: { keys: TermKey[]; testId?: string }) => (
  <details className="mt-2 group" data-term-line={testId ?? true}>
    <summary className="cursor-pointer list-none font-mono text-t105 text-textMuted hover:text-textSecondary select-none [&::-webkit-details-marker]:hidden">
      <span className="uppercase tracking-wider">The words</span>{' '}
      {keys.map((k, i) => (
        <span key={k} title={TERMS[k].plain}>
          {i > 0 && <span aria-hidden> · </span>}
          <span className="underline decoration-dotted underline-offset-2">{TERMS[k].word}</span>
        </span>
      ))}
      <span className="ml-1 group-open:hidden" aria-hidden>
        — what they mean ▸
      </span>
    </summary>
    <dl className="mt-1.5 grid gap-1 text-t115 leading-snug text-textSecondary">
      {keys.map(k => (
        <div key={k}>
          <dt className="inline font-semibold text-textPrimary">{TERMS[k].word}</dt> <dd className="inline">— {TERMS[k].plain}</dd>
        </div>
      ))}
    </dl>
  </details>
);

export default TermLine;
