/* Where a backtest session starts and is come back to: the cards that make a session (name, cash, day, fee, the
   reader's rules) and every session kept on this machine — opened again where its clock stands, copied as it stands,
   run again from its first day, or deleted. A session replays ThetaData's recorded quotes for the days its history
   reaches. */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import RenameDoor from '../../components/review/RenameDoor';
import TraceBox, { Fact, TraceGrid } from '../../components/trace/TraceBox';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownSearch from '../../components/ui/DropdownSearch';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DayCard from '../../components/review/DayCard';
import type { Column } from '../../components/ui/DataTable';
import { accountOf, namesOf, statsOf, DEFAULT_FEE, type SessionRules } from '../../data/review/engine';
import { createSession, deleteSession, duplicateSession, legsHeld, renameSession, runAgain, useSessions } from '../../data/review/store';
import type { Session } from '../../data/review/engine';
import { CASH_INDEX_ROOTS, dayWords, ensureLeg, ensureWindow, historyOffline, historyRev, lastReplayDay, prevDay, replayWindow, subscribeHistory } from '../../data/review/history';
import { ensureListed, optionSymbols, useListedRev } from '../../data/listedNames';
import ThetaLine from '../../components/review/ThetaLine';
import { companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';
import { dirInk, momentWords, pct, usd, usdSigned } from '../../components/review/words';

const SILVER_FILL = 'rgb(var(--silver-fill))';
/* `short`: the trigger's words — a phone's two-column line of cards has about 170 px a card */
const CASH: DropdownOption<number>[] = [5000, 10000, 25000, 50000, 100000].map(v => ({ value: v, label: usd(v, 0), short: `$${v / 1000}K`, hint: v === 25000 ? 'The size most day-trading rules start at' : undefined }));
const FEES: DropdownOption<number>[] = [
  { value: DEFAULT_FEE, label: '$0.65 a contract', short: '$0.65', hint: 'What most brokers charge, each way' },
  { value: 0, label: 'No fee', short: 'None', hint: 'A broker that charges nothing for contracts' },
  { value: 1, label: '$1.00 a contract', short: '$1.00', hint: 'A dearer broker, or exchange fees on top' },
];
/* Index roots: only those settled in cash on the index's CLOSE (SPXW, NDXP, RUTW — replayed on the index's own price).
   The AM-settled roots (SPX, NDX, RUT monthlies, VIX) settle on an opening quotation the vendor does not carry. */
const INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'VIXW', 'XSP', 'DJX', 'OEX', 'XEO']);
const FUNDS = ['SPY', 'QQQ', 'IWM', ...Object.keys(CASH_INDEX_ROOTS)];
/* The reader's own rules — 0 is "no rule". Hard blocks on a way in, never on a way out (data/review/engine). */
const OPEN_RULES: DropdownOption<number>[] = [
  { value: 0, label: 'No limit', short: 'Any', quiet: true, hint: 'As many positions as the cash pays for' },
  ...[1, 2, 3, 5].map(v => ({ value: v, label: v === 1 ? '1 position' : `${v} positions`, short: String(v), hint: v === 1 ? 'One trade at a time, across both names' : `A buy that would open a ${v === 2 ? 'third' : v === 3 ? 'fourth' : 'sixth'} is refused` })),
];
const RISK_RULES: DropdownOption<number>[] = [
  { value: 0, label: 'No limit', short: 'Any', quiet: true, hint: 'A trade may cost whatever the cash pays for' },
  ...[0.01, 0.02, 0.05, 0.1].map(v => ({ value: v, label: `${v * 100}% of the account`, short: `${v * 100}%`, hint: 'The premium and the fees of one trade — for a bought option, that is its risk' })),
];
const DAY_RULES: DropdownOption<number>[] = [
  { value: 0, label: 'No stop', short: 'None', quiet: true, hint: 'A bad day can go on' },
  ...[0.02, 0.03, 0.05, 0.1].map(v => ({ value: v, label: `Down ${v * 100}%`, short: `−${v * 100}%`, hint: 'Measured from what the account was worth at the open — no new positions until the next one' })),
];

interface Row {
  s: Session;
  equity: number;
  /** Up or down since the start, open contracts marked — NaN until their quotes are here */
  net: number;
  /** Banked: closed trades and the pieces sold of open ones — always known */
  banked: number;
  trades: number;
  winRate: number;
  open: number;
}

const Sessions = () => {
  const navigate = useNavigate();
  const sessions = useSessions();
  /** A delete asks once more: the session whose bin was pressed, for a few seconds */
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const hrev = useSyncExternalStore(subscribeHistory, historyRev, historyRev);
  const [ticker, setTicker] = useState('SPY');
  const [second, setSecond] = useState('');
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  useEffect(() => {
    ensureListed();
    void ensureWindow();
  }, []);
  /* the open contracts of each session, at its clock's day — what "Worth now" is marked at (kept in this browser once read) */
  const heldKey = sessions.map(s => `${s.id}@${s.cursor.day}:${s.fills.length}`).join('|');
  useEffect(() => {
    for (const s of sessions.slice(0, 30)) for (const l of legsHeld(s)) if (l.expiry >= s.cursor.day) void ensureLeg(l, s.cursor.day);
  }, [heldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOptions = useMemo(() => {
    const roots = [...new Set([...FUNDS, ...optionSymbols()])].filter(t => !INDEX_ROOTS.has(t));
    const company = (t: string) => {
      const named = companyName(t);
      return named.toUpperCase() !== t ? named : undefined;
    };
    return roots.map(t => {
      const hint = company(t);
      return {
        value: t,
        label: t,
        hint: hint && hint !== t ? hint : undefined,
        logo: t,
        keywords: hint ?? '',
      };
    });
  }, [listedRev, nameRev]);
  /** The "second name" card has been asked for (it may still be empty) */
  const [adding, setAdding] = useState(false);
  const [maxOpen, setMaxOpen] = useState(0);
  const [maxRisk, setMaxRisk] = useState(0);
  const [dayStop, setDayStop] = useState(0);
  const [cash, setCash] = useState(25000);
  const [fee, setFee] = useState(DEFAULT_FEE);
  /* a month back: room to run forward, and the newest finished session is the clock's last */
  const win = replayWindow();
  const [picked, setStartDay] = useState(() => {
    let d = lastReplayDay();
    for (let i = 0; i < 20; i++) d = prevDay(d);
    return d;
  });
  const startDay = win.first && picked < win.first ? win.first : picked > win.last ? win.last : picked;

  const rows = useMemo<Row[]>(
    () =>
      sessions.map(s => {
        const a = accountOf(s);
        const st = statsOf(a.trades);
        return { s, equity: a.equity, net: a.equity - s.startCash, banked: a.realized, trades: st.n, winRate: st.winRate, open: a.positions.length };
      }),
    [sessions, hrev] // eslint-disable-line react-hooks/exhaustive-deps
  );
  /* every session's move where its open contracts are marked, its banked figure where they are not yet */
  const totals = useMemo(() => ({ trades: rows.reduce((a, r) => a + r.trades, 0), net: rows.reduce((a, r) => a + (Number.isFinite(r.net) ? r.net : r.banked), 0), unmarked: rows.some(r => !Number.isFinite(r.net)) }), [rows]);

  const tickers = second && second !== ticker ? [ticker, second] : [ticker];
  const rules: SessionRules = { maxOpen: maxOpen || undefined, maxRiskPct: maxRisk || undefined, dailyLossPct: dayStop || undefined };
  const ruleWords = [maxOpen ? `no more than ${maxOpen} ${maxOpen === 1 ? 'position' : 'positions'} open at once` : '', maxRisk ? `no trade over ${maxRisk * 100}% of the account` : '', dayStop ? `day stop −${+(dayStop * 100).toFixed(1)}% of the account at 09:30 (−${usd(cash * dayStop, 0)} on the first day, measured afresh at each open)` : ''].filter(Boolean);
  const start = () => {
    const s = createSession({ name: `${tickers.join(' + ')} from ${dayWords(startDay)}`, ticker, tickers, rules, startCash: cash, fee, startDay });
    navigate(`/practice/backtest/${s.id}`);
  };

  const doors = (r: Row) => (
    /* `leading-normal` + `align-middle`: a grid cell's line is as tall as its row, and a button inherits it
       — its word dropped to the button's floor and the pair rode high on the row */
    <span className="inline-flex items-center gap-1.5 leading-normal align-middle">
      <button type="button" onClick={e => { e.stopPropagation(); navigate(`/practice/backtest/${r.s.id}/report`); }} className="tap-40 inline-flex items-center h-6 px-2 rounded-md border border-borderSubtle font-mono text-t10 text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-session-report={r.s.id}>
        Report
      </button>
      <RenameDoor name={r.s.name} onSave={name => renameSession(r.s.id, name)} />
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                const copy = duplicateSession(r.s.id);
                if (copy) navigate(`/practice/backtest/${copy.id}`);
              }}
              title="Copy it as it stands — the same book, orders and clock — to try another way from here; this one is kept"
              aria-label={`Copy ${r.s.name}`}
              className="tap-40 inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
              data-session-copy={r.s.id}
            >
              <Copy className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                const again = runAgain(r.s.id);
                if (again) navigate(`/practice/backtest/${again.id}`);
              }}
              title="Run it again — a new session on the same names, money, start day and rules, with a fresh book"
              aria-label={`Run ${r.s.name} again`}
              className="tap-40 inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
              data-session-again={r.s.id}
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            {armed === r.s.id ? (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setArmed(null);
                  deleteSession(r.s.id);
                }}
                title="Press again to delete it, its trades and its journal notes — this cannot be undone"
                className="tap-40 inline-flex items-center h-6 px-2 rounded-md border border-bear/50 font-mono text-t10 font-semibold text-bear hover:bg-bear/[0.10] transition-colors"
                data-session-delete-confirm={r.s.id}
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setArmed(r.s.id);
                }}
                title="Delete this session and its trades"
                aria-label={`Delete ${r.s.name}`}
                className="tap-40 inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-bear hover:bg-ink/[0.06] transition-colors"
                data-session-delete={r.s.id}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
    </span>
  );
  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'name',
        header: 'Session',
        sortValue: r => r.s.name,
        render: r => (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 shrink-0">
              {namesOf(r.s).map(t => (
                <CompanyLogo key={t} ticker={t} size={15} />
              ))}
            </span>
            <span className="font-semibold text-textPrimary truncate">{r.s.name}</span>
          </span>
        ),
      },
      { key: 'clock', header: 'Clock', sortValue: r => r.s.cursor.day, render: r => <span className="text-textSecondary">{momentWords(r.s.cursor)}</span> },
      { key: 'start', header: 'Start', align: 'right', sortValue: r => r.s.startCash, render: r => <span className="text-textSecondary">{usd(r.s.startCash, 0)}</span> },
      { key: 'equity', header: 'Worth now', align: 'right', sortValue: r => r.equity, render: r => (Number.isFinite(r.equity) ? <span className="text-textPrimary">{usd(r.equity)}</span> : <span className="text-textMuted" title="Its open contracts are marked once the desk loads their day">—</span>) },
      { key: 'net', header: 'P&L', align: 'right', sortValue: r => (Number.isFinite(r.net) ? r.net : r.banked), render: r => (Number.isFinite(r.net) ? <span className={`font-semibold ${dirInk(r.net)}`}>{usdSigned(r.net)}</span> : <span className={dirInk(r.banked)} title="Banked so far — its open contracts are marked once their quotes load">{usdSigned(r.banked)} <span className="text-textMuted text-t10">banked</span></span>) },
      { key: 'trades', header: 'Trades', align: 'right', sortValue: r => r.trades, render: r => <span className="text-textPrimary">{r.trades}</span> },
      { key: 'win', header: 'Won', align: 'right', sortValue: r => r.winRate, render: r => (r.trades ? <span className="text-textPrimary">{pct(r.winRate)}</span> : <span className="text-textMuted">—</span>) },
      { key: 'open', header: 'Open', align: 'right', sortValue: r => r.open, render: r => (r.open ? <span className="text-textPrimary">{r.open}</span> : <span className="text-textMuted">—</span>) },
      { key: 'doors', header: '', align: 'right', render: doors },
    ],
    [navigate, armed] // eslint-disable-line react-hooks/exhaustive-deps
  );
  /* a phone reads a session in two lines: its name and its move, then its clock and its doors */
  const phoneRow = (r: Row) => (
    <div className="flex flex-col gap-1 py-1.5 leading-snug min-w-0" data-session-phone={r.s.id}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex items-center gap-1 shrink-0">
          {namesOf(r.s).map(t => (
            <CompanyLogo key={t} ticker={t} size={15} />
          ))}
        </span>
        <span className="font-semibold text-textPrimary truncate">{r.s.name}</span>
        <span className={`ml-auto shrink-0 font-mono tnum font-semibold ${Number.isFinite(r.net) ? dirInk(r.net) : dirInk(r.banked)}`}>{usdSigned(Number.isFinite(r.net) ? r.net : r.banked)}</span>
      </div>
      <div className="flex items-center gap-2 min-w-0 font-mono text-t10 tnum text-textSecondary">
        <span className="truncate">{momentWords(r.s.cursor)} · {r.trades} {r.trades === 1 ? 'trade' : 'trades'}{r.trades ? ` · ${pct(r.winRate)} won` : ''}{r.open ? ` · ${r.open} open` : ''}</span>
        <span className="ml-auto shrink-0">{doors(r)}</span>
      </div>
    </div>
  );

  const nameWords = (t: string) => {
    const n = companyName(t);
    return n.toUpperCase() === t ? t : `${t} (${n})`;
  };
  const offline = historyOffline();
  return (
    <TraceBox
      title="Your sessions"
      sub="A session replays one name, or two, from a day you pick, on ThetaData’s recorded quotes · the clock only moves forward · every fill is kept"
      testId="review-sessions"
      data={{ sessions: sessions.length }}
      facts={
        <>
          <Fact label="Sessions">{sessions.length}</Fact>
          <Fact label="Closed trades">{totals.trades}</Fact>
          <Fact label="All sessions, up or down" title={totals.unmarked ? 'A session whose open contracts are not marked yet counts what it has banked' : 'Every session’s move since its start, open contracts marked'}>
            <span className={dirInk(totals.net)}>{usdSigned(totals.net)}</span>
          </Fact>
        </>
      }
      controls={
        <>
          <DropdownSearch label="Name" value={ticker} options={nameOptions} onChange={setTicker} title="The name this session trades — a fund or a stock with listed options" placeholder="Search a ticker or a company…" testId="review-name" />
          {adding || second ? (
            <span className="inline-flex items-center gap-0.5">
              <DropdownSearch label="And" value={second === ticker ? '' : second} options={nameOptions.filter(o => o.value !== ticker)} onChange={setSecond} title="A second one on the same clock and the same account — two at most" placeholder="Search a ticker or a company…" testId="review-name-2" defaultOpen={!second} />
              <button
                type="button"
                onClick={() => {
                  setSecond('');
                  setAdding(false);
                }}
                title="One name after all"
                aria-label="Take the second name away"
                className="inline-flex items-center justify-center w-6 h-7 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
                data-review-name-2-off
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setAdding(true)} title="Optional — trade two names on the same clock and the same account" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-dashed border-borderMuted font-mono text-t10 text-textMuted hover:text-textPrimary hover:border-textSecondary transition-colors" data-review-name-2-add>
              <Plus className="w-3 h-3" /> A second name
            </button>
          )}
          <DropdownSelect label="Start with" value={cash} options={CASH} onChange={setCash} title="The pretend money the session starts with" testId="review-cash" />
          <DayCard label="From" value={startDay} onChange={setStartDay} title="The day the clock starts on" testId="review-start" />
          <DropdownSelect label="Fee" value={fee} options={FEES} onChange={setFee} title="What each contract costs to trade, each way" testId="review-fee" />
          {/* YOUR RULES — hard blocks, chosen here and nowhere else */}
          <DropdownSelect label="Max open" value={maxOpen} options={OPEN_RULES} onChange={setMaxOpen} title="Your rule: how many positions may be open at once — a buy past it is refused" testId="review-rule-open" />
          <DropdownSelect label="Max a trade" value={maxRisk} options={RISK_RULES} onChange={setMaxRisk} title="Your rule: the most one trade may cost, premium and fees, as a share of what the account is worth" testId="review-rule-risk" />
          <DropdownSelect label="Day stop" value={dayStop} options={DAY_RULES} onChange={setDayStop} title="Your rule: down this much since the open, the day is over — no new positions until the next one" testId="review-rule-day" />
          <button type="button" onClick={start} className="inline-flex items-center gap-1.5 h-7 px-3.5 rounded-full text-t11 font-semibold transition-opacity hover:opacity-90" style={{ background: SILVER_FILL, color: '#0a0a0a' }} data-review-start>
            <Play className="w-3 h-3" /> Start the session
          </button>
        </>
      }
      sentence={
        <>
          A new session opens <span className="text-textPrimary font-semibold">{tickers.map(nameWords).join(' and ')}</span>
          {tickers.length > 1 ? ' on one clock and one account,' : ''} at 09:30 ET on <span className="text-textPrimary font-semibold">{dayWords(startDay, true)}</span> with <span className="text-textPrimary font-semibold">{usd(cash, 0)}</span>. Fills are at ThetaData’s recorded NBBO at the end of each minute — buys at the ask, sells at the bid — and never in a minute with no two-sided quote.{' '}
          {ruleWords.length > 0 ? (
            <>
              Your rules: <span className="text-textPrimary font-semibold">{ruleWords.join(' · ')}</span>. A buy that breaks one is refused, a way out never is — and they cannot be changed once the session starts.
            </>
          ) : (
            'No rules of your own on this one — Max open, Max a trade and Day stop are set before it starts, and cannot be added later.'
          )}
        </>
      }
    >
      <ThetaLine since={offline} className="px-5 pb-2" what="ThetaData offline — reconnecting · a session opens on the recorded quotes once it answers" />
      <TraceGrid rows={rows} columns={columns} rowKey={r => r.s.id} onRowClick={r => navigate(`/practice/backtest/${r.s.id}`)} autoHeight animate={false} widths={{ doors: 200, clock: 150, start: 90, equity: 120, net: 130, trades: 80, win: 70, open: 70 }} flexes={{ name: 2 }} phoneRow={phoneRow} emptyText="No sessions yet — start one above" testId="review-sessions" />
    </TraceBox>
  );
};

export default Sessions;
