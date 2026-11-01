/*
  THE RAIL'S PRINTS TAB: the pane's name's session on the server's tapes (data/tapeFeed.ts) — the option prints by type
  and side, the session's largest that are bets, the stock prints by venue, and the largest off-exchange prints and
  blocks. The same stores the chart's flow pane and dark-pool marks read: the tab asks for nothing of its own.

  ONE LOOK FOR ONE KIND OF DATA (the owner, 2026-10-31): the tab wears Trace's own pieces, in the rail's width.
  - The head is Trace's facts (traceFrame Fact), the sections Trace's panel line (TapeFold: title, one-line summary,
    More / Less).
  - Option prints read as the Live Tape's rows: the time over the print's kind (a sweep in the warn ink), the contract
    (ContractCell, stacked), the premium over its contracts, the read over the OPENING tag; by type, the premium with
    the Live Tape's side cell (LeanCell, by premium).
  - Stock prints read as the Dark Pool room's: the price over its place against the mid (quotePlace, inked as the room
    inks it), shares and dollars weighted by earnedInk, the print's place in the quote (execWord); the venues with the
    room's share bar.
  A row of an option print puts its strike on the chart (the rail's onSelect).
*/

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import TapeFold from '../trace/TapeFold';
import { Fact } from '../trace/traceFrame';
import ContractCell from '../trace/ContractCell';
import LeanCell from '../trace/LeanCell';
import OpeningTag from '../trace/OpeningTag';
import { earnMarks, weightInk } from '../trace/earnedInk';
import { execWord, quotePlace } from '../../data/traceDark';
import { fmtCount as num, usd as fmtUsd } from '../../data/traceRows';
import { isSpreadLeg, sentimentOf } from '../../data/tape';
import { useOptionTape, useStockTape, type TapeRow } from '../../data/tapeFeed';
import { PRINT_TYPES, TYPE_WORDS, primaryOf, venueOf, type PrintType } from '../../data/printTags';
import type { StockMarkRow } from '../../data/tapeServer';
import { fmtDay } from './regimeFmt';

const NY_HM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const NY_HMS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hm = (ms: number) => (ms > 0 ? NY_HM.format(new Date(ms)) : '—');
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b >= 0.1 || a === 0 ? 0 : 1)}%` : '—');
const shares = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : num(v));

/* Trace's words for a print's kind (pages/trace/LiveTape KIND_WORD), by the tape's type */
const KIND_WORD: Record<PrintType, string> = { sweep: 'Sweep', leg: 'Multi-leg', floor: 'Floor', block: 'Block', single: 'Single' };
const Kind = ({ type }: { type: PrintType }) =>
  type === 'sweep' ? <span className="text-t11 text-warn font-semibold">Sweep</span> : <span className="text-t11 text-textSecondary whitespace-nowrap">{KIND_WORD[type]}</span>;

/* The Live Tape's read of a print (pages/trace/LiveTape readOf): its sentiment, or why it has none */
const SENT_TEXT = { BULLISH: 'text-bull', BEARISH: 'text-bear', NEUTRAL: 'text-textSecondary' } as const;
const Read = ({ p }: { p: TapeRow }) =>
  isSpreadLeg(p) ? <span className="text-t11 font-semibold text-textSecondary">spread leg</span> : <span className={`text-t11 font-semibold ${SENT_TEXT[sentimentOf(p)]}`}>{sentimentOf(p)}</span>;

/* The Dark Pool room's inks (pages/trace/DarkPool placeInk / execInk): over the mid bought up, under it sold down */
const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
const execInk = (w: string | null) => (!w || w === 'MID' ? 'text-textMuted' : w === 'ASK' || w === 'OVER MID' ? 'text-bull' : 'text-bear');

/** A mark as the room's cross: the quote's mid, the place against it, the print's place in the quote */
function crossOf(m: StockMarkRow) {
  const [ms, price, size, venue, kind, , bid = 0, ask = 0] = m;
  const quoted = bid > 0 && ask > 0 && ask >= bid;
  const mid = quoted ? (bid + ask) / 2 : 0;
  const vsSpotPct = mid > 0 ? ((price - mid) / mid) * 100 : NaN;
  const exec: 'ASK' | 'BID' | 'MID' | null = !quoted ? null : price >= ask - 1e-9 ? 'ASK' : price <= bid + 1e-9 ? 'BID' : 'MID';
  return { ms, price, size, venue, kind, notional: price * size, vsSpotPct, exec };
}

/** A section open unless the reader folded it (kept per section) */
function useOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'folded';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(
    () =>
      setOpen(was => {
        try {
          localStorage.setItem(key, was ? 'folded' : 'open');
        } catch {
          /* the choice lives for the visit */
        }
        return !was;
      }),
    [key],
  );
  return [open, toggle];
}

/** A grid's column heads, Trace's (text-t11, muted) */
const Head = ({ cells, cols, gap = 'gap-x-3' }: { cells: ReactNode[]; cols: string; gap?: string }) => (
  <div className={`grid ${cols} ${gap} h-7 items-center border-b border-borderSubtle text-t11 text-textMuted`}>
    {cells.map((c, i) => (
      <span key={i} className={i === 0 ? '' : 'text-right'}>
        {c}
      </span>
    ))}
  </div>
);
const Note = ({ children }: { children: ReactNode }) => <p className="py-2 text-t12 text-textMuted">{children}</p>;

const TYPE_COLS = 'grid-cols-[minmax(0,1fr)_auto_auto_minmax(64px,88px)]';
const OPT_COLS = 'grid-cols-[auto_minmax(0,1fr)_auto_auto]';
const VENUE_COLS = 'grid-cols-[minmax(0,1fr)_auto_minmax(72px,120px)]';
const CROSS_COLS = 'grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]';
const LISTED = 8;
const VENUES_SHOWN = 10;

const PrintsView = ({ ticker, onSelect }: { ticker: string; onSelect?: (strike: number) => void }) => {
  const opt = useOptionTape(ticker, true);
  const stock = useStockTape(ticker, true);
  const [typesOpen, toggleTypes] = useOpen('slayer_rail_prints_types');
  const [bigOpen, toggleBig] = useOpen('slayer_rail_prints_largest');
  const [venuesOpen, toggleVenues] = useOpen('slayer_rail_prints_venues');
  const [crossOpen, toggleCross] = useOpen('slayer_rail_prints_crosses');

  const types = useMemo(() => {
    const rows = PRINT_TYPES.map(t => {
      const m = opt.mix.find(x => x[0] === t) ?? [t, 0, 0, 0, 0, 0];
      return { type: t, ask: m[1], bid: m[2], mid: m[3], prem: m[1] + m[2] + m[3], contracts: m[4], prints: m[5] };
    }).filter(r => r.prints > 0);
    const prem = rows.reduce((a, r) => a + r.prem, 0);
    const contracts = rows.reduce((a, r) => a + r.contracts, 0);
    return { rows: rows.sort((a, b) => b.prem - a.prem), prem, contracts, prints: rows.reduce((a, r) => a + r.prints, 0), marks: earnMarks(rows, r => r.prem) };
  }, [opt.mix]);
  const countOf = (t: PrintType) => types.rows.find(r => r.type === t)?.prints ?? 0;
  const legs = types.rows.find(r => r.type === 'leg');

  /* the session's largest prints that are bets: no spread leg */
  const big = useMemo(
    () => opt.rows.filter(p => p.aggregate == null && !p.tapeTags.leg).sort((a, b) => b.premium - a.premium).slice(0, LISTED),
    // `rev` stands for the store's rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opt.rev],
  );
  const champ = big[0]?.vendorId;

  const venues = useMemo(() => {
    const rows = stock.venues.map(([code, sh, prints]) => ({ ...venueOf(code), code, shares: sh, prints }));
    return { shown: rows.slice(0, VENUES_SHOWN), rest: rows.slice(VENUES_SHOWN).reduce((a, r) => a + r.shares, 0), marks: earnMarks(rows, r => r.shares), top: rows[0]?.shares ?? 0 };
  }, [stock.venues]);
  const crosses = useMemo(() => {
    const rows = [...stock.marks].map(crossOf).sort((a, b) => b.notional - a.notional).slice(0, LISTED);
    return { rows, size: earnMarks(rows, r => r.size), dollars: earnMarks(rows, r => r.notional) };
  }, [stock.marks]);

  const optWait = !opt.ready ? 'Reading the option prints…' : opt.fault ? `The option prints did not load — ${opt.fault}` : !types.prints ? (opt.filling ? 'Reading the session back…' : 'No option prints this session') : null;
  const stockWait = stock.index ? 'An index has no stock prints' : !stock.ready ? 'Reading the stock prints…' : stock.fault ? `The stock prints did not load — ${stock.fault}` : !stock.shares ? (stock.filling ? 'Reading the session back…' : 'No stock prints this session') : null;
  const day = opt.day || stock.day;
  const optThrough = opt.live ? `to ${hm(opt.through)} ET` : opt.close ? `${hm(opt.open)}–${hm(opt.close)} ET` : '';

  return (
    <div className="h-full flex flex-col min-h-0 overflow-y-auto overflow-x-hidden" data-prints-tab>
      {/* Trace's head: the facts */}
      <dl className="px-5 pt-3 pb-3 flex flex-wrap gap-x-6 gap-y-2" data-trace-facts>
        <Fact label="Session" testId="prints-day">
          {day ? fmtDay(day) : '—'} <span className="text-textMuted">· {optThrough || '—'}</span>
        </Fact>
        <Fact label="Premium" testId="prints-premium" title="Every option print of the session, calls and puts">
          {types.prem ? fmtUsd(types.prem) : '—'} <span className="text-textMuted">· {num(types.prints)} prints</span>
        </Fact>
        <Fact label="Sweeps · blocks · floor" testId="prints-kinds" title="Swept across exchanges; blocks of 100+ contracts and $50K+ in one print; executed on a trading floor">
          {types.prints ? `${num(countOf('sweep'))} · ${num(countOf('block'))} · ${num(countOf('floor'))}` : '—'}
        </Fact>
        <Fact label="Spread legs" testId="prints-legs" title="Legs of multi-leg orders — halves of structures, not bets: in the money, never a side's total">
          {legs ? pct(legs.contracts, types.contracts) : '—'} <span className="text-textMuted">of contracts</span>
        </Fact>
        {!stock.index && (
          <Fact label="Off-exchange" testId="prints-off" title="Shares reported off the exchanges (the trade-reporting facilities and the ADF) over the session's shares, regular session">
            {stock.shares ? pct(stock.offShares, stock.shares) : '—'} <span className="text-textMuted">of {stock.shares ? `${shares(stock.shares)} sh` : 'the shares'} · {stock.delayed ? `to ${hm(stock.through)}, 15 min behind` : `${hm(stock.open)}–${hm(stock.close)}`}</span>
          </Fact>
        )}
      </dl>

      {/* the option prints by type: the Live Tape's side cell, by premium */}
      <TapeFold
        title="By type"
        summary={optWait ?? types.rows.map(r => `${KIND_WORD[r.type] === 'Multi-leg' ? 'Spread legs' : TYPE_WORDS[r.type].label} ${pct(r.prem, types.prem)}`).join(' · ')}
        summaryTitle="The session's option premium by the kind of print"
        open={typesOpen}
        onToggle={toggleTypes}
        noun="the prints by type"
        testId="prints-types"
      >
        {optWait ? (
          <Note>{optWait}</Note>
        ) : (
          <div className="font-mono text-t12 tnum">
            <Head cols={TYPE_COLS} cells={['Kind', 'Prints', 'Premium', 'Side']} />
            {types.rows.map(r => (
              <div key={r.type} className={`grid ${TYPE_COLS} gap-x-3 min-h-[39px] py-1 items-center border-b border-borderSubtle/60`} data-prints-type={r.type}>
                <span className="min-w-0 truncate">
                  <Kind type={r.type} />
                </span>
                <span className="text-right text-t12 text-textSecondary">{num(r.prints)}</span>
                <span className={`text-right text-t12 ${weightInk(r.prem, types.marks)}`}>{fmtUsd(r.prem)}</span>
                <span className="flex justify-end min-w-0">
                  <LeanCell askPct={NaN} split={{ ask: r.ask, bid: r.bid, mid: r.mid }} unit="premium" fit />
                </span>
              </div>
            ))}
          </div>
        )}
      </TapeFold>

      {/* the session's largest bets: the Live Tape's row in the rail's width */}
      {!optWait && (
        <TapeFold
          title="Largest prints"
          summary={big.length ? `${fmtUsd(big[0].premium)} ${big[0].strike}${big[0].right} first · spread legs apart` : 'No print that is a bet yet'}
          open={bigOpen}
          onToggle={toggleBig}
          noun="the largest prints"
          testId="prints-largest"
        >
          {big.length === 0 ? (
            <Note>No print that is a bet yet</Note>
          ) : (
            <div className="font-mono text-t12 tnum">
              <Head cols={OPT_COLS} gap="gap-x-2" cells={['Time ET', 'Contract', 'Sentiment', 'Prem']} />
              {big.map(p => (
                <button
                  key={p.vendorId}
                  type="button"
                  onClick={() => onSelect?.(p.strike)}
                  title={`${num(p.size)} × ${p.strike} ${p.right === 'C' ? 'call' : 'put'} at ${p.fill.toFixed(2)} (bid ${p.bid.toFixed(2)} · ask ${p.ask.toFixed(2)}) — put the strike on the chart`}
                  className={`w-full grid ${OPT_COLS} gap-x-2 min-h-[39px] py-1 items-center text-left border-b border-borderSubtle/60 hover:bg-ink/[0.04]`}
                  data-prints-option={primaryOf(p.tapeTags)}
                >
                  <span className="inline-flex flex-col items-start gap-[3px] leading-none">
                    <span className="text-t11 text-textPrimary whitespace-nowrap">{p.time.slice(0, 5)}</span>
                    <Kind type={primaryOf(p.tapeTags)} />
                  </span>
                  <span className="flex justify-end min-w-0">
                    <ContractCell ticker={ticker} strike={p.strike} right={p.right} expiry={p.expiry} dte={p.dte} otmPct={Number.isFinite(p.otmPct) ? p.otmPct : undefined} />
                  </span>
                  <span className="inline-flex flex-col items-end gap-[3px] leading-none [&>[data-likely-opening]]:ml-0">
                    <Read p={p} />
                    <OpeningTag flag={p.likelyOpening} volume={p.volume} oi={p.oi} />
                  </span>
                  <span className="inline-flex flex-col items-end gap-[3px] leading-none">
                    <span className={p.vendorId === champ ? 'text-supreme font-bold' : p.premium >= 250_000 ? 'font-bold text-textPrimary' : 'text-textPrimary'}>{fmtUsd(p.premium)}</span>
                    <span className="text-t11 text-textSecondary whitespace-nowrap">{num(p.size)} ct</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </TapeFold>
      )}

      {/* the stock prints by venue: the Dark Pool room's share bar */}
      <TapeFold
        title="By venue"
        summary={stockWait ?? `Off-exchange ${pct(stock.offShares, stock.shares)} · ${venues.shown[0] ? `${venues.shown[0].name} ${pct(venues.shown[0].shares, stock.shares)}` : ''}`}
        summaryTitle="The session's shares by where they printed"
        open={venuesOpen}
        onToggle={toggleVenues}
        noun="the shares by venue"
        testId="prints-venues"
      >
        {stockWait ? (
          <Note>{stockWait}</Note>
        ) : (
          <div className="font-mono text-t12 tnum">
            <Head cols={VENUE_COLS} cells={['Venue', 'Shares', 'Of the session']} />
            {venues.shown.map(v => {
              const share = (v.shares / stock.shares) * 100;
              return (
                <div key={v.code} className={`grid ${VENUE_COLS} gap-x-3 h-[30px] items-center border-b border-borderSubtle/60`} data-prints-venue={v.short}>
                  <span className="min-w-0 truncate text-t12 font-bold text-textPrimary" title={v.off ? `${v.name}: reported off the exchanges` : `${v.name}: an exchange`}>
                    {v.name}
                  </span>
                  <span className={`text-right text-t12 ${weightInk(v.shares, venues.marks)}`}>{shares(v.shares)}</span>
                  <span className="flex items-center gap-2 w-full" title={`${share.toFixed(1)}% of the session's shares`}>
                    <span className="flex flex-1 h-[3px] rounded-full overflow-hidden bg-ink/[0.06]">
                      <span className="h-full rounded-full bg-silver/70" style={{ width: `${Math.round((v.shares / venues.top) * 100)}%` }} />
                    </span>
                    <span className="text-t11 text-textSecondary w-9 text-right shrink-0">{share.toFixed(share >= 10 ? 0 : 1)}%</span>
                  </span>
                </div>
              );
            })}
            {venues.rest > 0 && <p className="pt-1.5 text-t11 text-textMuted">Other venues {shares(venues.rest)} sh</p>}
          </div>
        )}
      </TapeFold>

      {/* the largest off-exchange prints and blocks: the Dark Pool room's cross */}
      {!stockWait && (
        <TapeFold
          title="Largest off-exchange"
          shortTitle="Largest"
          summary={crosses.rows.length ? `${fmtUsd(crosses.rows[0].notional)} at $${crosses.rows[0].price.toFixed(2)} first · blocks too` : 'No off-exchange print of $1M or block yet'}
          open={crossOpen}
          onToggle={toggleCross}
          noun="the largest off-exchange prints"
          testId="prints-crosses"
        >
          {crosses.rows.length === 0 ? (
            <Note>No off-exchange print of $1M or block yet</Note>
          ) : (
            <div className="font-mono text-t12 tnum">
              <Head cols={CROSS_COLS} cells={['Time ET', 'Price', 'Shares', 'Dollars', 'Print']} />
              {crosses.rows.map(c => {
                const place = quotePlace(c.vsSpotPct, c.price);
                const w = execWord({ exec: c.exec, vsSpotPct: c.vsSpotPct, price: c.price });
                return (
                  <div key={`${c.ms}-${c.venue}-${c.size}`} className={`grid ${CROSS_COLS} gap-x-3 min-h-[39px] py-1 items-center border-b border-borderSubtle/60`} data-prints-mark={c.kind === 1 ? 'block' : 'off'}>
                    <span className="inline-flex flex-col items-start gap-[3px] leading-none">
                      <span className="text-t11 text-textSecondary whitespace-nowrap">{NY_HMS.format(new Date(c.ms))}</span>
                      <span className="text-t11 text-textMuted whitespace-nowrap" title={venueOf(c.venue).name}>
                        {c.kind === 1 ? 'block' : c.kind === 2 ? 'off-ex block' : 'off-exchange'}
                      </span>
                    </span>
                    <span className="inline-flex flex-col items-end gap-[3px] leading-none">
                      <span className="font-bold text-textPrimary">${c.price.toFixed(2)}</span>
                      <span className={`text-t11 ${Number.isFinite(c.vsSpotPct) ? dirInk(place.cents) : 'text-textMuted'}`} title="Against the mid of the quote in force">
                        {Number.isFinite(c.vsSpotPct) ? place.text : '—'}
                      </span>
                    </span>
                    <span className={`text-right text-t12 ${weightInk(c.size, crosses.size)}`}>{num(c.size)}</span>
                    <span className={`text-right text-t12 ${weightInk(c.notional, crosses.dollars)}`}>{fmtUsd(c.notional)}</span>
                    <span className={`text-right text-t11 ${execInk(w)}`}>{w ?? '—'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </TapeFold>
      )}
    </div>
  );
};

export default PrintsView;
