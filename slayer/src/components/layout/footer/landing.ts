/* The landing footer's picture: every product on one desk, the front marks brightest; the pointer's focus and the self-driven arrow tour the panels. */

import { box, compose, cut, dim, type Box, type Part, type SceneMaker, FOOTER_LEGEND } from './kit';
import { chart, chips, crumb, ladder, panel } from './parts/chart';
import { cards } from './parts/desk';
import { alertLines, field, orders } from './parts/field';
import { tape } from './parts/tape';
import { payoff } from './parts/weigher';
import { worldMap } from './parts/world';

const inset = (b: Box, l: number, t: number, r = l, btm = t): Box => box(b.x0 + l, b.y0 + t, b.x1 - r, b.y1 - btm);

export const landing: SceneMaker = () => {
  const main = chart({ legend: FOOTER_LEGEND, levels: 3, wide: true });
  const paperCh = chart({ legend: FOOTER_LEGEND, seed: 777, candles: 2, up: 'glacier', down: 'blue', band: [0.24, 0.64], volume: false, axis: false, tag: false, gap: 3.4, kick: 1.4 });
  /* the world stands furthest back: it is drawn first, and the arrow visits it last */
  const world = dim(worldMap({ band: false, faint: 0.7 }), 0.5);
  const farAway: Part = { ...world, sights: undefined };
  const lastStop: Part = { place() {}, still() {}, sights: f => world.sights?.(f) ?? [] };
  return compose(
    [
      /* 0 · the address, the house's prompt */
      crumb('slayer:~ $ open terminal'),
      /* 1 · far back: the world, the stories breaking on it */
      farAway,
      /* 2–5 · the live chart, its strike field, the alert's bell */
      panel('Live chart'),
      main,
      field(main, { gap: 26, seed: 913 }),
      alertLines(main, { count: 1 }),
      /* 6–7 · the book: its walls named, the supreme, the flip */
      panel('The book'),
      ladder({ seed: 31, marks: true, run: false, gap: 5, share: 0.6, solid: true }),
      /* 8–9 · the tape, printing down the right */
      panel('Live tape'),
      dim(tape({ every: 760 }), 0.75),
      /* 10–11 · the setups */
      panel('Compass'),
      dim(cards({ cols: 1, rows: 2, seed: 404 }), 0.8),
      /* 12–13 · what it returns */
      panel('Weigher'),
      dim(payoff({ cycle: 22000 }), 0.8),
      /* 14–16 · a paper position */
      panel('Paper'),
      dim(paperCh, 0.8),
      dim(orders(paperCh), 0.8),
      /* 17 · on a phone, the setups' chips under the chart */
      chips({ few: true }),
      /* 18 · the arrow's last stop: a story breaking on the world */
      lastStop,
    ],
    s => {
      const b = s.box;
      const w = b.x1 - b.x0;
      const head = box(b.x0, b.y0, b.x1, b.y0 + 14);
      if (s.phone) {
        const pane = box(b.x0, b.y0 + 24, b.x0 + w * 0.6, b.y1 - 48);
        /* a phone's picture: the chart and its field, the book, the setups' chips — the world stays off so small a screen */
        return [head, null, null, pane, b, b, null, cut(b, 0.72, 0.16, 1, 0.78), null, null, null, null, null, null, null, null, null, box(b.x0 + 6, b.y1 - 18, b.x1, b.y1), null];
      }
      const pMain = cut(b, 0, 0.06, 0.56, 0.62);
      const pBook = cut(b, 0.58, 0.06, 0.785, 0.62);
      const pTape = cut(b, 0.805, 0.06, 1, 1);
      const pCards = cut(b, 0, 0.67, 0.25, 1);
      const pPay = cut(b, 0.27, 0.67, 0.52, 1);
      const pPaper = cut(b, 0.54, 0.67, 0.785, 1);
      return [
        head,
        /* the world behind the chart and the book, far back */
        cut(b, 0.08, 0.0, 0.8, 0.64),
        pMain,
        inset(pMain, 10, 24, 74, 30),
        b,
        b,
        pBook,
        box(pBook.x0 + 2, pBook.y0 + 28, pBook.x1 - 6, pBook.y1 - 12),
        pTape,
        inset(pTape, 8, 24, 8, 6),
        pCards,
        inset(pCards, 8, 24, 8, 8),
        pPay,
        inset(pPay, 8, 20, 4, 4),
        pPaper,
        box(pPaper.x0 + 8, pPaper.y0 + 24, pPaper.x1 - 8, pPaper.y1 - 8),
        b,
        null,
        b,
      ];
    },
  );
};
