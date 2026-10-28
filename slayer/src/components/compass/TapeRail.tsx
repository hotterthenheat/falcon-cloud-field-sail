/*
  The scan's side rail. Real option prints only. No modeled premium.
*/

import { useEffect, useMemo, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import ContractLabel from '../ui/ContractLabel';
import { COMPASS_SET } from '../../data/compassUniverse';
import { useOptionTape } from '../../data/traceLive';
import type { OptionRight } from '../../types/compass';
import type { FlowPrint } from '../../types/trace';

export interface TapeHit {
  ticker: string;
  strike: number;
  right: OptionRight;
  size: number;
  /** Contracts that lifted the ask. */
  askSize: number;
  /** Contracts that hit the bid. */
  bidSize: number;
  sweeps: number;
  blocks: number;
  prints: number;
  side: 'ASK' | 'BID';
  /** Days to expiry on the print. The rail keeps 0, or 1–7, with the scan. */
  dte?: number;
  /** Last fill, the print's own price. */
  premium: number;
  /** Dollars of premium on the prints, as reported. */
  dollars: number;
  /** Clock on the last print. */
  time: string;
}

function contractOf(ticker: string, strike: number, right: OptionRight): string {
  const k = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2);
  return `${ticker} ${k}${right}`;
}

export interface TapeFocus {
  ticker: string;
  strike: number;
  right: OptionRight;
  /** This contract's tenor. The page asks for one print if the tape has none yet. */
  dte?: number;
}

function sameContract(r: { ticker: string; strike: number; right: OptionRight }, f: TapeFocus): boolean {
  return r.ticker === f.ticker && r.right === f.right && Math.abs(r.strike - f.strike) < 0.01;
}

function sizeWord(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function dollarWord(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

function shortTime(t: string): string {
  const m = t.match(/^(\d{1,2}:\d{2}):\d{2}(.*)$/);
  return (m ? `${m[1]}${m[2]}` : t).replace(/\s+/g, ' ').trim();
}

const TAPE_KEEP = 80;

function inSleeve(dte: number, sleeve: 'odte' | 'weekly'): boolean {
  return sleeve === 'odte' ? dte === 0 : dte >= 1 && dte <= 7;
}

function rowsOf(prints: FlowPrint[], sleeve: 'odte' | 'weekly'): (TapeHit & { rank: number })[] {
  const map = new Map<string, TapeHit>();
  for (const p of prints) {
    const ticker = p.ticker.toUpperCase();
    if (!COMPASS_SET.has(ticker) || !(p.strike > 0) || !(p.size > 0) || !(p.fill > 0)) continue;
    if (!Number.isFinite(p.dte) || !inSleeve(p.dte, sleeve)) continue;
    if (p.compression || p.cross) continue;
    const key = `${ticker}|${p.strike}|${p.right}|${p.dte}`;
    const dollars = p.premium > 0 ? p.premium : p.fill * p.size * 100;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ticker,
        strike: p.strike,
        right: p.right,
        size: p.size,
        askSize: p.side === 'ASK' ? p.size : 0,
        bidSize: p.side === 'BID' ? p.size : 0,
        sweeps: p.sweep ? 1 : 0,
        blocks: 0,
        prints: 1,
        side: p.side === 'BID' ? 'BID' : 'ASK',
        dte: p.dte,
        premium: p.fill,
        dollars,
        time: p.time,
      });
      continue;
    }
    prev.size += p.size;
    prev.askSize += p.side === 'ASK' ? p.size : 0;
    prev.bidSize += p.side === 'BID' ? p.size : 0;
    prev.sweeps += p.sweep ? 1 : 0;
    prev.prints += 1;
    prev.dollars += dollars;
  }
  return [...map.values()]
    .sort((a, b) => b.dollars - a.dollars)
    .slice(0, TAPE_KEEP)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const TapeRail = ({ focus, sleeve = 'odte', canOpen, onOpen }: { focus?: TapeFocus | null; sleeve?: 'odte' | 'weekly'; canOpen?: (hit: TapeHit) => boolean; onOpen: (hit: TapeHit) => void }) => {
  const tape = useOptionTape(500);
  const rows = useMemo(() => {
    const ranked = rowsOf(tape.rows, sleeve);
    if (!focus) return ranked;
    const best = ranked.find(r => sameContract(r, focus));
    if (!best || ranked[0]?.rank === best.rank) return ranked;
    return [best, ...ranked.filter(r => r.rank !== best.rank)];
  }, [tape.rows, focus, sleeve]);

  const flow = (r: TapeHit) => {
    const parts = [
      r.askSize > 0 ? `${sizeWord(r.askSize)} at ask` : '',
      r.bidSize > 0 ? `${sizeWord(r.bidSize)} at bid` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : `${sizeWord(r.size)} at mid`;
  };
  const kinds = (r: TapeHit) => {
    const parts = [
      r.sweeps > 0 ? `${r.sweeps} sweep${r.sweeps === 1 ? '' : 's'}` : '',
      r.blocks > 0 ? `${r.blocks} block${r.blocks === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
  };

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
  }, []);

  return (
    <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col w-full min-h-[480px] xl:min-h-0 xl:h-full" data-tape-rail>
      <div className="px-5 pt-4 pb-3">
        <div className="h-6 flex items-center gap-3">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">Tape</h3>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-textMuted">{sleeve === 'odte' ? 'Prints expiring today. Price is the fill.' : 'Prints expiring in 1 to 7 days. Price is the fill.'}</p>
      </div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-borderSubtle" data-tape-scroll>
        {rows.length === 0 && (
          <p className="px-5 py-4 text-[12px] text-textMuted">{tape.fault ? 'The tape is not answering.' : tape.waiting ? 'Reading the tape.' : 'No print on this sleeve.'}</p>
        )}
        {rows.map(r => {
          const openable = COMPASS_SET.has(r.ticker) && (canOpen ? canOpen(r) : false);
          const label = contractOf(r.ticker, r.strike, r.right);
          const here = focus ? sameContract(r, focus) : false;
          const dollars = r.dollars;
          return (
            <div
              key={`${r.ticker}-${r.strike}-${r.right}-${r.dte ?? 'x'}`}
              role={openable ? 'button' : undefined}
              tabIndex={openable ? 0 : undefined}
              data-tape-row={label}
              onClick={openable ? () => onOpen(r) : undefined}
              onKeyDown={
                openable
                  ? e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(r);
                      }
                    }
                  : undefined
              }
              className={`group px-3 py-2 border-b border-borderSubtle/50 last:border-0 ${here ? 'border-l-2 border-l-silver bg-silver/[0.04]' : ''} ${openable ? 'cursor-pointer hover:bg-ink/[0.02] focus-visible:bg-ink/[0.03] focus-visible:outline-none' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 shrink-0 font-mono text-[10px] text-textMuted tnum">#{r.rank}</span>
                <span className="min-w-0">
                  <ContractLabel contract={label} right={r.right} logo={r.ticker} size="sm" />
                </span>
                {r.dte != null && (
                  <span className="font-mono text-[9px] uppercase tracking-wider text-textSecondary border border-borderSubtle rounded px-1 py-0.5 whitespace-nowrap">
                    {r.dte === 0 ? '0DTE' : `${r.dte}DTE`}
                  </span>
                )}
                <span className="ml-auto font-mono text-[12px] font-semibold tnum text-textPrimary">${r.premium.toFixed(2)}</span>
                {openable && (
                  <ArrowUpRight aria-hidden className="w-3 h-3 shrink-0 text-textSecondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                )}
              </div>
              <div className="mt-1 pl-8 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10px] tnum text-textSecondary">
                <span className="text-textPrimary">{dollarWord(dollars)}</span>
                <span>{flow(r)}</span>
                {kinds(r) && <span>{kinds(r)}</span>}
                <span className="ml-auto text-textMuted">{shortTime(r.time)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TapeRail;
