/*
==================================================
  SLAYER TERMINAL - WHERE THIS BOOK COMES FROM
  (components/gex/BookProvenance.tsx)

  The data door on the Map's band and the card behind
  it (the competitive audit, 2026-10-13: the category's
  own disclaimers call a demo book "not valid for live
  trading", and a serious exposure map prints its
  provenance and its method on screen — the feed, the
  open interest's date, the price the hedging is read
  at, the formula, the sign, the units, what each level
  is and what the other products call it). The door
  says the source in two words when a feed is on, and
  only "Data" on the house book (the owner, 2026-10-13:
  the site is theirs alone, it need not say simulated
  anywhere); the card says the rest, in the house's
  words.
==================================================
*/

import { Database } from 'lucide-react';
import { ASSUMPTION_WORDS, freshnessOf } from '../../data/levelSureness';
import { GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';

const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'VEX', vanna: 'VANNA', charm: 'CHARM' };
const fmtStrike = (v: number) => (!Number.isFinite(v) ? '—' : v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/** The source, in two words — for the door and the chip */
export function sourceWords(): { short: string; long: string; live: boolean } {
  /* the house book until the market feed is wired (data-providers decision: the feed lands behind this same seam) */
  return { short: 'House book', long: "the terminal's own chain, open interest and tape, built in the terminal", live: false };
}

interface DoorProps {
  ticker: string;
  open: boolean;
  onClick: () => void;
  /** The icon alone, for a band that measured itself tight */
  compact?: boolean;
}

/** THE DATA DOOR — first on the doors row: the source in a word, the rest on the card */
export const DataDoor = ({ ticker, open, onClick, compact = false }: DoorProps) => {
  const src = sourceWords();
  const title = `${src.live ? 'Live · ' : ''}${freshnessOf(ticker)} · click for where the figures come from and how they are computed`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      aria-label={src.live ? `Data: ${src.short}` : 'Data'}
      aria-haspopup="dialog"
      title={title}
      className={`hit inline-flex items-center gap-1.5 h-7 rounded-md border bg-chip transition-colors font-mono select-none ${compact ? 'w-7 justify-center' : 'px-2.5'} ${open ? 'border-silver/50' : 'border-borderSubtle hover:border-borderMuted hover:bg-ink/[0.04]'}`}
      data-ledger-data-door={src.live ? 'live' : 'house'}
    >
      <Database className={`w-3 h-3 ${src.live ? 'text-silver' : 'text-textMuted'}`} />
      {!compact && (
        <>
          <span className="text-[11px] text-textMuted">Data</span>
          {src.live && <span className="text-[11px] font-semibold text-textPrimary">{src.short}</span>}
        </>
      )}
    </button>
  );
};

interface CardProps {
  ticker: string;
  surface: ExposureSurface;
  greeks: Greek[];
  /** The expiry columns drawn, as surface indices */
  expiries: number[];
  rings: number;
  view: string;
}

const Formula = ({ greek, words, unit }: { greek: string; words: string; unit: string }) => (
  <li className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 items-baseline">
    <span className="font-mono text-[11px] font-semibold text-textPrimary">{greek}</span>
    <span className="text-[11.5px] leading-relaxed text-textSecondary">
      {words} <span className="text-textMuted">· per {unit}</span>
    </span>
  </li>
);

/** The other products' names for the same levels — so a reader coming from one knows what they are looking at */
const LEVEL_NAMES: { ours: string; what: string; theirs: string }[] = [
  { ours: 'Call wall', what: 'the heaviest call-dominant strike above spot — hedging there absorbs a rise', theirs: 'Call Wall (SpotGamma, Unusual Whales) · Call Resistance (Menthor Q)' },
  { ours: 'Put wall', what: 'the heaviest put-dominant strike below spot — hedging there absorbs a fall', theirs: 'Put Wall (SpotGamma, Unusual Whales) · Put Support (Menthor Q)' },
  { ours: 'Flip', what: 'the midpoint of the two strikes where the book’s net changes sign nearest spot: above it hedging absorbs moves, below it amplifies them', theirs: 'Gamma flip (Unusual Whales, GEXBot) · HVL (Menthor Q) — not the Vol Trigger. SpotGamma’s Zero Gamma is the profile’s ZERO GAMMA line: the book re-priced across spot, a different number' },
  { ours: 'Supreme', what: 'the heaviest strike of the whole book, by the greek drawn — the one the chart wears in magenta', theirs: 'Absolute Gamma strike (SpotGamma) · GEX 1 (Menthor Q) · King Node (Skylit)' },
  { ours: 'Pin', what: 'the strike with the most open interest in the window — where price tends to settle into expiry', theirs: 'max-OI strike — not max pain, which is a different calculation' },
];

/** THE CARD — the source, the freshness, the formula, the sign, the levels, the window */
export const DataCard = ({ ticker, surface, greeks, expiries, rings, view }: CardProps) => {
  const src = sourceWords();
  const dates = expiries.map(e => surface.expiries[e]?.date).filter(Boolean);
  return (
    <div className="px-3 py-3 flex flex-col gap-3" data-book-provenance-card data-book-source={src.live ? 'live' : 'house'}>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">Where the figures come from</p>
        <ul className="mt-1 flex flex-col gap-1 text-[11.5px] leading-relaxed text-textSecondary">
          <li>
            <span className="text-textMuted">Source · </span>
            {src.long}.
          </li>
          <li>
            <span className="text-textMuted">Freshness · </span>
            {freshnessOf(ticker)}.
          </li>
          <li>
            <span className="text-textMuted">Cadence · </span>
            {src.live ? 'the book by strike is asked every 30 seconds, the calendar by listed date with it, the price every 10 seconds; the page redraws as an answer lands' : 'the book is rebuilt every 10 seconds; the price moves every tick'}.
          </li>
        </ul>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">What a figure is</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          Every cell is dollars of stock dealers must trade to stay hedged, for one unit of the thing named — summed over the contracts open at that strike and date: the greek per contract × open interest × 100 shares × the spot price, scaled to the unit.
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          <Formula greek="GEX" words="gamma × OI × 100 × spot² × 1%" unit={GREEK_UNIT.gex} />
          <Formula greek="DEX" words="|delta| × OI × 100 × spot × one expected daily move" unit={GREEK_UNIT.dex} />
          <Formula greek="VEX" words={src.live ? 'vega × OI × 100 — not in the feed, so the column stays empty on live data' : 'vega × OI × 100'} unit={GREEK_UNIT.vex} />
          <Formula greek="VANNA" words="∂delta/∂vol × OI × 100 × spot, for one point of vol" unit={GREEK_UNIT.vanna} />
          <Formula greek="CHARM" words="∂delta/∂time × OI × 100 × spot, for one calendar day" unit={GREEK_UNIT.charm} />
        </ul>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">The sign, and the assumption under it</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-textSecondary">
          {ASSUMPTION_WORDS} A call-dominant strike reads <span className="text-textPrimary">negative</span> — dealer hedging there absorbs a move — and a put-dominant one <span className="text-textPrimary">positive</span> — hedging amplifies it. The net is the two legs added; the card on any cell shows the legs apart.
        </p>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-textPrimary">The levels, and what others call them</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          {LEVEL_NAMES.map(l => (
            <li key={l.ours} className="text-[11.5px] leading-relaxed text-textSecondary">
              <span className="font-semibold text-textPrimary">{l.ours}</span> — {l.what}. <span className="text-textMuted">Elsewhere: {l.theirs}.</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-borderSubtle/60 pt-2.5">
        <p className="text-[11px] text-textMuted">This box right now</p>
        <ul className="mt-1 flex flex-col gap-1 text-[11.5px] leading-relaxed text-textSecondary">
          <li>
            <span className="font-mono tnum text-textPrimary">{ticker}</span> at <span className="font-mono tnum text-textPrimary">{surface.spot.toFixed(2)}</span> · the {view} · {greeks.map(g => GREEK_LABEL[g]).join(', ')} · {rings} strikes each side of spot
          </li>
          <li>
            Expiries drawn: <span className="text-textPrimary">{dates.join(' · ') || '—'}</span> ({dates.length} of the {surface.expiries.length} the book holds)
          </li>
          <li>
            Levels now: call wall <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.callWall)}</span> · flip <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.flip)}</span> · put wall <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.putWall)}</span> · pin <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.pin)}</span> · supreme <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.supreme)}</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
