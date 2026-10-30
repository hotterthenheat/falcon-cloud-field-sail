/* The impact square before every headline and print: red high, orange medium (the thermal ramp's warm side, not the
   direction red), grey low; and its legend. */

type ImpactTier = 'high' | 'medium' | 'low';
const IMPACT_TIERS: ImpactTier[] = ['high', 'medium', 'low'];
/* the warm side of the house thermal ramp for high and medium, the muted ink for low — never the direction red */
export const IMPACT_INK: Record<ImpactTier, string> = { high: '#D73027', medium: '#FDAE61', low: 'rgb(var(--text-muted))' };
const IMPACT_WORD: Record<ImpactTier, string> = {
  high: 'High impact — moves the market on its own',
  medium: 'Medium impact — moves a name, a sector or a currency',
  low: 'Low impact — noted, rarely moves anything',
};
/** A story's tier, on the same cuts as its word (heavy · firm · light — newsroom.ts severityWord):
    on a typical wire the earnings prints land high, CPI / a deal / a probe medium, analyst notes and launches low */
export const tierOf = (severity: number): ImpactTier => (severity >= 7 ? 'high' : severity >= 4 ? 'medium' : 'low');

export const ImpactMark = ({ tier }: { tier: ImpactTier }) => (
  <span className="inline-block w-2 h-2 rounded-[2px] shrink-0" style={{ background: IMPACT_INK[tier] }} title={IMPACT_WORD[tier]} aria-label={IMPACT_WORD[tier]} data-impact-mark={tier} />
);

/** The legend, one thin line: ■ high ■ medium ■ low impact */
export const ImpactLegend = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center gap-3 normal-case tracking-normal text-t10 text-textSecondary ${className}`} data-impact-legend>
    {IMPACT_TIERS.map(t => (
      <span key={t} className="inline-flex items-center gap-1.5" title={IMPACT_WORD[t]}>
        <ImpactMark tier={t} />
        {t}
      </span>
    ))}
    <span className="text-textMuted">impact</span>
  </span>
);

/* A row's flag says what the feed knows: the vendor's MAJOR flag and whether the story names a stock on your Board. */
export const NEWS_FLAG_TIP = 'MAJOR: flagged major by the vendor and about a listed company or the economy. BOARD: it names a stock on your Board.';

export const NewsFlag = ({ major, onBoard, className = '' }: { major?: boolean; onBoard?: boolean; className?: string }) => {
  if (!major && !onBoard) return <span className={`text-textMuted ${className}`}>—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-t9 font-semibold uppercase tracking-widest ${className}`} title={NEWS_FLAG_TIP} data-news-flag={major ? 'major' : 'board'}>
      {major && <span className="text-warn">major</span>}
      {onBoard && <span className="text-silver">board</span>}
    </span>
  );
};
