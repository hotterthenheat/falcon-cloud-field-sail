/*
  The case for one contract. Six tabs. The word is the first gate that fails,
  or the pass. Figures are Fact rows. A simulated chain is named and is not scored.
*/

import { useMemo, useState } from 'react';
import CardTabs from '../ui/CardTabs';
import Fact from '../ui/Fact';
import ContractLabel from '../ui/ContractLabel';
import { readGate, offsetOf, spanOf } from '../../data/weigherGate';
import { seatsNow, type LiveScore } from '../../data/compassModel';
import { STOP_KEEP, TP1_STOP, TP2_STOP, TP3_STOP, TP4_TRAIL, DRIVE, weekdayDte } from '../../data/compassParams';
import { odteDoneMin } from '../../data/compassSession';
import { useEconCalendar } from '../../data/liveRecord';
import { useNextReport } from '../../data/earningsFeed';
import type { DeskChain, DeskContract } from '../../data/weigherDesk';
import type { ExposureProfileData } from '../../types/gex';
import type { Book } from '../../data/bookAtStrike';
import type { OptionRight } from '../../types/compass';

const HEAD = 'font-mono text-t10 font-bold uppercase tracking-widest text-textSecondary';

const Reasons = ({ title, items, ink, empty }: { title: string; items: string[]; ink: string; empty: string }) => (
  <div className="flex flex-col gap-2 min-w-0" data-strike-reasons={title}>
    <span className={HEAD}>{title}</span>
    {items.length ? (
      <ul className="flex flex-col gap-2">
        {items.map(t => (
          <li key={t} className="flex items-start gap-2.5 text-t12 leading-relaxed text-textPrimary">
            <span className={`mt-[9px] w-2.5 h-px shrink-0 ${ink}`} aria-hidden="true" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-t12 text-textMuted">{empty}</span>
    )}
  </div>
);

interface Props {
  ticker: string;
  c: DeskContract;
  right: OptionRight;
  chain: DeskChain;
  profile: ExposureProfileData | null;
  book: Book | null;
  tick: number;
  score: LiveScore | null;
  listed: { dte: number; label: string }[];
  onPickAlt: (strike: number, dte: number, right?: OptionRight) => void;
}

type Part = 'why' | 'around' | 'needs' | 'instead' | 'calendar' | 'horizon';
const PARTS: readonly { value: Part; label: string }[] = [
  { value: 'why', label: 'Why' },
  { value: 'around', label: 'Around it' },
  { value: 'needs', label: 'What it needs' },
  { value: 'instead', label: 'If not this' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'horizon', label: 'Horizon' },
];
let lastPart: Part = 'why';

const money = (n: number) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');
const pct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%` : '—');
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} ET`;

/** What a person can read. The scores stay in the gate. They are not shown. */
function speak(s: string): string | null {
  if (/simulated/i.test(s)) return 'These prices are not a live quote.';
  if (/Quote missing|crossed|older than/i.test(s)) return 'The bid and ask are missing, crossed, or old.';
  if (/Outside the entry clock/i.test(s)) return 'This name’s options are not in a window we read.';
  if (/high-impact release/i.test(s)) return 'A big number is close. We don’t start a new one.';
  if (/same-day only/i.test(s)) return 'This late window is only for contracts that expire today.';
  if (/outside 0 to 7|options are shut|not on this scan|Halted/i.test(s)) return 'This contract is not being read right now.';
  if (/Bid is at or under/i.test(s)) return 'The bid is $0.15 or less. Too thin to take.';
  if (/Spread is over/i.test(s)) return 'The spread is wider than 8% of the price.';
  if (/Outside the span/i.test(s)) return s.replace('Outside the span. ', 'Too far from the stock. ');
  if (/Book B/i.test(s)) return 'This far strike has not cheapened enough.';
  if (/Book C ask/i.test(s)) return 'The ask is over $1.65.';
  if (/Only the call/i.test(s)) return 'The stock is up from the open. This is a put.';
  if (/Only the put/i.test(s)) return 'The stock is down from the open. This is a call.';
  if (/open is not in hand/i.test(s)) return 'The opening price is not in yet, so the side is not named.';
  if (/Flat root/i.test(s)) return 'The stock is flat from the open. Neither side is named.';
  if (/Needs 70\.67|has not scored/i.test(s)) return 'It does not clear.';
  if (/Model 1/i.test(s)) return null;
  if (/does not send/i.test(s)) return 'It clears. We do not call this name.';
  if (/already sent/i.test(s)) return 'This name already has one today.';
  if (/seats are full/i.test(s)) return 'Five are already out today.';
  if (/Book A\. Model|Book B\. Model|Book C\. No model|The math passes/i.test(s)) return 'This one clears.';
  if (/^Quote /i.test(s)) return s.replace(/^Quote /, 'Bid and ask ').replace(', on this contract.', '.');
  if (/Inside the Book/i.test(s)) return null;
  if (/No high-impact/i.test(s)) return 'No big number in the next 15 minutes.';
  if (/Same-day contract/i.test(s)) return 'It expires today.';
  if (/weekday sessions/i.test(s)) return s.replace('weekday sessions to expiration.', 'sessions left.');
  if (/Bid is above/i.test(s)) return 'The bid is above $0.15.';
  if (/^Spread /i.test(s)) return s.replace('of the mid.', 'of the price.');
  if (/Inside Book A/i.test(s)) return s.replace('Inside Book A. ', '');
  if (/Inside Book B/i.test(s)) return s.replace('Inside Book B. ', 'Further out. ');
  if (/has halved/i.test(s)) return 'The ask has come in.';
  if (/Call side of the open/i.test(s)) return 'It is the call, and the stock is up from the open.';
  if (/Put side of the open/i.test(s)) return 'It is the put, and the stock is down from the open.';
  if (/458|seat is open/i.test(s)) return null;
  return null;
}

const strikeLabel = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));

const StrikeCase = ({ ticker, c, right, chain, profile, book, tick, score, listed, onPickAlt }: Props) => {
  void profile;
  void book;
  const sim = chain.source !== 'live';
  const held = sim ? { p1: null, prun: null, retOpen: null, gex: null, ...seatsNow() } : score ?? { p1: null, prun: null, retOpen: null, gex: null, ...seatsNow() };
  const gate = useMemo(
    () => readGate({ chain, contract: c, p1: held.p1, prun: held.prun, retOpen: held.retOpen, gex: held.gex, seats: held.seats, sentRoots: held.sentRoots }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chain, c, held.p1, held.prun, held.retOpen, held.gex, held.seats, tick, held.sentRoots.join('|')]
  );
  const strikes = useMemo(() => chain.rows.map(r => r.strike), [chain.rows]);
  const span = spanOf(chain);
  void span;
  const dist = offsetOf(strikes, chain.spot, c.strike);
  void dist;
  const ordered = useMemo(() => [...new Set(strikes.filter(k => k > 0))].sort((a, b) => a - b), [strikes]);
  const ret = held.retOpen;
  const side = ret == null || !Number.isFinite(ret) ? 'The opening price is not in yet.' : Math.abs(ret) >= DRIVE ? (ret > 0 ? 'The stock is up from the open, so the call is the side.' : 'The stock is down from the open, so the put is the side.') : 'The stock is flat from the open.';
  const session = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dte = chain.expiryIso ? weekdayDte(session.replace(/-/g, ''), chain.expiryIso.replace(/-/g, '')) : NaN;
  const sleeve = dte === 0 ? '0 DTE' : dte >= 1 && dte <= 7 ? '1–7 DTE' : 'Later';
  const ask = c.ask > 0 ? c.ask : NaN;
  const be = Number.isFinite(ask) ? (right === 'C' ? c.strike + ask : c.strike - ask) : NaN;
  const needMove = Number.isFinite(be) && chain.spot > 0 ? ((be - chain.spot) / chain.spot) * 100 : NaN;
  const econ = useEconCalendar();
  const next = useNextReport(ticker);
  const prints = econ.filter(e => e.region === 'USD' && (e.impact === 'high' || e.impact === 'medium') && e.inMinutes > -30 && e.inMinutes < Math.max(1, dte) * 24 * 60).slice(0, 4);
  const [part, setPartState] = useState<Part>(lastPart);
  const setPart = (p: Part) => {
    lastPart = p;
    setPartState(p);
  };
  const show = (n: number) => (sim ? `${money(n)} · Simulated` : money(n));
  const legAt = (strike: number | undefined) => {
    if (strike == null) return null;
    const row = chain.rows.find(r => Math.abs(r.strike - strike) < 1e-6);
    return row ? (right === 'C' ? row.call : row.put) : null;
  };
  const quoteLine = (leg: DeskContract | null, name: string) => {
    if (!leg || !(leg.ask > 0)) return { name, line: '—', status: 'No quote.' };
    const mid = (leg.ask + leg.bid) / 2;
    const spread = mid > 0 ? ((leg.ask - leg.bid) / mid) * 100 : NaN;
    const g = readGate({ chain, contract: leg, p1: Math.abs(leg.strike - c.strike) < 1e-6 ? held.p1 : null, prun: Math.abs(leg.strike - c.strike) < 1e-6 ? held.prun : null, retOpen: held.retOpen, gex: held.gex, seats: held.seats, sentRoots: held.sentRoots });
    return { name, line: sim ? `${money(leg.bid)} × ${money(leg.ask)} · ${Number.isFinite(spread) ? spread.toFixed(1) : '—'}% · Simulated` : `${money(leg.bid)} × ${money(leg.ask)} · ${Number.isFinite(spread) ? spread.toFixed(1) : '—'}%`, status: g.status };
  };
  const better = useMemo(() => {
    if (!(chain.spot > 0)) return [] as { strike: number; right: OptionRight; ask: number }[];
    const sameSide = (k: number) => (k - chain.spot) * (c.strike - chain.spot) > 0 && Math.abs(k - chain.spot) + 1e-6 < Math.abs(c.strike - chain.spot);
    return ordered
      .filter(sameSide)
      .sort((a, b) => Math.abs(a - chain.spot) - Math.abs(b - chain.spot))
      .slice(0, 4)
      .map(k => {
        const row = chain.rows.find(r => Math.abs(r.strike - k) < 1e-6);
        const leg = row ? (right === 'C' ? row.call : row.put) : null;
        return { strike: k, right, ask: leg && leg.ask > 0 ? leg.ask : NaN };
      });
  }, [ordered, chain, c.strike, right]);
  const stopMin = odteDoneMin((chain.optRoot || chain.ticker).toUpperCase());
  const flatAt = dte === 0 ? clock(Math.max(0, stopMin - 1)) : '15:55 ET';
  const runner = !sim && held.prun != null && held.prun >= 0.5;
  const said = speak(gate.status) ?? (sim ? 'These prices are not live.' : 'It does not clear.');
  const buyLine = sim ? 'No. We would not buy this. These prices are not live.' : gate.ticket ? 'Yes. We would buy this.' : `No. We would not buy this. ${said}`;
  const forIt = gate.passed.map(speak).filter((x): x is string => !!x);
  const against = gate.failed ? [speak(gate.failed) ?? 'It does not clear.'] : [];
  const near = (() => {
    const here = ordered.findIndex(k => Math.abs(k - c.strike) < 1e-6);
    if (here < 0) return ordered.slice(0, 7);
    return ordered.slice(Math.max(0, here - 3), here + 4);
  })();
  const foot = sim ? 'This is a read of the contract in front of you. A simulated read is not an order.' : 'This is a read of the contract in front of you. It is not an order.';
  const line = buyLine;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 whitespace-normal" data-strike-case={`${c.strike}${right}`}>
      <p className="shrink-0 text-t14 leading-snug font-medium text-textPrimary" data-strike-line>
        {line}
      </p>
      <div className="shrink-0" data-strike-tabs={part}>
        <CardTabs<Part> options={PARTS} value={part} onChange={setPart} ariaLabel="The case, part by part" />
      </div>
      <div key={part} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1" data-strike-part={part}>
        {part === 'why' && (
          <>
            <Reasons title="For it" items={forIt} ink="bg-bull" empty={sim ? 'Not a live quote.' : 'Nothing in its favor yet.'} />
            <Reasons title="Against it" items={against} ink="bg-bear" empty="Nothing stands against it." />
          </>
        )}

        {part === 'around' && (
          <div className="flex flex-col gap-1.5" data-strike-around>
            <p className="text-t12 text-textSecondary">{chain.spot > 0 ? `Stock ${show(chain.spot)}` : 'No stock price'}{ret != null && Number.isFinite(ret) ? ` · ${pct(ret * 100)} from the open` : ''}. {sim ? 'Not a live quote.' : side}</p>
            {near.map(k => {
              const leg = legAt(k);
              if (!leg) return null;
              const on = Math.abs(k - c.strike) < 1e-6;
              const q = quoteLine(leg, '');
              return (
                <button key={k} type="button" onClick={() => onPickAlt(k, chain.expiry.dte, right)} className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md border ${on ? 'border-silver/50 bg-silver/[0.06]' : 'border-borderSubtle hover:bg-ink/[0.03]'}`}>
                  <ContractLabel contract={`${ticker} ${strikeLabel(k)}${right}`} right={right} logo={ticker} size="sm" />
                  <span className="ml-auto shrink-0 text-right">
                    <span className="block font-mono text-t11 tnum text-textPrimary">{q.line}</span>
                    <span className="block text-t10 text-textMuted truncate max-w-[220px]">{speak(q.status) ?? q.status}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {part === 'needs' && (
          <div className="flex flex-col gap-3" data-strike-needs>
            <div className="flex flex-col pr-2">
              <Fact big label="To breakeven" value={Number.isFinite(needMove) ? (sim ? `${pct(needMove)} · Simulated` : pct(needMove)) : '—'} valueCls={Number.isFinite(needMove) ? (needMove >= 0 ? 'text-bull' : 'text-bear') : undefined} />
              <Fact big label="Breakeven" value={Number.isFinite(be) ? show(be) : '—'} />
              <Fact big label="Sessions left" value={dte === 0 ? 'the bell' : Number.isFinite(dte) ? String(dte) : '—'} />
              <Fact big label="Priced move" value={chain.expectedMovePct > 0 ? (sim ? `±${chain.expectedMovePct.toFixed(2)}% · Simulated` : `±${chain.expectedMovePct.toFixed(2)}%`) : '—'} />
              <Fact big label="Stop" value={Number.isFinite(ask) ? show(ask * STOP_KEEP) : '—'} />
              <Fact big label="Non-runner" value={Number.isFinite(ask) ? show(ask * 1.5) : '—'} />
              {runner && Number.isFinite(ask) && (
                <>
                  <Fact big label="Stop at +50%" value={show(ask * TP1_STOP)} />
                  <Fact big label="Stop at +100%" value={show(ask * TP2_STOP)} />
                  <Fact big label="Stop at +200%" value={show(ask * TP3_STOP)} />
                  <Fact big label="After 4×" value={`${TP4_TRAIL} × the peak bid`} />
                </>
              )}
              <Fact big label="Flat" value={flatAt} />
            </div>
            <p className="text-t12 leading-relaxed text-textSecondary">If the stock falls 0.40% in five minutes, a call is done. If it rises 0.40%, a put is done. These are the levels a ticket would use. They are not a fill.</p>
          </div>
        )}

        {part === 'instead' && (
          <div className="flex flex-col gap-1.5" data-strike-instead>
            <span className={HEAD}>Closer to the stock, same side. Not a call.</span>
            {better.length ? (
              better.map(b => (
                <button key={`${b.strike}${b.right}`} type="button" onClick={() => onPickAlt(b.strike, chain.expiry.dte, b.right)} className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md border border-borderSubtle hover:bg-ink/[0.03]" data-strike-alt="better">
                  <ContractLabel contract={`${ticker} ${strikeLabel(b.strike)}${b.right}`} right={b.right} logo={ticker} size="sm" />
                  <span className="ml-auto shrink-0 font-mono text-t11 tnum text-textPrimary">Ask {Number.isFinite(b.ask) ? money(b.ask) : '—'}</span>
                </button>
              ))
            ) : (
              <span className="text-t12 text-textMuted">This is already the closest listed strike on this side.</span>
            )}
            <p className="text-t12 text-textMuted">Another expiration is not quoted here. Open it from Calendar.</p>
          </div>
        )}

        {part === 'calendar' && (
          <div className="flex flex-col gap-3" data-strike-calendar>
            <span className={HEAD}>This strike, on each listed expiry</span>
            <ul className="flex flex-col">
              {(listed.length ? listed : [{ dte: Number.isFinite(dte) ? dte : chain.expiry.dte, label: sleeve }]).map(e => {
                const current = e.dte === (Number.isFinite(dte) ? dte : chain.expiry.dte);
                const band = e.dte === 0 ? '0 DTE' : e.dte >= 1 && e.dte <= 7 ? '1–7 DTE' : 'Later';
                return (
                  <li key={`${e.dte}-${e.label}`} className="border-b border-borderSubtle/60">
                    <button type="button" disabled={current} onClick={() => onPickAlt(c.strike, e.dte, right)} className={`w-full text-left py-2 ${current ? '' : 'hover:bg-ink/[0.03]'}`} data-strike-cal={e.dte}>
                      <span className="font-mono text-t12 text-textPrimary">{e.label} · {band}</span>
                      <span className="block text-t12 text-textSecondary">
                        {current
                          ? `${speak(gate.status) ?? 'It does not clear.'} · premium ${show(ask)} · breakeven ${Number.isFinite(be) ? show(be) : '—'} · decay ${Number.isFinite(c.theta) && c.theta !== 0 ? show(Math.abs(c.theta)) : '—'} a day`
                          : 'Not loaded. Open it to read this strike.'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {part === 'horizon' && (
          <div className="flex flex-col gap-1.5" data-strike-horizon={sleeve}>
            <div className="flex flex-col pr-2">
              <Fact big label="Window" value={sleeve} />
              {dte === 0 && (
                <>
                  <Fact big label="Decay an hour" value={Number.isFinite(c.theta) && c.theta !== 0 ? show(Math.abs(c.theta) / 6.5) : '—'} />
                  <Fact big label="Volume" value={c.volume > 0 ? c.volume.toLocaleString('en-US') : '—'} />
                  <Fact big label="Open interest" value={c.oi > 0 ? c.oi.toLocaleString('en-US') : '—'} />
                  <Fact big label="Closes" value={clock(Math.max(0, stopMin - 1))} />
                </>
              )}
              {dte > 0 && (
                <Fact big label="Decay a day" value={Number.isFinite(c.theta) && c.theta !== 0 ? show(Math.abs(c.theta)) : '—'} />
              )}
              {dte > 7 && <Fact big label="Time in the premium" value={c.mark > 0 && Number.isFinite(c.extrinsic) ? `${((c.extrinsic / c.mark) * 100).toFixed(0)}%` : '—'} />}
            </div>
            {(next && next.daysOut >= 0 && next.daysOut <= (Number.isFinite(dte) ? dte : 0)) || prints.length ? (
              <div className="flex flex-col gap-1 pt-1">
                {next && next.daysOut >= 0 && next.daysOut <= (Number.isFinite(dte) ? dte : 0) ? <p className="text-t12 text-textPrimary">{ticker} reports {next.dateLabel}</p> : null}
                {prints.map(e => (
                  <p key={e.id} className="text-t12 text-textPrimary">{e.title} <span className="text-textMuted">· {e.timeLabel}</span></p>
                ))}
              </div>
            ) : (
              <p className="text-t12 text-textMuted">Nothing on the calendar inside this window.</p>
            )}
          </div>
        )}
      </div>
      <span className="shrink-0 pt-1 text-t11 text-textMuted">{foot}</span>
    </div>
  );
};

export default StrikeCase;
