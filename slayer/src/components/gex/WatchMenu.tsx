/* Pinpoint's structural alerts: one bell with the armed count, and a switch for each thing a dealer map can change
   (a wall or supreme reached, the flip crossed, sides changing, the supreme or a wall moving). It only sets; fired alerts live in the drawer. Store: alertStore.ts. */

import { Switch } from '../shadcn/switch';
import PopoverCard from '../ui/PopoverCard';
import JingleBell from '../ui/JingleBell';
import {
  armCharmPin,
  armGexFlip,
  armLevel,
  armNewSupreme,
  armOiJump,
  armWallMove,
  MAX_ALERTS,
  removeAlert,
  useAlerts,
  type Alert,
} from './alertStore';
import type { ExposureLevels } from '../../types/gex';
import { callWallWords, putWallWords } from '../../core/walls';
import { flipSidesWords } from '../../data/flipLevel';
import { fmtStrike } from '../../core/format';

/* Armed wears holo silver (the label, count and switches); the bell itself wears the alert orange. */
const SILVER = 'rgb(var(--silver))';
const SILVER_FILL = 'rgb(var(--silver-fill))'; /* the silver as a SURFACE — a filled pill with the dark word on it, the holo flat form on either ground */

interface Watch {
  key: string;
  words: (levels: ExposureLevels | null) => string;
  /* Placement-aware: each level is described from where it sits against price (core/walls.ts). */
  hint: (levels: ExposureLevels | null, spot: number | undefined) => string;
  arm: (ticker: string) => Alert | null;
  is: (a: Alert) => boolean;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const spotOf = (L: ExposureLevels | null, spot: number | undefined) => (spot && spot > 0 ? spot : L?.spot && L.spot > 0 ? L.spot : null);

const WATCHES: Watch[] = [
  {
    key: 'callWall',
    words: L => `Price reaches the call wall${L ? ` ${fmtStrike(L.callWall)}` : ''}`,
    hint: (L, spot) => {
      const s = spotOf(L, spot);
      return L && s ? `The strike with ${callWallWords(L.callWall, s)}` : 'The strike with the most call gamma, either side of price';
    },
    arm: t => armLevel(t, 'callWall'),
    is: a => a.kind === 'level' && a.level === 'callWall',
  },
  {
    key: 'putWall',
    words: L => `Price reaches the put wall${L ? ` ${fmtStrike(L.putWall)}` : ''}`,
    hint: (L, spot) => {
      const s = spotOf(L, spot);
      return L && s ? `The strike with ${putWallWords(L.putWall, s)}` : 'The strike with the most put gamma, either side of price';
    },
    arm: t => armLevel(t, 'putWall'),
    is: a => a.kind === 'level' && a.level === 'putWall',
  },
  {
    key: 'flip',
    words: L => (L && L.flipFound === false ? 'Price crosses the gamma flip (none within ±10% now)' : `Price crosses the gamma flip${L ? ` ${fmtStrike(L.flip)}` : ''}`),
    hint: (L, spot) => {
      const s = spotOf(L, spot);
      return L && s && L.flipFound !== false && L.net != null ? cap(flipSidesWords(L.flip, s, L.net)) : 'Where dealer hedging switches between absorbing moves and amplifying them';
    },
    arm: t => armLevel(t, 'flip'),
    is: a => a.kind === 'level' && a.level === 'flip',
  },
  { key: 'supreme', words: L => `Price reaches the supreme${L ? ` ${fmtStrike(L.supreme)}` : ''}`, hint: (L, spot) => { const s = spotOf(L, spot); return L && s ? `The strike holding the most dealer gamma of all, ${L.supreme > s ? 'above' : L.supreme < s ? 'below' : 'at'} price` : 'The strike holding the most dealer gamma of all'; }, arm: t => armLevel(t, 'supreme'), is: a => a.kind === 'level' && a.level === 'supreme' },
  { key: 'gexflip', words: () => 'Dealers change sides', hint: () => 'Dealer hedging on this name flips from amplifying moves to absorbing them, or back', arm: t => armGexFlip(t), is: a => a.kind === 'gexflip' },
  { key: 'newsupreme', words: () => 'The supreme moves to another strike', hint: () => 'The strike holding the most dealer gamma changes', arm: t => armNewSupreme(t), is: a => a.kind === 'newsupreme' },
  { key: 'wallmove', words: () => 'A wall moves 2 strikes or more', hint: () => 'The call wall or the put wall is re-drawn 2 strikes or more from where it stood', arm: t => armWallMove(t, 2), is: a => a.kind === 'wallmove' },
  { key: 'charmPin', words: () => 'Charm holds into the close', hint: () => 'After 15:00 New York, the charm sign holds for five minutes and price sits inside half a percent of the supreme', arm: t => armCharmPin(t), is: a => a.kind === 'charmPin' },
  { key: 'oiJump', words: () => 'Open interest doubles', hint: () => 'A strike’s open interest at least doubles against the previous read of the chain', arm: t => armOiJump(t), is: a => a.kind === 'oiJump' },
];

/* The plain voice (`waitingWords` / `firedWords`) lives in alertStore.ts, shared with the drawer. */

const WatchMenu = ({ ticker, spot, levels }: { ticker: string; spot?: number; levels: ExposureLevels | null }) => {
  const alerts = useAlerts(ticker);
  const armed = alerts.filter(a => !a.firedAt);
  const full = armed.length >= MAX_ALERTS;

  const set = (w: Watch, on: boolean) => {
    const hit = alerts.find(w.is);
    if (!on && hit) removeAlert(ticker, hit.id);
    else if (on && !hit) w.arm(ticker);
  };

  const trigger = (
    <button
      type="button"
      data-alerts-menu
      aria-label={`Alerts — ${armed.length} set`}
      className="relative inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none"
    >
      {/* The bell jingles and wears the alert orange while set; the label and count keep their silver. */}
      <JingleBell count={armed.length} className="w-3 h-3" />
      <span className="text-t11 font-semibold" style={{ color: armed.length ? SILVER : undefined }}>
        Alerts
      </span>
      {armed.length > 0 && (
        <span className="px-1 rounded-sm text-t9 font-bold tnum" style={{ background: SILVER_FILL, color: '#0a0a0a' }} data-armed-count>
          {armed.length}
        </span>
      )}
    </button>
  );

  return (
    <PopoverCard trigger={trigger} title="Tell me when" meta={`${ticker} · ${armed.length} of ${MAX_ALERTS} set`} width={400} testId="alerts">
      <ul className="py-1" data-watch-list>
        {WATCHES.map(w => {
          const hit = alerts.find(w.is);
          const on = !!hit && !hit.firedAt;
          const blocked = !on && full;
          const id = `watch-${w.key}`;
          return (
            <li key={w.key} className="flex items-center gap-3 px-3 py-2 border-b border-borderSubtle/40 last:border-b-0" data-watch={w.key}>
              <label htmlFor={id} className="flex-1 min-w-0 flex flex-col gap-[1px] cursor-pointer">
                <span className={`font-mono text-t11 leading-snug ${on ? 'font-semibold text-silver' : 'text-textPrimary'}`}>{w.words(levels)}</span>
                <span className="font-mono text-t9 leading-snug text-textMuted">{blocked ? `${MAX_ALERTS} is the most for one name — turn one off first` : w.hint(levels, spot)}</span>
              </label>
              <Switch id={id} checked={on} disabled={blocked} onCheckedChange={v => set(w, v)} aria-label={w.words(levels)} />
            </li>
          );
        })}
      </ul>
    </PopoverCard>
  );
};

export default WatchMenu;
