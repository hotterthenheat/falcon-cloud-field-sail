/* Your risk budget a Compass call (owner, 2026-11-07: "you bought a super expensive con for SPXW… we need to be smart
   with the r/r on a con"; "cap a 5 per con but it should make sense"). Dollars you will put at risk on one call: $500
   unless you change it (Settings › The desk › Compass budget). It is yours, on this machine, and it never changes which
   contract Compass calls or whether it calls: the engine calls the contract that makes the most sense to risk
   (compassCost), and this only says how many of it your budget buys, and, when not one does, the next-best way into the
   same call that fits (the XSP contract for an SPX call, or another strike the rule allowed, by its cost per payoff).
   Compass's own record stays one contract a call. */

import { useSyncExternalStore } from 'react';
import type { CostAlt } from './compassCost';

export const BUDGET_DEFAULT = 500;
/** A budget you can type: $1 to $1,000,000 */
export const BUDGET_MIN = 1;
export const BUDGET_MAX = 1_000_000;
const KEY = 'slayer_compass_budget';

/** A typed budget in dollars, or null when it is not one ("$1,500" and "1500" read 1500) */
export function parseBudget(text: string): number | null {
  const n = Number(String(text).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole >= BUDGET_MIN && whole <= BUDGET_MAX ? whole : null;
}

let budget: number = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (parseBudget(raw) ?? BUDGET_DEFAULT) : BUDGET_DEFAULT;
  } catch {
    return BUDGET_DEFAULT;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function setBudget(dollars: number): void {
  const next = parseBudget(String(dollars));
  if (next == null) return;
  budget = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    /* storage off: the budget lives for the session */
  }
  listeners.forEach(fn => fn());
}

export const readBudget = (): number => budget;
export const useBudget = (): number => useSyncExternalStore(subscribe, readBudget, () => BUDGET_DEFAULT);

/** Contracts the budget buys at an ask (a contract is 100 shares): 0 when not one fits */
export function sizeFor(ask: number, dollars: number): number {
  if (!(ask > 0) || !(dollars > 0)) return 0;
  return Math.floor((dollars + 1e-9) / (ask * 100));
}

const usd = (v: number) => `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`;

export interface BudgetRead {
  /** Contracts of the call the budget buys */
  size: number;
  /** When not one fits: the first alternative that does (the call's own order: the mini, then the next-best strikes) */
  fit: CostAlt | null;
  line: string;
  hover: string;
}

/** The card's budget line for a call at `ask` with its alternatives (CostMark.alts): "Sized to your $500 budget ·
    3 contracts", or "Sized to your $500 budget · next best that fits: XSP 757P". */
export function budgetRead(ask: number, alts: readonly CostAlt[] | undefined, dollars: number): BudgetRead | null {
  if (!(ask > 0) || !(dollars > 0)) return null;
  const per = ask * 100;
  const size = sizeFor(ask, dollars);
  const head = `Sized to your ${usd(dollars)} budget`;
  if (size >= 1) {
    return {
      size,
      fit: null,
      line: `${head} · ${size} contract${size === 1 ? '' : 's'} (${usd(size * per)})`,
      hover: `One contract costs ${usd(per)} at the call's ask; your budget of ${usd(dollars)} a call buys ${size}. The budget only sizes: it never changes which contract is called. Change it in Settings › The desk.`,
    };
  }
  const fit = (alts ?? []).find(a => a.ask > 0 && a.ask * 100 <= dollars + 1e-9) ?? null;
  return {
    size: 0,
    fit,
    line: fit ? `${head} · next best that fits: ${fit.contract}` : `${head} · one contract is ${usd(per)}; nothing smaller in this call fits`,
    hover: [
      `One contract costs ${usd(per)} at the call's ask, over your ${usd(dollars)} budget, so the call is not sized down to a fraction.`,
      fit
        ? fit.kind === 'mini'
          ? `${fit.contract} is the same call at a tenth of the size: ${usd(fit.ask * 100)} a contract.`
          : `${fit.contract} is the next contract the rule allowed, by what it needs to pay back its cost: ${usd(fit.ask * 100)} a contract.`
        : 'No smaller contract was quoted on this call.',
      'The budget only sizes: it never changes which contract is called. Change it in Settings › The desk.',
    ].join(' '),
  };
}
