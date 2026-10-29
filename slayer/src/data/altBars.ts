
/* Range and volume bars from the live 15-second tape, so live-only (no backfill). A bar closes on the first quarter meeting its rule
   (it may overshoot), never spans the overnight gap, and the last one is still forming. No tick bars: nothing upstream carries trades. */

export type AltBarKind = 'range' | 'volume';

export interface AltBarSpec {
  kind: AltBarKind;
  /** Dollars of range, or shares of volume. */
  size: number;
}

/** The pane's bar-clock choices, keyed for persistence, in one table read by the validator, the menu and the chart. `'time'` is the plain timeframe clock. */
export const BAR_CLOCKS: readonly {
  key: string;
  spec: AltBarSpec | null;
  label: string;
  /** The chip's word in the dense menu (a docked pane's), the label as its hover name */
  short: string;
  blurb: string;
}[] = [
  { key: 'time', spec: null, label: 'Time', short: 'Time', blurb: 'Bars close on the clock — the timeframe strip decides.' },
  { key: 'r50', spec: { kind: 'range', size: 0.5 }, label: 'Range $0.50', short: '$0.50', blurb: 'A bar closes when it spans half a dollar.' },
  { key: 'r200', spec: { kind: 'range', size: 2 }, label: 'Range $2', short: '$2', blurb: 'A bar closes when it spans two dollars.' },
  { key: 'v10k', spec: { kind: 'volume', size: 10_000 }, label: 'Volume 10k', short: '10k', blurb: 'A bar closes when 10,000 shares have traded.' },
  { key: 'v50k', spec: { kind: 'volume', size: 50_000 }, label: 'Volume 50k', short: '50k', blurb: 'A bar closes when 50,000 shares have traded.' },
];

export const isBarClock = (v: unknown): v is string =>
  typeof v === 'string' && BAR_CLOCKS.some(c => c.key === v);

export const barClockSpec = (key: string): AltBarSpec | null =>
  BAR_CLOCKS.find(c => c.key === key)?.spec ?? null;

