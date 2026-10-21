/*
==================================================
  SLAYER TERMINAL - THE BOOK, TAKEN AWAY (data/exportBook.ts)

  What the Map draws, as a file (the competitive
  audit, 2026-10-13 — every product in the category
  hands its book over as CSV or JSON; the Map had no
  door for it): the book by greek, date and strike
  with both legs and the net, and the levels with
  the moment they were read at. Written in the
  browser from the surface on screen — nothing is
  asked of a server; what you see is what you get.
==================================================
*/

import { nyStamp } from '../core/nyTime';
import type { ExposureSurface, Greek } from './exposureSurface';
import type { LevelsScope } from './levelsScope';

const cell = (v: unknown): string => {
  const s = v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The book as rows: one per greek × date × strike, the legs and the net in signed dollars, the open interest */
export function bookCsv(surface: ExposureSurface, greeks: Greek[], expiries: number[]): string {
  const head = ['ticker', 'spot', 'read_at_et', 'greek', 'expiry', 'dte', 'strike', 'put', 'call', 'net', 'open_interest'];
  const at = nyStamp(Date.now(), { seconds: true });
  const rows: string[] = [head.join(',')];
  for (const g of greeks)
    for (const e of expiries) {
      const ex = surface.expiries[e];
      if (!ex) continue;
      surface.strikes.forEach((k, s) => {
        rows.push([surface.ticker, surface.spot.toFixed(2), at, g, ex.date, ex.dte, k, Math.round(surface.put[g][e]?.[s] ?? 0), Math.round(surface.call[g][e]?.[s] ?? 0), Math.round(surface.net[g][e]?.[s] ?? 0), Math.round(surface.oi[e]?.[s] ?? 0)].map(cell).join(','));
      });
    }
  return rows.join('\n') + '\n';
}

/** The levels, with the moment and the contracts they were read off */
export function levelsJson(surface: ExposureSurface, scope: LevelsScope, source: string): string {
  const l = surface.levels;
  const num = (v: number) => (Number.isFinite(v) ? v : null);
  return JSON.stringify(
    {
      ticker: surface.ticker,
      spot: surface.spot,
      readAt: new Date().toISOString(),
      readAtEt: nyStamp(Date.now(), { seconds: true, zone: true }),
      source,
      levelsReadOff: scope === 'ALL' ? 'all listed expiries' : "today's contracts (0DTE)",
      levels: { callWall: num(l.callWall), putWall: num(l.putWall), flip: num(l.flip), pin: num(l.pin), supreme: num(l.supreme) },
      supremeByGreek: Object.fromEntries(Object.entries(surface.supreme).map(([g, s]) => [g, { strike: s.strike, total: Math.round(s.total), heaviestDate: surface.expiries[s.e]?.date ?? null }])),
      expiries: surface.expiries.map(e => ({ date: e.date, dte: e.dte, atmIv: e.iv })),
    },
    null,
    2
  );
}

/** Hand a text file to the browser */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stampForName = (): string => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
