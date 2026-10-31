/* Tone maps for direction and status, as static class strings so Tailwind sees them; always pair a tone with a label or icon. */

/* crown: a black box with magenta words, the engine's top pick only. supreme: the magenta tint at chip scale.
   white: bright neutral ink (Compass process states). holo: flat silver for terminal hardware (counts, chrome). */
/* glacier and ember: the walls' (and the legs') inks — a call wall is never the sign's green, a put wall never its red */
export type Tone = 'bull' | 'bear' | 'warn' | 'select' | 'white' | 'crown' | 'supreme' | 'holo' | 'neutral' | 'glacier' | 'ember';

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
  glacier: 'bg-glacier',
  ember: 'bg-ember',
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
  glacier: 'bg-glacier/10 text-glacier border-glacier/25',
  ember: 'bg-ember/10 text-ember border-ember/25',
};

