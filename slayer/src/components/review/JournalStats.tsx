/* The period's figures beside the month: what it made, won and lost, average win and loss, best and worst trade
   and day, runs, profit factor, expectancy and the deepest drawdown. */

import type { ReactNode } from 'react';
import { card } from './DeskShell';
import { dirInk, heldWords, pct, ratioWords, RATIO_TITLE, scratchWords, SCRATCH_TITLE, usd, usdSigned } from './words';
import { statsOf } from '../../data/review/engine';
import { keptOf } from '../../data/review/excursion';
import { dayMinOf, type JournalRow } from '../../data/review/journal';
import { grossOf, runsOf, type DayTotal } from '../../data/review/journalFigures';
import { MONTHS } from '../../core/calendar';

const dayWords = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

const Row = ({ label, title, children, testId }: { label: string; title?: string; children: ReactNode; testId: string }) => (
  <div className="h-7 flex items-center justify-between gap-4" title={title} data-journal-stat={testId}>
    <span className="font-mono text-t10 uppercase tracking-wider text-textMuted whitespace-nowrap">{label}</span>
    <span className="font-mono text-t12 tnum text-textPrimary whitespace-nowrap">{children}</span>
  </div>
);
/** A group of rows; the groups share whatever height the row beside the calendar leaves, so the two cards end level */
const Group = ({ children }: { children: ReactNode }) => <div className="px-5 py-1.5 border-t border-borderSubtle/70 flex-1 flex flex-col justify-center">{children}</div>;

interface Props {
  rows: JournalRow[];
  /** The period's days, from the page */
  periodDays: Map<string, DayTotal>;
  /** "This month" · "All time" — what the figures are of */
  periodLabel: string;
  /** The page's figures, where it has them — read off the account's own equity when one account is shown whole */
  stats?: ReturnType<typeof statsOf>;
  /** One account, all of it — Sharpe and Sortino are its daily closes' */
  whole?: boolean;
}

const JournalStats = ({ rows, periodDays, periodLabel, stats, whole = false }: Props) => {
  const s = stats ?? statsOf(rows.map(r => r.t));
  const onCurve = s.drawdownFrom === 'curve';
  const gross = grossOf(rows);
  const runs = runsOf(rows);
  const kept = keptOf(rows);
  const ranked = [...periodDays.values()].sort((a, b) => b.net - a.net);
  const bestDay = ranked[0];
  const worstDay = ranked[ranked.length - 1];
  const losses = s.n - s.wins - s.scratches;
  const avgHeld = s.n ? heldWords(s.avgHeldMin, rows[0] ? dayMinOf(rows[0]) : 390) : '—';
  const none = <span className="text-textMuted">—</span>;

  return (
    <div className={`${card} flex flex-col min-w-0 h-full`} data-journal-stats={s.n}>
      <div className="px-5 pt-3.5 pb-2.5">
        <div className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary">{periodLabel}</div>
        <div className={`mt-1.5 font-mono text-t24 font-semibold tnum leading-none ${s.n ? dirInk(s.net) : 'text-textMuted'}`} data-journal-stats-net>
          {s.n ? usdSigned(s.net) : '—'}
        </div>
        <div className="mt-1.5 font-mono text-t11 tnum text-textSecondary">{s.n ? `${s.n} ${s.n === 1 ? 'trade' : 'trades'} · ${periodDays.size} ${periodDays.size === 1 ? 'day' : 'days'} traded` : 'Nothing closed in this period'}</div>
      </div>
      <Group>
        <Row label="Won · lost" testId="won">
          {s.n ? (
            <>
              <span className="text-bull">{s.wins}</span> · <span className="text-bear">{losses}</span>
              {s.scratches > 0 && (
                <span className="text-textMuted" title={SCRATCH_TITLE}>
                  {' '}
                  · {scratchWords(s.scratches)}
                </span>
              )}
              {s.wins + losses > 0 && <span className="text-textMuted"> · {pct(s.winRate)}</span>}
            </>
          ) : (
            none
          )}
        </Row>
        <Row label="Winners made" testId="gross-made">{s.wins ? <span className="text-bull">{usdSigned(gross.made)}</span> : none}</Row>
        <Row label="Losers lost" testId="gross-lost">{losses ? <span className="text-bear">{usdSigned(gross.lost)}</span> : none}</Row>
        <Row label="Profit factor" title="What the winners made, over what the losers lost" testId="pf">
          {!s.n ? none : s.profitFactor == null ? <span className="text-bull">no losses</span> : <span className={s.profitFactor >= 1 ? 'text-bull' : 'text-bear'}>{s.profitFactor.toFixed(2)}</span>}
        </Row>
      </Group>
      <Group>
        <Row label="Average win" testId="avg-win">{s.wins ? <span className="text-bull">{usdSigned(s.avgWin)}</span> : none}</Row>
        <Row label="Average loss" testId="avg-loss">{losses ? <span className="text-bear">{usdSigned(s.avgLoss)}</span> : none}</Row>
        <Row label="A trade was worth" title="The period's total, over how many trades" testId="expectancy">{s.n ? <span className={dirInk(s.expectancy)}>{usdSigned(s.expectancy)}</span> : none}</Row>
        <Row label="Best · worst trade" testId="best-worst">
          {s.n ? (
            <>
              <span className={dirInk(s.best)}>{usdSigned(s.best, 0)}</span> · <span className={dirInk(s.worst)}>{usdSigned(s.worst, 0)}</span>
            </>
          ) : (
            none
          )}
        </Row>
      </Group>
      <Group>
        <Row label="Best day" testId="best-day">
          {bestDay ? (
            <>
              <span className={dirInk(bestDay.net)}>{usdSigned(bestDay.net, 0)}</span> <span className="text-textMuted">{dayWords(bestDay.day)}</span>
            </>
          ) : (
            none
          )}
        </Row>
        <Row label="Worst day" testId="worst-day">
          {worstDay && periodDays.size > 1 ? (
            <>
              <span className={dirInk(worstDay.net)}>{usdSigned(worstDay.net, 0)}</span> <span className="text-textMuted">{dayWords(worstDay.day)}</span>
            </>
          ) : (
            none
          )}
        </Row>
        <Row label="Longest run" title={runs.now ? `The most wins in a row, and the most losses — and the run the last trades make: ${runs.now.n} ${runs.now.won ? 'won' : 'lost'} in a row` : 'The most wins in a row, and the most losses in a row'} testId="runs">
          {s.n ? (
            <>
              <span className="text-bull">{runs.wins} {runs.wins === 1 ? 'win' : 'wins'}</span> · <span className="text-bear">{runs.losses} {runs.losses === 1 ? 'loss' : 'losses'}</span>
              {runs.now && runs.now.n > 1 && <span className="text-textMuted"> · now {runs.now.n} {runs.now.won ? 'won' : 'lost'}</span>}
            </>
          ) : (
            none
          )}
        </Row>
      </Group>
      <Group>
        <Row
          label={onCurve ? 'Account’s worst drop' : 'Worst drop from a high'}
          title={onCurve ? 'The account’s worst fall from a high, its open positions marked — not only what the closed trades added up to' : 'The most the running total of these closed trades fell from its best before it made a new one, each trade’s own open dip counted'}
          testId="drop"
        >
          {!s.n && !onCurve ? none : s.maxDrawdown > 0 ? <span className="text-bear">−{usd(s.maxDrawdown)}</span> : <span className="text-textSecondary">none</span>}
        </Row>
        <Row label="Sharpe · Sortino" title={whole ? RATIO_TITLE : 'Read off one account’s own daily closes — pick one account and All time'} testId="ratios">
          {whole ? (
            <>
              {ratioWords(s.sharpe)} · {ratioWords(s.sortino)}
            </>
          ) : (
            none
          )}
        </Row>
        <Row label="Kept of the best" title={kept.share != null ? `Your trades were up ${usdSigned(kept.best, 0)} at their best, added together; ${usdSigned(kept.made, 0)} of it was taken` : 'None of these trades was ever up'} testId="kept">
          {kept.share != null ? pct(kept.share) : none}
        </Row>
        <Row label="Held on average" testId="held">{s.n ? avgHeld : none}</Row>
      </Group>
    </div>
  );
};

export default JournalStats;
