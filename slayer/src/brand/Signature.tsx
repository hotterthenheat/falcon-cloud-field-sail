/*
==================================================
  SLAYER TERMINAL - THE SIGNATURE (brand/Signature.tsx)

  "slayer:~ $ ● live" with a hairline under it — in place of the
  logo in the rail's foot, the footer's status line, the launch gate
  and the phone menu. His partner's, taken whole (Noah, 2026-10-03:
  "all of it"). Three state words, never more:

    live      the market is open — the dot is the foil that moves
              (the mark's own, panning in a round clip on the mark's
              beat) and the word is the silver ink
    delayed   the feed is behind — the warning ink
    closed    the market is shut — the muted ink

  The dot's foil is the S's: the same strip, the same keyframes,
  slid by transform inside its clip so nothing repaints, and pinned
  to the page's clock with every mark (brand/brandClock.ts) — live
  pans at the live mark's 9 s each way, so the dot and the S beside
  it shine together. On paper the foil is the galaxy ink (Noah:
  "keep our galaxy color"). Unless a caller names one, the word is
  the market's own (data/marketState.ts), read again every 30 s.
  Never lime: lime is for what is live on the page, not the brand.
==================================================
*/

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { readMarketState } from '../data/marketState';
import { alignBrandLoops } from './brandClock';

export type SignatureState = 'live' | 'delayed' | 'closed';

/** each state's flat dot — live has none: its dot is the moving foil (SignatureDot) */
const FLAT_DOT: Record<Exclude<SignatureState, 'live'>, string> = {
  delayed: 'rgb(var(--warn))',
  closed: 'rgb(var(--text-muted))',
};
const WORD: Record<SignatureState, string> = {
  live: 'rgb(var(--silver))',
  delayed: 'rgb(var(--warn))',
  closed: 'rgb(var(--text-muted))',
};

/** The market's word — live while it is open, closed when it is shut */
export const useMarketWord = (): SignatureState => {
  const [word, setWord] = useState<SignatureState>(() => readMarketState().word);
  useEffect(() => {
    const id = window.setInterval(() => setWord(readMarketState().word), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return word;
};

interface SignatureDotProps {
  state: SignatureState;
  /** the dot's size and placement (a width and a height) */
  className?: string;
  /** an accessible name, when the dot stands alone (the folded rail) */
  label?: string;
}

/** The state's dot — live: the foil panning in a round clip, on the mark's beat. The rail, folded, keeps only this. */
export const SignatureDot = ({ state, className = 'w-[0.5em] h-[0.5em]', label }: SignatureDotProps) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  /* on the page's beat from the first frame (brand/brandClock.ts) */
  useLayoutEffect(() => {
    alignBrandLoops(ref.current);
  }, [state]);
  const live = state === 'live';
  return (
    <span
      ref={ref}
      className={`relative block rounded-full overflow-hidden shrink-0 ${className}`}
      style={live ? { isolation: 'isolate' } : { background: FLAT_DOT[state] }}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-signature-dot={state}
    >
      {live && <span className="sig-foil" style={{ animationDuration: '9s' }} />}
    </span>
  );
};

interface SignatureProps {
  /** the state word; the market's own when left out */
  state?: SignatureState;
  /** words after the state, in the muted ink ("· v1.0.0") */
  detail?: ReactNode;
  /** the hairline under it — on by default */
  rule?: boolean;
  className?: string;
}

const Signature = ({ state, detail, rule = true, className = '' }: SignatureProps) => {
  const market = useMarketWord();
  const word = state ?? market;
  return (
    <span
      className={`inline-flex items-center gap-[0.6em] font-mono whitespace-nowrap leading-none ${rule ? 'pb-[0.55em] border-b border-ink/[0.14]' : ''} ${className}`}
      data-signature={word}
    >
      <span className="text-textPrimary">slayer:~ $</span>
      <span className="inline-flex items-center gap-[0.45em]">
        <SignatureDot state={word} />
        <span style={{ color: WORD[word] }}>{word}</span>
      </span>
      {detail != null && <span className="text-textMuted">{detail}</span>}
    </span>
  );
};

export default Signature;
