/* The strategies, built from the chain's expiry: a vertical (bought for a debit or sold for a credit), an iron condor
   (two spreads sold as one order — a butterfly where the short strikes meet), a cash-secured put, and why a covered
   call is not here. Every price is the live NBBO's: a leg sold at its bid, a leg bought at its ask. The engine's own
   words say why an order would be refused, before the press. */

import { useMemo, useState } from 'react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { card, head, headWord } from '../review/DeskShell';
import { usd, usdBal } from '../review/words';
import { Act, Pills, PriceBox, SizeRow, labelCls } from './OrderPanel';
import { MULT } from '../../data/review/engine';
import { contractWords, strikeWords, type ContractId, type Quote, type Right } from '../../data/review/quotes';
import type { ComboDraft, OptDraft } from '../../data/paper/engine';

export type Strategy = 'vertical' | 'condor' | 'csp' | 'covered';

export interface StrategyDesk {
  ticker: string;
  expiry: string | null;
  expiryOptions: DropdownOption<string>[];
  onExpiry: (e: string) => void;
  /** The expiry's listed strikes, low to high */
  strikes: number[];
  spot: number;
  quote: (c: ContractId) => Quote;
  q: number;
  onQ: (n: number) => void;
  fee: number;
  locked: string | null;
  /** Can this account sell to open at all — and the plan's words where it cannot */
  canSell: boolean;
  sellWords: string;
  securedOnly: boolean;
  refuse: (d: OptDraft) => string | null;
  refuseCombo: (d: ComboDraft) => string | null;
  preview: (legs: { contract: ContractId; side: 'buy' | 'sell'; qty: number; secured?: 'cash' }[]) => { held: number; need: number; free: number } | null;
  onPlace: (d: OptDraft) => void;
  onPlaceCombo: (d: ComboDraft) => void;
  version: string;
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
const quiet = 'h-6 px-2 rounded-md border border-borderSubtle font-mono text-t10 text-textSecondary hover:text-textPrimary hover:border-borderMuted disabled:opacity-35 disabled:cursor-not-allowed transition-colors';
const Fact = ({ label, value, ink = 'text-textPrimary' }: { label: string; value: string; ink?: string }) => (
  <div className="min-w-0">
    <div className="text-t10 text-textMuted whitespace-nowrap">{label}</div>
    <div className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap truncate ${ink}`}>{value}</div>
  </div>
);

/** The strike nearest a price, out of the money on a side: `nth` strikes past the market */
const outOfMoney = (strikes: number[], spot: number, right: Right, nth = 1): number | null => {
  const out = right === 'C' ? strikes.filter(k => k > spot) : strikes.filter(k => k < spot).reverse();
  return out[Math.min(out.length - 1, nth - 1)] ?? null;
};
/** The strikes further out than `k` on a side, nearest first */
const further = (strikes: number[], k: number, right: Right) => (right === 'C' ? strikes.filter(x => x > k) : strikes.filter(x => x < k).reverse());

const StrategyBuilder = ({ desk }: { desk: StrategyDesk }) => {
  const [kind, setKind] = useState<Strategy>('vertical');
  const [right, setRight] = useState<Right>('P');
  const [way, setWay] = useState<'credit' | 'debit'>('credit');
  const [near, setNear] = useState<number | null>(null);
  const [far, setFar] = useState<number | null>(null);
  const [putK, setPutK] = useState<number | null>(null);
  const [callK, setCallK] = useState<number | null>(null);
  const [wing, setWing] = useState<number | null>(null);
  const [cspK, setCspK] = useState<number | null>(null);
  const [limit, setLimit] = useState('');
  const { strikes, spot, ticker, expiry } = desk;
  const n = desk.q;
  const ready = !!expiry && strikes.length > 3 && spot > 0;

  /* ---- the vertical ---- */
  const nearK = near != null && strikes.includes(near) ? near : ready ? outOfMoney(strikes, spot, right, way === 'credit' ? 2 : 1) : null;
  const outs = nearK != null ? further(strikes, nearK, right) : [];
  const farK = far != null && outs.includes(far) ? far : (outs[0] ?? null);
  const vertical: ContractId | null = ready && nearK != null && farK != null ? { ticker, strike: nearK, right, expiry: expiry!, short: farK } : null;
  /* ---- the condor: a put spread under the market, a call spread over it, the same wings ---- */
  const pK = putK != null && strikes.includes(putK) ? putK : ready ? outOfMoney(strikes, spot, 'P', 2) : null;
  const cK = callK != null && strikes.includes(callK) ? callK : ready ? outOfMoney(strikes, spot, 'C', 2) : null;
  const gaps = strikes.slice(1).map((k, i) => +(k - strikes[i]).toFixed(4)).filter(g => g > 0).sort((x, y) => x - y);
  const step = gaps[0] ?? 1;
  const wings = [1, 2, 3, 5, 10].map(x => +(x * step).toFixed(4)).filter(w => pK != null && cK != null && strikes.includes(+(pK - w).toFixed(4)) && strikes.includes(+(cK + w).toFixed(4)));
  const w = wing != null && wings.includes(wing) ? wing : (wings[0] ?? null);
  const putSide: ContractId | null = ready && pK != null && w != null ? { ticker, strike: pK, right: 'P', expiry: expiry!, short: +(pK - w).toFixed(4) } : null;
  const callSide: ContractId | null = ready && cK != null && w != null ? { ticker, strike: cK, right: 'C', expiry: expiry!, short: +(cK + w).toFixed(4) } : null;
  /* ---- the cash-secured put ---- */
  const csK = cspK != null && strikes.includes(cspK) ? cspK : ready ? outOfMoney(strikes, spot, 'P', 2) : null;
  const csp: ContractId | null = ready && csK != null ? { ticker, strike: csK, right: 'P', expiry: expiry! } : null;

  const vq = vertical ? desk.quote(vertical) : null;
  const pq = putSide ? desk.quote(putSide) : null;
  const cq = callSide ? desk.quote(callSide) : null;
  const sq = csp ? desk.quote(csp) : null;
  /* the price at the market, a share: what it takes in (credit) or costs (debit) */
  /* a leg with no quote read yet has no price: a dash, never 0.00. A quote read a while ago (after the bell the feed reads
     once a minute) still prices the order, said as the last quote — nothing fills on it. */
  const pos = (v: number | undefined) => (v != null && v > 0 ? v : NaN);
  const natural = kind === 'vertical' ? (vq ? pos(way === 'credit' ? vq.bid : vq.ask) : NaN) : kind === 'condor' ? (pq && cq && pq.bid > 0 && cq.bid > 0 ? +(pq.bid + cq.bid).toFixed(2) : NaN) : kind === 'csp' ? pos(sq?.bid) : NaN;
  const stale = kind === 'vertical' ? !!vq?.dead : kind === 'condor' ? !!(pq?.dead || cq?.dead) : kind === 'csp' ? !!sq?.dead : false;
  const limitPx = Math.max(0.01, num(limit) ?? (Number.isFinite(natural) ? natural : 0.01));
  const width = kind === 'vertical' && vertical ? Math.abs(vertical.short! - vertical.strike) : kind === 'condor' && w != null ? w : 0;

  const singleDraft = (k: 'market' | 'limit'): OptDraft | null => {
    if (kind === 'vertical' && vertical) return { contract: vertical, side: way === 'credit' ? 'sell' : 'buy', qty: n, kind: k, price: k === 'limit' ? limitPx : undefined };
    if (kind === 'csp' && csp) return { contract: csp, side: 'sell', qty: n, kind: k, price: k === 'limit' ? limitPx : undefined, secured: 'cash' };
    return null;
  };
  const comboDraft = (k: 'market' | 'limit'): ComboDraft | null =>
    kind === 'condor' && putSide && callSide ? { name: pK === cK ? 'Iron butterfly' : 'Iron condor', legs: [{ contract: putSide, side: 'sell' }, { contract: callSide, side: 'sell' }], qty: n, kind: k, net: k === 'limit' ? limitPx : undefined } : null;
  const sells = kind !== 'vertical' || way === 'credit';
  const why = useMemo(() => {
    const off = desk.locked ?? (!ready ? 'Loading the chain' : sells && !desk.canSell ? desk.sellWords : null);
    if (kind === 'covered') return { market: 'Not offered here', limit: 'Not offered here' };
    if (off) return { market: off, limit: off };
    /* a limit needs a price: the market's, or one typed — never a made-up 0.01 */
    const noPrice = num(limit) == null && !Number.isFinite(natural) ? 'No quote for a leg yet — type the net price it should wait for' : null;
    if (kind === 'condor') {
      const m = comboDraft('market');
      const l = comboDraft('limit');
      return { market: m ? desk.refuseCombo(m) : 'Pick its strikes', limit: noPrice ?? (l ? desk.refuseCombo(l) : 'Pick its strikes') };
    }
    const m = singleDraft('market');
    const l = singleDraft('limit');
    return { market: m ? desk.refuse(m) : 'Pick its strikes', limit: noPrice ?? (l ? desk.refuse(l) : 'Pick its strikes') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.version, desk.locked, kind, right, way, nearK, farK, pK, cK, w, csK, n, limit, ready]);
  const preview = useMemo(() => {
    if (kind === 'condor' && putSide && callSide) return desk.preview([{ contract: putSide, side: 'sell', qty: n }, { contract: callSide, side: 'sell', qty: n }]);
    const d = singleDraft('market');
    return d ? desk.preview([{ contract: d.contract, side: d.side, qty: n, secured: d.secured }]) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.version, kind, right, way, nearK, farK, pK, cK, w, csK, n]);

  const place = (k: 'market' | 'limit') => {
    if (kind === 'condor') {
      const d = comboDraft(k);
      if (d) desk.onPlaceCombo(d);
    } else {
      const d = singleDraft(k);
      if (d) desk.onPlace(d);
    }
  };
  const strikeOpts = (list: number[], hint?: (k: number) => string): DropdownOption<number>[] => list.map(k => ({ value: k, label: strikeWords(k), hint: hint?.(k) }));
  const pct = (k: number) => (spot > 0 ? `${(((k - spot) / spot) * 100).toFixed(1)}% from ${spot.toFixed(2)}` : '');
  const fees = desk.fee * n * (kind === 'condor' ? 4 : kind === 'vertical' ? 2 : 1);

  /* what it can make and lose at expiry, and where it breaks even — at the price in hand */
  const px = num(limit) ?? natural;
  const facts: { label: string; value: string; ink?: string }[] = [];
  if (Number.isFinite(px)) {
    if (kind === 'vertical' && vertical) {
      const gain = way === 'credit' ? px : width - px;
      const loss = way === 'credit' ? width - px : px;
      const even = right === 'C' ? vertical.strike + px : vertical.strike - px;
      facts.push({ label: way === 'credit' ? 'Credit' : 'Debit', value: usd(px * MULT * n) }, { label: 'Can make', value: usd(Math.max(0, gain) * MULT * n), ink: 'text-bull' }, { label: 'Can lose', value: usd(Math.max(0, loss) * MULT * n), ink: 'text-bear' }, { label: 'Even at expiry', value: `${ticker} ${even.toFixed(2)}` });
    } else if (kind === 'condor' && putSide && callSide) {
      facts.push({ label: 'Credit', value: usd(px * MULT * n) }, { label: 'Can make', value: usd(px * MULT * n), ink: 'text-bull' }, { label: 'Can lose', value: usd(Math.max(0, width - px) * MULT * n), ink: 'text-bear' }, { label: 'Even at expiry', value: `${(putSide.strike - px).toFixed(2)} · ${(callSide.strike + px).toFixed(2)}` });
    } else if (kind === 'csp' && csp) {
      facts.push({ label: 'Credit', value: usd(px * MULT * n) }, { label: 'Can lose', value: usd(Math.max(0, csp.strike - px) * MULT * n), ink: 'text-bear' }, { label: 'Even at expiry', value: `${ticker} ${(csp.strike - px).toFixed(2)}` });
    }
  }
  const words = kind === 'vertical' && vertical ? `${way === 'credit' ? 'Sell' : 'Buy'} ${contractWords(vertical)}` : kind === 'condor' && putSide && callSide ? `Sell ${contractWords(putSide)} + ${contractWords(callSide)}` : kind === 'csp' && csp ? `Sell ${contractWords(csp)} cash-secured` : '';

  return (
    <div className={`${card} flex flex-col min-w-0 lg:flex-1 lg:min-h-0`} data-paper-strategies={kind}>
      <div className={`${head} h-auto min-h-10 py-1.5 flex-wrap gap-y-1.5`}>
        <span className={headWord}>Strategies</span>
        {expiry && <DropdownSelect label="Expiry" bare value={expiry} options={desk.expiryOptions} onChange={desk.onExpiry} title="The expiry — those listed today" testId="paper-strategy-expiry" />}
        <span className="ml-auto font-mono text-t10 tnum text-textMuted">{ticker} {spot > 0 ? spot.toFixed(2) : '—'}</span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto min-h-0" data-paper-strategy-body>
        <div className="flex flex-wrap gap-1.5">
          <Pills
            label="Strategy"
            value={kind}
            onChange={k => {
              setKind(k);
              setLimit('');
            }}
            options={[
              { value: 'vertical', label: 'Vertical' },
              { value: 'condor', label: 'Condor' },
              { value: 'csp', label: 'Secured put' },
              { value: 'covered', label: 'Covered call' },
            ]}
          />
        </div>
        {kind === 'covered' ? (
          <p className="text-t11 leading-relaxed text-textSecondary" data-paper-covered-call>
            A covered call is a call sold against 100 shares a contract. This desk trades options only and holds no stock, so it cannot write one — and a call sold with no shares behind it is not covered. A call sold against a long call on the same expiry is a spread: build it under <button type="button" className="underline underline-offset-2 hover:text-textPrimary" onClick={() => { setKind('vertical'); setRight('C'); setWay('credit'); }}>Vertical</button>.
          </p>
        ) : (
          <>
            {kind === 'vertical' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Pills label="Calls or puts" value={right} onChange={r => { setRight(r); setNear(null); setFar(null); setLimit(''); }} options={[{ value: 'C', label: 'Calls', tone: 'bull' }, { value: 'P', label: 'Puts', tone: 'bear' }]} />
                <Pills label="Bought for a debit, or sold for a credit" value={way} onChange={x => { setWay(x); setNear(null); setLimit(''); }} options={[{ value: 'credit', label: 'Credit (sell)', tone: 'bear' }, { value: 'debit', label: 'Debit (buy)', tone: 'bull' }]} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5" data-paper-strategy-strikes>
              {kind === 'vertical' && nearK != null && (
                <>
                  <DropdownSelect label={way === 'credit' ? 'Sell' : 'Buy'} value={nearK} options={strikeOpts(strikes, pct)} onChange={k => { setNear(k); setFar(null); setLimit(''); }} title={way === 'credit' ? 'The strike sold — nearer the money' : 'The strike bought — nearer the money'} testId="strategy-near" size="sm" />
                  {farK != null && <DropdownSelect label={way === 'credit' ? 'Buy' : 'Sell'} value={farK} options={strikeOpts(outs.slice(0, 10), k => `${Math.abs(k - nearK).toFixed(2)} wide`)} onChange={k => { setFar(k); setLimit(''); }} title={way === 'credit' ? 'The strike bought against it — further out: it caps the loss' : 'The strike sold against it — further out: it caps the gain and the cost'} testId="strategy-far" size="sm" />}
                </>
              )}
              {kind === 'condor' && pK != null && cK != null && (
                <>
                  <DropdownSelect label="Sell put" value={pK} options={strikeOpts(strikes.filter(k => k <= cK), pct)} onChange={k => { setPutK(k); setLimit(''); }} title="The put sold, under the market" testId="strategy-put" size="sm" />
                  <DropdownSelect label="Sell call" value={cK} options={strikeOpts(strikes.filter(k => k >= pK), pct)} onChange={k => { setCallK(k); setLimit(''); }} title="The call sold, over the market — the same strike as the put makes an iron butterfly" testId="strategy-call" size="sm" />
                  {w != null && <DropdownSelect label="Wings" value={w} options={wings.map(x => ({ value: x, label: x.toFixed(x % 1 ? 2 : 0), hint: `Buys the ${strikeWords(+(pK - x).toFixed(4))}P and the ${strikeWords(+(cK + x).toFixed(4))}C` }))} onChange={x => { setWing(x); setLimit(''); }} title="How far out the legs bought sit — the most a side can lose is this, less the credit" testId="strategy-wing" size="sm" />}
                </>
              )}
              {kind === 'csp' && csK != null && <DropdownSelect label="Sell put" value={csK} options={strikeOpts(strikes.filter(k => k <= spot * 1.05), pct)} onChange={k => { setCspK(k); setLimit(''); }} title="The put sold — its strike × 100 is held while it is open" testId="strategy-csp" size="sm" />}
            </div>
            {words && (
              <div className="font-mono text-t11 text-textPrimary" data-paper-strategy-words>
                {words}
                <span className="text-textMuted">
                  {' '}
                  · {Number.isFinite(natural) ? `${natural.toFixed(2)} ${sells ? 'credit' : 'debit'} ${stale ? 'on the last quote read — nothing fills on it now' : 'at the market'}` : 'no quote for a leg yet'}
                </span>
              </div>
            )}
            <SizeRow q={n} onQ={desk.onQ} />
            <div className="grid grid-cols-2 gap-2">
              <Act side={sells ? 'sell' : 'buy'} count={n} at={Number.isFinite(natural) ? `${natural.toFixed(2)} Mkt` : 'Mkt'} why={why.market} onPress={() => place('market')} />
              <Act side={sells ? 'sell' : 'buy'} count={n} at={`${num(limit) != null || Number.isFinite(natural) ? limitPx.toFixed(2) : '—'} Lmt`} why={why.limit} onPress={() => place('limit')} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={labelCls}>{sells ? 'Net credit' : 'Net debit'}</span>
              <PriceBox value={limit} onChange={setLimit} step={dir => setLimit(Math.max(0.01, limitPx + dir * 0.01).toFixed(2))} label="Net price" placeholder={Number.isFinite(natural) ? natural.toFixed(2) : '—'} />
              <button type="button" onClick={() => setLimit('')} className={quiet} title="The price the legs trade at now, each at its bid or ask">
                Market
              </button>
            </div>
            {facts.length > 0 && (
              <div className="grid grid-cols-4 max-[440px]:grid-cols-2 gap-x-3 gap-y-2" data-paper-strategy-facts>
                {facts.map(f => (
                  <Fact key={f.label} label={f.label} value={f.value} ink={f.ink} />
                ))}
              </div>
            )}
            <div className="font-mono text-t11 tnum leading-relaxed whitespace-normal break-words" data-order-status>
              {preview && !(sells && !desk.canSell) && (
                <div className="text-textSecondary" data-strategy-margin>
                  {sells ? <>Holds <span className="text-textPrimary font-semibold">{usd(preview.held)}</span> of margin · </> : null}free after <span className={preview.free < 0 ? 'text-bear font-semibold' : undefined}>{usdBal(preview.free)}</span> <span className="text-textMuted">· fees {usd(fees)}</span>
                </div>
              )}
              {why.market && why.limit ? <div className="text-warn">{why.market === why.limit ? why.market : `Market — ${why.market} · Limit — ${why.limit}`}</div> : <div className="text-textMuted">{kind === 'condor' ? 'One order: both spreads fill together, each leg at its own bid or ask, or nothing fills' : 'Each leg at its own bid or ask — a sale at the bid, a buy at the ask'}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StrategyBuilder;
