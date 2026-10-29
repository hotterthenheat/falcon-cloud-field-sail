/* Shared figure spellings: strikes, percents, dollars, expiry labels. */

import { nyParts } from './nyTime';
import { MONTHS } from './calendar';

const DASH = '—';

/** A strike as the chain prints it: whole strikes bare, the rest to the cent ("NaN" for no figure) */
export const fmtStrike = (v: number): string => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
/** …and a dash for no figure */
export const fmtStrikeOrDash = (v: number): string => (!Number.isFinite(v) ? DASH : fmtStrike(v));
/** A fraction as a whole percent: 0.237 → "24%" */
export const pctWhole = (v: number): string => `${Math.round(v * 100)}%`;
/** Dollars to the cent with thousands: "$1,234.50" (a minus as JavaScript writes it) */
export const usd2 = (v: number): string => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
