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
    site already loaded. A remembered path is let go once the day it names is over (an expired expiry) or nobody has
    asked for it in PIN_IDLE_DAYS; one nobody asked for today is kept warm at a slower pace.
*/

import fs from 'node:fs';
import path from 'node:path';
import { feedMoving } from '../shared/marketSession.mjs';

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
});
/** New York's date (YYYY-MM-DD), weekday and minute of the day at an instant */
export function nyNow(now = Date.now()) {
  const parts = Object.fromEntries(NY_PARTS.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
/** Does what `path` answers move now — the one session rule (shared/marketSession.mjs feedMoving): a stock's books
    04:00–20:00 New York on a session day (17:00 on an early close); an index's (SPX, SPXW, XSP, VIX, RUT) through Cboe's
    Global Trading Hours too — Sunday 20:15 on, the evening before each session — and the 16:15–17:00 curb. The stock
    overnight venues are on neither vendor's tape, so a stock path keeps the closed pace overnight. Weekends and
    holidays are closed (shared/marketCalendar.mjs). With no path: the stock day (04:00–20:00).
    SLAYER_HUB_HOURS=open|closed pins it, for a load check outside the session. */
export function marketHours(now = Date.now(), path) {
  const pin = process.env.SLAYER_HUB_HOURS;
  if (pin === 'open') return true;
  if (pin === 'closed') return false;
  return feedMoving(now, path ?? '');
}

/* a date in a query value: 2026-10-29 or 20261029 */
const DATE_IN = /(?:^|[^0-9])(20\d\d)-?([01]\d)-?([0-3]\d)(?![0-9])/;
/** The latest date a request names in its query (expiry, expirations[], date, end_date …), YYYY-MM-DD, or null */
export function lastDateOf(p) {
  const i = p.indexOf('?');
  if (i < 0) return null;
  let last = null;
  for (const kv of p.slice(i + 1).split('&')) {
    let v = kv.slice(kv.indexOf('=') + 1);
    try {
      v = decodeURIComponent(v);
    } catch {
      /* kept as written */
    }
    const m = v.match(DATE_IN);
    if (m) {
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      if (!last || d > last) last = d;
    }
  }
  return last;
}
/** A request whose every date is over (an expired expiry, an earlier session): nothing to keep warm */
export const pastDated = (p, today = nyNow().day) => {
  const d = lastDateOf(p);
  return !!d && d < today;
};

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
 * @param {(path: string, lane: 'viewer' | 'refresh' | 'record' | 'engine') => Promise<{status:number, body:Buffer, type:string}>} o.fetch
 *   'record' is a reader inside this process that must never get ahead of a viewer (the exposure recorder): it rides the
 *   background lane upstream
 * @param {(path: string) => number} o.ttl     ms an answer stays fresh during market hours
 * @param {number} o.refreshPerSec             background refresh budget
 * @param {number} [o.maxBytes]
 * @param {number} [o.maxRefreshing]             background refreshes outstanding at once (default 2)
 * @param {(path?: string) => boolean} [o.hours]  does this path's answer move now (default marketHours; the proof pins it)
 * @param {(path: string, ageMs: number) => boolean} [o.keepOnFail]  may a failed refresh fall back to the last good
 *   answer of this age? (default: never, so a failure shows as one)
 * @param {(path: string, lane: 'viewer' | 'engine') => void} [o.promote]  a viewer (or the engine) is now waiting on this path's job in flight: move it ahead
 * @param {(status: number, path: string) => boolean} [o.keepable]  is an answer with this status about the request
 *   itself (kept like a good one) rather than a fault (default: 200 and 4xx other than 401/403/408/429)
 * @param {string} [o.file]             the popular-paths file (default .cache/hub-<name>.json)
 * @param {number} [o.pinIdleDays]      a remembered path nobody asked for in this many days is let go (default 3,
 *   HUB_PIN_IDLE_DAYS)
 * @param {() => string} [o.today]      New York's date, YYYY-MM-DD (the proof pins it)
 * @param {(path: string) => string | null} [o.nameOf]  the name a path is about (SPY in /stock/SPY/…, symbol=SPY): with it,
 *   the paths a viewer opened for a WARM name are kept warm for the rest of the day after the viewer leaves (a "day pin")
 * @param {readonly string[]} [o.hotNames]  names always warm (SPY, QQQ …); any other name is warm the day a viewer opens it
 * @param {number} [o.maxDayPins]       day pins at most (default 120): the background budget they may take is bounded
 */
/** The names whose first-paint answers are kept warm all day (HUB_HOT_NAMES overrides): the index ETFs, the cash index
    and the most-watched names. Any other name is warm from the moment a viewer opens it, for the rest of that day. */
export const HOT_NAMES = (process.env.HUB_HOT_NAMES || 'SPY,QQQ,IWM,SPX,NVDA,AAPL,TSLA').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

/** The name a vendor path is about: /stock/SPY/…, ticker_symbol=SPY, ticker=SPY, symbol=SPY (SPXW reads as SPX) */
export function nameOfPath(p) {
  /* the query's name first (ThetaData's /stock/history/… carries it there); Unusual Whales puts it in the path, upper case */
  const m = /[?&](?:ticker_symbol|ticker|symbol)=([A-Za-z0-9.]{1,10})(?:&|$)/.exec(p) || /\/stock\/([A-Z0-9.]{1,10})(?:\/|$|\?)/.exec(p);
  if (!m) return null;
  const n = m[1].toUpperCase();
  return n === 'SPXW' ? 'SPX' : n;
}

export function createHub(o) {
  const MAX_BYTES = o.maxBytes ?? 300 * 1024 * 1024;
  const POPULAR = 200;
  const DAY_MS = 86_400_000;
  const PIN_IDLE_MS = (o.pinIdleDays ?? (Number(process.env.HUB_PIN_IDLE_DAYS) || 3)) * DAY_MS;
  /* a remembered path asked for in the last day is kept within a minute while anything moves; an older one within five */
  const PIN_WARM_MS = 60_000;
  const PIN_COOL_MS = 5 * 60_000;
  const today = o.today ?? (() => nyNow().day);
  /* DAY PINS (2026-10-31): "does all the data load even if I'm not on the page?" A path a viewer asked for on a warm name
     (a hot name, or one any viewer opened today) is not dropped when the viewer leaves: it stays wanted as a pin for the
     rest of the New York day, refreshed at the pinned pace (within a minute) only while its feed moves (feedMoving), so
     the next viewer of that room — this browser's next room, or another viewer — is answered from memory. Paging and
     older-than reads are one viewer's scroll, never pinned. */
  const HOT = new Set((o.hotNames ?? []).map((n) => String(n).toUpperCase()));
  const MAX_DAY_PINS = o.maxDayPins ?? 120;
  const openedOn = new Map();
  let dayPins = 0;
  const warmName = (name, day) => !!name && (HOT.has(name) || openedOn.get(name) === day);
  const dayPinnable = (key) => !/[?&](older_than|newer_than)=|[?&]page=[1-9]/.test(key);
  /** Keep a path a viewer has left as a day pin, when its name is warm and the budget allows */
  const toDayPin = (key, w, day) => {
    if (!o.nameOf || w.pinned || dayPins >= MAX_DAY_PINS || !dayPinnable(key) || pastDated(key, day)) return false;
    if (!warmName(o.nameOf(key), day)) return false;
    w.pinned = true;
    w.dayPin = day;
    w.asks = 0;
    dayPins += 1;
    return true;
  };
  const cache = new Map();
  let bytes = 0;
  const inflight = new Map();
  /* key -> { last: ms of the last ask this run, asks: count, pinned: kept warm from the popular list,
     seenAt: ms of the last viewer's ask, across restarts } */
  const wanted = new Map();
  const stats = { asks: 0, fresh: 0, stale: 0, waited: 0, upstreamViewer: 0, upstreamEngine: 0, upstreamRefresh: 0, recordAsks: 0, recordReused: 0, upstreamRecord: 0, startedAt: Date.now() };

  /* outside market hours nothing moves: answers stay good ten times longer */
  const hours = o.hours ?? ((key) => marketHours(Date.now(), key));
  const ttlNow = (key) => (hours(key) ? o.ttl(key) : o.ttl(key) * 10);

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
  const keepable = o.keepable ?? ((status) => status === 200 || (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)));
  const keepOnFail = o.keepOnFail ?? (() => false);

  /* background refreshes outstanding: the hub never queues more than the upstream can work through */
  let refreshing = 0;
  const MAX_REFRESHING = o.maxRefreshing ?? 2;

  /* lanes of the jobs in flight: a viewer who joins a background refresh has it moved to the viewers' lane */
  const laneOf = new Map();

  function upstream(key, lane) {
    const running = inflight.get(key);
    if (running) {
      /* the engine outranks a viewer, a viewer a background refresh: joining a job in flight moves it up */
      const was = laneOf.get(key);
      if (lane === 'engine' && was !== 'engine') {
        laneOf.set(key, 'engine');
        o.promote?.(key, 'engine');
      } else if (lane === 'viewer' && was !== 'viewer' && was !== 'engine') {
        laneOf.set(key, 'viewer');
        o.promote?.(key, 'viewer');
      }
      return running;
    }
    laneOf.set(key, lane);
    if (lane === 'viewer') stats.upstreamViewer += 1;
    else if (lane === 'engine') stats.upstreamEngine += 1;
    else if (lane === 'record') stats.upstreamRecord += 1;
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
        if (keepable(got.status, key)) {
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
        if (lane === 'refresh') refreshing -= 1;
      });
    inflight.set(key, job);
    return job;
  }

  /**
   * One answer for a request path.
   * @param {string} p
   * @param {{ lane?: 'viewer' | 'record' | 'engine', maxAge?: number }} [opt]  `engine`: the Compass engine, a viewer whose
   *   vendor calls go ahead of every other (the terminal's reserved slots, server/thetaSlots.mjs). `record`: a reader in this process (the exposure
   *   recorder). Its asks are not counted as a viewer's (nothing is kept warm on its schedule), it takes any copy younger
   *   than `maxAge` (default: the path's freshness), and a vendor call it needs waits behind every viewer.
   */
  async function get(p, opt) {
    const key = canonical(p);
    if (opt?.lane === 'record') {
      stats.recordAsks += 1;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < Math.max(ttlNow(key), opt.maxAge ?? 0)) {
        stats.recordReused += 1;
        return hit;
      }
      return upstream(key, 'record');
    }
    stats.asks += 1;
    const now = Date.now();
    if (o.nameOf) {
      const name = o.nameOf(key);
      if (name) openedOn.set(name, today());
    }
    const w = wanted.get(key);
    if (w) {
      /* how often viewers come back for this path: refreshes follow it, never faster than the answer goes stale */
      if (w.last) w.gap = Math.min(600_000, Math.max(100, w.gap ? 0.7 * w.gap + 0.3 * (now - w.last) : now - w.last));
      w.last = now;
      w.asks += 1;
      w.seenAt = now;
    } else wanted.set(key, { last: now, asks: 1, pinned: false, seenAt: now });
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
    return upstream(key, opt?.lane === 'engine' ? 'engine' : 'viewer');
  }

  /* ---- background refresh ---- */
  let tokens = o.refreshPerSec;
  /* a remembered path is let go once the day it names is over or nobody has asked for it in PIN_IDLE_MS */
  const pinGone = (key, w, now, day) => pastDated(key, day) || now - (w.seenAt ?? 0) > PIN_IDLE_MS;
  let pruneDay = '';
  let pruneAt = 0;
  const tick = () => {
    tokens = Math.min(o.refreshPerSec * 2, tokens + o.refreshPerSec / 4);
    const now = Date.now();
    const due = [];
    /* once a minute (and when New York's date turns), the remembered paths that are over are let go */
    const day = today();
    if (day !== pruneDay || now - pruneAt > 60_000) {
      pruneDay = day;
      pruneAt = now;
      for (const [key, w] of wanted) {
        /* a day pin ends with its day, unless its name is always warm */
        const dayOver = w.dayPin && w.dayPin !== day && !HOT.has(o.nameOf?.(key) ?? '');
        if (w.pinned && !w.asks && (dayOver || pinGone(key, w, now, day))) {
          if (w.dayPin) dayPins -= 1;
          wanted.delete(key);
        }
      }
      for (const [name, d] of openedOn) if (d !== day) openedOn.delete(name);
    }
    for (const [key, w] of wanted) {
      const ttl = ttlNow(key);
      const hit = cache.get(key);
      if (inflight.has(key) || (w.retryAt && now < w.retryAt)) continue;
      if (w.asks && !w.gap) {
        /* asked once: nothing says it will be asked again, so it is not refreshed (a warm name's path becomes a day pin) */
        if (!w.pinned && now - w.last > 30_000 && !toDayPin(key, w, day)) wanted.delete(key);
        continue;
      }
      if (w.asks) {
        const gap = w.gap;
        /* nobody has come back for three of their usual gaps: stop (a popular path goes back to its slow warmth) */
        if (now - w.last > Math.max(3 * gap, 30_000)) {
          if (w.pinned) w.asks = 0;
          else if (!toDayPin(key, w, day)) wanted.delete(key);
          continue;
        }
        /* refresh just before the next expected ask, and only if the copy would be stale by then */
        const nextAsk = w.last + gap;
        /* early enough to land before the ask, late enough that the copy is still fresh when it does */
        if (now < nextAsk - Math.min(1_500, gap * 0.3, ttl * 0.5)) continue;
        if (hit && hit.at + ttl > nextAsk) continue;
        due.push([key, w]);
      } else if (w.pinned) {
        /* a popular path nobody is watching yet: loaded, and kept within a minute while anything moves (five minutes
           when nobody has asked for it in a day) */
        if (!hours(key) && hit) continue;
        const pace = now - (w.seenAt ?? 0) < DAY_MS ? PIN_WARM_MS : PIN_COOL_MS;
        if (hit && now - hit.at < Math.max(ttl, pace)) continue;
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
  /* The file holds [{ p: path, at: ms of the last viewer's ask }], the most recently asked first. An older file of bare
     paths counts each as asked when the file was last written. Paths that are over are never loaded. */
  const file = o.file ?? path.join(process.cwd(), '.cache', `hub-${o.name}.json`);
  try {
    const written = fs.statSync(file).mtimeMs;
    const now = Date.now();
    const day = today();
    for (const item of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      const key = typeof item === 'string' ? item : item && typeof item.p === 'string' ? item.p : null;
      if (!key) continue;
      const seenAt = typeof item === 'string' ? written : Number(item.at) || written;
      const w = { last: 0, asks: 0, pinned: true, seenAt };
      if (!pinGone(key, w, now, day)) wanted.set(canonical(key), w);
    }
  } catch {
    /* first start, or a host with no writable disk */
  }
  /** Writes the popular paths: those viewers asked for more than once this run and the remembered ones still in use.
      Always written, so a path nobody wants any more leaves the file. */
  function savePins() {
    const now = Date.now();
    const day = today();
    const top = [...wanted.entries()]
      .filter(([k, w]) => (w.asks > 1 || w.pinned) && !pinGone(k, w, now, day))
      .sort((a, b) => (b[1].seenAt ?? 0) - (a[1].seenAt ?? 0) || b[1].asks - a[1].asks)
      .slice(0, POPULAR)
      .map(([p, w]) => ({ p, at: w.seenAt ?? now }));
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(top));
    } catch {
      /* read-only disk (Vercel): the list just isn't kept */
    }
    return top.length;
  }
  const save = setInterval(savePins, 300_000);
  save.unref?.();

  return {
    get,
    canonical,
    savePins,
    /** ms an answer for this path stays fresh right now (ten times longer outside market hours) */
    freshFor: (p) => ttlNow(canonical(p)),
    /** Headers saying how old an answer is: Age (s), x-hub-at (ms the vendor answered) and x-hub-held: 1 when it is
        being served past its normal stale window (the vendor is refusing and keepOnFail kept the last good copy). */
    ageHeaders(p, entry, now = Date.now()) {
      const ttl = ttlNow(canonical(p));
      const age = Math.max(0, now - (entry.at ?? now));
      const h = { age: String(Math.floor(age / 1000)), 'x-hub-at': String(entry.at ?? now) };
      if (age >= Math.max(2 * ttl, ttl + 2_000)) h['x-hub-held'] = '1';
      return h;
    },
    /** The paths kept warm with nobody watching (the popular list), for the load check */
    pinned: () => [...wanted.entries()].filter(([, w]) => w.pinned).map(([k]) => k),
    /** The day pins held now (paths kept warm for a warm name after its viewers left) */
    dayPinned: () => [...wanted.entries()].filter(([, w]) => w.dayPin).map(([k]) => k),
    /** Counts for the load check: asks served fresh, served stale, waited on, and the vendor calls behind them. */
    stats: () => ({ ...stats, refreshing, watching: wanted.size, dayPins, cached: cache.size, megabytes: Math.round(bytes / 1e5) / 10 }),
  };
}
