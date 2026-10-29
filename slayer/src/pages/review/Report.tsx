/*
  What a backtest session's closed trades add up to: the reader's own figures, the running total, and the cuts. Every
  fill was at the recorded NBBO with the session's fee, so the figures are after the spread and the fees.
*/

import { useEffect, useMemo } from 'react';
import { sayPage } from '../../components/layout/PageMeta';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import TraceBox, { Fact, RestFoot, TraceGrid, useRestCap } from '../../components/trace/TraceBox';
import ContractLabel from '../../components/ui/ContractLabel';
import SessionsChart, { type ChartPoint } from '../../components/record/SessionsChart';
import type { Column } from '../../components/ui/DataTable';
import { accountOf, cutsOf, decayPerDay, stampOf, statsOf, type Trade } from '../../data/review/engine';
import { contractWords } from '../../data/review/quotes';
import { useSession } from '../../data/review/store';
import { dateOf, dayWords } from '../../data/review/history';
import { dirInk, heldWords, momentWords, pct, rWords, usd, usdSigned } from '../../components/review/words';

const ENDED: Record<Trade['how'], string> = { sold: 'Sold by you', target: 'Target hit', stopped: 'Stopped out', expired: 'Held to the bell', scaled: 'Scaled out' };
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
  /* the running total, a point a day a trade closed on (noon: the same date in every reader's zone) */
  const curve = useMemo<ChartPoint[]>(() => {
    const byDay = new Map<string, number>();
    let run = 0;
    for (const t of trades) byDay.set(t.closed.day, (run += t.pnl));
    const pts = [...byDay.entries()].map(([day, value]) => ({ time: Math.floor(dateOf(day).getTime() / 1000), value }));
    return session && pts.length ? [{ time: Math.floor(dateOf(session.startDay).getTime() / 1000) - 86400, value: 0 }, ...pts] : pts;
  }, [trades, session]);
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
      { key: 'how', header: 'Ended', sortValue: t => t.how, render: t => <span className="text-textSecondary">{ENDED[t.how]}</span> },
      { key: 'pnl', header: 'Made or lost', align: 'right', sortValue: t => t.pnl, render: t => <span className={`font-semibold ${dirInk(t.pnl)}`}>{usdSigned(t.pnl)} <span className="text-t10 font-normal opacity-80">{rWords(t.r)}</span></span> },
    ],
    []
  );

  if (!session)
    return (
      <div className="border border-borderSubtle rounded-md bg-panel px-6 py-14 text-center" data-review-report="missing">
        <p className="text-t13 text-textPrimary">That session is not on this machine.</p>
        <Link to="/practice/backtest" className="mt-3 inline-block font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors">
          Your sessions
        </Link>
      </div>
    );

  /* the rules the session was run under — chosen at its start, hard blocks on a way in (data/review/engine) */
  const r = session.rules;
  const rulesWords = [r?.maxOpen ? `${r.maxOpen} open at once` : '', r?.maxRiskPct ? `${r.maxRiskPct * 100}% of the account a trade` : '', r?.dailyLossPct ? `the day stops at −${r.dailyLossPct * 100}%` : ''].filter(Boolean).join(' · ');
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
          <Fact label="Deepest fall">{usd(stats.maxDrawdown)}</Fact>
          <Fact label="Longest losing run">{stats.losingRun}</Fact>
          <Fact label="Time in a trade">{stats.n ? heldWords(stats.avgHeldMin) : '—'}</Fact>
        </>
      }
      controls={
        <Link to={`/practice/backtest/${session.id}`} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-borderSubtle bg-chip font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-review-desk-door>
          <ArrowLeft className="w-3 h-3" /> Back to the desk
        </Link>
      }
      sentence={sentence}
    >
      {curve.length > 1 && (
        <div className="px-5 pb-4 border-t border-borderSubtle/70 pt-3" data-report-curve>
          <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">The running total</div>
          <p className="mt-0.5 mb-2 text-t11 text-textMuted">What the closed trades had made or lost by the end of each day a trade closed on</p>
          <SessionsChart
            points={curve}
            kind="baseline"
            ink="rgb(var(--bull))"
            inkBelow="rgb(var(--bear))"
            height={200}
            clock="day"
            scale="pnl"
            testId="review-curve"
            card={h => (
              <div className="font-mono text-t11 tnum">
                <div className="text-textMuted text-t10">The running total</div>
                <div className={`mt-0.5 text-t13 font-semibold ${dirInk(h.point?.value ?? 0)}`}>{usdSigned(h.point?.value ?? 0)}</div>
                {h.prev && <div className="mt-0.5 text-textSecondary">{usdSigned((h.point?.value ?? 0) - h.prev.value)} that day</div>}
              </div>
            )}
          />
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
