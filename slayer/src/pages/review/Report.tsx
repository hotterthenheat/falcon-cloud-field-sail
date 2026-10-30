/*
  What a backtest session's closed trades add up to: the reader's own figures, the running total, and the cuts. Every
  fill was at the recorded NBBO with the session's fee, so the figures are after the spread and the fees.
*/

import { useEffect, useMemo } from 'react';
import { sayPage } from '../../components/layout/PageMeta';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import TraceBox, { Fact, RestFoot, TraceGrid, useRestCap } from '../../components/trace/TraceBox';
import ContractLabel from '../../components/ui/ContractLabel';
import { EmptyBox } from '../../components/ui/states';
import SessionsChart, { type ChartPoint } from '../../components/record/SessionsChart';
import type { Column } from '../../components/ui/DataTable';
import { accountOf, cutsOf, dayStopOf, decayPerDay, feesOf, stampOf, statsOf, type Trade } from '../../data/review/engine';
import { dayRowsOf, reportDaysCsv, reportTradesCsv, type DayRow } from '../../data/review/reportCsv';
import { saveFile } from './JournalPicker';
import { contractWords } from '../../data/review/quotes';
import { useSession } from '../../data/review/store';
import { barTime, dayWords } from '../../data/review/history';
import { dirInk, heldWords, momentWords, pct, rWords, usd, usdSigned } from '../../components/review/words';

const ENDED: Record<Trade['how'], string> = { sold: 'Sold by you', target: 'Target hit', stopped: 'Stopped out', expired: 'Held to the bell', scaled: 'Scaled out' };
const endedWords = (t: Trade) => (t.how !== 'expired' ? ENDED[t.how] : t.settle === 'cash' ? 'Cash-settled' : t.avgOut > 0 ? 'Exercised at the close' : 'Expired worthless');
/** What a trade has been worth, with its 95% range (the mean's ± 1.96 standard errors) — null under two trades */
export function expectancyRange(pnls: number[]): { mean: number; lo: number; hi: number } | null {
  const n = pnls.length;
  if (n < 2) return null;
  const mean = pnls.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(pnls.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  return { mean, lo: mean - half, hi: mean + half };
}

const Report = () => {
  const { id } = useParams();
  const session = useSession(id);
  /* the tab carries the session's name, never its id (layout/PageMeta) */
  useEffect(() => {
    sayPage(session ? `${session.name} · Report` : null);
    return () => sayPage(null);
  }, [session?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const trades = useMemo<Trade[]>(() => (!session ? [] : [...accountOf(session).trades]).sort((a, b) => stampOf(a.closed) - stampOf(b.closed)), [session]);
  const stats = useMemo(() => statsOf(trades), [trades]);
  const range = useMemo(() => expectancyRange(trades.map(t => t.pnl)), [trades]);
  const cuts = useMemo<{ title: string; rows: { label: string; n: number; winRate: number; net: number; avgR: number | null }[] }[]>(() => cutsOf(trades), [trades]);
  /* the running total of what the closed trades made, a point at each close — the real New York minute it closed on */
  const curve = useMemo<ChartPoint[]>(() => {
    if (!session || !trades.length) return [];
    const pts: ChartPoint[] = [{ time: barTime(trades[0].opened.day, Math.max(0, trades[0].opened.minute)), value: 0 }];
    let run = 0;
    for (const t of trades) {
      run += t.pnl;
      const time = barTime(t.closed.day, t.closed.minute + 1);
      /* two closes in one minute are one point */
      if (pts[pts.length - 1].time >= time) pts[pts.length - 1] = { time: pts[pts.length - 1].time, value: run };
      else pts.push({ time, value: run });
    }
    return pts;
  }, [trades, session]);
  const oneDay = useMemo(() => new Set(trades.flatMap(t => [t.opened.day, t.closed.day])).size <= 1, [trades]);
  /* By day: the trades that closed on it, and the account at its bell (the engine keeps one a day it rings) */
  const days = useMemo<DayRow[]>(() => (session ? dayRowsOf(session, trades) : []), [session, trades]);
  /* the account's deepest fall from a high, bell to bell, open contracts marked */
  const bellFall = useMemo(() => {
    if (!session) return null;
    const eq = days.filter(d => d.equity != null).map(d => d.equity as number);
    if (!eq.length) return null;
    let peak = session.startCash;
    let fall = 0;
    for (const v of eq) {
      peak = Math.max(peak, v);
      fall = Math.max(fall, peak - v);
    }
    return { fall, pct: peak > 0 ? fall / peak : 0 };
  }, [days, session]);
  const newest = useMemo(() => [...trades].reverse(), [trades]);
  const cap = useRestCap(newest);

  const columns = useMemo<Column<Trade>[]>(
    () => [
      { key: 'contract', header: 'Contract', sortValue: t => contractWords(t.contract), render: t => <ContractLabel contract={contractWords(t.contract)} right={t.contract.right} logo={t.contract.ticker} size="sm" /> },
      { key: 'qty', header: 'Size', align: 'right', sortValue: t => t.qty, render: t => <span className="text-textPrimary">{t.qty}</span> },
      { key: 'in', header: 'In', sortValue: t => stampOf(t.opened), render: t => <span className="text-textSecondary">{momentWords(t.opened)} · {t.avgIn.toFixed(2)}</span> },
      { key: 'out', header: 'Out', sortValue: t => stampOf(t.closed), render: t => <span className="text-textSecondary">{momentWords(t.closed)} · {t.avgOut.toFixed(2)}</span> },
      { key: 'dte', header: 'Days to expiry, in', align: 'right', sortValue: t => t.dteIn, render: t => <span className="text-textSecondary">{t.dteIn}d</span> },
      { key: 'delta', header: 'Delta, in', align: 'right', sortValue: t => Math.abs(t.deltaIn), render: t => <span className="text-textSecondary">{t.deltaIn.toFixed(2)}</span> },
      { key: 'held', header: 'Held', align: 'right', sortValue: t => t.heldMin, render: t => <span className="text-textSecondary">{heldWords(t.heldMin)}</span> },
      { key: 'decay', header: 'Decay a day', align: 'right', sortValue: t => decayPerDay(t), render: t => <span className="text-textSecondary">{usd(decayPerDay(t))}</span> },
      { key: 'how', header: 'Ended', sortValue: t => t.how, render: t => <span className="text-textSecondary">{endedWords(t)}</span> },
      { key: 'pnl', header: 'Made or lost', align: 'right', sortValue: t => t.pnl, render: t => <span className={`font-semibold ${dirInk(t.pnl)}`}>{usdSigned(t.pnl)} <span className="text-t10 font-normal opacity-80">{rWords(t.r)}</span></span> },
    ],
    []
  );

  if (!session)
    return (
      <div className="border border-borderSubtle rounded-md bg-panel" data-review-report="missing">
        <EmptyBox
          title="No such session"
          reason="Sessions are kept in this browser — that one is not on this machine, or it was deleted."
          action={
            <Link to="/practice/backtest" className="inline-block font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors">
              Your sessions
            </Link>
          }
        />
      </div>
    );
  const fees = feesOf(session);

  /* the rules the session was run under — chosen at its start, hard blocks on a way in (data/review/engine) */
  const r = session.rules;
  const rulesWords = [r?.maxOpen ? `${r.maxOpen} open at once` : '', r?.maxRiskPct ? `${r.maxRiskPct * 100}% of the account a trade` : '', r?.dailyLossPct ? `the day stops at −${+(r.dailyLossPct * 100).toFixed(1)}% of the account at 09:30` : ''].filter(Boolean).join(' · ');
  /* the day stop, plainly: the clock's day's, in dollars — and each day's in the By day table */
  const dayStop = dayStopOf(session);
  const withStop = !!r?.dailyLossPct;
  /* THE FILES: the closed trades and the By day table, in the journal's CSV conventions (data/review/reportCsv.ts) */
  const slug = session.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  const csvWhyNot = !trades.length && !days.length ? 'nothing yet — no trade has closed and no bell has rung' : null;
  const exportCsv = () => {
    saveFile(`slayer-backtest-${slug}-trades.csv`, reportTradesCsv(trades));
    window.setTimeout(() => saveFile(`slayer-backtest-${slug}-days.csv`, reportDaysCsv(days, withStop)), 300);
  };
  const sentence =
    stats.n === 0
      ? 'No trade has closed in this session yet. The report fills in as trades close — a sale, a target, a stop, or the bell.'
      : `${stats.n} closed ${stats.n === 1 ? 'trade' : 'trades'}, ${stats.wins} won. A winner made ${usd(stats.avgWin)} on average and a loser gave back ${usd(Math.abs(stats.avgLoss))}, so a trade taken this way has been worth ${usdSigned(stats.expectancy)} (${rWords(stats.expectancyR)}) each. The deepest the running total fell from a high, open dips included, was ${usd(stats.maxDrawdown)}.${range ? ` On ${stats.n} trades the 95% range for what a trade is worth runs ${usdSigned(range.lo)} to ${usdSigned(range.hi)}${range.lo <= 0 && range.hi >= 0 ? ' — it includes zero, so these trades do not yet show an edge' : ''}.` : ''}`;

  return (
    <TraceBox
      title={`The report · ${session.name}`}
      sub={`From ${dayWords(session.startDay, true)} to where the clock stands, ${momentWords(session.cursor)} · closed trades only — what is still open is on the desk${rulesWords ? ` · run under your rules: ${rulesWords}` : ''}`}
      testId="review-report"
      data={{ trades: stats.n }}
      facts={
        <>
          <Fact label="Made or lost">
            <span className={dirInk(stats.net)}>{usdSigned(stats.net)}</span>
          </Fact>
          <Fact label="Won">{stats.n ? pct(stats.winRate) : '—'}</Fact>
          <Fact label="Wins over losses" title="Every dollar won for each dollar lost — above 1 the wins outweigh the losses">
            {stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}
          </Fact>
          <Fact label="A trade has been worth" title="After the spread and the fees: every fill was at the recorded bid or ask">{stats.n ? `${usdSigned(stats.expectancy)} · ${rWords(stats.expectancyR)}` : '—'}</Fact>
          <Fact label="95% range a trade" title="The mean trade's 95% range: ± 1.96 standard errors. While it includes zero, there is no edge yet.">{range ? `${usdSigned(range.lo, 0)} to ${usdSigned(range.hi, 0)}` : '—'}</Fact>
          <Fact label="Deepest fall" title="The running total of the closed trades, from its high to its low — each trade's own open dip counted">{usd(stats.maxDrawdown)}</Fact>
          <Fact label="Account's deepest fall" title="Bell to bell, the account with its open contracts marked — from its high">{bellFall ? `${usd(bellFall.fall)} · ${(bellFall.pct * 100).toFixed(1)}%` : '—'}</Fact>
          <Fact label="Fees paid" title="Every fill's fee, each way — the figures above are after them">{usd(fees)}</Fact>
          <Fact label="Longest losing run">{stats.losingRun}</Fact>
          <Fact label="Time in a trade">{stats.n ? heldWords(stats.avgHeldMin) : '—'}</Fact>
        </>
      }
      controls={
        <>
          <Link to={`/practice/backtest/${session.id}`} className="tap-40 inline-flex items-center gap-1.5 h-7 px-3 whitespace-nowrap rounded-md border border-borderSubtle bg-chip font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-review-desk-door>
            <ArrowLeft className="w-3 h-3" /> Back to the desk
          </Link>
          <button type="button" onClick={exportCsv} disabled={!!csvWhyNot} aria-disabled={!!csvWhyNot} title={csvWhyNot ?? 'The closed trades and the By day table, as two CSV files a spreadsheet opens'} className="tap-40 ml-auto inline-flex items-center gap-1.5 h-7 px-3 whitespace-nowrap rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors disabled:opacity-60 disabled:cursor-not-allowed" data-report-export={csvWhyNot ? 'off' : 'on'}>
            <Download className="w-3 h-3" /> CSV<span className="max-sm:hidden"> · trades and days</span>
          </button>
        </>
      }
      sentence={sentence}
    >
      {curve.length > 1 && (
        <div className="px-5 pb-4 border-t border-borderSubtle/70 pt-3" data-report-curve>
          <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">The running total · ET</div>
          <p className="mt-0.5 mb-2 text-t11 text-textMuted">What the closed trades had made or lost, after fees, at each minute one closed</p>
          <SessionsChart
            points={curve}
            kind="baseline"
            ink="rgb(var(--bull))"
            inkBelow="rgb(var(--bear))"
            height={200}
            clock={oneDay ? 'clock' : 'span'}
            zone="ny"
            scale="pnl"
            testId="review-curve"
            card={h => (
              <div className="font-mono text-t11 tnum">
                <div className="text-textMuted text-t10">The running total</div>
                <div className={`mt-0.5 text-t13 font-semibold ${dirInk(h.point?.value ?? 0)}`}>{usdSigned(h.point?.value ?? 0)}</div>
                {h.prev && <div className="mt-0.5 text-textSecondary">{usdSigned((h.point?.value ?? 0) - h.prev.value)} on that close</div>}
              </div>
            )}
          />
        </div>
      )}

      {days.length > 0 && (
        <div className="px-5 pb-4 pt-3 border-t border-borderSubtle/70 min-w-0" data-report-days>
          <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">By day</div>
          {withStop && (
            <p className="mt-0.5 text-t11 text-textSecondary" data-report-day-stop>
              {dayStop ? dayStop.words : `Day stop: −${+((r?.dailyLossPct ?? 0) * 100).toFixed(1)}% of the account at 09:30`}
              <span className="text-textMuted"> · on {dayWords(session.cursor.day)}, the clock’s day — measured afresh at each open, from the account as it stood then</span>
            </p>
          )}
          <div className="mt-1.5 overflow-x-auto">
            <div className={`grid ${withStop ? 'grid-cols-[minmax(84px,1fr)_auto_auto_auto_auto_auto] max-w-[820px]' : 'grid-cols-[minmax(84px,1fr)_auto_auto_auto_auto] max-w-[720px]'} gap-x-4 font-mono text-t11 tnum min-w-[340px]`}>
              <span className="text-t9 uppercase tracking-widest text-textMuted pb-1">Day</span>
              <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1">Closed</span>
              <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1" title="What the trades that closed that day made or lost">Their P&amp;L</span>
              <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1" title="The account's move from the bell before, open contracts marked at the bell">Account</span>
              <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1" title="What the account was worth at 16:00 ET">At the bell</span>
              {withStop && (
                <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1" title="Your day stop that day in dollars: the account as it stood at 09:30, times your rule">
                  Day stop
                </span>
              )}
              {days.map(d => (
                <div key={d.day} className="contents" data-report-day={d.day}>
                  <span className="py-1 border-t border-borderSubtle/70 text-textPrimary">{dayWords(d.day)}</span>
                  <span className="py-1 border-t border-borderSubtle/70 text-right text-textSecondary">{d.n || '—'}</span>
                  <span className={`py-1 border-t border-borderSubtle/70 text-right ${d.n ? `font-semibold ${dirInk(d.net)}` : 'text-textMuted'}`}>{d.n ? usdSigned(d.net) : '—'}</span>
                  <span className={`py-1 border-t border-borderSubtle/70 text-right ${d.move != null ? dirInk(d.move) : 'text-textMuted'}`}>{d.move != null ? usdSigned(d.move) : '—'}</span>
                  <span className="py-1 border-t border-borderSubtle/70 text-right text-textSecondary" title={d.held ? `${d.held} ${d.held === 1 ? 'position' : 'positions'} carried over the night` : undefined}>
                    {d.equity != null ? usd(d.equity) : <span className="text-textMuted" title="The bell has not rung on this day yet">—</span>}
                  </span>
                  {withStop && (
                    <span className="py-1 border-t border-borderSubtle/70 text-right text-textSecondary" title={d.stop != null ? `−${+((r?.dailyLossPct ?? 0) * 100).toFixed(1)}% of the account at 09:30` : 'The account at that open could not be valued — a held contract had no quote'}>
                      {d.stop != null ? usdSigned(-d.stop, Number.isInteger(d.stop) ? 0 : 2) : '—'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {cuts.length > 0 && (
        <div className="px-5 pb-4 pt-3 border-t border-borderSubtle/70 grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3" data-report-cuts>
          {cuts.map(c => (
            <div key={c.title} className="min-w-0">
              <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">{c.title}</div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 font-mono text-t11 tnum">
                <span className="text-t9 uppercase tracking-widest text-textMuted pb-1">&nbsp;</span>
                <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1">Trades</span>
                <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1">Won</span>
                <span className="text-t9 uppercase tracking-widest text-textMuted text-right pb-1">Made or lost</span>
                {c.rows.map(r => (
                  <div key={r.label} className="contents">
                    <span className="py-1 border-t border-borderSubtle/70 text-textPrimary truncate">{r.label}</span>
                    <span className="py-1 border-t border-borderSubtle/70 text-right text-textSecondary">{r.n}</span>
                    <span className="py-1 border-t border-borderSubtle/70 text-right text-textSecondary">{pct(r.winRate)}</span>
                    <span className={`py-1 border-t border-borderSubtle/70 text-right font-semibold ${dirInk(r.net)}`}>
                      {usdSigned(r.net)} {r.avgR != null && <span className="text-t10 font-normal opacity-80">{rWords(r.avgR)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TraceGrid rows={cap.shown} columns={columns} rowKey={t => t.id} autoHeight animate={false} widths={{ qty: 70, dte: 150, delta: 100, held: 110, decay: 120 }} flexes={{ in: 1.3, out: 1.3 }} emptyText="No closed trades yet" testId="review-report" />
      <RestFoot cap={cap} noun="trades" testId="review-report" />
    </TraceBox>
  );
};

export default Report;
