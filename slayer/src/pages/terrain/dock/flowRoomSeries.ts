/* THE NET FLOW ROOM'S LINES (pages/terrain/dock/FlowRoom.tsx): the partner tree's dock room (bfce19c — net calls
   against net puts through the session) drawn off OUR flow pane's arithmetic, never a second one. The prints are the
   ones the chart's Flow pane and Net drift read (data/paneFlow.ts on the server's option tape, under the desk's flow
   filters), and every minute is data/flowBuckets.ts signedFlowBars — the same sign (data/tape.ts sentimentOf: opening
   prints only, never the mid, extended hours or compression; legs only when counted), the same bar rule.

   The split is by the contract's side alone: the calls' signed premium runs as the call line (bought at the ask up,
   sold at the bid down), the puts' as the put line with the put's own reading (bought counts up on the put line, as the
   partner's pane draws it). So call line − put line at any minute IS the Net drift's running total for that session —
   the proof (scripts/flow-room-proof.ts) holds it to the recorded tape. Pure: no React, no fetch. */

import type { FlowPrint } from '../../../types/trace';
import { signedFlowBars } from '../../../data/flowBuckets';

export interface FlowRoomPoint {
  /** the minute's open, unix seconds */
  time: number;
  /** running net call premium from the session's open: calls bought less calls sold, dollars */
  callPrem: number;
  /** running net put premium: puts bought less puts sold, dollars */
  putPrem: number;
  /** contracts printed that minute under the filters, every print counted (a leaning one or not) */
  vol: number;
  /** the underlying's close that minute off the chart's own bars; 0 when the chart holds none */
  price: number;
}

const MIN = 60;

/** One point a minute from `fromSec` to `toSec` (exclusive), the session's every print under the filters folded in */
export function flowRoomSeries(prints: readonly FlowPrint[], fromSec: number, toSec: number, legs: boolean, closes?: ReadonlyMap<number, number>): FlowRoomPoint[] {
  const first = Math.floor(fromSec / MIN) * MIN;
  if (!(toSec > first)) return [];
  const times: number[] = [];
  for (let t = first; t < toSec; t += MIN) times.push(t);
  const calls = prints.filter(p => p.right === 'C');
  const puts = prints.filter(p => p.right === 'P');
  const c = signedFlowBars(calls, times, MIN, legs);
  const p = signedFlowBars(puts, times, MIN, legs);
  const vol = new Array<number>(times.length).fill(0);
  for (const pr of prints) {
    const ms = pr.epochMs ?? (pr.epoch != null ? pr.epoch * 1000 : 0);
    const i = Math.floor((ms / 1000 - first) / MIN);
    if (i >= 0 && i < times.length && pr.size > 0) vol[i] += pr.size;
  }
  let callRun = 0;
  let putRun = 0;
  return times.map((time, i) => {
    callRun += c[i].net;
    /* a put bought reads down on the tape (sign −1): on the put line it is the line rising */
    putRun -= p[i].net;
    return { time, callPrem: callRun, putPrem: putRun, vol: vol[i], price: closes?.get(time) ?? 0 };
  });
}

/** The last minute that holds a print, or 0 — the line stops there rather than running flat to the close */
export function lastPrintMinute(prints: readonly FlowPrint[]): number {
  let last = 0;
  for (const p of prints) {
    const ms = p.epochMs ?? (p.epoch != null ? p.epoch * 1000 : 0);
    if (ms > last) last = ms;
  }
  return last > 0 ? Math.floor(last / 1000 / MIN) * MIN : 0;
}
