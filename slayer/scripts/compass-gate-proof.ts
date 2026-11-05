/*
  Compass's entry gate on each root's own tape (audit 2026-11-05, A5–A7), and that a regular full day's gate is what
  it was.
    A6  a root's curb ends where its options stop: SPX, SPXW, XSP and VIX at 17:00 (flat 16:55); RUT, RUTW, NDX, NDXP
        and the 16:15 names (SPY, NVDA, SLV…) at 16:15 (flat 16:10); every other name at 16:00 (no curb). It used to
        run every root to 17:00, so SPY or RUTW took entries 16:00–16:54 with a 16:55 flat on a tape that stops 16:15.
    A7  a holiday morning with Global Trading Hours (Thanksgiving 2026-11-26, GTH to 11:30) is the overnight session
        to 11:25, from the session module's window (windowAt): at 10:00, 85 minutes to the flat, not the next day's
        regular session with 175.
    A5  Book C's gate is the session's own window: 12:20–12:50 on a 13:00 close, as the scan sweeps it (the scorer
        stayed at 15:20, so the 12:20 sweep was marked done and called nothing).
  Identity: every scanned minute of the regular session 2026-10-29 (20:15 the evening before to 20:15) and every root
  of the scan, the gate (entryTimeOk, minutesToFlat, sessionKindOf) against a frozen copy of the gate before the fix
  (legacyTapeSession below): the same answer everywhere except a 16:00 or 16:15 root after its own options close.
  Run: npx tsx scripts/compass-gate-proof.ts
*/

import { nyWallTime } from '../src/core/nyTime';
import { REGULAR_OPEN_MIN } from '../src/core/session';
import { ALL } from '../src/data/compassScan';
import { optionScanOpen, tapeClockOf } from '../src/data/compassSession';
import { FLAT_T, OVERNIGHT_ROOTS, entryTimeOk, flatTOf, inLottery, minutesToFlat, sessionKindOf, type TapeSession } from '../src/data/compassParams';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failed += 1;
};
const tOf = (h: number, m: number) => h * 60 + m - REGULAR_OPEN_MIN;
const gate = (root: string, ms: number, flatT = FLAT_T) => {
  const at = new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const [h, m] = at.split(':').map(Number);
  const t = tOf(h, m);
  const on = OVERNIGHT_ROOTS.includes(root);
  const clock = tapeClockOf(root, ms);
  return { t, ok: entryTimeOk(t, flatT, on, clock), left: minutesToFlat(t, flatT, on, clock), kind: sessionKindOf(t, flatT, on, clock) };
};

/* ---- the gate before the fix, frozen (compassParams.tapeSession at 6f886cb) ---- */
function legacyTapeSession(minuteOfDay: number, overnightRoot: boolean, closeMin: number | null = null): { kind: TapeSession; since: number; left: number } | null {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const full = REGULAR_OPEN_MIN + 390;
  const close = closeMin != null && closeMin < full ? closeMin : full;
  const halt = 9 * 60 + 25;
  const preFlat = halt - 5;
  if (m >= 20 * 60 + 15 || m < halt) {
    if (overnightRoot) {
      const since = m >= 20 * 60 + 15 ? m - (20 * 60 + 15) : m + 1440 - (20 * 60 + 15);
      return { kind: 'overnight', since, left: m >= 20 * 60 + 15 ? 1440 - m + preFlat : preFlat - m };
    }
    if (m >= 7 * 60 + 30 && m < halt) return { kind: 'pre', since: m - (7 * 60 + 30), left: preFlat - m };
    return null;
  }
  if (m < REGULAR_OPEN_MIN) return null;
  if (m < close) return { kind: 'regular', since: m - REGULAR_OPEN_MIN, left: close - 5 - m };
  if (close === full && m < 17 * 60) return { kind: 'curb', since: m - close, left: 17 * 60 - 5 - m };
  return null;
}
const legacy = (t: number, flatT: number, on: boolean) => {
  const w = legacyTapeSession(t + REGULAR_OPEN_MIN, on, flatT + 5 + REGULAR_OPEN_MIN);
  return { ok: !!w && w.left > 0, left: w ? w.left : NaN, kind: w?.kind ?? null };
};

/* ---- A6: the curb ends at the root's own close ---- */
const thu = (h: number, m: number) => nyWallTime(2026, 10, 29, h, m);
{
  const spy = gate('SPY', thu(16, 5));
  check('SPY 16:05 (0DTE tape to 16:15): an entry, 5 minutes to a 16:10 flat (was 50, a 16:55 flat)', spy.ok && spy.left === 5 && spy.kind === 'curb', spy);
  const nvda = gate('NVDA', thu(16, 10));
  check('NVDA 16:10: the flat itself, no entry (was an entry with 45 minutes left)', !nvda.ok && nvda.left === 0, nvda);
  const rutw = gate('RUTW', thu(16, 10));
  check('RUTW 16:10 (RUT closes 16:15): no entry, at its flat', !rutw.ok && rutw.left === 0, rutw);
  const rutw2 = gate('RUTW', thu(16, 20));
  check('RUTW 16:20: outside its tape (was the curb, 35 minutes left)', !rutw2.ok && Number.isNaN(rutw2.left) && rutw2.kind === null, rutw2);
  const ndxp = gate('NDXP', thu(16, 5));
  check('NDXP 16:05: 5 minutes to 16:10', ndxp.ok && ndxp.left === 5, ndxp);
  const ko = gate('KO', thu(16, 5));
  check('KO 16:05 (closes 16:00): no session', !ko.ok && ko.kind === null, ko);
  const spxw = gate('SPXW', thu(16, 30));
  check('SPXW 16:30: the curb to 17:00, 25 minutes to 16:55 (unchanged)', spxw.ok && spxw.left === 25 && spxw.kind === 'curb', spxw);
  const vix = gate('VIX', thu(16, 50));
  check('VIX 16:50: 5 minutes to 16:55 (unchanged)', vix.ok && vix.left === 5, vix);
  const ends = ['SPX', 'RUT', 'SPY', 'NVDA', 'SLV', 'KO'].map(r => tapeClockOf(r, thu(12, 0)).curbEnd);
  check('the tape clock: SPX 17:00, RUT 16:15, SPY 16:15, NVDA 16:15, SLV 16:15, KO 16:00', ends.join() === [17 * 60, 16 * 60 + 15, 16 * 60 + 15, 16 * 60 + 15, 16 * 60 + 15, 16 * 60].join(), ends);
}

/* ---- A7: a holiday morning's Global Trading Hours ---- */
{
  const thx = nyWallTime(2026, 11, 26, 10, 0);
  const flat = flatTOf(13 * 60);
  const g = gate('SPXW', thx, flat);
  check('Thanksgiving 10:00 SPXW (GTH to 11:30): overnight, 85 minutes to the 11:25 flat (was regular, 175)', g.ok && g.left === 85 && g.kind === 'overnight', g);
  check('…the tape clock is the session module\'s window: GTH ends 11:30', tapeClockOf('SPXW', thx).gthEnd === 11 * 60 + 30);
  const late = gate('SPXW', nyWallTime(2026, 11, 26, 11, 25), flat);
  check('Thanksgiving 11:25: the flat, no entry', !late.ok && late.left === 0, late);
  const after = gate('SPXW', nyWallTime(2026, 11, 26, 12, 0), flat);
  check('Thanksgiving 12:00: nothing trades (was the regular session)', !after.ok && after.kind === null, after);
  const sat = gate('SPY', nyWallTime(2026, 10, 31, 12, 0));
  check('a Saturday noon: nothing trades', !sat.ok && sat.kind === null, sat);
  const eve = gate('XSP', nyWallTime(2026, 11, 25, 21, 0), flat);
  check('the evening before (Wed 21:00): overnight to the holiday 11:25, 865 minutes', eve.ok && eve.left === 1440 - 21 * 60 + 11 * 60 + 25, eve);
  const halt = gate('SPXW', nyWallTime(2026, 11, 26, 9, 27), flat);
  check('Thanksgiving 09:27: GTH runs through, no halt that morning', halt.ok && halt.kind === 'overnight', halt);
  const normal = tapeClockOf('SPXW', thu(2, 0));
  check('a normal night: GTH ends 09:25 (the gate as before)', normal.gthEnd === 9 * 60 + 25, normal);
}

/* ---- A5: Book C's window on an early close ---- */
check('Book C on a 13:00 close: 12:20:15 in, 12:49:59 in, 12:50:00 out, 15:20:15 out', [inLottery(12 * 60 + 20, 15, 780), inLottery(12 * 60 + 49, 59, 780), inLottery(12 * 60 + 50, 0, 780), inLottery(15 * 60 + 20, 15, 780)].join() === 'true,true,false,false');
check('Book C on a full day: 15:20:00–15:49:59 (unchanged, null or 16:00)', [inLottery(15 * 60 + 20, 0), inLottery(15 * 60 + 49, 59, null), inLottery(15 * 60 + 50, 0, 16 * 60), inLottery(12 * 60 + 20, 15)].join() === 'true,true,false,false');
{
  /* the scorer's own gate: a 0DTE contract quoted at 12:20 on Friday 2026-11-27 (13:00 close) is a Book C call */
  const { scoreLottery, currentPicks } = await import('../src/data/compassModel');
  const at = nyWallTime(2026, 11, 27, 12, 20) + 15_000;
  const setup = { id: 'SPY-680-C-top-setups-odte', ticker: 'SPY', contract: 'SPY 680C', strike: 680, right: 'C', expiryDate: '2026-11-27', bid: 0.5, ask: 0.52, mid: 0.51, spot: 680, quotedAt: at - 5000, sleeve: 'odte' };
  await scoreLottery([setup as never], at, false);
  const got = currentPicks().filter(s => s.band === 'lottery').map(s => s.contract);
  check('scoreLottery at 12:20:15 on a 13:00 close calls it (was: no call, gate fixed at 15:20)', got.includes('SPY 680C'), got);
}

/* ---- identity: a regular full day, every scanned minute and root ---- */
{
  let compared = 0;
  let moved = 0;
  const diff: string[] = [];
  const allowed: string[] = [];
  const from = nyWallTime(2026, 10, 28, 20, 15);
  const to = nyWallTime(2026, 10, 29, 20, 15);
  for (const root of ALL) {
    const on = OVERNIGHT_ROOTS.includes(root);
    const curbEnd = tapeClockOf(root, thu(12, 0)).curbEnd ?? 17 * 60;
    for (let ms = from; ms < to; ms += 60_000) {
      if (!optionScanOpen(root, 0, ms) && !optionScanOpen(root, 1, ms)) continue;
      const g = gate(root, ms);
      const was = legacy(g.t, FLAT_T, on);
      compared += 1;
      const same = g.ok === was.ok && g.kind === was.kind && (g.left === was.left || (Number.isNaN(g.left) && Number.isNaN(was.left)));
      if (same) continue;
      const minute = g.t + REGULAR_OPEN_MIN;
      /* the only change: after this root's own close, where the curb now ends with its options */
      if (curbEnd < 17 * 60 && minute >= 16 * 60 && minute < 17 * 60 && (g.kind === null || g.left === curbEnd - 5 - minute)) {
        moved += 1;
        if (allowed.length < 4) allowed.push(`${root} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')} left ${was.left}→${g.left}`);
        continue;
      }
      if (diff.length < 8) diff.push(`${root} t ${g.t}: ${JSON.stringify(was)} → ${JSON.stringify(g)}`);
    }
  }
  check(`2026-10-29, ${ALL.length} roots: every scanned minute's gate as before, but for a 16:00/16:15 root after its close`, compared > 10_000 && diff.length === 0, diff.length ? diff.join('; ') : `${compared} root-minutes, ${moved} moved (${allowed.join(', ')})`);
  /* the regular session itself (09:30 to 16:00) never moved */
  let regular = 0;
  for (const root of ALL) {
    const on = OVERNIGHT_ROOTS.includes(root);
    for (let m = REGULAR_OPEN_MIN; m < 16 * 60; m++) {
      const g = gate(root, thu(Math.floor(m / 60), m % 60));
      const was = legacy(g.t, FLAT_T, on);
      if (g.ok !== was.ok || g.left !== was.left || g.kind !== was.kind) regular += 1;
    }
  }
  check('09:30–16:00 on 2026-10-29: no root\'s gate moved', regular === 0, `${regular} differ`);
  /* an early close day's regular session: unchanged too */
  let early = 0;
  for (const root of ALL) {
    const on = OVERNIGHT_ROOTS.includes(root);
    for (let m = REGULAR_OPEN_MIN; m < 13 * 60 + 15; m++) {
      const g = gate(root, nyWallTime(2026, 11, 27, Math.floor(m / 60), m % 60), flatTOf(780));
      const was = legacy(g.t, flatTOf(780), on);
      if (g.ok !== was.ok || g.kind !== was.kind || !(g.left === was.left || (Number.isNaN(g.left) && Number.isNaN(was.left)))) early += 1;
    }
  }
  check('09:30–13:15 on the 13:00 close 2026-11-27: no root\'s gate moved', early === 0, `${early} differ`);
}

console.log(failed ? `\n${failed} FAILED` : '\ncompass gate proof: all checks pass');
process.exit(failed ? 1 : 0);
