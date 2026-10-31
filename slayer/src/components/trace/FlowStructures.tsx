/* The tape's structures: the rolls found in the prints in hand (data/flowRolls.ts) and the working orders — one
   contract hit again and again on one side (data/flowRepeats.ts). Both read only the prints the tape holds, so the
   panel names that window. Folded it is one line of counts (TapeFold); open, its body keeps one height whatever it holds,
   so the tape below never jumps as reads land. */

import type { ReactNode } from 'react';
import { expiryLabel } from '../../core/format';
import TapeFold from './TapeFold';
import { nyClock } from '../../core/nyTime';
import { fmtCount as num, usd as fmtUsd } from '../../data/traceLive';
import { ROLL_INFERRED_MIN_SIZE, ROLL_WINDOW_MS, type RollEvent, type RollKind, type RollLeg } from '../../data/flowRolls';
import { REPEAT_GAP_MS, REPEAT_MIN_HITS, REPEAT_SIZE_TOL, type RepeatCluster, type RepeatRead } from '../../data/flowRepeats';

const KIND_WORD: Record<RollKind, string> = {
  out: 'rolled out',
  'up-and-out': 'rolled up and out',
  'down-and-out': 'rolled down and out',
  up: 'rolled up',
  down: 'rolled down',
  in: 'rolled in',
  'up-and-in': 'rolled up and in',
  'down-and-in': 'rolled down and in',
};

export const ROLL_TAGGED_TIP = 'Tagged: both legs were filed as one two-leg order in the same millisecond — the order’s only two contracts, one closed and one opened. A two-leg order can still be a spread; the open interest is what says which leg closed.';
export const ROLL_INFERRED_TIP = `Inferred: matched legs — two single prints of ${ROLL_INFERRED_MIN_SIZE}+ contracts, similar size, opposite sides, within ${ROLL_WINDOW_MS / 1000} seconds, with no other print they could pair with. It can also be a calendar spread.`;
const ROLLS_TIP = 'A position closed on one contract and reopened on another of the same name and type. Its two legs are one position moved, not two bets: they are left out of the bullish and bearish totals above.';
const ORDERS_TIP = `One contract hit ${REPEAT_MIN_HITS}+ times on one side, every hit within ${Math.round(REPEAT_SIZE_TOL * 100)}% of the typical size and none more than ${REPEAT_GAP_MS / 60_000} minutes after the last — the shape of one hand working an order. A sweep or a fill split over a quarter second counts as one hit.`;
const STRIPS_TIP = 'The same strike and side hit across neighbouring expiries in the same pattern. A strip can share hits with a working order above; the two are never added together.';
const FILL_TIP = 'Where the fills sat in their quotes, weighted by size: 0% on the bid, 100% on the ask';

const strikeWord = (s: number) => (Number.isInteger(s) ? String(s) : s.toFixed(2).replace(/0$/, ''));
const legWord = (l: RollLeg, right: 'C' | 'P') => `${strikeWord(l.strike)}${right} ${expiryLabel(l.expiryIso)}`;
const clock = (ms: number) => (ms > 0 ? nyClock(ms, { seconds: true }) : '—');
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
/** The average fill as a place in the quote: "filled at the ask", "filled on the bid", or "fills 75% to the ask" */
const fillWords = (v: number) => (!Number.isFinite(v) ? 'fill —' : v >= 0.95 ? 'at the ask' : v <= 0.05 ? 'on the bid' : `fills ${Math.round(v * 100)}% to ask`);
const KIND_SHORT: Record<RollKind, string> = { out: 'out', 'up-and-out': 'up & out', 'down-and-out': 'down & out', up: 'up', down: 'down', in: 'in', 'up-and-in': 'up & in', 'down-and-in': 'down & in' };

export const RollBadge = ({ confidence }: { confidence: RollEvent['confidence'] }) => (
  <span
    className={`inline-flex items-center h-[14px] px-1 rounded-[3px] border font-mono text-t75 font-bold uppercase tracking-[0.12em] leading-none align-middle ${confidence === 'tagged' ? 'border-silver/40 text-textPrimary' : 'border-borderSubtle text-textSecondary'}`}
    title={confidence === 'tagged' ? ROLL_TAGGED_TIP : ROLL_INFERRED_TIP}
    data-roll-confidence={confidence}
  >
    {confidence}
  </span>
);

/** "net debit $1.2K" / "net credit $450" / "even" */
const netWords = (v: number) => (Math.abs(v) < 0.5 ? 'even' : `net ${v > 0 ? 'debit' : 'credit'} ${fmtUsd(Math.abs(v))}`);

const RollRow = ({ r, onOpen }: { r: RollEvent; onOpen?: (key: string) => void }) => (
  <li className="min-w-0">
    <button
      type="button"
      onClick={() => onOpen?.(r.from.printIds[0])}
      className="flex w-full min-w-0 items-baseline gap-2 py-0.5 max-sm:py-1.5 text-left font-mono text-t11 tnum text-textPrimary hover:text-silver"
      title={`${r.holder === 'long' ? 'A long' : 'A short'} ${r.right === 'C' ? 'call' : 'put'} ${KIND_WORD[r.kind]}: ${r.from.side === 'BID' ? 'sold' : 'bought'} ${num(r.from.size)} ${legWord(r.from, r.right)} to close, ${r.to.side === 'ASK' ? 'bought' : 'sold'} ${num(r.to.size)} ${legWord(r.to, r.right)} to open${r.gapMs > 0 ? `, ${(r.gapMs / 1000).toFixed(1)} s apart` : ''}. Opens the closing leg's card.`}
      data-roll={r.kind}
    >
      <RollBadge confidence={r.confidence} />
      <span className="shrink-0 text-textSecondary">{clock(r.ts)}</span>
      <span className="min-w-0 sm:truncate max-sm:break-words">
        <span className="font-bold">{r.root}</span> {legWord(r.from, r.right)} → {legWord(r.to, r.right)}
        {/* the figures first: a narrow column cuts the words, the hover keeps the whole sentence */}
        <span className="text-textSecondary"> · {num(r.size)} · </span>
        <span className="text-textPrimary">{netWords(r.netPremium)}</span>
        <span className="text-textSecondary"> · {r.holder}, {KIND_SHORT[r.kind]}</span>
      </span>
    </button>
  </li>
);

const OrderRow = ({ c, onOpen }: { c: RepeatCluster; onOpen?: (key: string) => void }) => {
  const where = c.kind === 'strip' ? `${strikeWord(c.strike)}${c.right} ${c.expiries.map(e => expiryLabel(e)).join(', ')}` : `${strikeWord(c.strike)}${c.right} ${expiryLabel(c.expiries[0] ?? '')}`;
  const span = c.lastTs > c.firstTs ? `${clock(c.firstTs)}–${clock(c.lastTs)}` : clock(c.firstTs);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen?.(c.prints[c.prints.length - 1])}
        className="flex w-full min-w-0 items-baseline gap-2 py-0.5 max-sm:py-1.5 text-left font-mono text-t11 tnum text-textPrimary hover:text-silver"
        title={`${c.ticker} ${where}: ${c.hits} hits ${c.side === 'ASK' ? 'at the ask (bought)' : 'on the bid (sold)'}, ${num(c.totalSize)} contracts for ${fmtUsd(c.totalPremium)}, ${span} ET; typical hit ${num(c.medianSize)}; average fill ${pct(c.avgFillPos)} of the way to the ask; ${pct(c.sweepShare)} of the contracts swept. Opens the latest hit's card.`}
        data-working-order={c.kind}
      >
        <span className={`shrink-0 font-semibold ${c.side === 'ASK' ? 'text-textPrimary' : 'text-textSecondary'}`}>{c.side === 'ASK' ? 'bought' : 'sold'}</span>
        <span className="min-w-0 sm:truncate max-sm:break-words">
          <span className="font-bold">{c.ticker}</span> {where}
          <span className="text-textSecondary">
            {' '}
            · {c.hits} hits · {num(c.totalSize)} · {fmtUsd(c.totalPremium)} · {span} · <span title={FILL_TIP}>{fillWords(c.avgFillPos)}</span> · swept {pct(c.sweepShare)}
          </span>
        </span>
      </button>
    </li>
  );
};

const Column = ({ title, tip, count, children, testId }: { title: string; tip: string; count: ReactNode; children: ReactNode; testId: string }) => (
  <div className="min-w-0 flex flex-col" data-flow-col={testId}>
    <div className="flex items-baseline gap-2 text-t11" title={tip}>
      <span className="text-textMuted">{title}</span>
      <span className="font-mono tnum text-textPrimary">{count}</span>
    </div>
    {/* one height, full or empty: the tape below stays put */}
    <div className="mt-1 h-[118px] max-sm:h-auto max-sm:max-h-[260px] overflow-y-auto overscroll-contain pr-1">{children}</div>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => <p className="py-0.5 font-mono text-t11 text-textMuted">{children}</p>;

export interface FlowStructuresProps {
  rolls: RollEvent[];
  repeats: RepeatRead;
  /** Prints the reads covered, and their span ("16:14:40–16:14:59") */
  prints: number;
  span: string | null;
  reading: boolean;
  open: boolean;
  onToggle: () => void;
  /** A print's key (flowRolls printKey) → open its card */
  onOpenPrint?: (key: string) => void;
}

const FlowStructures = ({ rolls, repeats, prints, span, reading, open, onToggle, onOpenPrint }: FlowStructuresProps) => {
  const orders = repeats.clusters.length;
  const strips = repeats.strips.length;
  /* a phone's line says "orders": the title above it already says working */
  const counts = (word: string) => (reading ? '…' : `${num(rolls.length)} roll${rolls.length === 1 ? '' : 's'} · ${num(orders)} ${word}${orders === 1 ? '' : 's'}${strips ? ` · ${num(strips)} strip${strips === 1 ? '' : 's'}` : ''}`);
  return (
    <TapeFold
      title="Rolls & working orders"
      shortTitle="Rolls & orders"
      noun="the rolls and working orders"
      summary={
        <>
          <span className="font-mono tnum text-textSecondary" data-flow-counts>
            <span className="sm:hidden">{counts('order')}</span>
            <span className="max-sm:hidden">{counts('working order')}</span>
          </span>
          {!reading && prints > 0 && <span className="max-sm:hidden"> · in these {num(prints)} prints{span ? `, ${span} ET` : ''}</span>}
        </>
      }
      summaryTitle="Read from the prints the tape holds, not the whole day; older prints join as you scroll or jump back"
      open={open}
      onToggle={onToggle}
      testId="flow-structures"
    >
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <Column title="Rolls" tip={ROLLS_TIP} count={reading ? '…' : num(rolls.length)} testId="rolls">
            {reading ? (
              <Empty>Reading the tape…</Empty>
            ) : rolls.length === 0 ? (
              <Empty>No rolls detected in this window.</Empty>
            ) : (
              <ul>
                {[...rolls].reverse().map(r => (
                  <RollRow key={r.id} r={r} onOpen={onOpenPrint} />
                ))}
              </ul>
            )}
          </Column>
          <Column title="Working orders" tip={ORDERS_TIP} count={reading ? '…' : num(orders)} testId="orders">
            {reading ? (
              <Empty>Reading the tape…</Empty>
            ) : orders === 0 && strips === 0 ? (
              <Empty>No contract hit {REPEAT_MIN_HITS}+ times in similar size in this window.</Empty>
            ) : (
              <>
                {orders === 0 ? (
                  <Empty>No single contract worked in this window.</Empty>
                ) : (
                  <ul>
                    {[...repeats.clusters].reverse().map(c => (
                      <OrderRow key={c.key} c={c} onOpen={onOpenPrint} />
                    ))}
                  </ul>
                )}
                {strips > 0 && (
                  <>
                    <div className="mt-1.5 text-t11 text-textMuted" title={STRIPS_TIP}>
                      Strips · across expiries
                    </div>
                    <ul data-flow-strips>
                      {[...repeats.strips].reverse().map(c => (
                        <OrderRow key={c.key} c={c} onOpen={onOpenPrint} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </Column>
        </div>
    </TapeFold>
  );
};

export default FlowStructures;
