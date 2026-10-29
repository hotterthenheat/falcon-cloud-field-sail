/*
  This contract, four strikes each side, and the other side of those strikes.
  The rollup is the house stat row. The prints under it are the tape's own row.
*/

import { useEffect, useMemo, useRef } from 'react';
import { useNameTape, useShelfPrints, usd } from '../../data/traceLive';
import { printInSession, sessionEmpty } from '../../data/compassSession';
import { sessionMeta, type DeskSession } from '../../data/deskSession';
import type { OptionRight } from '../../types/compass';

const px = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const contracts = (n: number) => Math.round(n).toLocaleString('en-US');
const HEAD = 'font-mono text-t9 uppercase tracking-widest text-textMuted';

function roll(list: { size: number; price: number; premium: number; side: 'ASK' | 'BID' | 'MID' }[]) {
  let size = 0;
  let paid = 0;
  let ask = 0;
  let bid = 0;
  let premium = 0;
  for (const p of list) {
    size += p.size;
    paid += p.price * p.size;
    premium += p.premium;
    if (p.side === 'ASK') ask += p.size;
    else if (p.side === 'BID') bid += p.size;
  }
  return { n: list.length, size, premium, ask, bid, avg: size > 0 ? paid / size : 0 };
}

const sideWord = (s: 'ASK' | 'BID' | 'MID') => (s === 'ASK' ? 'Bought' : s === 'BID' ? 'Sold' : 'Mid');

function isoOf(label: string): string {
  const m = label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : label.slice(0, 10);
}

const Side = ({
  title,
  call,
  strikes,
  prints,
  focus,
}: {
  title: string;
  call: boolean;
  strikes: number[];
  prints: { strike: number; right: OptionRight; size: number; price: number; premium: number; side: 'ASK' | 'BID' | 'MID' }[];
  focus: number;
}) => {
  const total = roll(prints);
  const wash = call ? 'bg-bull/[0.06] border-l-2 border-l-bull/50' : 'bg-bear/[0.06] border-l-2 border-l-bear/50';
  const ink = call ? 'text-bull' : 'text-bear';
  return (
    <div className="min-w-0" data-flow-side={title}>
      <div className="px-3 h-7 flex items-center justify-between gap-2 border-b border-borderSubtle/60 paper-band">
        <span className={`font-mono text-t10 font-semibold uppercase tracking-widest ${ink}`}>{title}</span>
        <span className="font-mono text-t10 tnum text-textMuted truncate">{total.n > 0 ? `${contracts(total.size)} · ${usd(total.premium)}` : 'No print'}</span>
      </div>
      <div className={`grid grid-cols-[52px_1fr_1fr_1.3fr] gap-x-2 px-3 h-6 items-center ${HEAD}`}>
        <span>Strike</span>
        <span>Size</span>
        <span>Avg</span>
        <span>Ask / Bid</span>
      </div>
      {strikes.map(strike => {
        const mine = prints.filter(p => Math.abs(p.strike - strike) < 0.001);
        const r = roll(mine);
        const here = Math.abs(strike - focus) < 0.001;
        return (
          <div
            key={strike}
            className={`grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2 items-center px-3 border-b border-borderSubtle/40 ${here ? wash : ''}`}
            style={{ height: 28 }}
            data-flow-strike={strike}
            data-flow-here={here ? 'yes' : 'no'}
          >
            <span className={`font-mono text-t11 tnum ${here ? `${ink} font-semibold` : 'text-textSecondary'}`}>{strike.toFixed(2)}</span>
            <span className="font-mono text-t11 tnum text-textPrimary">{r.n > 0 ? contracts(r.size) : '—'}</span>
            <span className="font-mono text-t11 tnum text-textPrimary">{r.n > 0 ? px(r.avg) : ''}</span>
            <span className="font-mono text-t11 tnum text-textSecondary truncate">{r.n > 0 ? `${contracts(r.ask)} / ${contracts(r.bid)}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
};

const ContractFlow = ({
  ticker,
  strike,
  right,
  expiryDate,
  step,
  session = 'rth',
  allSessions = false,
}: {
  ticker: string;
  strike: number;
  right: OptionRight;
  expiryDate: string;
  step: number;
  session?: DeskSession;
  allSessions?: boolean;
}) => {
  const asked = ticker === 'SPXW' || ticker === 'XSP' ? 'SPX' : ticker === 'RUTW' ? 'RUT' : ticker;
  const tape = useNameTape(asked, 250);
  const primary = useShelfPrints(asked);
  const rootShelf = useShelfPrints(ticker);
  const shelf = tape.rows.length >= primary.length && tape.rows.length >= rootShelf.length
    ? tape.rows
    : primary.length >= rootShelf.length ? primary : rootShelf;
  const span = step > 0 ? step : 1;
  const view = useMemo(() => {
    const strikes = Array.from({ length: 9 }, (_, i) => +(strike + (i - 4) * span).toFixed(2));
    const day = expiryDate ? shelf.filter(p => isoOf(p.expiry) === expiryDate.slice(0, 10)) : shelf;
    const pool = day.filter(p => strikes.some(s => Math.abs(s - p.strike) < 0.001) && (allSessions || printInSession(p, ticker, session)));
    const row = (p: (typeof pool)[number]) => ({
      id: p.vendorId || String(p.id),
      time: p.time,
      strike: p.strike,
      right: p.right,
      side: p.side,
      sweep: p.sweep,
      size: p.size,
      price: p.fill,
      premium: p.premium,
    });
    const around = (side: OptionRight) => pool.filter(p => p.right === side).map(row);
    const mine = around(right)
      .filter(p => Math.abs(p.strike - strike) < 0.001)
      .sort((a, b) => (a.time < b.time ? 1 : -1));
    return { strikes, same: around(right), other: around(right === 'C' ? 'P' : 'C'), mine };
  }, [shelf, strike, span, right, expiryDate, ticker, session, allSessions]);

  const otherWord = right === 'C' ? 'Puts' : 'Calls';
  const thisWord = right === 'C' ? 'Calls' : 'Puts';
  const line = shelf.length === 0
    ? tape.waiting ? 'Reading the tape.' : 'Not on the tape yet.'
    : view.same.length + view.other.length === 0
      ? sessionEmpty(ticker, session)
      : allSessions
        ? 'This contract, from the open of its tape to the stop. Four strikes each side.'
        : `${sessionMeta(session).label}. This strike, four each side.`;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = listRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (box.scrollHeight <= box.clientHeight + 1) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      const atTop = box.scrollTop <= 0 && d < 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1 && d > 0;
      if (atTop || atBottom) return;
      e.preventDefault();
      box.scrollTop += d;
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [view.mine.length]);

  return (
    <div className="rounded-md border border-borderSubtle bg-ink/[0.015] overflow-hidden" data-setup-flow={ticker} data-flow-prints={view.same.length + view.other.length}>
      <div className="px-3.5 h-8 flex items-center gap-3 border-b border-borderSubtle/60 paper-band">
        <h3 className="text-t13 font-semibold leading-tight text-textPrimary">Flow</h3>
        <p className="text-t11 text-textMuted truncate">{line}</p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-borderSubtle">
        <Side title={thisWord} call={right === 'C'} strikes={view.strikes} prints={view.same} focus={strike} />
        <Side title={otherWord} call={right !== 'C'} strikes={view.strikes} prints={view.other} focus={strike} />
      </div>
      <div data-flow-prints-list>
        <div className="px-3 h-7 flex items-center justify-between gap-2 border-y border-borderSubtle/60 paper-band">
          <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">This contract</span>
          <span className="font-mono text-t10 tnum text-textMuted">{view.mine.length > 0 ? `${view.mine.length} prints · ${view.mine[view.mine.length - 1].time.slice(0, 8)}–${view.mine[0].time.slice(0, 8)} ET` : 'No print'}</span>
        </div>
        <div className={`grid grid-cols-[72px_108px_1fr_72px_72px] gap-x-2 px-3 pb-1 ${HEAD}`}>
          <span>Time</span>
          <span>Side</span>
          <span>Size</span>
          <span>Price</span>
          <span>Premium</span>
        </div>
        {view.mine.length === 0 ? (
          <div className="px-3 pb-3 font-mono text-t11 text-textMuted">—</div>
        ) : (
          <div ref={listRef} className="max-h-[224px] overflow-y-auto overscroll-contain" data-flow-scroll>
            {view.mine.map(p => (
              <div key={p.id} className="grid grid-cols-[72px_108px_1fr_72px_72px] gap-x-2 items-center px-3 border-b border-borderSubtle/40 hover:bg-silver/[0.04]" style={{ height: 28 }} data-flow-print={p.id}>
                <span className="font-mono text-t11 tnum text-textSecondary">{p.time.slice(0, 8)} ET</span>
                <span className="flex items-baseline gap-1 min-w-0 whitespace-nowrap">
                  <span className={`font-mono text-t11 ${p.side === 'MID' ? 'text-textMuted' : 'text-textPrimary'}`}>{sideWord(p.side)}</span>
                  {p.sweep && <span className="font-mono text-t10 text-textMuted">Sweep</span>}
                </span>
                <span className="font-mono text-t11 tnum text-textPrimary">{contracts(p.size)}</span>
                <span className="font-mono text-t11 tnum text-textPrimary">{px(p.price)}</span>
                <span className="font-mono text-t11 tnum text-textSecondary">{usd(p.premium)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractFlow;
