/*
  Which strikes the exposure nodes draw (src/components/gex/nodeStrikes.ts): a strike at NODE_SHARE of the largest in
  view or more, the largest NODE_CAP of those, and the call wall, the put wall, the flip and the pin whatever their size.
  Known books in, known strikes out: Friday Oct 30 2026's SPY and QQQ books as the chart read them at the close (the
  flow model, $M per 1% move, dealer sign, the strikes in a 15-minute chart's view), a book with nothing in it, a book
  one strike owns, a book with every strike under the cut, and the cap.
  Run:  npx tsx scripts/node-strikes-proof.ts
*/
import { NODE_CAP, NODE_SHARE, selectNodeStrikes, type KeptLevel, type StrikeRow } from '../src/components/gex/nodeStrikes';

let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? ` — ${detail}` : ''}`);
};
const book = (pairs: [number, number][]): StrikeRow[] => pairs.map(([strike, m]) => ({ strike, value: m * 1e6 }));
const prices = (k: KeptLevel[]) => k.map(l => Math.round(l.price * 100) / 100);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const show = (k: KeptLevel[]) => k.map(l => `${l.price.toFixed(2)}${l.roles.length ? `[${l.roles.join(',')}]` : ''}${l.big ? '' : '*'}`).join(' ');

/* SPY, Fri Oct 30 2026, at the close: walls 770 / 760, flip 766.70, the pin (the supreme) 760 */
const SPY = book([
  [746, -108.2], [747, -80.5], [748, -181.5], [749, -59.7], [750, -1872.6], [751, -157.9], [752, -341.1], [753, -328.5],
  [754, -515.5], [755, -3079.0], [756, -1654.4], [757, 1392.6], [758, 211.8], [759, 643.5], [760, -2328.8], [761, -180.4],
  [762, -226.5], [763, -86.4], [764, -79.9], [765, -575.1], [766, -65.3], [767, -465.6], [768, -71.7], [769, -5.8],
  [770, -226.5], [771, -21.0], [772, -23.4], [773, 17.8], [774, 13.3], [775, 114.3], [776, 80.1], [777, 7.4], [778, 66.7], [779, 16.7],
]);
const SPY_ANCHORS = { callWall: 770, putWall: 760, flip: 766.6974833970821, pin: 760 };

/* QQQ, the same close: one strike (690) holds nearly everything; walls 725 / 695, flip 709.82, the pin 695 */
const QQQ = book([
  [672, -0.3], [673, 1.9], [674, -1.0], [675, -615.5], [676, 5.5], [677, -14.2], [678, -15.9], [679, -6.6], [680, -1120.1],
  [681, -39.4], [682, -13.2], [683, -29.5], [684, -10.9], [685, -417.5], [686, -78.3], [687, -32.5], [688, -42.1], [689, -70.8],
  [690, -6904.0], [691, -609.8], [692, -438.4], [693, -362.2], [694, 199.0], [695, -791.2], [696, -207.0], [697, -13.3],
  [698, 36.4], [699, 6.1], [700, -1057.4], [701, -32.9], [702, -9.6], [703, -24.0], [704, -8.2], [705, -147.5], [706, -12.6],
  [707, -27.6], [708, -65.3], [709, -16.4], [710, -326.6], [711, -9.7], [712, -40.1], [713, -377.4], [714, -22.2], [715, -72.9],
  [716, 2.2], [717, -35.8], [718, -7.7], [719, -1.6], [720, -171.0], [721, 4.0], [722, -9.0], [723, -12.4], [724, -3.5], [725, -11.5],
]);
const QQQ_ANCHORS = { callWall: 725, putWall: 695, flip: 709.8200995209847, pin: 695 };

check('the cut starts at a fifth of the largest strike, eight at most', NODE_SHARE === 0.2 && NODE_CAP === 8);

{
  const k = selectNodeStrikes(SPY, SPY_ANCHORS);
  console.log(`     SPY: ${show(k)}`);
  check('SPY: 750 755 756 757 759 760 for their size, then the flip and the call wall', same(prices(k), [750, 755, 756, 757, 759, 760, 766.7, 770]), show(k));
  const big = k.filter(l => l.big).length;
  check('SPY: a normal book draws 4–8 levels for their size', big >= 4 && big <= 8, `${big}`);
  check('SPY: 760 is the put wall and the pin, drawn once', k.filter(l => l.price === 760).length === 1 && k.find(l => l.price === 760)!.roles.join() === 'putWall,pin');
  check('SPY: the call wall (7% of the top) and the flip ride on the anchors', !k.find(l => l.price === 770)!.big && k.find(l => l.price === 770)!.roles[0] === 'callWall' && Number.isNaN(k.find(l => l.roles.includes('flip'))!.value));
  check('SPY: 765 (19%) is not drawn; it stays in the rail', !k.some(l => l.price === 765));
  check('SPY: shares are against the largest in view', Math.abs(k.find(l => l.price === 755)!.share - 1) < 1e-12 && Math.abs(k.find(l => l.price === 759)!.share - 643.5 / 3079) < 1e-9);
}
{
  const k = selectNodeStrikes(QQQ, QQQ_ANCHORS);
  console.log(`     QQQ: ${show(k)}`);
  check('QQQ: 690 for its size, then the put wall and pin 695, the flip, the call wall', same(prices(k), [690, 695, 709.82, 725]), show(k));
}
{
  check('an empty book draws nothing', selectNodeStrikes([], {}).length === 0);
  const k = selectNodeStrikes([], { callWall: 600, putWall: 580, flip: 590.5 });
  check('an empty book with named levels draws just the names, unsized', same(prices(k), [580, 590.5, 600]) && k.every(l => !l.big && l.share === 0 && Number.isNaN(l.value)), show(k));
  check('a book of zeros and gaps draws nothing', selectNodeStrikes(book([[100, 0], [101, NaN], [102, 0]])).length === 0);
}
{
  const dom = book([[95, 12], [96, -30], [97, 4000], [98, -25], [99, 60], [100, -18]]);
  const k = selectNodeStrikes(dom);
  check('one dominant strike: it alone is drawn', same(prices(k), [97]) && k[0].share === 1, show(k));
  const k2 = selectNodeStrikes(dom, { callWall: 99, putWall: 95, flip: 96.4, pin: 97 });
  check('one dominant strike with its names: the walls and the flip join it, the pin is it', same(prices(k2), [95, 96.4, 97, 99]) && k2.find(l => l.price === 97)!.roles.join() === 'pin' && k2.find(l => l.price === 97)!.big, show(k2));
}
{
  /* everything under the cut: a view panned into a quiet stretch of the chain, the book's big strikes off screen — the
     host's floor (half the book's largest, 1,500 here) is what the cut is measured against, and nothing in view reaches
     a fifth of it */
  const flat = book([[50, 10], [51, -12], [52, 11], [53, -9], [54, 10]]);
  const k = selectNodeStrikes(flat, { callWall: 54, putWall: 50, flip: 51.6, pin: 52 }, { floor: 1500e6 });
  check('everything under the cut: only the anchors show', same(prices(k), [50, 51.6, 52, 54]) && k.every(l => !l.big), show(k));
  check('everything under the cut: the anchors keep their size where the book has one', k.find(l => l.price === 52)!.value === 11e6 && Math.abs(k.find(l => l.price === 52)!.share - 11 / 1500) < 1e-12);
  check('the floor only ever raises the cut: under the view\'s own largest it changes nothing', same(prices(selectNodeStrikes(SPY, SPY_ANCHORS, { floor: 1000e6 })), prices(selectNodeStrikes(SPY, SPY_ANCHORS))));
  const half = selectNodeStrikes(SPY, {}, { floor: 3 * 3079e6 });
  check('a floor three times the view\'s largest: only the strikes at a fifth of it stay (750 755 760)', same(prices(half), [750, 755, 760]), show(half));
  const out = selectNodeStrikes(flat, { callWall: 54, putWall: 50, flip: 51.6, pin: 52 }, { floor: 1500e6, lo: 51, hi: 53 });
  check('an anchor outside the view is not drawn', same(prices(out), [51.6, 52]), show(out));
}
{
  /* a wide, even book: the cap keeps the eight largest, the anchors on top */
  const wide = book(Array.from({ length: 20 }, (_, i) => [400 + i, (i % 2 ? -1 : 1) * (100 + i * 10)] as [number, number]));
  const k = selectNodeStrikes(wide, { callWall: 401, putWall: 400 });
  const big = k.filter(l => l.big).map(l => l.price);
  check('the cap: eight drawn for their size, the largest ones', same(big, [412, 413, 414, 415, 416, 417, 418, 419]), big.join(' '));
  check('the cap: the anchors ride on top of it', k.length === 10 && k[0].price === 400 && k[1].price === 401);
  const tie = selectNodeStrikes(book([[10, 5], [11, -5], [12, 5]]), {}, { cap: 2 });
  check('equal sizes: the lower strikes win, whatever the order handed in', same(prices(tie), [10, 11]) && same(prices(selectNodeStrikes(book([[12, 5], [11, -5], [10, 5]]), {}, { cap: 2 })), [10, 11]));
  check('the result runs lowest price first', k.every((l, i) => i === 0 || k[i - 1].price < l.price));
}

console.log(fail ? `\n${fail} FAILED` : '\nnode strikes: all ok');
process.exit(fail ? 1 : 0);
