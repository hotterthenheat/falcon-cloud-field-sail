/*
  The signature "slayer:~ $ <dot> live" with a hairline: the rail foot, footer, launch gate and phone menu.
  States: live (the dot is the moving foil, the word silver), delayed (warning ink), closed (muted). The foil is the
  mark's strip on the shared brand clock (brandClock.ts); the word follows data/marketState.ts, re-read every 30 s.
*/

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { readMarketState } from '../data/marketState';
import { alignBrandLoops } from './brandClock';

type SignatureState = 'live' | 'delayed' | 'closed';

/** Each state's flat dot; live has none, its dot is the moving foil (SignatureDot). */
const FLAT_DOT: Record<Exclude<SignatureState, 'live'>, string> = {
  delayed: 'rgb(var(--warn))',
  closed: 'rgb(var(--text-muted))',
};
const WORD: Record<SignatureState, string> = {
  live: 'rgb(var(--silver))',
  delayed: 'rgb(var(--warn))',
  closed: 'rgb(var(--text-muted))',
};

/** The market's word: live while open, closed when shut. */
const useMarketWord = (): SignatureState => {
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

/** The state's dot (live: the foil panning in a round clip). The folded rail keeps only this. */
export const SignatureDot = ({ state, className = 'w-[0.5em] h-[0.5em]', label }: SignatureDotProps) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  /* on the shared brand clock from the first frame (brandClock.ts) */
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
