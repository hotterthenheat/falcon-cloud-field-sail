/* A name's read beside Compare's ruler: the book (net, sentence, levels), the six heaviest strikes and their change, the
   strike's legs and greeks, today's contracts, to the close — one panel each side, folding to a tab (remembered in
   slayer_compare_sides), stacked as cards on a phone. A quiet fact sheet: colour only on level tags and change glyphs. */

import { bellDay, longDay, recordDay, todayScopeLabel } from '../../data/bookWindow';
import { GLOSSARY, kindTip } from './glossary';
import { bellNone, BELL_NONE_TITLE } from '../../data/flipLevel';
import { bookDatesIn } from '../../data/uwBook';
import { holdLabel } from '../../data/wall';
import { LEAN_MIN, strikeTag, thinWords } from '../../data/agenda';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildExposureProfile } from '../../data/exposure';
import { GREEKS, GREEK_UNIT } from '../../data/exposureSurface';
import { distanceIn, fmtShared, sharedUnit, GREEK_EXPLAIN, GREEK_LABEL, WINDOW, type Compare, type CompareSide, type Greek } from '../../data/compare';
import type { DistanceUnit } from '../../data/atr';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { netGexTitle } from '../../data/board';
import { shownGreek } from './retailSign';
import { replayRange, snapshotAt } from '../../data/replay';
import type { ExposureProfileData, StrikeExposure } from '../../types/gex';
import { Change, READ_WINDOWS } from './ChangeMark';
import { toneBadge, type Tone } from '../ui/tones';
import Fact from '../ui/Fact';
import { levelRoles, wallPlace, type LevelRole } from '../../core/walls';
import { fmtStrike, pctWhole as pct } from '../../core/format';

const ROLE_TONE: Record<LevelRole, Tone> = { supreme: 'supreme', 'call wall': 'bull', 'put wall': 'bear', flip: 'white' };

/** The panel's width open, and its tab's width folded */
const SIDE_W = 320;
const SIDE_TAB_W = 28;

/** Each level in one plain line — its hover */
const SIDE_TIPS: Record<string, string> = {
  'put wall': GLOSSARY.putWall,
  'call wall': GLOSSARY.callWall,
  flip: "Flip: the price where the book's net gamma, re-priced at that price, crosses zero — where dealer hedging switches between absorbing and amplifying moves. \"none nearby\": no crossing within 10%",
  supreme: 'Supreme: the single strike with the most dealer hedging on it',
};

const SILVER = 'rgb(var(--silver))';

type Side = 'a' | 'b';

interface Props {
  side: Side;
  s: CompareSide;
  cmp: Compare;
  unit: DistanceUnit;
  greek: Greek;
  /** Every greek on the ruler. Each one has its own supreme; one row per greek when there is more than one. */
  greeks?: Greek[];
  /** The name's chip — the first follows the frame, the second holds its own */
  chip: ReactNode;
  /** The shared focus when it is this name's */
  focus: number | null;
  onPick: (strike: number, ticker: string) => void;
  open: boolean;
  onToggle: () => void;
  /** On a phone: a card under the ruler, no tab */
  stacked?: boolean;
  /** The ruler on the whole screen: the panel wears the page's ground with it */
  full?: boolean;
}

const Cap = ({ children, aside, tip }: { children: ReactNode; aside?: ReactNode; tip?: string }) => (
  <div className="flex items-end justify-between gap-2 pt-3 pb-1 border-b border-borderSubtle/60">
    <span className="min-w-0 font-mono text-t10 uppercase tracking-[0.14em] text-textMuted whitespace-nowrap truncate" title={tip}>{children}</span>
    {aside}
  </div>
);

/** A name's tag — a level's family at chip scale (the house's tone badge), the net's word in silver */
const Tag = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={`inline-flex w-fit shrink-0 items-center rounded px-1 h-[14px] border font-mono text-t8 font-semibold uppercase tracking-widest whitespace-nowrap ${toneBadge[tone]}`}>
    {children}
  </span>
);

/** The levels' table: tag · strike · distance · dollars, a hairline under each row */
const LEVEL_COLS = 'grid grid-cols-[72px_minmax(0,1fr)_48px_104px] items-center gap-x-1.5 h-6 border-b border-borderSubtle/40 last:border-b-0';
/** The heaviest's table: rank · strike (+ its role) · dollars · what it did over the window */
const HEAVY_COLS = 'grid grid-cols-[14px_minmax(0,1fr)_68px_60px] items-center gap-x-1.5 h-6 border-b border-borderSubtle/40 last:border-b-0';

const CompareSidePanel = ({ side, s, cmp, unit, greek, greeks, chip, focus, onPick, open, onToggle, stacked = false, full = false }: Props) => {
  const U = sharedUnit(unit);
  const L = GREEK_LABEL[greek];
  const rec = recordDay();
  const scopeWords = s.expiry === 'ALL' ? 'All expiries' : s.expiry === '0DTE' ? (todayScopeLabel() === 'Today' ? "Today's contracts" : "Next session's contracts") : s.expiry;
  const [win, setWin] = useState('15m');
  const winIdx = Math.max(0, READ_WINDOWS.findIndex(w => w.key === win));

  /* TODAY'S CONTRACTS OVER EACH WINDOW — the minute grid, seven books back (the read card's own) */
  const hist = useMemo<(ExposureProfileData | null)[] | null>(() => {
    const range = replayRange(s.ticker);
    if (!range) return null;
    return READ_WINDOWS.map(w => {
      const back = w.min === Infinity ? range.length : w.min * 60;
      if (back > range.length && w.min !== Infinity) return null;
      return buildExposureProfile(snapshotAt(s.snapshot, range, Math.max(0, range.length - back)), s.expiry, WINDOW);
    });
  }, [s]);
  const thenAt = (i: number, strike: number): number | null => hist?.[i]?.strikes.find(r => r.strike === strike)?.[greek].net ?? null;

  const dist = (price: number) => {
    const d = distanceIn(price - s.spot, s.spot, U, s.scales);
    return d == null ? '—' : fmtShared(d, U);
  };
  /* net GEX in the retail sign: positive = dealers long gamma = absorbs; the other greeks keep the ladder's own sign */
  const shownThen = (v: number | null): number | null => (v == null ? null : shownGreek(greek, v));
  const net = greek === 'gex' ? s.netGex : s.rows[greek].reduce((acc, r) => acc + r.value, 0);
  const flipAt = s.flip;
  /* THE REGIME IS THE NET'S SIGN (data/flipLevel.ts) — "ABSORBS" beside a red −$1.3B read the side of the flip */
  const regimeWord = flipAt != null && flipAt > 0 && Math.abs(s.spot - flipAt) / flipAt <= 0.0005 ? 'either way' : s.netGex >= 0 ? 'absorbs' : 'amplifies';
  const rowOf = (strike: number): StrikeExposure | undefined => s.strikes.find(r => r.strike === strike);
  /* a level outside the drawn window still has its value, read off the side's whole chain */
  const NODE_KEY = { gex: 'netGex', dex: 'netDex', vex: 'netVex', vanna: 'netVanna', charm: 'netCharm' } as const;
  const sideChain = (s.snapshot.liveBook && s.snapshot.uwChains?.[s.expiry]?.length ? s.snapshot.uwChains[s.expiry] : s.snapshot.chain) ?? [];
  /* the leg that defines the level: a wall prints its own leg, named; the supreme and the flip print the net */
  const LEG_KEY: Record<'call' | 'put', Record<'gex', 'callGex' | 'putGex'>> = { call: { gex: 'callGex' }, put: { gex: 'putGex' } };
  const valueAt = (strike: number | null, g: Greek = greek, leg: 'net' | 'call' | 'put' = 'net'): number | null => {
    if (strike == null) return null;
    const r = rowOf(strike);
    if (r) return r[g][leg];
    const n = sideChain.find(x => Math.abs(x.strike - strike) < 1e-9);
    if (!n) return null;
    if (leg !== 'net' && g === 'gex') return n[LEG_KEY[leg].gex] ?? null;
    if (g !== 'gex' && g !== 'dex' && g !== 'vex' && g !== 'vanna' && g !== 'charm') return null;
    return leg === 'net' ? (n[NODE_KEY[g]] ?? null) : null;
  };
  /* every role a strike has, in the one order (core/walls.ts LEVEL_ORDER), then the pin */
  const rolesOf = (strike: number): { word: string; tone: Tone }[] => {
    const out: { word: string; tone: Tone }[] = levelRoles(strike, { supreme: s.levels.supreme, callWall: s.levels.callWall, putWall: s.levels.putWall, flip: s.flip }).map(r => ({ word: r, tone: ROLE_TONE[r] }));
    if (!out.length && s.strikes.find(r => r.pin)?.strike === strike) out.push({ word: 'pin', tone: 'neutral' });
    return out;
  };
  const heaviest = useMemo(() => [...s.strikes].sort((x, y) => Math.abs(y[greek].net) - Math.abs(x[greek].net)).slice(0, 6), [s, greek]);
  const strike = focus ?? s.supreme[greek].strike;
  const kept = focus != null;
  const front = rowOf(strike);
  /* one classifier, the Agenda's — a thin strike says so in words */
  const watchKind = s.watch ? strikeTag(s.watch) ?? thinWords(s.watch) : '';
  const others = GREEKS.filter(g => g !== greek);
  /* the odd-looking walls, plainly: a call wall is the most CALL gamma (its puts can still outweigh it), a put wall the most
     PUT gamma (above price it is overhead put hedging, not a floor) */
  const wallWhy = (() => {
    const parts: string[] = [];
    const cw = s.callWall.strike;
    const pw = s.putWall.strike;
    const cwNet = valueAt(cw, 'gex', 'net');
    if (cwNet != null && shownGreek('gex', cwNet) < 0) parts.push(`${fmtStrike(cw)} is the call wall because it holds the most call gamma; its puts are heavier still, so its net is negative — dealers are short gamma there, so it is not a lid.`);
    /* one "at price" (core/walls.ts wallPlace, 0.05%) */
    else if (wallPlace(cw, s.spot) === 'below') parts.push(`The call wall ${fmtStrike(cw)} is below price: the most call gamma sits under it, which can act as support.`);
    if (wallPlace(pw, s.spot) === 'above') parts.push(`The put wall ${fmtStrike(pw)} is above price: that is overhead put hedging, not a floor.`);
    return parts.join(' ');
  })();

  /* EVERY FIGURE IN THE PRIMARY INK — a missing one muted; no ramp, no family colour on a number */
  /* gamma in the reader's sign and ink (retailSign.ts): positive absorbs, green; negative amplifies, red */
  const Money = ({ v, bold = false, size = 11, g: mg = greek }: { v: number | null; bold?: boolean; size?: number; g?: Greek }) => {
    /* never a false $0: vega comes off the contract rows alone, so a strike whose contracts carry none says so */
    const noVega = mg === 'vex' && (v == null || v === 0);
    const shown = v == null || noVega ? null : shownGreek(mg, v);
    const ink = shown == null ? 'text-textMuted' : mg === 'gex' && shown > 0 ? 'text-bull' : mg === 'gex' && shown < 0 ? 'text-bear' : 'text-textPrimary';
    return (
      <span className={`font-mono tnum tabular-nums ${bold ? 'font-bold' : ''} ${ink}`} style={{ fontSize: size }} title={noVega ? 'No vega on these contracts: it is read off the contract rows, and none carry it at this strike' : undefined}>
        {shown == null ? '—' : `${mg === 'gex' && shown > 0 ? '+' : ''}${fmtUsd(shown)}`}
      </span>
    );
  };
  const Door = ({ k }: { k: number }) => (
    <button
      type="button"
      onClick={() => onPick(k, s.ticker)}
      title={focus === k ? 'Let go of this strike' : 'Keep this strike on the ruler'}
      className="font-mono text-t12 font-semibold tnum tabular-nums leading-none hover:underline underline-offset-2 decoration-ink/30 text-textPrimary"
      style={focus === k ? { color: SILVER } : undefined}
      data-side-strike={k}
      data-kept={focus === k || undefined}
    >
      {fmtStrike(k)}
    </button>
  );
  const Level = ({ word, tone, k, g = greek }: { word: string; tone: Tone; k: number | null; g?: Greek }) => {
    const leg: 'net' | 'call' | 'put' = word === 'call wall' ? 'call' : word === 'put wall' ? 'put' : 'net';
    const legWord = leg === 'net' ? 'net' : g === 'gex' ? (leg === 'call' ? 'calls' : 'puts') : leg === 'call' ? 'call γ' : 'put γ';
    return (
    <div className={LEVEL_COLS} data-side-level={word} title={`${SIDE_TIPS[word] ?? `The strike with the most ${word} on these contracts`}. The figure is the strike's ${leg === 'net' ? 'net' : `${leg}-leg`} ${GREEK_LABEL[g]}${leg !== 'net' ? ` — the leg that makes it the ${word}` : ''}.`}>
      <Tag tone={tone}>{word}</Tag>
      {k == null ? (
        <span className="col-span-3 font-mono text-t11 text-textMuted">{word === 'flip' ? 'none nearby' : 'none'}</span>
      ) : (
        <>
          <Door k={k} />
          <span className="font-mono text-t10 tnum tabular-nums text-textMuted text-right">{dist(k)}</span>
          <span className="text-right whitespace-nowrap" data-side-level-leg={leg}>
            <span className="mr-1 font-mono text-t9 uppercase tracking-wider text-textMuted">{legWord}</span>
            <Money v={valueAt(k, leg === 'net' ? g : 'gex', leg)} g={leg === 'net' ? g : 'gex'} />
          </span>
        </>
      )}
    </div>
    );
  };

  const windowRail = (
    <span className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Window" data-side-window={win}>
      {READ_WINDOWS.map((w, i) => {
        const on = w.key === win;
        const off = hist ? hist[i] == null : true;
        return (
          <button
            key={w.key}
            type="button"
            onClick={() => setWin(w.key)}
            aria-pressed={on}
            disabled={off}
            title={off ? 'Before the open' : `What the levels' contracts (${scopeWords}) did over the last ${w.key === 'open' ? 'session' : w.key}${rec.isToday ? '' : ` of ${longDay(rec.date)}'s session`}`}
            className={`px-1 h-4 rounded font-mono text-t9 tnum tabular-nums transition-colors ${on ? 'bg-ink/[0.1] text-textPrimary' : off ? 'text-textMuted/40 cursor-default' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
            data-side-win={w.key}
          >
            {w.key}
          </button>
        );
      })}
    </span>
  );

  const body = (
    <div className="flex flex-col gap-0.5 px-3 pb-3" data-side-body>
      {/* THE BOOK — the net on one line, its word the sheet's one accent */}
      <Cap tip={GLOSSARY.book}>
        {/* the scope beside the supreme and the walls, always */}
        The book · {L} · per {GREEK_UNIT[greek]} · <span className="text-warn/90" data-side-scope>{scopeWords}</span>
      </Cap>
      <div className="pt-2 flex items-center gap-2 min-w-0">
        <span
          className={`font-mono text-t17 font-bold tnum tabular-nums ${greek !== 'gex' ? 'text-textPrimary' : net > 0 ? 'text-bull' : net < 0 ? 'text-bear' : 'text-textPrimary'}`}
          title={greek === 'gex' ? netGexTitle(net, s.regime) : undefined}
          data-side-net
        >
          {greek === 'gex' && net > 0 ? '+' : ''}
          {fmtUsd(net)}
        </span>
        <span className="text-t11 text-textMuted whitespace-nowrap">net {L}</span>
        {/* the tag is the regime at spot (the read's), "either way" within a hair of the flip, and only for gamma */}
        {greek === 'gex' && <Tag tone="holo">{regimeWord}</Tag>}
      </div>
      <p className="pb-1.5 text-t11 leading-snug text-textSecondary" data-side-read>
        {s.read}
      </p>
      <div className="flex flex-col" data-side-levels>
        {/* THE ONE ORDER (core/walls.ts LEVEL_ORDER): supreme · call wall · put wall · flip */}
        {(greeks && greeks.length > 1 ? greeks : [greek]).map(g => (
          <Level key={g} word={greeks && greeks.length > 1 ? GREEK_LABEL[g] : 'supreme'} tone="supreme" k={s.supreme[g].strike} g={g} />
        ))}
        <Level word="call wall" tone="bull" k={s.callWall.strike} />
        <Level word="put wall" tone="bear" k={s.putWall.strike} />
        <Level word="flip" tone="white" k={s.flip} />
      </div>
      {/* why a wall sits where it does, in one line — said only when the levels look odd */}
      {greek === 'gex' && wallWhy && (
        <p className="pt-1 text-t105 leading-snug text-textMuted" data-side-wall-why>
          {wallWhy}
        </p>
      )}

      {/* HEAVIEST TODAY — a hairline table: rank · strike · dollars · the window's change */}
      <Cap aside={windowRail}>
        Heaviest · {L}
      </Cap>
      <div className="flex flex-col" data-side-heaviest>
        <div className={`${HEAVY_COLS} sticky top-0 z-10 bg-panel text-t9 uppercase tracking-widest text-textMuted`}>
          <span>#</span>
          <span>Strike</span>
          <span className="text-right tabular-nums">Net</span>
          <span className="text-right">Change</span>
        </div>
        {heaviest.map((r, i) => {
          const roles = rolesOf(r.strike);
          return (
            <div key={r.strike} className={HEAVY_COLS} data-side-heavy={r.strike}>
              <span className="font-mono text-t10 tnum tabular-nums text-textMuted">{i + 1}</span>
              <span className="min-w-0 flex items-center gap-1.5 whitespace-nowrap">
                <Door k={r.strike} />
                {roles.map(role => (
                  <Tag key={role.word} tone={role.tone}>{role.word}</Tag>
                ))}
              </span>
              <span className="text-right"><Money v={r[greek].net} /></span>
              <span className="font-mono text-t10 tnum tabular-nums text-right text-textPrimary whitespace-nowrap">
                <Change now={shownGreek(greek, r[greek].net)} then={shownThen(thenAt(winIdx, r.strike))} quiet />
              </span>
            </div>
          );
        })}
      </div>

      {/* THE STRIKE — its legs on one line, its other greeks two by two */}
      <Cap tip={kept ? undefined : GLOSSARY.supreme}>
        The strike · {fmtStrike(strike)} · {kept ? 'kept' : greeks && greeks.length > 1 ? `${GREEK_LABEL[greek]} supreme` : 'the supreme'}
      </Cap>
      {front ? (
        <div className="pt-1.5 flex items-baseline gap-2 font-mono text-t11 tnum tabular-nums whitespace-nowrap text-textPrimary" data-side-legs>
          <span className="text-t9 uppercase tracking-wider text-textMuted">{L}</span>
          <span>
            <span className="text-textMuted">puts</span> {fmtUsd(shownGreek(greek, front[greek].put))}
          </span>
          <span>
            <span className="text-textMuted">calls</span> {fmtUsd(shownGreek(greek, front[greek].call))}
          </span>
          <span className={`ml-auto font-bold text-t12 ${greek === 'gex' ? (shownGreek(greek, front[greek].net) > 0 ? 'text-bull' : 'text-bear') : ''}`}>{fmtUsd(shownGreek(greek, front[greek].net))}</span>
        </div>
      ) : greek === 'gex' && sideChain.some(x => Math.abs(x.strike - strike) < 1e-9) ? (
        /* off the drawn window, still on the book: its legs off the side's whole chain */
        (() => {
          const n = sideChain.find(x => Math.abs(x.strike - strike) < 1e-9)!;
          return (
            <div className="pt-1.5 flex items-baseline gap-2 font-mono text-t11 tnum tabular-nums whitespace-nowrap text-textPrimary" data-side-legs>
              <span className="text-t9 uppercase tracking-wider text-textMuted">{L}</span>
              <span>
                <span className="text-textMuted">puts</span> {fmtUsd(shownGreek(greek, n.putGex))}
              </span>
              <span>
                <span className="text-textMuted">calls</span> {fmtUsd(shownGreek(greek, n.callGex))}
              </span>
              <span className={`ml-auto font-bold text-t12 ${shownGreek(greek, n.netGex) > 0 ? 'text-bull' : 'text-bear'}`}>{fmtUsd(shownGreek(greek, n.netGex))}</span>
            </div>
          );
        })()
      ) : (
        <p className="pt-1.5 text-t11 text-textMuted">Off the book's window.</p>
      )}
      <div className="pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5" data-side-greeks>
        {others.map(g => (
          <Fact key={g} label={<span className="cursor-help" title={GREEK_EXPLAIN[g]}>{GREEK_LABEL[g]}</span>} value={<Money v={valueAt(strike, g)} g={g} />} />
        ))}
      </div>

      {/* TODAY'S CONTRACTS — one row of seven figures under their labels */}
      {/* the levels' contracts named by their scope, and the windows' session by date */}
      <Cap tip={`The contracts the levels read (${scopeWords}), re-priced at each window's price${rec.isToday && !rec.done ? '' : `, the windows counted back from ${rec.isToday ? "today's" : `${longDay(rec.date)}'s`} 4:00 close — the session is over, so nothing moves until the next open`}`}>{scopeWords} · {L} · {rec.isToday && !rec.done ? 'each window' : `each window to ${rec.isToday ? 'the' : `${rec.date.slice(5).replace('-', '/')}'s`} close`}</Cap>
      <div className="pt-1 grid grid-cols-7 font-mono tnum tabular-nums" data-side-windows>
        {READ_WINDOWS.map((w, i) => (
          <span key={w.key} className="flex flex-col leading-tight min-w-0">
            <span className="text-t9 text-textMuted">{w.key}</span>
            <span className="text-t10 text-textPrimary whitespace-nowrap">{front ? <Change now={shownGreek(greek, front[greek].net)} then={shownThen(thenAt(i, strike))} quiet /> : <span className="text-textMuted">—</span>}</span>
          </span>
        ))}
      </div>

      {/* TO THE CLOSE */}
      <Cap tip={`The expected move is ${s.moveWords}`}>{s.horizon ? s.horizon.replace(/^by/, 'By') : cmp.inSession ? 'To the close' : todayScopeLabel() === 'Today' ? "Today's session" : 'Next session'}</Cap>
      <div className="pt-1 flex flex-col gap-0.5">
        <Fact
          label="Expected move"
          value={
            <span className="inline-flex items-baseline gap-1.5">
              <span className="font-bold">±${s.sigmaLeft.toFixed(2)}</span>
              <span className="text-t10 text-textMuted">±{s.sigmaLeftPct.toFixed(2)}%</span>
            </span>
          }
        />
        <Fact
          label="Likeliest close"
          value={
            s.closes ? (
              <span className="inline-flex items-baseline gap-1.5">
                <Door k={s.closes.strike} />
                <span className="text-t10 text-textMuted" title="Model weight: a normal on 1σ to the close, pulled by the book — not a measured chance">{s.closes.odds.toFixed(0)}% model weight</span>
              </span>
            ) : (
              <span className="text-textMuted" title={s.closeTop ? `No strike reaches ${LEAN_MIN}% — the best, ${s.closeTop.strike}, is ${s.closeTop.odds.toFixed(0)}%` : undefined}>{s.closeTop ? 'no clear lean' : '—'}</span>
            )
          }
        />
        <Fact
          label="Watch first"
          value={
            s.watch ? (
              /* wraps under its strike on a phone rather than run off the card */
              <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5 text-right max-w-[220px]">
                <Door k={s.watch.strike} />
                <span className="text-t10 text-textMuted" title={kindTip(s.watch.roles?.[0] ?? watchKind)}>
                  {watchKind} · {s.watch.atPrice ? 'at price' : s.watch.today ? 'reached today' : `${pct(s.watch.reach)} reached${s.watch.horizon ? ` ${s.watch.horizon}` : ''}`}{s.watch.isShelf ? ` · ${holdLabel(s.watch.hold)}` : ''}
                </span>
              </span>
            ) : (
              <span className="text-textMuted">none</span>
            )
          }
        />
        <Fact label={bellDay().clock} value={s.bellShare != null ? <span title={`${s.bellShare}% — ${bellDay().tip(s.ticker)}`}>{s.bellShare}% <span className="text-t10 text-textMuted">of the hedging</span></span> : <span title={s.bellWhy === 'none' ? BELL_NONE_TITLE(s.ticker) : 'Still reading the expiry list'}>{s.bellWhy === 'none' ? bellNone() : '…'}</span>} />
      </div>
      <div className="pt-3 font-mono text-t9 uppercase tracking-widest text-textMuted" data-side-foot>
        {s.strikes.length} strikes · {s.expiry !== 'ALL' || s.levels.complete !== false || bookDatesIn(s.ticker) ? `${s.expiryCount} ${s.expiryCount === 1 ? 'expiry' : 'expiries'}` : '… expiries'}
      </div>
    </div>
  );

  /* ON A PHONE — a card under the ruler, the chip in its head, no tab */
  if (stacked)
    return (
      <div className="min-w-0 border border-borderSubtle rounded-md bg-panel" data-compare-side={side} data-side-open>
        <div className="px-3 pt-3 flex items-center">{chip}</div>
        {body}
      </div>
    );

  const Fold = side === 'a' ? (open ? ChevronLeft : ChevronRight) : open ? ChevronRight : ChevronLeft;
  const edge = side === 'a' ? 'border-r' : 'border-l';
  return (
    <div
      className={`relative shrink-0 min-h-0 flex flex-col ${edge} border-borderSubtle/60 ${full ? 'bg-canvas' : 'bg-panel'} transition-[width] duration-200 ease-out motion-reduce:transition-none overflow-hidden`}
      style={{ width: open ? SIDE_W : SIDE_TAB_W }}
      data-compare-side={side}
      data-side-open={open || undefined}
    >
      {open ? (
        <>
          <div className={`shrink-0 flex items-center gap-2 px-3 pt-3 ${side === 'b' ? 'flex-row-reverse' : ''}`} style={{ width: SIDE_W }}>
            {chip}
            <button
              type="button"
              onClick={onToggle}
              title={`Fold ${s.ticker}'s read to the edge`}
              aria-label={`Fold ${s.ticker}'s read`}
              className={`${side === 'b' ? 'mr-auto' : 'ml-auto'} inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors`}
              data-side-fold
            >
              <Fold className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto" style={{ width: SIDE_W }}>
            {body}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          title={`Open ${s.ticker}'s read`}
          aria-label={`Open ${s.ticker}'s read`}
          className="flex-1 min-h-0 flex flex-col items-center gap-2 py-3 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] transition-colors"
          style={{ width: SIDE_TAB_W }}
          data-side-tab
        >
          <Fold className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-t10 font-bold tracking-widest" style={{ writingMode: 'vertical-rl', transform: side === 'a' ? 'rotate(180deg)' : undefined }}>
            {s.ticker}
          </span>
        </button>
      )}
    </div>
  );
};

export default CompareSidePanel;
