/* One line under the read naming the page's own terms; opened, each says what it means. A term's hover says the
   same. */

import { SPREAD_LEG_PCT } from '../../data/flowBook';

type TermKey = 'standing' | 'ownTerms' | 'floor' | 'spreadLegs' | 'volOi' | 'doi' | 'stockLike' | 'oiDay';

const TERMS: Record<TermKey, { word: string; plain: string }> = {
  standing: {
    word: 'standing contracts',
    plain: "Contracts that still exist — not yet expired. One that expired at today's bell is left out of the counts.",
  },
  ownTerms: {
    word: 'own-terms prints',
    plain: "Dark-pool trades priced by their own terms (contingent, average-price) or in an auction, not at the quote: shown apart, never read.",
  },
  floor: {
    word: 'floor packages',
    plain: 'Multi-leg packages crossed on an exchange floor, often compression between firms. Their side is the package\'s, so they are set apart, never ranked.',
  },
  spreadLegs: {
    word: 'spread legs · no read',
    plain: `A contract with ${SPREAD_LEG_PCT}% or more of its day as legs of spreads: a leg's side says nothing about direction, so it gets no lean or crown.`,
  },
  volOi: {
    word: 'Vol/OI',
    plain: "Today's volume over the open interest before today. At 1.5× or more, new positions were likely built.",
  },
  doi: {
    word: 'ΔOI',
    plain: 'The change in open interest between daily counts: up is positions opened, down closed. "New" means there was none before.',
  },
  stockLike: {
    word: 'stock-like',
    plain: '25% or more in the money with a month or more to run: it moves like the stock, usually a replacement or a roll, not a bet.',
  },
  oiDay: {
    word: 'the open-interest day',
    plain: "Open interest is counted each morning, so the newest count shows the previous session's trading; today's shows up tomorrow.",
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
