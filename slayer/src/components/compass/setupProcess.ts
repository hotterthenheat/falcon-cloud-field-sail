/* Where a call sits in its own life, derived fresh from the record and the quote, never stored and never an
   instruction. Two reads, both restored from the owner's pages:
   - the process word on a card and the page head: ACTIVE while the call is on, MOVING once the contract trades like
     its side (|delta| at or over 0.50, the quote's own delta), CLOSED once it has left;
   - the stage strip on the contract page: called, filled, each rung the stop climbed (replayed with the ledger's own
     rule on the recorded minute bids), and the exit. */

import type { Tone } from '../ui/tones';
import { activeStop, type Signal } from '../../data/compassLedger';
import type { PathQuote } from '../../data/compassOutcome';

export type ProcessState = 'ACTIVE' | 'MOVING' | 'CLOSED';

const TAKEN_DELTA = 0.5;

export function processState(delta: number, closed: boolean): ProcessState {
  if (closed) return 'CLOSED';
  return Number.isFinite(delta) && Math.abs(delta) >= TAKEN_DELTA ? 'MOVING' : 'ACTIVE';
}

export const PROCESS_META: Record<ProcessState, { tone: Tone; pulse: boolean; hint: string }> = {
  ACTIVE: { tone: 'white', pulse: false, hint: 'The call is on.' },
  MOVING: { tone: 'white', pulse: true, hint: 'The contract now trades like its side: delta at or over 0.50.' },
  CLOSED: { tone: 'neutral', pulse: false, hint: 'The call has left: its exit is on the record.' },
};

export interface Stage {
  key: string;
  word: string;
  at: number | null;
  detail: string;
  tone: 'done' | 'now' | 'next' | 'win' | 'loss';
}

/** The call's stages, oldest first. `path` is the contract's recorded minute quotes after the call (may be empty). */
export function stagesOf(sig: Signal, path: readonly PathQuote[], runner: boolean): Stage[] {
  const o = sig.outcome;
  const out: Stage[] = [{ key: 'called', word: 'Called', at: sig.firedAt, detail: `${sig.bid.toFixed(2)} × ${sig.ask.toFixed(2)}`, tone: 'done' }];
  if (!o || o.status === 'waiting' || !o.fill) {
    out.push({ key: 'fill', word: o?.status === 'unavailable' ? 'Unavailable' : 'Filling', at: null, detail: o?.status === 'unavailable' ? 'No valid quote a minute later' : 'The first quote a full minute after the call', tone: o?.status === 'unavailable' ? 'loss' : 'now' });
    return out;
  }
  const paid = o.fill.ask;
  out.push({ key: 'fill', word: 'Filled', at: o.fill.at, detail: `$${paid.toFixed(2)}`, tone: 'done' });
  if (sig.book !== 'C') {
    let peak = 0;
    let rung = 'Stop';
    /* a quote after now does not exist yet (and an open call's path ends at its last read) */
    const end = o.exit?.at ?? Math.min(Date.now(), o.last?.t ?? Date.now());
    for (const q of path) {
      if (q.t <= o.fill.at || q.t > end || !(q.bid >= 0)) continue;
      peak = Math.max(peak, q.bid);
      const now = activeStop(paid, peak, runner);
      if (now.name !== rung) {
        rung = now.name;
        out.push({ key: `rung-${rung}`, word: rung === 'Breakeven' ? 'Stop to entry' : rung === 'Trail' ? 'Trailing' : `${rung} · stop up`, at: q.t, detail: `stop $${now.stop.toFixed(2)}`, tone: 'done' });
      }
    }
  }
  if (o.status === 'closed' && o.exit) {
    const pnl = o.pnl ?? (o.exit.px - paid) * 100;
    out.push({ key: 'exit', word: 'Out', at: o.exit.at, detail: `$${o.exit.px.toFixed(2)} · ${o.exit.why}`, tone: pnl > 0 ? 'win' : 'loss' });
  } else {
    out.push({ key: 'open', word: 'Holding', at: o.last?.t ?? null, detail: o.last ? `bid $${o.last.bid.toFixed(2)}` : 'On the record', tone: 'now' });
  }
  return out;
}
