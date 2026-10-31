/* The vol outlook tile: the name's own realised vol, forecast the way the physics study tested it (data/volOutlook.ts) —
   the next session's HAR forecast, the next hour's, the shock half-life — against the options' at-the-money implied
   vol. Every number is a model's: the tile says MODELED. */

import { useMemo, type ReactNode } from 'react';
import { MONTHS } from '../../../core/nyTime';
import { useThetaTape } from '../../../data/thetaTape';
import { hourReadNow, useImplied, useVolOutlook, type VolOutlook } from '../../../data/volOutlook';
import type { TileProps } from '../tile';
import { TileEmpty, TileRead } from './parts';

const pctOf = (v: number, dp = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dayWords = (iso: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** The status every read on the tile carries: the forecasts are a fitted model's, not a measurement */
export const ModeledTag = ({ title }: { title?: string }) => (
  <span className="inline-flex items-center h-4 px-1.5 rounded border border-borderSubtle font-mono text-t8 uppercase tracking-widest text-textMuted" title={title ?? 'MODELED: a fitted model’s forecast, not a measurement'} data-status="MODELED">
    Modeled
  </span>
);

const Figure = ({ label, value, sub, testId, tone }: { label: string; value: string; sub: ReactNode; testId: string; tone?: string }) => (
  <div className="min-w-0 flex flex-col gap-1" data-vol-figure={testId}>
    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted truncate">{label}</span>
    <span className={`font-mono text-t20 leading-none font-semibold tnum ${tone ?? 'text-textPrimary'}`}>{value}</span>
    <span className="text-t10 leading-snug text-textMuted">{sub}</span>
  </div>
);

/** The last 22 sessions' realised vol as bars, the forecast as an outlined bar at the end */
const Recent = ({ o }: { o: VolOutlook }) => {
  const vals = [...o.recent.map(r => r.rv), o.forecast].filter(Number.isFinite);
  const top = Math.max(...vals, 1e-9) * 1.08;
  return (
    <div className="flex items-end gap-[2px] h-9" aria-label="Realised vol, the last 22 sessions, and the forecast" data-vol-recent>
      {o.recent.map(r => (
        <span key={r.day} className="flex-1 min-w-[2px] rounded-[1px] bg-ink/[0.22]" style={{ height: `${Math.max(4, (r.rv / top) * 100)}%` }} title={`${dayWords(r.day)}: realised ${pctOf(r.rv)}`} />
      ))}
      <span className="flex-1 min-w-[3px] rounded-[1px] border border-dashed border-silver" style={{ height: `${Math.max(4, (o.forecast / top) * 100)}%` }} title={`${dayWords(o.target)}: forecast ${pctOf(o.forecast)}`} data-vol-forecast-bar />
    </div>
  );
};

export const VolOutlookTile = ({ ctx, size }: TileProps) => {
  const o = useVolOutlook(ctx.ticker);
  const iv = useImplied(ctx.ticker);
  const tape = useThetaTape(ctx.ticker, '1m', 'rth');
  /* the next hour moves on with today's minutes: one day's bars, re-read with the chart's tape */
  const hour = useMemo(() => (o.state === 'ready' ? hourReadNow(ctx.ticker, tape.bars) : null), [o, tape.bars, ctx.ticker]);
  if (o.state === 'offline') return <TileEmpty words="Live data is offline. The vol outlook needs a year of this name’s minute bars; it comes back when the feed answers." />;
  if (o.state === 'thin') return <TileEmpty words={`Not enough trading history for ${ctx.ticker} to fit the vol forecast.`} />;
  if (!o.origin) {
    const { done, of } = o.progress;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6" role="status" aria-busy="true" data-vol-tile="loading">
        <span className="text-t11 text-textSecondary text-center">Reading {ctx.ticker}’s last year of minute bars{of ? ` · ${done} of ${of} months` : ''}</span>
        <span className="w-40 h-1 rounded-full bg-ink/[0.08] overflow-hidden">
          <span className="block h-full bg-silver/70 transition-[width] duration-500" style={{ width: `${of ? Math.max(4, (done / of) * 100) : 4}%` }} />
        </span>
        <span className="text-t10 text-textMuted text-center">Once per name; this browser keeps it after.</span>
      </div>
    );
  }
  const spread = iv ? iv.trading - o.forecast : NaN;
  const shock = o.lastRv > o.monthRv;
  const narrow = size.room === 'small';
  return (
    <div className="h-full min-h-0 flex flex-col" data-vol-tile={o.state}>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-2.5 pb-2 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-t10 uppercase tracking-widest text-textSecondary">{ctx.ticker} realised vol</span>
          <ModeledTag title="MODELED: HAR forecasts of realised vol and an AR(1) half-life, fitted on this name’s last year of one-minute bars" />
          {o.state === 'loading' && o.progress.of > 0 && <span className="ml-auto font-mono text-t9 text-textMuted">updating · {o.progress.done}/{o.progress.of}</span>}
        </div>
        <div className={`grid gap-x-4 gap-y-3 ${narrow ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <Figure
            testId="next-session"
            label={`Forecast · ${dayWords(o.target)}`}
            value={pctOf(o.forecast)}
            sub={
              <>
                realised vol, next session · last {pctOf(o.lastRv)}, 22-day {pctOf(o.monthRv)}
              </>
            }
          />
          <Figure
            testId="next-hour"
            label={hour ? `Forecast · ${hour.window} ET` : 'Forecast · next hour'}
            value={hour ? pctOf(hour.forecast) : '—'}
            sub={hour ? <>realised vol, next hour · last hour {pctOf(hour.lastHour)}</> : 'From 10:00 to 15:00 ET on a session day, every 15 minutes'}
          />
          <Figure
            testId="implied"
            label={iv ? `Implied · ATM to ${dayWords(iv.expiryIso)}` : 'Implied · ATM'}
            value={iv ? pctOf(iv.trading) : '—'}
            tone={Number.isFinite(spread) ? (spread >= 0 ? 'text-textPrimary' : 'text-warn') : undefined}
            sub={
              iv ? (
                <span title={`Quoted ${iv.quotedPct.toFixed(1)}% on the calendar year; shown on the trading clock (the same variance over trading time only), the forecast's clock`}>
                  implied − forecast <span className="font-mono tnum text-textSecondary" data-vol-spread>{spread >= 0 ? '+' : '−'}{Math.abs(spread * 100).toFixed(1)} pts</span>
                </span>
              ) : (
                'Reading the chain'
              )
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-t11 leading-snug text-textSecondary" data-vol-halflife>
            <span className="font-semibold text-textPrimary">{shock ? 'Vol shocks fading' : 'No vol shock to fade'}</span>
            {Number.isFinite(o.halfLife) ? <>, half-life ~{o.halfLife.toFixed(1)} sessions</> : null}
            {shock ? ` — the last session (${pctOf(o.lastRv)}) ran above the 22-day level (${pctOf(o.monthRv)}).` : ` — the last session (${pctOf(o.lastRv)}) is at or under the 22-day level (${pctOf(o.monthRv)}).`}
          </div>
          {o.recent.length > 0 && <Recent o={o} />}
          {Number.isFinite(spread) && (
            <div className="text-t11 leading-snug text-textSecondary" data-vol-premium>
              <span className="font-semibold text-textPrimary">{spread >= 0 ? 'Implied over forecast' : 'Implied under forecast'}</span>
              {spread >= 0
                ? ': options price more movement than the model expects — the usual variance premium, plus the overnight and weekend gaps the forecast leaves out.'
                : ': options price less movement than the model expects.'}
            </div>
          )}
        </div>
      </div>
      <TileRead testId="vol">
        Realised: the regular session’s 5-minute moves ×√252. Implied: ATM IV on the same trading clock. Fit on {o.sessions} sessions.
      </TileRead>
    </div>
  );
};
