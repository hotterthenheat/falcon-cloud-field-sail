/*
==================================================
  SLAYER TERMINAL - PULSE · PRACTICE AND YOURS
  (pages/workspace/tiles/you.tsx)

  The reader's own things, on the desk:

    Paper account   what is open on a paper account,
                    the trades it closed lately, and
                    what it is worth — the door is
                    the paper desk
    Journal         the running total of the trades
                    closed in a period, on the paper
                    book or the backtest's — the door
                    is the journal on that book

  NEITHER STANDS EMPTY WHILE THERE IS SOMETHING TO
  SHOW (Noah, 2026-10-02: "take a look at the
  papertrading cards / journal cards we have … always
  empty"). The paper tile was only its OPEN positions,
  so an account that was flat was a blank box: it now
  lists the trades the account closed lately under
  whatever is open. The journal opened on "This
  month", so in a month's first days it had nothing:
  it opens on every trade now, and a period with no
  trade in it shows the last ones closed, said as
  such. Empty is said only where there is nothing at
  all — no account, or a book with no trade in it.

  (Alerts and the Tracker were tiles here until the
  same day: "the alerts and tracker have no reason to
  be one of the widgets". The bell on the rail and
  the Tracker's own page are where they live.)
    Session clock   New York's time, the session as a
                    strip of its phases with now on
                    it, and what the phase means for
                    this name — the one tile with no
                    door: it is not a copy of a page
==================================================
*/

import { useMemo } from 'react';
import SessionsChart, { type ChartPoint } from '../../../components/record/SessionsChart';
import Fact from '../../../components/ui/Fact';
import { PHASES, type ClockFacts } from '../../../components/gex/TraderClock';
import { usdSigned, usd, dirInk } from '../../../components/review/words';
import { aheadClock, CLOSE_MIN, OPEN_MIN } from '../../../data/ahead';
import { readSessionClock } from '../../../data/moc';
import { viewOf } from '../../../data/paper/engine';
import { liveMarket, readPaper, usePaper } from '../../../data/paper/store';
import { statsOf } from '../../../data/review/engine';
import { instantOf, titleOf, type JournalRow } from '../../../data/review/journal';
import { PERIODS, isPeriod, rowsIn, runningOf, spanOf, type Period } from '../../../data/review/journalFigures';
import { useJournalSource, type JournalKind } from '../../../data/review/journalSource';
import { contractWords } from '../../../data/review/quotes';
import type { TileControl, TileProps, TileState } from '../tile';
import { TileEmpty, TileHeads, TileRead, TileRow, TileRows } from './parts';

/* ------------------------------------------------------------------ paper account */

export const paperControls = (): TileControl[] => {
  const { accounts } = readPaper();
  if (accounts.length < 2) return [];
  return [{ id: 'account', label: 'Account', title: 'Which paper account', options: [{ value: '', label: 'The one on the desk', hint: 'Whichever account the paper desk has in hand' }, ...accounts.map(a => ({ value: a.id, label: a.name, hint: a.kind === 'evaluation' ? 'An evaluation' : 'Practice' }))] }];
};

/** when a trade closed, as a list says it: the clock for today's, the date for an older one */
const closedWhen = (r: JournalRow, today: string): string => {
  const d = new Date(instantOf(r, r.t.closed) * 1000);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return day === today ? d.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
};

export const PaperTile = ({ ctx, state, size, open }: TileProps) => {
  const { accounts, inHand } = usePaper();
  const account = accounts.find(a => a.id === state.account) ?? accounts.find(a => a.id === inHand) ?? null;
  // priced on the desk's tick
  const v = useMemo(() => (account ? viewOf(account, liveMarket()) : null), [account, ctx.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  /* what this account closed, newest first — the paper journal's own rows */
  const book = useJournalSource('paper');
  const closed = useMemo(() => (account ? book.rows.filter(r => r.s.id === account.id).slice(0, 30) : []), [book.rows, account]);
  if (!account || !v) return <TileEmpty words="No paper account yet. Start one on the paper desk: pretend money at today’s prices." door="Open the paper desk" onDoor={open} />;
  const wide = size.room !== 'small';
  const cols = wide ? 'minmax(0,1fr) 44px 70px 84px' : 'minmax(0,1fr) 40px 80px';
  const n = v.opt.length + v.fut.length;
  /* THE ACCOUNT, IN FOUR FIGURES — the house's dot-leader rows, at the head of the tile: what it is worth, what is free to
     trade with, the day, and the whole run. They are there whether or not anything is open, so the tile always says
     where the account stands. */
  const facts = (
    <div className={`shrink-0 grid gap-x-6 gap-y-1.5 px-3 py-2.5 border-b border-ink/[0.06] ${wide ? 'grid-cols-2' : 'grid-cols-1'}`} data-paper-facts>
      <Fact label="Worth" value={usd(v.equity, 0)} />
      <Fact label="Free to trade" value={usd(v.free, 0)} />
      <Fact label="Today" value={usdSigned(v.today, 0)} valueCls={dirInk(v.today)} />
      <Fact label="Since it began" value={usdSigned(v.allTime, 0)} valueCls={dirInk(v.allTime)} />
    </div>
  );
  const won = closed.filter(r => r.t.pnl > 0).length;
  const read = (
    <TileRead testId="paper">
      {account.name}: {n === 0 ? 'nothing open' : `${n} open`}
      {n > 0 && (
        <>
          , <span className={`font-mono tnum ${dirInk(v.openPnl)}`}>{usdSigned(v.openPnl, 0)}</span> on {n === 1 ? 'it' : 'them'}
        </>
      )}
      {closed.length === 1 ? `; its one closed trade ${won ? 'won' : 'lost'}` : closed.length > 1 ? `; ${won} of its last ${closed.length} closed trades won` : ''}. {account.status !== 'open' && `This account has ${account.status}.`}
    </TileRead>
  );
  /* an account that has never traded: there is nothing to list, and the tile says so */
  if (n === 0 && closed.length === 0)
    return (
      <div className="h-full min-h-0 flex flex-col" data-paper-tile={account.id}>
        {facts}
        <div className="flex-1 min-h-0">
          <TileEmpty words={`No trade on ${account.name} yet.`} door="Open the paper desk" onDoor={open} />
        </div>
      </div>
    );
  const closedCols = wide ? 'minmax(0,1fr) 64px 84px' : 'minmax(0,1fr) 56px 76px';
  return (
    <div className="h-full min-h-0 flex flex-col" data-paper-tile={account.id} data-paper-open={n} data-paper-closed={closed.length}>
      {facts}
      <TileRows>
        {n > 0 && (
          <>
            <TileHeads columns={cols}>
              <span>Open</span>
              <span className="text-right">Qty</span>
              {wide && <span className="text-right">Paid</span>}
              <span className="text-right">Open P&amp;L</span>
            </TileHeads>
            {v.opt.map(p => (
              <TileRow key={p.key} columns={cols} testId={p.key} onClick={open} title="Open the paper desk">
                <span className="min-w-0 truncate font-bold text-textPrimary">{contractWords(p.contract)}</span>
                <span className="text-right text-textSecondary">{p.qty}</span>
                {wide && <span className="text-right text-textSecondary">${p.avg.toFixed(2)}</span>}
                <span className={`text-right font-semibold ${dirInk(p.pnl)}`}>{usdSigned(p.pnl, 0)}</span>
              </TileRow>
            ))}
            {v.fut.map(p => (
              <TileRow key={p.key} columns={cols} testId={p.key} onClick={open} title="Open the paper desk">
                <span className="min-w-0 truncate font-bold text-textPrimary">
                  {p.contract} <span className={`text-[9px] uppercase tracking-widest ${p.long ? 'text-bull' : 'text-bear'}`}>{p.long ? 'long' : 'short'}</span>
                </span>
                <span className="text-right text-textSecondary">{p.qty}</span>
                {wide && <span className="text-right text-textSecondary">{p.avg.toFixed(2)}</span>}
                <span className={`text-right font-semibold ${dirInk(p.pnl)}`}>{usdSigned(p.pnl, 0)}</span>
              </TileRow>
            ))}
          </>
        )}
        {closed.length > 0 && (
          <>
            <TileHeads columns={closedCols}>
              <span>{n > 0 ? 'Closed lately' : 'Nothing open · closed lately'}</span>
              <span className="text-right">When</span>
              <span className="text-right">Made</span>
            </TileHeads>
            {closed.map(r => (
              <TileRow key={`${r.s.id}:${r.t.id}`} columns={closedCols} testId={`closed-${r.t.id}`} onClick={open} title="Open the paper desk">
                <span className="min-w-0 truncate font-bold text-textPrimary">{titleOf(r)}</span>
                <span className="text-right text-textMuted">{closedWhen(r, book.today)}</span>
                <span className={`text-right font-semibold ${dirInk(r.t.pnl)}`}>{usdSigned(r.t.pnl, 0)}</span>
              </TileRow>
            ))}
          </>
        )}
      </TileRows>
      {read}
    </div>
  );
};

/* ------------------------------------------------------------------ journal */

export const journalKind = (state: TileState): JournalKind => (state.book === 'backtest' ? 'backtest' : 'paper');
const periodOf = (state: TileState): Period => (isPeriod(state.period) ? state.period : 'all');
export const journalControls = (): TileControl[] => [
  {
    id: 'book',
    label: 'Book',
    title: 'Whose trades',
    options: [
      { value: 'paper', label: 'Paper Trade', hint: 'The trades closed on your paper accounts' },
      { value: 'backtest', label: 'Backtest', hint: 'The trades closed in your backtests' },
    ],
  },
  { id: 'period', label: 'Over', title: 'Which trades', options: PERIODS.map(p => ({ value: p.value, label: p.label })) },
];

const PERIOD_WORDS: Record<Period, string> = { today: 'today', week: 'this week', month: 'this month', year: 'this year', all: 'in all' };

export const JournalTile = ({ state, open }: TileProps) => {
  const kind = journalKind(state);
  const period = periodOf(state);
  const source = useJournalSource(kind);
  const rows = useMemo(() => rowsIn(source.rows, spanOf(period, source.today)), [source.rows, period, source.today]);
  const run = useMemo(() => runningOf(rows), [rows]);
  const runBy = useMemo(() => new Map(run.map(p => [p.time, p])), [run]);
  /* ONE list, kept — a fresh array drops the card under the pointer */
  const points = useMemo<ChartPoint[]>(() => run.map(p => ({ time: p.time, value: p.value })), [run]);
  const range = useMemo(() => [Math.min(0, ...run.map(p => p.value)), Math.max(0, ...run.map(p => p.value))] as const, [run]);
  const stats = useMemo(() => statsOf(rows.map(r => r.t)), [rows]);
  const oneDay = useMemo(() => new Set(run.map(p => new Date(p.time * 1000).toDateString())).size <= 1, [run]);
  const bookWords = kind === 'paper' ? 'paper book' : 'backtest’s book';
  /* a book with no trade in it at all: that is the one empty the tile has */
  if (source.rows.length === 0) return <TileEmpty words={`No trade closed on the ${bookWords} yet.`} door="Open the journal" onDoor={open} />;
  /* A PERIOD WITH NO TRADE IN IT is not a blank box: the last trades the book closed stand in it, and the read says which period came up empty */
  if (rows.length === 0) {
    const cols = 'minmax(0,1fr) 64px 84px';
    return (
      <div className="h-full min-h-0 flex flex-col" data-journal-tile={kind} data-journal-last={source.rows.length}>
        <TileRows>
          <TileHeads columns={cols}>
            <span>The last trades closed</span>
            <span className="text-right">When</span>
            <span className="text-right">Made</span>
          </TileHeads>
          {source.rows.slice(0, 30).map(r => (
            <TileRow key={`${r.s.id}:${r.t.id}`} columns={cols} testId={`last-${r.t.id}`} onClick={open} title="Open the journal">
              <span className="min-w-0 truncate font-bold text-textPrimary">{titleOf(r)}</span>
              <span className="text-right text-textMuted">{closedWhen(r, source.today)}</span>
              <span className={`text-right font-semibold ${dirInk(r.t.pnl)}`}>{usdSigned(r.t.pnl, 0)}</span>
            </TileRow>
          ))}
        </TileRows>
        <TileRead testId="journal">
          No trade closed {PERIOD_WORDS[period]} on the {bookWords}. These are the last ones it closed.
        </TileRead>
      </div>
    );
  }
  return (
    <div className="h-full min-h-0 flex flex-col" data-journal-tile={kind}>
      <div className="flex-1 min-h-0 px-1 pt-1 flex flex-col">
        <SessionsChart
          points={points}
          kind="baseline"
          ink="rgb(var(--bull))"
          inkBelow="rgb(var(--bear))"
          fill
          clock={oneDay ? 'clock' : 'span'}
          range={range}
          zone="ny"
          scale="pnl"
          curved
          cardW={210}
          cardH={64}
          testId="pulse-journal"
          onPick={open}
          card={h => {
            const p = runBy.get(h.time);
            if (!p) return null;
            if (!p.row) return <div className="font-mono text-[11px] text-textSecondary">Before the first close</div>;
            return (
              <div className="flex flex-col gap-1 font-mono text-[11px] tnum">
                <span className="font-bold text-textPrimary">{titleOf(p.row)}</span>
                <span className="flex items-center justify-between gap-4">
                  <span className="text-textMuted">this trade</span>
                  <span className={dirInk(p.row.t.pnl)}>{usdSigned(p.row.t.pnl, 0)}</span>
                </span>
                <span className="flex items-center justify-between gap-4">
                  <span className="text-textMuted">the total</span>
                  <span className={dirInk(p.value)}>{usdSigned(p.value, 0)}</span>
                </span>
              </div>
            );
          }}
        />
      </div>
      <TileRead testId="journal">
        {stats.n} {stats.n === 1 ? 'trade' : 'trades'} closed {PERIOD_WORDS[period]}, {stats.wins} won: <span className={`font-mono tnum ${dirInk(stats.net)}`}>{usdSigned(stats.net, 0)}</span>.{' '}
        {stats.n > 1 && (
          <>
            The best made <span className="font-mono tnum text-textPrimary">{usdSigned(stats.best, 0)}</span>, the worst <span className="font-mono tnum text-textPrimary">{usdSigned(stats.worst, 0)}</span>.
          </>
        )}
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ the session clock */

const SPAN = CLOSE_MIN - OPEN_MIN;
const two = (n: number) => String(n).padStart(2, '0');
const leftWords = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${two(min % 60)}m` : `${min}m`);

export const ClockTile = ({ ctx, size }: TileProps) => {
  /* read on the desk's one-second tick (ctx is a new object each second) */
  const raw = readSessionClock();
  const clock = aheadClock(raw);
  const now = clock.inSession && clock.nowMin != null ? clock.nowMin : null;
  const phase = now != null ? PHASES.find(p => now >= p.from && now < p.to) ?? PHASES[PHASES.length - 1] : null;
  const next = now != null ? PHASES.find(p => p.from > now) ?? null : null;
  const { pin, supreme, flip } = ctx.exposure.levels;
  const facts: ClockFacts = { pin, supreme, flip, charmStrike: null, charmMoves: null, bellShare: null };
  const wide = size.room !== 'small';
  return (
    <div className="h-full min-h-0 flex flex-col" data-clock-tile={phase?.key ?? 'shut'}>
      <div className="flex-1 min-h-0 flex flex-col justify-center gap-3 px-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[26px] leading-none font-semibold tnum text-textPrimary" data-clock-time>
            {raw.etTime}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">New York</span>
          <span className="ml-auto font-mono text-[11px] tnum text-textSecondary whitespace-nowrap">{now != null ? `${leftWords(clock.minutesLeft)} to the close` : raw.label}</span>
        </div>
        {/* THE SESSION — its phases end to end, as long as they last; the part behind us washed, now a silver rule */}
        <div>
          <div className="relative flex h-[18px] rounded-[5px] overflow-hidden bg-ink/[0.05]" data-clock-strip>
            {PHASES.map(p => (
              <span key={p.key} className={`relative h-full border-r border-panel last:border-0 ${phase?.key === p.key ? 'bg-silver/[0.28]' : ''}`} style={{ width: `${((p.to - p.from) / SPAN) * 100}%` }} title={`${p.name} · ${two(Math.floor(p.from / 60))}:${two(p.from % 60)}–${two(Math.floor(p.to / 60))}:${two(p.to % 60)}`} data-clock-phase={p.key} />
            ))}
            {now != null && (
              <>
                <span className="absolute inset-y-0 left-0 bg-ink/[0.10] pointer-events-none" style={{ width: `${((now - OPEN_MIN) / SPAN) * 100}%` }} aria-hidden />
                <span className="absolute inset-y-0 w-[2px] bg-silver pointer-events-none" style={{ left: `calc(${((now - OPEN_MIN) / SPAN) * 100}% - 1px)` }} data-clock-now />
              </>
            )}
          </div>
          {/* the hours under it, each where it falls on the strip */}
          <div className="relative mt-1 h-3 font-mono text-[9px] tnum text-textMuted">
            <span className="absolute left-0">09:30</span>
            {(wide ? [11 * 60 + 30, 14 * 60] : [14 * 60]).map(m => (
              <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((m - OPEN_MIN) / SPAN) * 100}%` }}>
                {two(Math.floor(m / 60))}:{two(m % 60)}
              </span>
            ))}
            <span className="absolute right-0">16:00</span>
          </div>
        </div>
      </div>
      <TileRead testId="clock">
        {phase ? (
          <>
            <span className="font-semibold text-textPrimary">{phase.name}:</span> {phase.words(facts)}.{next ? ` ${next.name} in ${leftWords(next.from - now!)}.` : ''}
          </>
        ) : (
          <>
            {raw.label}. When it opens: {PHASES[0].words(facts)}.
          </>
        )}
      </TileRead>
    </div>
  );
};
