/* Every drawing tool, in TradingView's families. One list read by the rail's family buttons, the fly-outs, the all-tools sheet
   and the command palette. A family's button wears its last tool; starred tools sit on the rail's last button. Old house names stay as search words. */

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { DrawingKind } from './drawingsPrimitive';
import { getStamp, subscribeStamp } from './drawStamp';

type DrawFamilyId = 'trend' | 'fib' | 'patterns' | 'measure' | 'shapes' | 'words' | 'icons';

export interface DrawToolDef {
  tool: DrawingKind;
  label: string;
  icon: JSX.Element;
  /** The small head it sits under in its family's list */
  sub: string;
  /** More words the search answers to */
  keys?: string;
}

interface DrawFamily {
  id: DrawFamilyId;
  name: string;
  /** The sheet's tab — six of them share one row, so each is a word */
  short: string;
  tools: DrawToolDef[];
}

/** Every glyph is drawn at 1em — the rail, the list and the sheet's tile each set their own size */
const G = ({ children, fill }: { children: ReactNode; fill?: boolean }) => (
  <svg viewBox="0 0 16 16" className="w-[1em] h-[1em] shrink-0" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const END = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="1.6" fill="none" />;

const ICON = {
  trend: (
    <G>
      {END(3.4, 12.6)}
      {END(12.6, 3.4)}
      <path d="M4.6 11.4 11.4 4.6" />
    </G>
  ),
  ray: (
    <G>
      {END(3.2, 12.8)}
      {END(8, 8)}
      <path d="M4.4 11.6 6.8 9.2M9.2 6.8 14 2" />
    </G>
  ),
  extend: (
    <G>
      {END(5.4, 10.6)}
      {END(10.6, 5.4)}
      <path d="M1.5 14.5 4.2 11.8M6.6 9.4 9.4 6.6M11.8 4.2 14.5 1.5" />
    </G>
  ),
  hline: (
    <G>
      {END(8, 8)}
      <path d="M1.5 8h4.9M9.6 8h4.9" />
    </G>
  ),
  hray: (
    <G>
      {END(3.4, 8)}
      <path d="M5 8h9.5" />
    </G>
  ),
  vline: (
    <G>
      {END(8, 8)}
      <path d="M8 1.5v4.9M8 9.6v4.9" />
    </G>
  ),
  cross: (
    <G>
      {END(8, 8)}
      <path d="M1.5 8h4.9M9.6 8h4.9M8 1.5v4.9M8 9.6v4.9" />
    </G>
  ),
  channel: (
    <G>
      {END(3, 10)}
      {END(11, 3.5)}
      <path d="M4.3 9 9.7 4.5M5 14.5 14.5 6.8" />
    </G>
  ),
  fib: (
    <G>
      <path d="M2 3h12M2 6.4h12M2 9.6h9M2 13h12" />
      {END(12.6, 9.6)}
    </G>
  ),
  fibext: (
    <G>
      <path d="M6 3h8.5M6 6h8.5M6 9h8.5" />
      <path d="M2 14 5 9.5 8 12.5" />
      {END(2, 14)}
    </G>
  ),
  fibchannel: (
    <G>
      <path d="M1.5 10.5 12 2M2.8 13 13.3 4.5M4 15.5 14.5 7" />
      {END(12.2, 2)}
    </G>
  ),
  long: (
    <G>
      <path d="M2 8h12M2 3h9M2 13h9" />
      <path d="M12.5 6V2.5M11 4l1.5-1.5L14 4" />
    </G>
  ),
  short: (
    <G>
      <path d="M2 8h12M2 3h9M2 13h9" />
      <path d="M12.5 10v3.5M11 12l1.5 1.5L14 12" />
    </G>
  ),
  prange: (
    <G>
      <path d="M3 2.5h10M3 13.5h10M8 4.5v7M6.3 6 8 4.3 9.7 6M6.3 10 8 11.7 9.7 10" />
    </G>
  ),
  drange: (
    <G>
      <path d="M2.5 3v10M13.5 3v10M4.5 8h7M6 6.3 4.3 8 6 9.7M10 6.3 11.7 8 10 9.7" />
    </G>
  ),
  measure: (
    <G>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M8 5v6M5 8h6" />
    </G>
  ),
  avwap: (
    <G>
      {END(2.8, 11.5)}
      <path d="M4.3 11c2-.4 3.2-3.6 5.2-4.6s3.4-.2 4.5-1.4" />
      <path d="M6.5 13.5v-2M9.5 12.5v-3M12.5 11V8" />
    </G>
  ),
  brush: (
    <G>
      <path d="M13.5 2.5c-3 1.6-5.6 4.3-7.2 7l1.7 1.7c2.7-1.6 5.4-4.2 7-7.2z" />
      <path d="M6.3 9.5c-1.8 0-2.8 1-3 2.6-.1.8-.5 1.3-1.3 1.6 2.6.6 5.4-.3 6-2.5" />
    </G>
  ),
  highlighter: (
    <G>
      <path d="M9.5 2.5 13.5 6.5 7.8 12.2H3.8v-4z" />
      <path d="M2 14.5h12" />
    </G>
  ),
  arrow: (
    <G>
      {END(3.2, 12.8)}
      <path d="M4.4 11.6 13 3M13 3H8.6M13 3v4.4" />
    </G>
  ),
  arrowup: (
    <G>
      <path d="M8 2 13 7.5H10V14H6V7.5H3z" />
    </G>
  ),
  arrowdown: (
    <G>
      <path d="M8 14 3 8.5H6V2h4v6.5h3z" />
    </G>
  ),
  rect: (
    <G>
      <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />
    </G>
  ),
  rotrect: (
    <G>
      <path d="M6.5 1.8 14.2 6.5 9.5 14.2 1.8 9.5z" />
    </G>
  ),
  circle: (
    <G>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </G>
  ),
  ellipse: (
    <G>
      <ellipse cx="8" cy="8" rx="6.3" ry="3.9" />
    </G>
  ),
  triangle: (
    <G>
      <path d="M3 13 5.5 3 13.5 10.5z" />
    </G>
  ),
  polyline: (
    <G>
      <path d="M3 5.5 8.5 2.5 13.5 6 11.5 12.5 4.5 13.5z" />
    </G>
  ),
  path: (
    <G>
      {END(2.6, 12.6)}
      {END(6.8, 6.2)}
      <path d="M7.6 7.4 10 10 13.4 3.4M13.6 2.6l.3 2.8M13.6 2.6l-2.7.5" />
    </G>
  ),
  curve: (
    <G>
      {END(2.8, 12.8)}
      {END(13.2, 5)}
      <path d="M3.4 11.3C4 5 8 3 11.7 4.6" />
    </G>
  ),
  text: (
    <G>
      <path d="M3.5 4V3h9v1M8 3v10M6.3 13h3.4" />
    </G>
  ),
  note: (
    <G>
      <path d="M3 2.5h10v7.5l-3.5 3.5H3z" />
      <path d="M13 10H9.5v3.5" />
    </G>
  ),
  callout: (
    <G>
      <path d="M2.5 2.5h11v8H8L4.5 13.8V10.5h-2z" />
    </G>
  ),
  pricelabel: (
    <G>
      <path d="M5 2.5h8.5v6.5H8.5L2.5 13.5 5 9z" />
      <path d="M7.4 5.8h3.7" />
    </G>
  ),
  /* ── phase one of TradingView parity — our own glyphs, drawn on the same 16-unit grid ── */
  infoline: (
    <G>
      {END(2.8, 13)}
      {END(9, 6.6)}
      <path d="M4 11.8 7.8 7.8" />
      <rect x="9.6" y="1.8" width="5" height="3.6" rx="0.6" />
    </G>
  ),
  trendangle: (
    <G>
      {END(2.8, 12.6)}
      <path d="M4.2 11.4 13 3M4.4 12.6H14" />
      <path d="M8.4 12.6a4.2 4.2 0 0 0-1-2.7" />
    </G>
  ),
  regression: (
    <G>
      <path d="M2 10.5 14 4.5" />
      <path d="M2 13.5 14 7.5M2 7.5 14 1.5" strokeDasharray="1.6 1.8" />
    </G>
  ),
  flattop: (
    <G>
      <path d="M2 4h12M2 13 14 7" />
      {END(2, 13)}
    </G>
  ),
  disjoint: (
    <G>
      <path d="M2 3.5 14 8M2 12.5 14 8.8" />
      {END(2, 3.5)}
      {END(2, 12.5)}
    </G>
  ),
  pitchfork: (
    <G>
      {END(2.4, 12.4)}
      <path d="M3.6 11.2 13.8 5.2M7 4.2 14.5 1.2M9 13.6 15 9.6M7 4.2 9 13.6" />
    </G>
  ),
  schiff: (
    <G>
      {END(2.4, 9)}
      <path d="M3.8 8.6 13.8 5.2M7 4.2 14.5 1.2M9 13.6 15 9.6M7 4.2 9 13.6M2.4 10.6v3" />
    </G>
  ),
  mschiff: (
    <G>
      {END(4.8, 8.8)}
      <path d="M6.2 8.3 13.8 5.2M7 4.2 14.5 1.2M9 13.6 15 9.6M7 4.2 9 13.6M1.8 14 3.9 10" />
    </G>
  ),
  fibtime: (
    <G>
      <path d="M2.5 2v12M4.5 2v12M6.5 2v12M9.5 2v12M14 2v12" />
    </G>
  ),
  fibfan: (
    <G>
      {END(2.4, 13.6)}
      <path d="M3.6 12.4 14 2M3.8 12.8 14 6M3.8 13.2 14 10M3.4 12.2 8 2" />
    </G>
  ),
  fibcircles: (
    <G>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="4" />
      <circle cx="8" cy="8" r="6.4" />
    </G>
  ),
  fibspiral: (
    <G>
      <path d="M8.2 8.4c.8 0 1-.9.5-1.4-.8-.8-2.2-.3-2.4.9-.3 1.7 1.1 3 2.8 2.9 2.4-.2 3.6-2.7 3-4.9C11.4 3.3 8.6 2 6 2.8 2.8 3.8 1.4 7.4 2.6 10.4c1.2 3 4.6 4.6 7.8 3.8" />
    </G>
  ),
  fibwedge: (
    <G>
      {END(2.4, 12.8)}
      <path d="M3.8 12 14 4.5M3.9 13 14.5 13M8.6 8.9a6 6 0 0 1 .7 4M11.4 6.8a8.8 8.8 0 0 1 1.2 6.2" />
    </G>
  ),
  gannbox: (
    <G>
      <rect x="2" y="2" width="12" height="12" rx="0.5" />
      <path d="M5 2v12M8 2v12M11 2v12M2 5h12M2 8h12M2 11h12" strokeWidth="0.7" />
    </G>
  ),
  gannsquare: (
    <G>
      <rect x="2" y="2" width="12" height="12" rx="0.5" />
      <path d="M2 14 14 2M2 2l12 12M2 8a6 6 0 0 0 6 6" />
    </G>
  ),
  gannfan: (
    <G>
      {END(2.4, 13.6)}
      <path d="M3.4 12.4 6 2M3.6 12.6 10 2M3.8 12.8 14 4M3.8 13.2 14 9M3.8 13.4 14 12.6" />
    </G>
  ),
  xabcd: (
    <G>
      <path d="M1.5 12 4.5 3 7.5 9 10.5 4.5 14.5 13" />
      <path d="M1.5 12 7.5 9M7.5 9 14.5 13" strokeDasharray="1.4 1.6" />
    </G>
  ),
  abcd: (
    <G>
      <path d="M2 13 6 3 10 9.5 14 2" />
      {END(2, 13)}
      {END(14, 2)}
    </G>
  ),
  hs: (
    <G>
      <path d="M1 12.5 3.6 7 5.6 10 8 3 10.4 10 12.4 7 15 12.5" />
      <path d="M3.5 10h9" strokeDasharray="1.4 1.6" />
    </G>
  ),
  tripattern: (
    <G>
      <path d="M1.5 2.5 4.5 13 8 5 10.5 11 12.5 7.5" />
      <path d="M1.5 2.5 14.5 8.6M4.5 13 14.5 8.6" strokeWidth="0.8" />
    </G>
  ),
  threedrives: (
    <G>
      <path d="M1 14 4 9 5.5 11 9 5.5 10.5 8 14.5 2" />
    </G>
  ),
  elliott5: (
    <G>
      <path d="M1 14 4 8 6 11 10 3 12 6.5 15 2" />
      <text x="9.2" y="15.2" fontSize="5" stroke="none" fill="currentColor">5</text>
    </G>
  ),
  elliott3: (
    <G>
      <path d="M1.5 3 6 11 9.5 6 14.5 14" />
      <text x="10.6" y="6" fontSize="5" stroke="none" fill="currentColor">C</text>
    </G>
  ),
  forecast: (
    <G>
      {END(2.6, 11)}
      <path d="M3.8 10.2 12.8 4.2M12.8 4.2H9.4M12.8 4.2v3.2" />
      <path d="M3 13.5h11" strokeDasharray="1.4 1.6" />
    </G>
  ),
  arc: (
    <G>
      {END(2.4, 12.6)}
      {END(13.6, 12.6)}
      <path d="M2.8 11a6.2 6.2 0 0 1 10.4 0" />
    </G>
  ),
  signpost: (
    <G>
      <path d="M8 14.5V7.5" />
      <rect x="2.5" y="2" width="11" height="5.5" rx="1.2" />
    </G>
  ),
  flag: (
    <G>
      <path d="M4 14.5V2" />
      <path d="M4 2.4 12.6 5 4 7.6z" fill="currentColor" />
    </G>
  ),
  stamp: (
    <G>
      <path d="M8 1.8 9.8 5.9 14.2 6.2 10.9 9.1 11.9 13.4 8 11.1 4.1 13.4 5.1 9.1 1.8 6.2 6.2 5.9z" />
    </G>
  ),
} satisfies Partial<Record<DrawingKind, JSX.Element>>;

export const DRAW_FAMILIES: DrawFamily[] = [
  {
    id: 'trend',
    name: 'Trend tools',
    short: 'Trend',
    tools: [
      { tool: 'trend', label: 'Trendline', icon: ICON.trend, sub: 'Lines', keys: 'trend line' },
      { tool: 'ray', label: 'Ray', icon: ICON.ray, sub: 'Lines' },
      { tool: 'extend', label: 'Extended line', icon: ICON.extend, sub: 'Lines', keys: 'extended' },
      { tool: 'hline', label: 'Horizontal line', icon: ICON.hline, sub: 'Lines', keys: 'level support resistance' },
      { tool: 'hray', label: 'Horizontal ray', icon: ICON.hray, sub: 'Lines' },
      { tool: 'vline', label: 'Vertical line', icon: ICON.vline, sub: 'Lines', keys: 'moment time' },
      { tool: 'cross', label: 'Crossline', icon: ICON.cross, sub: 'Lines', keys: 'cross line' },
      { tool: 'infoline', label: 'Info line', icon: ICON.infoline, sub: 'Lines', keys: 'stats measure angle' },
      { tool: 'trendangle', label: 'Trend angle', icon: ICON.trendangle, sub: 'Lines', keys: 'degrees slope' },
      { tool: 'channel', label: 'Parallel channel', icon: ICON.channel, sub: 'Channels' },
      { tool: 'regression', label: 'Regression trend', icon: ICON.regression, sub: 'Channels', keys: 'linear least squares deviation' },
      { tool: 'flattop', label: 'Flat top/bottom', icon: ICON.flattop, sub: 'Channels', keys: 'flat top bottom' },
      { tool: 'disjoint', label: 'Disjoint channel', icon: ICON.disjoint, sub: 'Channels', keys: 'wedge megaphone' },
      { tool: 'pitchfork', label: 'Pitchfork', icon: ICON.pitchfork, sub: 'Pitchforks', keys: 'andrews median line' },
      { tool: 'schiff', label: 'Schiff pitchfork', icon: ICON.schiff, sub: 'Pitchforks', keys: 'andrews median' },
      { tool: 'mschiff', label: 'Modified Schiff pitchfork', icon: ICON.mschiff, sub: 'Pitchforks', keys: 'andrews median' },
    ],
  },
  {
    id: 'fib',
    name: 'Fibonacci and Gann',
    short: 'Fib',
    tools: [
      { tool: 'fib', label: 'Fib retracement', icon: ICON.fib, sub: 'Fibonacci', keys: 'fibonacci' },
      { tool: 'fibext', label: 'Trend-based fib extension', icon: ICON.fibext, sub: 'Fibonacci', keys: 'fibonacci projection' },
      { tool: 'fibchannel', label: 'Fib channel', icon: ICON.fibchannel, sub: 'Fibonacci', keys: 'fibonacci' },
      { tool: 'fibtime', label: 'Fib time zone', icon: ICON.fibtime, sub: 'Fibonacci', keys: 'fibonacci time' },
      { tool: 'fibfan', label: 'Fib speed resistance fan', icon: ICON.fibfan, sub: 'Fibonacci', keys: 'fibonacci fan' },
      { tool: 'fibcircles', label: 'Fib circles', icon: ICON.fibcircles, sub: 'Fibonacci', keys: 'fibonacci' },
      { tool: 'fibspiral', label: 'Fib spiral', icon: ICON.fibspiral, sub: 'Fibonacci', keys: 'fibonacci golden' },
      { tool: 'fibwedge', label: 'Fib wedge', icon: ICON.fibwedge, sub: 'Fibonacci', keys: 'fibonacci' },
      { tool: 'gannbox', label: 'Gann box', icon: ICON.gannbox, sub: 'Gann' },
      { tool: 'gannsquare', label: 'Gann square fixed', icon: ICON.gannsquare, sub: 'Gann' },
      { tool: 'gannfan', label: 'Gann fan', icon: ICON.gannfan, sub: 'Gann', keys: 'angles 1x1' },
    ],
  },
  {
    id: 'patterns',
    name: 'Patterns',
    short: 'Patterns',
    tools: [
      { tool: 'xabcd', label: 'XABCD pattern', icon: ICON.xabcd, sub: 'Chart patterns', keys: 'harmonic gartley bat butterfly crab' },
      { tool: 'abcd', label: 'ABCD pattern', icon: ICON.abcd, sub: 'Chart patterns', keys: 'harmonic' },
      { tool: 'hs', label: 'Head and shoulders', icon: ICON.hs, sub: 'Chart patterns', keys: 'neckline' },
      { tool: 'tripattern', label: 'Triangle pattern', icon: ICON.tripattern, sub: 'Chart patterns', keys: 'wedge converging' },
      { tool: 'threedrives', label: 'Three drives pattern', icon: ICON.threedrives, sub: 'Chart patterns', keys: '3 drives' },
      { tool: 'elliott5', label: 'Elliott impulse wave (12345)', icon: ICON.elliott5, sub: 'Elliott waves', keys: 'elliot motive' },
      { tool: 'elliott3', label: 'Elliott correction wave (ABC)', icon: ICON.elliott3, sub: 'Elliott waves', keys: 'elliot corrective abc' },
    ],
  },
  {
    id: 'measure',
    name: 'Forecasting and measurement',
    short: 'Measure',
    tools: [
      { tool: 'long', label: 'Long position', icon: ICON.long, sub: 'Positions', keys: 'risk reward target stop' },
      { tool: 'short', label: 'Short position', icon: ICON.short, sub: 'Positions', keys: 'risk reward target stop' },
      { tool: 'forecast', label: 'Forecast', icon: ICON.forecast, sub: 'Positions', keys: 'projection target prediction' },
      { tool: 'avwap', label: 'Anchored VWAP', icon: ICON.avwap, sub: 'Volume', keys: 'volume weighted average price' },
      { tool: 'prange', label: 'Price range', icon: ICON.prange, sub: 'Measure' },
      { tool: 'drange', label: 'Date range', icon: ICON.drange, sub: 'Measure', keys: 'time bars' },
      { tool: 'measure', label: 'Date and price range', icon: ICON.measure, sub: 'Measure', keys: 'measure ruler' },
    ],
  },
  {
    id: 'shapes',
    name: 'Geometric shapes',
    short: 'Shapes',
    tools: [
      { tool: 'brush', label: 'Brush', icon: ICON.brush, sub: 'Freehand', keys: 'pen draw' },
      { tool: 'highlighter', label: 'Highlighter', icon: ICON.highlighter, sub: 'Freehand', keys: 'marker' },
      { tool: 'arrow', label: 'Arrow', icon: ICON.arrow, sub: 'Arrows' },
      { tool: 'arrowup', label: 'Arrow mark up', icon: ICON.arrowup, sub: 'Arrows', keys: 'buy' },
      { tool: 'arrowdown', label: 'Arrow mark down', icon: ICON.arrowdown, sub: 'Arrows', keys: 'sell' },
      { tool: 'rect', label: 'Rectangle', icon: ICON.rect, sub: 'Shapes', keys: 'box zone' },
      { tool: 'rotrect', label: 'Rotated rectangle', icon: ICON.rotrect, sub: 'Shapes' },
      { tool: 'circle', label: 'Circle', icon: ICON.circle, sub: 'Shapes' },
      { tool: 'ellipse', label: 'Ellipse', icon: ICON.ellipse, sub: 'Shapes', keys: 'oval' },
      { tool: 'triangle', label: 'Triangle', icon: ICON.triangle, sub: 'Shapes' },
      { tool: 'polyline', label: 'Polyline', icon: ICON.polyline, sub: 'Shapes', keys: 'polygon' },
      { tool: 'path', label: 'Path', icon: ICON.path, sub: 'Shapes' },
      { tool: 'curve', label: 'Curve', icon: ICON.curve, sub: 'Shapes' },
      { tool: 'arc', label: 'Arc', icon: ICON.arc, sub: 'Shapes', keys: 'bow round' },
    ],
  },
  {
    id: 'words',
    name: 'Annotation',
    short: 'Words',
    tools: [
      { tool: 'text', label: 'Text', icon: ICON.text, sub: 'Words' },
      { tool: 'note', label: 'Note', icon: ICON.note, sub: 'Words' },
      { tool: 'callout', label: 'Callout', icon: ICON.callout, sub: 'Words' },
      { tool: 'pricelabel', label: 'Price label', icon: ICON.pricelabel, sub: 'Words', keys: 'tag' },
      { tool: 'signpost', label: 'Signpost', icon: ICON.signpost, sub: 'Words', keys: 'sign post event' },
      { tool: 'flag', label: 'Flag mark', icon: ICON.flag, sub: 'Marks', keys: 'flag' },
    ],
  },
  {
    id: 'icons',
    name: 'Icons',
    short: 'Icons',
    tools: [{ tool: 'stamp', label: 'Emoji stamp', icon: ICON.stamp, sub: 'Stamps', keys: 'emoji icon sticker' }],
  },
];

const ALL_DRAW_TOOLS: DrawToolDef[] = DRAW_FAMILIES.flatMap(f => f.tools);
const BY_KIND = new Map<DrawingKind, DrawToolDef>(ALL_DRAW_TOOLS.map(t => [t.tool, t]));
const FAMILY_OF = new Map<DrawingKind, DrawFamilyId>(DRAW_FAMILIES.flatMap(f => f.tools.map(t => [t.tool, f.id] as const)));

export const drawToolDef = (kind: DrawingKind): DrawToolDef | undefined => BY_KIND.get(kind);
export const drawToolLabel = (kind: DrawingKind): string => BY_KIND.get(kind)?.label ?? kind;
/** The key a tool answers to, as the lists print it */
export const DRAW_HOTKEY: Partial<Record<DrawingKind, string>> = { trend: 'Alt+T', hline: 'Alt+H', vline: 'Alt+V', cross: 'Alt+C', fib: 'Alt+F', rect: 'Alt+Shift+R', infoline: 'Alt+I' };

/** What the search box answers to: the name, the family, and the older and looser words */
export function searchDrawTools(query: string): DrawToolDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return ALL_DRAW_TOOLS;
  return ALL_DRAW_TOOLS.filter(t => {
    const hay = `${t.label} ${t.keys ?? ''} ${t.sub} ${DRAW_FAMILIES.find(f => f.id === FAMILY_OF.get(t.tool))?.name ?? ''}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

// ---- what the reader keeps ----------------------------------------------------------

export type MagnetMode = 'off' | 'weak' | 'strong';

interface DrawToolPrefs {
  last: Partial<Record<DrawFamilyId, DrawingKind>>;
  favs: DrawingKind[];
  /** TradingView's magnet: points take the nearest open, high, low or close — always (strong) or when near (weak) */
  magnet: MagnetMode;
  /** Stay in drawing mode: a placed mark leaves the tool in hand */
  stay: boolean;
  /** Hide every drawing (kept, not drawn) */
  hideAll: boolean;
  /** The favourites bar floats over the chart */
  favBar: boolean;
  /** The stamp the Icons list has in hand (drawStamp.ts holds it; here so the list re-renders) */
  stamp: string;
}

const KEY = 'slayer_draw_tools_v1';
const read = (): DrawToolPrefs => {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DrawToolPrefs>;
    const last: DrawToolPrefs['last'] = {};
    if (c.last && typeof c.last === 'object')
      for (const f of DRAW_FAMILIES) {
        const k = (c.last as Record<string, unknown>)[f.id];
        /* a stored tool must still exist, and still be in that family */
        if (typeof k === 'string' && FAMILY_OF.get(k as DrawingKind) === f.id) last[f.id] = k as DrawingKind;
      }
    const favs = Array.isArray(c.favs) ? c.favs.filter((k): k is DrawingKind => typeof k === 'string' && BY_KIND.has(k as DrawingKind)) : [];
    const magnet: MagnetMode = c.magnet === 'weak' || c.magnet === 'strong' ? c.magnet : 'off';
    return { last, favs: [...new Set(favs)], magnet, stay: c.stay === true, hideAll: c.hideAll === true, favBar: c.favBar === true, stamp: getStamp() };
  } catch {
    return { last: {}, favs: [], magnet: 'off', stay: false, hideAll: false, favBar: false, stamp: getStamp() };
  }
};

let prefs: DrawToolPrefs = read();
const listeners = new Set<() => void>();
const write = (next: DrawToolPrefs) => {
  prefs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage off — the choice lives for the session */
  }
  listeners.forEach(fn => fn());
};
subscribeStamp(() => write({ ...prefs, stamp: getStamp() }));
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => prefs;

export const useDrawToolPrefs = (): DrawToolPrefs => useSyncExternalStore(subscribe, snapshot, snapshot);

/** A tool was taken in hand: its family's button wears it from now on */
export function rememberDrawTool(kind: DrawingKind): void {
  const fam = FAMILY_OF.get(kind);
  if (!fam || prefs.last[fam] === kind) return;
  write({ ...prefs, last: { ...prefs.last, [fam]: kind } });
}

export function toggleDrawFavourite(kind: DrawingKind): void {
  write({ ...prefs, favs: prefs.favs.includes(kind) ? prefs.favs.filter(k => k !== kind) : [...prefs.favs, kind] });
}

/** The rail's switches: magnet, stay in drawing mode, hide all, the favourites bar */
export function setDrawPref(patch: Partial<Pick<DrawToolPrefs, 'magnet' | 'stay' | 'hideAll' | 'favBar'>>): void {
  write({ ...prefs, ...patch });
}
export const drawPrefs = (): DrawToolPrefs => prefs;

/** The tool a family's button wears: the last one used from it, else its first */
export const familyFace = (f: DrawFamily, p: DrawToolPrefs): DrawToolDef => f.tools.find(t => t.tool === p.last[f.id]) ?? f.tools[0];

// ---- arming a tool from outside a chart (the command palette) -------------------------

/* A chart that can draw registers itself; the one the pointer was last over answers. With one chart on the page it is that one. */
type Arm = (kind: DrawingKind) => void;
const charts = new Map<symbol, Arm>();
let lastTouched: symbol | null = null;
/* TradingView's drawing keys, on the chart the pointer was last over: Alt+T trend line, Alt+H horizontal line, Alt+V
   vertical line, Alt+C cross line, Alt+F fib retracement, Alt+Shift+R rectangle, Alt+I info line; Ctrl+Alt+H hides or
   shows every drawing. Read off e.code, because Alt on a Mac turns e.key into other letters. */
const HOTKEYS: Record<string, DrawingKind> = { KeyT: 'trend', KeyH: 'hline', KeyV: 'vline', KeyC: 'cross', KeyF: 'fib', KeyI: 'infoline' };
let hotkeys = false;
const onHotkey = (e: KeyboardEvent) => {
  if (!e.altKey || e.metaKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.ctrlKey && e.code === 'KeyH') {
    e.preventDefault();
    write({ ...prefs, hideAll: !prefs.hideAll });
    return;
  }
  if (e.ctrlKey) return;
  const kind = e.shiftKey ? (e.code === 'KeyR' ? 'rect' : undefined) : HOTKEYS[e.code];
  if (!kind) return;
  if (armDrawTool(kind)) e.preventDefault();
};
export function registerDrawChart(id: symbol, arm: Arm): () => void {
  if (!hotkeys && typeof window !== 'undefined') {
    hotkeys = true;
    window.addEventListener('keydown', onHotkey);
  }
  charts.set(id, arm);
  return () => {
    charts.delete(id);
    if (lastTouched === id) lastTouched = null;
  };
}
export const touchDrawChart = (id: symbol): void => {
  lastTouched = id;
};
export const canArmDrawTool = (): boolean => charts.size > 0;
export function armDrawTool(kind: DrawingKind): boolean {
  const arm = (lastTouched && charts.get(lastTouched)) || [...charts.values()][0];
  if (!arm) return false;
  arm(kind);
  return true;
}
