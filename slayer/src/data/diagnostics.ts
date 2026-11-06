/* What a bug report carries beside the reader's own words: the page, the name, the build, the theme, the window, the
   last few console errors and a snapshot of the data paths. It is built here, shown to the reader in full before it
   leaves, and leaves only by their hand (copied or downloaded: the app has no feedback endpoint, and nothing is sent).

   NEVER IN A REPORT: a credential, a key or token, a payment detail, storage, cookies, the account's email. The report
   is built from an allowlist of fields (buildReport), and every string in it, the reader's own words included, goes
   through scrub(), which removes anything shaped like a secret. scripts/surfaces-proof.ts feeds it the shapes and
   fails if one survives. */

/* ---- the scrubber ---- */

const REDACTED = '[removed]';

/** Shapes a secret takes. Order matters: the specific ones first, so their words are named in what is left. */
const SECRET_SHAPES: RegExp[] = [
  /* an Authorization header or a bearer token */
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /* a JSON web token (a signed-in session) */
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{4,})?/g,
  /* the market data key's shape, and the payment provider's keys */
  /\btd1_[A-Za-z0-9_-]+/gi,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/gi,
  /\bwhsec_[A-Za-z0-9]{6,}/gi,
  /* name=value or "name": "value" where the name says what it is (a bare `key` only with `=`, as in a query) */
  /((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|token|client[_-]?secret|secret|password|passwd|pwd|authorization|cookie|signature)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{3,}/gi,
  /(\bkey=)[^\s"'&,;}]{3,}/gi,
  /* an email address */
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /* a UUID (a key is often one) */
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /* any long run of key-like characters: 24+ letters and digits with at least one digit (hex keys, base64 tokens) */
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
];

/** A card number passes the Luhn check (so a 13-digit clock reading is not taken for one) */
const luhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};
/** 13 to 19 digits, spaces or dashes between */
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

/** The text with every secret-shaped part replaced. */
export function scrub(text: string): string {
  let s = String(text).replace(CARD, m => (luhn(m.replace(/\D/g, '')) ? REDACTED : m));
  for (const re of SECRET_SHAPES) s = s.replace(re, (m, name?: string) => (typeof name === 'string' && m.startsWith(name) ? `${name}${REDACTED}` : REDACTED));
  return s;
}

/** A URL with no query or fragment (a query can carry a token) */
export function bareUrl(u: string): string {
  return scrub(u.split(/[?#]/)[0]);
}

/* ---- the console's last errors ---- */

export interface LoggedError {
  at: number;
  message: string;
}

const KEEP = 15;
const MAX_LEN = 400;
const logged: LoggedError[] = [];
let installed = false;

const said = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Keep an error line (scrubbed and cut short as it is kept: the raw text is never held). */
export function noteError(parts: unknown[], at = Date.now()): void {
  const message = scrub(parts.map(said).join(' ')).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  if (!message) return;
  logged.push({ at, message });
  if (logged.length > KEEP) logged.splice(0, logged.length - KEEP);
}

/** The errors kept since the page loaded, oldest first */
export const recentErrors = (): LoggedError[] => logged.slice();

/** Listen for console errors, uncaught errors and unhandled rejections, once. The console keeps printing as before. */
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      noteError(args);
    } catch {
      /* never in the way */
    }
    original(...args);
  };
  window.addEventListener('error', e => noteError([e.error ?? e.message]));
  window.addEventListener('unhandledrejection', e => noteError(['Unhandled rejection:', (e as PromiseRejectionEvent).reason]));
}

/* ---- the report ---- */

export interface ReportWords {
  happened: string;
  expected: string;
  steps: string;
}

export interface ReportEnv {
  /** The page's path (no query: it can carry a token) */
  page: string;
  ticker: string;
  version: string;
  /** The newest changelog entry's date: which build this is */
  build: string;
  mode: string;
  theme: string;
  themeChoice: string;
  viewport: { width: number; height: number; dpr: number };
  /** The browser's own name for itself (navigator.userAgent): no account, no id */
  browser: string;
  language: string;
  /** The reader's clock zone (the terminal's times are New York's) */
  zone: string;
  online: boolean;
}

export interface HealthRow {
  id: string;
  label: string;
  state: string;
  line: string;
}

export interface BugReport {
  format: 'slayer-bug-report/1';
  createdAt: string;
  words: ReportWords;
  diagnostics: {
    env: ReportEnv;
    errors: LoggedError[];
    health: HealthRow[];
  } | null;
}

const cut = (s: string, n: number) => scrub(String(s ?? '')).slice(0, n);

/** The report, from an allowlist of fields: nothing is copied from the inputs that is not named here. */
export function buildReport(words: ReportWords, env: ReportEnv | null, errors: readonly LoggedError[], health: readonly HealthRow[], now = Date.now()): BugReport {
  return {
    format: 'slayer-bug-report/1',
    createdAt: new Date(now).toISOString(),
    words: { happened: cut(words.happened, 4000), expected: cut(words.expected, 2000), steps: cut(words.steps, 4000) },
    diagnostics: env
      ? {
          env: {
            page: bareUrl(env.page).slice(0, 200),
            ticker: cut(env.ticker, 12),
            version: cut(env.version, 40),
            build: cut(env.build, 40),
            mode: cut(env.mode, 20),
            theme: cut(env.theme, 20),
            themeChoice: cut(env.themeChoice, 20),
            viewport: { width: Math.round(env.viewport.width) || 0, height: Math.round(env.viewport.height) || 0, dpr: Number(env.viewport.dpr) || 1 },
            browser: cut(env.browser, 300),
            language: cut(env.language, 20),
            zone: cut(env.zone, 60),
            online: !!env.online,
          },
          errors: errors.slice(-KEEP).map(e => ({ at: Number(e.at) || 0, message: cut(e.message, MAX_LEN) })),
          health: health.map(h => ({ id: cut(h.id, 20), label: cut(h.label, 60), state: cut(h.state, 20), line: cut(h.line, 200) })),
        }
      : null,
  };
}

/** The report as plain text, for the clipboard */
export function reportText(r: BugReport): string {
  const lines: string[] = ['Slayer Terminal — bug report', `Made ${r.createdAt}`, '', 'What happened', r.words.happened || '—', '', 'What I expected', r.words.expected || '—', '', 'Steps', r.words.steps || '—'];
  const d = r.diagnostics;
  if (d) {
    const e = d.env;
    lines.push(
      '',
      'Diagnostics',
      `Page: ${e.page}`,
      `Name: ${e.ticker || '—'}`,
      `Version: ${e.version} (${e.mode}, changes to ${e.build})`,
      `Theme: ${e.theme} (${e.themeChoice})`,
      `Window: ${e.viewport.width}×${e.viewport.height} @${e.viewport.dpr}x`,
      `Browser: ${e.browser}`,
      `Language: ${e.language} · zone ${e.zone} · ${e.online ? 'online' : 'offline'}`,
      '',
      'Data paths',
      ...d.health.map(h => `- ${h.label}: ${h.state} — ${h.line}`),
      '',
      `Recent console errors (${d.errors.length})`,
      ...(d.errors.length ? d.errors.map(x => `- ${new Date(x.at).toISOString()} ${x.message}`) : ['- none']),
    );
  }
  return lines.join('\n');
}
