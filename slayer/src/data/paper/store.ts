/* The reader's paper accounts, kept in localStorage: one tab holds them at a time, a beat works every open account's
   orders against the live quotes, and every change goes through the engine. Any number of accounts run side by side
   — plain practice ones and prop-firm evaluations (rules.ts) — each opened at its own address
   (/practice/paper/:accountId). Options only.

   The public face the journal reads: `usePaper()` / `readPaper()` → { accounts: PaperAccount[], inHand, holding,
   elsewhere }, each account with id, name, kind ('practice' | 'evaluation'), plan (an evaluation's PaperPlan: firm,
   label, size, rules), status ('open' | 'passed' | 'failed' | 'ended') and archived. */

import { useSyncExternalStore } from 'react';
import { EMBEDDED, PHOTO } from '../../embed';
import { chime } from '../../core/sound';
import { contractKey, type ContractId, type Quote } from '../review/quotes';
import type { DayNote, JournalEntry } from '../review/journal';
import { LIFE, SIM_FEED, barNowOf, candlesOf, optionFresh, optionQuote, optionQuoteAt, optionsOpen, spotForBidNow } from './feed';
import { bellOf, nyAt } from './clock';
import { closePrintOf, ensureBars } from '../review/history';
import { canCatchUp, fetchGaps, hasGaps, replayGaps } from './catchUp';
import { whalesEarnings } from '../whales';
import {
  afterHand,
  closeStale,
  endAccount,
  flattenAll,
  flattenByHand,
  newAccount,
  optAmend,
  optAttach,
  optCancel,
  optClose,
  optPlace,
  optPlaceCombo,
  optRebase,
  optSetBreakeven,
  optSetTrail,
  retireFutures,
  tick,
  type ComboDraft,
  type OptDraft,
  type PaperAccount,
  type PaperEvent,
  type PaperMarket,
} from './engine';
import { NO_RULES, rulesOf, type EarningsWhen, type PaperPlan } from './rules';
import { planById, sizeWords } from './propFirms';

const KEY = 'slayer_paper_v1';
/* How often working orders are checked against the live quotes */
const TICK_MS = 2_000;
const SIMULATED_TAG = ' · simulated prices';
const JOURNAL_KEY = 'slayer_paper_journal_v1';
const LEASE_KEY = 'slayer_paper_lease_v1';
/** A lease is good for this long, and renewed this often */
const LEASE_MS = 8_000;
const RENEW_MS = 2_500;
/** A tick that only moved what is open is written a moment later; a fill, at once */
const SAVE_SOON_MS = 2_000;

/* ================================================================== */
/* The earnings calendar a plan that forbids holding through a report reads (Unusual Whales: ThetaData carries none) */
/* ================================================================== */

const earnings = new Map<string, EarningsWhen>();
const earnAsked = new Map<string, number>();
const EARN_RETRY_MS = 10 * 60_000;
/** When a name next reports — undefined until the calendar has answered (asked once, on first want) */
function earningsOf(ticker: string): EarningsWhen | undefined {
  const t = ticker.toUpperCase();
  if (earnings.has(t)) return earnings.get(t);
  const now = Date.now();
  if (typeof window !== 'undefined' && now - (earnAsked.get(t) ?? 0) > EARN_RETRY_MS) {
    earnAsked.set(t, now);
    const today = nyAt(now).date;
    whalesEarnings(t)
      .then(rows => {
        const next = (Array.isArray(rows) ? rows : [])
          .map(r => ({ date: String(r.report_date ?? '').slice(0, 10), time: String(r.report_time ?? '') }))
          .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date >= today)
          .sort((x, y) => x.date.localeCompare(y.date))[0];
        earnings.set(t, next ? { date: next.date, slot: /pre|bmo|before/i.test(next.time) ? 'BMO' : /post|after|amc/i.test(next.time) ? 'AMC' : null } : null);
      })
      .catch(() => undefined);
  }
  return undefined;
}

/* ================================================================== */
/* The live market */
/* ================================================================== */

/** The market as the feed has it now — what every engine call on this machine is handed. A contract asked for twice in one
    call is priced once. */
export function liveMarket(now = Date.now()): PaperMarket {
  const quotes = new Map<string, Quote>();
  return {
    now,
    life: LIFE,
    optQuote: (c: ContractId) => {
      const k = contractKey(c);
      let q = quotes.get(k);
      if (!q) quotes.set(k, (q = optionQuote(c, now)));
      return q;
    },
    optQuoteAt: (c: ContractId, spot: number) => optionQuoteAt(c, now, spot),
    bar: (ticker: string) => barNowOf(ticker),
    candles: (ticker: string) => candlesOf(ticker),
    open: () => optionsOpen(now),
    fresh: (c: ContractId) => optionFresh(c, now),
    earnings: earningsOf,
    /* The 16:00 closing print when ThetaData recorded one; otherwise the last real print — never the 15:59 bar, and
       never a flat zero-volume candle. Settlement waits until a minute and a half after the bell, so the print can land. */
    closeOf: (ticker: string, day: string) => {
      if (now < bellOf(day) + 90_000) return NaN;
      void ensureBars(ticker, day);
      return closePrintOf(ticker, day);
    },
  };
}

/* ================================================================== */
/*  THE ACCOUNTS                                                       */
/* ================================================================== */

interface PaperState {
  accounts: PaperAccount[];
  /** The account last opened on a desk (the journal's default) */
  inHand: string | null;
  /** This tab holds the accounts (and so may trade them) */
  holding: boolean;
  /** …and when it does not, another tab does */
  elsewhere: boolean;
}
const isAccount = (v: unknown): v is PaperAccount => {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.id === 'string' && typeof a.startCash === 'number' && typeof a.opt === 'object' && typeof a.ledger === 'object';
};
/** An account as saved by an older version, made to fit this one: a futures plan (no `rules`) is kept as a legacy plan,
    and what it held in futures is closed at the last price it saw (engine.ts retireFutures) */
function migrate(a: PaperAccount): PaperAccount {
  let x: PaperAccount = { ...a, fut: a.fut && typeof a.fut === 'object' ? { orders: a.fut.orders ?? [], fills: a.fut.fills ?? [] } : { orders: [], fills: [] } };
  const plan = x.plan as (PaperPlan & { target?: number }) | undefined;
  if (plan && !plan.rules) x = { ...x, plan: { id: `legacy-${plan.label ?? 'futures'}`, label: plan.label ?? '', firm: null, program: 'A futures evaluation', size: plan.size ?? x.startCash, rules: NO_RULES, source: null, legacy: 'futures' } };
  /* a firm plan saved before selling, the whitelist and the 16:10 close were checked: what the firm lets be traded is
     read from its plan as published now (its numbers stay as they were when the account began) */
  const now = x.plan && x.plan.firm && x.plan.rules && x.plan.rules.allowSell == null ? planById(x.plan.id) : null;
  if (now && x.plan) {
    const r = now.rules;
    x = { ...x, plan: { ...x.plan, notModelled: now.notModelled, rules: { ...x.plan.rules, allowSell: r.allowSell, longOnlyOn: r.longOnlyOn, noSpreadsOn: r.noSpreadsOn, spreads: r.spreads, underlyings: r.underlyings, underlyingsSource: r.underlyingsSource, expiryClose: r.expiryClose } } };
  }
  return retireFutures(x, Date.now());
}
function load(): Pick<PaperState, 'accounts' | 'inHand'> {
  if (typeof localStorage === 'undefined' || EMBEDDED) return { accounts: [], inHand: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { accounts?: unknown[]; inHand?: string | null } | null;
    const kept = Array.isArray(raw?.accounts) ? raw!.accounts.filter(isAccount) : [];
    /* an account traded on the old simulated feed is not kept: its prices were never the market's */
    const accounts = kept.filter(a => a.feed === 'live' && !a.name.endsWith(SIMULATED_TAG)).map(migrate);
    const inHand = typeof raw?.inHand === 'string' && accounts.some(a => a.id === raw.inHand) ? raw.inHand : (accounts.find(a => a.status === 'open')?.id ?? null);
    return { accounts, inHand };
  } catch {
    return { accounts: [], inHand: null };
  }
}
let state: PaperState = { ...load(), holding: false, elsewhere: false };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

let saveTimer: number | undefined;
let full = false;
const save = () => {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (EMBEDDED || typeof localStorage === 'undefined' || !state.holding) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ accounts: state.accounts, inHand: state.inHand }));
    full = false;
  } catch {
    /* full or unavailable: the accounts run on for this visit — said once, not every tick */
    if (!full) console.warn('Paper: the browser’s storage is full — the accounts run on for this visit, unsaved');
    full = true;
  }
};
const commit = (next: Partial<PaperState>, urgent = false) => {
  state = { ...state, ...next };
  notify();
  if (!state.holding) return;
  if (urgent) save();
  /* AT MOST every SAVE_SOON_MS, never "a moment after the last change": the feed changes things every tick and a timer reset
     on each would never come due while anything is open */
  else if (saveTimer === undefined) saveTimer = window.setTimeout(save, SAVE_SOON_MS);
};
const replace = (a: PaperAccount): PaperAccount[] => state.accounts.map(x => (x.id === a.id ? a : x));

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => state;
/** Every paper account, the one last on a desk, and whether this tab holds them */
export const usePaper = (): PaperState => useSyncExternalStore(subscribe, snapshot, snapshot);
export const readPaper = (): PaperState => state;

/* ================================================================== */
/* One tab at a time */
/* ================================================================== */

const TAB = `${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`;
interface Lease {
  tab: string;
  until: number;
}
const readLease = (): Lease | null => {
  try {
    const l = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as Lease | null;
    return l && typeof l.tab === 'string' && typeof l.until === 'number' ? l : null;
  } catch {
    return null;
  }
};
/** Hold the accounts if nobody else does (or `force`: take them) — true when this tab holds them after */
function holdLease(force = false): boolean {
  /* the photographer's window holds its throwaway account without a lease — nothing of the visitor's is at stake */
  if (PHOTO) return true;
  if (EMBEDDED || typeof localStorage === 'undefined') return false;
  const l = readLease();
  const now = Date.now();
  if (!force && l && l.tab !== TAB && l.until > now) return false;
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: TAB, until: now + LEASE_MS }));
  } catch {
    /* storage off: this tab runs the accounts for its own visit */
  }
  return true;
}
const releaseLease = () => {
  const l = readLease();
  if (l?.tab !== TAB) return;
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: TAB, until: 0 }));
  } catch {
    /* nothing to release into */
  }
};
/** Take the accounts over from the tab that holds them: what it left open stays open, judged here from the next tick */
export function takeHere(): void {
  if (EMBEDDED) return;
  const fresh = load();
  holdLease(true);
  staleDone = false;
  commit({ ...fresh, holding: true, elsewhere: false }, true);
}

/* ================================================================== */
/* The fill alerts */
/* ================================================================== */

export interface PaperToast {
  id: string;
  at: number;
  kind: PaperEvent['kind'];
  words: string;
  pnl?: number;
  /** The account it happened on — its name, where the reader has more than one */
  account: string;
}
let toasts: PaperToast[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
const say = (list: PaperToast[]) => {
  if (!list.length) return;
  toasts = [...list, ...toasts].slice(0, 12);
  toastListeners.forEach(fn => fn());
  chime();
};
export const usePaperToasts = (): PaperToast[] =>
  useSyncExternalStore(
    fn => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toasts,
    () => toasts
  );

/* ================================================================== */
/*  THE RUNNER                                                         */
/* ================================================================== */

let staleDone = false;
/** Every open account, on this tick */
function tickAll(m: PaperMarket): void {
  let changed = false;
  let urgent = false;
  const heard: PaperToast[] = [];
  const many = state.accounts.filter(a => a.status === 'open').length > 1;
  const accounts = state.accounts.map(a => {
    let next = a;
    if (!staleDone && SIM_FEED) next = closeStale(next, m);
    if (next.status !== 'open') return next;
    const r = tick(next, m);
    for (const e of r.events) {
      if (e.kind === 'roll') continue;
      heard.push({ id: `t${++toastSeq}`, at: e.at, kind: e.kind, words: e.words, pnl: e.pnl, account: many ? a.name : '' });
      urgent = true;
    }
    if (r.account !== a) changed = true;
    return r.account;
  });
  if (!staleDone) {
    staleDone = true;
    urgent = true;
  }
  if (changed) commit({ accounts }, urgent);
  say(heard);
}

/* ---- the minutes a working order missed (catchUp.ts): fetched off the beat, replayed on the account as it then stands ---- */
let catching = false;
const triedAt = new Map<string, number>();
const RETRY_MS = 30_000;
async function catchUpAll(): Promise<void> {
  if (catching || !state.holding || !canCatchUp()) return;
  const now = Date.now();
  const due = state.accounts.filter(a => hasGaps(a, now) && now - (triedAt.get(a.id) ?? 0) > RETRY_MS);
  if (!due.length) return;
  catching = true;
  try {
    for (const a of due) {
      triedAt.set(a.id, now);
      const fetched = await fetchGaps(a, now);
      const live = state.accounts.find(x => x.id === a.id);
      if (!live || !state.holding) continue;
      const at = Date.now();
      const m = liveMarket(at);
      const next = afterHand(live, replayGaps(live, fetched, at, LIFE), m);
      if (next !== live) commit({ accounts: replace(next) }, true);
    }
  } finally {
    catching = false;
  }
}

let started = false;
/** Start the runner — once, from the app's shell. Returns the way to stop it. */
export function startPaperRunner(): () => void {
  if (started || (EMBEDDED && !PHOTO) || typeof window === 'undefined') return () => undefined;
  started = true;
  const holding = holdLease();
  commit({ holding, elsewhere: !holding });
  /* the working orders are judged on this beat against the live quotes */
  const beat = window.setInterval(() => {
    if (!state.holding || !state.accounts.length) return;
    tickAll(liveMarket());
    void catchUpAll();
  }, TICK_MS);
  const offTick = () => window.clearInterval(beat);
  /* the lease: kept while this tab holds it; a tab that loses it (taken over) stops trading and reads what the other writes */
  const renew = window.setInterval(() => {
    if (state.holding) {
      const l = readLease();
      if (l && l.tab !== TAB && l.until > Date.now()) commit({ holding: false, elsewhere: true, ...load() });
      else holdLease();
    } else if (holdLease()) {
      /* the other tab let go (it closed): this one holds them now — fresh from storage */
      staleDone = false;
      commit({ ...load(), holding: true, elsewhere: false }, true);
    }
  }, RENEW_MS);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && !state.holding) commit(load());
    if (e.key === JOURNAL_KEY) {
      journal = loadJournal();
      journalListeners.forEach(fn => fn());
    }
  };
  /* The page closes: what is kept is written, and the lease is let go (the simulated feed also closed what was open) */
  const onHide = () => {
    if (!state.holding) return;
    if (SIM_FEED) {
      const m = liveMarket();
      const accounts = state.accounts.map(a => (a.status === 'open' ? afterHand(a, flattenAll(a, m, 'page', 'the page closed'), m) : a));
      state = { ...state, accounts };
    }
    save();
    releaseLease();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pagehide', onHide);
  return () => {
    offTick();
    window.clearInterval(renew);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pagehide', onHide);
    started = false;
  };
}

/* ================================================================== */
/* What the reader does on a desk */
/* ================================================================== */

/** A change by the reader's hand, through the engine, on the live market — nothing when this tab does not hold the accounts */
function act(id: string, fn: (a: PaperAccount, m: PaperMarket) => PaperAccount): boolean {
  if (!state.holding) return false;
  const a = state.accounts.find(x => x.id === id);
  if (!a) return false;
  const m = liveMarket();
  const next = afterHand(a, fn(a, m), m);
  if (next === a) return false;
  commit({ accounts: replace(next) }, true);
  return true;
}
export const placeOptOrder = (id: string, d: OptDraft) => act(id, (a, m) => optPlace(a, m, d));
/** An order of several legs (an iron condor: two spreads sold as one) — they fill together or not at all */
export const placeComboOrder = (id: string, d: ComboDraft) => act(id, (a, m) => optPlaceCombo(a, m, d));
/** Every working order at once — the account's, or one contract's (what a cancel takes with it goes the way a single
    cancel would take it) */
export const cancelWorking = (id: string, only?: { contract?: string }) =>
  act(id, (a, m) => {
    let x = a;
    for (const o of a.opt.orders) if (o.status === 'working' && (!only || (only.contract != null && contractKey(o.contract) === only.contract))) x = optCancel(x, m, o.id);
    return x;
  });
export const cancelOrder = (id: string, orderId: string) => act(id, (a, m) => optCancel(a, m, orderId));
export const amendOrder = (id: string, orderId: string, price: number) => act(id, (a, m) => optAmend(a, m, orderId, price));
export const attachOpt = (id: string, c: ContractId, kind: 'target' | 'stop', price: number, on?: 'name') => act(id, (a, m) => optAttach(a, m, c, kind, price, on));
export const trailOrder = (id: string, orderId: string, on: boolean, by?: number) => act(id, (a, m) => optSetTrail(a, m, orderId, on, by));
export const breakevenOrder = (id: string, orderId: string, on: boolean) => act(id, (a, m) => optSetBreakeven(a, m, orderId, on));
export const rebaseOrder = (id: string, orderId: string, to: 'name' | 'contract') => act(id, (a, m) => optRebase(a, m, orderId, to, (c, bid) => spotForBidNow(c, m.now, bid)));
export const closeOpt = (id: string, c: ContractId, qty: number) => act(id, (a, m) => optClose(a, m, c, qty));
/** Flat, now: everything open closed at the market, everything working cancelled */
export const flattenAccount = (id: string) => act(id, (a, m) => flattenByHand(a, m));

/* ================================================================== */
/* The accounts themselves: start, name, start over, archive, end, delete */
/* ================================================================== */

const newId = () => `a${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
/** The next free "#n" after a base name — "Practice $25K #2" — counting every account kept, archived ones too */
export function nextName(base: string, accounts: PaperAccount[] = state.accounts): string {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #(\\d+)$`);
  let n = 0;
  for (const a of accounts) {
    const m = re.exec(a.name);
    if (m) n = Math.max(n, Number(m[1]));
    else if (a.name === base) n = Math.max(n, 1);
  }
  return `${base} #${n + 1}`;
}
/** What an account on a plan is called before the number */
export const baseNameOf = (plan: PaperPlan | null, size: number): string => (plan ? `${plan.firm ?? 'Your rules'}${plan.firm && plan.program ? ` ${plan.program}` : ''} ${sizeWords(plan.size)}` : `Practice ${sizeWords(size)}`);

/** A practice account of the size chosen — beside every other one. Returns its id (null where this tab cannot). */
export function startPractice(size: number): string | null {
  if (!state.holding) return null;
  const now = Date.now();
  const a = newAccount({ id: newId(), kind: 'practice', name: nextName(baseNameOf(null, size)), startCash: size, now });
  commit({ accounts: [a, ...state.accounts], inHand: a.id }, true);
  return a.id;
}
/** An evaluation on a firm's plan, or on the reader's own rules — beside every other account */
export function startPlan(plan: PaperPlan): string | null {
  if (!state.holding || plan.legacy) return null;
  const now = Date.now();
  const a = newAccount({ id: newId(), kind: 'evaluation', name: nextName(baseNameOf(plan, plan.size)), startCash: plan.size, plan, now });
  commit({ accounts: [a, ...state.accounts], inHand: a.id }, true);
  return a.id;
}
export const setInHand = (id: string) => state.accounts.some(a => a.id === id) && state.inHand !== id && commit({ inHand: id }, true);

const patch = (id: string, fn: (a: PaperAccount) => PaperAccount): boolean => {
  if (!state.holding) return false;
  const a = state.accounts.find(x => x.id === id);
  if (!a) return false;
  const next = fn(a);
  if (next === a) return false;
  commit({ accounts: replace(next) }, true);
  return true;
};
export const renameAccount = (id: string, name: string) => patch(id, a => (name.trim() && name.trim() !== a.name ? { ...a, name: name.trim().slice(0, 60) } : a));
/** Off the main list (still kept, still in the journal) — or back on it. An open account is ended first: nothing
    trades out of sight. */
export const archiveAccount = (id: string, on = true) => patch(id, a => (on ? { ...(a.status === 'open' ? endAccount(a, liveMarket(), 'Archived') : a), archived: true } : { ...a, archived: undefined }));
/** Ended by the reader: everything open closed at the market, written down as ended */
export const endAccountNow = (id: string) => act(id, (a, m) => endAccount(a, m));
/** Start over: this one is ended (its trades stay in the journal) and a fresh one on the same size and plan takes its
    place in the list, under the next number. Returns the new one's id. */
export function resetAccount(id: string): string | null {
  if (!state.holding) return null;
  const a = state.accounts.find(x => x.id === id);
  if (!a || a.plan?.legacy) return null;
  const now = Date.now();
  const m = liveMarket(now);
  const ended = a.status === 'open' ? endAccount(a, m, 'Started over') : a;
  const plan = a.kind === 'evaluation' && a.plan ? a.plan : null;
  const fresh = newAccount({ id: newId(), kind: a.kind, name: nextName(baseNameOf(plan, a.startCash)), startCash: plan ? plan.size : a.startCash, plan: plan ?? undefined, now, fee: plan ? undefined : a.fee, sandbox: a.sandbox });
  const accounts = state.accounts.flatMap(x => (x.id === id ? [fresh, { ...ended, archived: true }] : [x]));
  commit({ accounts, inHand: fresh.id }, true);
  return fresh.id;
}
/** Gone for good, with its journal notes */
export function deleteAccount(id: string): boolean {
  if (!state.holding || !state.accounts.some(a => a.id === id)) return false;
  const accounts = state.accounts.filter(a => a.id !== id);
  commit({ accounts, inHand: state.inHand === id ? (accounts.find(a => a.status === 'open')?.id ?? null) : state.inHand }, true);
  writeJournal(j => {
    const entries = { ...j.entries };
    const days = { ...j.days };
    delete entries[id];
    delete days[id];
    return { entries, days };
  });
  return true;
}
/** Does the account run on a plan's rules */
export const hasRules = (a: PaperAccount): boolean => rulesOf(a) != null;

/* ================================================================== */
/* The journal's own key */
/* ================================================================== */

interface PaperJournal {
  /** By account, by trade */
  entries: Record<string, Record<string, JournalEntry>>;
  /** By account, by trading day */
  days: Record<string, Record<string, DayNote>>;
}
function loadJournal(): PaperJournal {
  if (typeof localStorage === 'undefined' || EMBEDDED) return { entries: {}, days: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? 'null') as Partial<PaperJournal> | null;
    return { entries: raw?.entries ?? {}, days: raw?.days ?? {} };
  } catch {
    return { entries: {}, days: {} };
  }
}
let journal: PaperJournal = loadJournal();
const journalListeners = new Set<() => void>();
/** Written straight away, and read back first — another tab may have written since */
const writeJournal = (fn: (j: PaperJournal) => PaperJournal) => {
  if (EMBEDDED) return;
  journal = fn(loadJournal());
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  } catch {
    /* full: the words last as long as the page */
  }
  journalListeners.forEach(fn2 => fn2());
};
export const usePaperJournal = (): PaperJournal =>
  useSyncExternalStore(
    fn => {
      journalListeners.add(fn);
      return () => journalListeners.delete(fn);
    },
    () => journal,
    () => journal
  );
/** The journal's entry on a closed paper trade — what is given is written over what was there */
export const setPaperEntry = (accountId: string, tradeId: string, patch: Partial<JournalEntry>) =>
  writeJournal(j => ({ ...j, entries: { ...j.entries, [accountId]: { ...j.entries[accountId], [tradeId]: { ...j.entries[accountId]?.[tradeId], ...patch } } } }));
/** A note on one of an account's trading days: the plan before, the review after */
export const setPaperDayNote = (accountId: string, day: string, patch: Partial<DayNote>) =>
  writeJournal(j => ({ ...j, days: { ...j.days, [accountId]: { ...j.days[accountId], [day]: { ...j.days[accountId]?.[day], ...patch } } } }));
