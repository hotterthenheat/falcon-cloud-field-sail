/*
  THE SURFACE TAB'S DRIFT LENS: the hedge the dealers' book forces into the next close without the price moving — from
  charm (the clock running to the close) and from vanna (implied vol one point lower) — in total, by strike near spot
  and by expiry.

  The same answer as the Skew lens (data/chainFeed.ts useChain → server/terrainApi.mjs: one all-expiry greeks snapshot
  per name with the day's open interest); the math is data/charmDrift.ts in the site's one dealer sign
  (core/dealerSign.ts, retailSign.ts) and the exposure dollars every page prints (data/gex.ts fmtGexUsd).

  Drawn as the Regime tab is: fact chips in the head, caps section heads, the figures in the mono voice, a one-line foot,
  shadcn's chart over recharts. A buy is glacier and a sell ember — long and short, the walls' inks (chart-4, chart-5);
  grey only for the axes, the grid and the secondary words.
*/

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../shadcn/chart';
import { useChain } from '../../data/chainFeed';
import { chainDrift, driftBins, type DriftStrike } from '../../data/charmDrift';
import { wallMs } from '../../data/skew';
import { fmtGexUsd } from '../../data/gex';
import { regimeTrouble } from '../../data/regimeFeed';
import { nyWall } from '../../core/session';
import { fmtDay, fmtMinute, fmtStamp } from './regimeFmt';
import { FactChip, INK, RailFoot, SectionHead, Seg, TICK } from './railFacts';
import { EMBER, GLACIER } from './regimeInk';

interface Props {
  ticker: string;
}

type Greek = 'charm' | 'vanna';
const GREEKS = [
  { value: 'charm', label: 'Charm', hint: 'The hedge the clock forces between now and the close, the price standing still' },
  { value: 'vanna', label: 'Vanna', hint: 'The hedge a one-point fall in implied vol forces' },
] as const;

const flowInk = (v: number) => (v > 0 ? GLACIER : v < 0 ? EMBER : 'rgb(var(--text-secondary))');
/** "Buy $1.2B" / "Sell $640M" */
const flowWord = (v: number) => (v === 0 ? '$0' : `${v > 0 ? 'Buy' : 'Sell'} ${fmtGexUsd(Math.abs(v))}`);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const expWord = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const fmtK = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1));

/** A bin's strike on the axis, the one spot sits in bold */
const StrikeTick = ({ x, y, payload, at }: { x?: number; y?: number; payload?: { value: string }; at: string | null }) => (
  <text x={(x ?? 0) - 4} y={y} dy={3.5} fontSize={10} textAnchor="end" fontWeight={payload?.value === at ? 700 : 400} fill={payload?.value === at ? 'rgb(var(--text-primary))' : 'rgb(var(--text-muted))'}>
    {payload?.value}
  </text>
);

const StrikeBars = ({ rows, greek, spot }: { rows: DriftStrike[]; greek: Greek; spot: number }) => {
  const key = greek === 'charm' ? 'charmFlow' : 'vannaFlow';
  const data = rows.map(r => ({ k: fmtK(r.strike), strike: r.strike, flow: r[key] }));
  /* the bin spot sits in, for its tick */
  const spotRow = rows.reduce<DriftStrike | null>((b, r) => (!b || Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b), null);
  const max = Math.max(1, ...data.map(d => Math.abs(d.flow)));
  const config = { flow: { label: greek === 'charm' ? 'Charm hedge' : 'Vanna hedge', color: INK.ink } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto w-full font-mono tnum" style={{ height: data.length * 15 + 8 }} data-drift-strikes={greek}>
      <BarChart data={data} layout="vertical" margin={{ top: 2, right: 14, bottom: 0, left: 0 }} barCategoryGap={2} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" domain={[-max * 1.05, max * 1.05]} hide />
        <YAxis
          type="category"
          dataKey="k"
          width={48}
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={<StrikeTick at={spotRow ? fmtK(spotRow.strike) : null} />}
        />
        <ReferenceLine x={0} stroke={INK.axis} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, p) => `${p?.[0]?.payload?.k ?? ''}`}
              formatter={v => <span className="font-semibold" style={{ color: flowInk(Number(v)) }}>{flowWord(Number(v))}</span>}
            />
          }
        />
        <Bar dataKey="flow" radius={2} isAnimationActive={false}>
          {data.map(d => (
            <Cell key={d.k} fill={flowInk(d.flow)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};

const DriftView = ({ ticker }: Props) => {
  const chain = useChain(ticker);
  const data = chain.data;
  const [greek, setGreek] = useState<Greek>('charm');
  const drift = useMemo(() => (data?.expiries && data.spot && data.day ? chainDrift(data.expiries, data.spot, wallMs(data.asOf ?? data.spotAt ?? ''), data.day) : null), [data]);
  const rows = useMemo(() => (drift ? driftBins(drift.strikes, drift.spot) : []), [drift]);
  const trouble = regimeTrouble(chain.error);

  if (!data || !drift || !drift.legs) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-drift-empty>
        {chain.loading ? `Reading the ${ticker} chain…` : (trouble ?? (data && !data.oiDay ? `No open interest on file for ${ticker}` : data ? `No greeks with open interest on the ${ticker} chain` : `No option chain for ${ticker}`))}
      </div>
    );
  }
  const to = nyWall(drift.toMs);
  const toWords = `${to.iso === data.day ? '' : `${fmtDay(to.iso).split(' ')[0]} `}${fmtMinute(to.min)}`;
  const hours = (drift.toMs - wallMs(data.asOf ?? data.spotAt ?? '')) / 3_600_000;
  const span = hours >= 24 ? `${(hours / 24).toFixed(1)}d` : `${Math.floor(hours)}h ${String(Math.round((hours % 1) * 60)).padStart(2, '0')}m`;
  const total = greek === 'charm' ? drift.charmFlow : drift.vannaFlow;
  const exps = [...drift.expiries].sort((a, b) => Math.abs(b.charmFlow) + Math.abs(b.vannaFlow) - (Math.abs(a.charmFlow) + Math.abs(a.vannaFlow))).slice(0, 6);

  return (
    <div className="h-full flex flex-col min-h-0" data-drift-view={data.root}>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* THE HEAD: both hedges in total, the close they run to, when the greeks are from */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1.5" data-drift-head>
          <FactChip label="Charm" testId="charm" title="The dealers' hedge into the close from the clock alone">
            <span style={{ color: flowInk(drift.charmFlow) }}>{flowWord(drift.charmFlow)}</span>
          </FactChip>
          <FactChip label="Vanna −1" testId="vanna" title="The dealers' hedge if implied vol falls one point">
            <span style={{ color: flowInk(drift.vannaFlow) }}>{flowWord(drift.vannaFlow)}</span>
          </FactChip>
          <FactChip label="To close" testId="close" title={`The next regular close, ${span} after the greeks were priced`}>
            {toWords} <span className="font-normal text-textSecondary">{span}</span>
          </FactChip>
          <FactChip label={data.live ? 'Live' : 'As of'} testId={data.live ? 'live' : 'asof'}>
            {data.live ? fmtStamp(data.asOf).split(', ')[1] : fmtStamp(data.asOf).replace(',', '').replace(' ET', '')}
          </FactChip>
        </div>

        <SectionHead
          name="By strike"
          gloss={greek === 'charm' ? 'to the close' : 'IV −1 pt'}
          aside={<Seg options={GREEKS} value={greek} onChange={setGreek} testId="drift-greek" />}
        />
        <div className="flex items-baseline gap-2 px-3 pb-1 font-mono tnum" data-drift-total={greek}>
          <span className="text-t16 font-semibold" style={{ color: flowInk(total) }}>
            {flowWord(total)}
          </span>
          <span className="text-t11 text-textMuted">spot {drift.spot.toFixed(2)}</span>
        </div>
        {rows.length ? <StrikeBars rows={rows} greek={greek} spot={drift.spot} /> : <p className="px-3 pb-2 font-mono text-t11 text-textMuted">No open interest near spot.</p>}

        <SectionHead name="By expiry" gloss="the largest hedges" aside={<span className="text-textMuted">charm · vanna −1</span>} />
        <div className="px-3 pb-2" data-drift-expiries>
          {exps.map(e => (
            <div key={e.exp} className="flex items-baseline gap-2 py-[2px] font-mono tnum text-t11" data-drift-exp={e.exp}>
              <span className="w-16 shrink-0 text-textSecondary">{expWord(e.exp)}</span>
              <span className="flex-1 text-right font-semibold" style={{ color: flowInk(e.charmFlow) }}>
                {flowWord(e.charmFlow)}
              </span>
              <span className="w-24 shrink-0 text-right" style={{ color: flowInk(e.vannaFlow) }}>
                {flowWord(e.vannaFlow)}
              </span>
            </div>
          ))}
        </div>
        {trouble && <p className="px-3 py-1 font-mono text-t11 text-warn">{trouble}</p>}
      </div>
      <RailFoot>
        {data.root} open interest of {fmtDay(data.oiDay, false)} · {drift.legs.toLocaleString('en-US')} contracts
        {drift.missing ? ` · ${drift.missing} without greeks` : ''}
      </RailFoot>
    </div>
  );
};

export default DriftView;
