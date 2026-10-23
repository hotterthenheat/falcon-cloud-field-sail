import type { ReactNode } from 'react';
import { useStockCard } from '../../data/liveFiles';
import { useStockFile } from '../../data/stockFile';
import { nextReportRow, reportDayLabel, tradingDaysUntil, untilWords } from '../../data/earningsFeed';
import { FILE_TTL_MS, FeedFallback, StaleMark, TickFigure, quietText } from '../ui/liveRead';
import { statHelp } from './statHelp';

/*
  The company, under a name. Only what the vendor file actually carries.
  A street target, forward estimates and the last call are not on this feed.
*/

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[10px] text-textMuted truncate cursor-help" title={statHelp(label)}>{label}</dt>
    <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-textPrimary whitespace-nowrap truncate">{children}</dd>
  </div>
);

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

/** A fraction under 1.5 is a share of 1; anything larger is already a percent. */
const asPct = (v: number | null): number | null => {
  if (v == null) return null;
  return Math.abs(v) <= 1.5 ? v * 100 : v;
};

const money = (v: number | null): string => {
  if (v == null || !(v > 0)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
};

const count = (v: number | null): string => {
  if (v == null || !(v > 0)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${Math.round(v)}`;
};

const CompanyFile = ({ ticker }: { ticker: string }) => {
  const card = useStockCard(ticker);
  const file = useStockFile(ticker);
  /* the one next-earnings rule (data/earningsFeed.ts) — the same date the stock page and the earnings file show */
  const nextRow = nextReportRow(file.earnings);
  const next = nextRow?.report_date
    ? { dateLabel: reportDayLabel(nextRow.report_date), daysOut: tradingDaysUntil(nextRow.report_date), confirmed: String(nextRow.source ?? '').toLowerCase() === 'company' }
    : null;
  const screen = file.screen;
  const yieldPct = asPct(screen ? num(screen.dividend_yield) : null);
  const growth = asPct(screen ? num(screen.eps_growth_4q) : null);
  const industry = screen && typeof screen.industry_type === 'string' && screen.industry_type ? screen.industry_type : null;
  const reading = card === undefined;
  const line = card?.sector || (reading ? 'Reading the company' : '—');
  const fault = file.status === 'error' ? 'failed' as const : null;
  const profile = card?.description ? quietText(card.description) : '—';
  return (
    <section className="border border-borderSubtle rounded-md bg-panel" data-company-file-root={ticker}>
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-semibold leading-tight text-textPrimary inline-flex items-center gap-2">
          The company
          <StaleMark at={file.at} ttlMs={FILE_TTL_MS} fault={fault} />
        </h3>
        <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">{industry ? `${quietText(line)} · ${quietText(industry)}` : quietText(line)}</p>
      </div>
      {reading ? (
        <p className="px-5 pb-4 font-mono text-[10px] uppercase tracking-widest text-textMuted">Reading the company</p>
      ) : card === null ? (
        fault ? <FeedFallback fault={fault} /> : <p className="px-5 pb-4 font-mono text-[10px] uppercase tracking-widest text-textMuted">The company file is not on this feed</p>
      ) : (
        <>
          <p className="px-5 pb-4 text-[12px] leading-relaxed text-textSecondary" data-company-file="profile">{profile}</p>
          <dl className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
            <Fact label="Market cap"><TickFigure value={card.marketCap}>{money(card.marketCap)}</TickFigure></Fact>
            <Fact label="Shares out"><TickFigure value={card.outstanding}>{count(card.outstanding)}</TickFigure></Fact>
            <Fact label="Beta">{card.beta != null ? <TickFigure value={card.beta}>{card.beta.toFixed(2)}</TickFigure> : '—'}</Fact>
            <Fact label="Average volume"><TickFigure value={card.avgVolume}>{count(card.avgVolume)}</TickFigure></Fact>
            <Fact label="Next earnings">{next && next.daysOut >= 0 ? <span title={next.confirmed ? 'Date set by the company' : 'Not announced yet — Unusual Whales’ estimate'}>{next.dateLabel} · {untilWords(next.daysOut)}{next.confirmed ? '' : ' · est.'}</span> : '—'}</Fact>
            <Fact label="Dividend">{card.hasDividend == null ? '—' : card.hasDividend ? 'Pays one' : 'None'}</Fact>
            <Fact label="Dividend yield">{yieldPct != null ? <TickFigure value={yieldPct}>{`${yieldPct.toFixed(2)}%`}</TickFigure> : file.status === 'loading' ? '…' : '—'}</Fact>
            <Fact label="EPS growth · YoY">
              {growth != null ? <TickFigure value={growth} className={growth >= 0 ? 'text-bull' : 'text-bear'}>{growth >= 0 ? '+' : growth < 0 ? '−' : ''}{Math.abs(growth).toFixed(2)}%</TickFigure> : file.status === 'loading' ? '…' : '—'}
            </Fact>
          </dl>
          <p className="px-5 pb-4 text-[11px] text-textMuted">A street target, the forward estimates and the last call are not on this feed.</p>
        </>
      )}
    </section>
  );
};

export default CompanyFile;