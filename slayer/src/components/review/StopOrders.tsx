/* The backtest's order card, under the shared ticket: the orders that wait on the far side of the market — a BUY STOP
   over the ask (it buys the minute the ask comes up to it) and a SELL STOP under the bid — and how long every order
   that waits is good for (today, or until cancelled). The engine (data/review/engine.ts) says why one is refused, in
   the same words it would refuse it in. */

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Draft } from '../../data/review/engine';
import { contractWords, type ContractId, type Quote } from '../../data/review/quotes';

export type Tif = 'day' | 'gtc';

interface Props {
  contract: ContractId;
  /** Contracts of it held now (0: none) */
  held: number;
  /** The desk's one size */
  qty: number;
  quote: Quote;
  tif: Tif;
  onTif: (t: Tif) => void;
  refuse: (d: Draft) => string | null;
  onPlace: (d: Draft) => void;
}

const step = 'w-7 inline-flex items-center justify-center text-textSecondary enabled:hover:text-textPrimary enabled:hover:bg-ink/[0.06] transition-colors';
const act = (side: 'buy' | 'sell') => `tap-40 h-8 min-w-0 px-2 rounded-md border border-borderMuted bg-ink/[0.04] font-mono text-t10 font-semibold uppercase tracking-wider text-textPrimary whitespace-nowrap overflow-hidden text-ellipsis disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:text-onfoil transition-colors ${side === 'buy' ? 'enabled:hover:bg-bull enabled:hover:border-bull' : 'enabled:hover:bg-bear enabled:hover:border-bear'}`;
const r2 = (v: number) => Math.round(v * 100) / 100;

const StopOrders = ({ contract, held, qty, quote, tif, onTif, refuse, onPlace }: Props) => {
  const [typed, setTyped] = useState('');
  /* a new contract in hand starts from its own price */
  const key = contractWords(contract);
  useEffect(() => setTyped(''), [key]);
  /* empty: a buy stop a tenth over the ask, or — held — a sell stop a fifth under the bid */
  const fallback = held ? r2(Math.max(0.01, quote.bid * 0.8)) : r2(Math.max(0.01, quote.ask * 1.1));
  const px = typed.trim() === '' ? fallback : Math.max(0.01, Number(typed) || 0);
  const sellN = Math.max(1, Math.min(qty, held || qty));
  const buy: Draft = { contract, side: 'buy', qty, kind: 'stop', price: px, tif };
  const sell: Draft = { contract, side: 'sell', qty: sellN, kind: 'stop', price: px, tif };
  const whyBuy = refuse(buy);
  const whySell = held ? refuse(sell) : 'Nothing held here';
  const line = held ? whySell : whyBuy;
  return (
    <div className="px-4 pb-3 pt-2.5 border-t border-ink/[0.08] flex flex-col gap-2" data-review-stops>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-t10 text-textMuted whitespace-nowrap">Stop</span>
        <span className="inline-flex items-stretch h-8 rounded-md border border-borderSubtle overflow-hidden">
          <button type="button" onClick={() => setTyped(Math.max(0.01, px - 0.01).toFixed(2))} aria-label="A tick lower" className={step}>
            <Minus className="w-3 h-3" />
          </button>
          <input value={typed} onChange={e => setTyped(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" aria-label="Stop price" placeholder={fallback.toFixed(2)} className="w-[84px] border-x border-borderSubtle bg-panel px-2 text-center font-mono text-t12 tnum text-textPrimary outline-none focus:bg-ink/[0.04]" data-review-stop-price />
          <button type="button" onClick={() => setTyped((px + 0.01).toFixed(2))} aria-label="A tick higher" className={step}>
            <Plus className="w-3 h-3" />
          </button>
        </span>
        <span role="group" aria-label="How long an order that waits is good for" className="ml-auto inline-flex h-8 rounded-md border border-borderSubtle p-[2px] gap-[2px]" data-review-tif={tif}>
          {(['day', 'gtc'] as const).map(t => (
            <button key={t} type="button" aria-pressed={tif === t} onClick={() => onTif(t)} title={t === 'day' ? 'Good for today: what has not filled by 16:00 is cancelled' : 'Good until cancelled: it carries over the night, and waits'} className={`px-2.5 rounded-[4px] font-mono text-t10 font-semibold uppercase tracking-wider transition-colors ${tif === t ? 'bg-silver/[0.16] text-textPrimary' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05]'}`} data-review-tif-pick={t}>
              {t === 'day' ? 'Day' : 'GTC'}
            </button>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!!whyBuy} title={whyBuy ?? `Buys ${qty} at the ask the first minute it is ${px.toFixed(2)} or more`} onClick={() => onPlace(buy)} className={act('buy')} data-review-stop-act="buy">
          Buy stop <span className="text-bull">+{qty}</span> @ {px.toFixed(2)}
        </button>
        <button type="button" disabled={!!whySell} title={whySell ?? `Sells ${sellN} at the bid the first minute it is ${px.toFixed(2)} or less`} onClick={() => onPlace(sell)} className={act('sell')} data-review-stop-act="sell">
          Sell stop <span className="text-bear">−{sellN}</span> @ {px.toFixed(2)}
        </button>
      </div>
      <div className="font-mono text-t10 tnum leading-relaxed">
        {line ? <span className="text-warn">{line}</span> : <span className="text-textMuted">{held ? `Sells at the bid the first minute it is at or under ${px.toFixed(2)}` : `Buys at the ask the first minute it is at or over ${px.toFixed(2)}`} · {tif === 'day' ? 'cancelled at 16:00 if not filled' : 'good until cancelled'} · the Day / GTC switch also sets the limits above</span>}
      </div>
    </div>
  );
};

export default StopOrders;
