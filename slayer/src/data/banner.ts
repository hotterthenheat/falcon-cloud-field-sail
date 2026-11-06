/* THE BANNER'S ONE SOURCE. What the strip over every terminal page may say: the announcements written here by hand
   (ANNOUNCEMENTS, typed, each with its own id and an optional window), and the outages the app's own reads report
   (data/pathHealth.ts), made into messages by outageMessages. selectBanner picks the one to show: an outage before an
   announcement, the worst outage first, nothing the reader dismissed. Dismissal is kept per message id in
   localStorage; an outage's id carries the instant it began, so a new outage shows again after an old one was
   dismissed. Pure but for the two storage helpers, so scripts/surfaces-proof.ts proves the choice. */

import type { PathId, PathRead } from './pathHealth';

export type BannerTone = 'outage' | 'notice' | 'info';

export interface BannerMessage {
  /** Stable per message: dismissal is remembered by it */
  id: string;
  tone: BannerTone;
  /** One short line, in the house's words (no vendor named) */
  text: string;
  /** Somewhere to read more, inside the app */
  link?: { label: string; to: string };
  /** Shown from / until (epoch ms); open-ended where left out */
  from?: number;
  until?: number;
  /** Can the reader put it away (an outage can; the reader still sees the status page) */
  dismissible?: boolean;
}

/* ---- the announcements: add one here, newest first; give it an id nobody used before ---- */
export const ANNOUNCEMENTS: readonly BannerMessage[] = [
  {
    id: 'surfaces-2026-11-06',
    tone: 'info',
    text: 'New: a status page, a changelog, a bug report form, one place for your notifications, and “?” for help.',
    link: { label: 'What changed', to: '/changelog' },
    from: Date.UTC(2026, 10, 6, 5),
    until: Date.UTC(2026, 10, 14, 5),
    dismissible: true,
  },
];

/** How long a path must have failed, with no good answer between, before the banner says so (one blip is not an outage) */
export const OUTAGE_AFTER_MS = 45_000;

const OUTAGE_WORDS: Record<PathId, { text: string; rank: number }> = {
  server: { text: 'The terminal’s server is not answering. Pages keep what they last showed and try again on their own.', rank: 0 },
  quotes: { text: 'Live quotes are offline — reconnecting. Prices on screen are the last ones taken, stamped with their time.', rank: 1 },
  flow: { text: 'Options flow and the dealer book are not answering — reconnecting. What is on screen is the last read.', rank: 2 },
};
const LOGIN_WORDS = 'Market data login failed — the data key on the server needs looking at. Prices on screen are the last ones taken.';

/** The outages the reads report: a path down (not refused) for at least OUTAGE_AFTER_MS. The server down hides the
    others (they cannot answer without it). */
export function outageMessages(paths: Record<PathId, PathRead>, now: number): BannerMessage[] {
  const out: (BannerMessage & { rank: number })[] = [];
  for (const id of ['server', 'quotes', 'flow'] as PathId[]) {
    const r = paths[id];
    if (!r || r.condition !== 'down' || !r.failSince || now - r.failSince < OUTAGE_AFTER_MS) continue;
    const words = id === 'quotes' && r.login ? LOGIN_WORDS : OUTAGE_WORDS[id].text;
    out.push({ id: `outage:${id}:${r.failSince}`, tone: 'outage', text: words, link: { label: 'Status', to: '/status' }, dismissible: true, rank: OUTAGE_WORDS[id].rank });
  }
  if (out.some(m => m.id.startsWith('outage:server:'))) return out.filter(m => m.id.startsWith('outage:server:')).map(({ rank: _rank, ...m }) => m);
  return out.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...m }) => m);
}

const TONE_RANK: Record<BannerTone, number> = { outage: 0, notice: 1, info: 2 };

/** The one message to show, or null: in its window, not dismissed, the most urgent tone first, the list's order next. */
export function selectBanner(messages: readonly BannerMessage[], dismissed: ReadonlySet<string>, now: number): BannerMessage | null {
  let best: BannerMessage | null = null;
  for (const m of messages) {
    if (m.from != null && now < m.from) continue;
    if (m.until != null && now >= m.until) continue;
    if (m.dismissible !== false && dismissed.has(m.id)) continue;
    if (!best || TONE_RANK[m.tone] < TONE_RANK[best.tone]) best = m;
  }
  return best;
}

/* ---- the reader's dismissals, per message, in this browser ---- */
const KEY = 'slayer_banner_dismissed_v1';
/** At most this many ids are kept (the oldest go first) */
const KEEP = 50;

export function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeDismissed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids].slice(-KEEP)));
  } catch {
    /* no storage: dismissed for this page view only */
  }
}
