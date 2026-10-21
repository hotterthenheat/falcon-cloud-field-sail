/*
  SLAYER TERMINAL - THE STORES' SYNC (data/sync.ts)

  Noah (2026-10-10): "build the first one" — a paying member's desk layouts, watchlist, journal and preferences lived
  only in the browser they used. Now the account carries them: every store the terminal keeps in localStorage under a
  carried key is mirrored to the account's own rows (public.user_state, one row a key, the value as the browser kept
  it), and follows the person between machines.

  HOW, without touching thirty stores: the stores write localStorage as they always did. This module watches the
  browser's own setItem/removeItem for the carried keys, stamps each change, and uploads it a breath later, batched.
  At boot, before any store reads its key, the account's rows are pulled and the newer side wins, key by key — a row
  newer than the local stamp is written into localStorage; a local value the account has never seen is uploaded (so
  the machine's state becomes the account's at the first sign-in). A fresh sign-in on a page already running pulls the
  same way and reloads once if anything landed, since the stores had already read their keys. Signing out flushes
  what is pending, then clears the carried keys from this browser: a shared machine starts the next person clean, and
  the account brings everything back at the next sign-in.

  What is carried: a person's work (the watchlist, positions, the Pulse desks, Terrain's layout and named layouts and
  drawings, the Weigher's desk, the paper accounts, journal and desk, the review journal and its tags, closed trades,
  tracked setups, Trace's watchers, alert names, flow reasons, the 0DTE and screener settings, the ledger's names,
  news follows, the room) and the Settings preferences (theme, candles, the ruler, the desk's own rows, a few column
  choices). NOT carried: scripts — they live in IndexedDB and get their own seam later; the profile, which the row
  already mirrors; and device things (the rail's fold, dock widths, tab leases, an owner's view-as).

  Last write wins by time. Offline, the upload waits for the next change or the next boot; nothing is lost locally.
*/

import { supabase } from './supabase';
import { readAccount } from './account';

/** the keys the account carries — add a store's key here and it follows the person */
const CARRIED: string[] = [
  /* work */
  'slayer_watchlist_v2',
  'slayer_watch_names',
  'slayer_positions_v2',
  'slayer_desks_v2',
  'slayer_pulse_board',
  'slayer_board_names',
  'slayer_terrain_v1',
  'slayer_terrain_layouts_v1',
  'slayer_draw_tools_v1',
  'slayer_weigher_desk_v2',
  'slayer_weigher_folds',
  'slayer_weigher_top',
  'slayer_paper_v1',
  'slayer_paper_journal_v1',
  'slayer_paper_desk_v1',
  'slayer_paper_brackets_v1',
  'slayer_paper_sample',
  'slayer_paper_ladder',
  'slayer_paper_chain_cols',
  'slayer_review_v1',
  'slayer_review_tags_v1',
  'slayer_closed_trades',
  'slayer_tracked_setups',
  'slayer_trace_watch',
  'slayer_alert_names',
  'slayer_flow_reasons_v1',
  'slayer_odte_v1',
  /* the screener's whole screen (data/screenerViews) and every page's saved cuts (data/savedViews, 2026-10-13) */
  'slayer_screener_screen_v2',
  'slayer_screener_views_v1',
  'slayer_tape_cuts_v1',
  'slayer_footprints_cuts_v1',
  'slayer_watchers_cuts_v1',
  'slayer_windows_cuts_v1',
  'slayer_multileg_cuts_v1',
  'slayer_tape_hidden',
  'slayer_ledger_names',
  'slayer_ledger_greeks',
  'slayer_compare_sides',
  'slayer_news_follows',
  'slayer_room_v1',
  'slayer_scripts_recent',
  'slayer_draw_rail',
  /* preferences */
  'slayer_theme',
  'slayer_candle_theme',
  'slayer_candle_theme_light',
  'slayer_distance_unit',
  'slayer_desk_prefs',
];
const CARRIED_SET = new Set(CARRIED);
const STAMPS_KEY = 'slayer_sync_stamps';
const MAX_VALUE = 1_048_576;
const FLUSH_MS = 1500;
const BOOT_WAIT_MS = 2500;

/* the browser's own writers, kept so a pull can write without being heard as a change */
const native = {
  set: Storage.prototype.setItem,
  remove: Storage.prototype.removeItem,
};

/* when each carried key last changed on this machine, AS WHOM — ISO instants, kept in storage so they survive a reload.
   A stamp is only worth something to the person who made it: a machine that wrote a store's defaults while signed out
   has nothing to say against the account, and another person's stamps are not this one's (the first probe, 2026-10-10:
   three stores stamped "now" at a signed-out boot, and would have beaten the account at the next sign-in) */
interface Stamps {
  user: string | null;
  keys: Record<string, string>;
}
const readStamps = (): Stamps => {
  try {
    const raw = localStorage.getItem(STAMPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stamps> | null) : null;
    return parsed && typeof parsed === 'object' && parsed.keys && typeof parsed.keys === 'object' ? { user: typeof parsed.user === 'string' ? parsed.user : null, keys: parsed.keys } : { user: null, keys: {} };
  } catch {
    return { user: null, keys: {} };
  }
};
let stamps: Stamps = typeof localStorage !== 'undefined' ? readStamps() : { user: null, keys: {} };
const saveStamps = (): void => {
  try {
    native.set.call(localStorage, STAMPS_KEY, JSON.stringify(stamps));
  } catch {
    /* storage off or full — the stamps live for the page */
  }
};
/** the stamps as this person's — another's, or nobody's, start empty */
const claimStamps = (userId: string): Record<string, string> => {
  if (stamps.user !== userId) stamps = { user: userId, keys: {} };
  return stamps.keys;
};
const later = (a: string | undefined, b: string | undefined): boolean => {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
};

/* ---- the upload: changes gathered, sent a breath later ------------------------------------------------------- */

const pending = new Map<string, string | null>();
let timer: number | null = null;
let flushing: Promise<void> | null = null;

const signedIn = (): string | null => {
  const a = readAccount();
  return a.status === 'in' && a.user ? a.user.id : null;
};

async function flush(): Promise<void> {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (flushing) return flushing;
  flushing = (async () => {
    const userId = signedIn();
    if (!supabase || !userId || pending.size === 0) return;
    const mine = claimStamps(userId);
    const now = new Date().toISOString();
    const rows = [...pending].map(([key, value]) => ({ user_id: userId, key, value, updated_at: (mine[key] ??= now) }));
    saveStamps();
    pending.clear();
    const { error } = await supabase.from('user_state').upsert(rows, { onConflict: 'user_id,key' });
    if (error) {
      /* offline, or the service blinked — the rows go back to wait for the next change (a newer value for a key wins) */
      for (const r of rows) if (!pending.has(r.key)) pending.set(r.key, r.value);
      console.warn('[sync] saving to the account:', error.message);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
const schedule = (): void => {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), FLUSH_MS);
};

/** a carried key changed on this machine — queued; stamped and sent only as a signed-in person (a change made signed
    out waits in the queue and goes up, unstamped and so beaten by anything the account already holds, once the account
    is known) */
const noteChange = (key: string, value: string | null): void => {
  if (value != null && value.length > MAX_VALUE) return;
  pending.set(key, value);
  const userId = signedIn();
  if (!userId) return;
  claimStamps(userId)[key] = new Date().toISOString();
  saveStamps();
  schedule();
};

/** the account became known on a page already running (the session found at boot, or a token refreshed): whatever
    waited in the queue goes up — after a FRESH sign-in this is called once the pull has had its say */
export function settleSync(userId: string): void {
  claimStamps(userId);
  if (pending.size) schedule();
}

let watching = false;
/** listen to the browser's own writers for the carried keys — installed once, after the boot pull, so the pull's own
    writes and the defaults carried at boot are not heard as changes */
export function watchStorage(): void {
  if (watching || typeof Storage === 'undefined') return;
  watching = true;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    native.set.call(this, key, value);
    if (this === window.localStorage && CARRIED_SET.has(key)) noteChange(key, value);
  };
  Storage.prototype.removeItem = function (this: Storage, key: string) {
    native.remove.call(this, key);
    if (this === window.localStorage && CARRIED_SET.has(key)) noteChange(key, null);
  };
  /* a tab closing with changes still waiting: send them now (keepalive is the fetch's own; the client's request is
     ordinary, so a very late close may lose the last second — the next change or boot carries it) */
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/* ---- the pull: the account's rows against this machine's, the newer side winning ---------------------------- */

interface Row {
  key: string;
  value: string | null;
  updated_at: string;
}

/** pull the account's state; returns how many carried keys CHANGED on this machine. Uploads what the account has
    never seen, or has older. */
export async function pullState(): Promise<number> {
  if (!supabase) return 0;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return 0;
  const { data, error } = await supabase.from('user_state').select('key,value,updated_at');
  if (error) {
    console.warn('[sync] reading the account:', error.message);
    return 0;
  }
  const server = new Map<string, Row>((data as Row[]).map(r => [r.key, r]));
  /* this person's stamps only — a signed-out machine's, or another person's, say nothing against the account */
  const mine = claimStamps(userId);
  let changed = 0;
  const upload: { key: string; value: string | null }[] = [];
  for (const key of CARRIED) {
    const local = localStorage.getItem(key);
    const row = server.get(key);
    const stamp = mine[key];
    if (row) {
      if (!stamp || later(row.updated_at, stamp)) {
        /* the account's is newer (or this person never stamped the key on this machine): the account wins, and a
           change that waited in the queue for this key is forgotten with it */
        if (row.value !== local) {
          if (row.value == null) native.remove.call(localStorage, key);
          else native.set.call(localStorage, key, row.value);
          changed++;
        }
        pending.delete(key);
        mine[key] = row.updated_at;
      } else if (local !== row.value) {
        /* this machine's is newer */
        upload.push({ key, value: local });
      }
    } else if (local != null) {
      /* the account has never seen this key: the machine's state becomes the account's */
      mine[key] ??= new Date().toISOString();
      upload.push({ key, value: local });
    }
  }
  saveStamps();
  if (upload.length) {
    const rows = upload.filter(u => u.value == null || u.value.length <= MAX_VALUE).map(u => ({ user_id: userId, key: u.key, value: u.value, updated_at: mine[u.key] ?? new Date().toISOString() }));
    for (const u of upload) pending.delete(u.key);
    const { error: upErr } = await supabase.from('user_state').upsert(rows, { onConflict: 'user_id,key' });
    if (upErr) console.warn('[sync] saving to the account:', upErr.message);
  }
  return changed;
}

/** at boot, before the stores read their keys: pull with a short patience, so an unreachable service never holds the
    page — then the stores read what landed */
export async function bootSync(): Promise<void> {
  if (!supabase) return;
  await Promise.race([pullState().catch(() => 0), new Promise<void>(resolve => window.setTimeout(resolve, BOOT_WAIT_MS))]);
}

/** a fresh sign-in on a page already running: the account's state is pulled first (it beats anything this machine
    wrote while signed out), what still waits goes up, and if the account's state landed the page is reloaded once —
    the stores read their keys long ago */
export async function syncAfterSignIn(userId: string): Promise<void> {
  const changed = await pullState().catch(() => 0);
  settleSync(userId);
  await flush();
  if (changed > 0) window.location.reload();
}

/** before signing out: what is pending goes up; after: this browser forgets the carried keys (the account keeps them) */
export async function flushSync(): Promise<void> {
  await flush();
}
export function clearCarried(): void {
  for (const key of CARRIED) native.remove.call(localStorage, key);
  stamps = { user: null, keys: {} };
  try {
    native.remove.call(localStorage, STAMPS_KEY);
  } catch {
    /* storage off */
  }
  pending.clear();
}

/** the keys the account carries — for the Data page's words */
export const CARRIED_KEYS: readonly string[] = CARRIED;
