/* The words and figures the rail's Regime and OI change tabs share (VolRegimeView, OiChangeView) */

import { useEffect, useState, type RefObject } from 'react';
import { MONTHS } from '../../core/nyTime';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "2026-10-30" → "Fri Oct 30" (or "Oct 30" without the weekday) */
export function fmtDay(iso: string | null | undefined, weekday = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '—';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ''}${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
/** A minute of the New York day as the clock reads it: 975 → "4:15 PM" */
export function fmtMinute(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const mm = String(min % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
/** "2026-10-30T16:15:01" → "Fri Oct 30, 4:15 PM ET" */
export function fmtStamp(stamp: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(stamp ?? '');
  return m ? `${fmtDay(m[1])}, ${fmtMinute(+m[2] * 60 + +m[3])} ET` : '—';
}
/** A signed figure with a true minus */
export function signed(v: number, digits = 0): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}
/** 87.4 → "87th" (the ordinal a percentile reads as) */
export function ordinal(p: number): string {
  const n = Math.min(100, Math.max(0, Math.round(p)));
  const t = n % 100;
  const suf = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suf}`;
}
/** An element's width, kept current */
export function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.round(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
