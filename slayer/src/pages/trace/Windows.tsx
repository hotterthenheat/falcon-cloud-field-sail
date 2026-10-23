/*
==================================================
  SLAYER TERMINAL - INTERVALS (Trace)
  One name's session cut into quarter hours: WHEN
  did its options day happen, and which way did each
  quarter hour lean?

  REBUILT ON THE VENDOR'S MINUTES (the audit,
  2026-10-22): this page spread each contract's day
  volume over the quarter hours with hashed weights —
  every figure on it was invented. A contract's own
  minute bars are one request per contract, which the
  key's three-request ceiling cannot carry for a book
  of two hundred; the NAME's minutes are one request:
  /stock/{t}/net-prem-ticks — every minute's calls
  and puts traded, by side, and the net call and net
  put premium (at the ask less on the bid), across
  every expiry. Each quarter hour sums its fifteen
  minutes; nothing is shaped, scaled or guessed.
==================================================
*/

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { VENDOR_TOTAL_NOTE, windowLabel, type IntervalWindow } from '../../data/flowBook';
import { SESSION_OPEN, sessionEndLabel, sessionEndMin, sessionPhase, useNameMinutes, usd as fmtUsd, type NameMinute } from '../../data/traceLive';
import { nyParts } from '../../core/nyTime';
import type { Column } from '../../components/ui/DataTable';
import RichRead from '../../components/ui/RichRead';
import ScopeChip from '../../components/ui/ScopeChip';
import { FLOW_TTL_MS, StaleMark } from '../../components/ui/liveRead';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import DayStrip from '../../components/trace/DayStrip';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { isQuery, useAddressCut } from '../../components/trace/addressCut';

const num = (v: number) => v.toLocaleString('en-US');
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtUsd(Math.abs(v))}`;
/** Net calls bought lean bullish; net puts bought lean bearish — one colour rule */
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
  share: "The quarter hour's share of the session's contracts — so far while the session runs",
  calls: 'Calls traded, and how many of them at the ask against on the bid',
  puts: 'Puts traded, and how many of them at the ask against on the bid',
  ncall: 'Net call premium: call premium at the ask less on the bid — bought leans bullish',
  nput: 'Net put premium: put premium at the ask less on the bid — bought leans bearish',
  net: 'Net calls less net puts — the quarter hour’s lean',
};

const SideSplit = ({ ask, bid, total }: { ask: number; bid: number; total: number }) => (
  <span className="inline-flex flex-col items-end leading-none gap-[3px] align-middle">
    <span className="font-mono tnum text-textPrimary">{num(total)}</span>
    <span className="font-mono text-[11px] tnum text-textSecondary whitespace-nowrap">
      ask {num(ask)} · bid {num(bid)}
    </span>
  </span>
);

const Windows = () => {
  const { activeTicker } = useMarketData();
  const addr = useAddressCut({
    name: { def: '', valid: isQuery },
    win: { def: 'live', valid: (v: string) => v === 'live' || /^\d{1,2}$/.test(v) },
  });
  const name = (addr.cut.name || activeTicker || 'SPY').toUpperCase();
  const pack = useNameMinutes(name);
  const hold = useHold(pack.rows, name);
  /* THE NAME'S OWN SESSION: to 16:15 for the index and ETF options that trade then (the re-audit, 2026-10-22) */
  const endMin = sessionEndMin(name);
  const slots = (endMin - SESSION_OPEN) / 15;
  const nowIdx = liveQuarter(endMin);
  const closed = nowIdx == null;
  const quarters = useMemo(() => quartersOf(hold.value, hold.paused ? null : nowIdx, slots), [hold.value, hold.paused, nowIdx, slots]);
  const windows = useMemo<IntervalWindow[]>(() => quarters.map(q => ({ idx: q.idx, label: q.label, totalVol: q.vol, live: q.live })), [quarters]);
  const state: 'reading' | 'down' | 'in' = quarters.length ? 'in' : pack.fault ? 'down' : pack.waiting ? 'reading' : 'in';

  /* "Live" follows the quarter hour the clock is in — said as still filling — or the session's last one after the bell */
  const lastIdx = quarters.length ? quarters[quarters.length - 1].idx : 0;
  const winIdx = addr.cut.win === 'live' ? lastIdx : Number(addr.cut.win);
  const sel = quarters.find(q => q.idx === winIdx) ?? null;
  const setWin = useCallback((v: number | 'live') => addr.set({ win: String(v) }), [addr]);

  const marks = useMemo(() => ({ vol: earnMarks(quarters, q => q.vol) }), [quarters]);
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
        text={`Between ${sel.label.replace('–', ' and ')} ET, ${name} traded ${num(sel.vol)} option contracts — ${sel.sharePct.toFixed(1)}% of its ${closed ? 'session' : 'session so far'} — net calls ${signed(sel.netCall)} and ${sel.netPut >= 0 ? `bearish net puts bought ${fmtUsd(sel.netPut)}` : `bullish net puts sold ${fmtUsd(Math.abs(sel.netPut))}`}, so the quarter hour leaned ${lean >= 0 ? 'bullish' : 'bearish'} by ${fmtUsd(Math.abs(lean))}${sel.live ? '. It is still filling' : ''}. Every expiry, from the vendor's minute ticks.`}
      />
    );
  }, [state, sel, name, closed]);

  const columns = useMemo<Column<Quarter>[]>(
    () => [
      {
        key: 'win',
        header: 'Quarter hour',
        sortValue: q => q.idx,
        render: q => (
          <span className="inline-flex items-center gap-2 font-mono tnum text-textPrimary">
            {q.label}
            {q.live && <span className="text-[11px] text-select animate-live-breathe">filling</span>}
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
        sub={`${name}'s options, every expiry, 09:30–${sessionEndLabel(name)} ET in quarter hours — from the vendor's minute ticks · a row or a bar picks the quarter hour`}
        testId="windows"
        data={{ name, window: sel?.label, rows: quarters.length }}
        facts={
          <>
            <Fact label="The session" testId="session" title={`${name}'s option contracts traded ${closed ? '' : 'so far '}in the regular session (09:30–${sessionEndLabel(name)} ET), every expiry — the vendor's minute ticks (/stock/{t}/net-prem-ticks), the figure Net Flow's pane and Compare's net show. ${VENDOR_TOTAL_NOTE}`}>
              {state !== 'in' ? <span className="text-textMuted">—</span> : <>{num(day.vol)} <span className="text-textSecondary">contracts · lean</span> <span className={callInk(day.netCall - day.netPut)}>{signed(day.netCall - day.netPut)}</span></>}
            </Fact>
            <Fact label="This quarter hour" testId="window">
              {sel ? (
                <>
                  {sel.label} <span className="text-textSecondary">·</span> {num(sel.vol)} <span className="text-textSecondary">contracts</span>
                  {sel.live && (hold.paused ? <span className="ml-2 text-[11px] text-warn">held</span> : <span className="ml-2 text-[11px] text-select animate-live-breathe">still filling</span>)}
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            {day.busiest && (
              <Champion label="Busiest" ink="supreme" title="Open this quarter hour" onOpen={() => setWin(day.busiest!.idx)} testId="busiest">
                {day.busiest.label} · {num(day.busiest.vol)}
              </Champion>
            )}
            {day.bull && day.bull.netCall - day.bull.netPut > 0 && (
              <Champion label="Most bullish" ink="bull" title="Open this quarter hour" onOpen={() => setWin(day.bull!.idx)} testId="bull">
                {day.bull.label} · {signed(day.bull.netCall - day.bull.netPut)}
              </Champion>
            )}
            {day.bear && day.bear.netCall - day.bear.netPut < 0 && (
              <Champion label="Most bearish" ink="bear" title="Open this quarter hour" onOpen={() => setWin(day.bear!.idx)} testId="bear">
                {day.bear.label} · {signed(day.bear.netCall - day.bear.netPut)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            <StaleMark at={pack.at} ttlMs={FLOW_TTL_MS} fault={pack.fault} />
            <ScopeChip ticker={name} quote closeOutside onPick={t => addr.set({ name: t, win: 'live' })} title="The name whose session is cut into quarter hours" />
            <span className="inline-flex items-center gap-1.5 flex-wrap" data-windows-nav data-span>
              <button type="button" onClick={() => pos > 0 && setWin(quarters[pos - 1].idx)} disabled={pos <= 0} aria-label="Previous quarter hour" className={stepBtn}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="inline-flex items-center gap-2 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip font-mono">
                <span className="text-[11px] font-semibold tnum text-textPrimary">{sel ? `${sel.label} ET` : '—'}</span>
              </span>
              <button type="button" onClick={() => pos >= 0 && pos < quarters.length - 1 && setWin(quarters[pos + 1].idx)} disabled={pos < 0 || pos >= quarters.length - 1} aria-label="Next quarter hour" className={stepBtn}>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setWin('live')}
                aria-pressed={addr.cut.win === 'live'}
                title="Follow the newest quarter hour — the one the clock is in, still filling"
                className={`h-7 px-2.5 rounded-md border font-mono text-[11px] uppercase tracking-widest transition-colors ${addr.cut.win === 'live' ? 'border-silver/50 bg-silver/[0.06] text-textPrimary' : 'border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary hover:border-borderMuted'}`}
                data-windows-latest
              >
                Newest
              </button>
            </span>
          </>
        }
        sentence={read}
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
