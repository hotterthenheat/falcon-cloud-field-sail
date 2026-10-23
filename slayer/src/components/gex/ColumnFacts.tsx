/*
==================================================
  SLAYER TERMINAL - A NAME'S OWN FACTS
  (components/gex/ColumnFacts.tsx)

  The facts the page head used to print for the
  room's name alone (the owner, 2026-10-14: "what if
  i have 3 or 4 names up? makes no sense to have
  this up"): each column of the Map's book carries
  its own — the price, the change, the flip and its
  distance in the Ruler's unit, the dealers' word,
  and how the flip held today by the report's rule.
  The head's grammar one size down: tracked caps for
  the names, the figures beside them, hairlines
  between, one mono line. A narrow column sheds the
  extras one at a time, never clips.
==================================================
*/

import { useMemo } from 'react';
import type { MarketSnapshot } from '../../types/market';
import { bookCandles, dayBars, ensureBook, peekDaySigma, peekIv, useBookRev } from '../../data/uwBook';
import { roomLevels } from '../../data/roomLevels';
import type { LevelsScope } from '../../data/levelsScope';
import { levelTicks } from '../../data/levelRecord';
import { sessionBars } from '../../data/levelview';
import { fmtDistance, impliedDaySigma, sessionAtr } from '../../data/atr';
import { useDistanceUnit } from '../../data/distanceUnits';
import { useRoomSpot } from '../../pages/pinpoint/useRoomSpot';
import { ABSORB, AMPLIFY, FLIP } from './paletteInk';
import DayMoveText from './DayMoveText';

const fmt = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

/* the hairline between two facts — the head's rule */
const SEP = 'border-l border-borderSubtle pl-2.5';

/* THE WIDTH A PIECE TAKES, BY ARITHMETIC (2026-10-14): the row's fit was found by drawing it and reading scrollWidth, up to
   four times — each read a layout of the whole page, 238ms of the click that adds a name. The data face is the house's
   Helvetica with tabular figures: a figure or a lower-case letter is at most 0.6em, a tracked capital 0.74em (checked
   against the drawn row at 1920, 1440 and a phone); the gaps are the row's own. Nothing is read off the page. */
const ch = (text: string, px: number, tracked = false) => text.length * px * (tracked ? 0.74 : 0.6);
const GROUP = 21; /* gap-x-2.5, the hairline, pl-2.5 */

interface Props {
  ticker: string;
  snapshot: MarketSnapshot;
  scope: LevelsScope;
  /** the column's width — the field's promise for it (its tile width) */
  width: number;
  /** the replay: the price is the replayed one, and the day's count is left out (it counts the whole day) */
  fresh?: boolean;
}

const ColumnFacts = ({ ticker, snapshot, scope, width, fresh = false }: Props) => {
  /* ONE PRICE ON THE PAGE: the same live reading the matrix's spot pill prints; the replayed snapshot's in the replay */
  const live = useRoomSpot(ticker, !fresh);
  const spot = live ?? snapshot.spot;
  const change = snapshot.changePercent ?? 0;
  const unit = useDistanceUnit();
  const bookRev = useBookRev();
  ensureBook(ticker, 'board');
  const levels = roomLevels(snapshot, scope);
  /* nothing provisional (the fourth audit's M1): until the levels' contracts are all in, "…" */
  const pending = !!snapshot.liveBook && levels?.complete === false;
  const flip = levels && levels.flipFound !== false && levels.flip != null && Number.isFinite(levels.flip) ? levels.flip : null;
  /* THE REGIME IS THE SIGN OF NET GAMMA AT SPOT (data/flipLevel.ts) — never the side of the flip */
  const absorb = levels?.net != null ? levels.net < 0 : flip != null && spot >= flip;
  const hasRegime = !!levels && (levels.net != null || flip != null);
  /* a hair either side of the flip is neither regime (data/gex.ts readHeatPattern's AT_FLIP, 0.05%) */
  const onFlip = flip != null && (Math.abs(spot - flip) / Math.max(spot, 1)) * 100 < 0.05;
  /* the ATR of finished sessions moves once a day; read it only when the Ruler asks for it */
  const atr = useMemo(() => (unit === 'ATR' ? sessionAtr(bookCandles(ticker) ?? dayBars(ticker) ?? []) : null), [unit, ticker, bookRev]);
  const away = flip != null ? flip - spot : null;
  const atSpot = away != null && Math.abs(away) < spot * 0.00005;
  const iv = peekIv(ticker) ?? 0;
  const lead =
    away == null
      ? ''
      : unit === '%'
        ? `${Math.abs((away / spot) * 100).toFixed(2)}%`
        : fmtDistance(away, spot, unit, { atr, sigma: unit === 'σ' ? peekDaySigma(ticker) ?? impliedDaySigma(spot, iv) : null }).replace(/^[+−]/, '');
  /* HOW THE FLIP HELD TODAY — the report's own count (data/levelRecord.ts), the head's before it */
  const bars = (bookCandles(ticker) ?? dayBars(ticker))?.length ?? 0;
  const side: 'call' | 'put' = flip != null && flip >= spot ? 'call' : 'put';
  const held = useMemo(() => {
    if (fresh || flip == null) return null;
    const ticks = levelTicks(sessionBars(ticker) ?? [], flip, side);
    const broke = ticks.filter(t => t.kind === 'broke').length;
    return { tests: ticks.length, broke };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, flip, side, bars, fresh]);
  const heldWords = held ? (held.tests === 0 ? 'untested' : held.broke === 0 ? `held all ${held.tests}` : `broke ${held.broke} of ${held.tests}`) : null;

  /* A NARROW COLUMN SHEDS, NEVER CLIPS (the audit, four names at 1440: the row ended at "DEALER"): the day's count goes
     first, then the dealers' label (its word stays, in its ink), then the flip's distance, then the change — the words
     before the figures */
  const priceW = ch(spot.toFixed(2), 14);
  /* the move outside the session rides with the day's change ("−1.18% · after hours +0.05%"): the change sheds it last */
  const extPct = snapshot.dayMove?.extPct;
  const changeW = 6 + ch(`${change > 0 ? '+' : ''}${change.toFixed(2)}%`, 11);
  const extW = extPct != null ? 8 + ch(`· after hours +${Math.abs(extPct).toFixed(2)}%`, 11) : 0;
  const flipW = GROUP + ch('Flip', 11, true) + 6 + ch(flip != null ? fmt(flip) : 'none', 12);
  const distW = flip != null && lead ? 6 + ch(atSpot ? 'at spot' : `${lead} ${away! > 0 ? 'above' : 'below'}`, 11) : 0;
  const dealersLabelW = hasRegime ? ch('Dealers', 11, true) + 6 : 0;
  const dealersW = hasRegime ? GROUP + ch(onFlip ? 'either way' : absorb ? 'absorb' : 'amplify', 11, true) : 0;
  const heldW = heldWords ? GROUP + ch('Flip today', 11, true) + 6 + ch(heldWords, 12) : 0;
  const room = (width > 0 ? width : 9999) - 24 - 16;
  const base = priceW + flipW + dealersW;
  /* the last step: the dealers' word goes and the flip's figure wears its ink — ember amplifies, glacier absorbs */
  /* the after-hours figure outranks the flip's day count and the dealers' label: they shed first to make it room */
  const shedRaw = base + changeW + distW + dealersLabelW + heldW <= room ? 0 : base + changeW + distW + dealersLabelW <= room ? 1 : base + changeW + distW <= room ? 2 : base + changeW <= room ? 3 : base <= room ? 4 : 5;
  /* with an after-hours figure: the flip's day count, then the dealers' label shed to make it room; past that it goes */
  let shed = shedRaw;
  let showExt = false;
  if (extW > 0) {
    const core = base + changeW + extW + distW;
    if (core + dealersLabelW + heldW <= room) [shed, showExt] = [0, true];
    else if (core + dealersLabelW <= room) [shed, showExt] = [1, true];
    else if (core <= room) [shed, showExt] = [2, true];
  }
  const regimeInk = !hasRegime ? undefined : absorb ? ABSORB : AMPLIFY;

  return (
    <div className="shrink-0 flex items-baseline gap-x-2.5 px-3 h-8 pt-2 border-b border-borderSubtle/60 font-mono whitespace-nowrap overflow-hidden" data-field-column-facts={ticker} data-facts-shed={shed || undefined}>
      <span className="text-[14px] font-semibold tnum text-textPrimary leading-none" data-facts-price>
        {spot.toFixed(2)}
      </span>
      {shed < 4 && (
        <span className="-ml-1">
          <DayMoveText snapshot={snapshot} short={!showExt} />
        </span>
      )}
      <span className={`inline-flex items-baseline gap-1.5 ${SEP}`} title={flip != null ? `The gamma flip: the price where the book's net gamma crosses zero — dealers ${absorb ? 'are long gamma on this side and turn short' : 'are short gamma on this side and turn long'} past it` : "No flip within ±10%: the book's net gamma keeps one sign across the whole range"}>
        <span className="text-[11px] uppercase tracking-wider text-textMuted">Flip</span>
        <span className="text-[12px] font-semibold tnum" style={{ color: flip != null ? (shed >= 5 ? regimeInk : FLIP) : undefined }}>
          {pending ? '…' : flip != null ? fmt(flip) : 'none nearby'}
        </span>
        {!pending && flip != null && shed < 3 && lead && <span className="text-[11px] tnum text-textMuted">{atSpot ? 'at spot' : `${lead} ${away! > 0 ? 'above' : 'below'}`}</span>}
      </span>
      {hasRegime && !pending && shed < 5 && (
        <span className={`inline-flex items-baseline gap-1.5 ${SEP}`} title={onFlip ? 'Price is on the flip — dealer hedging can tip either way' : absorb ? 'Net gamma is positive here: dealers are long gamma, so their hedging absorbs a move' : 'Net gamma is negative here: dealers are short gamma, so their hedging amplifies a move'}>
          {shed < 2 && <span className="text-[11px] uppercase tracking-wider text-textMuted">Dealers</span>}
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${onFlip ? 'text-textSecondary' : ''}`} style={onFlip ? undefined : { color: absorb ? ABSORB : AMPLIFY }}>
            {onFlip ? 'either way' : absorb ? 'absorb' : 'amplify'}
          </span>
        </span>
      )}
      {heldWords && !pending && shed < 1 && (
        <span className={`inline-flex items-baseline gap-1.5 ${SEP}`} title={held!.tests === 0 ? 'No bar has reached the flip yet today' : `${held!.tests} bars reached the flip today; price closed through it ${held!.broke === 0 ? 'never' : `${held!.broke} times`} — the report's own count`} data-facts-held>
          <span className="text-[11px] uppercase tracking-wider text-textMuted">Flip today</span>
          <span className={`text-[12px] font-semibold tnum ${held!.tests === 0 ? 'text-textMuted' : 'text-textPrimary'}`}>{heldWords}</span>
        </span>
      )}
    </div>
  );
};

export default ColumnFacts;
