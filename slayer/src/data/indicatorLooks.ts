/* How each chart indicator is drawn, beyond on/off: its inputs, its ink, opacity and thickness, the eye, which
   timeframes it shows on, and whether its value prints on the price scale and in the legend — the three tabs of the
   settings dialog (Inputs / Style / Visibility). One record per indicator key for the whole desk, kept in this browser.
   Off the record, an indicator draws exactly as it always did. */

import { useSyncExternalStore } from 'react';

export type TfBand = 'minutes' | 'hours' | 'days';
export const TF_BANDS: { key: TfBand; label: string; blurb: string }[] = [
  { key: 'minutes', label: 'Minutes', blurb: '1m to 30m' },
  { key: 'hours', label: 'Hours', blurb: '1h to 4h' },
  { key: 'days', label: 'Days and up', blurb: 'D, W, M' },
];
export const tfBandOf = (mins: number): TfBand => (mins >= 1440 ? 'days' : mins >= 60 ? 'hours' : 'minutes');

export interface IndicatorInputSpec {
  id: string;
  title: string;
  default: number;
  min: number;
  max: number;
  step: number;
  tooltip?: string;
  /** A switch (0 off, 1 on) rather than a number; or a choice of `options`, its value the option's index */
  kind?: 'toggle' | 'choice';
  options?: readonly string[];
  /** Left out of the legend row's inputs (a style switch, not a parameter) */
  quiet?: boolean;
}

export interface IndicatorLook {
  inputs?: Record<string, number>;
  /** #RRGGBB; the indicator's own ink when unset */
  ink?: string;
  /** 0.1 … 1 */
  opacity?: number;
  /** 1 … 4 px */
  width?: number;
  /** The eye: on the chart but not drawn */
  hidden?: boolean;
  /** Timeframe bands it does NOT show on */
  offOn?: TfBand[];
  /** The last value's label on the price scale (default on) */
  scaleLabel?: boolean;
  /** Values in the legend row (default on) */
  legendValues?: boolean;
}

const KEY = 'slayer:indicator-looks:v1';
let looks: Record<string, IndicatorLook> = {};
let rev = 0;
const listeners = new Set<() => void>();

try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (parsed && typeof parsed === 'object') looks = parsed as Record<string, IndicatorLook>;
} catch {
  looks = {};
}

export const lookOf = (key: string): IndicatorLook => looks[key] ?? {};

export function setLook(key: string, patch: Partial<IndicatorLook> | null): void {
  if (patch === null) delete looks[key];
  else looks = { ...looks, [key]: { ...lookOf(key), ...patch } };
  looks = { ...looks };
  rev++;
  try {
    localStorage.setItem(KEY, JSON.stringify(looks));
  } catch {
    /* private mode: the look holds for this visit */
  }
  listeners.forEach(fn => fn());
}

export function useLooksRev(): number {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
}

/** An input's value: the saved one inside its bounds, else the default */
export function inputOf(key: string, spec: IndicatorInputSpec): number {
  const v = lookOf(key).inputs?.[spec.id];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : spec.default;
}

/** Drawn on this timeframe: the eye is open and the band is not switched off */
export const drawnOn = (key: string, mins: number): boolean => {
  const l = lookOf(key);
  return !l.hidden && !(l.offOn ?? []).includes(tfBandOf(mins));
};

/** #RRGGBB (or #RRGGBBAA) at an opacity, as rgba() */
export function inkAt(hex: string, opacity = 1): string {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return hex;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.round(a * opacity * 1000) / 1000})`;
}
