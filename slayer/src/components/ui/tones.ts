/*
  Shared tone maps for direction and status colour, as static class strings so Tailwind sees them.
  A tone is never the only signal: always pair it with a label or icon.
*/

/* crown: a black box with magenta words, the engine's top pick only. supreme: the magenta tint at chip scale.
   white: bright neutral ink (Compass process states). holo: flat silver for terminal hardware (counts, chrome). */
export type Tone = 'bull' | 'bear' | 'warn' | 'select' | 'white' | 'crown' | 'supreme' | 'holo' | 'neutral';

export const toneText: Record<Tone, string> = {
  bull: 'text-bull',
  bear: 'text-bear',
  warn: 'text-warn',
  select: 'text-select',
  white: 'text-textPrimary',
  crown: 'text-supreme',
  supreme: 'text-supreme',
  holo: 'holo-text',
  neutral: 'text-textPrimary',
};

export const toneDot: Record<Tone, string> = {
  bull: 'bg-bull',
  bear: 'bg-bear',
  warn: 'bg-warn',
  /* the live dot in the badge's own ink — silver in the glow, near-black on the highlighter */
  select: 'bg-current',
  white: 'bg-textPrimary',
  crown: 'bg-supreme',
  supreme: 'bg-supreme',
  holo: 'holo-bg',
  neutral: 'bg-textMuted',
};

export const toneBadge: Record<Tone, string> = {
  bull: 'bg-bull/10 text-bull border-bull/20',
  bear: 'bg-bear/10 text-bear border-bear/20',
  warn: 'bg-warn/10 text-warn border-warn/20',
  /* the live signal uses the --live-* tokens (index.css .tone-live): a glow on dark, a highlighter on paper */
  select: 'tone-live',
  /* Bright neutral — a rank BELOW the silvers: solid white ink, whisper tint.
     Compass process states wear this so the TOP PICK foil owns the shine. */
  white: 'bg-ink/[0.07] text-textPrimary border-ink/25',
  /* the crown: the darkest surface carrying the magenta ink, findable without a filled card */
  crown: 'bg-panel text-supreme border-supreme/40',
  /* Supreme at chip scale — the standout family's tint+ink+border grammar. */
  supreme: 'bg-supreme/10 text-supreme border-supreme/25',
  /* Holo is tinted flat silver (#C7D3E8), like every other tone's badge, so a count never outranks the nav above it.
     Not .holo-text: background-clip:text would clip the chip's tint to the glyphs. */
  holo: 'bg-silver/[0.09] text-silver border-silver/25',
  neutral: 'bg-ink/[0.04] text-textSecondary border-borderSubtle',
};

export const toneBar: Record<Tone, string> = {
  // The accent needs its luminance — element-level select never below /90
  bull: 'bg-bull/90',
  bear: 'bg-bear/80',
  warn: 'bg-warn/70',
  select: 'bg-select/70',
  white: 'bg-ink/70',
  crown: 'bg-supreme/90',
  supreme: 'bg-supreme/70',
  holo: 'holo-bar',
  neutral: 'bg-ink/20',
};
