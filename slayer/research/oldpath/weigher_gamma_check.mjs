// node gammacmp.mjs SPY 2026-11-20 [2026-11-09 …] — the vendor's per-contract gamma (option-contracts for a date, the
// Weigher's read) against the engine's cell gamma (the open-interest board's cells), through my dev server on :8097.
// One request at a time, 0.5 s apart.
const [ticker, ...dates] = process.argv.slice(2);
const base = 'http://127.0.0.1:8097';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async p => { const r = await fetch(base + p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
const board = await get(`/api/twobook/oi?ticker=${ticker}`);
if (board.phase !== 'full') { console.log('board not full yet:', board.phase); process.exit(1); }
const N = 10; const AT = { date: 0, strike: 1, callGamma: 6 + 2 * N, putGamma: 7 + 2 * N, callIv: 4 + 2 * N, putIv: 5 + 2 * N };
const out = [];
for (const date of dates) {
  const di = board.legs.dates.findIndex(d => d.date === date);
  const eng = new Map();
  for (const c of board.legs.cells) if (c[AT.date] === di) eng.set(c[AT.strike], c);
  const rows = [];
  for (let page = 0; page < 20; page++) {
    await sleep(500);
    const j = await get(`/api/uw/stock/${ticker}/option-contracts?limit=500&expiry=${date}&page=${page}`);
    const d = Array.isArray(j) ? j : j.data;
    rows.push(...d);
    if (d.length < 500) break;
  }
  const rel = [], ivRel = [];
  let n = 0, missing = 0, zeroV = 0;
  for (const r of rows) {
    const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(String(r.option_symbol));
    if (!m) continue;
    const k = Number(m[4]) / 1000, right = m[3];
    const vg = Number(r.gamma);
    const c = eng.get(k);
    if (!(vg > 0)) { zeroV++; continue; }
    if (!c) { missing++; continue; }
    const eg = c[right === 'C' ? AT.callGamma : AT.putGamma];
    if (!(eg > 0)) { missing++; continue; }
    n++;
    rel.push(Math.abs(eg / vg - 1));
    const viv = Number(r.implied_volatility), eiv = c[right === 'C' ? AT.callIv : AT.putIv];
    if (viv > 0 && eiv > 0) ivRel.push(Math.abs(eiv / viv - 1));
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const res = { ticker, date, boardPrice: board.price, boardAt: new Date(board.at).toISOString(), contracts: rows.length, compared: n, vendorNoGamma: zeroV, notOnBoard: missing, gammaRelMedian: q(rel, 0.5), gammaRelP90: q(rel, 0.9), gammaRelMax: q(rel, 1), within1e8: rel.filter(x => x <= 1e-8).length, within1e3: rel.filter(x => x <= 1e-3).length, ivRelMedian: q(ivRel, 0.5), ivRelMax: q(ivRel, 1) };
  out.push(res);
  console.log(JSON.stringify(res));
}
