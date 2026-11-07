/*
  Compass limits proof (owner, 2026-11-07: "remove the hard coded limits"):
  - the validity checks still refuse what is not a quote: a zero bid, a crossed or locked quote, a stale one, one with no
    size shown; in every choice path (Model 1, Model 3, Model Risk);
  - no fixed price or spread limit is left in the choice path: the source of the choosing code holds none of the old
    caps' names or numbers, and Model 1's trained quotes (bid over $0.15, spread within 8%) are read in one place only,
    inModel1Domain, which is the model's definition (the trees' own feature ranges say so, checked here from the files);
  - the wing and Model 3's ticket are defined by shape, so the same contract shape is picked on SPY at $700 and on a
    $40 stock, where the old dollar caps picked different shapes;
  - the budget sizes the call and offers the next best that fits (the XSP contract for SPX), and the choosing code does
    not read it.
  Run:  npx tsx scripts/compass-limits-proof.ts
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blackScholesPrice } from '../src/core/greeks';
import { nyWallTime } from '../src/core/nyTime';
import {
  BID_MIN, LOTTERY_DELTA_MAX, Q, R, SPREAD_MAX, WING_DELTA_MAX, bookBPass, inModel1Domain, lotteryShape, quoteFreshAt, quoteTradable,
  quoteUsable, sizeShown, strikeDistance, tradingMinutesTo, SESSION_MIN, YEAR_SESSIONS, wingShape, QUOTE_MAX_AGE_MS,
} from '../src/data/compassParams';
import { MINI_OF, altsOf, atmIvOf, costPick, costRead, deltaOf, lotterySide, type CostQuote, type CostRead } from '../src/data/compassCost';
import { tailPick, tailQuoteOk } from '../src/data/modelRisk';
import { budgetRead, parseBudget, sizeFor, BUDGET_DEFAULT } from '../src/data/compassBudget';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (what: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
};
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');
/** Source without its comments (a comment may tell the history of a cap) */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** The text of one top-level function (from its signature to the next top-level declaration) */
const fnBody = (text: string, name: string) => {
  const at = text.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  if (at < 0) return '';
  const rest = text.slice(at + 1);
  const end = rest.search(/\n(export |function |const |let |interface |type |\/\*\*|\/\*)/);
  return text.slice(at, end < 0 ? undefined : at + 1 + end);
};

/* ---- 1. validity checks: not limits, and they still refuse what is not a quote ---- */
check('a zero bid is not a quote', !quoteTradable(0, 0.05));
check('a crossed quote is not a quote', !quoteTradable(1.2, 1.1));
check('a locked quote (bid = ask) is not a tradable quote', !quoteTradable(1, 1));
check('a missing ask is not a quote', !quoteTradable(1, NaN) && !quoteTradable(1, 0));
check('a two-sided quote is', quoteTradable(0.01, 0.02) && quoteTradable(36, 36.3));
const now = 1_800_000_000_000;
check('stale: a quote older than 90 s is refused, one 90 s old is not', !quoteFreshAt(now - QUOTE_MAX_AGE_MS - 1, now) && quoteFreshAt(now - QUOTE_MAX_AGE_MS, now));
check('a quote with no stamp, or from the future, is refused', !quoteFreshAt(undefined, now) && !quoteFreshAt(now + 120_000, now));
check('size: zero shown on a side is refused; not sent is not held against it', !sizeShown(0, 10) && !sizeShown(10, 0) && sizeShown(3, 4) && sizeShown(undefined, undefined));
check('quoteUsable needs all three', quoteUsable({ bid: 1, ask: 1.05, quotedAt: now - 1000, bidSize: 5, askSize: 5 }, now)
  && !quoteUsable({ bid: 1, ask: 1.05, quotedAt: now - 200_000 }, now)
  && !quoteUsable({ bid: 0, ask: 1.05, quotedAt: now - 1000 }, now)
  && !quoteUsable({ bid: 1, ask: 1.05, quotedAt: now - 1000, bidSize: 0, askSize: 5 }, now));
check('Model 3 refuses a zero bid, a crossed and a locked quote whatever its delta', !lotteryShape(0, 0.05, 0.3) && !lotteryShape(1.2, 1.1, 0.3) && !lotteryShape(1, 1, 0.3));
check('Model Risk refuses a zero bid, a crossed and a locked quote', !tailQuoteOk(0, 0.05, 100, 100) && !tailQuoteOk(2, 1.9, 100, 100) && !tailQuoteOk(2, 2, 100, 100));
check('Model 1 refuses a crossed quote and a zero bid', !inModel1Domain(1.2, 1.1) && !inModel1Domain(0, 0.5));
{
  const scan = code(src('src/data/compassModel.ts'));
  const loop = scan.slice(scan.indexOf('for (const s of list) {'), scan.indexOf('const scored = scoreRow(x);'));
  check('Model 1\'s scan refuses a stale quote, then an invalid one, before it scores', /QUOTE_MAX_AGE_MS/.test(loop) && /quoteTradable\(s\.bid, s\.ask\)/.test(loop) && /sizeShown\(/.test(loop));
  const lot = fnBody(scan, 'scoreLottery');
  check('Model 3\'s sweep refuses an invalid quote, no size, and a quote not stamped this minute', /quoteTradable\(s\.bid, s\.ask\)/.test(lot) && /sizeShown\(/.test(lot) && /qMin !== minute/.test(lot));
  const legs = fnBody(code(src('src/data/modelRiskScan.ts')), 'legsOf');
  check('Model Risk\'s chain read refuses a stale or invalid quote and no size', /quoteFresh\(/.test(legs) && /quoteTradable\(/.test(legs) && /sizeShown\(/.test(legs));
}

/* ---- 2. no fixed price or spread limit in the choice path ----
   Model 3's rule of today (lotteryEntry: $0.15, 8%, $1.65) stays live behind COMPASS_M3_SHAPE, off by default, until
   the backtest decides (scripts/compass-m3-switch-proof.ts proves it unchanged). It may appear only in the switch's
   off branch: those branches are checked here to be gated, then left out of the scan for limits. */
const offBranch = (text: string) => text
  .replace(/: !lotteryEntry\(s\.bid, s\.ask\)/, '')
  .replace(/: lotterySideNow\(list, spot\)/, '')
  .replace(/\n\s*if \(!m3ShapeOn\(\)\) for \(const d of list\) if \(d\.ask > 0 && d\.ask <= LOTTERY_ASK_MAX\) near\.add\(d\.strike\);/, '');
{
  const lot = fnBody(code(src('src/data/compassModel.ts')), 'scoreLottery');
  check("Model 3: today's rule is read only in the switch's off branch", /const shape = m3ShapeOn\(\);/.test(lot) && /shape \? !quoteTradable\(s\.bid, s\.ask\) \|\| !sizeShown\(s\.bidSize, s\.askSize\) : !lotteryEntry\(s\.bid, s\.ask\)/.test(lot) && /shape \? lotterySide\(list, spot, now\) : lotterySideNow\(list, spot\)/.test(lot) && (lot.match(/lotteryEntry/g) ?? []).length === 1);
  check("the scan keeps today's rule's far contracts only while the switch is off", /if \(!m3ShapeOn\(\)\) for \(const d of list\) if \(d\.ask > 0 && d\.ask <= LOTTERY_ASK_MAX\) near\.add\(d\.strike\);/.test(fnBody(code(src('src/data/compassScan.ts')), 'kept')));
}
{
  const files: Record<string, string[]> = {
    'src/data/compassModel.ts': ['scoreLottery', 'pickOf', 'miniRows', 'poolCost'],
    'src/data/compassCost.ts': ['costRead', 'costPick', 'altsOf', 'deltaOf', 'firstOrderCost', 'lotterySide'],
    'src/data/compassScan.ts': ['kept'],
    'src/data/modelRisk.ts': ['tailQuoteOk', 'tailPick'],
    'src/data/modelRiskScan.ts': ['legsOf', 'rankBook'],
    'src/data/compassParams.ts': ['bookAPass', 'bookBPass', 'wingShape', 'lotteryShape', 'quoteTradable', 'quoteFreshAt', 'sizeShown', 'quoteUsable'],
  };
  const gone = /\b(LOTTERY_ASK_MAX|BOOK_B_ASK|TAIL_SPREAD|TAIL_ASK_CAP|askCapped|lotteryEntry|spreadPass|BID_MIN|SPREAD_MAX)\b/;
  /* a price or a spread against a number: ask <= 1, bid > 0.15, 1.65, spread / mid > 0.04, ask >= 5 */
  const priced = /\b(ask|bid|mid|spread|bidPx|askPx)\s*(<=|>=|<|>)\s*\d*\.?\d+(?!e)|\d*\.?\d+\s*(<=|>=|<|>)\s*(ask|bid|mid|spread)\b|\b(1\.65|0\.15|0\.08|0\.04)\b/;
  for (const [file, names] of Object.entries(files)) {
    const text = offBranch(code(src(file)));
    for (const name of names) {
      const body = fnBody(text, name);
      const hitGone = gone.exec(body);
      const hitPriced = body.split('\n').map(l => l.replace(/\b(bid|ask)\s*>\s*0\b/g, '').replace(/>\s*0\b|>=\s*0\b/g, '')).join('\n').match(priced);
      check(`${file} ${name}: no fixed price or spread limit`, !!body && !hitGone && !hitPriced, !body ? 'not found' : hitGone?.[0] ?? hitPriced?.[0] ?? '');
    }
  }
  const params = code(src('src/data/compassParams.ts'));
  const uses = (params.match(/\b(BID_MIN|SPREAD_MAX)\b/g) ?? []).length;
  const inDomain = (fnBody(params, 'inModel1Domain').match(/\b(BID_MIN|SPREAD_MAX)\b/g) ?? []).length;
  const inEntry = (fnBody(params, 'lotteryEntry').match(/\b(BID_MIN|SPREAD_MAX)\b/g) ?? []).length;
  check('Model 1\'s trained quotes are read in compassParams only by inModel1Domain (and today\'s Model 3 rule, behind the switch)', uses === inDomain + inEntry + 2 && inEntry <= 1, `${uses} uses, ${inDomain} in inModel1Domain, ${inEntry} in lotteryEntry`);
  for (const f of ['src/data/compassModel.ts', 'src/data/compassCost.ts', 'src/data/compassScan.ts', 'src/data/modelRisk.ts', 'src/data/modelRiskScan.ts']) {
    check(`${f} names no old cap and no Model 1 number`, !/\b(LOTTERY_ASK_MAX|BOOK_B_ASK|TAIL_SPREAD|TAIL_ASK_CAP|BID_MIN|SPREAD_MAX|lotteryEntry)\b/.test(offBranch(code(src(f))).replace(/^import[\s\S]*?from '[^']+';$/gm, '')));
  }
  check('the scan keeps strikes by distance only (no 1.65)', !/1\.65/.test(code(src('src/data/compassScan.ts'))));
  /* the model's definition, from the trees' own files: what they were trained on */
  for (const tree of ['public/models/model_entry_all6months.txt', 'public/models/model_runner_all6months.txt']) {
    const infos = /^feature_infos=(.*)$/m.exec(src(tree))?.[1].split(' ') ?? [];
    const [mLo] = (infos[32] ?? '').slice(1, -1).split(':').map(Number);
    const [sLo, sHi] = (infos[33] ?? '').slice(1, -1).split(':').map(Number);
    check(`${tree}: trained on mids from ${mLo.toFixed(3)} (a bid over ${BID_MIN}) and spreads within ${(sHi * 100).toFixed(1)}%: inModel1Domain is that box`, mLo >= BID_MIN && sLo >= 0 && Math.abs(sHi - SPREAD_MAX) < 1e-6);
  }
}

/* ---- 3. the same shape on SPY at $700 and on a $40 stock ---- */
/* A same-day chain at 15:30 on a Monday, held to the sweep's 15:50 flat; the strikes on the same grid in percent of the
   stock, every quote at the same vol with a spread the same share of its price: the two chains are one chain at two
   scales. The new rules pick the same contract shape on both; the old dollar caps did not. */
const day = '2026-11-09';
const at = nyWallTime(2026, 11, 9, 15, 30);
const flatAt = nyWallTime(2026, 11, 9, 15, 50);
const tNow = tradingMinutesTo(day, at) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
type Leg = CostQuote & { rel: number };
const chainAt = (S: number, step: number, vol: number, t = tNow, exp = day): Leg[] => {
  const out: Leg[] = [];
  for (let i = -20; i <= 20; i++) {
    const K = Number((S * (1 + i * step)).toFixed(6));
    for (const right of ['C', 'P'] as const) {
      const mid = blackScholesPrice(S, K, t, vol, right, R, Q);
      if (!(mid > 0.0005)) continue;
      const half = mid * 0.02 + S * 0.000005;
      out.push({ strike: K, right, bid: mid - half, ask: mid + half, expiryDate: exp, rel: i });
    }
  }
  return out;
};
const spy = chainAt(700, 0.0014, 0.16);
const small = chainAt(40, 0.0014, 0.16);
const pickNew = (chain: Leg[], S: number) => {
  const side = lotterySide(chain, S, at);
  const atm = atmIvOf(chain, S, at)!;
  return costPick(side, c => costRead(c, { spot: S, atmIv: atm, at, flatAt }))?.pick ?? null;
};
const pickOld = (chain: Leg[], S: number) => {
  const oldEntry = (b: number, a: number) => b > 0.15 && a > 0 && a <= 1.65 && a >= b && (a - b) / ((a + b) / 2) <= 0.08 + 1e-9;
  const list = chain.filter(c => oldEntry(c.bid, c.ask));
  const strikes = [...new Set(list.map(c => c.strike))];
  list.sort((a, b) => strikeDistance(strikes, S, a.strike) - strikeDistance(strikes, S, b.strike) || a.strike - b.strike || (a.right === 'C' ? -1 : 1));
  const side = list.filter(c => c.right === list[0]?.right);
  const atm = atmIvOf(chain, S, at)!;
  return list.length ? costPick(side, c => costRead(c, { spot: S, atmIv: atm, at, flatAt }))?.pick ?? side[0] : null;
};
{
  const a = pickNew(spy, 700);
  const b = pickNew(small, 40);
  const da = a ? deltaOf(a, 700, at) : NaN;
  const db = b ? deltaOf(b, 40, at) : NaN;
  check('Model 3 with COMPASS_M3_SHAPE on: the same contract shape on SPY at $700 and on a $40 stock', !!a && !!b && a.rel === b.rel && a.right === b.right && Math.abs(da - db) < 1e-6, `${a?.rel}${a?.right} |Δ| ${da.toFixed(3)} vs ${b?.rel}${b?.right} |Δ| ${db.toFixed(3)}`);
  check(`Model 3's shape: at the money or out of it (|Δ| ≤ ${LOTTERY_DELTA_MAX})`, da <= LOTTERY_DELTA_MAX + 1e-12);
  const oa = pickOld(spy, 700);
  const ob = pickOld(small, 40);
  check('the old $1.65 / $0.15 caps picked a different shape on the two (the reason they went)', !oa || !ob || oa.rel !== ob.rel || oa.right !== ob.right, `old: ${oa ? `${oa.rel}${oa.right}` : 'none'} vs ${ob ? `${ob.rel}${ob.right}` : 'none'}`);
}
{
  /* the wing: a weekly (3 sessions out) at 10:00, the band 8 to 12 strikes out */
  const wAt = nyWallTime(2026, 11, 9, 10, 0);
  const wExp = '2026-11-12';
  const t = tradingMinutesTo(wExp, wAt) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  const ws = chainAt(700, 0.0025, 0.18, t, wExp);
  const wl = chainAt(40, 0.0025, 0.18, t, wExp);
  const shapeSet = (chain: Leg[], S: number) => chain.filter(c => c.rel >= 8 && c.rel <= 12 && c.right === 'C' && wingShape(deltaOf(c, S, wAt))).map(c => c.rel).join(',');
  const oldSet = (chain: Leg[]) => chain.filter(c => c.rel >= 8 && c.rel <= 12 && c.right === 'C' && c.ask <= 1).map(c => c.rel).join(',');
  check(`the wing (|Δ| ≤ ${WING_DELTA_MAX}) is the same strikes on SPY and on the $40 stock`, shapeSet(ws, 700) === shapeSet(wl, 40) && shapeSet(ws, 700).length > 0, `${shapeSet(ws, 700)} vs ${shapeSet(wl, 40)}`);
  check('the old $1 cap was not', oldSet(ws) !== oldSet(wl), `old: [${oldSet(ws)}] vs [${oldSet(wl)}]`);
  /* SPY 10 strikes out asks over $1 (the old cap shut it) and is a 0.15-delta-or-less wing: Book B takes it now; 9 out
     is over 0.15 delta and is not a wing at any price */
  const c10 = ws.find(c => c.rel === 10 && c.right === 'C')!;
  const d10 = deltaOf(c10, 700, wAt);
  check('Book B takes a wing over $1 by its delta (SPY 10 strikes out)', c10.ask > 1 && bookBPass(30, 10, 4, 3, c10.bid, c10.ask, c10.bid * 2.2, c10.ask * 2.2, d10, 0.8), `ask ${c10.ask.toFixed(2)}, |Δ| ${d10.toFixed(3)}`);
  const c9 = ws.find(c => c.rel === 9 && c.right === 'C')!;
  const d9 = deltaOf(c9, 700, wAt);
  check('and refuses one past 0.15 delta (SPY 9 strikes out)', d9 > WING_DELTA_MAX && !bookBPass(30, 9, 4, 3, c9.bid, c9.ask, c9.bid * 2.2, c9.ask * 2.2, d9, 0.8), `ask ${c9.ask.toFixed(2)}, |Δ| ${d9.toFixed(3)}`);
}

/* ---- Model Risk: the cost rule chooses, no cap ---- */
{
  const S = 7600;
  const exp = day;
  const t = tradingMinutesTo(exp, nyWallTime(2026, 11, 9, 11, 0)) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  const legs = [7580, 7590, 7600, 7610].map(K => {
    const mid = blackScholesPrice(S, K, t, 0.14, 'P', R, Q);
    const half = K === 7590 ? 0.05 : 1.5;
    return { strike: K, bid: mid - half, ask: mid + half };
  });
  const got = tailPick(legs, 'P', exp, S, nyWallTime(2026, 11, 9, 11, 0));
  check('Model Risk takes the contract with the smallest mu, an index at $20+ included', !!got && got.leg.strike === 7590 && !!got.read, got ? `${got.leg.strike} at ${got.leg.ask.toFixed(2)}` : 'none');
  /* 21:00 Monday on Tuesday's expiry: the 30-minute hold has no regular-session time, so mu cannot be read */
  const nAt = nyWallTime(2026, 11, 9, 21, 0);
  const nExp = '2026-11-10';
  const nt = tradingMinutesTo(nExp, nAt) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  const nLegs = [7580, 7590, 7600, 7610].map(K => {
    const mid = blackScholesPrice(S, K, nt, 0.14, 'P', R, Q);
    const half = K === 7590 ? 0.05 : 1.5;
    return { strike: K, bid: mid - half, ask: mid + half };
  });
  const night = tailPick(nLegs, 'P', nExp, S, nAt);
  check('overnight (no regular-session time in the hold): the first-order cost picks, same contract', !!night && night.leg.strike === 7590 && night.read == null, night ? `${night.leg.strike}, read ${night.read ? 'mu' : 'first-order'}` : 'none');
}

/* ---- 4. the budget: sizes, offers the next best that fits, never chooses ---- */
check(`the default budget is $${BUDGET_DEFAULT}`, BUDGET_DEFAULT === 500);
check('it buys whole contracts: $500 at a $2.40 ask is 2, at $5.00 is 1, at $5.01 is 0', sizeFor(2.4, 500) === 2 && sizeFor(5, 500) === 1 && sizeFor(5.01, 500) === 0);
check('a typed budget reads "$1,500" and refuses nonsense', parseBudget('$1,500') === 1500 && parseBudget('abc') == null && parseBudget('0') == null);
{
  /* the SPXW 7585P call at $36.30 ($3,630 a contract), with its alternatives as the engine records them */
  const spxQuotes: (CostQuote & { k: string })[] = [7585, 7580, 7570, 7560].map(K => ({ k: `SPXW ${K}P`, strike: K, right: 'P' as const, bid: 0, ask: 0, expiryDate: day }));
  const xsp: (CostQuote & { k: string })[] = [758, 759].map(K => ({ k: `XSP ${K}P`, strike: K, right: 'P' as const, bid: 0, ask: 0, expiryDate: day }));
  const S = 7565;
  const tt = tradingMinutesTo(day, nyWallTime(2026, 11, 9, 13, 0)) / (SESSION_MIN * YEAR_SESSIONS) + 1e-6;
  for (const q of [...spxQuotes, ...xsp]) {
    const s = q.k.startsWith('XSP') ? S / 10 : S;
    const mid = blackScholesPrice(s, q.strike, tt, 0.15, 'P', R, Q);
    const half = q.k.startsWith('XSP') ? 0.03 : 0.15;
    q.bid = mid - half;
    q.ask = mid + half;
  }
  const atS = nyWallTime(2026, 11, 9, 13, 0);
  const fl = nyWallTime(2026, 11, 9, 15, 55);
  const read = (q: CostQuote & { k: string }): CostRead | null => {
    const s = q.k.startsWith('XSP') ? S / 10 : S;
    return costRead(q, { spot: s, atmIv: 0.15, at: atS, flatAt: fl });
  };
  const pick = costPick(spxQuotes, read)!.pick;
  const alts = altsOf(pick, spxQuotes, xsp, q => q.k, q => q.ask, read);
  check('the engine records the mini first (MINI_OF: XSP is a tenth of SPXW)', MINI_OF.SPXW.root === 'XSP' && alts[0]?.kind === 'mini' && alts[0].contract.startsWith('XSP'), alts.map(a => `${a.contract} ${a.ask.toFixed(2)}`).join(', '));
  check('then the other allowed strikes, by mu, the pick left out', alts.slice(1).every(a => a.kind === 'strike' && a.contract !== pick.k) && alts.slice(1).every((a, i, xs) => i === 0 || (xs[i - 1].mu ?? Infinity) <= (a.mu ?? Infinity)));
  const b = budgetRead(pick.ask, alts, 500)!;
  check(`a ${pick.k} call at $${pick.ask.toFixed(2)} sizes to 0 on $500 and offers the XSP contract`, b.size === 0 && b.fit?.kind === 'mini' && b.line === `Sized to your $500 budget · next best that fits: ${alts[0].contract}`, b.line);
  const big = budgetRead(pick.ask, alts, 10_000)!;
  check('on a $10,000 budget the same call sizes to whole contracts and offers nothing else', big.size === Math.floor(10_000 / (pick.ask * 100)) && big.fit == null, big.line);
  const none = budgetRead(pick.ask, [], 500)!;
  check('with nothing smaller quoted it says so, and the call stands', none.size === 0 && none.fit == null && /nothing smaller/.test(none.line));
  check('a $2.40 call on $500: "Sized to your $500 budget · 2 contracts ($480)"', budgetRead(2.4, [], 500)?.line === 'Sized to your $500 budget · 2 contracts ($480)');
}
for (const f of ['src/data/compassModel.ts', 'src/data/compassCost.ts', 'src/data/compassScan.ts', 'src/data/modelRisk.ts', 'src/data/modelRiskScan.ts', 'src/data/compassParams.ts']) {
  check(`${f} does not read the budget (it sizes; it is not a filter)`, !/compassBudget|readBudget|useBudget/.test(code(src(f))));
}
check('the card shows the budget line', /budgetRead\(/.test(src('src/components/compass/SetupScanCard.tsx')) && /data-card-budget/.test(src('src/components/compass/SetupScanCard.tsx')));
check('Settings lets the viewer change it', /settings-compass-budget/.test(src('src/pages/settings/Settings.tsx')) && /setBudget\(/.test(src('src/pages/settings/Settings.tsx')));

if (fail) {
  console.error(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log('\ncompass limits proof: every check passed');
