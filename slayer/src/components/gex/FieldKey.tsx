/* The exposure field's key, in the chart's corner: which model the cells are, the switch between the two, the colour scale
   with the dollars a full-light cell stands for, and the cut's net GEX in dollars — the same rows' sum Pinpoint prints. */
import { memo } from 'react';
import FilterTabs from '../ui/FilterTabs';
import { FIELD_RAMP_CSS } from './gexNodesPrimitive';
import { fmtUsd } from '../../data/gex';
import { FIELD_MODE_WORDS, setFieldMode, useFieldMode } from '../../data/fieldMode';
import { exposureNet, exposureTodayFrom, useExposureLogRev, useFieldPoll, type FieldMode } from '../../data/book/exposureLog';
import { nyClock } from '../../core/nyTime';

const MODES: readonly { value: FieldMode; label: string }[] = [
  { value: 'oi', label: FIELD_MODE_WORDS.oi.name },
  { value: 'flow', label: FIELD_MODE_WORDS.flow.name },
];

interface FieldKeyProps {
  ticker: string;
  /** The cut's expiry (YYYY-MM-DD) or 'book' */
  cut: string | null;
  /** The cut in a reader's words: "Oct 29", "Every expiry" */
  cutWords: string;
  /** The size a full-light cell stands for, dollars per 1% (the field's scale) */
  scale: number;
  /** The cut's net GEX off the house's rows for it (dealer sign) — the figure Pinpoint prints for the same cut */
  oiNet: number | null;
  compact?: boolean;
}

function FieldKey({ ticker, cut, cutWords, scale, oiNet, compact = false }: FieldKeyProps) {
  const mode = useFieldMode();
  useExposureLogRev(ticker);
  useFieldPoll(ticker, cut);
  const net = cut ? exposureNet(ticker, cut) : null;
  const first = exposureTodayFrom(ticker);
  const since = first != null ? nyClock(first) : null;
  const words = FIELD_MODE_WORDS[mode];
  const netValue = mode === 'oi' ? oiNet : net ? net.flow : null;
  const netWords = netValue == null ? '—' : `${netValue >= 0 ? '+' : ''}${fmtUsd(netValue)}`;
  const netInk = netValue == null ? '' : netValue >= 0 ? 'text-goldline' : 'text-steelline';
  const empty = mode === 'flow' ? 'A bar fills once a reading covers its start and its end' : 'No reading covers a bar yet';
  const scaleRow = (
    <div className="flex items-center gap-1.5 whitespace-nowrap" aria-label="Colour scale">
      {!compact && <span>short</span>}
      <span className="tnum">{scale > 0 ? `−${fmtUsd(scale)}` : '—'}</span>
      <span className={`h-2 ${compact ? 'w-7' : 'w-10'} rounded-sm`} style={{ background: FIELD_RAMP_CSS.neg, transform: 'scaleX(-1)' }} aria-hidden />
      <span>0</span>
      <span className={`h-2 ${compact ? 'w-7' : 'w-10'} rounded-sm`} style={{ background: FIELD_RAMP_CSS.pos }} aria-hidden />
      <span className="tnum">{scale > 0 ? `+${fmtUsd(scale)}` : '—'}</span>
      {!compact && <span>long</span>}
    </div>
  );
  return (
    <div
      className="pointer-events-auto select-none rounded-md border border-ink/[0.08] bg-canvas/85 px-2 py-1.5 font-mono text-t9 text-textMuted"
      /* no backdrop blur: the tape repaints under it on every pointer move, and a blur would be re-rendered each time */
      data-field-key
      data-chart-chrome
      title={`${words.name}: ${words.line}.${scale > 0 ? '' : ` ${empty}.`}`}
    >
      <div className="flex items-center gap-2">
        {!compact && <span className="text-textSecondary font-semibold uppercase tracking-wider whitespace-nowrap">Net GEX</span>}
        <FilterTabs paper={false} options={MODES} value={mode} onChange={setFieldMode} ariaLabel="Which model the exposure cells show" />
        {compact && (
          <span className={`tnum font-semibold whitespace-nowrap ${netInk}`} data-field-net>
            {netWords}
          </span>
        )}
      </div>
      <div className="mt-1">{scaleRow}</div>
      {!compact && !(scale > 0) && (
        <div className="mt-0.5 whitespace-nowrap text-textSecondary" data-field-empty>
          {empty}
        </div>
      )}
      {!compact && (
        <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
          <span className={`tnum font-semibold ${netInk}`} data-field-net>
            {netWords}
          </span>
          <span>
            {mode === 'flow' ? "today's flow" : 'net GEX'} · {cutWords} · {since ? `read since ${since} ET` : 'waiting for the first reading'}
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(FieldKey);
