/* Shared figure spellings: strikes, percents, dollars, expiry labels. */

import { nyParts } from './nyTime';
import { MONTHS } from './calendar';

const DASH = '—';

/** A strike as the chain prints it: whole strikes bare, the rest to the cent, thousands commas, a dash for no figure (a missing wall is NaN) */
export const fmtStrike = (v: number): string => {
  if (!Number.isFinite(v)) return DASH;
  const whole = Math.abs(v - Math.round(v)) < 1e-9;
  return v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2, useGrouping: true });
};
/** …and a dash for no figure */
export const fmtStrikeOrDash = (v: number): string => (!Number.isFinite(v) ? DASH : fmtStrike(v));
/** A fraction as a whole percent: 0.237 → "24%" */
export const pctWhole = (v: number): string => `${Math.round(v * 100)}%`;
/** Dollars to the cent with thousands: "$1,234.50" (a minus as JavaScript writes it) */
export const usd2 = (v: number): string => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A price with thousands commas. Two decimals unless `digits` says otherwise. */
export function fmtPx(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return DASH;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true });
}

/** A whole strike stays whole. Anything else keeps cents. */
export const fmtStrikePx = fmtStrike;

/** Chart series price format: the axis and the crosshair, with commas. */
export function pxSeriesFormat(precision = 2, minMove = 0.01) {
  return {
    type: 'custom' as const,
    precision,
    minMove,
    formatter: (p: number) => fmtPx(p, precision),
  };
}

/** A signed percent, the minus a true minus; a rounded zero carries no sign */
export const pctSigned = (v: number, digits = 1): string => {
  if (!Number.isFinite(v)) return DASH;
  const body = Math.abs(v).toFixed(digits);
  const sign = Number(body) === 0 ? '' : v < 0 ? '−' : '+';
  return `${sign}${body}%`;
};

/** "Oct 17" for an expiry written MM/DD/YYYY or YYYY-MM-DD; the year only when it is not this one */
export const expiryLabel = (s: string, thisYear = nyParts().year): string => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : us ? [us[3].length === 2 ? 2000 + +us[3] : +us[3], +us[1], +us[2]] : [0, 0, 0];
  if (!m || m > 12) return s;
  return `${MONTHS[m - 1]} ${d}${y !== thisYear ? ` ’${String(y).slice(2)}` : ''}`;
};
