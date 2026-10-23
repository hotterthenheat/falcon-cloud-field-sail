/*
==================================================
  SLAYER TERMINAL - EARNINGS ENGINE (earnings.ts)
  The earnings hub's brain: for every upcoming
  report, price the implied move against realized
  history, weigh revisions, flow and technicals,
  and land on PLAY / FADE / SKIP with the strategy
  that matches the mispricing.
==================================================
*/

import { dayKey, hGauss, h01, hRange } from '../core/rng';
import { isoDate } from '../core/calendar';
import { tickerSentiment } from './news';
import { UNIVERSE } from './universe';
import type { Sector } from './universe';
import { SECTOR_UNIVERSE } from './darkpool';
import { SP500_NYSE } from './sp500';
import { tickerName } from './tickers';
import { boardMondayIso, nyTodayIso } from './nyDate';

export type EarningsVerdict = 'PLAY' | 'FADE' | 'SKIP';
export type ReportSlot = 'BMO' | 'AMC';

export interface EarningsEvent {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  /** Sessions until the report, 0 = today */
  daysOut: number;
  dateLabel: string;
  /** 1 = Monday … 5 = Friday (reports never land on weekends) */
  weekday: number;
  /** 0 = this calendar week, 1 = next — the calendar board's two pages */
  weekIdx: 0 | 1;
  /** true = company has officially set the date; false = still an analyst estimate */
  confirmed: boolean;
  /** A name the room would recognise — the board holds these; the list and the grid hold every report (Noah,
      2026-10-13: the vendor's calendar carries far more names a day than a board can show). See isKnownName. */
  known: boolean;
  slot: ReportSlot;
  /** Straddle-implied move for the print, % */
  impliedMovePct: number;
  /** Market cap in dollars, when the calendar carried one. The board ranks by this, not by the size of the move. */
  marketCap?: number | null;
  /** Average absolute move over the last 8 prints, % */
  histAvgMovePct: number;
  /** The last 8 earnings-day moves, signed %, oldest first — the receipts */
  pastMoves: { label: string; movePct: number }[];
  /** implied ÷ realized — the mispricing everything hangs on */
  richness: number;
  /** The street's EPS estimate for the upcoming report, when the vendor's row for it carries one */
  nextEpsEst?: number | null;
  /** % of the last 8 quarters beaten */
  beatRate8q: number;
  /** −1…+1 — analyst estimate drift into the print */
  revisionTrend: number;
  ivRank: number;
  /** 0–100 setup quality into the report */
  technicalScore: number;
  /** −1…+1 — options flow lean into the event */
  flowLean: number;
  verdict: EarningsVerdict;
  strategy: string;
  rationale: string;
  /** YYYY-MM-DD when the row came off the feed. */
  iso?: string;
  /** False until the last prints are in. Absent on the sample, which already has them. */
  history?: boolean;
  /** True once the report is out (its day has passed, or the vendor carries the session's reaction) */
  reported?: boolean;
  /** The stock's move the session after the report, signed % — the vendor's `reaction`, null until it is in */
  actualMovePct?: number | null;
  /** True while actualMovePct is the reacting session's move so far, off the live price (round 9) */
  moveLive?: boolean;
  /** The New York session that reacts to the report: the report day before the open, the next session after the close */
  reactionIso?: string;
  /** How many past reports the usual move is the average of (the live feed; the sample has eight) */
  histCount?: number;
  /** Past reports with both an actual and an estimate, split three ways — an in-line print is not a beat */
  beatCount?: number;
  inlineCount?: number;
  missCount?: number;
  /** False when the vendor has no time for the report ("unknown") — the slot is then not stated */
  timeKnown?: boolean;
  /** True when the date is the vendor's estimate, not one the company set */
  estimated?: boolean;
  /** True when the name is a fund (an ETF or a trust) — funds do not report earnings */
  fund?: boolean;
  /** A second share class whose reports the vendor files under another symbol (BBDO → BBD) */
  classOf?: string;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today rolled forward to the nearest trading day. */
function tradingToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/** Advance N trading sessions from (trading) today — weekends never count. */
function tradingDate(sessionsOut: number): Date {
  const d = tradingToday();
  let left = sessionsOut;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

function mondayOf(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
}

function labelFor(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** The calendar date of a board cell — the week list needs the real day to
    seat the macro calendar beside the reports (2026-09-03). New York's calendar, from the same Monday the feed starts
    its fortnight on (nyDate.ts boardMondayIso) — never the browser's clock. The Date is local midnight of that day. */
export function weekDayDate(weekIdx: 0 | 1, weekday: number): Date {
  const [y, m, d] = boardMondayIso().split('-').map(Number);
  return new Date(y, m - 1, d + weekIdx * 7 + (weekday - 1));
}

/** Column header for the week board — date math stays in one module. "Today" is New York's today, never on a weekend. */
export function weekDayLabel(weekIdx: 0 | 1, weekday: number): { label: string; isToday: boolean } {
  const d = weekDayDate(weekIdx, weekday);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { label: labelFor(d), isToday: iso === nyTodayIso() };
}

/** "Q2'26"-style labels for the last N quarters, oldest first. */
function quarterLabels(count: number): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1;
  let y = now.getFullYear() % 100;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`Q${q}'${String(y).padStart(2, '0')}`);
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

/** Eight signed earnings-day moves whose average magnitude IS histAvgMovePct —
    the chart and the number can never disagree. */
function pastMovesFor(seed: (tag: string) => string, histAvg: number): { label: string; movePct: number }[] {
  const labels = quarterLabels(8);
  const raw = labels.map((_, i) => {
    const mag = 0.35 + h01(seed(`pm-${i}`)) * 1.3;
    const sign = h01(seed(`pmd-${i}`)) > 0.45 ? 1 : -1;
    return mag * sign;
  });
  const meanAbs = raw.reduce((a, v) => a + Math.abs(v), 0) / raw.length;
  const scale = histAvg / Math.max(meanAbs, 0.01);
  return labels.map((label, i) => ({ label, movePct: Number((raw[i] * scale).toFixed(1)) }));
}

export function decide(e: Omit<EarningsEvent, 'verdict' | 'strategy' | 'rationale'>): Pick<EarningsEvent, 'verdict' | 'strategy' | 'rationale'> {
  const im = e.impliedMovePct.toFixed(1);
  const hm = e.histAvgMovePct.toFixed(1);
  const rich = e.richness;

  // Directional edge: do revisions, flow and the chart agree?
  const dirScore =
    (e.revisionTrend > 0.15 ? 1 : e.revisionTrend < -0.15 ? -1 : 0) +
    (e.flowLean > 0.2 ? 1 : e.flowLean < -0.2 ? -1 : 0) +
    (e.technicalScore >= 62 ? 1 : e.technicalScore <= 40 ? -1 : 0);

  // States, not orders: the strings DESCRIBE the pricing and the sleeves —
  // they never name instruments or tell anyone what to do. The verdict enum
  // stays internal loop-scoring vocabulary.
  if (rich > 1.3) {
    if (Math.abs(dirScore) >= 3) {
      const up = dirScore > 0;
      return {
        verdict: 'PLAY',
        strategy: `Premium is rich AND every sleeve leans ${up ? 'up' : 'down'} together — the rare print where pricing and story both say something.`,
        rationale: `Implied ${im}% vs ${hm}% realized (${rich.toFixed(2)}×) is expensive, but revisions, flow and the chart all point the same way — direction has unanimous support here.`,
      };
    }
    return {
      verdict: 'FADE',
      strategy: `The straddle charges ${im}% for a name that averages ${hm}% — the surprise is already paid for.`,
      rationale: `${rich.toFixed(2)}× realized history, with a ${e.beatRate8q}% beat rate the street already knows. The pricing is the story on this one, not the direction.`,
    };
  }

  if (rich < 0.85) {
    return {
      verdict: 'PLAY',
      strategy: `Implied ${im}% under-prices an ${hm}% average mover — volatility is on sale into this print.`,
      rationale: `Rare setup: the market is charging less than this name historically moves (${rich.toFixed(2)}×). ${
        e.beatRate8q >= 60
          ? `A ${e.beatRate8q}% beat rate adds a directional skew on top.`
          : 'Direction is unclear — the print itself will pick a side.'
      }`,
    };
  }

  if (Math.abs(dirScore) >= 2) {
    const up = dirScore > 0;
    // Describe each sleeve as it actually is — the BALANCE leans, not
    // necessarily all three (the old copy could say "up" beside a -12).
    const rev =
      e.revisionTrend > 0.15
        ? `analyst estimates drifting up (+${(e.revisionTrend * 100).toFixed(0)})`
        : e.revisionTrend < -0.15
          ? `analyst estimates drifting down (${(e.revisionTrend * 100).toFixed(0)})`
          : 'analyst estimates flat';
    const flow =
      e.flowLean > 0.2 ? 'options flow accumulating' : e.flowLean < -0.2 ? 'options flow distributing' : 'options flow quiet';
    return {
      verdict: 'PLAY',
      strategy: `Premium is fair at ${rich.toFixed(2)}× — the story here is directional: the balance of revisions, flow and the chart leans ${up ? 'up' : 'down'}.`,
      rationale: `${rev[0].toUpperCase()}${rev.slice(1)}, ${flow}, chart setup ${
        e.technicalScore >= 62 ? 'constructive' : e.technicalScore <= 40 ? 'heavy' : 'mixed'
      } — the balance leans ${up ? 'up' : 'down'} while pricing stays neutral.`,
    };
  }

  return {
    verdict: 'SKIP',
    strategy: `Fair premium and disagreeing sleeves — no mispricing into this print.`,
    rationale: `${rich.toFixed(2)}× with the directional sleeves split — nothing here argues louder than the day-two reaction will.`,
  };
}

// ---- per-company dossier ----------------------------------------------------

export interface EarningsQuarter {
  label: string;
  epsEst: number;
  epsActual: number;
  epsBeat: boolean;
  /** Beat, in line (equal to the cent) or miss — the live feed's; the sample leaves it off */
  epsResult?: 'beat' | 'inline' | 'miss';
  revEstB: number;
  revActualB: number;
  revBeat: boolean;
  /** The stock's move the session after that report, signed %. Missing on a live row that did not report one. */
  movePct: number;
  /** False when the vendor sent the quarter but not the next-session move. Absent means the figure is known. */
  moveKnown?: boolean;
}

/** One of the name's busiest contracts into the print — market FACT, not an
    idea. The old ContractIdea carried a "why" argument per contract, which
    read as us telling people what to enter (Noah, 2026-08-19: "this is not a
    gambling service... we simply provide information like bloomberg"). */
export interface ActiveContract {
  id: string;
  right: 'CALL' | 'PUT';
  strike: number;
  /** "GS $500 call · exp 07/25" */
  label: string;
  /** Rough mid, dollars per share */
  mid: number;
  volume: number;
  oi: number;
  volOverOi: number;
  ivPct: number;
  /** Strike distance from spot, signed % */
  fromSpotPct: number;
  /** What "spot" is: the last price in the session, else the last regular close ("the Oct 22 close") */
  spotWord?: string;
  /** Move needed by expiry to break even on the mid, % */
  breakevenPct: number;
  /** The contract's expiry as a date key ("2026-09-18") — a row is carried to
      the Weigher as THE contract, and the desk resolves the date on its own
      calendar (2026-09-12; a count of sessions was read there as days) */
  expiry: string;
}

export interface EarningsDossier {
  event: EarningsEvent;
  quarters: EarningsQuarter[];
  /** Market-implied odds the stock closes inside the priced band, % */
  probInsidePct: number;
  probBeyondPct: number;
  /** Direction skew from flow + revisions, % chance the move is up */
  probUpPct: number;
  /** Typical overnight IV deflation after this name reports, % */
  ivCrushPct: number;
  /** Extrinsic value an ATM option typically loses by next open, % */
  premiumLostPct: number;
  /** The 3 busiest calls on the name into the print, by volume */
  activeCalls: ActiveContract[];
  /** The 3 busiest puts */
  activePuts: ActiveContract[];
  /** The vendor's own prints. The sample leaves this off. */
  live?: boolean;
  /** Overnight straddle loss is the vendor's history, not a model. */
  crushKnown?: boolean;
  /** The busiest-contract read has finished. Absent on the sample. */
  contractsReady?: boolean;
  /** The report after the one the page leads with (when that one is already out) */
  nextAfter?: { iso: string; dateLabel: string; slot: ReportSlot; timeKnown: boolean; estimated: boolean; confirmed: boolean; daysOut: number } | null;
}

function roundStrike(px: number, offPct: number): number {
  const step = px > 400 ? 5 : px > 120 ? 2.5 : px > 40 ? 1 : 0.5;
  return Math.round((px * (1 + offPct / 100)) / step) * step;
}

/**
 * @param tick The dossier page's 10s scan counter. Everything structural
 * (event, quarters, strikes, OI) ignores it; the actives' VOLUME grows
 * monotonically with it — a session accumulates, it never gives volume back —
 * and mid/IV wobble gently. OI stays put: open interest only updates
 * overnight, and pretending otherwise would be the tell that this is fake.
 */
export function buildEarningsDossier(ticker: string, tick = 0): EarningsDossier | null {
  /* every report, the crowd's too: a name the calendar's list carries has a page (2026-10-13) */
  const event = everyReport().find(e => e.ticker === ticker.toUpperCase());
  if (!event) return null;

  const day = dayKey();
  const s = (tag: string) => `${event.ticker}-${day}-erd-${tag}`;
  const im = event.impliedMovePct;
  const px = event.price;

  // ---- beats & misses: which quarters beat is pinned to the beat rate ------
  const beats = Math.round((event.beatRate8q / 100) * 8);
  const order = event.pastMoves
    .map((_, i) => ({ i, k: h01(s(`bo-${i}`)) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.i);
  const beatSet = new Set(order.slice(0, beats));

  const epsBase = Math.max(0.2, px / 28);
  const revBase = Math.max(0.8, px * 0.085);
  const quarters: EarningsQuarter[] = event.pastMoves.map((pm, i) => {
    const growth = 1 + i * 0.015;
    const epsEst = epsBase * growth * (0.92 + h01(s(`ee-${i}`)) * 0.16);
    const epsBeat = beatSet.has(i);
    const epsActual = epsEst * (epsBeat ? 1 + 0.015 + h01(s(`ea-${i}`)) * 0.1 : 1 - 0.005 - h01(s(`ea-${i}`)) * 0.07);
    const revEstB = revBase * growth * (0.95 + h01(s(`re-${i}`)) * 0.1) * 0.01;
    const revBeat = h01(s(`rb-${i}`)) > 0.3 ? epsBeat : !epsBeat; // mostly correlated
    const revActualB = revEstB * (revBeat ? 1 + 0.005 + h01(s(`ra-${i}`)) * 0.04 : 1 - 0.002 - h01(s(`ra-${i}`)) * 0.03);
    return {
      label: pm.label,
      epsEst: Number(epsEst.toFixed(2)),
      epsActual: Number(epsActual.toFixed(2)),
      epsBeat,
      revEstB: Number((revEstB * 100).toFixed(2)),
      revActualB: Number((revActualB * 100).toFixed(2)),
      revBeat,
      movePct: pm.movePct,
    };
  });

  // ---- probabilities --------------------------------------------------------
  const probInsidePct = Math.round(65 + h01(s('pin')) * 6);
  const probUpPct = Math.round(Math.max(32, Math.min(68, 50 + event.flowLean * 14 + event.revisionTrend * 10)));

  // ---- IV crush -------------------------------------------------------------
  const ivCrushPct = Math.round(25 + event.ivRank * 0.22 + h01(s('crush')) * 8);
  const premiumLostPct = Math.round(ivCrushPct * (0.72 + h01(s('kept')) * 0.16));

  // ---- most active contracts ------------------------------------------------
  // Information, not ideas (Noah, 2026-08-19): the 3 busiest calls and 3
  // busiest puts by volume, with only market facts on them. ATM trades
  // heaviest; activity decays with distance from spot.
  const expiryLabel = weekDayLabel(event.weekIdx, 5).label.slice(4); // "07/25"
  /* the report week's Friday, as a date the Weigher can list its chain by */
  const expiryKey = isoDate(weekDayDate(event.weekIdx, 5));
  const straddleCost = (px * im) / 100;

  const mkActive = (right: 'CALL' | 'PUT', distPct: number, seed: string): ActiveContract => {
    const strike = roundStrike(px, distPct);
    const away = Math.abs(distPct);
    const decay = Math.exp(-away / (im * 0.9));
    const base = 9000 + px * 16;
    // Session accumulation: starts the view at ~55% of the day's pace and
    // creeps up every scan — monotonic, per-contract rate.
    const grow = 0.55 + 0.45 * (1 - Math.exp(-tick / 60)) + tick * 0.0018 * (0.6 + h01(s(`agr-${seed}`)) * 0.8);
    const dayVolume = Math.round(base * decay * (0.65 + h01(s(`av-${seed}`)) * 0.7));
    const volume = Math.round(dayVolume * grow);
    const oi = Math.round(dayVolume * (1.1 + h01(s(`ao-${seed}`)) * 2.4));
    const phase = h01(s(`aph-${seed}`)) * Math.PI * 2;
    const mid = Math.max(
      0.05,
      straddleCost * (0.52 * Math.exp(-away / (im * 0.75)) + 0.02) * (1 + 0.025 * Math.sin(tick * 0.6 + phase))
    );
    const breakevenPct = away + (mid / px) * 100;
    const ivPct = Math.round(im * 4.4 * (0.88 + h01(s(`ai-${seed}`)) * 0.28) + 1.5 * Math.sin(tick * 0.5 + phase));
    return {
      id: `${right}-${strike}`,
      right,
      strike,
      label: `${event.ticker} $${strike} ${right.toLowerCase()} · exp ${expiryLabel}`,
      mid: Number(mid.toFixed(2)),
      volume,
      oi,
      volOverOi: Number((volume / oi).toFixed(2)),
      ivPct,
      fromSpotPct: Number((((strike - px) / px) * 100).toFixed(1)),
      breakevenPct: Number(breakevenPct.toFixed(1)),
      expiry: expiryKey,
    };
  };

  const activeCalls = [0, im * 0.5, im * 1.0]
    .map((dPct, i) => mkActive('CALL', dPct, `c${i}`))
    .sort((a, b) => b.volume - a.volume);
  const activePuts = [0, -im * 0.5, -im * 1.0]
    .map((dPct, i) => mkActive('PUT', dPct, `p${i}`))
    .sort((a, b) => b.volume - a.volume);

  return {
    event,
    quarters,
    probInsidePct,
    probBeyondPct: 100 - probInsidePct,
    probUpPct,
    ivCrushPct,
    premiumLostPct,
    activeCalls,
    activePuts,
  };
}

const REPORT_COUNT = 14;

/* ---- known names -------------------------------------------------------------------- */

/** THE NAMES THE ROOM WOULD RECOGNISE: the terminal's own universe, the sector leaders the Dossier files, and the
    S&P's NYSE half. ON THE FEED the rule is the vendor's: a member of the S&P 500, or a market cap of $10B and up
    (Unusual Whales' calendar carries `is_s_p_500` and `marketcap` on every report). A name on the reader's own board
    always counts — the page adds those (Earnings.tsx). */
/* read on the first ask, never at load: darkpool.ts stands on the simulator, and a module read mid-cycle is undefined */
let knownNames: Set<string> | null = null;
const KNOWN = (): Set<string> => (knownNames ??= new Set<string>([...UNIVERSE.map(u => u.ticker), ...SECTOR_UNIVERSE.flatMap(s => s.tickers), ...SP500_NYSE.map(t => t.symbol)]));
/** The feed's floor for a name the board shows without being in the S&P: $10B */
export const KNOWN_CAP_FLOOR = 10_000_000_000;

export function isKnownName(ticker: string, facts?: { sp500?: boolean; marketCap?: number | null }): boolean {
  const t = ticker.toUpperCase();
  if (KNOWN().has(t)) return true;
  if (facts?.sp500) return true;
  return typeof facts?.marketCap === 'number' && facts.marketCap >= KNOWN_CAP_FLOOR;
}

/* THE CROWD: the lesser names that report alongside — a vendor's day carries dozens to hundreds of them. Real listings,
   a sector each, a reference price the figures hang on; none of them is in the terminal's universe, so no other room
   (the Trace's Earnings column, the Pulse tile, the strike charts) ever sees them — only this calendar's list and grid. */
type CrowdName = [ticker: string, name: string, sector: Sector];
const EARNINGS_CROWD: CrowdName[] = [
  ['ACHR', 'Archer Aviation', 'Industrials'],
  ['ACLS', 'Axcelis Technologies', 'Technology'],
  ['AEO', 'American Eagle Outfitters', 'Consumer Discretionary'],
  ['AFRM', 'Affirm Holdings', 'Financials'],
  ['AI', 'C3.ai', 'Technology'],
  ['ALLY', 'Ally Financial', 'Financials'],
  ['AMBA', 'Ambarella', 'Technology'],
  ['AMC', 'AMC Entertainment', 'Communication'],
  ['ARRY', 'Array Technologies', 'Industrials'],
  ['ASTS', 'AST SpaceMobile', 'Communication'],
  ['AVAV', 'AeroVironment', 'Industrials'],
  ['BBWI', 'Bath & Body Works', 'Consumer Discretionary'],
  ['BEAM', 'Beam Therapeutics', 'Health Care'],
  ['BILL', 'BILL Holdings', 'Technology'],
  ['BLNK', 'Blink Charging', 'Industrials'],
  ['BOOT', 'Boot Barn', 'Consumer Discretionary'],
  ['BRZE', 'Braze', 'Technology'],
  ['BYND', 'Beyond Meat', 'Consumer Staples'],
  ['CAKE', 'Cheesecake Factory', 'Consumer Discretionary'],
  ['CART', 'Maplebear (Instacart)', 'Consumer Discretionary'],
  ['CELH', 'Celsius Holdings', 'Consumer Staples'],
  ['CHGG', 'Chegg', 'Consumer Discretionary'],
  ['CHPT', 'ChargePoint', 'Industrials'],
  ['CHWY', 'Chewy', 'Consumer Discretionary'],
  ['CLSK', 'CleanSpark', 'Technology'],
  ['COUR', 'Coursera', 'Consumer Discretionary'],
  ['CRSP', 'CRISPR Therapeutics', 'Health Care'],
  ['CWH', 'Camping World', 'Consumer Discretionary'],
  ['DAVE', 'Dave', 'Financials'],
  ['DNUT', 'Krispy Kreme', 'Consumer Staples'],
  ['DOCN', 'DigitalOcean', 'Technology'],
  ['DOCS', 'Doximity', 'Health Care'],
  ['ENPH', 'Enphase Energy', 'Technology'],
  ['ETSY', 'Etsy', 'Consumer Discretionary'],
  ['EVGO', 'EVgo', 'Industrials'],
  ['EXAS', 'Exact Sciences', 'Health Care'],
  ['FIVE', 'Five Below', 'Consumer Discretionary'],
  ['FOUR', 'Shift4 Payments', 'Financials'],
  ['FROG', 'JFrog', 'Technology'],
  ['FSLY', 'Fastly', 'Technology'],
  ['FUBO', 'fuboTV', 'Communication'],
  ['GDRX', 'GoodRx', 'Health Care'],
  ['GH', 'Guardant Health', 'Health Care'],
  ['GLBE', 'Global-E Online', 'Technology'],
  ['GPRO', 'GoPro', 'Consumer Discretionary'],
  ['GRPN', 'Groupon', 'Consumer Discretionary'],
  ['GTLB', 'GitLab', 'Technology'],
  ['HIMS', 'Hims & Hers Health', 'Health Care'],
  ['INDI', 'indie Semiconductor', 'Technology'],
  ['IONQ', 'IonQ', 'Technology'],
  ['JOBY', 'Joby Aviation', 'Industrials'],
  ['KSS', "Kohl's", 'Consumer Discretionary'],
  ['KTOS', 'Kratos Defense', 'Industrials'],
  ['LC', 'LendingClub', 'Financials'],
  ['LITE', 'Lumentum', 'Technology'],
  ['LMND', 'Lemonade', 'Financials'],
  ['LYFT', 'Lyft', 'Industrials'],
  ['M', "Macy's", 'Consumer Discretionary'],
  ['MARA', 'MARA Holdings', 'Technology'],
  ['MGNI', 'Magnite', 'Communication'],
  ['MQ', 'Marqeta', 'Financials'],
  ['MTCH', 'Match Group', 'Communication'],
  ['NTLA', 'Intellia Therapeutics', 'Health Care'],
  ['NVAX', 'Novavax', 'Health Care'],
  ['OKLO', 'Oklo', 'Utilities'],
  ['OLO', 'Olo', 'Technology'],
  ['OPEN', 'Opendoor Technologies', 'Consumer Discretionary'],
  ['PATH', 'UiPath', 'Technology'],
  ['PCOR', 'Procore Technologies', 'Technology'],
  ['PENN', 'PENN Entertainment', 'Consumer Discretionary'],
  ['PLUG', 'Plug Power', 'Industrials'],
  ['PTON', 'Peloton Interactive', 'Consumer Discretionary'],
  ['QS', 'QuantumScape', 'Consumer Discretionary'],
  ['RGTI', 'Rigetti Computing', 'Technology'],
  ['RIOT', 'Riot Platforms', 'Technology'],
  ['ROOT', 'Root', 'Financials'],
  ['RUM', 'Rumble', 'Communication'],
  ['RUN', 'Sunrun', 'Industrials'],
  ['S', 'SentinelOne', 'Technology'],
  ['SATS', 'EchoStar', 'Communication'],
  ['SEDG', 'SolarEdge Technologies', 'Technology'],
  ['SFIX', 'Stitch Fix', 'Consumer Discretionary'],
  ['SIRI', 'Sirius XM', 'Communication'],
  ['SMR', 'NuScale Power', 'Utilities'],
  ['SOUN', 'SoundHound AI', 'Technology'],
  ['SPCE', 'Virgin Galactic', 'Industrials'],
  ['SPT', 'Sprout Social', 'Technology'],
  ['STNE', 'StoneCo', 'Financials'],
  ['TDOC', 'Teladoc Health', 'Health Care'],
  ['TMDX', 'TransMedics', 'Health Care'],
  ['TREX', 'Trex', 'Industrials'],
  ['U', 'Unity Software', 'Technology'],
  ['UPST', 'Upstart Holdings', 'Financials'],
  ['VFC', 'VF Corporation', 'Consumer Discretionary'],
  ['VKTX', 'Viking Therapeutics', 'Health Care'],
  ['W', 'Wayfair', 'Consumer Discretionary'],
  ['WOOF', 'Petco Health and Wellness', 'Consumer Discretionary'],
  ['WULF', 'TeraWulf', 'Technology'],
  ['XMTR', 'Xometry', 'Industrials'],
  ['YELP', 'Yelp', 'Communication'],
  ['ZETA', 'Zeta Global', 'Technology'],
  ['ZI', 'ZoomInfo Technologies', 'Technology'],
];

interface Reporter {
  ticker: string;
  name: string;
  sector: Sector;
  px: number;
  beta: number;
  known: boolean;
}

/** One name's report in the fortnight — deterministic per name per day */
function reportFor(u: Reporter, day: string): EarningsEvent {
  const s = (tag: string) => `${u.ticker}-${day}-er-${tag}`;
  const daysOut = Math.floor(h01(s('d')) * 10);
  const reportDate = tradingDate(daysOut);
  const weekIdx: 0 | 1 = mondayOf(reportDate) === mondayOf(tradingToday()) ? 0 : 1;
  const histAvgMovePct = hRange(s('hist'), 2.2, 9.5) * (0.7 + u.beta * 0.35);
  const richness = hRange(s('rich'), 0.7, 1.75);
  const impliedMovePct = histAvgMovePct * richness;
  const base = {
    ticker: u.ticker,
    name: u.name,
    sector: u.sector,
    price: u.px,
    daysOut,
    dateLabel: labelFor(reportDate),
    weekday: ((reportDate.getDay() + 6) % 7) + 1,
    weekIdx,
    // Near-dated reports are officially confirmed; the further out, the more
    // likely the date is still an analyst estimate. Deterministic per name.
    confirmed: daysOut <= 2 ? true : h01(s('confirm')) < (daysOut <= 4 ? 0.78 : daysOut <= 6 ? 0.5 : 0.3),
    known: u.known,
    slot: (h01(s('slot')) > 0.45 ? 'AMC' : 'BMO') as ReportSlot,
    impliedMovePct,
    histAvgMovePct,
    pastMoves: pastMovesFor(s, histAvgMovePct),
    richness,
    beatRate8q: Math.round(hRange(s('beat'), 25, 95) / 12.5) * 12.5,
    revisionTrend: Math.max(-1, Math.min(1, hGauss(s('rev')) * 0.45 + tickerSentiment(u.ticker) * 0.4)),
    ivRank: Math.round(hRange(s('ivr'), 35, 96)),
    technicalScore: Math.round(hRange(s('tech'), 22, 92)),
    flowLean: Math.max(-1, Math.min(1, hGauss(s('flow')) * 0.5)),
  };
  return { ...base, ...decide(base) };
}

const soonestFirst = (a: EarningsEvent, b: EarningsEvent) => a.daysOut - b.daysOut || b.impliedMovePct - a.impliedMovePct;

/** THE KNOWN NAMES reporting over the fortnight — what every room reads (the board, the Pulse tile, the Trace's
    Earnings column, a strike chart's marker). */
export function buildEarningsCalendar(): EarningsEvent[] {
  const day = dayKey();
  // Deterministically choose which names report in the window
  const reporters = [...UNIVERSE]
    .map(u => ({ u, k: h01(`${u.ticker}-${day}-er-pick`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, REPORT_COUNT)
    .map(x => x.u);
  return reporters.map(u => reportFor({ ...u, known: true }, day)).sort(soonestFirst);
}

/** THE CROWD reporting over the same fortnight — the calendar page's list and grid carry them, nothing else does */
export function buildEarningsCrowd(): EarningsEvent[] {
  const day = dayKey();
  return EARNINGS_CROWD.map(([ticker, name, sector]) => {
    const px = Number((3 + Math.pow(h01(`${ticker}-crowd-px`), 1.5) * 140).toFixed(2));
    const beta = 1.1 + h01(`${ticker}-crowd-beta`) * 0.8;
    return reportFor({ ticker, name, sector, px, beta, known: false }, day);
  }).sort(soonestFirst);
}

/** Every report in the fortnight — the known names and the crowd, soonest first, the known names first on a day */
export function everyReport(): EarningsEvent[] {
  return [...buildEarningsCalendar(), ...buildEarningsCrowd()].sort((a, b) => a.daysOut - b.daysOut || Number(b.known) - Number(a.known) || b.impliedMovePct - a.impliedMovePct);
}

/* ---- the next report of ANY name ------------------------------------------------------ */

export interface NextReport {
  ticker: string;
  name: string;
  /** Sessions until the report, 0 = today */
  daysOut: number;
  dateLabel: string;
  /** The report's date as a key ("2026-11-19") */
  iso: string;
  slot: ReportSlot;
  /** true = the company has set the date; false = an analyst estimate */
  confirmed: boolean;
  /** The fortnight's event when the name reports inside it — the page's door, the options price */
  event: EarningsEvent | null;
}

/** THE NEXT REPORT OF ANY NAME (Noah, 2026-10-13: "a user should also be able to search for a ticker and it shows
    the next given earnings whether est or verified"). Inside the fortnight it is the calendar's own event, known or
    crowd; beyond it, the date is synthesised per name per day — ten to ninety sessions out, a third of them set by the
    company already. On the feed this is the vendor's per-ticker calendar call. */
export function nextReport(ticker: string): NextReport | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  const event = everyReport().find(e => e.ticker === t) ?? null;
  if (event) return { ticker: t, name: event.name, daysOut: event.daysOut, dateLabel: event.dateLabel, iso: isoDate(tradingDate(event.daysOut)), slot: event.slot, confirmed: event.confirmed, event };
  const s = (tag: string) => `${t}-${dayKey()}-next-${tag}`;
  const daysOut = 10 + Math.floor(h01(s('d')) * 80);
  const date = tradingDate(daysOut);
  return {
    ticker: t,
    name: tickerName(t),
    daysOut,
    dateLabel: labelFor(date),
    iso: isoDate(date),
    slot: h01(s('slot')) > 0.45 ? 'AMC' : 'BMO',
    confirmed: h01(s('confirm')) < 0.35,
    event: null,
  };
}
