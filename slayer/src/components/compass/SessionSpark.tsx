interface SessionSparkProps {
  ticker: string;
  width?: number;
  height?: number;
  /** The sweep's spark. Used when this name has no tape yet — the card must not go seed one. */
  points?: number[];
}

/* The card draws the spark it was handed. It does not seed a tape. */
const SessionSpark = ({ width = 96, height = 26, points }: SessionSparkProps) => {
  const series = points && points.length >= 2 ? points : null;
  if (!series || series.length < 2) return <span style={{ width, height }} className="shrink-0" aria-hidden data-spark="empty" />;

  const step = Math.max(1, Math.floor(series.length / 40));
  const pts = series.filter((_, i) => i % step === 0);
  if (pts[pts.length - 1] !== series[series.length - 1]) pts.push(series[series.length - 1]);
  if (pts.length < 2) return <span style={{ width, height }} className="shrink-0" aria-hidden data-spark="empty" />;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const base = pts[0];
  const x = (i: number) => (i / (pts.length - 1)) * width;
  const y = (v: number) => height - 1 - ((v - min) / range) * (height - 2);
  const up = pts[pts.length - 1] >= base;
  const ink = up ? 'rgb(var(--bull))' : 'rgb(var(--bear))';
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden data-spark="sweep" role="img">
      <title>This contract's premium. Not the stock.</title>
      <line x1={0} x2={width} y1={y(base)} y2={y(base)} stroke="rgba(237,237,237,0.18)" strokeWidth={1} strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={ink} strokeOpacity={0.9} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

export default SessionSpark;