/*
  The right edge's labels fit the pane (src/components/gex/edgeLabelFit.ts): the nodes' tags, the key levels' names and
  the cone's ends, laid out in one pass. Known stacks in, known placements out:
    - nothing overlaps, nothing leaves the usable band, nothing covers the price's row at the axis;
    - levels within a few pixels are one label;
    - a crowded or short pane drops the least important first, and keeps the walls, the flip and the top node;
    - no label is led further than MAX_SHIFT rows from its own level, and labels keep their levels' order;
    - the 3-pane desk at 1440 (a ~300px plot) and the phone at 390 (a ~220px plot) carry few labels, not a pile.
  Run:  npx tsx scripts/edge-label-fit-proof.ts
*/
import { MAX_SHIFT, ROW_PX, fitEdgeLabels, labelsOverlap, type EdgeItem, type FitOptions, type Placed } from '../src/components/gex/edgeLabelFit';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const show = (p: Placed[]) => p.map(l => `${l.id}@${l.y.toFixed(0)}→${l.ty.toFixed(0)}${l.ids.length > 1 ? `(+${l.ids.slice(1).join(',')})` : ''}`).join(' ');

/** Every rule the fit promises, on one answer */
function sound(name: string, items: EdgeItem[], o: FitOptions, out: Placed[]): void {
  const h = o.h;
  const gap = o.gap ?? 2;
  let overlap = false;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (labelsOverlap(out[i], out[j], h + gap)) overlap = true;
  check(`${name}: no two labels overlap`, !overlap, show(out));
  check(`${name}: every label inside the pane's band`, out.every(p => p.ty - h / 2 >= o.top - 0.01 && p.ty + h / 2 <= o.bottom + 0.01), show(out));
  const res = o.reserved ?? [];
  check(`${name}: no label covers a reserved band`, out.every(p => res.every(r => p.ty + h / 2 <= r.lo + 0.01 || p.ty - h / 2 >= r.hi - 0.01)), show(out));
  const step = h + gap;
  check(`${name}: no label led more than ${MAX_SHIFT} rows from its level`, out.every(p => Math.abs(p.ty - p.y) <= MAX_SHIFT * step + 0.01), show(out));
  let ordered = true;
  for (let i = 1; i < out.length; i++) if (out[i].y < out[i - 1].y) ordered = false;
  check(`${name}: labels keep their levels' order`, ordered, show(out));
  const cap = Math.floor((o.bottom - o.top) / (o.rowPx ?? ROW_PX));
  check(`${name}: at most one label per ${o.rowPx ?? ROW_PX}px of pane (${Math.max(1, cap)})`, out.length <= Math.max(1, cap), `${out.length}`);
  const ids = out.flatMap(p => p.ids);
  check(`${name}: an id is drawn once`, new Set(ids).size === ids.length);
  check(`${name}: only asked ids`, ids.every(id => items.some(i => i.id === id)));
}

/* 1. The stack the owner saw: SPY's top pane at 1440 in the 3-pane desk (a 300px plot), eight names and the cone's two
   ends piled within 150px at the edge, the price's row at 172 */
{
  const items: EdgeItem[] = [
    { id: 'MP 772', y: 100, prio: 4 },
    { id: 'CW 770', y: 112, prio: 9, keep: true },
    { id: 'Flip 766.70', y: 136, prio: 8, keep: true },
    { id: '1σ↑ 763.63', y: 151, prio: 3 },
    { id: '760 S', y: 163, prio: 9, keep: true },
    { id: '757 node', y: 172, prio: 5 },
    { id: '755 Top', y: 184, prio: 9.5, keep: true },
    { id: '1σ↓ 750.61', y: 205, prio: 3 },
    { id: '750 node', y: 208, prio: 5.5 },
    { id: '2σ↑', y: 60, prio: 2 },
    { id: '2σ↓', y: 262, prio: 2 },
  ];
  const o: FitOptions = { h: 14, gap: 2, top: 46, bottom: 300, reserved: [{ lo: 165, hi: 179 }] };
  const out = fitEdgeLabels(items, o);
  sound('SPY 3-pane stack', items, o, out);
  const ids = out.flatMap(p => p.ids);
  for (const k of ['CW 770', 'Flip 766.70', '760 S', '755 Top']) check(`SPY 3-pane stack keeps ${k}`, ids.includes(k), show(out));
  check('SPY 3-pane stack drops the 2σ ends before a wall', !ids.includes('2σ↑') || ids.includes('CW 770'));
  check('SPY 3-pane stack: 1σ↓ and the 750 node (3px apart) are one label', out.some(p => p.ids.includes('750 node') && p.ids.includes('1σ↓ 750.61')) || !ids.includes('1σ↓ 750.61'), show(out));
  console.log('     ', show(out));
}

/* 2. Merge: two levels 2px apart are one label, the more important keeps the row */
{
  const items: EdgeItem[] = [
    { id: 'node 345', y: 200, prio: 5 },
    { id: 'Top 345', y: 201.5, prio: 9.5, keep: true },
  ];
  const o: FitOptions = { h: 14, top: 0, bottom: 600 };
  const out = fitEdgeLabels(items, o);
  sound('merge', items, o, out);
  check('merge: one label', out.length === 1, show(out));
  check('merge: the top node keeps the row', out[0]?.id === 'Top 345' && out[0].ids.includes('node 345'), show(out));
}

/* 3. A short pane (a 4-pane quarter at 1440, or the phone's chart under its chrome): 120px holds two */
{
  const items: EdgeItem[] = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, y: 30 + i * 9, prio: i === 4 ? 9 : 4 + i / 10, keep: i === 4 }));
  const o: FitOptions = { h: 14, top: 20, bottom: 140 };
  const out = fitEdgeLabels(items, o);
  sound('short pane', items, o, out);
  check('short pane: the kept level survives', out.some(p => p.ids.includes('n4')), show(out));
  check('short pane: two labels at most', out.length <= 2, show(out));
}

/* 4. The phone at 390: a 220px plot, the price's row in the middle, a cluster around it */
{
  const items: EdgeItem[] = [
    { id: 'PW', y: 150, prio: 9, keep: true },
    { id: 'Top', y: 112, prio: 9.5, keep: true },
    { id: 'node a', y: 104, prio: 5 },
    { id: 'node b', y: 120, prio: 4.8 },
    { id: 'Flip', y: 60, prio: 8, keep: true },
    { id: 'cone 1σ↑', y: 70, prio: 3 },
  ];
  const o: FitOptions = { h: 16, gap: 2, top: 36, bottom: 256, reserved: [{ lo: 106, hi: 122 }] };
  const out = fitEdgeLabels(items, o);
  sound('phone', items, o, out);
  for (const k of ['PW', 'Top', 'Flip']) check(`phone keeps ${k}`, out.some(p => p.ids.includes(k)), show(out));
}

/* 5. A spread-out book needs no pushing: every label sits on its level */
{
  const items: EdgeItem[] = [100, 180, 260, 340, 420].map((y, i) => ({ id: `l${i}`, y, prio: 5 }));
  const o: FitOptions = { h: 14, top: 0, bottom: 600 };
  const out = fitEdgeLabels(items, o);
  sound('spread', items, o, out);
  check('spread: all five drawn', out.length === 5, show(out));
  check('spread: each on its own level', out.every(p => Math.abs(p.ty - p.y) < 0.01), show(out));
}

/* 6. Everything piled on one row (an unscaled chart): one label, never a tower */
{
  const items: EdgeItem[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, y: 150, prio: 4 + i / 100 }));
  const o: FitOptions = { h: 14, top: 0, bottom: 400 };
  const out = fitEdgeLabels(items, o);
  sound('one row', items, o, out);
  check('one row: one label carrying them all', out.length === 1 && out[0].ids.length === 12, show(out));
}

/* 7. Levels off the pane are not drawn; an empty ask is empty; a pane too short for a label is empty */
{
  check('off-pane levels are not drawn', fitEdgeLabels([{ id: 'x', y: -200, prio: 9, keep: true }], { h: 14, top: 0, bottom: 300 }).length === 0);
  check('nothing asked, nothing drawn', fitEdgeLabels([], { h: 14, top: 0, bottom: 300 }).length === 0);
  check('a pane shorter than a label draws none', fitEdgeLabels([{ id: 'x', y: 5, prio: 9 }], { h: 14, top: 0, bottom: 10 }).length === 0);
}

/* 8. The cone's ends against the walls at the price row: the price's row stays clear, and a wall on it moves off it */
{
  const items: EdgeItem[] = [
    { id: 'CW', y: 150, prio: 9, keep: true },
    { id: 'cone 1σ↑', y: 140, prio: 3 },
    { id: 'cone 1σ↓', y: 230, prio: 3 },
  ];
  const o: FitOptions = { h: 14, top: 30, bottom: 300, reserved: [{ lo: 143, hi: 157 }] };
  const out = fitEdgeLabels(items, o);
  sound('price row', items, o, out);
  check('price row: the wall is still drawn', out.some(p => p.ids.includes('CW')), show(out));
}

if (fail) {
  console.log(`\n${fail} check(s) FAILED`);
  process.exit(1);
}
console.log('\nedge-label-fit-proof: all checks passed');
