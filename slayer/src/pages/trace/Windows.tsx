/* One name's session cut into quarter hours: when its options day happened and which way each quarter hour leaned. Each
   quarter hour sums the vendor's own minutes (/stock/{t}/net-prem-ticks, every expiry); nothing is shaped or guessed. */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { VENDOR_TOTAL_NOTE, windowLabel, type IntervalWindow } from '../../data/flowBook';
import { fmtCount as num, SESSION_OPEN, sessionEndLabel, sessionEndMin, sessionPhase, tapeSessionIso, useNameMinutes, usd as fmtUsd, type NameMinute } from '../../data/traceLive';
import { isLiveDay, shortDay } from '../../components/trace/dayWords';
import { nyParts } from '../../core/nyTime';
import type { Column } from '../../components/ui/DataTable';
import RichRead from '../../components/ui/RichRead';
import ScopeChip from '../../components/ui/ScopeChip';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import { WindowsGuide } from '../../components/trace/TraceGuide';
import DayStrip from '../../components/trace/DayStrip';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { isQuery, useAddressCut } from '../../components/trace/addressCut';

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtUsd(Math.abs(v))}`;
/** Net calls bought lean bullish, net puts bought bearish */
const callInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textMuted');
const putInk = (v: number) => callInk(-v);

/** One quarter hour of the name's session */
interface Quarter {
  idx: number;
  label: string;
  live: boolean;
  vol: number;
  callVol: number;
  putVol: number;
  callAsk: number;
  callBid: number;
  putAsk: number;
  putBid: number;
  netCall: number;
  netPut: number;
  /** Share of the session's contracts so far, 0–100 */
  sharePct: number;
  /** Minutes with a figure inside it */
  minutes: number;
}

function quartersOf(rows: NameMinute[], nowIdx: number | null, slots: number): Quarter[] {
  const q: Quarter[] = [];
  for (const m of rows) {
    const idx = Math.floor(m.min / 15);
    if (idx < 0 || idx >= slots) continue;
    let w = q[idx];
    if (!w) {
      w = { idx, label: windowLabel(idx), live: false, vol: 0, callVol: 0, putVol: 0, callAsk: 0, callBid: 0, putAsk: 0, putBid: 0, netCall: 0, netPut: 0, sharePct: 0, minutes: 0 };
      q[idx] = w;
    }
    w.callVol += m.callVol;
    w.putVol += m.putVol;
    w.vol += m.callVol + m.putVol;
    w.callAsk += m.callAsk;
    w.callBid += m.callBid;
    w.putAsk += m.putAsk;
    w.putBid += m.putBid;
    w.netCall += m.netCall;
    w.netPut += m.netPut;
    w.minutes += 1;
  }
  const out = q.filter(Boolean);
  const total = out.reduce((a, w) => a + w.vol, 0) || 1;
  for (const w of out) {
    w.sharePct = (w.vol / total) * 100;
    w.live = nowIdx != null && w.idx === nowIdx;
  }
  return out;
}

/** The quarter hour the New York clock is in during the session, else null */
function liveQuarter(endMin: number): number | null {
  const p = nyParts(new Date());
  const m = p.hour * 60 + p.minute - 570;
  /* a trading day (the phase is not "closed") inside the name's own session — 16:00 or 16:15 */
  return sessionPhase() !== 'closed' && m >= 0 && m < endMin - 570 ? Math.floor(m / 15) : null;
}

const WIDTHS: Record<string, number> = { win: 132, vol: 104, share: 120, calls: 150, puts: 150, ncall: 104, nput: 104, net: 104 };
const TOOLTIPS: Record<string, string> = {
  vol: 'Calls and puts traded in the quarter hour, every expiry',
  share: "The quarter hour's share of the session's contracts so far",
  calls: 'Calls traded, and how many of them at the ask against on the bid',
  puts: 'Puts traded, and how many of them at the ask against on the bid',
  ncall: 'Call premium at the ask less on the bid; bought leans bullish',
  nput: 'Put premium at the ask less on the bid; bought leans bearish',
  net: `Net calls less net puts: the quarter hour’s lean. ${VENDOR_TOTAL_NOTE}`,
};

const SideSplit = ({ ask, bid, total }: { ask: number; bid: number; total: number }) => (
  <span className="inline-flex flex-col items-end leading-none gap-[3px] align-middle">
    <span className="font-mono tnum text-textPrimary">{num(total)}</span>
    <span className="font-mono text-t11 tnum text-textSecondary whitespace-nowrap">
      ask {num(ask)} · bid {num(bid)}
    </span>
  </span>
);

const Windows = () => {
  const { activeTicker } = useTicker();
  const [guideOpen, setGuideOpen] = useState(false);
  const addr = useAddressCut({
    name: { def: '', valid: isQuery },
    win: { def: 'live', valid: (v: string) => v === 'live' || /^\d{1,2}$/.test(v) },
  });
  const name = (addr.cut.name || activeTicker || 'SPY').toUpperCase();
  const pack = useNameMinutes(name);
  const hold = useHold(pack.rows, name, !(pack.waiting && pack.rows.length === 0));
  /* the name's own session: to 16:15 for the index and ETF options that trade then */
  const endMin = sessionEndMin(name);
  const slots = (endMin - SESSION_OPEN) / 15;
  const nowIdx = liveQuarter(endMin);
  const closed = nowIdx == null;
  const quarters = useMemo(() => quartersOf(hold.value, hold.paused ? null : nowIdx, slots), [hold.value, hold.paused, nowIdx, slots]);
  const windows = useMemo<IntervalWindow[]>(() => quarters.map(q => ({ idx: q.idx, label: q.label, totalVol: q.vol, live: q.live })), [quarters]);
  const state: 'reading' | 'down' | 'in' = quarters.length ? 'in' : pack.fault ? 'down' : pack.waiting ? 'reading' : 'in';

  /* "Newest" is the newest quarter hour with a figure, in the session and after it; Busiest is its own champion */
  const lastIdx = quarters.length ? quarters[quarters.length - 1].idx : 0;
  const winIdx = addr.cut.win === 'live' ? lastIdx : Number(addr.cut.win);
  const sel = quarters.find(q => q.idx === winIdx) ?? null;
  const setWin = useCallback((v: number | 'live') => addr.set({ win: String(v) }), [addr]);

  const marks = useMemo(() => ({ vol: earnMarks(quarters, q => q.vol) }), [quarters]);
  /* the data's own day, named when it is not today's */
  const dataDay = hold.value.find(m => m.day)?.day ?? tapeSessionIso();
  const onDay = isLiveDay(dataDay) ? 'today' : `on ${shortDay(dataDay)}`;
  const dayTag = isLiveDay(dataDay) ? '' : `${shortDay(dataDay)} · `;
  const day = useMemo(() => {
    const t = quarters.reduce(
      (a, q) => ({ vol: a.vol + q.vol, netCall: a.netCall + q.netCall, netPut: a.netPut + q.netPut }),
      { vol: 0, netCall: 0, netPut: 0 }
    );
    const busiest = quarters.reduce<Quarter | null>((a, q) => (!a || q.vol > a.vol ? q : a), null);
    const bull = quarters.reduce<Quarter | null>((a, q) => (!a || q.netCall - q.netPut > a.netCall - a.netPut ? q : a), null);
    const bear = quarters.reduce<Quarter | null>((a, q) => (!a || q.netCall - q.netPut < a.netCall - a.netPut ? q : a), null);
    return { ...t, busiest, bull, bear };
  }, [quarters]);

  const read = useMemo<ReactNode>(() => {
    if (state === 'reading') return <RichRead text={`Reading ${name}'s minutes.`} />;
    if (state === 'down') return <RichRead text="This read did not land — the quarter hours fill when the feed answers." />;
    if (!sel) return <RichRead text={`${name} has no options traded in the regular session yet.`} />;
    const lean = sel.netCall - sel.netPut;
    return (
      <RichRead
        text={`${isLiveDay(dataDay) ? '' : `On ${shortDay(dataDay)}, b`}${isLiveDay(dataDay) ? 'B' : ''}etween ${sel.label.replace('–', ' and ')} ET, ${name} traded ${num(sel.vol)} option contracts — ${sel.sharePct.toFixed(1)}% of its ${closed ? 'session' : 'session so far'} — net calls ${signed(sel.netCall)} and ${sel.netPut >= 0 ? `bearish net puts bought ${fmtUsd(sel.netPut)}` : `bullish net puts sold ${fmtUsd(Math.abs(sel.netPut))}`}, so the quarter hour leaned ${lean >= 0 ? 'bullish' : 'bearish'} by ${fmtUsd(Math.abs(lean))}${sel.live ? '. It is still filling' : ''}. Every expiry, minute by minute — a summed total, spread legs and floor packages in it.`}
      />
    );
  }, [state, sel, name, closed, dataDay]);

  const leadLine =
    state === 'reading'
      ? `Reading ${name}'s minutes…`
      : state === 'down'
        ? 'This read did not land — the quarter hours fill when the feed answers.'
        : !sel
          ? `${name} has no options traded in the regular session yet.`
          : `${sel.label} ET: ${name} leaned ${sel.netCall - sel.netPut >= 0 ? 'bullish' : 'bearish'} by ${fmtUsd(Math.abs(sel.netCall - sel.netPut))} on ${num(sel.vol)} contracts.`;
  const columns = useMemo<Column<Quarter>[]>(
    () => [
      {
        key: 'win',
        header: 'Quarter hour',
        sortValue: q => q.idx,
        render: q => (
          <span className="inline-flex items-center gap-2 font-mono tnum text-textPrimary">
            {q.label}
            {q.live && <span className="text-t11 text-select animate-live-breathe">filling</span>}
          </span>
        ),
      },
      { key: 'vol', header: 'Contracts', align: 'right', sortValue: q => q.vol, render: q => <span className={`font-mono tnum ${weightInk(q.vol, marks.vol)}`}>{num(q.vol)}</span> },
      {
        key: 'share',
        header: 'Share of day',
        align: 'right',
        sortValue: q => q.sharePct,
        render: q => (
          <span className="inline-flex items-center gap-1.5 justify-end">
            <span className="relative inline-block w-10 h-1 rounded-full bg-ink/[0.08] overflow-hidden align-middle">
              <span className="absolute left-0 top-0 h-full bg-ink/50" style={{ width: `${Math.min(100, q.sharePct * 4)}%` }} />
            </span>
            <span className="tnum text-textPrimary">{q.sharePct.toFixed(1)}%</span>
          </span>
        ),
      },
      { key: 'calls', header: 'Calls', align: 'right', sortValue: q => q.callVol, render: q => <SideSplit ask={q.callAsk} bid={q.callBid} total={q.callVol} /> },
      { key: 'puts', header: 'Puts', align: 'right', sortValue: q => q.putVol, render: q => <SideSplit ask={q.putAsk} bid={q.putBid} total={q.putVol} /> },
      { key: 'ncall', header: 'Net calls', align: 'right', sortValue: q => q.netCall, render: q => <span className={`font-mono tnum ${callInk(q.netCall)}`}>{signed(q.netCall)}</span> },
      { key: 'nput', header: 'Net puts', align: 'right', sortValue: q => q.netPut, render: q => <span className={`font-mono tnum ${putInk(q.netPut)}`}>{signed(q.netPut)}</span> },
      { key: 'net', header: 'Lean', align: 'right', sortValue: q => q.netCall - q.netPut, render: q => <span className={`font-mono tnum font-semibold ${callInk(q.netCall - q.netPut)}`}>{signed(q.netCall - q.netPut)}</span> },
    ],
    [marks]
  );
  const phoneRow = (q: Quarter) => (
    <PhoneRow
      title={
        <>
          <span className="font-bold tnum">{q.label}</span>
          {q.live && <span className="text-select">filling</span>}
        </>
      }
      aside={`${q.sharePct.toFixed(1)}% of day`}
      figures={[
        <span key="v" className="font-semibold text-textPrimary">
          {num(q.vol)} contracts
        </span>,
        <span key="c" className={callInk(q.netCall)}>
          calls {signed(q.netCall)}
        </span>,
        <span key="p" className={putInk(q.netPut)}>
          puts {signed(q.netPut)}
        </span>,
      ]}
    />
  );
  const keyOf = useCallback((q: Quarter) => String(q.idx), []);
  const stepBtn = 'inline-flex items-center justify-center w-7 h-7 rounded-md border border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary hover:border-borderMuted disabled:opacity-30 transition-colors';
  const pos = quarters.findIndex(q => q.idx === winIdx);

  return (
    <>
      <DayStrip windows={state === 'in' ? windows : []} selectedIdx={winIdx} onSelect={i => setWin(i)} paused={hold.paused} slots={slots} />
      <TraceBox
        title="A quarter hour of the day"
        sub={`${name}'s options ${onDay}, every expiry, 09:30–${sessionEndLabel(name)} in quarter hours · a row or a bar picks one`}
        testId="windows"
        data={{ name, window: sel?.label, rows: quarters.length }}
        foldOnPhone
        guide={{ title: 'How to read the quarter hours', door: 'What the bars, the sides and the lean mean', body: <WindowsGuide />, testId: 'windows-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label={isLiveDay(dataDay) ? 'The session' : `The session · ${shortDay(dataDay)}`} testId="session" title={`${name}'s contracts ${onDay}, 09:30–${sessionEndLabel(name)}, every expiry: the minute ticks, as on Net Flow's pane`}>
              {state !== 'in' ? <span className="text-textMuted">—</span> : <>{num(day.vol)} <span className="text-textSecondary">contracts · lean</span> <span className={callInk(day.netCall - day.netPut)}>{signed(day.netCall - day.netPut)}</span></>}
            </Fact>
            <Fact label="This quarter hour" testId="window">
              {sel ? (
                <>
                  {sel.label} <span className="text-textSecondary">·</span> {num(sel.vol)} <span className="text-textSecondary">contracts</span>
                  {sel.live && (
                    <span className="ml-2 inline-grid text-t11">
                      <span className="invisible col-start-1 row-start-1" aria-hidden>still filling</span>
                      <span className={`col-start-1 row-start-1 ${hold.paused ? 'text-warn' : 'text-select animate-live-breathe'}`}>{hold.paused ? 'held' : 'still filling'}</span>
                    </span>
                  )}
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            {day.busiest && (
              <Champion label="Busiest" ink="supreme" title="Open this quarter hour" onOpen={() => setWin(day.busiest!.idx)} testId="busiest">
                {dayTag}{day.busiest.label} · {num(day.busiest.vol)}
              </Champion>
            )}
            {day.bull && day.bull.netCall - day.bull.netPut > 0 && (
              <Champion label="Most bullish" ink="bull" title="Open this quarter hour: net calls less net puts" onOpen={() => setWin(day.bull!.idx)} testId="bull">
                {dayTag}{day.bull.label} · {signed(day.bull.netCall - day.bull.netPut)}
              </Champion>
            )}
            {day.bear && day.bear.netCall - day.bear.netPut < 0 && (
              <Champion label="Most bearish" ink="bear" title="Open this quarter hour: net calls less net puts" onOpen={() => setWin(day.bear!.idx)} testId="bear">
                {dayTag}{day.bear.label} · {signed(day.bear.netCall - day.bear.netPut)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={pack.at} fault={pack.fault} paused={hold.paused} ttlMs={45_000} kept={pack.kept} />
            <ScopeChip ticker={name} quote closeOutside onPick={t => addr.set({ name: t, win: 'live' })} title="The name whose session is cut into quarter hours" />
            <span className="inline-flex items-center gap-1.5 flex-wrap" data-windows-nav data-span>
              <button type="button" onClick={() => pos > 0 && setWin(quarters[pos - 1].idx)} disabled={pos <= 0} aria-label="Previous quarter hour" className={stepBtn}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="inline-flex items-center gap-2 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip font-mono">
                <span className="text-t11 font-semibold tnum text-textPrimary">{sel ? `${sel.label} ET` : '—'}</span>
              </span>
              <button type="button" onClick={() => pos >= 0 && pos < quarters.length - 1 && setWin(quarters[pos + 1].idx)} disabled={pos < 0 || pos >= quarters.length - 1} aria-label="Next quarter hour" className={stepBtn}>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setWin('live')}
                aria-pressed={addr.cut.win === 'live'}
                title="Follow the newest quarter hour"
                className={`h-7 px-2.5 rounded-md border font-mono text-t11 uppercase tracking-widest transition-colors ${addr.cut.win === 'live' ? 'border-silver/50 bg-silver/[0.06] text-textPrimary' : 'border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary hover:border-borderMuted'}`}
                data-windows-latest
              >
                Newest
              </button>
            </span>
          </>
        }
        sentence={null}
      lead={leadLine}
      detail={read}
      >
        <TraceGrid
          rows={quarters}
          columns={columns}
          widths={WIDTHS}
          tooltips={TOOLTIPS}
          rowKey={keyOf}
          onRowClick={q => setWin(q.idx)}
          selectedKey={sel ? String(sel.idx) : null}
          phoneRow={phoneRow}
          autoHeight
          animate={false}
          emptyText={state === 'reading' ? `Reading ${name}'s minutes` : state === 'down' ? 'This read did not land' : `${name} has no options traded in the regular session yet`}
          testId="windows"
        />
      </TraceBox>
    </>
  );
};

export default Windows;
