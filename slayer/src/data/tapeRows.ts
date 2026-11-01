/* The server tape's wire rows (data/tapeServer.ts) as the flow pane's rows: a FlowPrint with its tags, or a minute of
   small prints folded into one row. Pure, so the browser's store (data/tapeFeed.ts) and the proofs build the same rows. */

import type { FlowPrint } from '../types/trace';
import { sideOfCode, tagsOfBits, type OptionTags } from './printTags';
import type { OptionCellRow, OptionPrintRow } from './tapeServer';

/** A print on the server's tape as the flow pane reads it: a FlowPrint with its tags, or a minute's small prints folded
    into one row (`aggregate`: how many) */
export type TapeRow = FlowPrint & { tapeTags: OptionTags; aggregate?: number };

const NY_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clockOf = (ms: number) => NY_CLOCK.format(new Date(ms));
const expiryLabel = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const DTE_OF_BUCKET = [14, 60, 999];

export function rowOfPrint(name: string, p: OptionPrintRow): TapeRow {
  const [ms, exp, strike, r, size, price, bid, ask, sc, bits, otm, dte, opening, vol, oi, seq] = p;
  const tags = tagsOfBits(bits);
  const side = sideOfCode(sc);
  const fillPos = ask > bid && bid > 0 ? Math.min(1, Math.max(0, (price - bid) / (ask - bid))) : side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5;
  return {
    id: seq,
    vendorId: `tape:${seq}`,
    time: clockOf(ms),
    ticker: name,
    legs: tags.leg ? 2 : 1,
    strike,
    right: r > 0 ? 'C' : 'P',
    otmPct: otm == null ? NaN : otm,
    expiry: expiryLabel(exp),
    dte,
    fill: price,
    bid,
    ask,
    fillPos,
    side,
    ratioBidPct: NaN,
    size,
    premium: price * size * 100,
    volume: vol,
    oi: oi >= 0 ? oi : NaN,
    deltaOI: 0,
    spot: NaN,
    iv: NaN,
    volOverOI: oi > 0 ? vol / oi : 0,
    strat: tags.leg ? 'Custom' : '—',
    sweep: tags.sweep,
    epoch: Math.floor(ms / 1000),
    epochMs: ms,
    /* the server's read: the contract's volume through this print ran past the interest it opened on, or it did not
       (or the interest is not known) — never guessed here */
    likelyOpening: opening ? true : null,
    tapeTags: tags,
  };
}

export function rowOfCell(name: string, c: OptionCellRow, i: number): TapeRow {
  const [minute, bits, sc, r, otmBit, db, count, contracts, premium] = c;
  const tags = tagsOfBits(bits);
  return {
    id: -1 - i,
    vendorId: `tape:m${minute}:${i}`,
    time: clockOf(minute),
    ticker: name,
    legs: tags.leg ? 2 : 1,
    strike: NaN,
    right: r > 0 ? 'C' : 'P',
    otmPct: otmBit < 0 ? NaN : otmBit > 0 ? 1 : -1,
    expiry: '',
    dte: DTE_OF_BUCKET[db] ?? 999,
    fill: NaN,
    bid: NaN,
    ask: NaN,
    fillPos: 0.5,
    side: sideOfCode(sc),
    ratioBidPct: NaN,
    size: contracts,
    premium,
    volume: NaN,
    oi: NaN,
    deltaOI: 0,
    spot: NaN,
    iv: NaN,
    volOverOI: 0,
    strat: tags.leg ? 'Custom' : '—',
    sweep: tags.sweep,
    epoch: Math.floor(minute / 1000),
    epochMs: minute,
    /* only leaning prints that opened are folded (data/tapeServer.ts) */
    likelyOpening: true,
    tapeTags: tags,
    aggregate: count,
  };
}

