/*
  Pinpoint's expected move (data/book/move.ts) against the market's straddle — the 2026-11-05 audit.

  1. The vendor's implied move is k·S·σ·√(dte/365), k ≈ 0.68 — about 0.85 of the at-the-money straddle, not the straddle.
     SPY after the Nov 5 close, Nov 6 row: vol 0.366751634046935, dte 1, implied_move 9.61761161916966; the 730/731
     straddle mid at 730.36 is 11.473 (7.155 + 4.39 at 730, 6.56 + 4.785 at 731). Reading the implied move as the
     straddle put 1σ at 9.618 × √(π/2) = 12.05; S·σ·√(dte/365) = 730.36 · 0.36675 · √(1/365) = 14.02, whose straddle
     (× √(2/π)) is 11.19, 2.5% from the mid where 9.618 was 16% short.
  2. A date with no row of its own (SPX, NDX and RUT print only their AM monthlies) read the 30-day vol: SPX for Nov 6
     at 7335, 30-day 0.2166 → 1σ $78 to the close and $101 a session, while its own at-the-money contracts (7330/7335/7340,
     call ~0.29 and put ~0.38 on the trading clock) price ~$155 — the 7335 straddle's last trades, 64.22 + 59.10, are a
     $154.5 1σ. The date's own contracts now price it.

  Run: npx tsx scripts/expected-move-proof.ts
*/
import { freezeClock } from './golden/uwFixtures';

/* Thursday 2026-11-05, 18:40 ET: after the close, the coming session is Friday Nov 6 */
freezeClock('2026-11-05T23:40:00Z');
const { cache } = await import('../src/data/book/store');
const { emptyNode } = await import('../src/data/book/scale');
const { peekScopeMove, peekDaySigma, peekMoveToClose } = await import('../src/data/book/move');
const { STRADDLE_K } = await import('../src/data/expectedMove');
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

/* ---- 1. SPY: the row's own vol on its own clock, not the implied move read as a straddle ---- */
{
  const S = 730.3599;
  cache.set('SPYX', base('SPYX', S, {
    termIv: { '2026-11-06': 0.366751634046935 },
    termMove: { '2026-11-06': 9.61761161916966 },
    termDte: { '2026-11-06': 1 },
    termK: 0.684,
  }));
  const want = S * 0.366751634046935 * Math.sqrt(1 / 365);
  const m = peekScopeMove('SPYX');
  near('SPY Nov 6: 1σ = S·σ·√(dte/365) off the row (not 9.618 × √(π/2) = 12.05)', m?.move, want, 1e-9);
  near('SPY Nov 6: its straddle is the market\'s 730/731 mid 11.473 within 3%', (m?.straddle ?? 0) / 11.473, 1, 0.03);
  near('SPY Nov 6: one session before the open is the same 1σ', peekDaySigma('SPYX'), want, 1e-9);
  near('SPY Nov 6: to the close, outside the session, the full session', peekMoveToClose('SPYX', null, 390), want, 1e-9);
  /* a row with an implied move but no vol: the move ÷ the vendor's k */
  cache.set('SPYK', base('SPYK', S, { termMove: { '2026-11-06': 9.61761161916966 }, termK: 0.684 }));
  near('SPY Nov 6 without a vol: implied move ÷ k', peekScopeMove('SPYK')?.move, 9.61761161916966 / 0.684, 1e-9);
}

/* ---- 2. SPX: no row for the weekly; its own contracts price it, not the 30-day vol ---- */
{
  const S = 7335;
  const node = (strike: number, callIv: number, putIv: number) => ({ ...emptyNode(strike), callIv, putIv });
  /* the painted Nov 6 vols at 16:15 (trading clock), as the book read them after the Nov 5 close */
  const chain = [node(7325, 0.2575, 0.4022), node(7330, 0.2746, 0.4133), node(7335, 0.2943, 0.376), node(7340, 0.2553, 0.3824), node(7345, 0.2554, 0.4107)];
  cache.set('SPXX', base('SPXX', S, {
    iv: 0.2166,
    termIv: { '2026-11-20': 0.240905864732588 },
    byDate: { '2026-11-06': chain },
    factsDates: new Set(['2026-11-06']),
  }));
  const atm = (0.2943 + 0.376) / 2;
  /* after hours Thursday → Friday's close: one whole session on the trading clock */
  const want = S * atm * Math.sqrt(1 / 252);
  const m = peekScopeMove('SPXX');
  check(`SPX Nov 6: priced off its own contracts (source ${m?.source}), not the 30-day vol`, m?.source === 'contracts');
  near('SPX Nov 6: 1σ = S·σ_ATM·√(1/252) off its own contracts (the 30-day vol said $78)', m?.move, want, 1e-9);
  near('SPX Nov 6: that 1σ is the 7335 straddle\'s last trades ×√(π/2), $154.5, within 3%', (m?.move ?? 0) / ((64.22 + 59.1) * Math.sqrt(Math.PI / 2)), 1, 0.03);
  near('SPX Nov 6: one session is the same (the cone and the corridor; the 30-day vol said $101)', peekDaySigma('SPXX'), want, 1e-9);
  /* before the date's contracts are in, the 30-day vol still stands in */
  cache.set('SPXW0', base('SPXW0', S, { iv: 0.2166, byDate: { '2026-11-06': chain } }));
  check(`SPX Nov 6 before its contracts are read: the 30-day vol stands in (${peekScopeMove('SPXW0')?.source})`, peekScopeMove('SPXW0')?.source === 'iv30');
  /* a monthly with its own row still reads it: the straddle its vol prices, √(2/π)·S·σ·√T_calendar */
  const mo = peekScopeMove('SPXX', '2026-11-20');
  check(`SPX Nov 20 reads its own row's vol (${mo?.source})`, mo?.source === 'fitted');
  near('SPX Nov 20: straddle = √(2/π)·S·σ·√T_cal (no vendor k on a straddle)', (mo?.straddle ?? 0) / (STRADDLE_K * S * 0.240905864732588), Math.sqrt(((Date.parse('2026-11-20T21:00:00Z') - Date.parse('2026-11-05T23:40:00Z')) / 60_000) / 525_600), 1e-6);
}

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
