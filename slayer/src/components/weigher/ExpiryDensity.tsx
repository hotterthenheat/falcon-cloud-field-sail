/* Where the expiry may finish, as the chain prices it: the risk-neutral density of the close (data/weigherDensity.ts,
   Breeden–Litzenberger off the chain on the desk) with the options' one-standard-move band, each wall's chance of being
   touched before the close, and the next session's implied vol against the realised-vol forecast (data/volOutlook.ts):
   the ATM IV of the first expiry at least one session out (volOutlook useImplied, the read Pulse's tile compares), on
   the trading clock, against the HAR forecast — the model's median (exp of a forecast of the log), said so. It once set
   the CHOSEN expiry's ATM vol, weeks out as like as not, against a one-session forecast. */

import { useMemo } from 'react';
import { CALL_WALL, PUT_WALL, SUPREME } from '../gex/paletteInk';
import { MONTHS } from '../../core/nyTime';
import { expiryDensity, wallTouch } from '../../data/weigherDensity';
import { useImplied, useVolOutlook } from '../../data/volOutlook';
import type { DeskChain } from '../../data/weigherDesk';
import type { PaneLevels } from '../../pages/terrain/paneLevels';

const W = 640;
const H = 150;
const PAD_B = 18;
const fmtK = (k: number) => (k >= 1000 ? k.toFixed(0) : k.toFixed(k % 1 ? 1 : 0));
const pct = (v: number, dp = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dayOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

const Tag = ({ word, title }: { word: string; title: string }) => (
  <span className="inline-flex items-center h-4 px-1.5 rounded border border-borderSubtle font-mono text-t8 uppercase tracking-widest text-textMuted" title={title} data-status={word}>
    {word}
  </span>
);

export default function ExpiryDensity({ chain, levels, ticker }: { chain: DeskChain; levels: PaneLevels; ticker: string }) {
  /* the chain re-prices on every sweep; the density is one pass over ~600 strikes */
  const d = useMemo(() => (chain.rows.length && chain.spot > 0 ? expiryDensity(chain) : null), [chain]);
  const outlook = useVolOutlook(ticker);
  const implied = useImplied(ticker);
  const walls = useMemo(() => {
    if (!d) return [];
    const list: { key: string; label: string; k: number; ink: string }[] = [];
    if (levels.callWall > 0) list.push({ key: 'call', label: 'Call wall', k: levels.callWall, ink: CALL_WALL });
    if (levels.putWall > 0) list.push({ key: 'put', label: 'Put wall', k: levels.putWall, ink: PUT_WALL });
    if (levels.supreme > 0 && levels.supreme !== levels.callWall && levels.supreme !== levels.putWall) list.push({ key: 'supreme', label: 'Supreme', k: levels.supreme, ink: SUPREME });
    return list.map(w => ({ ...w, touch: wallTouch(d, ticker, w.k), dist: (w.k / d.spot - 1) * 100 }));
  }, [d, levels.callWall, levels.putWall, levels.supreme, ticker]);
  if (!d) {
    return <div className="h-full flex items-center justify-center px-4 text-t11 text-textMuted text-center" data-expiry-density="none">The distribution draws from the chain once it has quotes on both sides of the price.</div>;
  }
  const lo = d.bins[0].lo;
  const hi = d.bins[d.bins.length - 1].hi;
  const x = (k: number) => ((Math.log(k) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * W;
  const top = Math.max(...d.bins.map(b => b.p), 1e-9);
  const y = (p: number) => (H - PAD_B) * (1 - p / (top * 1.1));
  const em = chain.expectedMovePct > 0 ? chain.expectedMovePct / 100 : d.sd / d.spot;
  const band = [d.spot * (1 - em), d.spot * (1 + em)];
  const inBand = d.cdf(band[1]) - d.cdf(band[0]);
  const spread = implied && (outlook.state === 'ready' || outlook.origin) ? implied.trading - outlook.forecast : NaN;
  const ticks = [d.spot * Math.exp(-2 * (d.sd / d.spot)), d.spot * Math.exp(-(d.sd / d.spot)), d.spot, d.spot * Math.exp(d.sd / d.spot), d.spot * Math.exp(2 * (d.sd / d.spot))];
  return (
    <div className="h-full min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,300px)] max-lg:grid-cols-1 gap-x-4 gap-y-2 p-2.5" data-expiry-density="ready">
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap text-t10 text-textMuted">
          <span>
            Chance the close lands in each range by <span className="text-textSecondary">{dayOf(d.expiryIso)}</span>, as the options price it
          </span>
          <Tag word="Modeled" title="MODELED: the risk-neutral distribution (Breeden–Litzenberger) off a smile fitted to this chain — the market's pricing, not a forecast of where it will go" />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[170px]" role="img" aria-label={`Risk-neutral distribution of ${ticker} at the ${dayOf(d.expiryIso)} close`} data-density-svg>
          {/* the options' one-standard-move band */}
          <rect x={x(band[0])} y={0} width={Math.max(1, x(band[1]) - x(band[0]))} height={H - PAD_B} fill="rgb(var(--silver) / 0.08)" />
          {d.bins.map((b, i) => (
            <rect key={i} x={x(b.lo) + 0.5} y={y(b.p)} width={Math.max(0.5, x(b.hi) - x(b.lo) - 1)} height={Math.max(0, H - PAD_B - y(b.p))} fill="rgb(var(--ink) / 0.32)" data-density-bin={b.p.toFixed(4)}>
              <title>{`${fmtK(b.lo)}–${fmtK(b.hi)}: ${(b.p * 100).toFixed(1)}%`}</title>
            </rect>
          ))}
          <line x1={x(d.spot)} x2={x(d.spot)} y1={0} y2={H - PAD_B} stroke="rgb(var(--silver))" strokeWidth={1} />
          {walls.map(w =>
            w.k > lo && w.k < hi ? <line key={w.key} x1={x(w.k)} x2={x(w.k)} y1={0} y2={H - PAD_B} stroke={w.ink} strokeWidth={1.25} strokeDasharray="3 3" data-density-wall={w.key} /> : null,
          )}
          <line x1={0} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="rgb(var(--ink) / 0.15)" />
          {ticks.map((k, i) => (
            <text key={i} x={x(k)} y={H - 4} textAnchor="middle" className="fill-textMuted font-mono" fontSize={9}>
              {fmtK(k)}
            </text>
          ))}
        </svg>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-t10 tnum text-textMuted">
          <span title="The shaded band: ± the move the at-the-money options charge for by this expiry">
            ±1σ band {fmtK(band[0])}–{fmtK(band[1])}: <span className="text-textSecondary">{pct(inBand)}</span>
          </span>
          <span title="How much of the probability sits between the chain's lowest and highest quoted strike; the rest comes from the smile carried past them">strikes cover {pct(d.quotedShare)}</span>
          <span title="The distribution's probabilities add to this before rounding (1 = all of it)">sums to {d.mass.toFixed(3)}</span>
        </div>
      </div>
      <div className="min-w-0 flex flex-col gap-2 text-t11">
        <div>
          <div className="font-mono text-t9 uppercase tracking-widest text-textMuted mb-1">Touched before the {dayOf(d.expiryIso)} close</div>
          {walls.length ? (
            walls.map(w => (
              <div key={w.key} className="flex items-baseline gap-2 py-0.5 border-b border-ink/[0.05] last:border-0" data-wall-touch={w.key}>
                <span className="w-16 shrink-0" style={{ color: w.ink }}>
                  {w.label}
                </span>
                <span className="font-mono tnum text-textPrimary">{fmtK(w.k)}</span>
                <span className="font-mono tnum text-textMuted">{w.dist >= 0 ? '+' : '−'}{Math.abs(w.dist).toFixed(2)}%</span>
                <span className="ml-auto font-mono tnum font-semibold text-textPrimary" title="The chance price trades at this level at any time before the close (reflection principle at the smile's vol there — the chain's touch-odds formula). Not the chance it closes past it">
                  {pct(w.touch)}
                </span>
              </div>
            ))
          ) : (
            <div className="text-textMuted">No walls on the book for this name yet.</div>
          )}
        </div>
        <div data-vol-gap>
          <div className="font-mono text-t9 uppercase tracking-widest text-textMuted mb-1 flex items-center gap-2">
            Implied − forecast <Tag word="Modeled" title="MODELED: the realised-vol forecast is a fitted HAR model (Pulse's Vol outlook), its median case" />
          </div>
          {Number.isFinite(spread) ? (
            <div className="leading-snug text-textSecondary">
              <span className={`font-mono tnum font-semibold ${spread >= 0 ? 'text-textPrimary' : 'text-warn'}`}>
                {spread >= 0 ? '+' : '−'}
                {Math.abs(spread * 100).toFixed(1)} pts
              </span>{' '}
              — ATM implied {pct(implied!.trading, 1)} on {dayOf(implied!.expiryIso)} (the first expiry a session out) against the realised-vol forecast&rsquo;s median of {pct(outlook.forecast, 1)} for the next session. Both on the trading clock; the forecast counts regular-session moves only.
            </div>
          ) : (
            <div className="text-textMuted">{outlook.progress.of ? `Reading the minute history · ${outlook.progress.done} of ${outlook.progress.of}` : outlook.origin && !implied ? 'The next session’s implied vol is loading.' : 'The realised-vol forecast is loading.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
