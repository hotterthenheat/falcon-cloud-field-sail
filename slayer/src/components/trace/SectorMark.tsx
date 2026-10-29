/* A sector told by a monochrome glyph, not a hue (hue is kept for direction, status and the champion); the name
   rides beside it. */

import {
  Building2,
  Cpu,
  Factory,
  FlaskConical,
  Fuel,
  HeartPulse,
  Landmark,
  RadioTower,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** The eleven sectors the terminal files (data/darkpool SECTOR_UNIVERSE). */
const GLYPH: Record<string, LucideIcon> = {
  'Financial Services': Landmark,
  Technology: Cpu,
  Healthcare: HeartPulse,
  'Consumer Cyclical': ShoppingBag,
  Industrials: Factory,
  'Communication Services': RadioTower,
  'Consumer Defensive': ShoppingCart,
  Utilities: Zap,
  'Real Estate': Building2,
  Energy: Fuel,
  'Basic Materials': FlaskConical,
  /* The equity universe's own names for the same sectors */
  Financials: Landmark,
  'Health Care': HeartPulse,
  'Consumer Discretionary': ShoppingBag,
  Communication: RadioTower,
  'Consumer Staples': ShoppingCart,
  Materials: FlaskConical,
};

const sectorGlyph = (sector: string): LucideIcon => GLYPH[sector] ?? Tag;

/** The glyph alone — for a menu row or a tight cell. */
export const SectorMark = ({ sector, className = '' }: { sector: string; className?: string }) => {
  const Icon = sectorGlyph(sector);
  return <Icon aria-hidden className={`w-3 h-3 shrink-0 text-textMuted ${className}`} />;
};

/** Glyph + name, the table cell — "—" when a name is not filed. */
export const SectorName = ({ sector }: { sector: string | null }) =>
  sector ? (
    <span className="inline-flex items-center gap-1.5 text-t11 text-textSecondary">
      <SectorMark sector={sector} />
      {sector}
    </span>
  ) : (
    <span className="text-textSecondary">—</span>
  );

