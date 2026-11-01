/*
  The shadcn `cn` (src/components/shadcn/utils.ts) keeps Slayer's own scales: tailwind-merge reads an unknown
  `text-<word>` as a colour, so an unregistered size would be dropped the moment it met a colour. Every font size the
  config names must be registered, a size and a colour must live side by side, and a later class of one property must
  still win.
    node --import tsx scripts/cn-proof.ts
*/

import assert from 'node:assert/strict';
import config from '../tailwind.config';
import { cn, FONT_SIZES } from '../src/components/shadcn/utils';
import { buttonVariants } from '../src/components/shadcn/button';

let n = 0;
const eq = (got: string, want: string, what: string) => {
  assert.equal(got, want, what);
  n++;
};

/* every named size in the config is registered, and nothing else */
const sizes = Object.keys((config.theme?.extend as { fontSize: Record<string, unknown> }).fontSize).sort();
assert.deepEqual([...FONT_SIZES].sort(), sizes, 'utils.ts FONT_SIZES is tailwind.config.ts fontSize, key for key');
n++;

for (const s of FONT_SIZES) eq(cn(`text-${s}`, 'text-textMuted'), `text-${s} text-textMuted`, `a size (${s}) and a colour live side by side`);
eq(cn('text-t10', 'text-t12'), 'text-t12', 'the later size wins');
eq(cn('text-t10', 'text-[13px]'), 'text-[13px]', 'an arbitrary size replaces a house size');
eq(cn('text-textMuted', 'text-bull'), 'text-bull', 'the later colour wins');
eq(cn('text-textMuted text-t9', 'text-textPrimary'), 'text-t9 text-textPrimary', 'a colour override leaves the size');
eq(cn('h-7 px-2.5', 'h-6'), 'px-2.5 h-6', 'a height override');
eq(cn('font-mono text-t11', 'font-semibold'), 'font-mono text-t11 font-semibold', 'family and weight are two properties');
eq(cn('bg-ink/[0.04]', 'bg-ink/[0.06]'), 'bg-ink/[0.06]', 'a wash override');
eq(cn('border-borderSubtle', 'border-silver/50'), 'border-silver/50', 'an edge colour override');
eq(cn('animate-soft-in', 'animate-ovl-pop-in'), 'animate-ovl-pop-in', 'the later animation wins');
eq(cn('rounded-md', 'rounded-xs'), 'rounded-xs', 'the config radius step');
eq(cn('hit-24 tap-40 holo-bg foil-glide', 'px-2'), 'hit-24 tap-40 holo-bg foil-glide px-2', 'house classes pass through');
eq(cn('a', false, null, undefined, { b: true, c: false }, ['d']), 'a b d', 'clsx inputs');

/* a caller's classes win over a variant's own */
const chip = cn(buttonVariants({ variant: 'chip', size: 'sm' }), 'h-6 text-t10');
assert.ok(chip.includes('h-6') && !/\bh-7\b/.test(chip) && chip.includes('text-t10') && !chip.includes('text-t11') && chip.includes('text-textSecondary'), `button override: ${chip}`);
n++;

console.log(`cn proof: ${n} checks hold`);
