import { MARKET_HOLIDAYS } from '../core/calendar';
import { REGULAR_OPEN_MIN, isSessionDay, nextSessionDay, nyWall, regularCloseMin } from '../core/session';

/* Compass parameters, in one place. The entry and runner trees ship in public/models; scoring stays shut until
   those files hash to the values below. */

export const UNIVERSE_SHA = 'eb0ed706ae8dd5d5442a99d012db5077e6f9ba1ad0ef10a551af36b87840ef7e';
export const UNIVERSE_N = 458;

export const ENTRY_SHA = '94592d667860d271e85e24dc9f8e82252b71d393c97cb019af871bd3782bdb8d';
export const RUNNER_SHA = '8a41876361259eec2c525b1977f703ddb0944bd2c39784fe3484959b1037302c';
export const TREE_N = 300;

export const R = 0.042;
export const Q = 0;
export const SESSION_MIN = 390;
export const YEAR_SESSIONS = 252;
const T_EPS = 1e-6;

export const IV_LO = 0.01;
export const IV_HI = 8;
export const IV_BISECTS = 60;
export const IV_FEATURE_MIN = 0.011;
const IV_FALLBACK = 0.3;

/* MODEL 1'S TRAINED QUOTES, not a scanner limit (owner, 2026-11-07: "remove the hard coded limits"). The entry and
   runner trees were trained only on contracts with a bid over $0.15 and a spread within 8% of the mid: the trees' own
   files say so (public/models/model_*_all6months.txt, feature_infos: column 32, the mid, starts at 0.165 in the entry
   tree and 0.16 in the runner tree; column 33, spread / mid, spans [0, 0.0799999982] in both, and both trees split on
   it), and every row the live scorer has logged since agrees (.cache/compass/rows: max spread / mid 0.0799999982, min
   mid 0.16, 227,282 rows). A contract outside that box is outside what the trees have ever seen, so Model 1 does not
   score it (inModel1Domain). The two numbers define Model 1's input, nothing else: Model 3 and Model Risk do not read
   them, and among the contracts Model 1 clears, the cost rule (compassCost) chooses. */
export const BID_MIN = 0.15;
export const SPREAD_MAX = 0.08;
const SPREAD_EPS = 1e-9;

export const P1_MIN = 0.7067;

/* The exported decision math (the trees, this line, the runner, the stop, the exit ladder, Model 3 and Model Risk)
   is withdrawn from the live desk. The functions stay so the proofs can still read them. The scan does not call
   them, and the pages do not publish a call. */
export const MATH_WITHDRAWN = true;
export const WITHDRAWN_LINE = 'The decision math is withdrawn. No calls, no line, no stop, and no exit. The book on the other desks is unchanged.';
const PRUN_MIN = 0.5;

const BOOK_A_STEP = 5;
/** Book A and Book B. Weekdays from the session date, 0 through 7. Book C is same-day only. */
const DTE_MIN = 0;
const DTE_MAX = 7;

/** Index roots stay 4 strikes from the money. Every other name uses the 6% span. */
export const SPAN_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
export const DRIVE = 0.0035;
const REVERSAL = 0.004;
export const QUOTE_MAX_AGE_MS = 90_000;
const BOOK_B_HALVE = 0.5;
/* THE WING, by its shape instead of its price (2026-11-07). Book B used to need an ask of $1.00 or less: a cheap wing on
   SPY, but on SPXW only the farthest strikes ever qualified (58 of 2,645 band contracts in the record) and on NDXP and
   RUTW none did, while on a $40 name every band contract did. What the cap let through, on every root, in the record
   (.cache/compass/rows, 2026-10-29 to 11-06, band contracts out of the money, |delta| on the trading clock at the
   contract's own IV): p50 0.080, p90 0.144, max 0.199; what it shut out: p10 0.167, p50 0.269. A wing is now a band
   contract at 0.15 delta or less (the p90 of what the cap passed, rounded): the same shape on any root at any price. */
export const WING_DELTA_MAX = 0.15;
export const BOOK_B_LOOKBACK = 30;

/* No fees (owner, 2026-10-31): Compass does not place trades, it publishes entries and exits. A call's P&L is
   (exit - entry) x 100 a contract, nothing else; the break-even stop is the entry ask itself. (Until then: $1.08 a
   round trip, the SEC fee and FINRA's TAF were taken off every P&L and added to the break-even stop.) */

const STOP_HAIRCUT = 0.5322;
export const STOP_KEEP = 1 - STOP_HAIRCUT;
const BE_PEAK = 1.25;
const TP1_BID = 1.5;
export const TP1_STOP = 1.25;
const TP2_BID = 2;
export const TP2_STOP = 1.5;
const TP3_BID = 3;
export const TP3_STOP = 2.25;
const TP4_BID = 4;
export const TP4_TRAIL = 0.75;
export const FLAT_T = 385;

/** Model 3's live price cap while COMPASS_M3_SHAPE is off (lotteryEntry); the Weigher's copy of the gate reads it too. */
export const LOTTERY_ASK_MAX = 1.65;
/* MODEL 3'S CONTRACT BY SHAPE, behind COMPASS_M3_SHAPE=1 (off by default: the lead, 2026-11-07). The in-sample replay
   (scripts/compass-limits-insample.ts) moved Model 3 from −$394 to −$1,407 on 12 changed picks, mostly SPXW's
   at-the-money $16 contracts, and neither rule has evidence behind it: the 2020–2024 backtest of the current Model 3
   against the limits-removed one decides. Until it does the live sweep keeps lotteryEntry, unchanged.
   With the switch on: the late sweep used to take the nearest strike
   asking $1.65 or less: at the money on IWM, QQQ, SPY, XSP and INTC (|delta| 0.41 to 0.69 in the record's 15 picks),
   and only on SPXW, where the money costs more, pushed out to 0.075–0.16 delta by the price alone. The sweep is the
   at-the-money-or-out late ticket: 0.55 delta or less (every recorded at-the-money pick, 0.41 to 0.53, is inside; an
   in-the-money contract is not a lottery ticket). Among those on the nearest strike's side the cost rule chooses. */
export const LOTTERY_DELTA_MAX = 0.55;
/** At most this many Model 3 calls a session (a count of seats, not a price or a size) */
export const LOTTERY_CAP = 5;

/** COMPASS_M3_SHAPE=1: Model 3 picks by shape (lotteryShape, compassCost lotterySide); off (the default): today's rule
    (lotteryEntry, compassCost lotterySideNow). Read through globalThis like the other switches. */
let m3ShapeOverride: boolean | null = null;
export function m3ShapeOn(): boolean {
  if (m3ShapeOverride != null) return m3ShapeOverride;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return env.COMPASS_M3_SHAPE === '1';
}
/** Proofs only: force COMPASS_M3_SHAPE on or off (null: back to the environment). */
export function setM3Shape(on: boolean | null): void {
  m3ShapeOverride = on;
}
const LOTTERY_X3_SEC = 120;
const LOTTERY_X2_SEC = 30;
const LOTTERY_X3 = 3;
const LOTTERY_X2 = 2;

/** Open interest, net gamma, and the two walls. Everyone else is NaN. */
export const GEX_CORE = ['SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF'] as const;

/** No same-day contract. Their dailies are SPXW, NDXP, and RUTW. */
export const NO_SAME_DAY = ['SPX', 'NDX', 'RUT', 'VIX'] as const;
export const DO_NOT_REQUEST: readonly string[] = [];

/** SPXW reads SPX. NDXP reads NDX. RUTW reads RUT. XSP reads XSP. */
const PRINT_OF: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };

export const CLS_INDEX = ['SPXW', 'SPX', 'NDXP', 'NDX', 'XSP', 'RUTW', 'RUT', 'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'RSP'] as const;
/** NVDA is 1. META is 0. The old LLY/BKNG list is not this. */
export const CLS_HIGHBETA = ['AFRM', 'AGQ', 'AMC', 'BITX', 'BOIL', 'CLSK', 'COIN', 'CVNA', 'DJT', 'FAS', 'GME', 'HOOD', 'IREN', 'JNUG', 'KOLD', 'LABU', 'MARA', 'MSTR', 'NUGT', 'NVDA', 'NVDL', 'PLTR', 'RIOT', 'SMCI', 'SOXL', 'SOXS', 'SPXL', 'SPXS', 'SPXU', 'SQQQ', 'SVIX', 'SVXY', 'TNA', 'TQQQ', 'TSLA', 'TSLL', 'TZA', 'UPRO', 'UPST', 'UVIX', 'UVXY', 'VXX', 'YINN'] as const;

/* The names a viewer reads, in one place (rename here): the entry tree, the runner tree and the three books. Never
   show "Model 1", "Model 2" or "Book A/B/C" on a page; the code's own book letters stay A, B and C. */
export const MODEL_1_NAME = 'Hit score';
/* The live inputs were rebuilt (volume curve, prior session) and have not been re-checked against the training rows,
   so every Book A/B call is marked as unvalidated until that check is done. */
export const MODELS_VALIDATED = false;
export const UNVALIDATED_WORD = 'Unvalidated';
export const UNVALIDATED_LINE = 'Unvalidated model: the live inputs have not yet been re-checked against the training data.';
export const MODEL_2_NAME = 'Runner score';
export const BOOK_NAME: Record<'A' | 'B' | 'C', string> = { A: 'Core', B: 'Wing', C: 'Late sweep' };

/** Engine text as a viewer reads it: the tree and book names above in place of "Model 1", "Model 2" and "Book A/B/C",
    and no data vendor named. The browser runs every Compass answer through it (compassFeed, compassReviewFeed), so a
    record, review or study written before a rename (or by older code) reads the same as a new one. */
export function userWords(text: string): string {
  const b = (k: string) => BOOK_NAME[k as 'A' | 'B' | 'C'] ?? k;
  return text
    .replace(/\bModel 1\b/g, MODEL_1_NAME)
    .replace(/\bModel 2\b/g, MODEL_2_NAME)
    .replace(/\bBooks? A, B,? (and|or) C\b/g, (_, w) => `${b('A')}, ${b('B')} ${w} ${b('C')}`)
    .replace(/\bBooks? A,? (and|or) (?:Book )?B\b/g, (_, w) => `${b('A')} ${w} ${b('B')}`)
    .replace(/\bBook A\/B\b/g, `${b('A')}/${b('B')}`)
    .replace(/\bBook ([ABC])\b/g, (_, k) => b(k))
    .replace(/\bquotes ThetaData recorded\b/g, 'recorded quotes')
    .replace(/\b[Tt]he quotes ThetaData has\b/g, 'the recorded quotes')
    .replace(/ThetaData(?:'s|’s|&apos;s) recorded/g, 'the recorded')
    .replace(/\bfrom ThetaData\b/g, 'from the live data')
    .replace(/ThetaData/g, 'Live data');
}

/* WHAT A VIEWER READS (owner, 2026-10-31: "design the cards better to say model 1-2-3 etc and never say the model %
   or anything in compass"). The engine keeps its own words above (the record, the golden and old rows read them);
   every page shows these: Model 1 is the entry tree that calls the Core and Wing books, Model 2 is the runner tree
   (when it clears on a call, Model 2 rides it), Model 3 is the late sweep's rule. No score and no percentage of a
   score is ever shown. */
export const MODEL_WORD = { 1: 'Model 1', 2: 'Model 2', 3: 'Model 3' } as const;
export const RIDING_WORD = 'Model 2 riding';

/** The model a call came from, by its book: Core and Wing are Model 1's books, the late sweep is Model 3. */
export function modelOfBook(book: 'A' | 'B' | 'C' | 'R' | string): string {
  return book === 'R' ? 'Model Risk' : book === 'C' ? MODEL_WORD[3] : book === 'A' || book === 'B' ? MODEL_WORD[1] : '';
}

/** A recorded call's model as a row reads it: "Model 1", "Model 1 · Model 2 riding" (a runner, or the far wing, whose
    exit Model 2 rides), "Model 3" or "Model Risk". Never a book letter, never a score. */
export function modelWordOf(call: { book: 'A' | 'B' | 'C' | 'R' | string; runner?: boolean }): string {
  const word = modelOfBook(call.book);
  return (call.book === 'A' || call.book === 'B') && (call.runner || call.book === 'B') ? `${word} · ${RIDING_WORD}` : word;
}

/** The model a card came from, by its band; empty for a contract that is not a call. */
export function modelOfBand(band: string | undefined): string {
  return band === 'lottery' ? MODEL_WORD[3] : band === 'top' || band === 'wing' ? MODEL_WORD[1] : '';
}

/* The score buckets the study names ("65–70.67%"), lowest first: shown as bands, never as a score */
const SCORE_BUCKETS = ['0–30%', '30–40%', '40–50%', '50–60%', '60–65%', '65–70.67%', '70.67–75%', '75–80%', '80–100%'];
const LINE_PCT = `${(P1_MIN * 100).toFixed(2)}%`;

/** A score bucket as a viewer reads it: "Band 7 · over the line". */
export function bandWord(bucket: string): string {
  const i = SCORE_BUCKETS.indexOf(bucket);
  if (i < 0) return /^Band \d/.test(bucket) ? bucket : 'A score band';
  const lo = Number(bucket.split('–')[0]);
  return `Band ${i + 1}${lo + 1e-9 >= P1_MIN * 100 ? ' · over the line' : ''}`;
}

/** The engine's and the study's sentences without a model score in them: a bucket is a band, the threshold is "the
    line", a cut is a cut, and a mean score or a score gap is dropped. Outcome rates (took, returns) stay. */
export function scoreFree(text: string): string {
  return text
    .replace(/A call needs \d+(?:\.\d+)?%\./g, 'A call needs Model 1 to clear its line.')
    .replace(/\b\d{1,3}(?:\.67)?–\d{1,3}(?:\.67)?%/g, m => bandWord(m))
    .replace(/ \(mean \d+(?:\.\d+)?%\)/g, '')
    .replace(/ vs \d+(?:\.\d+)?% scored \([^)]*\)/g, '')
    .replace(/threshold \d+(?:\.\d+)?% → \d+(?:\.\d+)?%/g, 'threshold: move the line')
    .replace(new RegExp(LINE_PCT.replace('.', '\\.'), 'g'), 'the line')
    .replace(/\bbest \d+(?:\.\d+)?%:/g, 'best cut:')
    .replace(/\bat or over \d+\.\d\d%/g, 'at or over that cut')
    .replace(/\bat \d+\.\d\d%:/g, 'at that cut:')
    .replace(/\bbeat \d+\.\d\d%/g, 'beat the line');
}

/** Engine text as a viewer reads it: the record's names (userWords) turned into Model 1, 2 and 3, no vendor, no
    score. The feeds run every Compass answer through it. */
export function viewerWords(text: string): string {
  const one = MODEL_WORD[1];
  return scoreFree(userWords(text))
    .replace(new RegExp(`\\b${MODEL_1_NAME}\\b`, 'g'), one)
    .replace(new RegExp(`\\b${MODEL_2_NAME}\\b`, 'g'), MODEL_WORD[2])
    .replace(new RegExp(`\\b(?:${BOOK_NAME.A}|${BOOK_NAME.B})\\b`, 'g'), one)
    .replace(new RegExp(`\\b${BOOK_NAME.C}\\b`, 'g'), MODEL_WORD[3])
    .replace(/\bModel 1(?:, | and | or |\/)Model 1\b/g, one)
    /* no fees in Compass: a review written before that rule still names them */
    .replace(/, fees [−-]\$\d+(?:\.\d+)?/g, '')
    .replace(/\bModel 1 (\d+)\. Model 1 (\d+)\./g, (_, a, b) => `${one} ${Number(a) + Number(b)}.`);
}

export function printOf(root: string): string {
  return PRINT_OF[root] ?? root;
}

/** The minutes after 09:30 the trees were trained on: column 0 spans 15 to 330 in both models. The scan scores every
    session mark regardless; outside these minutes the row goes into the trees as it is, and the board says so. */
export const MODEL_T_MIN = 15;
export const MODEL_T_MAX = 330;

export function inModelWindow(t: number): boolean {
  return Number.isFinite(t) && t >= MODEL_T_MIN && t <= MODEL_T_MAX;
}

/** Kept so older notes still name them. The entry gate does not use them: a call can fire any minute the root's
    tape is open, from that session's open until its flat. */
export const ENTRY_MIN_LEFT = 0;
export const ENTRY_MIN_SINCE = 0;

/** The flat of a session as minutes after 09:30: 385 (15:55) on a full day, five minutes before an early close
    (12:55 is 205 on a 13:00 close). `closeMin` is the close as a minute of the day, or null on a full day. */
export function flatTOf(closeMin: number | null | undefined): number {
  const close = closeMin != null && closeMin < 16 * 60 ? closeMin : 16 * 60;
  return close - 5 - (9 * 60 + 30);
}

/** The option tape sessions a call can be made in. */
export type TapeSession = 'overnight' | 'pre' | 'regular' | 'curb';
export const SESSION_WORD: Record<TapeSession, string> = { overnight: 'Overnight', pre: 'Pre-market', regular: 'Regular', curb: 'Curb' };

const OVERNIGHT_OPEN = 20 * 60 + 15;
const PRE_OPEN = 7 * 60 + 30;
const HALT_AT = 9 * 60 + 25;
const REGULAR_OPEN = 9 * 60 + 30;
const CURB_CLOSE = 17 * 60;

/** Where a root's own option tape ends, as minutes of the New York day (compassSession tapeClockOf reads them from
    the session module): `curbEnd` is when its options stop after a full day's 16:00 close (17:00 for SPX, XSP and VIX;
    16:15 for RUT, NDX and the names that trade to 16:15; 16:00, no curb, for every other name); `gthEnd` is when the
    overnight index session holding the mark ends (09:25, or 11:30 on a holiday morning that has Global Trading Hours,
    when no regular session follows that day); `shut` when nothing trades at the mark. Left out, the curb runs to 17:00
    and the overnight session to 09:25. */
export interface TapeClock {
  curbEnd?: number;
  gthEnd?: number;
  /** No tape at all at the mark (a holiday or a weekend outside Global Trading Hours) */
  shut?: boolean;
}

/** The session a New York minute of the day is in, for a root with the overnight index session (SPX, XSP, VIX, RUT:
    20:15 to 09:25) or without it (the equity options' pre-market from 07:30), with the minutes since that session
    opened and the minutes left to its flat (five minutes before it ends: 09:20 before the 09:25 halt, 15:55 or five
    before an early close, five before the root's own curb ends: 16:55, or 16:10 for a 16:15 name). Null in the halt,
    after the curb and outside a root's tape. `closeMin` is the regular close (minute of the day), 16:00 when null;
    `clock` the root's own tape ends (TapeClock). On a holiday morning with Global Trading Hours (`clock.gthEnd` past
    09:25) the overnight session runs to that end and nothing else trades that day. */
export function tapeSession(minuteOfDay: number, overnightRoot: boolean, closeMin: number | null = null, clock: TapeClock = {}): { kind: TapeSession; since: number; left: number } | null {
  if (clock.shut) return null;
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const close = closeMin != null && closeMin < 16 * 60 ? closeMin : 16 * 60;
  const gthEnd = clock.gthEnd != null && clock.gthEnd > HALT_AT ? clock.gthEnd : HALT_AT;
  const curbEnd = clock.curbEnd ?? CURB_CLOSE;
  const preFlat = gthEnd - 5;
  if (m >= OVERNIGHT_OPEN || m < gthEnd) {
    if (overnightRoot) {
      const since = m >= OVERNIGHT_OPEN ? m - OVERNIGHT_OPEN : m + 1440 - OVERNIGHT_OPEN;
      return { kind: 'overnight', since, left: m >= OVERNIGHT_OPEN ? 1440 - m + preFlat : preFlat - m };
    }
    if (gthEnd === HALT_AT && m >= PRE_OPEN && m < HALT_AT) return { kind: 'pre', since: m - PRE_OPEN, left: preFlat - m };
    return null;
  }
  /* a holiday morning's Global Trading Hours end the day: no regular session, no curb */
  if (gthEnd !== HALT_AT) return null;
  if (m < REGULAR_OPEN) return null;
  if (m < close) return { kind: 'regular', since: m - REGULAR_OPEN, left: close - 5 - m };
  /* an early close has no curb: nothing trades after it until the overnight session. The curb ends where the root's
     options stop (it used to run every root to 17:00, so a 16:15 name took entries to 16:54 with a 16:55 flat) */
  if (close === 16 * 60 && m < curbEnd) return { kind: 'curb', since: m - close, left: curbEnd - 5 - m };
  return null;
}

/** The minute of the day a t (minutes after 09:30, negative before it) stands for. */
const minuteOfT = (t: number) => t + 9 * 60 + 30;

/** The time-of-day gate on a Book A or B entry: any minute the root's own tape is open, from that session's open
    until its flat. Regular session: 09:30 to 15:54 (12:54 on a 13:00 close). Overnight (the index roots): 20:15 to
    09:19. Pre-market (the equity options): 07:30 to 09:19. The curb: 16:00 to 16:54. The flat itself is not an entry.
    A mark outside the trees' trained minutes (t 15 to 330) may call; the call is marked "outside trained hours"
    (inModelWindow). `flatT` is the regular flat as t (flatTOf); `clock` the root's own tape ends (TapeClock). Same
    rule for 0DTE and 1–7 DTE. */
export function entryTimeOk(t: number, flatT = FLAT_T, overnightRoot = true, clock: TapeClock = {}): boolean {
  if (!Number.isFinite(t)) return false;
  const w = tapeSession(minuteOfT(t), overnightRoot, minuteOfT(flatT + 5), clock);
  return !!w && w.left > 0;
}

/** Minutes from the mark to its session's flat (NaN outside a session): the theta burn and the call's own flat. */
export function minutesToFlat(t: number, flatT = FLAT_T, overnightRoot = true, clock: TapeClock = {}): number {
  const w = tapeSession(minuteOfT(t), overnightRoot, minuteOfT(flatT + 5), clock);
  return w ? w.left : NaN;
}

/** The session a mark belongs to, for the record and the track record. */
export function sessionKindOf(t: number, flatT = FLAT_T, overnightRoot = true, clock: TapeClock = {}): TapeSession | null {
  return tapeSession(minuteOfT(t), overnightRoot, minuteOfT(flatT + 5), clock)?.kind ?? null;
}

/** The roots with the overnight index session. */
export const OVERNIGHT_ROOTS: readonly string[] = ['SPX', 'SPXW', 'XSP', 'VIX', 'RUT', 'RUTW'];
export const OUTSIDE_TRAINED_WORD = 'Outside trained hours';

/** Every 5 minutes while an option tape is open, plus the last minute before a 0 DTE stop.
 *  09:29 is VIX. 15:59 is a 16:00 stop. 16:14 is a 16:15 stop. The halt sends nothing else. */
function scanMark(minuteOfDay: number): boolean {
  if (minuteOfDay === 9 * 60 + 29) return true;
  if (minuteOfDay === 15 * 60 + 59) return true;
  if (minuteOfDay === 16 * 60 + 14) return true;
  return minuteOfDay % BOOK_A_STEP === 0;
}

/** Some root can take a new ticket at this New York minute. Sunday night is overnight. Saturday is shut. */
export function sessionScanOpen(minuteOfDay: number, weekday: number): boolean {
  if (weekday === 6) return false;
  if (weekday === 0 && minuteOfDay < 20 * 60 + 15) return false;
  if (weekday === 5 && minuteOfDay >= 17 * 60) return false;
  if (minuteOfDay >= 9 * 60 + 25 && minuteOfDay < 9 * 60 + 30) return minuteOfDay === 9 * 60 + 29;
  if (!scanMark(minuteOfDay)) return false;
  if (minuteOfDay >= 20 * 60 + 15 || minuteOfDay < 9 * 60 + 25) return true;
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 17 * 60;
}

/** t is minutes after 09:30, and it is negative before the cash open. The morning window is not this. */
export function onScanGrid(t: number): boolean {
  if (!Number.isFinite(t)) return false;
  const minute = Math.round(t + 9 * 60 + 30);
  if (minute < 0 || minute >= 24 * 60) return false;
  if (minute >= 9 * 60 + 25 && minute < 9 * 60 + 30) return minute === 9 * 60 + 29;
  if (!scanMark(minute)) return false;
  if (minute >= 20 * 60 + 15 || minute < 9 * 60 + 25) return true;
  return minute >= 9 * 60 + 30 && minute < 17 * 60;
}

function asIso(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  return ymd;
}

/** Trading sessions from the session date to the expiration: weekdays that are not market holidays
    (core/calendar MARKET_HOLIDAYS). Same day is 0. A weekday guess is not a listing. Wednesday 2026-11-25 to Friday
    11-27 is 1 (Thanksgiving is not a session); it was 2 when holidays were counted. */
export function weekdayDte(sessionYmd: string, expiryYmd: string): number {
  const from = Date.parse(`${asIso(sessionYmd)}T00:00:00Z`);
  const to = Date.parse(`${asIso(expiryYmd)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return NaN;
  let n = 0;
  for (let t = from + 86400000; t <= to; t += 86400000) {
    const d = new Date(t);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (MARKET_HOLIDAYS.has(d.toISOString().slice(0, 10))) continue;
    n += 1;
  }
  return n;
}

/** Published T. The scan minute, a 16:00 expiration. Not the wall clock. Not DTE.
    Retrain item: for a 1 to 7 DTE contract this is still only today's minutes left (the training rows were built the
    same way, so the live input matches the trees and must not change until they are retrained); the true time to a
    Friday expiry from Monday is about five sessions, not hours. The greeks, IV and theta columns inherit it. */
export function yearFrac(t: number): number {
  const mins = Math.max(0, SESSION_MIN - t);
  return mins / (SESSION_MIN * YEAR_SESSIONS) + T_EPS;
}

/** The feature column. Always 390 - t, even when DTE is 1 to 7. */
export function minutesLeftCol(t: number): number {
  return SESSION_MIN - t;
}

/* ---- Feature version 2 (Group B, 2026-11-05): one trading-time clock ----------------------------------------------
   Version 1 (above, the shipped trees' inputs) reads T as today's minutes to a 16:00 close, floored at zero: an
   evening, overnight or curb mark gets T = 1e-6 years (the vol solve fails, the greeks fall back, column 15 goes to
   -300), a half day's 12:30 reads 210 minutes instead of 30, and a 1–7 DTE contract counts only today (its solved vol
   about 2.4× too high). Version 2 reads T on one trading-time clock for every mark and contract: the regular-session
   minutes from the mark to the expiry's settlement, every session ahead with its own close (an early close is 210
   minutes), market holidays and weekends skipped. Time outside the regular session (the overnight, the pre-market, the
   curb, a weekend) carries no weight: a mark at 21:00 for tomorrow's 0DTE has one full session (390 minutes) left,
   the same as at 09:30 tomorrow. Every root the engine scores (the same-day book and WEEKLY_FOCUS) is PM-settled, at
   its expiry's close. Column 15 is those minutes; T = minutes / (390 × 252) + 1e-6, the same unit as version 1, so a
   full-day 0DTE mark reads the same T in both versions. scripts/golden/compass-ref.py rebuilds it in Python. */

export const FEATURE_V1 = 1;
export const FEATURE_V2 = 2;
export type FeatureVersion = typeof FEATURE_V1 | typeof FEATURE_V2;

/** Regular-session minutes from an instant to an expiry's settlement (its close), trading time: the rest of today's
    session (all of it before the open, none after the close) and every session after today up to the expiry. 0 once
    the expiry's close has passed. */
export function tradingMinutesTo(expiryIso: string, nowMs: number): number {
  const exp = asIso(expiryIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || !Number.isFinite(nowMs)) return NaN;
  const w = nyWall(nowMs);
  if (exp < w.iso) return 0;
  let total = 0;
  if (isSessionDay(w.iso)) {
    const close = regularCloseMin(w.iso);
    total += Math.max(0, close - Math.max(REGULAR_OPEN_MIN, w.min));
  }
  for (let d = w.iso, i = 0; d < exp && i < 400; i++) {
    d = nextSessionDay(d);
    if (d > exp) break;
    total += regularCloseMin(d) - REGULAR_OPEN_MIN;
  }
  return total;
}

/** The live trees' feature version: version 1 (the shipped trees). Version 2 has no trees (none were trained) and no
    evidence; it runs in the shadow only (docs/compass-group-b.md). */
export const LIVE_FEATURE_VERSION: FeatureVersion = FEATURE_V1;

/* ---- Group B switches: every Group B change that would move a live score or gate is off unless its switch is on ----
   COMPASS_ATM_FRESH=1   B4: the ATM pair reads only valid quotes stamped within 90 s (off: every board row, as before)
   COMPASS_GATE_DECAY=1  B2b: off a full regular day the theta-burn gate is the repriced decay to the session's own flat
                         on the trading clock (off: the trained 16:00 theta check everywhere, as before)
   COMPASS_V2_SHADOW=1   the version 2 shadow scorer (compassShadow; inert until version 2 trees ship with their hashes)
   Strategy choices for the owner (2026-11-06 audit), off unless switched on; each moves which calls are made or how they
   are managed, with no outcome evidence behind it (Model 1 has none on history either way):
   COMPASS_REVERSAL_AFTER_ENTRY=1  the reversal exit reads the stock's move since the entry only (off: the last five
                         minutes, which on the first minutes of a hold are mostly the minutes before the entry)
   COMPASS_MAX_OPEN=N    at most N official Book A/B calls open at once (off: one a root, no cap; 2026-11-06 fired six in
                         one mark and three the next, right after the blind window)
   Read through globalThis: vite's define turns a bare process.env into {} (vite.config.ts), server side too. */
export type GroupBSwitch = 'COMPASS_ATM_FRESH' | 'COMPASS_GATE_DECAY' | 'COMPASS_V2_SHADOW' | 'COMPASS_REVERSAL_AFTER_ENTRY';
const switchOverride = new Map<GroupBSwitch, boolean>();
export function groupBOn(name: GroupBSwitch): boolean {
  const forced = switchOverride.get(name);
  if (forced !== undefined) return forced;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return env[name] === '1';
}
/** COMPASS_MAX_OPEN: the most official Book A/B calls open at once, or Infinity (off, the default). */
let maxOpenOverride: number | null = null;
export function maxOpenCalls(): number {
  if (maxOpenOverride != null) return maxOpenOverride;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const n = Math.floor(Number(env.COMPASS_MAX_OPEN));
  return n >= 1 ? n : Infinity;
}
/** Proofs only: force COMPASS_MAX_OPEN (null: back to the environment). */
export function setMaxOpenCalls(n: number | null): void {
  maxOpenOverride = n;
}
/** Proofs only: force a switch on or off (null: back to the environment). */
export function setGroupBSwitch(name: GroupBSwitch, on: boolean | null): void {
  if (on == null) switchOverride.delete(name);
  else switchOverride.set(name, on);
}
/** Version 2's trees (research/groupb/train.py) and the lines they call at (set on the training sessions to the
    current trees' operating point). The shadow (compassShadow) reads them; empty hashes load nothing. */
export const V2_ENTRY_FILE = '/models/model_entry_v2.txt';
export const V2_RUNNER_FILE = '/models/model_runner_v2.txt';
export const V2_ENTRY_SHA = '';
export const V2_RUNNER_SHA = '';
export const P1_MIN_V2 = Infinity;
export const PRUN_MIN_V2 = Infinity;

/** Version 2's T in years from the trading minutes left (tradingMinutesTo). */
export function yearFracV2(tradingMinutes: number): number {
  return Math.max(0, tradingMinutes) / (SESSION_MIN * YEAR_SESSIONS) + T_EPS;
}

/** Version 2's column 15: the trading minutes to the expiry. */
export function minutesLeftColV2(tradingMinutes: number): number {
  return tradingMinutes;
}

export function quoteValid(bid: number, ask: number): boolean {
  return bid >= 0 && ask > 0 && ask >= bid;
}

/* ---- VALIDITY CHECKS: is the quote real data? Not limits. ----------------------------------------------------------
   A contract is chosen only on a quote that can be traded as read: two-sided (a bid over zero and an ask over the bid),
   stamped recently (QUOTE_MAX_AGE_MS), with size displayed on both sides when the feed says what it is. None of these
   is a price, a spread or a size someone picked: a quote that fails one is not a quote. */

/** Validity: a two-sided quote, a bid over zero and an ask over the bid (crossed, locked, one-sided or missing: no) */
export function quoteTradable(bid: number, ask: number): boolean {
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid;
}

/** Validity: the quote is stamped no older than QUOTE_MAX_AGE_MS before `now` and not from the future (a minute's grace
    for an answer that waited for its slot) */
export function quoteFreshAt(quotedAt: number | undefined, now: number): boolean {
  return !!quotedAt && quotedAt <= now + 60_000 && now - quotedAt <= QUOTE_MAX_AGE_MS;
}

/** Validity: size displayed on both sides. A feed that does not say (undefined) is not refused for it. */
export function sizeShown(bidSize: number | undefined, askSize: number | undefined): boolean {
  if (bidSize == null && askSize == null) return true;
  return Number(bidSize) > 0 && Number(askSize) > 0;
}

/** Validity, all of it: tradable, fresh at `now`, size shown */
export function quoteUsable(q: { bid: number; ask: number; quotedAt?: number; bidSize?: number; askSize?: number }, now: number): boolean {
  return quoteTradable(q.bid, q.ask) && quoteFreshAt(q.quotedAt, now) && sizeShown(q.bidSize, q.askSize);
}

/** Model 1's trained quotes (BID_MIN, SPREAD_MAX above): a bid over $0.15 and a spread within 8% of the mid. The trees
    score nothing else. This is the model's definition, not a limit on what Compass may call. */
export function inModel1Domain(bid: number, ask: number): boolean {
  if (!(bid > BID_MIN) || !quoteValid(bid, ask)) return false;
  const mid = (ask + bid) / 2;
  if (!(mid > 0)) return false;
  return (ask - bid) / mid <= SPREAD_MAX + SPREAD_EPS;
}

/** The old name of inModel1Domain (study, contract page and Weigher read it under this name) */
export const spreadPass = inModel1Domain;

export function ivFeature(iv: number): number {
  return iv > IV_FEATURE_MIN ? iv : NaN;
}

/** Contract IV, else ATM IV, else 0.30. */
export function greekVol(contractIv: number, atmIv: number): number {
  if (contractIv > IV_FEATURE_MIN) return contractIv;
  if (atmIv > IV_FEATURE_MIN) return atmIv;
  return IV_FALLBACK;
}

export function f32(x: readonly number[]): number[] {
  return x.map(v => (v == null || Number.isNaN(v) ? NaN : Math.fround(v)));
}

/** Nearest strike. An exact tie takes the lower strike. */
export function atmStrike(strikes: readonly number[], spot: number): number {
  let best = NaN;
  let dist = Infinity;
  for (const k of strikes) {
    const d = Math.abs(k - spot);
    if (d < dist - 1e-9 || (Math.abs(d - dist) <= 1e-9 && (Number.isNaN(best) || k < best))) {
      dist = d;
      best = k;
    }
  }
  return best;
}

export function strikeDistance(strikes: readonly number[], spot: number, strike: number): number {
  const atm = atmStrike(strikes, spot);
  const ordered = [...new Set(strikes)].sort((a, b) => a - b);
  const ai = ordered.findIndex(k => Math.abs(k - atm) < 1e-9);
  const si = ordered.findIndex(k => Math.abs(k - strike) < 1e-9);
  if (ai < 0 || si < 0) return NaN;
  return Math.abs(si - ai);
}

export function strikeSpan(spot: number, strikes: readonly number[], index: boolean): number {
  if (index) return 4;
  const ordered = [...new Set(strikes.filter(k => k > 0))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const g = ordered[i] - ordered[i - 1];
    if (g > 1e-9) gaps.push(g);
  }
  if (!gaps.length || !(spot > 0)) return 4;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const step = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  if (!(step > 0)) return 4;
  return Math.min(12, Math.max(4, Math.ceil((0.06 * spot) / step)));
}

export function bookBRange(span: number): { inner: number; outer: number } {
  const inner = Math.max(8, span + 1);
  return { inner, outer: inner + 4 };
}

/** How far from the money the weekly read reaches: Book B's outer strike at the widest span (12 → 13 to 17). */
export const WEEKLY_STRIKES = bookBRange(12).outer;

export function bookAPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, p1: number, flatT = FLAT_T, overnightRoot = true, clock: TapeClock = {}): boolean {
  return onScanGrid(t)
    && entryTimeOk(t, flatT, overnightRoot, clock)
    && dist <= span
    && dte >= DTE_MIN && dte <= DTE_MAX
    && inModel1Domain(bid, ask)
    && p1 >= P1_MIN;
}

/** A wing by its shape: |delta| at or under WING_DELTA_MAX. NaN (the delta did not solve) is not a wing. */
export function wingShape(absDelta: number): boolean {
  return Number.isFinite(absDelta) && absDelta <= WING_DELTA_MAX + 1e-12;
}

/** Book B, the far wing: in the band past the span, a wing by its delta (wingShape; it was an ask of $1.00 or less),
    at most half its ask of 30 minutes earlier, in Model 1's trained quotes, over the line. `absDelta` is the contract's
    |delta| at its own IV on the trading clock (compassCost deltaOf). */
export function bookBPass(t: number, dist: number, span: number, dte: number, bid: number, ask: number, priorBid: number, priorAsk: number, absDelta: number, p1: number, flatT = FLAT_T, overnightRoot = true, clock: TapeClock = {}): boolean {
  const band = bookBRange(span);
  return onScanGrid(t)
    && entryTimeOk(t, flatT, overnightRoot, clock)
    && dte >= DTE_MIN && dte <= DTE_MAX
    && dist >= band.inner && dist <= band.outer
    && wingShape(absDelta)
    && inModel1Domain(bid, ask)
    && quoteValid(priorBid, priorAsk)
    && priorAsk > 0
    && ask <= BOOK_B_HALVE * priorAsk
    && p1 >= P1_MIN;
}

export function runnerFlag(prun: number): boolean {
  return prun >= PRUN_MIN;
}

/** Hard stop. Later ratchets only move it up. */
function hardStop(entryAsk: number): number {
  return entryAsk * STOP_KEEP;
}

export function stopAfter(entryAsk: number, peak: number, runner: boolean): number {
  let stop = hardStop(entryAsk);
  /* break-even: once the bid has reached 1.25x the ask, the stop moves up to the ask itself */
  if (peak >= entryAsk * BE_PEAK) stop = Math.max(stop, entryAsk);
  if (!runner) return stop;
  if (peak >= entryAsk * TP1_BID) stop = Math.max(stop, entryAsk * TP1_STOP);
  if (peak >= entryAsk * TP2_BID) stop = Math.max(stop, entryAsk * TP2_STOP);
  if (peak >= entryAsk * TP3_BID) stop = Math.max(stop, entryAsk * TP3_STOP);
  if (peak >= entryAsk * TP4_BID) stop = Math.max(stop, peak * TP4_TRAIL);
  return stop;
}

/** A target as a price: the ask times its multiple, rounded up to the cent, so a target is never under its multiple
    (an ask of 0.33 takes profit at 0.50, +51.5%; toFixed read 0.495 as 0.49, +48.5%). The epsilon keeps an exact cent
    (1.00 × 1.50 = 1.50) from rounding up on the float's last bit. */
export function targetPx(entryAsk: number, multiple: number): number {
  return Number((Math.ceil(entryAsk * multiple * 100 - 1e-6) / 100).toFixed(2));
}

/** The 1.50× take-profit price of a fill: every place that shows or settles it reads this one. */
export function takeProfitPx(entryAsk: number): number {
  return targetPx(entryAsk, TP1_BID);
}

/** Each minute, in order. Stop first, then a non-runner at 1.50 × the ask. There is no sale because a clock hit 55
    minutes. */
export function treeExit(entryAsk: number, bid: number, peak: number, runner: boolean): { why: string; px: number } | null {
  if (!(entryAsk > 0) || !(bid >= 0) || !Number.isFinite(bid)) return null;
  const stop = stopAfter(entryAsk, peak, runner);
  if (bid <= stop) return { why: 'stop', px: bid };
  const tp = takeProfitPx(entryAsk);
  if (!runner && bid >= tp) return { why: 'tp1', px: tp };
  return null;
}

/** After the entry. The stock's last 5 minutes reversed against the side by 0.40% or more. */
export function reversalLine(entryAsk: number, bid: number, side: 'C' | 'P', ret5: number): string | null {
  if (!(entryAsk > 0) || !(bid >= 0) || !Number.isFinite(ret5)) return null;
  const against = side === 'C' ? ret5 <= -REVERSAL : ret5 >= REVERSAL;
  if (!against) return null;
  if (bid >= entryAsk) return 'Get out early. The stock reversed over the last 5 minutes.';
  if ((entryAsk - bid) / entryAsk <= 0.15) return 'Get out. Small loss. The stock reversed over the last 5 minutes.';
  return 'Get out. The stock reversed over the last 5 minutes.';
}

/** One-second lottery. No stop. A bid of 0 is held. 3× inside 120s is checked before 2× inside 30s. The caller flats at 15:50, including a bid of 0. */
export function lotteryExit(entryAsk: number, bid: number, seconds: number): { why: string; px: number } | null {
  if (!(entryAsk > 0) || !Number.isFinite(bid)) return null;
  if (seconds >= 0 && seconds <= LOTTERY_X3_SEC && bid >= LOTTERY_X3 * entryAsk) return { why: '3×', px: targetPx(entryAsk, LOTTERY_X3) };
  if (seconds >= 0 && seconds <= LOTTERY_X2_SEC && bid >= LOTTERY_X2 * entryAsk) return { why: '2×', px: targetPx(entryAsk, LOTTERY_X2) };
  return null;
}

/** Model 3's live rule while COMPASS_M3_SHAPE is off (unchanged from before the limits work): a bid over $0.15, an ask
    of $1.65 or less, a spread within 8%. */
export function lotteryEntry(bid: number, ask: number): boolean {
  return bid > BID_MIN && ask > 0 && ask <= LOTTERY_ASK_MAX && ask >= bid && inModel1Domain(bid, ask);
}

/** Model 3's contract with COMPASS_M3_SHAPE on: a tradable quote at the money or out of it, |delta| at or under
    LOTTERY_DELTA_MAX (no bid floor, spread cap or price cap). `absDelta` as in bookBPass. */
export function lotteryShape(bid: number, ask: number, absDelta: number): boolean {
  return quoteTradable(bid, ask) && Number.isFinite(absDelta) && absDelta <= LOTTERY_DELTA_MAX + 1e-12;
}

/** Book C. 15:20:00 through 15:49:59 ET: 40 to 10 minutes before the close, so 12:20:00 through 12:49:59 on a 13:00
    early close (`closeMin`, the session's close as a minute of the day; null or 16:00 on a full day). The scan's sweep
    and the scorer's gate read this one window (the gate used to stay at 15:20 on an early close, so the 12:20 sweep
    was marked done and called nothing). */
export function inLottery(minuteOfDay: number, second: number, closeMin: number | null = null): boolean {
  const s = minuteOfDay * 60 + second;
  if (closeMin != null && closeMin < 16 * 60) return s >= (closeMin - 40) * 60 && s < (closeMin - 10) * 60;
  return s >= (15 * 60 + 20) * 60 && s < (15 * 60 + 50) * 60;
}

const HIGH_IMPACT = /\b(interest rate|fomc|cpi|pce|employment|unemployment|payroll|nonfarm|consumer price)\b/i;

/** Live only. Fifteen minutes before a named release until fifteen minutes after. */
export function releaseBlocks(title: string, releaseMin: number, nowMin: number): boolean {
  if (!HIGH_IMPACT.test(title) || !Number.isFinite(releaseMin)) return false;
  return nowMin >= releaseMin - 15 && nowMin <= releaseMin + 15;
}

/** Unchanged spot. Dollar theta is the theta column times 365. Price decay over dt years is |theta year| × dt.
    Reject when that decay reaches the 0.5322 haircut before the flat. */
/** Version 2's theta burn (and version 1's off the regular full day): the repriced decay to the flat (compassFeatures
    decayOver) reaches the 0.5322 haircut of the ask. */
export function decayBurns(decay: number, ask: number): boolean {
  return ask > 0 && Number.isFinite(decay) && decay >= STOP_HAIRCUT * ask;
}

export function thetaBurns(thetaPerDay: number, gamma: number, ask: number, dtYears: number): boolean {
  if (!(ask > 0) || !(dtYears > 0) || !(gamma > 0) || !Number.isFinite(thetaPerDay)) return false;
  const thetaYear = thetaPerDay * 365;
  return Math.abs(thetaYear) * dtYears >= STOP_HAIRCUT * ask;
}
