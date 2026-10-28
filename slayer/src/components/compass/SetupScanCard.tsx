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
import { timeIfSits } from '../../data/compass';
import { nyClock } from '../../core/nyTime';
import SignalBadge from '../ui/SignalBadge';
import ContractLabel from '../ui/ContractLabel';
import SessionSpark from './SessionSpark';
import { processState, PROCESS_META } from './setupProcess';

const Stat = ({ label, value, ink = 'text-textPrimary', right = false }: { label: string; value: string; ink?: string; right?: boolean }) => (
  <span className={`flex flex-col gap-0.5 min-w-0 ${right ? 'items-end text-right' : ''}`}>
    <span className="font-mono text-[9px] uppercase tracking-wider text-textMuted">{label}</span>
    <span className={`font-mono text-[13px] font-semibold tnum ${ink}`}>{value}</span>
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
  if (setup.band === 'scalp') return 'Scalp';
  if (setup.band === 'average') return '31%';
  if (setup.band === 'wing') return 'Wing';
  if (setup.band === 'top') return '70.67%';
  return '';
};

const holdOf = (setup: Setup): string => {
  if (setup.strength) return `Held up to ${tagOf(setup) || 'the next rung'}. Same trade.`;
  if (setup.band === 'closest') return 'Closest. Not a call.';
  if (setup.band === 'scalp') return 'Scalp. Tape agrees. Out at +10, +20, +30. Stop −15%.';
  if (setup.band === 'wing') return 'Wing. 15 delta. Out at 3×. Stop −50%.';
  if (setup.band === 'average') return '31% swing. Out at +50%, or let it run.';
  if (setup.modelAgree) return 'Swing. Both models, one contract.';
  if (setup.better === 'runner') return 'Swing. Runner is the better hold.';
  return 'Swing. Entry is the better hold.';
};

const placeWord = (setup: Setup): string => {
  const spot = setup.spot ?? 0;
  if (!(spot > 0) || !(setup.strike > 0)) return 'ATM ± 4';
  const pts = setup.right === 'C' ? spot - setup.strike : setup.strike - spot;
  if (Math.abs(pts) / spot < 0.0015) return 'ATM';
  return `${Math.abs(pts).toFixed(0)} pts ${pts > 0 ? 'ITM' : 'OTM'}`;
};

const SetupScanCard = ({ setup, rank, selected, onSelect, onAnalysis, expiryChip, spark }: SetupScanCardProps) => {
  const state = processState(setup);
  const meta = PROCESS_META[state];
  const odte = setup.sleeve === 'odte';
  const ask = setup.ask > 0 ? setup.ask : setup.mid;
  const stop = ask * (setup.band === 'wing' ? 0.5 : setup.band === 'scalp' ? 0.85 : 1 - 0.5322);
  const stopPx = Number(stop.toFixed(2));
  const hold = !odte ? timeIfSits(setup.spot ?? 0, setup.strike, setup.right, setup.ask > 0 ? setup.ask : setup.mid) : 0;

  return (
    <button
      onClick={() => onSelect(setup)}
      aria-pressed={selected}
      title={selected ? "Selected — click again for the setup's page" : 'Select — click again to open'}
      /* Selected = the "where you are" ink — Noah asked for a white border on
         2026-08-19; since the 2026-09-05 doctrine that ink is the holo silver
         everywhere, and the walk (2026-09-11) brought the card in line. One
         click selects and points the rail at this name; a second opens. */
      className={`text-left rounded-md border p-3.5 flex flex-col gap-3 transition-colors ${
        selected
          ? 'border-silver/60 bg-silver/[0.04]'
          : 'border-borderSubtle bg-ink/[0.015] hover:border-borderMuted hover:bg-ink/[0.03]'
      }`}
      data-compass-card={setup.id}
      data-selected={selected || undefined}
    >
      {/* identity row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-textMuted tnum">#{rank}</span>
        {/* the name's mark and the whole contract in its side's ink — one component for every surface (2026-09-13) */}
        <ContractLabel contract={setup.contract} right={setup.right} logo={setup.ticker} />
        <span className="font-mono text-[10px] text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">
          {setup.expiry} · {expiryChip}
        </span>
        {tagOf(setup) ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-textPrimary border border-silver/40 rounded px-1.5 py-0.5">{tagOf(setup)}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <SignalBadge tone={meta.tone} dot pulse={meta.pulse}>
            {state}
          </SignalBadge>
        </span>
      </div>
      <p className="font-mono text-[10px] text-textMuted truncate" data-card-times>
        {placeWord(setup)}
        {setup.p1 != null ? ` · ${holdOf(setup)} · p1 ${(setup.p1 * 100).toFixed(1)}%${setup.prun != null ? ` · prun ${(setup.prun * 100).toFixed(0)}%` : ''}` : ''}
        {setup.quotedAt ? ` · Quote ${nyClock(setup.quotedAt, { seconds: true, zone: true })}` : ''}
        {setup.seenAt ? ` · Called ${nyClock(setup.seenAt, { seconds: true, zone: true })}` : ''}
      </p>

      {/* Stat row — edge-anchored like the rows above and below it (Noah,
          2026-08-17: a half-width cell read as "floating in the middle").
          "Premium", not "Mid": one concept, one name — it's the same number
          the campaign card calls Premium (the bid/ask midpoint). No score or
          health cells: grades are engine-internal (2026-08-16). */}
      <div className="flex items-start justify-between gap-2">
        <Stat label="1σ move" value={`±${setup.sigmaMovePct}%`} />
        {/* The underlying's REAL session tape (Noah, 2026-08-17 — his
            partner's cards wear zigzag decorations; ours draws the data) */}
        <SessionSpark ticker={setup.ticker} points={spark} width={96} height={30} />
        <Stat label="Ask" value={`$${(setup.ask > 0 ? setup.ask : setup.mid).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} right />
      </div>

      {/* Thesis chips removed (Noah, 2026-08-17: "way too redundant and
          doesnt really explain anything") — the whyText prose on the
          campaign page does the explaining. */}

      {/* what kills it + analysis */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-warn min-w-0" title="Out if the bid is at or under the stop. On a weekly, sits is the extrinsic, per contract, if it expires here.">
          <TriangleAlert className="w-3 h-3 shrink-0" />
          <span className="truncate">
            Stop ≤ <span className="tnum font-semibold">${stopPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {hold > 0 && <> · sits <span className="tnum font-semibold">−${hold.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span></>}
          </span>
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
          title="Open the setup's page"
          className="slayer-chip ml-auto shrink-0 uppercase tracking-wider"
          data-compass-open
        >
          Open
          <ArrowUpRight className="w-3 h-3" />
        </span>
      </div>
    </button>
  );
};

export default SetupScanCard;
