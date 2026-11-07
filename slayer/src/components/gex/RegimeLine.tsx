/* Under the Pinpoint head for the name on the desk: short regime, its levels, its ruler. The long sentence is on hover. */

import { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useLevelsFor } from '../../data/levelsFor';
import { LEVELS_OPTIONS, setLevelsForName, useNameLevels, type LevelsScope } from '../../data/levelsScope';
import { setUnitForName, useNameUnit } from '../../data/distanceUnits';
import { todayScopeLabel } from '../../data/bookWindow';
import { fmtGexUsd } from '../../data/gex';
import { peekEntry, useBookRev } from '../../data/book/store';
import { BOOK_MODE_WORDS } from '../../data/bookMode';
import { LivePrice } from './LivePrice';
import { AsOf } from '../ui/states';
import type { DistanceUnit } from '../../data/atr';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import CompanyLogo from '../ui/CompanyLogo';
import GuideFocus from '../ui/GuideFocus';
import { FIRST_TIME, FIRST_TIME_EVENT, GLOSSARY } from './glossary';
import { LONG_GAMMA, SHORT_GAMMA } from './paletteInk';
import type { TickerLevels } from '../../data/levelsFor';

const fmtK = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

const RULER_OPTIONS: DropdownOption<DistanceUnit>[] = [
  { value: '$', label: '$', hint: 'Dollars from spot' },
  { value: '%', label: '%', hint: 'Percent of spot' },
  { value: 'ATR', label: 'ATR', hint: 'Average true ranges — the same distance on SPY and on NVDA' },
  { value: 'σ', label: 'σ', hint: 'Expected one-day moves — how many the options price in' },
];

/** The sentence, from the one source of levels — null while they are provisional. Hover only. */
function regimeSentence(lv: TickerLevels | null): { lead: string; rest: string; tone: 'LONG' | 'SHORT' } | null {
  if (!lv || !lv.complete || !lv.regime) return null;
  const t = lv.ticker;
  const flip = lv.flip;
  if (lv.regime === 'SHORT') {
    const until =
      flip == null
        ? `there is no flip within 10%, so that holds across the whole range`
        : flip > lv.spot
          ? `until ${t} gets back above ${fmtK(flip)} (the flip)`
          : `until ${t} crosses ${fmtK(flip)} (the flip), where that changes`;
    return { lead: 'Short gamma', rest: `: moves tend to extend — dealers' hedging trades with the move, ${until}.`, tone: 'SHORT' };
  }
  const until =
    flip == null
      ? 'with no flip within 10%'
      : flip < lv.spot
        ? `while ${t} holds above ${fmtK(flip)} (the flip)`
        : `until ${t} crosses ${fmtK(flip)} (the flip)`;
  return { lead: 'Long gamma', rest: `: moves tend to be damped — dealers' hedging trades against the move, ${until}.`, tone: 'LONG' };
}

/** `stamp` false leaves the kept-copy "as of" to the page under the strip (the Board says one for every name) */
const RegimeLine = ({ ticker, stamp = true }: { ticker: string | null | undefined; stamp?: boolean }) => {
  const scope = useNameLevels(ticker);
  const unit = useNameUnit(ticker);
  const lv = useLevelsFor(ticker, scope);
  useBookRev();
  const said = regimeSentence(lv);
  const entry = ticker ? peekEntry(ticker) : undefined;
  const flipPct = lv?.flip != null && lv.spot > 0 ? ((lv.flip - lv.spot) / lv.spot) * 100 : null;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(FIRST_TIME_EVENT, on);
    return () => window.removeEventListener(FIRST_TIME_EVENT, on);
  }, []);
  const name = ticker?.trim().toUpperCase() ?? '';
  const tone = said?.tone;
  const ink = tone === 'SHORT' ? SHORT_GAMMA : tone === 'LONG' ? LONG_GAMMA : undefined;
  const levelOptions = LEVELS_OPTIONS.map(o =>
    o.value === '0DTE' && todayScopeLabel() !== 'Today'
      ? { ...o, label: todayScopeLabel(), hint: "Today's contracts expired at the close — the next session's contracts" }
      : o,
  );
  const title = [said ? `${said.lead}${said.rest}` : '', lv ? `${lv.scopeLabel}. ${GLOSSARY.flip}` : ''].filter(Boolean).join(' ');
  return (
    <div className="flex items-start sm:items-center gap-x-3 gap-y-2 flex-wrap min-w-0 py-2 -mt-1 border-b border-borderSubtle" data-regime-line={tone ?? 'pending'} data-name-strip={name || undefined}>
      <div className="flex w-full sm:w-auto sm:flex-1 sm:basis-0 sm:min-w-96 items-center gap-x-2 gap-y-0.5 flex-wrap min-w-0 [&>*]:whitespace-nowrap" title={title || undefined}>
        {name ? <CompanyLogo ticker={name} size={18} /> : null}
        <span className="font-mono text-t13 font-semibold text-textPrimary">{name || '—'}</span>
        {name && (
          <span className="text-t12" data-regime-price>
            <LivePrice ticker={name} levelsAt={lv?.spot ?? null} />
          </span>
        )}
        <span className="font-mono text-t11 font-semibold" style={ink ? { color: ink } : undefined} data-regime-word={tone ?? 'pending'}>
          {said ? (tone === 'SHORT' ? 'Short gamma' : 'Long gamma') : name ? 'Reading…' : '…'}
        </span>
        {said && (
          /* what the regime was tested to mean (research/physics REPORT.md #2): a vol regime, not a magnet */
          <span className="text-t11 text-textSecondary" title="Tested on SPY and QQQ: on long-gamma days the market moved about 15% less than forecast, relative to short-gamma days. It says how far moves tend to run, not where price goes." data-regime-meaning>
            {tone === 'SHORT' ? 'moves tend to extend' : 'moves tend to be damped'}
          </span>
        )}
        {lv?.complete && (
          /* the net re-priced at spot — the figure the regime word is the sign of, so the two never disagree */
          <span className={`font-mono text-t11 tnum ${lv.netAtSpot > 0 ? 'text-bull' : lv.netAtSpot < 0 ? 'text-bear' : 'text-textMuted'}`} title="Net dealer gamma re-priced at the current price — its sign is the regime" data-regime-net>
            {fmtGexUsd(lv.netAtSpot)} <span className="text-textMuted">at spot</span>
          </span>
        )}
        {lv?.flip != null && (
          <span className="font-mono text-t11 tnum text-textSecondary" data-regime-flip>
            flip {fmtK(lv.flip)}
            {flipPct != null && <span className="text-textMuted"> ({flipPct > 0 ? '+' : '−'}{Math.abs(flipPct).toFixed(2)}%)</span>}
          </span>
        )}
        {lv?.complete && lv.flip == null && <span className="font-mono text-t11 text-textMuted" title={GLOSSARY.flip}>no flip within 10%</span>}
        {lv?.complete && <span className="font-mono text-t10 uppercase tracking-wider text-textMuted">{lv.scopeLabel}</span>}
        {/* the strip is on every Pinpoint page: when the name is drawn from the flow book it says so, so a page that shows
            the open-interest book under it (Board's other rows, Building) never reads as one book (OLD_PATH_AUDIT item 2) */}
        {lv?.complete && entry?.engine?.mode === 'flow' && (
          <span className="font-mono text-t10 uppercase tracking-wider text-silver" title={`${BOOK_MODE_WORDS.flow.label}: ${BOOK_MODE_WORDS.flow.line}`} data-regime-book="flow">
            {BOOK_MODE_WORDS.flow.label}
          </span>
        )}
        {stamp && entry?.keptAt && (
          <span data-kept>
            <AsOf at={entry.at} title="This browser's kept copy of the book, shown while the fresh read loads; it is replaced as soon as that lands" />
          </span>
        )}
      </div>
      <div className="flex w-full sm:w-auto sm:ml-auto items-center gap-1.5 flex-wrap">
        <DropdownSelect<LevelsScope>
          label="Levels"
          value={scope}
          options={levelOptions}
          onChange={v => name && setLevelsForName(name, v)}
          title="This name's levels. Another name keeps its own."
          testId="levels-scope"
          align="end"
        />
        <DropdownSelect<DistanceUnit>
          label="Ruler"
          value={unit}
          options={RULER_OPTIONS}
          onChange={v => name && setUnitForName(name, v)}
          title="This name's ruler. Another name keeps its own."
          testId="ruler"
          align="end"
        />
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-pressed={open}
          className="hit shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-t10 text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] aria-pressed:text-textPrimary transition-colors"
          title="The words Pinpoint uses, one line each"
          data-first-time
        >
          <HelpCircle className="w-3 h-3" />
          First time here?
        </button>
      </div>
      <GuideFocus open={open} onClose={() => setOpen(false)} title="The words on Pinpoint" testId="first-time" viewport width={520}>
        <dl className="px-3 py-2.5 grid gap-y-2" data-first-time-card>
          {FIRST_TIME.map(w => (
            <div key={w.term}>
              <dt className="text-t11 font-semibold text-textPrimary">{w.term}</dt>
              <dd className="text-t11 leading-snug text-textSecondary">{w.says}</dd>
            </div>
          ))}
        </dl>
      </GuideFocus>
    </div>
  );
};

export default RegimeLine;
