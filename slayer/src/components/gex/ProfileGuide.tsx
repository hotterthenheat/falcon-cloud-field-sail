/* The card behind the profile panel's "How to read": the ladder is today's call volume against put volume. */

import { splinePath } from './StrikePressureLadder';

const INK = 'rgb(var(--text-primary))';
const INK_2 = 'rgb(var(--text-secondary))';
const SILVER = 'rgb(var(--silver))';
const GRID = 'rgba(255,255,255,0.07)';
/* The thermal ramp's stops, as the calendar and the panel paint them */
const COOL_1 = '#A6D96A';
const COOL_2 = '#66BD63';
const COOL_3 = '#1A9850';
const WARM_1 = '#FDAE61';
const WARM_2 = '#F46D43';
const WARM_3 = '#D73027';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SANS = '"Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const Label = ({ x, y, children, anchor = 'start', fill = INK_2, size = 9.5 }: { x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end'; fill?: string; size?: number }) => (
  <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontFamily={SANS} fontSize={size} fill={fill}>
    {children}
  </text>
);

const Strike = ({ y, children, fill = INK_2 }: { y: number; children: string; fill?: string }) => (
  <text x={38} y={y + 0.5} textAnchor="end" dominantBaseline="middle" fontFamily={MONO} fontSize="9" fill={fill}>
    {children}
  </text>
);

/* The thermal ramp's journey from the centre's pale yellow out to a pole — the
   legs' own surface, at the strength each leg earns */
const YELLOW = '#FFFFBF';
const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
};
const rampAt = (stops: string[], t: number) => {
  const tt = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(tt));
  return mix(stops[i], stops[i + 1], tt - i);
};
const WARM_RAMP = [YELLOW, WARM_1, WARM_2, WARM_3];
const COOL_RAMP = [YELLOW, COOL_1, COOL_2, COOL_3];

/** FIGURE 1 — SIZE: the ladder; puts grow left, calls grow right, the spine leans to the side that wins */
const SizeFigure = () => {
  const MID = 200;
  const REACH = 112;
  const LEAN = 58;
  const rows = [
    { y: 20, k: '497', put: 18, call: 94 },
    { y: 42, k: '496', put: 40, call: 150 },
    { y: 64, k: '495', put: 22, call: 256 },
    { y: 86, k: '494', put: 131, call: 35 },
    { y: 108, k: '493', put: 210, call: 12 },
  ];
  const legMax = 256;
  const netMax = Math.max(...rows.map(r => Math.abs(r.put - r.call)));
  const spineX = (r: { put: number; call: number }) => MID - ((r.put - r.call) / netMax) * LEAN;
  const spine = splinePath(rows.map(r => ({ x: spineX(r), y: r.y })), MID - LEAN - 4, MID + LEAN + 4);
  const H = 6;
  return (
    <svg viewBox="0 0 368 166" width="100%" role="img" aria-label="Five strikes on the ladder: puts grow left, calls grow right, and the line leans toward the side with more contracts" data-guide-figure="size">
      <defs>
        {rows.map(r => {
          const ps = r.put / legMax;
          const cs = r.call / legMax;
          return (
            <g key={r.k}>
              <linearGradient id={`g-put-${r.k}`} x1="1" x2="0" y1="0" y2="0">
                <stop offset="0" stopColor={YELLOW} />
                <stop offset="0.33" stopColor={rampAt(WARM_RAMP, ps / 3)} />
                <stop offset="0.66" stopColor={rampAt(WARM_RAMP, (2 * ps) / 3)} />
                <stop offset="1" stopColor={rampAt(WARM_RAMP, ps)} />
              </linearGradient>
              <linearGradient id={`g-call-${r.k}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor={YELLOW} />
                <stop offset="0.33" stopColor={rampAt(COOL_RAMP, cs / 3)} />
                <stop offset="0.66" stopColor={rampAt(COOL_RAMP, (2 * cs) / 3)} />
                <stop offset="1" stopColor={rampAt(COOL_RAMP, cs)} />
              </linearGradient>
            </g>
          );
        })}
      </defs>
      {rows.map(r => (
        <line key={r.k} x1={44} x2={362} y1={r.y + 0.5} y2={r.y + 0.5} stroke={GRID} />
      ))}
      {/* the centre line */}
      <line x1={MID + 0.5} x2={MID + 0.5} y1={8} y2={120} stroke="rgba(255,255,255,0.10)" />
      {rows.map(r => {
        const pl = (r.put / legMax) * REACH;
        const cl = (r.call / legMax) * REACH;
        return (
          <g key={r.k}>
            <Strike y={r.y}>
              {r.k}
            </Strike>
            <rect x={MID - pl} y={r.y - H / 2} width={pl} height={H} rx={2} fill={`url(#g-put-${r.k})`} />
            <rect x={MID} y={r.y - H / 2} width={cl} height={H} rx={2} fill={`url(#g-call-${r.k})`} />
            <text x={MID - pl - 4} y={r.y + 0.5} textAnchor="end" dominantBaseline="middle" fontFamily={MONO} fontSize="9" fill={INK}>
              {r.put}k
            </text>
            <text x={MID + cl + 4} y={r.y + 0.5} textAnchor="start" dominantBaseline="middle" fontFamily={MONO} fontSize="9" fill={INK}>
              {r.call}k
            </text>
          </g>
        );
      })}
      {/* the line leans to the side with more contracts */}
      <path d={spine} fill="none" stroke="rgba(237,237,237,0.85)" strokeWidth={1.5} />
      {/* What the drawing says, in three lines */}
      <circle cx={50} cy={128} r={4} fill={SILVER} />
      <Label x={59} y={128}>put volume grows left, call volume grows right</Label>
      <line x1={45} x2={55} y1={143.5} y2={143.5} stroke="rgba(237,237,237,0.85)" strokeWidth={1.5} />
      <Label x={59} y={143}>the line leans to the side with more contracts</Label>
    </svg>
  );
};

const ProfileGuide = () => (
  <div className="px-3 py-3 flex flex-col gap-3" data-profile-guide-card>
    <div>
      <p className="text-t12 font-semibold text-textPrimary">Call volume · put volume</p>
      <p className="mt-0.5 text-t115 leading-relaxed text-textSecondary">
        Each row is one strike. Put volume grows left from the centre line and call volume grows right. The figures are contracts traded today. A longer leg is more contracts. The line through the rows leans to the side with more. Gamma stays on the calendar.
      </p>
      <div className="mt-2 rounded-md border border-borderSubtle/60 bg-panel px-2 py-2">
        <SizeFigure />
      </div>
    </div>
    <p className="text-t10 text-textMuted">Hover a strike to read both volumes · click to keep it.</p>
  </div>
);

export default ProfileGuide;
