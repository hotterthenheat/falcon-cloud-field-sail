/* The News map's shared pieces: its props, the cash sessions, the heat legend and the map itself, which loads its
   renderer (NewsMapLive: MapLibre and the atlas) only when the map is first shown. */

import { lazy, Suspense, useState } from 'react';
import type { CityPing, GeoZone } from '../../data/newsroom';

/** One zone's summed weight over the cut — the heat under a country */
export interface HeatPoint {
  lat: number;
  lng: number;
  w: number;
}
/** The open story's origin and where it lands */
export interface Reach {
  lat: number;
  lng: number;
  city: string;
  zones: GeoZone[];
}
/** A place to glide to — a new `key` starts a glide */
export interface FlyTo {
  lng: number;
  lat: number;
  key: string;
}

/** A market's cash hours in its own clock, and the longitudes its wash covers */
export interface SessionDef {
  key: string;
  label: string;
  tz: string;
  /** minutes into the local day */
  open: number;
  close: number;
  /** local minutes the cash market is shut for lunch, [start, reopen) */
  lunch?: readonly [number, number];
  west: number;
  east: number;
}
const SESSIONS: SessionDef[] = [
  { key: 'tokyo', label: 'Tokyo', tz: 'Asia/Tokyo', open: 9 * 60, close: 15 * 60, lunch: [11 * 60 + 30, 12 * 60 + 30], west: 95, east: 150 },
  { key: 'london', label: 'London', tz: 'Europe/London', open: 8 * 60, close: 16 * 60 + 30, west: -12, east: 32 },
  { key: 'newyork', label: 'New York', tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60, west: -128, east: -64 },
];
/* one formatter per market, kept: nextOpen reads the clock about a thousand times over a weekend */
const clockFmt = new Map<string, Intl.DateTimeFormat>();
const fmtFor = (tz: string): Intl.DateTimeFormat => {
  let f = clockFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
    clockFmt.set(tz, f);
  }
  return f;
};
const localClock = (at: Date, tz: string): { min: number; weekday: boolean } => {
  const parts = fmtFor(tz).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const wd = get('weekday');
  return { min: (Number(get('hour')) % 24) * 60 + Number(get('minute')), weekday: wd !== 'Sat' && wd !== 'Sun' };
};
const inLunch = (s: SessionDef, min: number): boolean => !!s.lunch && min >= s.lunch[0] && min < s.lunch[1];
/** Which cash sessions are open at a moment — Tokyo is shut 11:30–12:30 JST */
export const openSessions = (at: Date): SessionDef[] =>
  SESSIONS.filter(s => {
    const { min, weekday } = localClock(at, s.tz);
    return weekday && min >= s.open && min < s.close && !inLunch(s, min);
  });
/** The next cash session to open after `at`, walked in five-minute steps over four days. Lunch's end is an open. */
export const nextOpen = (at: Date): { session: SessionDef; at: Date } | null => {
  const t = new Date(at);
  t.setSeconds(0, 0);
  t.setMinutes(Math.floor(t.getMinutes() / 5) * 5);
  const justOpened = (s: SessionDef, min: number) => (min >= s.open && min < s.open + 5) || (!!s.lunch && min >= s.lunch[1] && min < s.lunch[1] + 5);
  for (let i = 0; i < (4 * 24 * 60) / 5; i++) {
    t.setMinutes(t.getMinutes() + 5);
    for (const s of SESSIONS) {
      const { min, weekday } = localClock(t, s.tz);
      if (weekday && justOpened(s, min)) return { session: s, at: new Date(t) };
    }
  }
  return null;
};

/** The land's inks on the map, and the legend's */
export const HEAT_INK = '#c4845a';
export const OPEN_INK = '#5f9e86';
export const NEWS_INK = '#4d7a68';

export const HeatLegend = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center gap-3 font-mono text-t10 text-textSecondary whitespace-nowrap ${className}`} title="Countries a story on the cut reaches, and the open story's own" data-heat-legend>
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: HEAT_INK }} data-heat-swatch="lands" />
      where the news lands
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: OPEN_INK }} data-heat-swatch="open" />
      the open story
    </span>
  </span>
);

export interface MapProps {
  pins: CityPing[];
  selectedCity: string | null;
  hoverCity: string | null;
  onPick: (pin: CityPing) => void;
  onHover: (pin: CityPing | null) => void;
  /** Where the cut's news lands, summed by zone */
  heat: HeatPoint[];
  /** The open story's origin and zones, or nothing open */
  reach: Reach | null;
  /** A picked story's city; a new key flies the map there */
  flyTo?: FlyTo | null;
  sessions: SessionDef[];
  className?: string;
}

const LiveMap = lazy(() => import('./NewsMapLive'));

/** The wire's map. Without WebGL it says so rather than leave an empty box. */
const NewsMap = (props: Omit<MapProps, 'sessions'> & { at: Date }) => {
  const [failed, setFailed] = useState(false);
  const { at, ...rest } = props;
  const box = <div className={props.className} data-news-map="loading" />;
  if (failed)
    return (
      <div className={`${props.className ?? ''} flex items-center justify-center font-mono text-t10 uppercase tracking-widest text-textMuted`} data-news-map="failed">
        The map cannot draw in this browser
      </div>
    );
  return (
    <Suspense fallback={box}>
      <LiveMap {...rest} sessions={openSessions(at)} onFail={() => setFailed(true)} />
    </Suspense>
  );
};

export default NewsMap;
