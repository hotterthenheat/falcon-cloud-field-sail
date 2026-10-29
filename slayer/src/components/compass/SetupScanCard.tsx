/*
==================================================
  SLAYER TERMINAL - SETUP SCAN CARD (SetupScanCard.tsx)
  One ranked contract on the two-axis board. Partner's
  information architecture (docs/compass-redesign-port.md),
  OUR ink: his cards render every datum in neutral gray —
  structure without direction. Here the contract pill and
  score lean with the market, achievement wears bull, and
  process states stay chrome. Labels whisper, numbers never.
==================================================
*/

import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import type { Setup } from '../../types/compass';
import { nyClock } from '../../core/nyTime';
import ContractLabel from '../ui/ContractLabel';
import SessionSpark from './SessionSpark';
import { entryAsk } from '../../data/compassModel';
import { MODELS_VALIDATED, UNVALIDATED_LINE, UNVALIDATED_WORD } from '../../data/compassParams';
import { useContractLive } from '../../data/thetaBook';
import { STOP_KEEP } from '../../data/contractQuote';
import { Tip } from '../ui/Tooltip';

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
  if (setup.band === 'lottery') return 'Book C. No model. No stop. Flat at 15:50.';
  if (setup.band === 'wing') return 'Book B. Model 2 exit, even under 50%.';
  if (setup.band === 'average') return 'Average.';
  if (setup.runner) return 'Model 2 runner. Stop ratchets. Flat at 15:55.';
  return 'Model 1. Out at 1.50 × the ask, or the stop.';
};

const placeWord = (setup: Setup): string => {
  const spot = setup.spot ?? 0;
  if (!(spot > 0) || !(setup.strike > 0)) return '';
  const pts = setup.right === 'C' ? spot - setup.strike : setup.strike - spot;
  if (Math.abs(pts) / spot < 0.0015) return 'ATM';
  return `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
};

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const pinned = entryAsk(setup.id);
  const entry = pinned > 0 ? pinned : setup.ask > 0 ? setup.ask : 0;
  const live = useContractLive(setup.ticker, setup.expiryDate, setup.strike, setup.right, priced && !!setup.expiryDate);
  const liveBid = live ? (live.bid > 0 && live.ask >= live.bid ? live.bid : NaN) : priced && setup.bid > 0 ? setup.bid : NaN;
  const captured = entry > 0 && Number.isFinite(liveBid) ? ((liveBid - entry) / entry) * 100 : NaN;
  const stopPx = priced && setup.band !== 'lottery' && entry > 0 ? Number((entry * STOP_KEEP).toFixed(2)) : 0;
  const place = placeWord(setup);
  const model = setup.p1 != null
    ? `${holdOf(setup)} Model 1 ${(setup.p1 * 100).toFixed(1)}%.${setup.prun != null ? ` Model 2 ${(setup.prun * 100).toFixed(0)}%.` : ''}${MODELS_VALIDATED ? '' : ` ${UNVALIDATED_LINE}`}`
    : setup.band === 'lottery'
      ? holdOf(setup)
      : '';
  const when = [
    (live?.at || setup.quotedAt) ? `Quote ${nyClock(live?.at || setup.quotedAt, { seconds: true, zone: true })}` : '',
    ticket && setup.seenAt ? `Called ${nyClock(setup.seenAt, { seconds: true, zone: true })}` : '',
  ].filter(Boolean);
  const sigma = setup.greeks.iv > 0 && setup.sigmaMovePct > 0 ? `IV move ±${setup.sigmaMovePct}%` : '';
  const status = priced ? [place, sigma, model, ...when].filter(Boolean).join(' ') : (setup.whyText || 'Not a ticket.');
  const capturedWord = Number.isFinite(captured) ? `${captured >= 0 ? '+' : '−'}${Math.abs(captured).toFixed(1)}%` : '—';

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
          <span className="font-mono text-t10 uppercase tracking-wider text-textPrimary border border-silver/40 rounded px-1.5 py-0.5">{tagOf(setup)}</span>
        ) : null}
        {ticket ? (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textPrimary">Called</span>
        ) : closest ? (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textSecondary">Not a call</span>
        ) : (
          <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textMuted">Passed</span>
        )}
      </div>
      <p className="font-mono text-t10 text-textMuted whitespace-normal break-words" data-card-times>
        {priced ? status : [place, status, ...when].filter(Boolean).join(' ')}
      </p>

      {priced ? (
        <div className="flex items-start justify-between gap-2">
          <Stat label="Entry" value={entry > 0 ? money(entry) : '—'} />
          <SessionSpark ticker={setup.ticker} points={live?.prem} width={96} height={30} />
          <Stat label="Bid" value={Number.isFinite(liveBid) ? money(liveBid) : '—'} />
          <Stat label="Captured" value={capturedWord} ink={!Number.isFinite(captured) ? 'text-textMuted' : captured >= 0 ? 'text-bull' : 'text-bear'} right />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-t11 text-textSecondary whitespace-normal" data-card-status>{setup.whyText || 'Not a ticket.'}</p>
          <SessionSpark ticker={setup.ticker} points={live?.prem} width={96} height={30} />
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
