/* The reader's own Watchers reasons: every term must hold (no "or", so the reason stays one sentence) over the same
   book rows the other pages read. A reason describes what it finds; it never scores or suggests. */

import { useCallback, useSyncExternalStore } from 'react';
import type { BookContract } from '../types/trace';
import { dayLean, LEAN_EDGE } from './traceLean';
import { fmtCount as num } from './traceRows';

export type ReasonField =
  | 'premium'
  | 'volume'
  | 'volOverOI'
  | 'deltaOIPct'
  | 'sweepPct'
  | 'multiPct'
  | 'floorPct'
  | 'askPct'
  | 'chgPct'
  | 'ivChg'
  | 'dte'
  | 'otmBy'
  | 'last'
  | 'earnDays'
  | 'oiStreak'
  | 'volGtOiStreak';

export type Comparator = 'atLeast' | 'atMost';

export interface ReasonTerm {
  field: ReasonField;
  cmp: Comparator;
  value: number;
}

export interface UserReason {
  id: string;
  /** The reader's handle for it — the chip label and the Reason column's lead */
  name: string;
  right: 'ANY' | 'C' | 'P';
  terms: ReasonTerm[];
  createdAt: number;
}

interface FieldMeta {
  /** Dropdown label — the fact, named the way the tables name it */
  label: string;
  /** Suffix in the value box */
  unit: string;
  /** Sensible starting value so a fresh term is already a real question */
  preset: number;
  step: number;
  /** How the value reads inside the sentence */
  fmt: (v: number) => string;
  /** The clause this term contributes, per comparator: "under 40% bought at the ask" is not "40%+" with a "not". */
  clause: (cmp: Comparator, v: number) => string;
  /** null = the row cannot answer this question (no earnings date, etc.) */
  read: (r: BookContract) => number | null;
}

const usd = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
    : v >= 1_000
      ? `$${Math.round(v / 1_000)}K`
      : `$${v}`;
const over = (cmp: Comparator) => (cmp === 'atLeast' ? 'over' : 'under');

export const REASON_FIELDS: Record<ReasonField, FieldMeta> = {
  premium: {
    label: 'Money traded today',
    unit: '$',
    preset: 1_000_000,
    step: 250_000,
    fmt: usd,
    clause: (c, v) => `${over(c)} ${usd(v)} traded`,
    read: r => r.premium,
  },
  volume: {
    label: 'Contracts traded',
    unit: '',
    preset: 5000,
    step: 500,
    fmt: num,
    clause: (c, v) => `${over(c)} ${num(v)} contracts traded`,
    read: r => r.volume,
  },
  volOverOI: {
    label: 'Traded vs open interest',
    unit: '×',
    preset: 2,
    step: 0.25,
    fmt: v => `${v}×`,
    clause: (c, v) =>
      c === 'atLeast' ? `traded over ${v}× its open interest` : `traded under ${v}× its open interest`,
    read: r => r.volOverOI,
  },
  deltaOIPct: {
    label: 'Open interest change',
    unit: '%',
    preset: 25,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) =>
      c === 'atLeast' ? `open interest up ${v}% or more` : `open interest change under ${v}%`,
    read: r => r.deltaOIPct,
  },
  sweepPct: {
    label: 'Swept share',
    unit: '%',
    preset: 30,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) => `${over(c)} ${v}% of it swept`,
    read: r => r.sweepPct,
  },
  multiPct: {
    label: 'Multi-leg share',
    unit: '%',
    preset: 40,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) => `${over(c)} ${v}% of it multi-leg`,
    read: r => r.multiPct,
  },
  floorPct: {
    label: 'Floor share',
    unit: '%',
    preset: 20,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) => `${over(c)} ${v}% crossed on the floor`,
    read: r => r.floorPct,
  },
  askPct: {
    label: 'Bought at the ask',
    unit: '%',
    preset: LEAN_EDGE,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) => `${over(c)} ${v}% bought at the ask`,
    /* the day lean's own figure: the ask share of the sided contracts */
    read: r => dayLean(r).askSided,
  },
  chgPct: {
    label: 'Contract price change',
    unit: '%',
    preset: 10,
    step: 5,
    fmt: v => `${v}%`,
    clause: (c, v) =>
      c === 'atLeast' ? `the contract up ${v}% or more today` : `the contract under ${v}% today`,
    read: r => r.chgPct,
  },
  ivChg: {
    label: 'Implied volatility change',
    unit: 'pts',
    preset: 2,
    step: 0.5,
    fmt: v => `${v} pts`,
    clause: (c, v) =>
      c === 'atLeast' ? `implied volatility up ${v} points or more` : `implied volatility under ${v} points`,
    read: r => r.ivChg,
  },
  dte: {
    label: 'Days to expiry',
    unit: 'd',
    preset: 7,
    step: 1,
    fmt: v => `${v}d`,
    clause: (c, v) => (c === 'atMost' ? `${v} days or less to expiry` : `${v} days or more to expiry`),
    read: r => r.dte,
  },
  otmBy: {
    label: 'Out of the money by',
    unit: '%',
    preset: 5,
    step: 1,
    fmt: v => `${v}%`,
    clause: (c, v) =>
      c === 'atLeast' ? `at least ${v}% out of the money` : `no more than ${v}% out of the money`,
    /* otmPct is already the distance past the stock for calls and puts alike */
    read: r => r.otmPct,
  },
  last: {
    label: 'Contract price',
    unit: '$',
    preset: 2,
    step: 0.5,
    fmt: v => `$${v.toFixed(2)}`,
    clause: (c, v) => `${over(c)} $${v.toFixed(2)} a contract`,
    read: r => r.last,
  },
  earnDays: {
    label: 'Earnings within',
    unit: 'd',
    preset: 5,
    step: 1,
    fmt: v => `${v}d`,
    clause: (c, v) =>
      c === 'atMost' ? `earnings ${v} days away or less` : `earnings more than ${v} days out`,
    read: r => r.earnDays,
  },
  oiStreak: {
    label: 'Sessions open interest has climbed',
    unit: 'd',
    preset: 3,
    step: 1,
    fmt: v => `${v}d`,
    clause: (c, v) =>
      c === 'atLeast' ? `open interest up ${v} sessions running` : `under ${v} sessions of climbing interest`,
    read: r => r.oiStreak,
  },
  volGtOiStreak: {
    label: 'Sessions trading past its interest',
    unit: 'd',
    preset: 2,
    step: 1,
    fmt: v => `${v}d`,
    clause: (c, v) =>
      c === 'atLeast' ? `trading past its interest ${v} sessions running` : `under ${v} such sessions`,
    read: r => r.volGtOiStreak,
  },
};

/** Dropdown order — the facts a reader reaches for first, first. */
export const REASON_FIELD_ORDER: ReasonField[] = [
  'premium',
  'volume',
  'volOverOI',
  'deltaOIPct',
  'sweepPct',
  'askPct',
  'floorPct',
  'multiPct',
  'chgPct',
  'ivChg',
  'last',
  'dte',
  'otmBy',
  'earnDays',
  'oiStreak',
  'volGtOiStreak',
];

/** Every term must hold; a field the row cannot answer fails, since silence is not agreement */
export function reasonMatches(reason: UserReason, r: BookContract): boolean {
  if (reason.right !== 'ANY' && r.right !== reason.right) return false;
  for (const t of reason.terms) {
    const v = REASON_FIELDS[t.field].read(r);
    if (v === null || !Number.isFinite(v)) return false;
    if (t.cmp === 'atLeast' ? v < t.value : v > t.value) return false;
  }
  return true;
}

/** How many of today's contracts this reason catches */
export const reasonMatchCount = (reason: UserReason, rows: BookContract[]): number =>
  rows.reduce((n, r) => n + (reasonMatches(reason, r) ? 1 : 0), 0);

/** The reason's sentence, composed from its terms, so the words can never drift from the test */
export function reasonSentence(reason: UserReason): string {
  const side = reason.right === 'C' ? 'Calls' : reason.right === 'P' ? 'Puts' : null;
  const parts = reason.terms.map(t => REASON_FIELDS[t.field].clause(t.cmp, t.value));
  if (parts.length === 0) return side ? `Any ${side.toLowerCase().slice(0, -1)} on the book` : 'Anything on the book';
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  /* the side leads as the subject: every clause is written to follow a noun */
  return side ? `${side} ${body}` : cap(body);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short handle for a reason with no name yet: its first term */
export function suggestedName(terms: ReasonTerm[]): string {
  if (terms.length === 0) return 'My reason';
  return REASON_FIELDS[terms[0].field].label;
}

/* module-level so the page, its chips and its builder share one list; a malformed stored row is dropped on read */

const STORE_KEY = 'slayer_flow_reasons_v1';

/** Past this the chip row stops being readable */
export const MAX_REASONS = 10;
/** One sentence's worth of terms */
export const MAX_TERMS = 5;

const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const readTerm = (t: unknown): ReasonTerm | null => {
  if (typeof t !== 'object' || t === null) return null;
  const c = t as Record<string, unknown>;
  if (typeof c.field !== 'string' || !(c.field in REASON_FIELDS)) return null;
  if (c.cmp !== 'atLeast' && c.cmp !== 'atMost') return null;
  if (!isFin(c.value)) return null;
  return { field: c.field as ReasonField, cmp: c.cmp, value: c.value };
};

const readReason = (a: unknown): UserReason | null => {
  if (typeof a !== 'object' || a === null) return null;
  const c = a as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.name !== 'string') return null;
  const right = c.right === 'C' || c.right === 'P' ? c.right : 'ANY';
  if (!Array.isArray(c.terms)) return null;
  const terms: ReasonTerm[] = [];
  for (const t of c.terms) {
    const term = readTerm(t);
    if (term) terms.push(term);
  }
  if (terms.length === 0) return null; // a reason with no test catches everything
  return {
    id: c.id,
    name: c.name.slice(0, 28),
    right,
    terms: terms.slice(0, MAX_TERMS),
    createdAt: isFin(c.createdAt) ? c.createdAt : 0,
  };
};

const load = (): UserReason[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: UserReason[] = [];
    for (const item of parsed) {
      const r = readReason(item);
      if (r) out.push(r);
    }
    return out.slice(0, MAX_REASONS);
  } catch {
    return [];
  }
};

const save = (list: UserReason[]) => {
  try {
    if (list.length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage full, private or off: never fatal */
  }
};

/* the cached array is the snapshot: useSyncExternalStore compares by identity */
let cache: UserReason[] | null = null;
const subs = new Set<() => void>();

const getReasons = (): UserReason[] => {
  if (!cache) cache = load();
  return cache;
};

const write = (next: UserReason[]) => {
  cache = next;
  save(next);
  subs.forEach(fn => fn());
};

let seq = 0;
const freshId = () => `ur-${Date.now().toString(36)}-${++seq}`;

/** Returns the saved reason, or null when the shelf is full or it tests nothing. */
export function saveReason(draft: Omit<UserReason, 'id' | 'createdAt'> & { id?: string }): UserReason | null {
  if (draft.terms.length === 0) return null;
  const list = getReasons();
  const clean: UserReason = {
    id: draft.id ?? freshId(),
    name: (draft.name.trim() || suggestedName(draft.terms)).slice(0, 28),
    right: draft.right,
    terms: draft.terms.slice(0, MAX_TERMS),
    createdAt: list.find(r => r.id === draft.id)?.createdAt ?? Date.now(),
  };
  const at = list.findIndex(r => r.id === clean.id);
  if (at === -1 && list.length >= MAX_REASONS) return null;
  write(at === -1 ? [...list, clean] : list.map(r => (r.id === clean.id ? clean : r)));
  return clean;
}

export function removeReason(id: string): void {
  const list = getReasons();
  const next = list.filter(r => r.id !== id);
  if (next.length !== list.length) write(next);
}

/** A fingerprint of the shelf, so the feed's cache key changes when a reason is edited */
export const reasonsSignature = (list: UserReason[]): string =>
  list.map(r => `${r.id}:${r.right}:${r.terms.map(t => `${t.field}${t.cmp}${t.value}`).join('|')}`).join(';');

export function useReasons(): UserReason[] {
  const subscribe = useCallback((fn: () => void) => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return useSyncExternalStore(subscribe, getReasons, getReasons);
}
