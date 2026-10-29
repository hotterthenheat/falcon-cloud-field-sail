/*
  The data hub: one shared copy of every vendor answer, kept fresh in the background, so the number of viewers never
  multiplies the vendor calls. Five viewers or five hundred watching SPY make the same calls: each path is fetched
  once per refresh interval, however many ask.

  - One key per request: query parameters are put in a fixed order, so the same request from two pages is one entry.
  - Fresh answers are served from memory. A slightly stale one is served at once while a refresh runs behind it.
  - While viewers keep coming back for a path, the hub refreshes it just before the next expected ask, so that viewer
    never waits; it never refreshes faster than the answer goes stale, so vendor calls are at most one per freshness
    window per path, and fewer when viewers ask less often. Background refreshes have their own rate budget and
    always yield to a viewer who is waiting.
  - The most-asked paths are remembered across restarts and loaded at start, so the first viewer of the day finds the
    site already loaded.
*/

import fs from 'node:fs';
import path from 'node:path';

const NY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false });
/** Weekdays 04:00–20:00 New York: the hours anything moves (pre-market, session, after-hours). */
export function marketHours(now = Date.now()) {
  const parts = Object.fromEntries(NY_PARTS.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24;
  return parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && h >= 4 && h < 20;
}

/** The same request however its query was written: parameters sorted by name, repeated ones kept in order. */
export function canonical(p) {
  const i = p.indexOf('?');
  if (i < 0) return p;
  const pairs = p
    .slice(i + 1)
    .split('&')
    .filter(Boolean)
    .map((kv, n) => ({ kv, k: kv.split('=')[0], n }));
  pairs.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.n - b.n));
  return `${p.slice(0, i)}?${pairs.map((x) => x.kv).join('&')}`;
}

/**
 * @param {object} o
 * @param {string} o.name                      for logs and the popular-paths file
 * @param {(path: string, lane: 'viewer' | 'refresh') => Promise<{status:number, body:Buffer, type:string}>} o.fetch
 * @param {(path: string) => number} o.ttl     ms an answer stays fresh during market hours
 * @param {number} o.refreshPerSec             background refresh budget
 * @param {number} [o.maxBytes]
 * @param {number} [o.maxRefreshing]             background refreshes outstanding at once (default 2)
 * @param {(path: string, ageMs: number) => boolean} [o.keepOnFail]  may a failed refresh fall back to the last good
 *   answer of this age? (default: never, so a failure shows as one)
 * @param {(path: string) => void} [o.promote]  a viewer is now waiting on this path's background refresh: move it ahead
 */
export function createHub(o) {
  const MAX_BYTES = o.maxBytes ?? 300 * 1024 * 1024;
  const POPULAR = 200;
  const cache = new Map();
  let bytes = 0;
  const inflight = new Map();
  /* key -> { last: ms of the last ask, asks: count, pinned: kept warm from the popular list } */
  const wanted = new Map();
  const stats = { asks: 0, fresh: 0, stale: 0, waited: 0, upstreamViewer: 0, upstreamRefresh: 0, startedAt: Date.now() };

  /* outside market hours nothing moves: answers stay good ten times longer */
  const ttlNow = (key) => (marketHours() ? o.ttl(key) : o.ttl(key) * 10);

  function keep(key, entry) {
    const old = cache.get(key);
    if (old) bytes -= old.body.length;
    cache.delete(key);
    cache.set(key, entry);
    bytes += entry.body.length;
    while (bytes > MAX_BYTES && cache.size > 1) {
      const [k, v] = cache.entries().next().value;
      cache.delete(k);
      bytes -= v.body.length;
    }
  }

  /* an answer about the request itself (not found, no data) is kept like a good one; a refusal or a fault is not */
  const keepable = (status) => status === 200 || (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status));
  const keepOnFail = o.keepOnFail ?? (() => false);

  /* background refreshes outstanding: the hub never queues more than the upstream can work through */
  let refreshing = 0;
  const MAX_REFRESHING = o.maxRefreshing ?? 2;

  /* lanes of the jobs in flight: a viewer who joins a background refresh has it moved to the viewers' lane */
  const laneOf = new Map();

  function upstream(key, lane) {
    const running = inflight.get(key);
    if (running) {
      if (lane === 'viewer' && laneOf.get(key) !== 'viewer') {
        laneOf.set(key, 'viewer');
        o.promote?.(key);
      }
      return running;
    }
    laneOf.set(key, lane);
    if (lane === 'viewer') stats.upstreamViewer += 1;
    else {
      stats.upstreamRefresh += 1;
      refreshing += 1;
    }
    const fallback = () => {
      const last = cache.get(key);
      return last && last.status === 200 && keepOnFail(key, Date.now() - last.at) ? last : null;
    };
    const job = o
      .fetch(key, lane)
      .then((got) => {
        const w = wanted.get(key);
        if (keepable(got.status)) {
          if (w) w.fails = 0;
          const entry = { ...got, at: Date.now() };
          keep(key, entry);
          return entry;
        }
        /* a failing path backs off its background refreshes: 2 s, 4 s … up to 30 s */
        if (w) {
          w.fails = (w.fails ?? 0) + 1;
          w.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** w.fails);
        }
        return fallback() ?? { ...got, at: Date.now() };
      })
      .catch((e) => {
        const last = fallback();
        if (last) return last;
        throw e;
      })
      .finally(() => {
        inflight.delete(key);
        laneOf.delete(key);
        if (lane !== 'viewer') refreshing -= 1;
      });
    inflight.set(key, job);
    return job;
  }

  /** One answer for a request path. */
  async function get(p) {
    const key = canonical(p);
    stats.asks += 1;
    const now = Date.now();
    const w = wanted.get(key);
    if (w) {
      /* how often viewers come back for this path: refreshes follow it, never faster than the answer goes stale */
      if (w.last) w.gap = Math.min(600_000, Math.max(100, w.gap ? 0.7 * w.gap + 0.3 * (now - w.last) : now - w.last));
      w.last = now;
      w.asks += 1;
    } else wanted.set(key, { last: now, asks: 1, pinned: false });
    const hit = cache.get(key);
    if (hit) {
      const age = Date.now() - hit.at;
      const ttl = ttlNow(key);
      if (age < ttl) {
        stats.fresh += 1;
        return hit;
      }
      /* a little past fresh: answer now, refresh behind it, unless the last refresh failed (then the failure shows) */
      const failing = wanted.get(key)?.fails && !keepOnFail(key, age);
      if (!failing && age < Math.max(2 * ttl, ttl + 2_000)) {
        stats.stale += 1;
        if (refreshing < MAX_REFRESHING) void upstream(key, 'refresh').catch(() => {});
        return hit;
      }
    }
    stats.waited += 1;
    return upstream(key, 'viewer');
  }

  /* ---- background refresh ---- */
  let tokens = o.refreshPerSec;
  const tick = () => {
    tokens = Math.min(o.refreshPerSec * 2, tokens + o.refreshPerSec / 4);
    const now = Date.now();
    const due = [];
    for (const [key, w] of wanted) {
      const ttl = ttlNow(key);
      const hit = cache.get(key);
      if (inflight.has(key) || (w.retryAt && now < w.retryAt)) continue;
      if (w.asks && !w.gap) {
        /* asked once: nothing says it will be asked again, so it is not refreshed */
        if (!w.pinned && now - w.last > 30_000) wanted.delete(key);
        continue;
      }
      if (w.asks) {
        const gap = w.gap;
        /* nobody has come back for three of their usual gaps: stop (a popular path goes back to its slow warmth) */
        if (now - w.last > Math.max(3 * gap, 30_000)) {
          if (w.pinned) w.asks = 0;
          else wanted.delete(key);
          continue;
        }
        /* refresh just before the next expected ask, and only if the copy would be stale by then */
        const nextAsk = w.last + gap;
        /* early enough to land before the ask, late enough that the copy is still fresh when it does */
        if (now < nextAsk - Math.min(1_500, gap * 0.3, ttl * 0.5)) continue;
        if (hit && hit.at + ttl > nextAsk) continue;
        due.push([key, w]);
      } else if (w.pinned) {
        /* a popular path nobody is watching yet: loaded, and kept within a minute while anything moves */
        if (!marketHours() && hit) continue;
        if (hit && now - hit.at < Math.max(ttl, 60_000)) continue;
        due.push([key, w]);
      } else wanted.delete(key);
    }
    /* the paths viewers asked for most recently and most often go first */
    due.sort((a, b) => b[1].last - a[1].last || b[1].asks - a[1].asks);
    for (const [key] of due) {
      if (tokens < 1 || refreshing >= MAX_REFRESHING) break;
      tokens -= 1;
      void upstream(key, 'refresh').catch(() => {});
    }
  };
  const timer = setInterval(tick, 250);
  timer.unref?.();

  /* ---- popular paths across restarts ---- */
  const file = path.join(process.cwd(), '.cache', `hub-${o.name}.json`);
  try {
    for (const key of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (typeof key === 'string') wanted.set(key, { last: 0, asks: 0, pinned: true });
    }
  } catch {
    /* first start, or a host with no writable disk */
  }
  const save = setInterval(() => {
    const top = [...wanted.entries()]
      .filter(([, w]) => w.asks > 1)
      .sort((a, b) => b[1].asks - a[1].asks)
      .slice(0, POPULAR)
      .map(([k]) => k);
    if (!top.length) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(top));
    } catch {
      /* read-only disk (Vercel): the list just isn't kept */
    }
  }, 300_000);
  save.unref?.();

  return {
    get,
    canonical,
    /** Counts for the load check: asks served fresh, served stale, waited on, and the vendor calls behind them. */
    stats: () => ({ ...stats, refreshing, watching: wanted.size, cached: cache.size, megabytes: Math.round(bytes / 1e5) / 10 }),
  };
}
