/* The blotter: the official record, every call the server's scan fired, with the quote it fired on, the fill a
   minute later and the exit, all read off the contract's own one-minute NBBO from ThetaData. Return is the exit
   against the fill. Every browser shows the same rows. */

import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import type { Column } from '../../components/ui/DataTable';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import ContractLabel from '../../components/ui/ContractLabel';
import { isoDate, type Expiry, MONTHS as SHORT } from '../../core/calendar';
import { nyClock } from '../../core/nyTime';
import { heldWords, usd, dirInk } from '../../components/review/words';
import { useSignals, type Signal } from '../../data/compassLedger';
import { daySummary } from '../../data/compassOutcome';
import { backlogLine, useCompassFeed } from '../../data/compassFeed';
import { EmptyBox, ErrorBox, LoadingBox, asOfText } from '../../components/ui/states';
import { useThetaStatus } from '../../data/thetaQuote';
import { Tip } from '../../components/ui/Tooltip';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const longDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEK[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const dayCell = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const blank = <span className="text-textMuted">—</span>;

type Result = 'win' | 'loss' | 'open' | 'waiting' | 'unavailable';

interface Line {
  key: string;
  date: string;
  ticker: string;
  label: string;
  right: 'C' | 'P';
  book: Signal['book'];
  p1: number | null;
  fired: number;
  bid: number;
  ask: number;
  paid: number;
  exitPx: number | null;
  out: number | null;
  held: number | null;
  ret: number | null;
  pnl: number | null;
  result: Result;
  why: string;
  late: boolean;
  mark: number;
  sig: Signal;
}

const bookExpiry = (iso: string): Expiry => {
  const date = new Date(`${iso}T12:00:00`);
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  return {
    date,
    label: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${String(date.getFullYear()).slice(2)}`,
    weekday: DOW[date.getDay()],
    dte: Math.round((date.getTime() - base.getTime()) / 86400000),
    sessions: 0,
  };
};
const pctWords = (v: number, digits = 0) => {
  const s = digits ? Math.abs(v).toFixed(digits) : String(Math.round(Math.abs(v)));
  if (Number(s) === 0) return '0%';
  return `${v > 0 ? '+' : '−'}${s}%`;
};
const RESULT_WORD: Record<Result, string> = { win: 'Win', loss: 'Loss', open: 'Open', waiting: 'Filling', unavailable: 'Unavailable' };
const RESULT_INK: Record<Result, string> = { win: 'text-bull', loss: 'text-bear', open: 'text-textPrimary', waiting: 'text-textSecondary', unavailable: 'text-textMuted' };

const lineOf = (s: Signal): Line => {
  const o = s.outcome;
  const status = o?.status ?? 'waiting';
  const paid = o?.fill?.ask ?? 0;
  /* a win is a gain after the round trip's fees, the same rule as the day's count */
  const result: Result = status === 'closed' ? (o?.pnl != null && o.pnl > 0 ? 'win' : 'loss') : status;
  return {
    key: s.key,
    date: s.day,
    ticker: s.ticker,
    label: s.contract,
    right: s.right,
    book: s.book,
    p1: s.p1,
    fired: s.firedAt,
    bid: s.bid,
    ask: s.ask,
    paid,
    exitPx: o?.exit?.px ?? null,
    out: o?.exit?.at ?? null,
    held: o?.heldMin ?? null,
    ret: o?.ret ?? null,
    pnl: o?.pnl ?? null,
    result,
    late: s.how === 'late',
    mark: s.mark ?? s.firedAt,
    sig: s,
    why: status === 'closed'
      ? o?.exit?.why ?? ''
      : status === 'open'
        ? `Open. Last bid ${o?.last ? usd(o.last.bid) : '—'} at ${o?.last ? nyClock(o.last.t, { zone: true }) : '—'}.`
        : status === 'unavailable'
          ? 'No valid quote stood a minute after the call. No price was substituted.'
          : 'Fills at the ask of the first quote a full minute after the call.',
  };
};

const COLUMNS: Column<Line>[] = [
  { key: 'day', header: 'Day', sortValue: r => r.date, render: r => <span className="text-textMuted">{dayCell(r.date)}</span> },
  { key: 'fired', header: 'Called ET', sortValue: r => r.fired, render: r => (r.late
    ? <Tip label={`Scored late from recorded quotes (${nyClock(r.mark)} ET mark): the live scan missed it.`}><span className="tnum text-warn">{nyClock(r.mark)} late</span></Tip>
    : <span className="tnum text-textPrimary">{nyClock(r.fired)}</span>) },
  { key: 'contract', header: 'Contract', sortValue: r => r.label, render: r => <ContractLabel contract={r.label} right={r.right} logo={r.ticker} size="sm" /> },
  { key: 'book', header: 'Book', sortValue: r => r.book, render: r => <span className="text-textPrimary">{r.book}</span> },
  { key: 'p1', header: 'Model 1', align: 'right', sortValue: r => r.p1 ?? -1, render: r => (r.p1 == null ? blank : <span className="tnum text-textPrimary">{(r.p1 * 100).toFixed(1)}%</span>) },
  { key: 'quote', header: 'Quote at call', align: 'right', sortValue: r => r.ask, render: r => <span className="tnum text-textSecondary">{r.bid.toFixed(2)} × {r.ask.toFixed(2)}</span> },
  { key: 'paid', header: 'Filled', align: 'right', sortValue: r => r.paid, render: r => (r.paid > 0 ? <span className="tnum text-textPrimary">{usd(r.paid)}</span> : blank) },
  { key: 'exitPx', header: 'Exit', align: 'right', sortValue: r => r.exitPx ?? -1, render: r => (r.exitPx == null ? blank : <span className="tnum text-textPrimary">{usd(r.exitPx)}</span>) },
  { key: 'out', header: 'Out ET', align: 'right', sortValue: r => r.out ?? 0, render: r => (r.out == null ? blank : <span className="tnum text-textSecondary">{nyClock(r.out)}</span>) },
  { key: 'held', header: 'Held', align: 'right', sortValue: r => r.held ?? -1, render: r => (r.held == null ? blank : <span className="tnum text-textSecondary">{heldWords(r.held)}</span>) },
  { key: 'ret', header: 'Return', align: 'right', sortValue: r => r.ret ?? -1e9, render: r => (r.ret == null ? blank : <span className={`tnum ${dirInk(r.ret)}`}>{pctWords(r.ret, 1)}</span>) },
  { key: 'pnl', header: 'P&L', align: 'right', sortValue: r => r.pnl ?? -1e9, render: r => (r.pnl == null ? blank : <span className={`tnum ${dirInk(r.pnl)}`}>{`${r.pnl < 0 ? '−' : '+'}${usd(Math.abs(r.pnl))}`}</span>) },
  { key: 'result', header: 'Result', align: 'right', sortValue: r => r.result, render: r => <Tip label={r.why || undefined}><span className={RESULT_INK[r.result]}>{RESULT_WORD[r.result]}</span></Tip> },
];
const WIDTHS: Record<string, number> = { day: 72, fired: 92, contract: 180, book: 64, p1: 84, quote: 116, paid: 80, exitPx: 80, out: 68, held: 80, ret: 84, pnl: 88, result: 96 };
const TOOLTIPS: Record<string, string> = {
  fired: 'When the scan sent the call, New York time.',
  p1: 'Model 1 at the call. Book C has no model.',
  quote: 'The bid and ask the model read when it called.',
  paid: 'The ask of the first quote a full minute after the call.',
  exitPx: 'The bid it left on, or the take-profit price.',
  out: 'When it left, New York time.',
  ret: 'Exit against the fill. An open signal shows its last bid against the fill.',
  pnl: 'Per contract, after an estimated $1.08 round trip plus the SEC fee.',
  result: 'Win or loss once it closed. Hover for why.',
};

/** A name matches the whole ticker. "QQQ" is QQQ, not TQQQ. Extra tokens have to be in the contract. */
const matchesQuery = (ticker: string, label: string, raw: string) => {
  const tokens = raw.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return true;
  const names = tokens.filter(t => /^[A-Z]{1,6}$/.test(t));
  const rest = tokens.filter(t => !/^[A-Z]{1,6}$/.test(t));
  if (names.length && !names.some(t => t === ticker)) return false;
  return rest.every(t => label.toUpperCase().includes(t));
};

const resultOf = (rows: Line[]) => {
  let wins = 0, winRet = 0, losses = 0, lossRet = 0, hold = 0, holdN = 0, pnl = 0;
  for (const r of rows) {
    if (r.result !== 'win' && r.result !== 'loss') continue;
    if (r.held != null) { hold += r.held; holdN += 1; }
    if (r.pnl != null) pnl += r.pnl;
    if (r.result === 'win') { wins += 1; winRet += r.ret ?? 0; }
    else { losses += 1; lossRet += r.ret ?? 0; }
  }
  const closed = wins + losses;
  return {
    n: rows.length,
    closed,
    wins,
    avgWin: wins ? winRet / wins : null,
    avgLoss: losses ? lossRet / losses : null,
    avgHold: holdN ? hold / holdN : null,
    pnl: closed ? pnl : null,
  };
};

const Blotter = () => {
  const [side, setSide] = useState<'all' | 'call' | 'put'>('all');
  const [q, setQ] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const record = useSignals();
  const theta = useThetaStatus();
  const lines = useMemo(() => record.map(lineOf), [record]);

  const bookDays = useMemo(() => [...new Set(lines.map(l => l.date))].sort().reverse().map(bookExpiry), [lines]);
  const iso = openDay && lines.some(l => l.date === openDay) ? openDay : null;
  const rows = useMemo(() => {
    const n = q.trim().toUpperCase();
    return (iso ? lines.filter(l => l.date === iso) : lines).filter(r => {
      if (side === 'put' && r.right !== 'P') return false;
      if (side === 'call' && r.right !== 'C') return false;
      if (n && !matchesQuery(r.ticker, r.label, n)) return false;
      return true;
    });
  }, [iso, side, q, lines]);
  const cut = useMemo(() => resultOf(rows), [rows]);
  const day = useMemo(() => daySummary(rows.map(r => r.sig)), [rows]);
  const feed = useCompassFeed();
  const open = record.filter(s => !s.outcome || s.outcome.status === 'open' || s.outcome.status === 'waiting');
  const readAt = open.reduce((m, s) => Math.max(m, s.pathAt), 0);
  const offlineLine = feed.status === 'offline'
    ? `Compass server offline. ${feed.error || 'Reconnecting.'}`
    : feed.status === 'kept' && feed.at
      ? `The record ${asOfText(feed.at)}. ${feed.error || 'Reconnecting to the Compass server.'}`
      : theta === 'down' && open.length
        ? `ThetaData offline — reconnecting. Open signals as of ${readAt ? nyClock(readAt, { zone: true }) : 'their call'}.`
        : '';
  const signed = (v: number) => `${v < 0 ? '−' : '+'}${usd(Math.abs(v))}`;

  return (
    <TraceBox
      title="Blotter"
      sub={iso ? longDay(iso) : 'Every call the scan fired, newest first. The same record in every browser.'}
      testId="blotter"
      foldOnPhone
      facts={
        <>
          <Fact label="Calls" testId="n">{day.calls.toLocaleString('en-US')}</Fact>
          <Fact label="Won · lost · open" testId="won" title="Closed with a gain after fees, closed at or under the fill after fees, and still held. Filling and unavailable calls are in neither.">
            <span className="text-bull">{day.won}</span> · <span className="text-bear">{day.lost}</span> · {day.open}
          </Fact>
          <Fact label="Net" testId="pnl" title="Per contract: the closed calls, one contract each, after an estimated $1.08 round trip plus the SEC fee.">{day.won + day.lost ? <span className={dirInk(day.net)}>{signed(day.net)}</span> : '—'}</Fact>
          <Fact label="Open at bid" testId="open-mark" title="The open calls marked at their last bid, after the same round-trip cost.">{day.open ? <span className={dirInk(day.openMark)}>{signed(day.openMark)}</span> : '—'}</Fact>
          <Fact label="Avg win · loss" testId="avg-win" title="Average return of the closed calls that won, and of those that lost.">{cut.avgWin == null && cut.avgLoss == null ? '—' : `${cut.avgWin == null ? '—' : pctWords(cut.avgWin, 1)} · ${cut.avgLoss == null ? '—' : pctWords(cut.avgLoss, 1)}`}</Fact>
          <Fact label="Avg hold" testId="hold" title="Average time from the fill to the exit.">{cut.avgHold == null ? '—' : heldWords(cut.avgHold)}</Fact>
        </>
      }
      controls={
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="SPY QQQ NVDA" aria-label="Find a name in the record" className="w-44 max-sm:w-full slayer-field" data-span data-blotter-search />
          <ExpiryCalendar value={iso ?? ''} expiries={bookDays} onChange={e => setOpenDay(isoDate(e.date))} onClear={() => setOpenDay(null)} anyLabel="Every day" clearLabel="Every day" steppers={iso != null} label="Day" icon={CalendarDays} title="Every day, or one day of the record" testId="blotter-day" />
          <DropdownSelect
            label="Side"
            value={side}
            options={[{ value: 'all', label: 'Calls and puts' }, { value: 'call', label: 'Calls', tone: 'bull' }, { value: 'put', label: 'Puts', tone: 'bear' }]}
            onChange={setSide}
            title="Which signals the record shows"
            testId="blotter-side"
          />
        </>
      }
      sentence={offlineLine || backlogLine(feed.marks) ? <span data-blotter-offline>{offlineLine || backlogLine(feed.marks)}</span> : false}
    >
      {rows.length === 0 ? (
        <div className="border-t border-borderSubtle" data-blotter-empty>
          {feed.status === 'loading' && !lines.length ? (
            <LoadingBox shape="table" rows={4} label="Reading the record" />
          ) : feed.status === 'offline' && !lines.length ? (
            <ErrorBox what="The record did not load" detail={feed.error || 'The Compass server did not answer.'} />
          ) : (
            <EmptyBox
              title={q.trim() ? 'No match' : lines.length ? 'Nothing on this cut' : 'No call yet'}
              reason={q.trim()
                ? `No call matches “${q.trim()}”.`
                : lines.length
                  ? 'No call on this day and side.'
                  : backlogLine(feed.marks) || 'Each Book A, B or C call is written here the moment the scan fires it, with the quote it fired on, then filled and closed on the contract’s one-minute quotes from ThetaData.'}
            />
          )}
        </div>
      ) : (
        <TraceGrid
          rows={rows}
          columns={COLUMNS}
          widths={WIDTHS}
          tooltips={TOOLTIPS}
          lockColumns
          rowKey={r => r.key}
          autoHeight
          initialSort={{ key: 'fired', dir: 'desc' }}
          animate={false}
          testId="blotter-book"
          emptyText=""
          phoneRow={r => (
            <PhoneRow
              title={<ContractLabel contract={r.label} right={r.right} logo={r.ticker} size="sm" />}
              aside={<span className={r.ret == null ? RESULT_INK[r.result] : dirInk(r.ret)}>{r.ret == null ? RESULT_WORD[r.result] : pctWords(r.ret, 1)}</span>}
              figures={[
                <span key="i">{dayCell(r.date)} · {r.late ? `${nyClock(r.mark)} ET mark, scored late` : `${nyClock(r.fired)} ET`} · Book {r.book}{r.p1 != null ? ` · ${(r.p1 * 100).toFixed(1)}%` : ''}</span>,
                <span key="p">{r.paid > 0 ? `Filled ${usd(r.paid)}` : `Quote ${r.bid.toFixed(2)} × ${r.ask.toFixed(2)}`}{r.exitPx != null ? ` · exit ${usd(r.exitPx)}${r.out ? ` ${nyClock(r.out)}` : ''}` : ''}</span>,
                <span key="h">{RESULT_WORD[r.result]}{r.held != null ? ` · ${heldWords(r.held)}` : ''}{r.pnl != null ? ` · ${signed(r.pnl)}` : ''}</span>,
              ]}
            />
          )}
        />
      )}
    </TraceBox>
  );
};

export default Blotter;
