/* The Map's data door and its card: the feed, the open interest's date, the price hedging is read at,
   the formula, sign and units, and what each level is. */

import { FLIP_RULE } from '../../data/flipLevel';
import { ASSUMPTION_WORDS, freshnessOf } from '../../data/levelSureness';
import { GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { peekEntry, peekGammaPriced, peekOiChange } from '../../data/uwBook';
import { levelsForName } from '../../data/levelsScope';
import { nyClock, nyDay, nyIsoDate, nySessionPhase } from '../../core/nyTime';
import { LEVEL_ORDER } from '../../core/walls';
import { fmtStrikeOrDash as fmtStrike } from '../../core/format';

const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'vega $', vanna: 'VANNA', charm: 'CHARM', color: 'COLOR', vomma: 'VOMMA', speed: 'SPEED', veta: 'VETA', zomma: 'ZOMMA' };

/** The book on screen is the vendor's live one (data/uwBook.ts) — not the house's own chain */
const isLive = (ticker?: string): boolean => {
  const e = ticker ? peekEntry(ticker) : undefined;
  return !!e && e.status === 'live' && !!e.gammaLive;
};

/** The source, in two words — for the door and the chip */
/* The card's source line follows the book actually on screen, never a hard-coded flag. */
export function sourceWords(ticker?: string): { short: string; long: string; live: boolean } {
  if (isLive(ticker))
    return {
      short: 'Market-data book',
      long: "The live open-interest book from our market-data feed: each strike's gamma, vanna and charm are its spot-exposures rows (open interest × the greek, repriced every minute — gamma as dollars per 1% move, vanna as dollars of delta per vol point, charm as dollars of delta per session). Delta is the greek-exposure rows. Open interest, vega and each contract's own implied vol are the option-contracts rows. The whole book is the sum of its expiries' own rows, not a separate whole-book total, which is a second snapshot and can differ (MU +$212M against +$155M summed)",
      live: true,
    };
  return { short: 'House book', long: "the terminal's own chain, open interest and tape, built in the terminal", live: false };
}

/** When and at what price the rows on screen were priced (the feed's own minute), and when their open interest was counted. */
export function bookFreshness(ticker: string): string {
  if (!isLive(ticker)) return freshnessOf(ticker);
  const front = Object.keys(peekEntry(ticker)?.byDate ?? {}).filter(d => d >= nyIsoDate()).sort()[0] ?? null;
  const all = peekGammaPriced(ticker, null);
  const one = front ? peekGammaPriced(ticker, front) : null;
  const p = levelsForName(ticker) === 'ALL' ? all ?? one : one ?? all;
  const oi = peekOiChange(ticker)?.currDate;
  const oiWords = oi ? `Open interest is the feed's daily count (dated ${nyDay(Date.parse(`${oi}T12:00:00Z`), { weekday: true })}) — set once a day, before the open` : "Open interest is the daily count — set once a day, before the open";
  if (!p) return `${oiWords} · the gamma is priced once a minute in the session`;
  const today = nyIsoDate(p.at) === nyIsoDate();
  const when = `${nyClock(p.at, { zone: true })}${today ? '' : ` ${nyDay(p.at, { weekday: true })}`}`;
  const live = nySessionPhase() === 'open' && today;
  return live
    ? `${oiWords} · the gamma is re-priced each minute at the live price — last at ${p.price.toFixed(2)}, ${when}`
    : `${oiWords} · the gamma is priced at ${p.price.toFixed(2)}, ${when} — the last pricing; it re-prices each minute once the session opens`;
}

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
    <span className="font-mono text-t11 font-semibold text-textPrimary">{greek}</span>
    <span className="text-t115 leading-relaxed text-textSecondary">
      {words} <span className="text-textMuted">· per {unit}</span>
    </span>
  </li>
);

/** What each level is */
const LEVEL_NAMES: { ours: string; what: string }[] = [
  { ours: 'Supreme', what: 'the strike with the most net gamma, either sign, on the Levels card’s contracts (Today’s expiry, or every listed one) — the one the chart and the matrix wear in magenta' },
  { ours: 'Call wall', what: 'the strike with the most call gamma on the Levels card’s contracts (Today’s expiry, or every listed one), either side of spot — while dealers are long gamma there, their hedging slows a rise' },
  { ours: 'Put wall', what: 'the strike with the most put gamma on the Levels card’s contracts, either side of spot — below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling, or it can act as a magnet' },
  { ours: 'Flip', what: FLIP_RULE },
  { ours: 'Pin', what: 'the strike with the most open interest in the window — where price tends to settle into expiry (the max-OI strike, not max pain, which is a different calculation)' },
];

/** THE CARD — the source, the freshness, the formula, the sign, the levels, the window */
export const DataCard = ({ ticker, surface, greeks, expiries, rings, view }: CardProps) => {
  const src = sourceWords(ticker);
  const dates = expiries.map(e => surface.expiries[e]?.date).filter(Boolean);
  return (
    <div className="px-3 py-3 flex flex-col gap-3" data-book-provenance-card data-book-source={src.live ? 'live' : 'house'}>
      <div>
        <p className="text-t12 font-semibold text-textPrimary">Where the figures come from</p>
        <ul className="mt-1 flex flex-col gap-1 text-t115 leading-relaxed text-textSecondary">
          <li>
            <span className="text-textMuted">Source · </span>
            {src.long}.
          </li>
          <li>
            <span className="text-textMuted">Freshness · </span>
            {bookFreshness(ticker)}.
          </li>
          <li>
            <span className="text-textMuted">Cadence · </span>
            {src.live ? 'the feed prices its rows once a minute in the session; the page asks for the book about once a minute and each date’s rows with it, and redraws as an answer lands' : 'the book is rebuilt every 10 seconds; the price moves every tick'}.
          </li>
        </ul>
      </div>
      <div>
        <p className="text-t12 font-semibold text-textPrimary">What a figure is</p>
        <p className="mt-0.5 text-t115 leading-relaxed text-textSecondary">
          Every cell is dollars of stock dealers must trade to stay hedged, for one unit of the thing named — summed over the contracts open at that strike and date: the greek per contract × open interest × 100 shares × the spot price, scaled to the unit.
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          <Formula greek="GEX" words="gamma × OI × 100 × spot² × 1%" unit={GREEK_UNIT.gex} />
          <Formula greek="DEX" words="delta × OI × 100 × spot (dollars of stock)" unit={GREEK_UNIT.dex} />
          <Formula greek="VEX" words="vega × OI × 100, each contract at its own vol on the trading clock" unit={GREEK_UNIT.vex} />
          <Formula greek="VANNA" words="∂delta/∂vol × OI × 100 × spot × 1%" unit={GREEK_UNIT.vanna} />
          <Formula greek="CHARM" words="∂delta/∂time × OI × 100 × spot ÷ 252" unit={GREEK_UNIT.charm} />
        </ul>
      </div>
      <div>
        <p className="text-t12 font-semibold text-textPrimary">The sign, and the assumption under it</p>
        <p className="mt-0.5 text-t115 leading-relaxed text-textSecondary">
          {ASSUMPTION_WORDS} Every greek prints as the dealers hold it: a call leg's figure is the greek of the calls they are long, a put leg's the negative of the puts they are short — so call gamma is <span className="text-textPrimary">positive</span> and put gamma <span className="text-textPrimary">negative</span>, and the same rule signs delta, vega, vanna and charm. A strike that nets positive is call-heavy — dealers are long gamma there and their hedging absorbs a move (cool ink); one that nets negative is put-heavy — they are short gamma and hedging amplifies it (warm ink). The net is the two legs added; the card on any cell shows the legs apart.
        </p>
      </div>
      <div>
        <p className="text-t12 font-semibold text-textPrimary">The levels</p>
        <ul className="mt-1 flex flex-col gap-1.5">
          {LEVEL_NAMES.map(l => (
            <li key={l.ours} className="text-t115 leading-relaxed text-textSecondary">
              <span className="font-semibold text-textPrimary">{l.ours}</span> — {l.what.replace(/[.]\s*$/, '')}.
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-borderSubtle/60 pt-2.5">
        <p className="text-t11 text-textMuted">This box right now</p>
        <ul className="mt-1 flex flex-col gap-1 text-t115 leading-relaxed text-textSecondary">
          <li>
            <span className="font-mono tnum text-textPrimary">{ticker}</span> at <span className="font-mono tnum text-textPrimary">{surface.spot.toFixed(2)}</span> · the {view} · {greeks.map(g => GREEK_LABEL[g]).join(', ')} · {rings} strikes each side of spot
          </li>
          <li>
            Expiries drawn: <span className="text-textPrimary">{dates.join(' · ') || '—'}</span> ({dates.length} of the {surface.expiries.length} the book holds)
          </li>
          <li>
            Levels now ({levelsForName(ticker) === 'ALL' ? 'All expiries' : 'Today'}): {LEVEL_ORDER.map((role, i) => (
              <span key={role}>
                {i ? ' · ' : ''}
                {role} <span className="font-mono tnum text-textPrimary">{role === 'supreme' ? fmtStrike(surface.levels.supreme) : role === 'call wall' ? fmtStrike(surface.levels.callWall) : role === 'put wall' ? fmtStrike(surface.levels.putWall) : surface.levels.flipFound === false ? 'none within ±10%' : fmtStrike(surface.levels.flip)}</span>
              </span>
            ))}
            {surface.levels.pinFound === false ? null : <> · pin <span className="font-mono tnum text-textPrimary">{fmtStrike(surface.levels.pin)}</span></>}
          </li>
        </ul>
      </div>
    </div>
  );
};
