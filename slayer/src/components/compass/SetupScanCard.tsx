/* One Compass call as a card: the contract, its book, the live bid against the fill, the stop, and when it was
   quoted and called. Labels stay quiet; numbers carry the direction's ink. */

import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import type { Setup } from '../../types/compass';
import { nyClock } from '../../core/nyTime';
import ContractLabel from '../ui/ContractLabel';
import SessionSpark from './SessionSpark';
import { MODELS_VALIDATED, UNVALIDATED_LINE, UNVALIDATED_WORD } from '../../data/compassParams';
import { activeStop, signalOf } from '../../data/compassLedger';
import { optionFees } from '../../data/compassOutcome';
import { P1_MIN } from '../../data/compassParams';
import { STOP_KEEP } from '../../data/contractQuote';
import { Tip } from '../ui/Tooltip';
import { usd2 as money } from '../../core/format';
import { useContractLive } from '../../data/thetaBook';

const Stat = ({ label, value, ink = 'text-textPrimary', right = false }: { label: string; value: string; ink?: string; right?: boolean }) => (
  <span className={`flex flex-col gap-0.5 min-w-0 ${right ? 'items-end text-right' : ''}`}>
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{label}</span>
    <span className={`font-mono text-t13 font-semibold tnum ${ink}`}>{value}</span>
  </span>
);

interface SetupScanCardProps {
  setup: Setup;
  /** Global scan rank (1-based) — #1 wears the magenta crown. */
  rank: number;
  selected: boolean;
  onSelect: (setup: Setup) => void;
  onAnalysis: (setup: Setup) => void;
  /** MM/DD/YY of the real expiry session, resolved by the page's calendar. */
  expiryChip: string;
  /** The sweep's spark for this name — drawn until the name has a tape of its own. */
  spark?: number[];
}

const tagOf = (setup: Setup): string => {
  if (setup.band === 'closest') return 'Closest';
  if (setup.band === 'lottery') return 'Book C';
  if (setup.band === 'wing') return MODELS_VALIDATED ? 'Book B' : `Book B · ${UNVALIDATED_WORD}`;
  if (setup.band === 'top') return MODELS_VALIDATED ? 'Book A' : `Book A · ${UNVALIDATED_WORD}`;
  if (setup.band === 'scalp') return 'Scalp';
  if (setup.band === 'average') return 'Average';
  return '';
};

const holdOf = (setup: Setup): string => {
  if (setup.strength) return 'Held. Same trade.';
  if (setup.band === 'closest') return '';
  if (setup.band === 'lottery') return 'Book C. No score. No stop. Flat at 15:50.';
  if (setup.band === 'wing') return 'Book B. The exit rides, even under 50%.';
  if (setup.band === 'average') return 'Average.';
  if (setup.runner) return 'The exit rides. Stop ratchets. Flat at 15:55.';
  return 'Out at 1.50 × the ask, or the stop.';
};

const placeWord = (setup: Setup): string => {
  const spot = setup.spot ?? 0;
  if (!(spot > 0) || !(setup.strike > 0)) return '';
  const pts = setup.right === 'C' ? spot - setup.strike : setup.strike - spot;
  if (Math.abs(pts) / spot < 0.0015) return 'ATM';
  return `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
};

/** The contract's own expiration. Not the sleeve's calendar chip. */
export function ownExpiry(setup: { expiry: string; expiryDate?: string }): string {
  const iso = (setup.expiryDate || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return setup.expiry;
  return `${setup.expiry} · ${m[2]}/${m[3]}/${m[1].slice(2)}`;
}

const SetupScanCard = ({ setup, rank, selected, onSelect, onAnalysis }: SetupScanCardProps) => {
  const ticket = setup.band === 'top' || setup.band === 'wing' || setup.band === 'lottery';
  const closest = setup.band === 'closest';
  const priced = ticket || closest;
  const live = useContractLive(setup.ticker, setup.expiryDate || '', setup.strike, setup.right, priced && !!setup.expiryDate);
  const signal = ticket ? signalOf(setup.id) : null;
  const paid = signal?.outcome?.fill?.ask ?? 0;
  /* One quote, both sides. A live Theta quote replaces the scan's. Never a bid from one and an ask from the other, and never a mid standing in for a side the quote did not print. */
  const liveQuote = live && Number.isFinite(live.bid) && Number.isFinite(live.ask) && live.ask >= live.bid && live.ask > 0
    ? { bid: live.bid, ask: live.ask, at: live.at }
    : null;
  const scanQuote = !liveQuote && setup.ask > 0 && setup.bid >= 0 && setup.ask >= setup.bid
    ? { bid: setup.bid, ask: setup.ask, at: setup.quotedAt || 0 }
    : null;
  const quoted = liveQuote ?? scanQuote;
  const ask = quoted?.ask ?? 0;
  const bid = quoted?.bid ?? 0;
  const entry = paid > 0 ? paid : ask > 0 ? ask : 0;
  const liveBid = priced && bid > 0 && ask >= bid ? bid : NaN;
  const outcome = signal?.outcome ?? null;
  const runner = setup.band === 'wing' || setup.runner === true;
  /* the stop standing now: the ratchet's rung once the call has filled and run, else 0.4678 × the entry */
  const standing = paid > 0 && outcome ? activeStop(paid, outcome.peak, runner) : null;
  const stopPx = priced && setup.band !== 'lottery' && entry > 0 ? Number((standing ? standing.stop : entry * STOP_KEEP).toFixed(2)) : 0;
  /* a non-runner Book A leaves at 1.50 × the fill; a runner and Book B ride the ratchet; Book C sells 3× or 2× */
  const target = !priced || !(entry > 0) ? 0 : setup.band === 'lottery' ? Number((entry * 2).toFixed(2)) : runner ? 0 : Number((entry * 1.5).toFixed(2));
  const away = (px: number) => (Number.isFinite(liveBid) && liveBid > 0 && px > 0 ? `${px >= liveBid ? '+' : '−'}${Math.abs((px / liveBid - 1) * 100).toFixed(0)}%` : '');
  const closedOut = outcome?.status === 'closed' ? outcome : null;
  const pnl = closedOut?.pnl ?? (paid > 0 && Number.isFinite(liveBid) ? (liveBid - paid) * 100 - optionFees(liveBid) : NaN);
  const pnlWord = Number.isFinite(pnl) ? `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(0)}` : '—';
  const place = placeWord(setup);
  const line = setup.p1 == null ? '' : setup.p1 + 1e-12 >= P1_MIN ? 'The line cleared.' : 'Short of the line.';
  const model = setup.p1 != null
    ? `${holdOf(setup)} ${line}${MODELS_VALIDATED ? '' : ` ${UNVALIDATED_LINE}`}`
    : setup.band === 'lottery'
      ? holdOf(setup)
      : '';
  const when = [
    ticket && setup.late && setup.seenAt ? `Scored late from recorded quotes (${nyClock(setup.mark ?? setup.seenAt)} ET mark)` : '',
    ticket && !setup.late && setup.seenAt ? `Called ${nyClock(setup.seenAt, { zone: true })}` : '',
    setup.quotedAt || liveQuote?.at ? `Quote ${nyClock(liveQuote?.at || setup.quotedAt || 0, { seconds: true, zone: true })}` : '',
  ].filter(Boolean);
  const sigma = setup.greeks.iv > 0 && setup.sigmaMovePct > 0 ? `IV move ±${setup.sigmaMovePct}%` : '';
  const status = priced ? [place, sigma, ...when].filter(Boolean).join(' · ') : (setup.whyText || 'Not a ticket.');

  return (
    <Tip label={selected ? 'Selected. Click again for this contract.' : 'Select. Click again to open.'}>
    <button
      onClick={() => onSelect(setup)}
      aria-pressed={selected}
      className={`text-left rounded-md border p-3.5 flex flex-col gap-3 transition-colors ${
        selected
          ? 'border-silver/60 bg-silver/[0.04]'
          : 'border-borderSubtle bg-ink/[0.015] hover:border-borderMuted hover:bg-ink/[0.03]'
      }`}
      data-compass-card={setup.id}
      data-selected={selected || undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-t10 text-textMuted tnum">#{rank}</span>
        <ContractLabel contract={setup.contract} right={setup.right} logo={setup.ticker} />
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">
          {ownExpiry(setup)}
        </span>
        {tagOf(setup) ? (
          <Tip label={model || undefined}>
            <span className="font-mono text-t10 uppercase tracking-wider text-textPrimary border border-silver/40 rounded px-1.5 py-0.5">{tagOf(setup)}</span>
          </Tip>
        ) : null}
        {ticket && setup.late ? (
          <Tip label="The live scan missed this mark. It was scored afterwards from the quotes ThetaData recorded at the mark, never later ones.">
            <span className="font-mono text-t10 uppercase tracking-wider text-warn border border-warn/40 rounded px-1.5 py-0.5" data-card-late>Late</span>
          </Tip>
        ) : null}
        {ticket ? (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textPrimary">{closedOut ? 'Closed' : 'Called'}</span>
        ) : closest ? (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textSecondary">Not a call</span>
        ) : (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textMuted">Passed</span>
        )}
      </div>
      <p className="font-mono text-t10 text-textMuted whitespace-normal break-words" data-card-times>
        {priced ? status : [place, status, ...when].filter(Boolean).join(' · ')}
      </p>

      {priced ? (
        <>
          <div className="grid grid-cols-4 gap-2 items-start" data-card-numbers>
            <Stat label="The line" value={setup.p1 != null ? (setup.p1 + 1e-12 >= P1_MIN ? 'Cleared' : 'Short') : setup.band === 'lottery' ? 'None' : '—'} ink={setup.p1 != null && setup.p1 + 1e-12 >= P1_MIN ? 'text-bull' : 'text-textPrimary'} />
            <Stat label={paid > 0 ? 'Filled' : 'Ask'} value={entry > 0 ? money(entry) : '—'} />
            <Stat label={closedOut ? 'Exit' : 'Bid'} value={closedOut?.exit ? money(closedOut.exit.px) : Number.isFinite(liveBid) ? money(liveBid) : '—'} />
            <Stat label="P&L" value={pnlWord} ink={!Number.isFinite(pnl) ? 'text-textMuted' : pnl >= 0 ? 'text-bull' : 'text-bear'} right />
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-t10 text-textSecondary tnum" data-card-distances>
            <span>{signal ? 'At call' : 'Quote'} <span className="text-textPrimary">{signal ? `${signal.bid.toFixed(2)} × ${signal.ask.toFixed(2)}` : ask > 0 ? `${bid.toFixed(2)} × ${ask.toFixed(2)}` : '—'}</span></span>
            <span>{stopPx > 0 ? <>{standing?.name ?? 'Stop'} <span className="text-warn font-semibold">{money(stopPx)}</span> {away(stopPx)}</> : setup.band === 'lottery' ? 'No stop' : 'Stop —'}</span>
            <span>{target > 0 ? <>Target <span className="text-textPrimary font-semibold">{money(target)}</span> {away(target)}</> : runner ? 'Target: the ratchet' : ''}</span>
            <span className="ml-auto max-sm:hidden"><SessionSpark ticker={setup.ticker} points={signal?.spark.length ? signal.spark : undefined} width={64} height={22} /></span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-t11 text-textSecondary whitespace-normal" data-card-status>{setup.whyText || 'Not a ticket.'}</p>
          <SessionSpark ticker={setup.ticker} width={72} height={30} />
        </div>
      )}

      <div className="flex items-start gap-2">
        <span className="flex items-start gap-1.5 font-mono text-t11 text-warn min-w-0 whitespace-normal">
          <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
          {setup.band === 'lottery' ? (
            <span>No stop. 3× inside 120 seconds, 2× inside 30 seconds. Flat at 15:50 ET.</span>
          ) : closest && stopPx > 0 ? (
            <span>
              Not a call. Same ask, same stop at <span className="tnum font-semibold">{money(stopPx)}</span>. You decide.
            </span>
          ) : stopPx > 0 ? (
            <span>
              Stop at or under <span className="tnum font-semibold">{money(stopPx)}</span>. That is 0.4678 × the entry.
            </span>
          ) : (
            <span>{setup.whyText || 'Not a ticket.'}</span>
          )}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation();
            onAnalysis(setup);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              onAnalysis(setup);
            }
          }}
          className="slayer-chip ml-auto shrink-0 uppercase tracking-wider"
          data-compass-open
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </span>
      </div>
    </button>
    </Tip>
  );
};

export default SetupScanCard;
