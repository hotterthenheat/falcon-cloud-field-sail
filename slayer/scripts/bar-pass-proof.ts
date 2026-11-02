/* NVDA's after-hours never drew on Terrain (live, Sunday 1 Nov 2026): the history filled the chart's 1000-bar window
   first, the after-hours tape landed late, the drawn count moved by exactly one, and the data pass took that for "a new
   bar" — it updated the newest bar and left 960 after-hours bars in the store, off the chart. tailOnly
   (src/components/gex/barPass.ts) lets the pass touch only the newest bar when nothing else changed. */
import { tailOnly } from '../src/components/gex/barPass';

const fail = (m: string) => {
  throw new Error(`bar-pass-proof: ${m}`);
};
const at = (...t: number[]) => t.map(time => ({ time }));
const S = 300;
/* drawn: 1001 bars, the regular session and the pre-market, the last the after-hours print at 19:55 */
const drawn = Array.from({ length: 1000 }, (_, i) => 1_000_000 + i * S).concat([2_000_000]);
const edge = drawn[drawn.length - 1];

/* the NVDA case: the after-hours lands, the window becomes the newest 1000 (one fewer), the same newest bar */
const landed = Array.from({ length: 999 }, (_, i) => 1_200_000 + i * S).concat([edge]);
if (tailOnly(at(...landed), drawn.length, drawn[0], edge, true, false)) fail('a late session landing (count −1, same edge) was taken for a tick');
/* …and the same with the count moved by +1 and the edge the same */
if (tailOnly(at(...drawn.slice(0, -1), edge - 60, edge), drawn.length, drawn[0], edge, false, false)) fail('a bar inserted before the edge was taken for a tick');

/* a tick: the same bars, the newest one moved */
if (!tailOnly(at(...drawn), drawn.length, drawn[0], edge, false, false)) fail('a tick on the newest bar reloaded');
/* a new bar after the edge */
if (!tailOnly(at(...drawn, edge + S), drawn.length, drawn[0], edge, false, false)) fail('one new bar at the edge reloaded');
/* a held window sliding one bar: same count, first one further, the old edge second to last */
if (!tailOnly(at(...drawn.slice(1), edge + S), drawn.length, drawn[0], edge, true, false)) fail('a held window sliding one bar reloaded');
/* the same slide on a store that is not held is a change of first bar: reload */
if (tailOnly(at(...drawn.slice(1), edge + S), drawn.length, drawn[0], edge, false, false)) fail('an unheld first-bar change was taken for a tick');
/* two new bars at once: reload */
if (tailOnly(at(...drawn, edge + S, edge + 2 * S), drawn.length, drawn[0], edge, false, false)) fail('two new bars were taken for a tick');
/* a rule clock reloads on any count change, updates otherwise */
if (tailOnly(at(...drawn, edge + 7), drawn.length, drawn[0], edge, false, true)) fail('a rule clock appended by update');
if (!tailOnly(at(...drawn), drawn.length, drawn[0], edge, false, true)) fail('a rule clock tick reloaded');
/* nothing drawn yet */
if (tailOnly(at(...drawn), 0, 0, 0, false, false)) fail('a first pass was taken for a tick');

console.log('bar-pass-proof ok · a late session landing reloads; a tick or one new bar updates');
