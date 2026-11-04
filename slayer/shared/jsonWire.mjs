/*
  One JSON body for every viewer until its stamp changes. The bytes (and the gzip) are built once.
  Used by the shared reads: tape, exposure, vol outlook, terrain, regime, open-interest change, name card, review.
*/
import { gzipSync } from 'node:zlib';

const box = new Map();
const MAX = 80;

/** @param {string} key  which payload @param {string} stamp  changes when the payload does @param {() => unknown} make */
export function takeWire(key, stamp, make) {
  const hit = box.get(key);
  if (hit && hit.stamp === stamp) {
    box.delete(key);
    box.set(key, hit);
    return hit;
  }
  const made = make();
  const json = typeof made === 'string' || Buffer.isBuffer(made) ? Buffer.from(made) : Buffer.from(JSON.stringify(made));
  const wire = { stamp, json, gzip: json.length > 4096 ? gzipSync(json) : null };
  box.set(key, wire);
  if (box.size > MAX) box.delete(box.keys().next().value);
  return wire;
}

/** @param {{ headers: Record<string, string | string[] | undefined> }} req */
export function writeWire(req, res, status, wire) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (wire.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'accept-encoding');
    res.end(wire.gzip);
    return;
  }
  res.end(wire.json);
}
