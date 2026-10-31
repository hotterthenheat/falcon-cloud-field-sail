/* The prop firms a paper account can practise an evaluation of — options only — each plan as data for the rule
   engine (rules.ts), with the page its numbers were read from and the date they were read. Only numbers a firm's own
   page states are here; a rule the page does not state is off. The firm's own site governs: its rules change, and
   this page says when they were last read.

   The plain practice account is here too: no rules, cash is the only limit. And the reader's own rules, made from
   numbers the reader types (customPlan). */

import { NO_RULES, sellWords, type AllowSell, type DrawdownMode, type PaperPlan, type PropRules } from './rules';
import { HOUSE_FEE } from './engine';
import { OPTIONS_FUNDING_WHITELIST } from './whitelists';

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

/* ================================================================== */
/*  THE FIRMS — read off each firm's own pages on 2026-10-29           */
/* ================================================================== */

const AS_OF = '2026-10-29';
/** One program's plans: a size a row — [size, the target of each phase, the drawdown], the dollars as the firm's page
    states them for that size — on one set of rules */
function program(o: { firm: string; slug: string; name: string; source: string; rows: [number, number[], number][]; phases: string[]; rules: Partial<PropRules>; notModelled?: string[] }): PaperPlan[] {
  return o.rows.map(([size, targets, dd]) => ({
    id: `${o.slug}-${size / 1000}k`,
    label: `${size / 1000}K`,
    firm: o.firm,
    program: o.name,
    size,
    rules: {
      ...NO_RULES,
      ...o.rules,
      phases: o.phases.map((name, i) => ({ name, target: targets[i] ?? null })),
      drawdown: o.rules.drawdown ? { ...o.rules.drawdown, amount: dd } : null,
    },
    source: { url: o.source, asOf: AS_OF },
    notModelled: o.notModelled,
  }));
}
const ddOf = (mode: 'eod' | 'intraday', lockAt: number | null = null, on: 'equity' | 'balance' = 'equity') => ({ amount: 0, mode, lockAt, on });

/* Vanquish Trader (support.vanquishtrader.com, the help center's plan articles of 2026-10-18): one evaluation phase; the
   target on closed trades with everything closed; no daily loss limit (stated); flat by 15:59 ET every day, no
   overnight, no weekend; no commission stated. The Buffer lock is the funded account's, not the evaluation's. Basic,
   Rapid Express and Rapid Elite buy single calls and puts only; Advanced is Level 4 ("What Can I Trade?", article
   17655120: sell to open, verticals debit and credit, iron condors, butterflies, straddles and strangles, puts
   cash-secured only, covered calls, no margin) — and on SPX, XSP and VIX every plan buys single calls and puts only. */
const VQ_SIZES = (t: number, dd: number): [number, number[], number][] => [10_000, 50_000, 75_000, 100_000, 150_000].map(n => [n, [(n * t) / 100], (n * dd) / 100]);
const VQ_LONG_ONLY = ['SPX', 'XSP', 'VIX'];
const VQ_RULES: Partial<PropRules> = { targetOn: 'flat', markAt: 'mid', flatBy: '15:59', overnight: false, weekend: false, fee: null, spreads: false, allowSell: 'none', longOnlyOn: VQ_LONG_ONLY };
const VQ_NOTES = ['the exploit policy (illiquid far-out-of-the-money fills, oversized positions, micro-scalping) — the firm’s judgment, not a number'];
const VANQUISH: PropFirm = {
  id: 'vanquish',
  name: 'Vanquish Trader',
  url: 'https://support.vanquishtrader.com/en/',
  asOf: AS_OF,
  about: 'Options-only evaluations, one phase, intraday: everything is closed at 15:59 ET. No daily loss limit — the drawdown is the only loss rule.',
  plans: [
    ...program({ firm: 'Vanquish Trader', slug: 'vq-basic', name: 'Basic Options', source: 'https://support.vanquishtrader.com/en/articles/11835566-basic-options-plan-evaluation-rules-overview', phases: ['Evaluation'], rows: VQ_SIZES(10, 5), rules: { ...VQ_RULES, drawdown: ddOf('intraday'), consistency: { share: 0.3, of: 'trade', strict: true }, minTrades: 10 }, notModelled: VQ_NOTES }),
    ...program({ firm: 'Vanquish Trader', slug: 'vq-advanced', name: 'Advanced Options', source: 'https://support.vanquishtrader.com/en/articles/11585998-advanced-options-plan-evaluation-rules-overview', phases: ['Evaluation'], rows: VQ_SIZES(10, 5), rules: { ...VQ_RULES, spreads: true, allowSell: 'level4', drawdown: ddOf('eod'), minDays: 4, consistency: { share: 0.3, of: 'day', strict: true } }, notModelled: ['covered calls — they need 100 shares a contract, and this desk holds no stock, so none can be written here', 'a call sold on its own — the firm’s page does not say; with no margin it has no cap on its loss, so here a call is sold only as a spread or against a long call on the same expiry', ...VQ_NOTES] }),
    ...program({ firm: 'Vanquish Trader', slug: 'vq-rapid-express', name: 'Rapid Express', source: 'https://support.vanquishtrader.com/en/articles/17655270-rapid-express-plan-evaluation-rules-overview', phases: ['Evaluation'], rows: VQ_SIZES(9, 3), rules: { ...VQ_RULES, drawdown: ddOf('intraday') }, notModelled: VQ_NOTES }),
    ...program({ firm: 'Vanquish Trader', slug: 'vq-rapid-elite', name: 'Rapid Elite', source: 'https://support.vanquishtrader.com/en/articles/17655328-rapid-elite-plan-evaluation-rules-overview', phases: ['Evaluation'], rows: VQ_SIZES(9, 3), rules: { ...VQ_RULES, drawdown: ddOf('eod'), consistency: { share: 0.5, of: 'day', strict: true } }, notModelled: VQ_NOTES }),
  ],
};

/* Options Funding (optionsfunding.co/rules): buy-only single-leg calls and puts on new Growth and Express accounts; the
   target on the balance; open contracts valued at the bid; no daily loss limit published; overnight allowed;
   $0.65 a contract a leg each side (the FAQ's "Is there a commission on trades?",
   https://optionsfunding.co/faq/accounts-and-billing#trading-commission, read 2026-10-31: "Every options trade is
   charged a flat $0.65 per contract, on every leg, both when you open and when you close … no minimum, no cap, and no
   other per-trade fee. The commission comes out of your trading account balance … so it counts toward your profit and
   loss and your drawdown." The rules page itself states no figure); an expiring position is closed at 15:55 ET on its day — 16:10 ET for SPY, QQQ, IWM,
   DIA, whose options trade to 16:15: closed then at the live bid; the 275 names of its ticker whitelist only
   (whitelists.ts, read 2026-10-29). */
const LATE = ['SPY', 'QQQ', 'IWM', 'DIA'];
const OF_LIST = OPTIONS_FUNDING_WHITELIST;
const OF_RULES: Partial<PropRules> = { targetOn: 'balance', markAt: 'bid', fee: 0.65, spreads: false, allowSell: 'none', overnight: true, weekend: true, expiryClose: { at: '15:55', except: LATE, lateAt: '16:10' }, underlyings: OF_LIST.names, underlyingsSource: { url: OF_LIST.url, asOf: OF_LIST.asOf, says: OF_LIST.says } };
const OPTIONS_FUNDING: PropFirm = {
  id: 'options-funding',
  name: 'Options Funding',
  url: 'https://optionsfunding.co/rules',
  asOf: AS_OF,
  about: 'One evaluation phase on live NBBO, buy-only on new Growth and Express accounts, positions may be held overnight, 275 names on its whitelist. Pro is not offered here: it passes on a risk-adjusted “eligible profit” this desk does not work out.',
  plans: [
    ...program({ firm: 'Options Funding', slug: 'of-growth', name: 'Growth', source: 'https://optionsfunding.co/rules', phases: ['Evaluation'], rows: [[25_000, [3_000], 1_500], [50_000, [6_000], 3_000], [100_000, [12_000], 6_000]], rules: { ...OF_RULES, drawdown: ddOf('eod') } }),
    ...program({ firm: 'Options Funding', slug: 'of-express', name: 'Express', source: 'https://optionsfunding.co/rules', phases: ['Evaluation'], rows: [[25_000, [2_500], 1_250], [50_000, [5_000], 2_500], [100_000, [10_000], 5_000]], rules: { ...OF_RULES, drawdown: ddOf('intraday') } }),
  ],
};

/* Strix Options Funding (strixoptionsfunding.com/#/rules): the same platform as Options Funding, its own numbers; the
   target on the balance; no daily loss limit published; overnight and weekend holds allowed; no commission stated;
   expiring positions closed at 15:55 ET (16:10 ET for SPY, QQQ, IWM, DIA, at the live bid). Strix and Express buy single
   calls and puts only ("opening any short leg, including one inside a debit spread, requires Strix Pro"); Strix Pro
   adds "supported finite-loss selling" — credit and debit spreads, and an unlimited-loss short call only with a hedge on
   the same root and expiry. Its whitelist is its own (assets/data/tickers.json), not read here. */
const SX_RULES: Partial<PropRules> = { targetOn: 'balance', markAt: 'mid', fee: null, spreads: false, allowSell: 'none', overnight: true, weekend: true, expiryClose: { at: '15:55', except: LATE, lateAt: '16:10' } };
const SX_NOTES = ['the firm’s own 275-name approved whitelist — its list was not read here, so the names are not checked: trade only names on the firm’s list'];
const STRIX: PropFirm = {
  id: 'strix',
  name: 'Strix Options Funding',
  url: 'https://strixoptionsfunding.com/#/rules',
  asOf: AS_OF,
  about: 'One evaluation phase that never expires, long calls and puts (Strix Pro adds finite-loss selling), overnight and weekend holds allowed.',
  plans: [
    ...program({ firm: 'Strix Options Funding', slug: 'sx-strix', name: 'Strix', source: 'https://strixoptionsfunding.com/#/rules', phases: ['Evaluation'], rows: [[10_000, [1_200], 600], [25_000, [3_000], 1_500], [50_000, [6_000], 3_000], [100_000, [12_000], 6_000]], rules: { ...SX_RULES, drawdown: ddOf('eod') }, notModelled: SX_NOTES }),
    ...program({ firm: 'Strix Options Funding', slug: 'sx-express', name: 'Express', source: 'https://strixoptionsfunding.com/#/rules', phases: ['Evaluation'], rows: [[10_000, [800], 400], [25_000, [2_000], 1_000], [50_000, [4_000], 2_000], [100_000, [8_000], 4_000]], rules: { ...SX_RULES, drawdown: ddOf('intraday') }, notModelled: SX_NOTES }),
    ...program({ firm: 'Strix Options Funding', slug: 'sx-pro', name: 'Strix Pro', source: 'https://strixoptionsfunding.com/#/rules', phases: ['Evaluation'], rows: [[10_000, [1_200], 600], [25_000, [3_000], 1_500], [50_000, [6_000], 3_000], [100_000, [12_000], 6_000]], rules: { ...SX_RULES, spreads: true, allowSell: 'definedRisk', drawdown: ddOf('eod') }, notModelled: SX_NOTES }),
  ],
};

/* TradeFundrr (its help center's Pre-Prop and Prop articles, Oct 2026): $25K only; $1,250 and five sessions of $250 or
   more; no session over 30% of the target (a session over $375 raises it to that session ÷ 0.30); a $1,000 daily
   limit on realized and unrealized P&L that is a soft breach; a $3,000 end-of-day drawdown on the realized balance
   that stops at the starting balance; flat by 15:55 ET; $0.30 a contract each side; a winner held 15 seconds or less
   does not count.
   The commission, read 2026-10-31: the Pre-Prop and Prop FAQ "What are the commissions?" (modified 5 Oct 2026,
   https://tradefundrr.freshdesk.com/support/solutions/articles/202000125615-what-are-the-commissions-) says "Options:
   Commissions are $0.30 per contract, per side." The legacy-program articles say the same (202000119016, modified 26 Jun;
   202000093116). The tiered $0.65 / $0.55 / $0.45 schedule was on tradefundrr.com/tradefundrr-fees-and-pricing-2/, a page
   that names no program; it answers 404 on 2026-10-31 and is not in the site's sitemap, so it is not modelled. The
   options pages (/options-trader-funding/pre-prop/, /prop/) state no figure ("Trading commissions affect your net
   profit"). The June-2026 contract caps are not confirmed for these programs and are left out. */
const TF_RULES: Partial<PropRules> = {
  targetOn: 'balance',
  markAt: 'mid',
  fee: 0.3,
  dailyLoss: { amount: 1_000, from: 'balance', breach: 'pause' },
  drawdown: ddOf('eod', 0, 'balance'),
  profitableDays: { count: 5, min: 250 },
  consistency: { share: 0.3, of: 'day', strict: false },
  minHoldSec: 15,
  buyingPower: 25_000,
  flatBy: '15:55',
  overnight: false,
  weekend: false,
};
const TF_NOTES = ['the commission is the firm’s Pre-Prop and Prop help article (“Options: Commissions are $0.30 per contract, per side”, modified 5 Oct 2026, read 2026-10-31); a tiered $0.65 / $0.55 / $0.45 schedule once on its fees page is no longer published and is not used', 'what a daily-limit soft breach does is not stated by the firm — here it closes everything and ends the day, never the account', 'strategy permissions are not stated for these programs — this desk buys calls, puts and debit spreads'];
const TRADEFUNDRR: PropFirm = {
  id: 'tradefundrr',
  name: 'TradeFundrr',
  url: 'https://tradefundrr.com/options-trader-funding/',
  asOf: AS_OF,
  about: 'A $25K options program, intraday only (09:30–15:55 ET). Rules from its current help-center articles; some details are not published for these programs, and are marked.',
  plans: [
    /* each step is its own $3,000 drawdown from the balance it starts at: the firm's options page says passing Pre-Prop
       "promotes you to a funded Prop account" (a new $25K account, sold separately), so the Prop step starts fresh rather
       than carrying the Pre-Prop floor on. The firm does not state it in so many words; it is marked below. */
    ...program({ firm: 'TradeFundrr', slug: 'tf-preprop', name: 'Pre-Prop', source: 'https://tradefundrr.freshdesk.com/support/solutions/articles/202000125619-what-is-the-profit-target-', phases: ['Pre-Prop step', 'Prop step'], rows: [[25_000, [1_250, 1_250], 3_000]], rules: { ...TF_RULES, drawdown: { ...ddOf('eod', 0, 'balance'), perPhase: true } }, notModelled: [...TF_NOTES, 'the Prop step starts a fresh $3,000 drawdown from $25,000: passing Pre-Prop opens a new Prop account; the firm does not say in so many words that the loss limit resets'] }),
    ...program({ firm: 'TradeFundrr', slug: 'tf-prop', name: 'Prop', source: 'https://tradefundrr.freshdesk.com/support/solutions/articles/202000125619-what-is-the-profit-target-', phases: ['Payout qualification'], rows: [[25_000, [1_250], 3_000]], rules: TF_RULES, notModelled: TF_NOTES }),
  ],
};

/** The firms with an options evaluation this desk can hold to their rules, as their own pages state them. Left out:
    Options Funding Pro (passes on a risk-adjusted "eligible profit", and trades by selling), and Imperial Trader
    Funding (its own pages contradict each other). */
export const PROP_FIRMS: PropFirm[] = [VANQUISH, OPTIONS_FUNDING, STRIX, TRADEFUNDRR];

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
  /** What may be sold to open — everything by default (the reader's own account) */
  selling: AllowSell;
}
export const CUSTOM_DEFAULTS: CustomRules = { size: 50_000, target: 0, dailyLoss: 0, dailyBreach: 'fail', drawdown: 0, drawdownMode: 'static', lockAtStart: true, minDays: 0, consistencyPct: 0, maxContracts: 0, flatBy: '', overnight: true, zeroDte: true, selling: 'all' };

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
    allowSell: c.selling ?? 'all',
  };
  return { id: 'custom', label: `${Math.round(c.size / 1000)}K`, firm: null, program: 'Your own rules', size: c.size, rules, source: null };
}

/** What a plan lets be sold, in two words: "Buy only" · "Defined-risk selling" · "Level 4" · "Free reign" (none: the
    practice account) */
export const planSellWords = (plan: PaperPlan | undefined | null): string => sellWords(plan ? (plan.rules.allowSell ?? 'none') : 'all');

/** "$25K" */
export const sizeWords = (n: number): string => (n >= 1000 && n % 1000 === 0 ? `$${(n / 1000).toLocaleString('en-US')}K` : `$${n.toLocaleString('en-US')}`);

const k = (n: number) => sizeWords(n);
/** A plan's rules in a few words each, for the chooser and the account's line */
export function planChips(plan: PaperPlan, share = false): string[] {
  const r = plan.rules;
  const out: string[] = [];
  /* `share`: a program's line, the same for every size — the dollars as a share of the size */
  const amt = (v: number) => (share ? `${+((v / plan.size) * 100).toFixed(2)}%` : k(v));
  const targets = r.phases.map(p => p.target).filter((t): t is number => t != null);
  if (targets.length) out.push(`target +${targets.map(amt).join(', then +')}`);
  if (r.drawdown) out.push(`${r.drawdown.mode === 'static' ? 'max loss' : r.drawdown.mode === 'eod' ? 'end-of-day drawdown' : 'intraday drawdown'} ${amt(r.drawdown.amount)}`);
  if (r.dailyLoss) out.push(`daily loss ${amt(r.dailyLoss.amount)}${r.dailyLoss.breach === 'pause' ? ' (pauses the day)' : ''}`);
  else if (plan.firm) out.push('no daily loss limit');
  if (r.minDays) out.push(`${r.minDays} trading days`);
  if (r.consistency) out.push(`best ${r.consistency.of} ${r.consistency.strict ? 'under' : 'at most'} ${Math.round(r.consistency.share * 100)}%`);
  if (r.minTrades) out.push(`${r.minTrades} trades`);
  if (r.profitableDays) out.push(`${r.profitableDays.count} days of ${k(r.profitableDays.min)}+`);
  if (r.minHoldSec) out.push(`wins held over ${r.minHoldSec}s`);
  if (r.timeLimitDays) out.push(`${r.timeLimitDays} days to pass`);
  if (r.maxContracts) out.push(`${r.maxContracts} contracts max`);
  if (r.flatBy) out.push(`flat by ${r.flatBy} ET`);
  else if (!r.overnight) out.push('flat by the close');
  else if (plan.firm) out.push('overnight allowed');
  out.push(r.allowSell === 'none' ? (r.spreads ? 'buy only · debit spreads' : 'buy only · calls and puts') : r.allowSell === 'all' ? 'selling allowed, naked included' : r.allowSell === 'level4' ? 'Level 4 · cash-secured puts, spreads, condors' : 'defined-risk selling');
  if (r.longOnlyOn?.length) out.push(`${r.longOnlyOn.join(', ')} single legs bought`);
  if (r.underlyings) out.push(r.underlyings.length > 12 ? `${r.underlyings.length} names` : r.underlyings.join(', '));
  if (!r.zeroDte) out.push('no 0DTE');
  if (plan.firm) out.push(r.fee == null ? 'no commission stated' : `$${r.fee.toFixed(2)} a contract`);
  return out;
}
