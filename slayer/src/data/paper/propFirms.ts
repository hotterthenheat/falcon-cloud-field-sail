/* The prop firms a paper account can practise an evaluation of — options only — each plan as data for the rule
   engine (rules.ts), with the page its numbers were read from and the date they were read. Only numbers a firm's own
   page states are here; a rule the page does not state is off. The firm's own site governs: its rules change, and
   this page says when they were last read.

   The plain practice account is here too: no rules, cash is the only limit. And the reader's own rules, made from
   numbers the reader types (customPlan). */

import { NO_RULES, type DrawdownMode, type PaperPlan, type PropRules } from './rules';
import { HOUSE_FEE } from './engine';

export interface PropFirm {
  id: string;
  name: string;
  /** The firm's own page for its rules */
  url: string;
  /** When the numbers here were read off it (YYYY-MM-DD) */
  asOf: string;
  /** One line about the firm's options program, in the firm's terms */
  about?: string;
  plans: PaperPlan[];
}

/** The line every firm's numbers carry */
export const FIRM_GOVERNS = 'The firm’s own site governs. Its rules change — check them there before you pay for an evaluation.';

/** The firms with an options evaluation, as their own pages state the rules. Filled from verified research only. */
export const PROP_FIRMS: PropFirm[] = [];

export const planById = (id: string): PaperPlan | null => {
  for (const f of PROP_FIRMS) for (const p of f.plans) if (p.id === id) return p;
  return null;
};
export const firmOf = (plan: PaperPlan | undefined | null): PropFirm | null => (plan?.firm ? (PROP_FIRMS.find(f => f.name === plan.firm) ?? null) : null);

/* ================================================================== */
/*  THE READER'S OWN RULES                                             */
/* ================================================================== */

export interface CustomRules {
  size: number;
  /** $ to pass — 0: no target */
  target: number;
  /** $ a day may lose — 0: no limit */
  dailyLoss: number;
  dailyBreach: 'fail' | 'pause';
  /** $ it may lose in all — 0: no floor */
  drawdown: number;
  drawdownMode: DrawdownMode;
  /** Trailing floors stop at the start */
  lockAtStart: boolean;
  minDays: number;
  /** % — 0: off */
  consistencyPct: number;
  maxContracts: number;
  /** "15:55" or '' */
  flatBy: string;
  overnight: boolean;
  zeroDte: boolean;
}
export const CUSTOM_DEFAULTS: CustomRules = { size: 50_000, target: 0, dailyLoss: 0, dailyBreach: 'fail', drawdown: 0, drawdownMode: 'static', lockAtStart: true, minDays: 0, consistencyPct: 0, maxContracts: 0, flatBy: '', overnight: true, zeroDte: true };

/** A plan from the reader's own numbers: every 0 is a rule left off */
export function customPlan(c: CustomRules): PaperPlan {
  const rules: PropRules = {
    ...NO_RULES,
    phases: [{ name: 'Your target', target: c.target > 0 ? c.target : null }],
    dailyLoss: c.dailyLoss > 0 ? { amount: c.dailyLoss, from: 'balance', breach: c.dailyBreach } : null,
    drawdown: c.drawdown > 0 ? { amount: c.drawdown, mode: c.drawdownMode, lockAt: c.drawdownMode !== 'static' && c.lockAtStart ? 0 : null, on: 'equity' } : null,
    minDays: c.minDays > 0 ? c.minDays : null,
    consistency: c.consistencyPct > 0 ? { share: c.consistencyPct / 100, of: 'day', strict: false } : null,
    fee: HOUSE_FEE,
    maxContracts: c.maxContracts > 0 ? c.maxContracts : null,
    flatBy: /^\d{1,2}:\d{2}$/.test(c.flatBy) ? c.flatBy : null,
    overnight: c.overnight,
    zeroDte: c.zeroDte,
  };
  return { id: 'custom', label: `${Math.round(c.size / 1000)}K`, firm: null, program: 'Your own rules', size: c.size, rules, source: null };
}

/** "$25K" */
export const sizeWords = (n: number): string => (n >= 1000 && n % 1000 === 0 ? `$${(n / 1000).toLocaleString('en-US')}K` : `$${n.toLocaleString('en-US')}`);

const k = (n: number) => sizeWords(n);
/** A plan's rules in a few words each, for the chooser and the account's line */
export function planChips(plan: PaperPlan): string[] {
  const r = plan.rules;
  const out: string[] = [];
  const targets = r.phases.map(p => p.target).filter((t): t is number => t != null);
  if (targets.length) out.push(`target ${targets.map(t => `+${k(t)}`).join(' then ')}`);
  if (r.drawdown) out.push(`${r.drawdown.mode === 'static' ? 'max loss' : r.drawdown.mode === 'eod' ? 'EOD trailing' : 'intraday trailing'} ${k(r.drawdown.amount)}`);
  if (r.dailyLoss) out.push(`daily ${k(r.dailyLoss.amount)}${r.dailyLoss.breach === 'pause' ? ' (pauses the day)' : ''}`);
  if (r.minDays) out.push(`${r.minDays} days min`);
  if (r.consistency) out.push(`best ${r.consistency.of} ${r.consistency.strict ? '<' : '≤'} ${Math.round(r.consistency.share * 100)}% of profit`);
  if (r.minTrades) out.push(`${r.minTrades} trades min`);
  if (r.profitableDays) out.push(`${r.profitableDays.count} days of ${k(r.profitableDays.min)}+`);
  if (r.timeLimitDays) out.push(`${r.timeLimitDays} days to pass`);
  if (r.maxContracts) out.push(`${r.maxContracts} contracts max`);
  if (r.flatBy) out.push(`flat by ${r.flatBy} ET`);
  else if (!r.overnight) out.push('flat by the close');
  if (!r.zeroDte) out.push('no 0DTE');
  return out;
}
