/*
  BLOTTER — one book.
  Exit is the price it left at. Return is that price against what was paid,
  the same sum on every trade.
*/

import { useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import RECORD from '../../data/odteRecord.json';
import TAKEN from '../../data/oosTrades.json';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import type { Column } from '../../components/ui/DataTable';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import ContractLabel from '../../components/ui/ContractLabel';
import { isoDate, type Expiry } from '../../core/calendar';
import { heldWords, usd, dirInk } from '../../components/review/words';
import { COMPASS_SET } from '../../data/compassUniverse';
import { useCompassBook, type BookLine } from '../../data/compassLedger';

type Rec = [string, string, string, string, number, number, number, string, number, string];
type TakenRec = [string, string, string, string, number, number, string, number, string, number, number, number, number];
const FILE = RECORD as Rec[];
const TAKEN_FILE = TAKEN as TakenRec[];
const BOOK_FROM = '2026-07-24';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEK[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const dayCell = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const blank = <span className="text-textMuted">—</span>;
/** (exit − paid) / paid. The only return the book uses. */
const exitReturn = (paid: number, exitPx: number) => (exitPx / paid - 1) * 100;

interface Line {
  id: string;
  date: string;
  ticker: string;
  strike: number;
  label: string;
  right: 'C' | 'P';
  entry: string;
  ask: number;
  exitPx: number;
  exit: string;
  held: number | null;
  ret: number;
  stamp: number;
  result: 'win' | 'loss' | 'caution' | 'unavailable';
  why: string;
  fees: number | null;
}

const sideOf = (contract: string) => {
  const put = contract.endsWith('PUT');
  const strike = Number(contract.replace(/ (CALL|PUT)$/, ''));
  return { strike, right: (put ? 'P' : 'C') as 'C' | 'P' };
};

const LINES: Line[] = (() => {
  const byKey = new Map<string, Line>();
  const out: Line[] = [];
  FILE.forEach((r, i) => {
    if (r[0] < BOOK_FROM || !COMPASS_SET.has(r[1])) return;
    const { strike, right } = sideOf(r[2]);
    const held = minutes(r[9]) - minutes(r[3]);
    const line: Line = {
      id: `l${i}`,
      date: r[0],
      ticker: r[1],
      strike,
      label: `${r[1]} ${strike}${right}`,
      right,
      entry: r[3],
      ask: r[4],
      exitPx: r[6],
      exit: r[9],
      held: held >= 0 ? held : null,
      ret: exitReturn(r[4], r[6]),
      stamp: Number(r[0].replace(/-/g, '')) * 10000 + minutes(r[3]),
      result: r[6] > r[4] ? 'win' : 'loss',
      why: '',
      fees: null,
    };
    out.push(line);
    byKey.set(`${r[0]}|${r[1]}|${r[2]}|${r[3]}`, line);
  });
  TAKEN_FILE.forEach((r, i) => {
    if (r[0] < BOOK_FROM || !COMPASS_SET.has(r[1])) return;
    const hit = byKey.get(`${r[0]}|${r[1]}|${r[2]}|${r[3]}`);
    if (hit) {
      hit.exit = r[6];
      hit.exitPx = r[7];
      hit.held = r[9];
      hit.ret = exitReturn(hit.ask, r[7]);
      hit.result = r[7] > hit.ask ? 'win' : 'loss';
      return;
    }
    const { strike, right } = sideOf(r[2]);
    out.push({
      id: `t${i}`,
      date: r[0],
      ticker: r[1],
      strike,
      label: `${r[1]} ${strike}${right}`,
      right,
      entry: r[3],
      ask: r[4],
      exitPx: r[7],
      exit: r[6],
      held: r[9],
      ret: exitReturn(r[4], r[7]),
      stamp: Number(r[0].replace(/-/g, '')) * 10000 + minutes(r[3]),
      result: r[7] > r[4] ? 'win' : 'loss',
      why: '',
      fees: null,
    });
  });
  return out;
})();

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
const BOOK_DAYS: Expiry[] = (() => {
  const seen = new Set<string>();
  const out: Expiry[] = [];
  for (const r of LINES) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    out.push(bookExpiry(r.date));
  }
  return out;
})();

const pctWords = (v: number, digits = 0) => {
  const s = digits ? Math.abs(v).toFixed(digits) : String(Math.round(Math.abs(v)));
  if (Number(s) === 0) return '0%';
  return `${v > 0 ? '+' : '−'}${s}%`;
};
const rateWords = (wins: number, n: number) => `${((wins / n) * 100).toFixed(1)}%`;

const COLUMNS: Column<Line>[] = [
  { key: 'day', header: 'Day', sortValue: r => r.date, render: r => <span className="text-textMuted">{dayCell(r.date)}</span> },
  { key: 'in', header: 'Entry', sortValue: r => r.stamp, render: r => <span className="tnum text-textPrimary">{r.entry}</span> },
  { key: 'contract', header: 'Contract', sortValue: r => r.label, render: r => <ContractLabel contract={r.label} right={r.right} logo={r.ticker} size="sm" /> },
  { key: 'paid', header: 'Paid', align: 'right', sortValue: r => r.ask, render: r => <span className="tnum text-textPrimary">{r.ask > 0 ? usd(r.ask) : '—'}</span> },
  { key: 'fees', header: 'Fees', align: 'right', sortValue: r => r.fees ?? -1, render: r => r.fees == null ? blank : <span className="tnum text-textSecondary">{usd(r.fees)}</span> },
  { key: 'exitPx', header: 'Exit', align: 'right', sortValue: r => r.exitPx, render: r => <span className="tnum text-textPrimary">{usd(r.exitPx)}</span> },
  { key: 'out', header: 'Out', align: 'right', sortValue: r => r.exit, render: r => <span className="tnum text-textSecondary">{r.exit}</span> },
  { key: 'held', header: 'Held', align: 'right', sortValue: r => r.held ?? -1, render: r => r.held == null ? blank : <span className="tnum text-textSecondary">{heldWords(r.held)}</span> },
  { key: 'ret', header: 'Return', align: 'right', sortValue: r => r.ret, render: r => <span className={`tnum ${r.result === 'caution' ? 'text-textSecondary' : dirInk(r.ret)}`}>{pctWords(r.ret, 1)}</span> },
  { key: 'result', header: 'Result', align: 'right', sortValue: r => r.result, render: r => <span title={r.why || undefined} className={r.result === 'win' ? 'text-bull' : r.result === 'loss' ? 'text-bear' : r.result === 'unavailable' ? 'text-textMuted' : 'text-warn'}>{r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : r.result === 'unavailable' ? 'Unavailable' : 'Caution'}</span> },
];
const WIDTHS: Record<string, number> = { day: 84, in: 88, contract: 200, paid: 84, exitPx: 88, out: 72, held: 88, ret: 88, result: 88 };
const TOOLTIPS: Record<string, string> = {
  paid: 'The ask it was bought at.',
  exitPx: 'The price it left at.',
  ret: 'Exit against what was paid. A caution is not in the win count.',
  result: 'Win or loss when Compass closed it. Caution is a side flip. Not an order, and not a loss.',
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

const BY_DAY = new Map<string, Line[]>();
for (const r of LINES) {
  const list = BY_DAY.get(r.date);
  if (list) list.push(r);
  else BY_DAY.set(r.date, [r]);
}

const resultOf = (rows: Line[]) => {
  let wins = 0, winRet = 0, losses = 0, lossRet = 0, hold = 0, holdN = 0, scored = 0;
  for (const r of rows) {
    if (r.result === 'caution' || r.result === 'unavailable') continue;
    scored += 1;
    if (r.held != null) { hold += r.held; holdN += 1; }
    if (r.result === 'win') { wins += 1; winRet += r.ret; }
    else if (r.result === 'loss') { losses += 1; lossRet += r.ret; }
  }
  return {
    n: rows.length,
    scored,
    wins,
    avgWin: wins ? winRet / wins : null,
    avgLoss: losses ? lossRet / losses : null,
    avgHold: holdN ? hold / holdN : null,
  };
};

const fromBook = (l: BookLine): Line => ({
  id: l.id,
  date: l.date,
  ticker: l.ticker,
  strike: l.strike,
  label: l.contract,
  right: l.right,
  entry: l.entered ?? '—',
  ask: l.paid,
  exitPx: l.exitPx,
  exit: l.exit,
  held: l.held,
  ret: l.ret,
  stamp: l.at,
  result: l.result,
  why: l.why,
  fees: l.fees ?? null,
});

const Blotter = () => {
  const [side, setSide] = useState<'all' | 'call' | 'put'>('all');
  const [q, setQ] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const live = useCompassBook();

  const iso = openDay && BY_DAY.has(openDay) ? openDay : null;
  const rows = useMemo(() => {
    const n = q.trim().toUpperCase();
    const source = iso ? (BY_DAY.get(iso) ?? []) : LINES;
    const head = iso ? live.filter(l => l.date === iso).map(fromBook) : live.map(fromBook);
    return [...head, ...source].filter(r => {
      if (side === 'put' && r.right !== 'P') return false;
      if (side === 'call' && r.right !== 'C') return false;
      if (n && !matchesQuery(r.ticker, r.label, n)) return false;
      return true;
    });
  }, [iso, side, q, live]);
  const cut = useMemo(() => resultOf(rows), [rows]);

  return (
    <TraceBox
      title="Blotter"
      sub={iso ? longDay(iso) : 'Every day, newest first'}
      testId="blotter"
      foldOnPhone
      facts={
        <>
          <Fact label="Trades" testId="n">{cut.n.toLocaleString('en-US')}</Fact>
          <Fact label="Won" testId="won" title="Wins out of the trades Compass closed. A caution is on the blotter and out of this count.">{cut.scored ? `${cut.wins.toLocaleString('en-US')} of ${cut.scored.toLocaleString('en-US')} · ${rateWords(cut.wins, cut.scored)}` : '—'}</Fact>
          <Fact label="Avg win" testId="avg-win" title="Average return of the trades that left above what was paid.">{cut.avgWin == null ? '—' : pctWords(cut.avgWin, 1)}</Fact>
          <Fact label="Avg loss" testId="avg-loss" title="Average return of the trades that left below what was paid.">{cut.avgLoss == null ? '—' : pctWords(cut.avgLoss, 1)}</Fact>
          <Fact label="Avg hold" testId="hold" title="Average time from entry to out.">{cut.avgHold == null ? '—' : heldWords(cut.avgHold)}</Fact>
        </>
      }
      controls={
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="SPY QQQ NVDA" aria-label="Find a name in the book" className="w-44 max-sm:w-full slayer-field" data-span data-blotter-search />
          <ExpiryCalendar value={iso ?? ''} expiries={BOOK_DAYS} onChange={e => setOpenDay(isoDate(e.date))} onClear={() => setOpenDay(null)} anyLabel="Every day" clearLabel="Every day" steppers={iso != null} floor={BOOK_FROM} label="Day" icon={CalendarDays} title="Every day, or one day of the book" testId="blotter-day" />
          <DropdownSelect
            label="Side"
            value={side}
            options={[{ value: 'all', label: 'Calls and puts' }, { value: 'call', label: 'Calls', tone: 'bull' }, { value: 'put', label: 'Puts', tone: 'bear' }]}
            onChange={setSide}
            title="Which trades the book shows"
            testId="blotter-side"
          />
        </>
      }
      sentence={false}
    >
      {rows.length === 0 ? (
        <div className="border-t border-borderSubtle px-5 py-10 font-mono text-[11px] text-textMuted">{q.trim() ? `No trade matches “${q.trim()}”.` : 'Nothing in the book on this cut.'}</div>
      ) : (
        <TraceGrid
          rows={rows}
          columns={COLUMNS}
          widths={WIDTHS}
          tooltips={TOOLTIPS}
          lockColumns
          rowKey={r => r.id}
          autoHeight
          initialSort={{ key: 'in', dir: 'desc' }}
          animate={false}
          testId="blotter-book"
          emptyText=""
          phoneRow={r => (
            <PhoneRow
              title={<ContractLabel contract={r.label} right={r.right} logo={r.ticker} size="sm" />}
              aside={<span className={r.result === 'caution' ? 'text-warn' : dirInk(r.ret)}>{r.result === 'caution' ? 'Caution' : pctWords(r.ret, 1)}</span>}
              figures={[
                <span key="i">{dayCell(r.date)} · {r.entry} · {usd(r.ask)}</span>,
                <span key="p">Exit {usd(r.exitPx)} · out {r.exit}</span>,
                <span key="h">{r.held == null ? 'Held —' : heldWords(r.held)}</span>,
              ]}
            />
          )}
        />
      )}
    </TraceBox>
  );
};

export default Blotter;
