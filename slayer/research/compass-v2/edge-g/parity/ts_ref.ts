/* EDGE-G parity: the app's own functions on legs handed in as JSON (argv[2]) -> JSON (argv[3]).
   core/gammaFlip.ts repricedFlip / netGammaAt (quietLegs inside), core/walls.ts pickLegWalls. */
import { readFileSync, writeFileSync } from 'node:fs';
import { netGammaAt, repricedFlip, type GammaLeg } from '../../../../src/core/gammaFlip';
import { pickLegWalls } from '../../../../src/core/walls';

type InLeg = { strike: number; g0: number; iv: number; t: number; s0?: number; oi?: number; side?: 1 | -1; ownIv?: boolean; t0?: number };
type Case = { name: string; spot: number; r: number; q: number; prices: number[]; legs: InLeg[]; walls?: { strike: number; c: number; p: number }[] };
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case[];
const out = cases.map(c => {
  const legs = c.legs.map(l => {
    const o: GammaLeg = { strike: l.strike, g0: l.g0, iv: l.iv, t: l.t };
    if (l.s0) o.s0 = l.s0;
    if (l.oi) o.oi = l.oi;
    if (l.side) o.side = l.side;
    if (l.ownIv) o.ownIv = true;
    if (l.t0) o.t0 = l.t0;
    return o;
  });
  const f = repricedFlip(legs, c.spot, c.r, 0.1, c.q);
  const net = c.prices.map(p => netGammaAt(legs, c.spot, p, c.r, c.q));
  const w = c.walls ? pickLegWalls(c.walls, x => x.c, x => x.p) : null;
  return { name: c.name, flip: f.flip, netAtSpot: f.netAtSpot, crossings: f.crossings ?? [], net, walls: w };
});
writeFileSync(process.argv[3], JSON.stringify(out));
