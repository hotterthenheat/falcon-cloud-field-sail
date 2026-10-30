/* The account on the desk: the way back to the Accounts page, a switcher to any other account, what it is worth,
   today and all time, and — on a prop-firm or own-rules account — every rule with its bar and the room left. */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Plus, ShieldAlert } from 'lucide-react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { card, head } from '../review/DeskShell';
import { dirInk, usd, usdSigned } from '../review/words';
import type { PaperAccount, PaperView } from '../../data/paper/engine';
import { phaseOf, rulesOf, sellSays, sellWords, type RuleRead } from '../../data/paper/rules';
import { marginCallWords } from '../../data/paper/engine';
import { FIRM_GOVERNS, firmOf, sizeWords } from '../../data/paper/propFirms';
import { nyMomentWords } from '../../data/paper/clock';
import RuleBars from './RuleBars';
import { asOfWords } from './NewAccount';

const STATUS: Record<PaperAccount['status'], { word: string; ink: string }> = {
  open: { word: 'Open', ink: 'text-silver border-silver/50 bg-silver/[0.10]' },
  passed: { word: 'Passed', ink: 'text-bull border-bull/40 bg-bull/[0.10]' },
  failed: { word: 'Failed', ink: 'text-bear border-bear/40 bg-bear/[0.10]' },
  ended: { word: 'Ended', ink: 'text-textSecondary border-borderSubtle bg-ink/[0.03]' },
};
export const statusWord = (a: PaperAccount): string => (a.status === 'open' && a.dayOver && a.dayOver.day === a.day ? 'Paused today' : STATUS[a.status].word);
export const StatusChip = ({ a }: { a: PaperAccount }) => {
  const paused = a.status === 'open' && a.dayOver && a.dayOver.day === a.day;
  return (
    <span className={`inline-flex items-center h-5 px-1.5 shrink-0 rounded border font-mono text-t9 font-bold uppercase tracking-widest whitespace-nowrap ${paused ? 'text-warn border-warn/50 bg-warn/[0.10]' : STATUS[a.status].ink}`} title={a.statusWhy ?? a.dayOver?.why} data-paper-status-chip={paused ? 'paused' : a.status}>
      {statusWord(a)}
    </span>
  );
};
/** What kind of account it is, in a line: "Practice · $25K" · "Vanquish Trader · Basic Options · $50K · Phase 1" */
export function kindWords(a: PaperAccount): string {
  if (a.kind !== 'evaluation' || !a.plan) return `Practice · ${sizeWords(a.startCash)} · buy and sell, naked included`;
  if (a.plan.legacy) return `A futures evaluation (${a.plan.label}) from before options-only`;
  const ph = phaseOf(a);
  return [a.plan.firm ?? 'Your own rules', a.plan.firm ? a.plan.program : null, sizeWords(a.plan.size), ph.count > 1 ? ph.name : null].filter(Boolean).join(' · ');
}

const Cell = ({ label, children, title, testId }: { label: string; children: ReactNode; title?: string; testId?: string }) => (
  <div className="min-w-0" title={title}>
    <div className="text-t10 text-textMuted whitespace-nowrap">{label}</div>
    <div className="mt-0.5 font-mono text-t13 leading-tight tnum text-textPrimary whitespace-nowrap truncate" data-trace-fact={testId}>
      {children}
    </div>
  </div>
);

/** What is tied up of what the account is worth: the longs at their mark, and what the shorts hold of margin */
const TiedBar = ({ v }: { v: PaperView }) => {
  const worth = Math.max(1, v.equity);
  const longs = Math.max(0, v.opt.reduce((x, p) => x + (p.dir > 0 ? p.value : 0), 0));
  const held = Math.max(0, v.margin);
  const pct = (x: number) => `${Math.min(100, (x / worth) * 100).toFixed(2)}%`;
  return (
    <div className="w-full" data-paper-tied>
      <div className="relative h-[5px] rounded-full bg-ink/[0.08] overflow-hidden flex" aria-hidden="true">
        <span className="h-full bg-silver/70" style={{ width: pct(longs) }} />
        <span className={`h-full ${v.marginCall ? 'bg-bear' : 'bg-warn/70'}`} style={{ width: pct(held) }} />
      </div>
      <div className="mt-1 font-mono text-t9 tnum text-textMuted">
        in longs <span className="text-textSecondary">{usd(longs, 0)}</span> · margin held <span className="text-textSecondary">{usd(held, 0)}</span> of {usd(v.equity, 0)}
      </div>
    </div>
  );
};
/** What the account lets be sold: "Free reign" on practice, the plan's own on a firm's */
export const SellChip = ({ a }: { a: PaperAccount }) => {
  const r = rulesOf(a);
  const word = r ? sellWords(r.allowSell) : sellWords('all');
  const says = r ? sellSays(r) : 'Practice: everything — calls and puts bought or sold, naked included (held on a Reg T margin estimate), spreads, iron condors, cash-secured puts';
  return (
    <span className={`inline-flex items-center h-5 px-1.5 shrink-0 rounded border font-mono text-t9 font-bold uppercase tracking-widest whitespace-nowrap ${r && r.allowSell === 'none' ? 'text-textSecondary border-borderSubtle' : 'text-silver border-silver/50'}`} title={says} data-paper-sell-chip={r ? r.allowSell : 'all'}>
      {word}
    </span>
  );
};

const door = 'inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary transition-colors tap-40 shrink-0';

interface Props {
  account: PaperAccount;
  accounts: PaperAccount[];
  view: PaperView;
  rules: RuleRead[];
  /** Open another account's desk */
  onPick: (id: string) => void;
  onFlatten: (() => void) | null;
  /** Every working order cancelled */
  onCancelAll?: (() => void) | null;
}

const AccountCard = ({ account: a, accounts, view: v, rules, onPick, onFlatten, onCancelAll = null }: Props) => {
  const options: DropdownOption<string>[] = accounts
    .filter(x => !x.archived || x.id === a.id)
    .map(x => ({ value: x.id, label: x.name, hint: `${kindWords(x)} · ${statusWord(x).toLowerCase()}` }));
  const open = v.opt.length;
  const working = a.opt.orders.filter(o => o.status === 'working').length;
  const firm = firmOf(a.plan);
  const live = Number.isFinite(v.equity);
  return (
    <div className={`${card} min-w-0 shrink-0 flex flex-col`} data-paper-account={a.id} data-paper-kind={a.kind} data-paper-status={a.status}>
      <div className={`${head} px-3 gap-2`}>
        <Link to="/practice/paper" className={`${door} hover:text-textPrimary hover:border-borderMuted`} title="Every account, side by side" data-paper-back>
          <ArrowLeft className="w-3 h-3" /> Accounts
        </Link>
        <span className="min-w-0 flex-1 overflow-hidden">
          <DropdownSelect label="Account" value={a.id} options={options} onChange={onPick} title="Switch to another account’s desk" testId="paper-account-pick" size="sm" bare />
        </span>
        <StatusChip a={a} />
        <Link to="/practice/paper?new=1" className={`${door} px-1.5 hover:text-textPrimary hover:border-borderMuted`} title="A new account" aria-label="A new account" data-paper-new-link>
          <Plus className="w-3 h-3" />
        </Link>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <p className="text-t11 leading-snug text-textMuted" data-paper-subline>
          {a.status !== 'open' && a.statusWhy ? (
            <span className={a.status === 'failed' ? 'text-bear' : a.status === 'passed' ? 'text-bull' : 'text-textSecondary'}>
              {a.statusWhy}
              {a.statusAt ? ` · ${nyMomentWords(a.statusAt)}` : ''}
            </span>
          ) : (
            <>
              {kindWords(a)} · {a.fee > 0 ? `$${a.fee.toFixed(2)} a contract each way` : 'no commission'}
            </>
          )}
        </p>
        {!a.plan?.legacy && (
          <div className="-mt-1.5 flex items-center gap-2 min-w-0">
            <SellChip a={a} />
            <span className="text-t10 text-textMuted truncate" title={rulesOf(a) ? sellSays(rulesOf(a)!) : undefined}>
              {rulesOf(a) ? (rulesOf(a)!.allowSell === 'none' ? 'what the plan allows: buys only' : 'what the plan allows to be sold') : 'practice: anything may be sold'}
            </span>
          </div>
        )}
        {v.marginCall && a.status === 'open' && (
          <p className="text-t11 leading-snug text-bear font-medium" role="alert" data-paper-margin-call>
            {marginCallWords(v)}
          </p>
        )}
        <div className="grid grid-cols-3 max-[440px]:grid-cols-2 gap-x-4 gap-y-3" data-paper-facts>
          <div className="min-w-0 max-[440px]:col-span-2">
            <div className="text-t10 text-textMuted whitespace-nowrap">Worth</div>
            <div className="mt-0.5 font-mono text-t18 leading-none font-semibold tnum text-textPrimary whitespace-nowrap truncate" data-paper-worth>
              {live ? usd(v.equity) : '—'}
            </div>
          </div>
          <Cell label="Today" testId="paper-today" title="Since the trading day began at 17:00 ET">
            <span className={live ? dirInk(v.today) : 'text-textMuted'}>{live ? usdSigned(v.today) : '—'}</span>
          </Cell>
          <Cell label="All time" testId="paper-all-time">
            <span className={live ? dirInk(v.allTime) : 'text-textMuted'}>{live ? usdSigned(v.allTime) : '—'}</span>
          </Cell>
          <Cell label="Free" testId="paper-free" title="Buying power: cash less what the open shorts hold — what pays for an option or holds a new short">
            <span className={v.free < 0 ? 'text-bear' : undefined}>{usd(v.free)}</span>
          </Cell>
          <Cell label="Margin held" testId="paper-margin" title="What the open shorts hold of your money, re-marked every tick: a credit spread’s or cash-secured put’s whole loss; a naked short’s Reg T estimate less its premium">
            <span className={v.marginCall ? 'text-bear' : v.margin > 0 ? 'text-warn' : 'text-textMuted'}>{usd(v.margin)}</span>
          </Cell>
          <Cell label="Open, up or down" testId="paper-open">
            <span className={live ? dirInk(v.openPnl) : 'text-textMuted'}>{live ? usdSigned(v.openPnl) : '—'}</span>
          </Cell>
          <Cell label="Closed trades" testId="paper-closed">
            <span className={dirInk(v.closed)}>{usdSigned(v.closed, 0)}</span>
          </Cell>
        </div>
        {rules.length ? <RuleBars rules={rules} /> : <TiedBar v={v} />}
        {a.plan && !a.plan.legacy && (
          <p className="font-mono text-t9 leading-snug text-textMuted" data-paper-plan-source>
            {firm ? (
              <>
                {firm.name}’s rules as of {asOfWords(firm.asOf)} ·{' '}
                <a href={firm.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-textSecondary hover:text-textPrimary hover:underline underline-offset-2">
                  the firm’s page <ExternalLink className="w-2.5 h-2.5" />
                </a>{' '}
                · {FIRM_GOVERNS}
              </>
            ) : (
              'Your own rules — set when the account started'
            )}
            {a.plan.notModelled?.length ? <span className="text-warn"> · not modelled: {a.plan.notModelled.join(' · ')}</span> : null}
          </p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-t10 tnum text-textMuted mr-auto" data-paper-counts>
            {open} open · {working} working · {v.optTrades.length + v.futTrades.length} closed
          </span>
          {onCancelAll && a.status === 'open' && working > 0 && (
            <button type="button" onClick={onCancelAll} title="Every working order cancelled — what is open stays open" className={`${door} hover:text-textPrimary hover:border-borderMuted`} data-paper-cancel-all>
              Cancel all
            </button>
          )}
          {onFlatten && a.status === 'open' && open + working > 0 && (
            <button type="button" onClick={onFlatten} title="Close everything open at the market and cancel everything working — now" className={`${door} hover:text-bear hover:border-bear/50`} data-paper-flatten>
              <ShieldAlert className="w-3 h-3" /> Flatten
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
