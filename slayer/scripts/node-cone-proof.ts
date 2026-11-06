/*
  The nodes view's cone (data/nodeCone.ts, dev-only ?nodes=heat|threads) reads the book's own 1σ — data/book/move.ts,
  proven against the market's straddles in scripts/expected-move-proof.ts — and nothing else:

  1. After the Nov 5 close, SPY's coming session (Nov 6): the cone's tip one session out IS peekMoveToClose(…, 390) and
     peekDaySigma, S·σ·√(dte/365) = 14.02 (the implied move read as a straddle said 12.05); half a session out it is
     √½ of that; the 2σ curves are twice the 1σ; the cone is symmetric and never narrows.
  2. The chart's own clocks (coneFrame): an hourly chart's "Next session" tip after the close is that 1σ; a daily
     chart's 1 day the same; three days are √3 of it — a session of variance a session.
  3. SPX, no row for the weekly: the cone takes the 1σ its own at-the-money contracts price (S·σ_ATM·√(1/252), the
     proof's $155), not the 30-day vol's $78–101.
  4. In the session (Nov 6, 12:00 ET, 240 minutes left): to today's close the cone is peekMoveToClose(…, 240) exactly;
     a two-session tip adds one full session's variance, √(toClose² + session²); the close mark sits on the curve.
  5. A book with no expected move draws no cone (the chart falls back to today's).

  Run: npx tsx scripts/node-cone-proof.ts
*/
import { freezeClock } from './golden/uwFixtures';

/* Thursday 2026-11-05, 18:40 ET: after the close, the coming session is Friday Nov 6 */
freezeClock('2026-11-05T23:40:00Z');
const { cache } = await import('../src/data/book/store');
const { emptyNode } = await import('../src/data/book/scale');
const { peekDaySigma, peekMoveToClose } = await import('../src/data/book/move');
const { bookCone, bookConeSigma, bookVariance } = await import('../src/data/nodeCone');
const { coneFrame } = await import('../src/data/terrainCone');
type Entry = import('../src/data/book/store').Entry;

let fail = 0;
const near = (what: string, got: number | null | undefined, want: number, tol: number) => {
  const ok = got != null && Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got == null ? got : got.toFixed(4)} ≈ ${want.toFixed(4)} (±${tol})`);
};
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const base = (ticker: string, spot: number, extra: Partial<Entry>): Entry => ({
  ticker,
  at: 1,
  full: true,
  wantFull: false,
  spot,
  prev: spot,
  changePct: 0,
  iv: 0,
  impliedMove: 0,
  dayMoveFrac: 0,
  all: [],
  byDate: {},
  expiries: [{ date: '2026-11-06', dte: 1 }, { date: '2026-11-20', dte: 15 }],
  flow: new Map(),
  candles: [],
  tape: [],
  history: [],
  status: 'live',
  ...extra,
});

const S = 730.3599;
const IV = 0.366751634046935;
const want1 = S * IV * Math.sqrt(1 / 365);

/* ---- 1. SPY after the close: one session out is the book's 1σ ---- */
{
  cache.set('SPYX', base('SPYX', S, { termIv: { '2026-11-06': IV }, termMove: { '2026-11-06': 9.61761161916966 }, termDte: { '2026-11-06': 1 }, termK: 0.684 }));
  const now = Date.now();
  const sig = bookConeSigma('SPYX', now);
  check(`SPY after the close: no session running (closeMin ${sig?.closeMin}), the move to the close is none`, sig?.closeMin === 0 && sig?.toClose === null);
  near('SPY: the session 1σ is peekDaySigma', sig?.session, peekDaySigma('SPYX') ?? NaN, 1e-12);
  const fc = sig ? bookCone(S, { today: 0, next: 390 }, sig, now, 5) : null;
  near('SPY: the tip one session out is S·σ·√(dte/365) (not 9.618 × √(π/2) = 12.05)', fc ? fc.sigmaNext : null, want1, 1e-9);
  near('SPY: the tip is peekMoveToClose(…, 390)', fc ? fc.points[fc.points.length - 1].up1 - S : null, peekMoveToClose('SPYX', null, 390) ?? NaN, 1e-9);
  const mid = fc?.points.find(p => p.minutesAhead === 195);
  near('SPY: half a session out is √½ of it', mid ? mid.up1 - S : null, want1 * Math.SQRT1_2, 1e-9);
  check('SPY: 2σ is twice 1σ, both sides, at every point', !!fc && fc.points.every(p => Math.abs(p.up2 - S - 2 * (p.up1 - S)) < 1e-9 && Math.abs(S - p.dn2 - 2 * (S - p.dn1)) < 1e-9 && Math.abs(p.up1 - S - (S - p.dn1)) < 1e-9));
  check('SPY: the cone never narrows', !!fc && fc.points.every((p, i) => i === 0 || p.up1 >= fc.points[i - 1].up1 - 1e-12));
  check(`SPY: it starts at the price (${fc?.points[0]?.minutesAhead}, ${fc?.points[0]?.up1})`, !!fc && fc.points[0].minutesAhead === 0 && fc.points[0].up1 === S);
  check(`SPY: the coming session is Nov 6 (${fc?.nextDay})`, fc?.nextDay === '2026-11-06');

  /* ---- 2. the chart's own clocks ---- */
  const hourly = coneFrame(60, now);
  const fh = sig ? bookCone(S, hourly, sig, now) : null;
  near(`SPY hourly "${hourly.label}" (${hourly.next} min): the tip is one session's 1σ × √(min/390)`, fh?.sigmaNext, want1 * Math.sqrt(hourly.next / 390), 1e-9);
  const daily = coneFrame(1440, now);
  const fd = sig ? bookCone(S, daily, sig, now) : null;
  near(`SPY daily "${daily.label}": the tip is one session's 1σ`, fd?.sigmaNext, want1, 1e-9);
  const three = coneFrame(3 * 1440, now);
  const f3 = sig ? bookCone(S, three, sig, now) : null;
  near(`SPY "${three.label}": √3 sessions of it`, f3?.sigmaNext, want1 * Math.sqrt(3), 1e-9);
}

/* ---- 3. SPX: its own contracts price the weekly ---- */
{
  const X = 7335;
  const node = (strike: number, callIv: number, putIv: number) => ({ ...emptyNode(strike), callIv, putIv });
  const chain = [node(7325, 0.2575, 0.4022), node(7330, 0.2746, 0.4133), node(7335, 0.2943, 0.376), node(7340, 0.2553, 0.3824), node(7345, 0.2554, 0.4107)];
  cache.set('SPXX', base('SPXX', X, { iv: 0.2166, termIv: { '2026-11-20': 0.240905864732588 }, byDate: { '2026-11-06': chain }, factsDates: new Set(['2026-11-06']) }));
  const want = X * ((0.2943 + 0.376) / 2) * Math.sqrt(1 / 252);
  const now = Date.now();
  const sig = bookConeSigma('SPXX', now);
  const fc = sig ? bookCone(X, { today: 0, next: 390 }, sig, now) : null;
  near("SPX Nov 6: the cone's session tip is its own contracts' S·σ_ATM·√(1/252) (the 30-day vol said $78–101)", fc?.sigmaNext, want, 1e-9);
  check(`SPX: that is over $150 (${fc?.sigmaNext.toFixed(2)})`, (fc?.sigmaNext ?? 0) > 150);
}

/* ---- 5. no expected move, no cone ---- */
{
  cache.set('NONE', base('NONE', 100, {}));
  check('a book with no expected move: no book sigma (the chart keeps its own cone)', bookConeSigma('NONE') === null);
  check('no spot: no cone', bookCone(0, { today: 0, next: 390 }, { closeMin: 0, toClose: null, session: 1 }, Date.now()) === null);
}

/* ---- 4. in the session: Friday Nov 6, 12:00 ET, 240 minutes to the close ---- */
freezeClock('2026-11-06T17:00:00Z');
{
  const move = 6.1;
  cache.set('SPYD', base('SPYD', S, { termMove: { '2026-11-06': move }, termK: 0.684, dayIv: IV, expiries: [{ date: '2026-11-06', dte: 0 }, { date: '2026-11-09', dte: 3 }] }));
  const now = Date.now();
  const sig = bookConeSigma('SPYD', now);
  check(`Nov 6 noon: 240 minutes to the close (${sig?.closeMin})`, sig?.closeMin === 240);
  const toClose = peekMoveToClose('SPYD', null, 240);
  const session = peekDaySigma('SPYD');
  near("noon: the move to the close is the same-day expiry's own (implied ÷ k)", toClose, move / 0.684, 1e-9);
  near('noon: one session is the 1-day vol, S·σ_1d·√(1/365)', session, S * IV * Math.sqrt(1 / 365), 1e-9);
  const toTheClose = sig ? bookCone(S, { today: 0, next: 240 }, sig, now) : null;
  near('noon: the cone to the close is peekMoveToClose(…, 240)', toTheClose?.sigmaNext, toClose ?? NaN, 1e-9);
  const thirty = sig ? bookCone(S, coneFrame(1, now), sig, now) : null;
  near('noon, a 1-minute chart (30 minutes): toClose × √(30/240)', thirty?.sigmaNext, (toClose ?? 0) * Math.sqrt(30 / 240), 1e-9);
  const two = coneFrame(120, now);
  const fc = sig ? bookCone(S, two, sig, now) : null;
  check(`noon, a 2-hour chart: "${two.label}", today ${two.today}, tip ${two.next}`, two.today === 240 && two.next === 240 + 390);
  near("the close mark is today's move to the close", fc?.sigmaToday, toClose ?? NaN, 1e-9);
  const atClose = fc?.points.find(p => p.minutesAhead === 240);
  near('…and sits on the curve', atClose ? atClose.up1 - S : null, toClose ?? NaN, 1e-9);
  near('the tip adds one full session: √(toClose² + session²)', fc?.sigmaNext, Math.sqrt((toClose ?? 0) ** 2 + (session ?? 0) ** 2), 1e-9);
  near('bookVariance at the tip is the same sum', sig ? Math.sqrt(bookVariance(sig, 630)) : null, Math.sqrt((toClose ?? 0) ** 2 + (session ?? 0) ** 2), 1e-9);
  check(`the next session after Friday is Monday Nov 9 (${fc?.nextDay})`, fc?.nextDay === '2026-11-09');
  check('in the session the cone never narrows across the close', !!fc && fc.points.every((p, i) => i === 0 || p.up1 >= fc.points[i - 1].up1 - 1e-12));
}

if (fail) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\nthe nodes view\'s cone reads the book\'s 1σ');
