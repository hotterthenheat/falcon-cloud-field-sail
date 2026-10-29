/*
  Pulse's market tiles, lists with every row a door to its page: news, earnings, stocks, and insiders and Congress.
*/

import { useMemo } from 'react';
import CompanyLogo from '../../../components/ui/CompanyLogo';
import Sparkline from '../../../components/compass/Sparkline';
import { CAT_COLOR } from '../../../components/news/CatTag';
import { ImpactMark, tierOf } from '../../../components/record/impactMark';
import { agoWords, whenParts } from '../../../components/record/when';
import { GRADE_INK } from '../../../components/ui/GradeMeter';
import { bracketLabel, congressSentence, summariseCongress } from '../../../data/congress';
import { useEarningsCalendar } from '../../../data/earningsFeed';
import { stateOf, type VolState } from '../../../components/earnings/volState';
import { OPEN_MARKET_CODES, TX_CODES, insidersSentence } from '../../../data/insiders';
import type { NewsCategory } from '../../../data/news';
import { useLiveRecord } from '../../../data/liveRecord';
import { gradeOfComposite, type Grade } from '../../../data/stockOverview';
import { useStockBoard } from '../../../data/stocks';
import { fmtDollars } from '../../../data/ahead';
import type { TileControl, TileProps } from '../tile';
import { TileEmpty, TileHeads, TileRead, TileRow, TileRows, dirInk, signedPct, useDoor } from './parts';

/* ------------------------------------------------------------------ news */

const BEATS = Object.keys(CAT_COLOR) as NewsCategory[];
const BEAT_HINT: Record<NewsCategory, string> = {
  Earnings: 'Reports and the reaction',
  Guidance: 'What companies say comes next',
  Analyst: 'Upgrades, downgrades, targets',
  Macro: 'Rates, data, the Fed',
  'M&A': 'Deals',
  Product: 'Launches',
  Regulatory: 'Rulings and probes',
  General: 'Stories of no named beat',
};
export const newsControls = (): TileControl[] => [{ id: 'beat', label: 'Beat', title: 'Which beat of the wire', options: [{ value: 'all', label: 'Every beat', hint: 'The whole wire' }, ...BEATS.map(b => ({ value: b, label: b, hint: BEAT_HINT[b] }))] }];

export const NewsTile = ({ ctx, state, size }: TileProps) => {
  const door = useDoor();
  /* the wire drips by the minute — the desk's sweep is often enough */
  const record = useLiveRecord();
  const events = useMemo(() => (record.news.status === 'live' ? record.news.events : []), [record.news]);
  const beat = String(state.beat ?? 'all');
  const rows = useMemo(() => (beat === 'all' ? events : events.filter(e => e.item.category === beat)), [events, beat]);
  if (record.news.status === 'loading') return <TileEmpty words="Reading the wire." />;
  if (rows.length === 0) return <TileEmpty words={beat === 'all' ? 'Nothing on the wire yet today.' : `Nothing on the ${beat} beat yet today.`} />;
  const wide = size.room !== 'small';
  const cols = wide ? '40px 58px minmax(0,1fr) 52px' : '50px minmax(0,1fr) 48px';
  const up = rows.filter(e => e.grade === 'ALLY').length;
  const down = rows.filter(e => e.grade === 'THREAT').length;
  const heaviest = [...rows].sort((a, b) => b.severity - a.severity)[0];
  return (
    <div className="h-full min-h-0 flex flex-col" data-news-tile>
      <TileRows>
        {rows.map(e => {
          const move = e.item.prediction.expMove1dPct;
          return (
            <TileRow key={e.id} columns={cols} height={34} testId={e.id} title={`${e.item.headline} — open it on the News page`} onClick={() => door('/dossier/news', { selectedId: e.id })}>
              {wide && <span className="text-t10 text-textSecondary">{e.item.time}</span>}
              <span className="min-w-0 truncate text-t11 font-bold text-textPrimary">{e.item.ticker ?? <span className="font-normal text-textSecondary">Macro</span>}</span>
              <span className="min-w-0 flex items-center gap-2">
                <ImpactMark tier={tierOf(e.severity)} />
                <span className="min-w-0 truncate font-sans text-t12 text-textSecondary">{e.item.headline}</span>
              </span>
              <span className={`text-right font-semibold ${dirInk(move)}`}>{signedPct(move, 1)}</span>
            </TileRow>
          );
        })}
      </TileRows>
      <TileRead testId="news">
        {up} of the {rows.length} stories lean positive, {down} negative. The heaviest: {heaviest.item.ticker ?? 'the market'} — {heaviest.item.headline}
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ earnings */

const PRICED: { value: 'all' | VolState; label: string; hint: string }[] = [
  { value: 'all', label: 'Every report', hint: 'The next two weeks' },
  { value: 'RICH', label: 'Priced rich', hint: 'The market charges more than the name usually moves' },
  { value: 'INLINE', label: 'Priced fair', hint: 'About what the name usually moves' },
  { value: 'CHEAP', label: 'Priced cheap', hint: 'Less than the name usually moves' },
];
export const earningsControls = (): TileControl[] => [{ id: 'priced', label: 'Priced', title: 'What the market charges for the move', options: PRICED }];

export const EarningsTile = ({ state, size }: TileProps) => {
  const door = useDoor();
  const calendar = useEarningsCalendar();
  const events = useMemo(() => [...calendar].sort((a, b) => a.daysOut - b.daysOut), [calendar]);
  const priced = String(state.priced ?? 'all');
  const rows = useMemo(() => (priced === 'all' ? events : events.filter(e => stateOf(e) === priced)), [events, priced]);
  if (rows.length === 0) return <TileEmpty words="No report in the next two weeks is priced that way." />;
  const wide = size.room !== 'small';
  const cols = wide ? '22px minmax(0,1fr) 104px 52px 48px' : '22px minmax(0,1fr) 84px 50px';
  const next = rows[0];
  const dearest = [...rows].sort((a, b) => b.richness - a.richness)[0];
  return (
    <div className="h-full min-h-0 flex flex-col" data-earnings-tile>
      <TileHeads columns={cols}>
        <span />
        <span>Name</span>
        <span>Reports</span>
        <span className="text-right">Move</span>
        {wide && <span className="text-right">Priced</span>}
      </TileHeads>
      <TileRows>
        {rows.map(e => {
          const st = stateOf(e);
          return (
            <TileRow key={e.ticker} columns={cols} height={36} testId={e.ticker} title={`Open ${e.ticker}'s report`} onClick={() => door(`/dossier/earnings/${e.ticker}`)}>
              <CompanyLogo ticker={e.ticker} size={20} />
              <span className="min-w-0 flex flex-col leading-tight">
                <span className="font-bold text-textPrimary">{e.ticker}</span>
                <span className="font-sans text-t10 text-textMuted truncate">{e.name}</span>
              </span>
              <span className="min-w-0 flex flex-col leading-tight">
                <span className="text-textPrimary">{e.daysOut === 0 ? 'Today' : e.dateLabel}</span>
                <span className={`text-t9 ${e.slot === 'BMO' ? 'text-warn' : 'text-flip'}`}>{e.slot === 'BMO' ? 'before the open' : 'after the close'}</span>
              </span>
              <span className="text-right font-semibold text-textPrimary">±{e.impliedMovePct.toFixed(1)}%</span>
              {wide && (
                <span className={`text-right font-semibold ${st === 'RICH' ? 'text-warn' : st === 'CHEAP' ? 'text-bull' : 'text-textSecondary'}`} title={`${e.richness.toFixed(2)}× what ${e.ticker} usually moves on a report`}>
                  {st === 'RICH' ? 'rich' : st === 'CHEAP' ? 'cheap' : 'fair'}
                </span>
              )}
            </TileRow>
          );
        })}
      </TileRows>
      <TileRead testId="earnings">
        {next.ticker} reports {next.daysOut === 0 ? 'today' : next.daysOut === 1 ? 'next session' : `in ${next.daysOut} sessions`}, {next.slot === 'BMO' ? 'before the open' : 'after the close'}, with ±{next.impliedMovePct.toFixed(1)}% priced in.{' '}
        {dearest.ticker !== next.ticker && stateOf(dearest) === 'RICH' ? `${dearest.ticker} is priced richest against what it usually moves.` : ''}
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ stocks */

const SCREEN_DOT: Record<Grade, string> = { strong: 'bg-bull ring-2 ring-bull/30', good: 'bg-bull', caution: 'bg-warn', poor: 'bg-bear' };
const SCREENS: { value: 'all' | Grade; label: string; hint: string }[] = [
  { value: 'all', label: 'Every name', hint: 'The whole board, the strongest first' },
  { value: 'strong', label: 'Strong', hint: 'Trend, numbers, money and news all for the name' },
  { value: 'good', label: 'Good', hint: 'More for the name than against it' },
  { value: 'caution', label: 'Caution', hint: 'Mixed' },
  { value: 'poor', label: 'Poor', hint: 'More against the name than for it' },
];
export const stocksControls = (): TileControl[] => [{ id: 'screen', label: 'Screen', title: 'Which names the board shows', options: SCREENS }];

export const StocksTile = ({ ctx, state, size }: TileProps) => {
  const door = useDoor();
  const picks = useStockBoard();
  const screen = String(state.screen ?? 'all');
  const rows = useMemo(() => (screen === 'all' ? picks : picks.filter(p => gradeOfComposite(p.composite) === screen)), [picks, screen]);
  if (rows.length === 0) return <TileEmpty words={`No name on the board screens ${screen} today.`} />;
  const wide = size.room !== 'small';
  const cols = wide ? '20px minmax(0,1fr) 62px 76px 70px' : '20px minmax(0,1fr) 58px 66px';
  const strong = picks.filter(p => gradeOfComposite(p.composite) === 'strong');
  return (
    <div className="h-full min-h-0 flex flex-col" data-stocks-tile>
      <TileHeads columns={cols}>
        <span />
        <span>Name</span>
        <span className="text-right">Today</span>
        {wide && <span>30 days</span>}
        <span>Screen</span>
      </TileHeads>
      <TileRows>
        {rows.map(p => {
          const g = gradeOfComposite(p.composite);
          return (
            <TileRow key={p.ticker} columns={cols} height={34} testId={p.ticker} title={`${p.thesis} — open ${p.ticker}`} onClick={() => door(`/dossier/stocks/${p.ticker}`)}>
              <CompanyLogo ticker={p.ticker} size={18} />
              <span className="min-w-0 flex flex-col leading-tight">
                <span className="font-bold text-textPrimary">{p.ticker}</span>
                <span className="font-sans text-t10 text-textMuted truncate">{p.name}</span>
              </span>
              <span className={`text-right ${dirInk(p.changePct)}`}>{signedPct(p.changePct)}</span>
              {wide && <Sparkline data={p.trend} up={p.trend[p.trend.length - 1] >= p.trend[0]} width={70} height={18} />}
              <span className={`inline-flex items-center gap-1.5 text-t10 font-semibold ${GRADE_INK[g]}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SCREEN_DOT[g]}`} />
                {g}
              </span>
            </TileRow>
          );
        })}
      </TileRows>
      <TileRead testId="stocks">
        {strong.length === 0
          ? 'No name screens strong today — trend, numbers, money and news are not lined up behind any of them.'
          : `${strong.length} ${strong.length === 1 ? 'name screens' : 'names screen'} strong today: ${strong
              .slice(0, 4)
              .map(p => p.ticker)
              .join(', ')}${strong.length > 4 ? ' and more' : ''}. What the data says, never an instruction.`}
      </TileRead>
    </div>
  );
};

/* ------------------------------------------------------------------ insiders & Congress */

export const filingsControls = (): TileControl[] => [
  {
    id: 'who',
    label: 'Filed by',
    title: 'Whose trades',
    options: [
      { value: 'insiders', label: 'Insiders', hint: 'Officers and directors trading their own company’s stock' },
      { value: 'congress', label: 'Congress', hint: 'What members of Congress reported buying and selling' },
    ],
  },
];
export const filingsPath = (who: unknown) => (who === 'congress' ? '/dossier/congress' : '/dossier/insiders');
const WINDOW_DAYS = 90;

export const FilingsTile = ({ ctx, state, size, open }: TileProps) => {
  const congress = state.who === 'congress';
  const record = useLiveRecord();
  const insiders = useMemo(() => {
    if (congress) return [];
    if (record.insiders.status !== 'live') return [];
    const keep = new Set(OPEN_MARKET_CODES);
    return record.insiders.trades.filter(t => t.daysAgo <= WINDOW_DAYS && keep.has(t.code));
  }, [congress, record.insiders]);
  const feed = useMemo(() => {
    if (!congress) return null;
    if (record.congress.status !== 'live') return summariseCongress([], WINDOW_DAYS);
    return summariseCongress(record.congress.trades.filter(t => t.tradedDaysAgo <= WINDOW_DAYS), WINDOW_DAYS);
  }, [congress, record.congress]);
  const wide = size.room !== 'small';
  if ((congress && record.congress.status === 'loading') || (!congress && record.insiders.status === 'loading')) return <TileEmpty words="Reading the filings." />;
  if (feed) {
    const cols = wide ? '44px minmax(0,1.2fr) 52px 62px minmax(0,1fr)' : '44px minmax(0,1fr) 50px 58px';
    return (
      <div className="h-full min-h-0 flex flex-col" data-filings-tile="congress">
        <TileHeads columns={cols}>
          <span>Filed</span>
          <span>Member</span>
          <span>Name</span>
          <span>Trade</span>
          {wide && <span>Amount</span>}
        </TileHeads>
        <TileRows>
          {feed.trades.map(t => (
            <TileRow key={t.id} columns={cols} testId={t.id} onClick={open} title={`${t.member.name} · ${t.assetDescription} — open Congress`}>
              <span className="text-t10 text-textSecondary" title={agoWords(t.filedDaysAgo)}>
                {whenParts(t.filedDaysAgo).date}
              </span>
              <span className="min-w-0 truncate font-sans text-t12 text-textPrimary">
                {t.member.name} <span className="font-mono text-t9 text-textMuted">{t.member.party}</span>
              </span>
              <span className="font-bold text-textPrimary">{t.ticker}</span>
              <span className={t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}>{t.type === 'Purchase' ? 'Bought' : t.type === 'Exchange' ? 'Exchanged' : 'Sold'}</span>
              {wide && <span className="min-w-0 truncate text-t10 text-textSecondary">{bracketLabel(t.bracket)}</span>}
            </TileRow>
          ))}
        </TileRows>
        <TileRead testId="filings">{congressSentence(feed)}</TileRead>
      </div>
    );
  }
  if (insiders.length === 0) return <TileEmpty words={`No insider filed a trade in the last ${WINDOW_DAYS} days.`} />;
  const cols = wide ? '44px 52px minmax(0,1fr) 54px 64px' : '44px 50px minmax(0,1fr) 60px';
  return (
    <div className="h-full min-h-0 flex flex-col" data-filings-tile="insiders">
      <TileHeads columns={cols}>
        <span>Filed</span>
        <span>Name</span>
        <span>Who</span>
        {wide && <span>Trade</span>}
        <span className="text-right">Value</span>
      </TileHeads>
      <TileRows>
        {insiders.map(t => {
          const buy = t.kind === 'BUY';
          return (
            <TileRow key={t.id} columns={cols} testId={t.id} onClick={open} title={`${t.person}, ${t.role} — ${TX_CODES[t.code].label.toLowerCase()} — open Insiders`}>
              <span className="text-t10 text-textSecondary" title={agoWords(t.daysAgo)}>
                {whenParts(t.daysAgo).date}
              </span>
              <span className="font-bold text-textPrimary">{t.ticker}</span>
              <span className="min-w-0 truncate font-sans text-t12 text-textPrimary">
                {t.person} <span className="text-t10 text-textMuted">{t.role}</span>
              </span>
              {wide && <span className={buy ? 'text-bull' : 'text-bear'}>{buy ? 'Bought' : 'Sold'}</span>}
              <span className={`text-right font-semibold ${wide ? 'text-textPrimary' : buy ? 'text-bull' : 'text-bear'}`}>{fmtDollars(t.value)}</span>
            </TileRow>
          );
        })}
      </TileRows>
      <TileRead testId="filings">{insidersSentence(insiders, WINDOW_DAYS).replace(' — the rows on this page with one obvious motive', '')}</TileRead>
    </div>
  );
};
