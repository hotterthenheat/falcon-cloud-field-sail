/*
==================================================
  SLAYER TERMINAL - THE WORDMARK (brand/Wordmark.tsx)

  ">slayer_terminal" — the ">" and "terminal" in the muted ink,
  "slayer_" lit; with the prompt, "slayer:~ $" sits on the line
  above. His partner's, taken whole (Noah, 2026-10-03: "all of it").

  The letters are outlines (brand/wordmarkPaths.ts), not a font:
  nothing is downloaded and every machine draws the same wordmark.

  THE LIT LETTERS WEAR THE FOIL, NOT A FLAT INK (Noah, the same day:
  "keep our galaxy color if changing themes i dont want plain white
  or black"): "slayer_" is filled with the mark's five foil stops —
  holographic silver on black, the galaxy ink on paper (--foil-1…5,
  theme/tokens.css) — held still; only the S of the mark pans. The
  solid forms (print, mail) are one colour and end on the cursor.

  `typing` types it in at 28 ms a character and lands the cursor —
  the launch gate; reduced motion shows the last frame. The cursor
  blinks on the mark's beat: the same keyframes, pinned to the same
  clock (brand/brandClock.ts), so a wordmark beside a mark never
  blinks out of step with it.
==================================================
*/

import { useId, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { WORDMARK } from './wordmarkPaths';
import { alignBrandLoops } from './brandClock';

interface WordmarkProps {
  /** the letters' box height, px (ascender to descender) */
  height: number;
  /** "slayer:~ $" on the line above */
  prompt?: boolean;
  /** end on the cursor */
  cursor?: boolean;
  /** one colour, for print and mail */
  solid?: 'black' | 'white';
  /** type in at 28 ms a character */
  typing?: boolean;
  className?: string;
  style?: CSSProperties;
  /** the accessible name — "Slayer Terminal" when left out; an empty string makes it decorative */
  label?: string;
}

const STOPS: [number, string][] = [
  [0, '--foil-1'],
  [0.3, '--foil-2'],
  [0.55, '--foil-3'],
  [0.75, '--foil-4'],
  [1, '--foil-5'],
];

const Wordmark = ({ height, prompt = false, cursor = false, solid, typing = false, className = '', style, label }: WordmarkProps) => {
  const scale = height / WORDMARK.height;
  const muted = solid ? (solid === 'black' ? '#000' : '#fff') : 'rgb(var(--chevron))';
  const foilId = `wm-foil-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const still = solid ? muted : `url(#${foilId})`;
  const cursorInk = solid ? muted : 'rgb(var(--wordmark))';
  const name = label ?? 'Slayer Terminal';
  const rootRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    alignBrandLoops(rootRef.current);
  }, [cursor, solid, typing]);
  return (
    <span
      ref={rootRef}
      className={`inline-flex flex-col items-start leading-none ${className}`}
      style={style}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
      data-wordmark
    >
      {prompt && (
        <span className="font-mono mb-[0.4em] whitespace-nowrap" style={{ fontSize: Math.max(9, height * 0.36), color: muted }} aria-hidden>
          slayer:~ $
        </span>
      )}
      <span className="relative inline-block" style={{ width: (cursor ? WORDMARK.width : WORDMARK.textWidth) * scale, height }}>
        <svg
          width={WORDMARK.textWidth * scale}
          height={height}
          viewBox={`0 0 ${WORDMARK.textWidth} ${WORDMARK.height}`}
          className={typing ? 'wordmark-typing block' : 'block'}
          aria-hidden
          focusable="false"
          data-wordmark-letters
        >
          {!solid && (
            <defs>
              <linearGradient id={foilId} x1="0" y1="0" x2="1" y2="0.35">
                {STOPS.map(([at, token]) => (
                  <stop key={token} offset={at} style={{ stopColor: `rgb(var(${token}))` }} />
                ))}
              </linearGradient>
            </defs>
          )}
          <path d={WORDMARK.chevron} fill={solid ? muted : 'rgb(var(--wordmark))'} />
          <path d={WORDMARK.slayer} fill={solid ? muted : 'rgb(var(--wordmark))'} />
          <path d={WORDMARK.terminal} fill={solid ? muted : still} />
        </svg>
        {cursor && (
          <span
            className="wordmark-cursor"
            style={{ left: WORDMARK.cursorX * scale, width: WORDMARK.cursorW * scale, background: cursorInk, ...(solid ? { animation: 'none', opacity: 1 } : null) }}
            aria-hidden
          />
        )}
      </span>
    </span>
  );
};

export default Wordmark;
