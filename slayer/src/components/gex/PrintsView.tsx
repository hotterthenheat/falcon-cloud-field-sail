/*
  THE RAIL'S PRINTS TAB: the pane's name's session on the server's tapes (data/tapeFeed.ts) — the option prints by type
  (sweeps, spread legs, floor trades, blocks, singles) and the side they took, and the stock prints by venue with the
  session's largest off-exchange prints and blocks. The same stores the chart's flow pane and dark-pool marks read: the
  tab asks for nothing of its own.

  Drawn as the Regime and OI change tabs are (railFacts): the head's fact chips, caps section heads, mono figures, a
  one-line foot. The two breakdowns are shadcn's chart (components/shadcn/chart.tsx) over horizontal recharts bars: the
  option money bought in glacier and sold in ember (the buy and sell sides' inks), the money that took no side in the
  secondary ink; the venues' shares off-exchange in the select, on an exchange in the secondary ink.
*/

import { useMemo } from 'react';
import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../shadcn/chart';
import { useOptionTape, useStockTape } from '../../data/tapeFeed';
import { PRINT_TYPES, TYPE_WORDS, primaryOf, venueOf } from '../../data/printTags';
import { fmtDay } from './regimeFmt';
import { FactChip, INK, RailFoot, SectionHead, TICK } from './railFacts';

const NY_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const hm = (ms: number) => (ms > 0 ? NY_HM.format(new Date(ms)) : '—');
const usd = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};
const shares = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b >= 0.1 ? 0 : 1)}%` : '—');

const TYPE_CONFIG = {
  bought: { label: 'Bought', color: INK.call },
  sold: { label: 'Sold', color: INK.put },
  none: { label: 'No side', color: INK.secondary },
} satisfies ChartConfig;
const VENUE_CONFIG = {
  share: { label: 'Share of volume', color: INK.secondary },
} satisfies ChartConfig;
/** Venues drawn; the rest are one line */
const VENUES_SHOWN = 10;
/** Marks listed */
const MARKS_LISTED = 8;
const ROW_H = 18;

const Empty = ({ children }: { children: string }) => <p className="px-3 py-2 font-mono text-t11 text-textMuted">{children}</p>;

const PrintsView = ({ ticker }: { ticker: string }) => {
  const opt = useOptionTape(ticker, true);
  const stock = useStockTape(ticker, true);

  const types = useMemo(() => {
    const total = opt.mix.reduce((a, m) => a + m[1] + m[2] + m[3], 0);
    return {
      total,
      contracts: opt.mix.reduce((a, m) => a + m[4], 0),
      rows: PRINT_TYPES.map(t => {
        const m = opt.mix.find(x => x[0] === t) ?? [t, 0, 0, 0, 0, 0];
        return { type: t === 'leg' ? 'Legs' : TYPE_WORDS[t].label, name: TYPE_WORDS[t].label, key: t, bought: m[1], sold: m[2], none: m[3], all: m[1] + m[2] + m[3], contracts: m[4], prints: m[5] };
      }),
    };
  }, [opt.mix]);
  const legShare = types.contracts > 0 ? (types.rows.find(r => r.key === 'leg')?.contracts ?? 0) / types.contracts : 0;

  const venues = useMemo(() => {
    const rows = stock.venues.map(([code, sh]) => {
      const v = venueOf(code);
      return { venue: v.short, name: v.name, off: v.off, shares: sh, share: stock.shares > 0 ? (sh / stock.shares) * 100 : 0 };
    });
    const shown = rows.slice(0, VENUES_SHOWN);
    const rest = rows.slice(VENUES_SHOWN).reduce((a, r) => a + r.shares, 0);
    return { shown, rest };
  }, [stock.venues, stock.shares]);

  /* the session's largest option prints that are bets — no spread leg — by money */
  const bigOptions = useMemo(
    () => opt.rows.filter(p => p.aggregate == null && !p.tapeTags.leg).sort((a, b) => b.premium - a.premium).slice(0, MARKS_LISTED),
    // `rev` stands for the store's rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opt.rev],
  );
  const marks = useMemo(() => [...stock.marks].sort((a, b) => b[1] * b[2] - a[1] * a[2]).slice(0, MARKS_LISTED), [stock.marks]);

  const optWait = !opt.ready ? 'Reading the option prints…' : opt.fault ? `Option prints — ${opt.fault}` : !types.total ? (opt.filling ? 'Reading the session back…' : 'No option prints this session') : null;
  const stockWait = stock.index
    ? 'An index has no stock prints'
    : !stock.ready
      ? 'Reading the stock prints…'
      : stock.fault
        ? `Stock prints — ${stock.fault}`
        : !stock.shares
          ? stock.filling ? 'Reading the session back…' : 'No stock prints this session'
          : null;

  return (
    <div className="h-full flex flex-col min-h-0" data-prints-tab>
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 pt-2">
        <FactChip label="Session" testId="prints-day">{fmtDay(opt.day || stock.day)}</FactChip>
        <FactChip label="Options to" title="The option prints are in through this minute" testId="prints-options-through">
          {opt.live ? `${hm(opt.through)} · live` : hm(opt.through)}
        </FactChip>
        {!stock.index && (
          <FactChip label="Stock to" title={stock.delayed ? 'Today the stock prints run fifteen minutes behind the market' : 'The stock prints are in through this minute'} testId="prints-stock-through">
            {stock.delayed ? `${hm(stock.through)} · 15m behind` : hm(stock.through)}
          </FactChip>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-2">
        <SectionHead name="Option prints" gloss="by type" aside={types.total ? usd(types.total) : undefined} />
        {optWait ? (
          <Empty>{optWait}</Empty>
        ) : (
          <>
            <div className="flex items-center gap-3 px-3 pb-1 font-mono text-t10 text-textMuted">
              {(['bought', 'sold', 'none'] as const).map(k => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-[2px]" style={{ background: TYPE_CONFIG[k].color }} aria-hidden />
                  {TYPE_CONFIG[k].label}
                </span>
              ))}
            </div>
            <div className="flex px-3" data-prints-types>
              <ChartContainer config={TYPE_CONFIG} className="aspect-auto flex-1 min-w-0 font-mono tnum" style={{ height: types.rows.length * ROW_H + 6 }}>
                <BarChart data={types.rows} layout="vertical" margin={{ top: 3, right: 4, bottom: 3, left: 0 }} barCategoryGap={3} accessibilityLayer>
                  <XAxis type="number" hide domain={[0, 'dataMax']} />
                  <YAxis type="category" dataKey="type" width={52} interval={0} tickLine={false} axisLine={false} tick={TICK} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v, name) => <span className="flex w-full justify-between gap-3"><span className="text-textMuted">{TYPE_CONFIG[name as keyof typeof TYPE_CONFIG]?.label ?? name}</span><span className="font-mono tnum text-textPrimary">{usd(Number(v))}</span></span>} />} />
                  <Bar dataKey="bought" stackId="t" fill="var(--color-bought)" isAnimationActive={false} />
                  <Bar dataKey="sold" stackId="t" fill="var(--color-sold)" isAnimationActive={false} />
                  <Bar dataKey="none" stackId="t" fill="var(--color-none)" fillOpacity={0.55} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
              <div className="shrink-0 w-[92px] pt-[3px]">
                {types.rows.map(r => (
                  <div key={r.key} className="flex items-center justify-end gap-2 font-mono text-t11 tnum" style={{ height: ROW_H }} data-prints-type={r.key}>
                    <span className="text-textPrimary">{usd(r.all)}</span>
                    <span className="w-9 text-right text-textMuted">{pct(r.all, types.total)}</span>
                  </div>
                ))}
              </div>
            </div>
            {legShare > 0 && (
              <p className="px-3 pt-1 font-mono text-t11 text-textSecondary" data-prints-legs>
                Spread legs are <span className="text-textPrimary tnum">{pct(legShare, 1)}</span> of the contracts — halves of structures, not bets
              </p>
            )}
            {bigOptions.length > 0 && (
              <>
                <SectionHead name="Largest" gloss="option prints, no spread legs" />
                <div className="px-3" data-prints-options>
                  {bigOptions.map(p => (
                    <div key={p.vendorId} className="flex items-baseline gap-2 h-[18px] font-mono text-t11 tnum" title={`${p.size.toLocaleString('en-US')} × ${p.strike} ${p.right === 'C' ? 'call' : 'put'}, ${p.expiry}, at ${p.fill.toFixed(2)}`}>
                      <span className="w-10 text-textMuted">{p.time.slice(0, 5)}</span>
                      <span className="w-12 text-right text-textPrimary">{p.size.toLocaleString('en-US')}</span>
                      <span className="w-16 text-right text-textSecondary">
                        {p.strike % 1 === 0 ? p.strike : p.strike.toFixed(1)}
                        <span style={{ color: p.right === 'C' ? INK.call : INK.put }}>{p.right}</span>
                      </span>
                      <span className="w-8 text-right text-textMuted">{p.dte}d</span>
                      <span className="w-11 text-textMuted">{TYPE_WORDS[primaryOf(p.tapeTags)].short}</span>
                      <span className="w-12" style={{ color: p.side === 'ASK' ? INK.call : p.side === 'BID' ? INK.put : undefined }}>{p.side === 'ASK' ? 'bought' : p.side === 'BID' ? 'sold' : '—'}</span>
                      <span className="ml-auto text-textPrimary">{usd(p.premium)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!opt.oi && <p className="px-3 pt-1 font-mono text-t11 text-warn">Part of the session's read is missing: the flow net may read flat</p>}
          </>
        )}

        <SectionHead name="Stock prints" gloss="by venue" aside={stock.shares ? `${shares(stock.shares)} sh` : undefined} />
        {stockWait ? (
          <Empty>{stockWait}</Empty>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
              <FactChip label="Off-exchange" title="Shares reported through the trade-reporting facilities and the ADF: dark pools and internalisers" testId="prints-off">
                {pct(stock.offShares, stock.shares)}
              </FactChip>
              <FactChip label="On exchanges" testId="prints-lit">{pct(stock.shares - stock.offShares, stock.shares)}</FactChip>
            </div>
            <div className="flex px-3" data-prints-venues>
              <ChartContainer config={VENUE_CONFIG} className="aspect-auto flex-1 min-w-0 font-mono tnum" style={{ height: venues.shown.length * ROW_H + 6 }}>
                <BarChart data={venues.shown} layout="vertical" margin={{ top: 3, right: 4, bottom: 3, left: 0 }} barCategoryGap={3} accessibilityLayer>
                  <XAxis type="number" hide domain={[0, 'dataMax']} />
                  <YAxis type="category" dataKey="venue" width={48} interval={0} tickLine={false} axisLine={false} tick={TICK} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator labelFormatter={(_l, p) => String(p[0]?.payload?.name ?? '')} formatter={v => <span className="font-mono tnum text-textPrimary">{Number(v).toFixed(1)}% of shares</span>} />} />
                  <Bar dataKey="share" isAnimationActive={false}>
                    {venues.shown.map(v => (
                      <Cell key={v.venue} fill={v.off ? INK.select : INK.secondary} fillOpacity={v.off ? 0.9 : 0.6} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <div className="shrink-0 w-[92px] pt-[3px]">
                {venues.shown.map(v => (
                  <div key={v.venue} className="flex items-center justify-end gap-2 font-mono text-t11 tnum" style={{ height: ROW_H }} title={v.name} data-prints-venue={v.venue}>
                    <span className="text-textPrimary">{shares(v.shares)}</span>
                    <span className="w-9 text-right text-textMuted">{v.share.toFixed(v.share >= 10 ? 0 : 1)}%</span>
                  </div>
                ))}
              </div>
            </div>
            {venues.rest > 0 && <p className="px-3 font-mono text-t10 text-textMuted">Other venues {shares(venues.rest)} sh</p>}

            <SectionHead name="Largest" gloss="off-exchange and blocks" />
            {marks.length === 0 ? (
              <Empty>No off-exchange print of $1M or block yet</Empty>
            ) : (
              <div className="px-3" data-prints-marks>
                {marks.map(([ms, price, size, venue, kind, side]) => (
                  <div key={`${ms}-${venue}-${size}`} className="flex items-baseline gap-2 h-[18px] font-mono text-t11 tnum" data-prints-mark={kind === 1 ? 'block' : 'off'}>
                    <span className="w-10 text-textMuted">{hm(ms)}</span>
                    <span className="w-12 text-right text-textPrimary">{shares(size)}</span>
                    <span className="w-16 text-right text-textSecondary">{price.toFixed(2)}</span>
                    <span className="w-11 text-textMuted" title={venueOf(venue).name}>{venueOf(venue).short}</span>
                    <span className="w-12" style={{ color: side > 0 ? INK.call : side < 0 ? INK.put : undefined }}>{side > 0 ? 'bought' : side < 0 ? 'sold' : '—'}</span>
                    <span className="ml-auto text-textPrimary">{usd(price * size)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <RailFoot>Regular session{opt.live || stock.live ? ' · updating' : ''}</RailFoot>
    </div>
  );
};

export default PrintsView;
