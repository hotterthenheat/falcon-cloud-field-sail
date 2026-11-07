/*
  The open-interest board's wire, measured (docs/OLD_PATH_AUDIT.md item 5): the recorded SPY and SPX books
  (scripts/fixtures/twobook/) rebuilt by model1Board, then the server's cost of today's JSON (rows of 28, gzip) against
  the board encoded once (model1Server.ts encodedBoard), and the sizes and parse costs of the alternatives considered:
  columnar JSON, Float64 columns base64 inside JSON, and raw Float64 columns. Every alternative is checked bit-exact.
  Run: node --import tsx research/oldpath/wire_measure.ts
*/
import fs from 'node:fs';
import zlib from 'node:zlib';
import { model1Board } from '../../src/data/twobook/model1';
import { encodedBoard } from '../../src/data/twobook/model1Server';

const ms = (f: () => unknown, n = 5): number => {
  f();
  const t = performance.now();
  for (let i = 0; i < n; i++) f();
  return +((performance.now() - t) / n).toFixed(1);
};
for (const t of ['spy', 'spx']) {
  const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(`scripts/fixtures/twobook/${t}-model1.json.gz`)).toString());
  const rows = model1Board({ ...fx.inputs, contracts: null });
  const w = model1Board(fx.inputs);
  const cells = w.legs!.cells;
  const W = cells[0].length;
  const n = cells.length;
  const json = JSON.stringify(w);
  const gz = zlib.gzipSync(json);
  /* Float64 columns: null ↔ NaN (the cells hold no other non-finite value) */
  const f64 = new Float64Array(n * W);
  for (let i = 0; i < W; i++) for (let k = 0; k < n; k++) f64[i * n + k] = cells[k][i] ?? NaN;
  const raw = Buffer.from(f64.buffer);
  const b64json = JSON.stringify({ ...w, legs: { dates: w.legs!.dates, n, w: W, f64: raw.toString('base64') } });
  const back = (() => {
    const j = JSON.parse(b64json);
    const b = Buffer.from(j.legs.f64, 'base64');
    const f = new Float64Array(b.buffer, b.byteOffset, b.length / 8);
    return Array.from({ length: n }, (_, k) => Array.from({ length: W }, (_, i) => (Number.isNaN(f[i * n + k]) ? null : f[i * n + k])));
  })();
  let off = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < W; i++) if (!Object.is(cells[k][i], back[k][i])) off++;
  const cols = JSON.stringify(Array.from({ length: W }, (_, i) => cells.map(r => r[i])));
  console.log(
    JSON.stringify({
      name: t.toUpperCase(),
      cells: n,
      rowsPhaseGzip: zlib.gzipSync(JSON.stringify(rows)).length,
      json: json.length,
      jsonGzip: gz.length,
      serverStringifyMs: ms(() => JSON.stringify(w)),
      serverGzipMs: ms(() => zlib.gzipSync(json)),
      serverEncodedOnceMs: ms(() => encodedBoard(w)),
      clientParseMs: ms(() => JSON.parse(json)),
      columnarJsonGzip: zlib.gzipSync(cols).length,
      f64Base64JsonGzip: zlib.gzipSync(b64json).length,
      f64Base64ParseMs: ms(() => JSON.parse(b64json)),
      f64RawGzip: zlib.gzipSync(raw).length,
      f64BitExactOff: off,
    }),
  );
}
