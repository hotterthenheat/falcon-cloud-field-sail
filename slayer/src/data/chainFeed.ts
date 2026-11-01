/* TERRAIN'S OPTION CHAIN in the browser: one shared store per name, so every pane and lens reading it (the Surface
   tab's Skew and Drift) share one request, and the server (server/terrainApi.mjs) reads the terminal once for every
   viewer. One loop per name while anything shows it — every 20 s while the name's options trade, every 5 minutes when
   they do not. The prior session's closing surface is read once per session (every 3 s while the server is still
   reading it). Never while the tab is hidden. */

import { useEffect, useSyncExternalStore } from 'react';
import { feedMoving } from '../core/session';
import { feedHeaders } from './feedGate';
import { chainRoot, type ChainExpiry, type ChainRow, type CloseRow } from '../../shared/optionChain.mjs';
import type { Read } from './regimeFeed';

export interface ChainRead {
  v: number;
  at: number;
  symbol: string;
  root: string;
  /** The session day the snapshot is from (New York) */
  day?: string | null;
  live?: boolean;
  spot?: number | null;
  /** New York wall stamps, YYYY-MM-DDTHH:MM:SS */
  spotAt?: string | null;
  asOf?: string | null;
  /** The open interest's report date */
  oiDay?: string | null;
  expiries?: ChainExpiry<ChainRow>[];
  error?: string | null;
}
export interface PriorRead {
  v: number;
  at: number;
  symbol: string;
  root: string;
  day?: string | null;
  spot?: number | null;
  expiries?: ChainExpiry<CloseRow>[];
  pending?: boolean;
  error?: string | null;
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

async function getJson<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const auth = await feedHeaders();
    if (!auth.ok) return { data: null, error: auth.code };
    const res = await fetch(url, { headers: auth.headers });
    if (res.status === 401 || res.status === 403) return { data: null, error: 'signed_out' };
    if (!res.ok) return { data: null, error: res.status === 404 ? 'no_route' : 'terminal_down' };
    return { data: (await res.json()) as T, error: null };
  } catch {
    return { data: null, error: 'terminal_down' };
  }
}

interface Store<T> {
  read: Read<T>;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  listeners: Set<() => void>;
}

/** One polled store per key: `gap` says how long to wait after an answer */
function makeStores<T extends { error?: string | null }>(url: (root: string) => string, gap: (s: Store<T>, root: string) => number) {
  const stores = new Map<string, Store<T>>();
  const get = (root: string): Store<T> => {
    let s = stores.get(root);
    if (!s) stores.set(root, (s = { read: { data: null, error: null, loading: true }, users: 0, timer: null, busy: false, listeners: new Set() }));
    return s;
  };
  async function tick(root: string): Promise<void> {
    const s = get(root);
    s.timer = null;
    if (!s.users) return;
    if (visible() && !s.busy) {
      s.busy = true;
      const got = await getJson<T>(url(root));
      s.busy = false;
      /* a failed ask keeps the last good answer on screen, with the failure beside it */
      s.read = { data: got.data && !got.data.error ? got.data : s.read.data, error: got.error ?? got.data?.error ?? null, loading: false };
      s.listeners.forEach(l => l());
    }
    if (s.users && !s.timer) s.timer = setTimeout(() => void tick(root), gap(s, root));
  }
  function use(symbol: string | null | undefined): Read<T> {
    const root = symbol ? chainRoot(symbol) : '';
    useEffect(() => {
      if (!root) return;
      const s = get(root);
      s.users += 1;
      if (s.users === 1 && !s.timer) s.timer = setTimeout(() => void tick(root), 0);
      return () => {
        s.users -= 1;
        if (!s.users && s.timer) {
          clearTimeout(s.timer);
          s.timer = null;
        }
      };
    }, [root]);
    const s = get(root || '_');
    return useSyncExternalStore(
      fn => {
        s.listeners.add(fn);
        return () => {
          s.listeners.delete(fn);
        };
      },
      () => s.read,
      () => s.read
    );
  }
  return use;
}

/** The live chain for a name (SPX reads its weeklies), shared by every reader on the page */
export const useChain = makeStores<ChainRead>(
  root => `/api/terrain/chain?symbol=${encodeURIComponent(root)}`,
  (s, root) => (s.read.error && !s.read.data ? 30_000 : s.read.data?.live || feedMoving(Date.now(), root) ? 20_000 : 300_000)
);

/** The session before the chain's own: its closing quotes, read once */
export const usePriorClose = makeStores<PriorRead & { error?: string | null }>(
  root => `/api/terrain/prior?symbol=${encodeURIComponent(root)}`,
  s => (s.read.data?.pending || (!s.read.data && !s.read.error) ? 3_000 : s.read.error ? 60_000 : 30 * 60_000)
);
