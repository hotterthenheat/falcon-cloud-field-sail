/* A Model Risk call in the same card as Books A, B and C. The mark is the tail, so it is not read as those books. */

import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import { nyClock } from '../../core/nyTime';
import { usd2 as money } from '../../core/format';
import { tailReturn, type TailPublic, type TailTicket } from '../../data/modelRisk';
import { pctWord, returnInk } from '../../data/compassReturn';
import { useContractLive } from '../../data/thetaBook';
import ContractLabel from '../ui/ContractLabel';
import { Tip } from '../ui/Tooltip';

/** The tail-risk mark. Not a company logo. */
export const TailMark = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="shrink-0" data-tail-mark>
    <rect x="0.75" y="0.75" width="16.5" height="16.5" rx="4" className="fill-warn/15 stroke-warn/70" strokeWidth="1" />
    <path d="M4.2 13.2c2.1-1.1 3.3-3.4 3.5-5.8.2-2 1.15-3.4 3.1-4.1" fill="none" className="stroke-warn" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="12.15" cy="4.15" r="1.35" className="fill-warn" />
  </svg>
);

const Stat = ({ label, value, ink = 'text-textPrimary', right = false }: { label: string; value: string; ink?: string; right?: boolean }) => (
  <span className={`flex flex-col gap-0.5 min-w-0 ${right ? 'items-end text-right' : ''}`}>
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{label}</span>
    <span className={`font-mono text-t13 font-semibold tnum ${ink}`}>{value}</span>
  </span>
);

const expChip = (t: TailTicket): string => {
  const iso = (t.expiry || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const book = t.book === '0' ? '0DTE' : '1–7 DTE';
  return m ? `${book} · ${m[2]}/${m[3]}/${m[1].slice(2)}` : book;
};

const scoreWord = (n: number): string => {
  if (!(n > 0)) return '—';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toPrecision(2);
};

const gexWord = (n: number | null): string => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

const TailRiskCard = ({ ticket: t, rank, onOpen }: { ticket: TailTicket; rank: number; onOpen: (t: TailTicket) => void }) => {
  const closed = t.why != null && t.exitBid != null;
  const live = useContractLive(t.root || t.ticker, t.expiry, t.strike, t.right, !closed);
  const liveBid = !closed && live && live.ask > 0 && live.bid >= 0 && live.ask >= live.bid ? live.bid : NaN;
  const ret = closed
    ? tailReturn(t.entryAsk, t.exitBid as number)
    : t.entryAsk > 0 && Number.isFinite(liveBid)
      ? (liveBid - t.entryAsk) / t.entryAsk
      : null;
  const pnlWord = ret != null && Number.isFinite(ret) ? pctWord(ret * 100) : '—';
  const back = t.right === 'C' ? 'back through the low' : 'back through the high';
  const why = !closed
    ? 'Open'
    : t.why === 'back'
      ? `Out ${money(t.exitBid as number)} · ${back}`
      : t.why === 'held'
        ? `Out ${money(t.exitBid as number)} · the break held`
        : `Out ${money(t.exitBid as number)} · 15:59`;
  const line = t.right === 'C' ? 'Call under the last 30 closes' : 'Put above the last 30 closes';
  const when = [t.entryAt ? `Called ${nyClock(t.entryAt, { zone: true })}` : '', closed && t.exitAt ? `Left ${nyClock(t.exitAt, { zone: true })}` : ''].filter(Boolean).join(' · ');
  const linePx = t.right === 'C' ? t.orLow : t.orHigh;

  return (
    <article
      className="text-left rounded-md border border-borderSubtle bg-ink/[0.015] hover:border-borderMuted p-3.5 flex flex-col gap-3"
      data-tail-ticket={t.id}
      data-tail-book={t.book}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-t10 text-textMuted tnum">#{rank}</span>
        <Tip label="Model Risk. Not Book A, B or C.">
          <span className="inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-wider text-warn border border-warn/40 rounded px-1.5 py-0.5" data-tail-logo>
            <TailMark size={14} />
            Tail risk
          </span>
        </Tip>
        <ContractLabel contract={t.contract} right={t.right} logo={t.ticker} />
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">{expChip(t)}</span>
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">Book {t.book}</span>
        <span className={`ml-auto font-mono text-t10 uppercase tracking-wider ${closed ? 'text-textPrimary' : 'text-textPrimary'}`}>{closed ? 'Closed' : 'Open'}</span>
      </div>
      <p className="font-mono text-t10 text-textMuted whitespace-normal break-words" data-card-times>
        {[line, why, when].filter(Boolean).join(' · ')}
      </p>
      <div className="grid grid-cols-4 gap-2 items-start" data-card-numbers>
        <Stat label="Score" value={scoreWord(t.score)} />
        <Stat label="Ask" value={t.entryAsk > 0 ? money(t.entryAsk) : '—'} />
        <Stat label={closed ? 'Exit' : 'Bid'} value={closed ? money(t.exitBid as number) : Number.isFinite(liveBid) ? money(liveBid) : '—'} />
        <Stat label="P&L" value={pnlWord} ink={ret == null || !Number.isFinite(ret) ? 'text-textMuted' : returnInk(ret * 100)} right />
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-t10 text-textSecondary tnum" data-card-distances>
        <span>At call <span className="text-textPrimary">{t.entryBid > 0 || t.entryAsk > 0 ? `${t.entryBid.toFixed(2)} × ${t.entryAsk.toFixed(2)}` : '—'}</span></span>
        <span>Line <span className="text-textPrimary">{linePx > 0 ? linePx.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</span></span>
        <span>GEX <span className="text-textPrimary">{gexWord(t.gex)}</span></span>
        <span>30 min</span>
      </div>
      <div className="flex items-start gap-2">
        <span className="flex items-start gap-1.5 font-mono text-t11 text-warn min-w-0 whitespace-normal">
          <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{closed ? (t.why === 'back' ? `Sold the bid. The close came ${back}.` : t.why === 'held' ? 'Sold the bid. Thirty minutes, and the close never came back.' : 'Sold the bid at 15:59.') : 'One contract. Sell the bid when the close comes back through the line, or after 30 minutes if it does not.'}</span>
        </span>
        <button
          type="button"
          onClick={() => onOpen(t)}
          className="slayer-chip ml-auto shrink-0 uppercase tracking-wider"
          data-tail-open
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
    </article>
  );
};

const sameName = (ticker: string | null, name: string): boolean => {
  if (!ticker) return true;
  if (name === ticker) return true;
  if (ticker === 'SPX' && (name === 'SPXW' || name === 'XSP')) return true;
  if (ticker === 'NDX' && name === 'NDXP') return true;
  if (ticker === 'RUT' && name === 'RUTW') return true;
  return false;
};

const TailRiskStrip = ({
  tail,
  book,
  right,
  ticker,
  onOpen,
}: {
  tail: TailPublic;
  book: '0' | '1-7';
  right: 'C' | 'P' | 'BOTH';
  ticker: string | null;
  onOpen: (t: TailTicket) => void;
}) => {
  const match = (t: TailTicket) => t.book === book && (right === 'BOTH' || t.right === right) && sameName(ticker, t.ticker);
  const rows = [...tail.open.filter(match), ...tail.closed.filter(match).slice(0, 8)];
  const bookWord = book === '0' ? '0DTE' : '1–7 DTE';
  return (
    <div className="border-t border-borderSubtle px-5 pt-4 pb-4" data-tail-risk>
      <p className="flex items-center gap-2 font-mono text-t10 uppercase tracking-wider text-textMuted" data-tail-line>
        <TailMark />
        <span>
          Model Risk · {bookWord}. {tail.line.replace(/^Tail risk\.\s*/, '')}
        </span>
      </p>
      {rows.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3" data-tail-cards>
          {rows.map((t, i) => (
            <TailRiskCard key={t.id} ticket={t} rank={i + 1} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="mt-2 font-mono text-t11 text-textSecondary" data-tail-empty>No {bookWord} call on this sleeve.</p>
      )}
    </div>
  );
};

export default TailRiskStrip;
