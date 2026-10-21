/*
==================================================
  SLAYER TERMINAL - THE FIGURES' SPELLING (core/format.ts)

  The two spellings the tape's compound cells
  needed first, taken from the partner's build at
  Noah's word (2026-10-13):

    pctSigned(2.345)       "+2.3%"   ("−0.4%", "0.0%" unsigned at zero, "—" for no figure)
    expiryLabel("10/17/2026") "Oct 17"  (a year off this one adds " ’27")
==================================================
*/

import { nyParts } from './nyTime';

const DASH = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
