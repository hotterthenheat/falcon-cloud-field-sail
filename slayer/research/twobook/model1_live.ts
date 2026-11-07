/*
  Model 1 on the vendor's latest snapshot, and the spec's Test 4 checks that one snapshot allows (docs/TWO_BOOK.md):
    - pagination: rows > 500, the strike walk's sum = the expiry-strike walk's sum;
    - the board (model1Board) as Pinpoint shows it, plus the all-rows (incl. expired) figures;
    - §3.3 exposure formulas against the vendor's per-contract Greeks (/greeks?expiry=) and OI: median ratio and IQR,
      long-dated expiries;
    - the shadow: §3.4-converted totals per strike vs a recomputation from the same OI and IV — GEX and DEX in
      UW_COMPAT (r = b = 0, row price), VANNA and CHARM in the vendor's carry model (b = r = SOFR; no dividend escrow
      on expiries before the next ex-date);
    - the effect of the coarse index row price (SPX): the six recomputed at the row price and at the index print.
  Reads the vendor one request at a time, 0.45 s apart, through its own key file (never printed); pages are kept under
  .cache/tb/uw/ so a rerun reads nothing.
    node --import tsx research/twobook/model1_live.ts SPY [index print for the price check]
*/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseOccSymbol, contractSpec, yearsTo, sumBoard, uwRowAction, uwToSlayer, type BoardLine } from '../../src/engine/twobook';
import { model1Board, UW_FIELDS } from '../../src/data/twobook/model1';

const ticker = (process.argv[2] ?? 'SPY').toUpperCase();
const indexPrint = Number(process.argv[3] ?? NaN);
const SOFR_R = Number(process.env.SOFR_R ?? 0.0399);
const date = process.env.UW_DATE ?? '';
const dq = date ? `?date=${date}` : '';
const dir = join('.cache', 'tb', 'uw', date ? `${ticker}_${date}` : ticker);
mkdirSync(dir, { recursive: true });
const env = Object.fromEntries(
  readFileSync('/tmp/qa/keys.env', 'utf8')
    .split('\n')
    .map(l => l.replace(/^export\s+/, '').match(/^([A-Z_0-9]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
let last = 0;
async function uw(path: string): Promise<string> {
  const f = join(dir, path.replace(/[^A-Za-z0-9]+/g, '_') + '.json');
  if (existsSync(f)) return readFileSync(f, 'utf8');
  for (let a = 0; a < 5; a++) {
    const wait = last + 450 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const r = await fetch(`https://api.unusualwhales.com/api${path}`, { headers: { Authorization: `Bearer ${env.UNUSUAL_WHALES_API_KEY}` } });
    const body = await r.text();
    if (r.status === 429 || r.status >= 500) {
      await new Promise(res => setTimeout(res, 2000 * (a + 1)));
      continue;
    }
    if (r.status !== 200) throw new Error(`${r.status} ${path}`);
    writeFileSync(f, body);
    return body;
  }
  throw new Error(`gave up ${path}`);
}
const rows = (b: string) => {
  const j = JSON.parse(b);
  return (Array.isArray(j) ? j : j.data) as Record<string, any>[];
};
async function walk(base: string) {
  const out: Record<string, any>[] = [];
  let pages = 0;
  for (let p = 0; p < 120; p++) {
    const r = rows(await uw(`${base}${base.includes('?') ? '&' : '?'}limit=500&page=${p}`));
    out.push(...r);
    pages++;
    if (r.length < 500) break;
  }
  return { rows: out, pages };
}
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const med = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const q = (a: number[], p: number) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const e = (x: number) => (Number.isFinite(x) ? x.toExponential(4) : String(x));

const es = await walk(`/stock/${ticker}/spot-exposures/expiry-strike${dq}`);
const st = await walk(`/stock/${ticker}/spot-exposures/strike${dq}`);
const stats = JSON.parse(await uw(`/stock/${ticker}/volatility/stats${dq}`)).data;
const oc = await walk(`/stock/${ticker}/option-contracts${dq}`);
const out: Record<string, unknown> = { ticker };
console.log(`${ticker}: expiry-strike ${es.rows.length} rows in ${es.pages} pages; strike ${st.rows.length} rows in ${st.pages} pages; option-contracts ${oc.rows.length} rows in ${oc.pages} pages; IV30 ${stats.iv} (${stats.date})`);

/* pagination: the strike walk's sums against the expiry-strike walk's, same timestamp */
const times = new Set(es.rows.map(r => r.time));
const tStrike = new Set(st.rows.map(r => r.time));
const sumOf = (rs: Record<string, any>[], k: string) => rs.reduce((a, r) => a + num(r[k]), 0);
const pag: Record<string, number> = {};
for (const k of UW_FIELDS) pag[k] = (sumOf(st.rows, k) - sumOf(es.rows, k)) / Math.max(1e-300, Math.abs(sumOf(es.rows, k)));
console.log(`pagination: timestamps expiry-strike ${[...times].join(',')} strike ${[...tStrike].join(',')}; relative gap per field ${Object.entries(pag).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(' ')}`);
out.pagination = { esRows: es.rows.length, esPages: es.pages, strikeRows: st.rows.length, strikePages: st.pages, gap: pag, esTimes: [...times], strikeTimes: [...tStrike] };

/* the board */
const board = model1Board({ ticker, rows: es.rows, pages: es.pages + oc.pages, iv30: Number(stats.iv), iv30Date: stats.date, contracts: oc.rows });
out.board = board;
console.log(`board at ${new Date(board.at ?? 0).toISOString()} price ${board.price} unit ${board.unit}`);
for (const [k, m] of Object.entries(board.four ?? {})) console.log(`  ${k.padEnd(6)} ${e(m.value)} (${m.per}, ${m.provenance})`);
for (const [k, m] of Object.entries(board.six ?? {})) console.log(`  ${k.padEnd(6)} ${e(m.value)} (${m.per}, ${m.provenance})`);
console.log(`  DEX vendor sign ${e(board.dexVendorSign ?? NaN)}; dropped rows ${board.dropped.rows}: GEX ${e(board.dropped.GEX)} DEX ${e(board.dropped.DEX)} CHARM ${e(board.dropped.CHARM)}; flagged ${JSON.stringify(board.flagged)}`);
console.log(`  OI share on vendor IV (APPROX) ${(board.oi.share.approx * 100).toFixed(1)}%, on flat wing ${(board.oi.share.modeled * 100).toFixed(1)}%, adjusted contracts ${board.oi.adjusted}`);

/* §3.3 formulas against the vendor's per-contract Greeks, long-dated expiries */
const at = board.at as number;
const S = board.price as number;
const iv30 = Number(stats.iv);
const oiOf = new Map<string, number>();
/** per (expiry, strike, right): each root's contract (SPX = SPX + SPXW) */
const legsOf = new Map<string, { root: string; oi: number; iv: number }[]>();
for (const c of oc.rows) {
  const p = parseOccSymbol(String(c.option_symbol));
  if (!p) continue;
  const k = `${p.expiry}|${p.strike}|${p.right}`;
  oiOf.set(k, (oiOf.get(k) ?? 0) + num(c.open_interest));
  legsOf.set(k, [...(legsOf.get(k) ?? []), { root: p.root, oi: num(c.open_interest), iv: num(c.implied_volatility) }]);
}
const exps = [...new Set(es.rows.map(r => String(r.expiry)))].sort();
const longDated = exps.filter(x => Date.parse(`${x}T21:00:00Z`) - at > 60 * 86_400_000).slice(0, 2);
const ratios: Record<string, number[]> = { gamma: [], delta: [], vanna: [], charm: [] };
for (const x of longDated) {
  const g = rows(await uw(`/stock/${ticker}/greeks?expiry=${x}${date ? `&date=${date}` : ''}`));
  const byK = new Map(es.rows.filter(r => r.expiry === x && r.time === es.rows[0].time).map(r => [num(r.strike), r]));
  for (const r of g) {
    const k = num(r.strike);
    const row = byK.get(k);
    if (!row) continue;
    for (const right of ['C', 'P'] as const) {
      const oi = oiOf.get(`${x}|${k}|${right}`) ?? 0;
      if (!(oi > 100)) continue;
      const pre = right === 'C' ? 'call_' : 'put_';
      const sg = right === 'C' ? 1 : -1;
      const f = (gk: string) => num(r[`${pre}${gk}`]);
      const pairs: [string, number, number][] = [
        ['gamma', num(row[`${pre}gamma_oi`]), sg * f('gamma') * oi * S * S],
        ['delta', num(row[`${pre}delta_oi`]), f('delta') * oi * S * S],
        ['vanna', num(row[`${pre}vanna_oi`]), sg * f('vanna') * oi * S * iv30],
        ['charm', num(row[`${pre}charm_oi`]), sg * f('charm') * oi * S * 365],
      ];
      for (const [n, pub, form] of pairs) if (Math.abs(form) > 1e-9 && Math.abs(pub) > 0) ratios[n].push(pub / form);
    }
  }
}
out.formulas = Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, { n: v.length, median: med(v), p25: q(v, 0.25), p75: q(v, 0.75) }]));
console.log(`§3.3 formulas on ${longDated.join(', ')}: ${Object.entries(out.formulas as Record<string, { n: number; median: number; p25: number; p75: number }>).map(([k, v]) => `${k} n=${v.n} median ${v.median.toFixed(5)} IQR [${v.p25.toFixed(4)}, ${v.p75.toFixed(4)}]`).join('; ')}`);

/* the shadow: per strike, exactly the board's population (INCLUDE rows; flat wing for contracts without a vendor IV):
   GEX, DEX in UW_COMPAT (r = b = 0); VANNA, CHARM in the vendor's carry model (b = r = SOFR) */
const t0 = es.rows[0].time;
const popRows = es.rows.filter(r => r.time === t0 && uwRowAction(at, String(r.expiry), false) === 'INCLUDE');
const popExp = new Set(popRows.map(r => String(r.expiry)));
const compat: BoardLine[] = [];
for (const c of oc.rows) {
  const p = parseOccSymbol(String(c.option_symbol));
  const spec = p && contractSpec(p.root, ticker);
  if (!p || !spec || !popExp.has(p.expiry)) continue;
  const oi = num(c.open_interest);
  if (!(oi > 0)) continue;
  const iv = num(c.implied_volatility);
  compat.push({ root: p.root, expiry: p.expiry, strike: p.strike, right: p.right, C: p.right === 'C' ? oi : -oi, M: 100, T: yearsTo(spec, p.expiry, at), S, r: 0, b: 0, iv: iv > 0 ? iv : null, ivProv: iv > 0 ? 'UW_APPROX' : 'UNAVAILABLE' });
}
const missingIv = compat.filter(l => l.iv == null).reduce((x, l) => x + Math.abs(l.C), 0);
const sbA = sumBoard(compat, 'day');
const sbB = sumBoard(compat.map(l => ({ ...l, r: SOFR_R, b: SOFR_R })), 'day');
const shadow = new Map<number, { uw: ReturnType<typeof uwToSlayer>; gex: number; dex: number; vanna: number; charm: number }>();
for (const r of popRows) {
  const k = num(r.strike);
  const one = uwToSlayer(Object.fromEntries(UW_FIELDS.map(f => [f, num(r[f])])) as never, S, iv30, 'day');
  const cur = shadow.get(k) ?? { uw: { GEX: 0, DEX: 0, VANNA: 0, CHARM: 0, DEX_UW_SIGN: 0 }, gex: 0, dex: 0, vanna: 0, charm: 0 };
  for (const f of ['GEX', 'DEX', 'VANNA', 'CHARM'] as const) cur.uw[f] += one[f];
  shadow.set(k, cur);
}
for (const row of sbA.byStrike) {
  const cur = shadow.get(row.strike);
  if (!cur) continue;
  cur.gex += row.net.GEX;
  cur.dex += row.net.DEX;
}
for (const row of sbB.byStrike) {
  const cur = shadow.get(row.strike);
  if (!cur) continue;
  cur.vanna += row.net.VANNA;
  cur.charm += row.net.CHARM;
}
const tot = { uw: { GEX: 0, DEX: 0, VANNA: 0, CHARM: 0 }, sh: { GEX: 0, DEX: 0, VANNA: 0, CHARM: 0 } };
const per: Record<string, number[]> = { GEX: [], DEX: [], VANNA: [], CHARM: [] };
for (const v of shadow.values()) {
  const sh = { GEX: v.gex, DEX: v.dex, VANNA: v.vanna, CHARM: v.charm };
  for (const f of ['GEX', 'DEX', 'VANNA', 'CHARM'] as const) {
    tot.uw[f] += v.uw[f];
    tot.sh[f] += sh[f];
    if (Math.abs(v.uw[f]) > 1e-6 * Math.abs(board.four?.[f].value ?? 1) && Math.abs(sh[f]) > 0) per[f].push(sh[f] / v.uw[f]);
  }
}
out.shadow = { totals: tot, missingIvOi: missingIv, perStrike: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { n: v.length, median: med(v), p10: q(v, 0.1), p90: q(v, 0.9) }])) };
console.log(`shadow totals (converted vendor vs recomputed, per day): ${(['GEX', 'DEX', 'VANNA', 'CHARM'] as const).map(f => `${f} ${e(tot.uw[f])} vs ${e(tot.sh[f])} (${(((tot.sh[f] - tot.uw[f]) / Math.abs(tot.uw[f])) * 100).toFixed(2)}%)`).join('; ')}`);
console.log(`shadow per strike, recomputed / converted: ${Object.entries(out.shadow.perStrike as Record<string, { n: number; median: number; p10: number; p90: number }>).map(([k, v]) => `${k} n=${v.n} median ${v.median.toFixed(4)} p10 ${v.p10.toFixed(3)} p90 ${v.p90.toFixed(3)}`).join('; ')}; OI without a vendor IV ${missingIv}`);

/* the coarse row price: the six at the row price and at the index print */
if (Number.isFinite(indexPrint)) {
  const lines: BoardLine[] = [];
  const lines2: BoardLine[] = [];
  for (const c of oc.rows) {
    const p = parseOccSymbol(String(c.option_symbol));
    const spec = p && contractSpec(p.root, ticker);
    if (!p || !spec) continue;
    const T = yearsTo(spec, p.expiry, at);
    const oi = num(c.open_interest);
    const iv = num(c.implied_volatility);
    if (!(T > 0) || !(oi > 0)) continue;
    const l: BoardLine = { root: p.root, expiry: p.expiry, strike: p.strike, right: p.right, C: p.right === 'C' ? oi : -oi, M: 100, T, S, r: 0, b: 0, iv: iv > 0 ? iv : null, ivProv: iv > 0 ? 'UW_APPROX' : 'UNAVAILABLE' };
    lines.push(l);
    lines2.push({ ...l, S: indexPrint });
  }
  const a = sumBoard(lines, 'day');
  const b = sumBoard(lines2, 'day');
  out.priceEffect = { rowPrice: S, indexPrint, rowPriceBoard: a.totals, indexPrintBoard: b.totals };
  console.log(`row price ${S} vs index ${indexPrint} (${(((S - indexPrint) / indexPrint) * 100).toFixed(3)}%): ${Object.keys(a.totals).map(k => `${k} ${(((a.totals[k as keyof typeof a.totals] - b.totals[k as keyof typeof b.totals]) / Math.abs(b.totals[k as keyof typeof b.totals])) * 100).toFixed(2)}%`).join(' ')}`);
}
writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 1));
