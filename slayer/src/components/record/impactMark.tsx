/*
==================================================
  SLAYER TERMINAL - THE IMPACT MARK
  (components/record/impactMark.tsx)

  The small square that says how hard a story or
  a print lands — high, medium, low — and its
  legend (Noah, 2026-09-09, on Forex Factory's
  legend beside its headlines: "it allows the user
  to decipher meaning instantly"): one small square
  before every headline and every print, in the
  rungs every trader already knows — red high,
  orange medium (Noah: "medium is orange and high
  is red"), and grey for low ("low should stay
  gray"). The red and the orange are the warm side
  of the house thermal ramp (heatmap.ts
  thermal-yellow at 0.8 / 0.4), so the red is the
  ramp's deeper red, not the direction red that
  says "negative"; the grey is the muted ink.
  Lived in the wire's page; lifted out on
  2026-09-13 so the All news box and the month
  calendar draw the same square.
==================================================
*/

export type ImpactTier = 'high' | 'medium' | 'low';
export const IMPACT_TIERS: ImpactTier[] = ['high', 'medium', 'low'];
/* the warm side of the house thermal ramp for high and medium, the muted ink for low — never the direction red */
export const IMPACT_INK: Record<ImpactTier, string> = { high: '#D73027', medium: '#FDAE61', low: 'rgb(var(--text-muted))' };
export const IMPACT_WORD: Record<ImpactTier, string> = {
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

/* THE FLAG (the retail pass, 2026-10-22). Unusual Whales sends every headline with sentiment "neutral" — 200 of 200 on
   the day this was written — so a sentiment word on every row said nothing. A row now says what the feed really knows:
   the vendor's MAJOR flag, and whether it names a stock on your Board. A real positive / negative from the feed would
   still show (the `lean` argument), never an invented one. */
export const NEWS_FLAG_TIP = 'MAJOR: Unusual Whales flags the headline as major, and it is about a named listed company or the economy — not a call date or a routine dividend. BOARD: it names a stock on your Board. The feed sends no positive or negative read, so none is shown.';

export const NewsFlag = ({ major, onBoard, lean, className = '' }: { major?: boolean; onBoard?: boolean; lean?: 'positive' | 'negative' | null; className?: string }) => {
  if (!major && !onBoard && !lean) return <span className={`text-textMuted ${className}`}>—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-t9 font-semibold uppercase tracking-widest ${className}`} title={NEWS_FLAG_TIP} data-news-flag={major ? 'major' : onBoard ? 'board' : lean ?? ''}>
      {lean && <span className={lean === 'positive' ? 'text-bull' : 'text-bear'}>{lean}</span>}
      {major && <span className="text-warn">major</span>}
      {onBoard && <span className="text-silver">board</span>}
    </span>
  );
};
