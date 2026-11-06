/* THE ONE STALE STATE. Every box that shows a live reading can wear the same tag for how old it is: nothing while it is
   fresh (or the quiet "as of" stamp when asked), "Stale · as of 10:42 ET" past its source's window (data/freshness.ts),
   "Reconnecting · as of 10:42 ET" while its feed is down and the last reading stays up. The words are the house's (no
   vendor named), the ink is the warn ink beside a word (never colour alone), and the tag is a polite live region so a
   screen reader hears the change once, not every tick.

   `useFreshness(at, source, { down })` gives the state for a box that draws its own; `<Freshness>` is the tag. One
   shared clock re-renders every reader at most every five seconds. */

import { useSyncExternalStore } from 'react';
import { asOfText } from './states';
import { ageWords, freshnessOf, SOURCE_WORDS, type FreshSource, type Freshness as FreshRead } from '../../data/freshness';

/* ---- one clock for every tag ---- */
const BEAT_MS = 5_000;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  if (!timer && typeof window !== 'undefined') {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      subs.forEach(f => f());
    }, BEAT_MS);
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};
const getNow = () => now;

/** The shared clock, ticking every five seconds while anything reads it. */
export const useBeat = (): number => useSyncExternalStore(subscribe, getNow, getNow);

/** How fresh a reading is, re-judged on the shared beat. */
export function useFreshness(at: number | null | undefined, source: FreshSource, opts: { down?: boolean } = {}): FreshRead {
  const t = useBeat();
  /* the beat can trail a reading that just landed; never call a reading from the future stale */
  return freshnessOf({ at, source, now: Math.max(t, at ?? 0), down: opts.down });
}

interface FreshnessProps {
  /** When the reading on screen was taken (epoch ms) */
  at: number | null | undefined;
  source: FreshSource;
  /** The feed is down and trying again */
  down?: boolean;
  /** Also show the quiet "as of" stamp while the reading is fresh */
  showLive?: boolean;
  /** Words before the state ("Board") — the source's own name by default when `named` */
  named?: boolean;
  className?: string;
}

/** The tag: nothing while fresh (unless `showLive`), else stale or reconnecting with the reading's time. */
export const Freshness = ({ at, source, down = false, showLive = false, named = false, className = '' }: FreshnessProps) => {
  const f = useFreshness(at, source, { down });
  const has = at != null && at > 0;
  if (f.state === 'live' && !showLive) return null;
  if (f.state === 'unknown' && !down) return null;
  const word = f.state === 'reconnecting' ? 'Reconnecting' : f.state === 'stale' ? 'Stale' : null;
  const stamp = has ? asOfText(at as number) : 'nothing kept yet';
  const title =
    f.state === 'reconnecting'
      ? `${SOURCE_WORDS[source]} is not answering. ${has ? `What is on screen was taken ${ageWords(f.ageMs)} ago.` : ''} It tries again on its own.`
      : f.state === 'stale'
        ? `${SOURCE_WORDS[source]} has not refreshed in ${ageWords(f.ageMs)} (its window is ${ageWords(f.ttlMs)}).`
        : `${SOURCE_WORDS[source]}, taken ${ageWords(f.ageMs)} ago.`;
  const warn = f.state !== 'live';
  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      className={`inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest whitespace-nowrap ${warn ? 'text-warn' : 'text-textMuted'} ${className}`}
      data-fresh={f.state}
      data-fresh-source={source}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${warn ? 'bg-warn' : 'bg-ink/30'} ${f.state === 'reconnecting' ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
      {named && <span className="text-textSecondary">{SOURCE_WORDS[source]} ·</span>}
      {word && <span>{word} ·</span>}
      <span className="normal-case tracking-normal">{stamp}</span>
    </span>
  );
};

export default Freshness;
