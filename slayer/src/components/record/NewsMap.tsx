/* The News map's shared pieces: its props, the cash sessions, the heat legend and the map itself, which loads its
   renderer (NewsMapLive: MapLibre and the atlas) only when the map is first shown. */

import { lazy, Suspense, useState } from 'react';
import type { CityPing, GeoZone } from '../../data/newsroom';
import { useResolvedTheme } from '../../theme/theme';

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

/** Every colour the map paints, per theme; the legend reads the same values */
export const MAP_INK = {
  dark: {
    sea: '#0a1016',
    land: '#1c242d',
    edge: 'rgba(170,186,204,0.26)',
    heat: '#e0a25a',
    heatSteps: [0.16, 0.28, 0.42, 0.6] as const,
    open: '#eef3fa',
    reachFrom: 'rgba(199,211,232,0.25)',
    reachTo: 'rgba(199,211,232,0.95)',
    session: '#c7d3e8',
    sessionOpacity: 0.06,
  },
  light: {
    sea: '#c6d6e0',
    land: '#f6f4ef',
    edge: 'rgba(36,50,64,0.42)',
    heat: '#c2661a',
    heatSteps: [0.16, 0.3, 0.46, 0.66] as const,
    open: '#1b2636',
    reachFrom: 'rgba(47,61,92,0.3)',
    reachTo: 'rgba(47,61,92,0.95)',
    session: '#2f3d5c',
    sessionOpacity: 0.07,
  },
};

/** A pin's colour: the way the named stocks moved when their stories crossed — more up, more down, or neither
    (macro stories, no move measured at publish, or as many each way) */
export const pinTone = (up: number, down: number): 'up' | 'down' | 'flat' => (up > down ? 'up' : down > up ? 'down' : 'flat');

export const HeatLegend = ({ className = '' }: { className?: string }) => {
  const theme = useResolvedTheme();
  const k = MAP_INK[theme === 'light' ? 'light' : 'dark'];
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-t10 text-textSecondary ${className}`} data-heat-legend>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title="Countries shaded by how many stories on this cut come from them — darker is more">
        <span className="inline-flex" aria-hidden="true">
          {k.heatSteps.map((o, i) => (
            <span key={i} className="inline-block w-2.5 h-2.5" style={{ background: k.heat, opacity: o + 0.12 }} data-heat-swatch={`step-${i + 1}`} />
          ))}
        </span>
        stories from here
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title="A pin is green when its stories' named stocks were up on the session as they crossed, red when down, grey when neither (macro stories, or no move measured at publish)">
        <span className="inline-block w-2 h-2 rounded-full bg-bull" data-pin-swatch="up" />
        <span className="inline-block w-2 h-2 rounded-full bg-bear" data-pin-swatch="down" />
        <span className="inline-block w-2 h-2 rounded-full bg-silver" data-pin-swatch="flat" />
        name up / down / no move at publish
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title="The open story's lines run to the markets its sector trades through">
        <span className="inline-block w-3 h-px bg-silver" data-heat-swatch="reach" />
        the open story's reach
      </span>
    </span>
  );
};

export interface MapProps {
  pins: CityPing[];
  selectedCity: string | null;
  hoverCity: string | null;
  onPick: (pin: CityPing) => void;
  onHover: (pin: CityPing | null) => void;
  /** Where the cut's stories come from: one point per city, weighed by its story count */
  heat: HeatPoint[];
  /** The open story's origin and zones, or nothing open */
  reach: Reach | null;
  /** A picked story's city; a new key flies the map there */
  flyTo?: FlyTo | null;
  sessions: SessionDef[];
  /** Said over the map when it has nothing to show (the wire still reading, or no story on the cut names a place) */
  note?: string | null;
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
