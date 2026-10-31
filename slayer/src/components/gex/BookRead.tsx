/* The book's read: a glass card beside the ladder or calendar with five sections (the book, heaviest strikes, the strike under
   the pointer, to the close, recent). One card whatever greek is shown; windows read today's contracts off the replay grid. */

import { levelRoles, type LevelRole } from '../../core/walls';
import { expirySpan, todayScopeLabel } from '../../data/bookWindow';
import { useNameLevels } from '../../data/levelsScope';
import { useLevelsFor } from '../../data/levelsFor';
import { peekDaySigma, peekMoveToClose, peekScopeMove } from '../../data/book/move';
import { peekEntry } from '../../data/book/store';
import { shownGreek } from './retailSign';
import { FLAT_DOOR, FLAT_ON } from '../ui/flatDoor';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { GREEK_EXPLAIN, GREEK_LABEL } from '../../data/compare';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { todayColumn, GREEKS, GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { readRegime } from '../../data/flipLevel';
import { readSessionClock } from '../../data/moc';
import { replayRange, snapshotAt } from '../../data/replay';
import type { ExposureProfileData } from '../../types/gex';
import type { MarketSnapshot } from '../../types/market';
import { Change, READ_WINDOWS } from './ChangeMark';
import { HEAT_MODE, heatLaneColor, type HeatMode } from './heatmap';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './paletteInk';
import { fmtStrike } from '../../core/format';

const SILVER = 'rgb(var(--silver))';
const MUTED = 'rgb(var(--text-muted))';

/** The windows a strike's change is read over, shared with Compare (ChangeMark.tsx). */
const WINDOWS = READ_WINDOWS;
const SECTIONS = [
  { id: 'book', label: 'The book' },
  { id: 'heaviest', label: 'Heaviest' },
  { id: 'strike', label: 'The strike' },
  { id: 'close', label: 'To the close' },
  { id: 'recent', label: 'Recent' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

interface BookReadProps {
  surface: ExposureSurface;
  snapshot: MarketSnapshot;
  /** The greek the ladder leads with */
  greek: Greek;
  /** The ladder's ramp (house or thermal): every net figure here wears it. */
  mode?: HeatMode;
  /** How far along the calendar the ladder reads, and whether today's column is out */
  /** The expiry columns the host draws, as surface indices — the read sums the same book the views show */
  expiries: number[];
  afterBell: boolean;
  rings: StrikeWindow;
  /** The strike the reader kept (a click) */
  selectedStrike?: number | null;
  /** The whole column, not a panel over its right — a name beside two or more others has no room for both */
  fill?: boolean;
  /** On its way out: the host fades the card over 200ms, then unmounts it on a timer (the house's close rule) */
  closing?: boolean;
  /** The strike under the pointer, as the ladder or the calendar reports it — only this card listens */
  subscribePointed: (fn: (strike: number | null) => void) => () => void;
  onKeep?: (strike: number) => void;
  onClose: () => void;
}

const Head = ({ children, title }: { children: ReactNode; title?: string }) => (
  <div className="font-mono text-t11 uppercase tracking-[0.14em] text-textMuted" title={title}>
    {children}
  </div>
);

/** THE READ's door — beside the guide's on every book; lit while the card is up.
    `compact` = the icon alone, for a column's head beside other names (the
    words stay in the title); `name` says whose read the door opens. */
export const ReadDoor = ({ open, onClick, compact = false, name, testId = 'data-ledger-read', flat = false }: { open: boolean; onClick: () => void; compact?: boolean; name?: string; testId?: string; /** The house's flat control (ui/flatDoor.ts) — the band's */ flat?: boolean }) => (
  <button
    onClick={onClick}
    aria-pressed={open}
    aria-label={open ? `Close ${name ? `${name}'s` : 'the'} read` : `${name ? `${name}'s` : 'The'} read`}
    title={open ? `Close ${name ? `${name}'s` : 'the'} read (Esc)` : `${name ? `${name}'s` : "The book's"} read — the net, the levels, the heaviest strikes and what they did, the strike under the pointer, the move to the close`}
    className={
      flat
        ? `${FLAT_DOOR} ${compact ? 'w-7 justify-center px-0' : ''} ${open ? FLAT_ON : ''}`
        : `hit inline-flex items-center gap-1.5 h-7 rounded-md border font-mono text-t11 transition-colors ${compact ? 'w-7 justify-center' : 'px-2.5'} ${
            open ? 'border-silver/50 text-silver bg-silver/[0.08]' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted'
          }`
    }
    {...{ [testId]: name ?? '' }}
  >
    {open ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
    {!compact && 'The read'}
  </button>
);

const BookRead = ({ surface, snapshot, greek, mode = HEAT_MODE, expiries, afterBell, rings, selectedStrike, fill = false, closing = false, subscribePointed, onKeep, onClose }: BookReadProps) => {
  const drawnStrikes = Math.min(rings, surface.strikes.filter(k => k >= surface.spot).length) + Math.min(rings, surface.strikes.filter(k => k < surface.spot).length);
  const [win, setWin] = useState('15m');
  const [pointed, setPointed] = useState<number | null>(null);
  const [recent, setRecent] = useState<number[]>([]);
  const [current, setCurrent] = useState<SectionId>('book');
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /* the pointer, fed by the host — this card alone re-renders on a move */
  useEffect(() => subscribePointed(setPointed), [subscribePointed]);
  /* Esc closes the card before anything under it (the field's own fullscreen listens after) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  /* The expiries shown, by the ladder's own rule (today's column out after the bell). */
  const shownIdx = useMemo(() => {
    const all = surface.expiries.map((_, i) => i);
    const todayIdx = todayColumn(surface);
    const live = afterBell && todayIdx >= 0 ? all.filter(i => i !== todayIdx) : all;
    const kept = live.filter(i => expiries.includes(i));
    return kept.length ? kept : live.slice(0, 1);
  }, [surface, afterBell, expiries]);
  const at = (g: Greek, s: number, side: 'put' | 'call' | 'net') => shownIdx.reduce((a, e) => a + (surface[side][g][e]?.[s] ?? 0), 0);
  const idxOf = (strike: number) => surface.strikes.indexOf(strike);

  /* Net GEX and each level's figure are the Levels card's contracts (data/levelsFor.ts, the one source);
     a figure summed over the matrix's own rows says so. */
  const scope = useNameLevels(snapshot.ticker);
  const lv = useLevelsFor(snapshot.ticker, scope);
  const lvReady = !!lv && lv.complete;
  const windowWords = `matrix rows ${expirySpan(shownIdx.map(i => surface.expiries[i]?.date).filter(Boolean) as string[]) ?? ''}`;
  const net = surface.strikes.reduce((a, _, s) => a + at(greek, s, 'net'), 0);
  /* The net's ink is the ladder's ramp: a strike against the heaviest net for its greek, a total against itself. */
  const scale = useMemo(() => {
    const m = {} as Record<Greek, number>;
    for (const g of GREEKS) m[g] = Math.max(1, ...surface.strikes.map((_, s) => Math.abs(at(g, s, 'net'))));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, shownIdx]);
  const rampInk = (g: Greek, v: number, max = scale[g]) => heatLaneColor(v, max, mode, 0.35);
  /* the printed figures in the reader's sign (retailSign.ts); the inks read the kept value */
  const shownThen = (v: number | null): number | null => (v == null ? null : shownGreek(greek, v));
  const { levels } = surface;
  const verdict = readRegime(levels, k => (lv ? lv.netAt(k) : null));
  const pinStrike = surface.front.strikes.find(r => r.pin)?.strike;
  /* Every role a strike holds, in LEVEL_ORDER (core/walls.ts), inked by the first. */
  const roleOf = (strike: number): { word: string; ink: string } | null => {
    const roles = levelRoles(strike, { supreme: levels.supreme, callWall: levels.callWall, putWall: levels.putWall, flip: levels.flipFound === false ? null : levels.flip });
    if (roles.length) return { word: roles.join(' · '), ink: ROLE_INKS[roles[0]] };
    return strike === pinStrike ? { word: 'pin', ink: MUTED } : null;
  };
  const ROLE_INKS: Record<LevelRole, string> = { supreme: SUPREME, 'call wall': CALL_WALL, 'put wall': PUT_WALL, flip: FLIP };
  /* the one order (core/walls.ts levelRoles): supreme · call wall · put wall, then the flip */
  const levelRows = [
    { word: 'supreme', strike: levels.supreme, ink: SUPREME },
    { word: 'call wall', strike: levels.callWall, ink: CALL_WALL },
    { word: 'put wall', strike: levels.putWall, ink: PUT_WALL },
    /* no crossing within ±10% is no flip — no row at a placeholder */
    ...(levels.flipFound === false ? [] : [{ word: 'flip', strike: levels.flip, ink: FLIP }]),
  ];

  /* Today's contracts over each window, off the minute grid, seven books back. */
  const history = useMemo<(ExposureProfileData | null)[] | null>(() => {
    const range = replayRange(snapshot.ticker);
    if (!range) return null;
    return WINDOWS.map(w => {
      const back = w.min === Infinity ? range.length : w.min * 60;
      if (back > range.length && w.min !== Infinity) return null; // the window reaches before the open
      return buildExposureProfile(snapshotAt(snapshot, range, Math.max(0, range.length - back)), '0DTE', rings);
    });
  }, [snapshot, rings]);
  const winIdx = Math.max(0, WINDOWS.findIndex(w => w.key === win));
  const thenAt = (i: number, strike: number): number | null => {
    const p = history?.[i];
    if (!p) return null;
    return p.strikes.find(r => r.strike === strike)?.[greek].net ?? null;
  };

  /* HEAVIEST TODAY — today's book, ranked by the greek, with its change over the window */
  const heaviest = useMemo(
    () =>
      [...surface.front.strikes]
        .sort((a, b) => Math.abs(b[greek].net) - Math.abs(a[greek].net))
        .slice(0, 6),
    [surface, greek]
  );

  /* THE STRIKE — under the pointer, else kept, else the supreme */
  const strike = pointed ?? selectedStrike ?? levels.supreme;
  const sIdx = idxOf(strike);
  const legs = sIdx >= 0 ? { put: at(greek, sIdx, 'put'), call: at(greek, sIdx, 'call'), net: at(greek, sIdx, 'net') } : null;
  const front = surface.front.strikes.find(r => r.strike === strike);
  useEffect(() => {
    if (selectedStrike == null) return;
    setRecent(r => [selectedStrike, ...r.filter(s => s !== selectedStrike)].slice(0, 8));
  }, [selectedStrike]);
  useEffect(() => {
    if (pointed == null) return;
    /* a strike lingered under the pointer is one you looked at — a sweep across rows is not */
    const id = window.setTimeout(() => setRecent(r => [pointed, ...r.filter(s => s !== pointed)].slice(0, 8)), 600);
    return () => window.clearTimeout(id);
  }, [pointed]);

  /* One expected move on every page: the implied move into the Levels scope's expiry (uwBook peekDaySigma),
     scaled to the minutes left while the session runs. */
  const clock = readSessionClock();
  const minLeft = clock.secondsToClose / 60;
  const shut = minLeft <= 0;
  const sigmaDay = peekDaySigma(snapshot.ticker, lv?.date ?? null);
  /* A later expiry's move covers its whole horizon (uwBook peekScopeMove, as the reach odds read it); the card says which it is. */
  const scopeMove = peekScopeMove(snapshot.ticker, lv?.date ?? null);
  const multi = !!scopeMove?.multi;
  /* Scaled to the minutes left exactly once (uwBook peekMoveToClose). */
  const w1 = multi ? scopeMove!.move : sigmaDay != null ? (shut ? sigmaDay : peekMoveToClose(snapshot.ticker, lv?.date ?? null, minLeft) ?? sigmaDay * Math.sqrt(Math.min(390, minLeft) / 390)) : null;
  const moveDate = lv?.date ?? null;
  const moveWords = scopeMove?.words ?? (moveDate ? `the implied move into ${expirySpan([moveDate])}` : 'the implied move');
  const nearest = (price: number) => surface.strikes.reduce((b, s) => (Math.abs(s - price) < Math.abs(b - price) ? s : b), surface.strikes[0]);

  const go = (id: SectionId) => {
    setCurrent(id);
    bodyRef.current?.querySelector<HTMLElement>(`[data-read-section="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.getBoundingClientRect().top + 8;
    let best: SectionId = 'book';
    for (const s of SECTIONS) {
      const el = body.querySelector<HTMLElement>(`[data-read-section="${s.id}"]`);
      if (el && el.getBoundingClientRect().top <= top + 24) best = s.id;
    }
    if (best !== current) setCurrent(best);
  };

  const unit = GREEK_UNIT[greek];
  const label = GREEK_LABEL[greek];
  /* Under 620 px the read takes the whole column; a 62% panel there cut the level names. */
  const asideRef = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const host = asideRef.current?.parentElement;
    if (!host) return;
    const read = () => setNarrow(host.clientWidth < 620);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const whole = fill || narrow;

  return (
    <aside
      ref={asideRef}
      className={`absolute inset-y-0 right-0 z-20 flex flex-col bg-card/[0.97] backdrop-blur-md backdrop-saturate-150 animate-soft-in transition-opacity duration-200 motion-reduce:transition-none ${
        /* 460 px, the guide cards' width: narrower wraps the rail's names inside their buttons. */
        whole ? 'w-full' : 'w-[460px] max-w-[62%] border-l border-borderMuted shadow-[-16px_0_48px_rgba(0,0,0,0.45)]'
      } ${closing ? 'opacity-0 pointer-events-none' : ''}`}
      aria-label={`${surface.ticker}'s read`}
      data-book-read={surface.ticker}
      data-read-fill={whole || undefined}
    >
      {/* THE HEAD — whose read, in which greek, over which window */}
      {/* The head wraps rather than cuts, and the panel is opaque so rows do not show through. */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2 min-h-10 border-b border-borderSubtle/70 min-w-0 bg-card">
        <span className="font-mono text-t11 font-bold text-textPrimary">{surface.ticker}</span>
        <span className="font-mono text-t11 uppercase tracking-widest text-textMuted min-w-0" data-read-head-window>{label} · {shownIdx.length === 1 ? surface.expiries[shownIdx[0]]?.date : `${shownIdx.length} expiries`}</span>
        <span className="ml-auto shrink-0 inline-flex items-center gap-0.5" role="group" aria-label="Window" data-read-window>
          {WINDOWS.map(w => {
            const on = w.key === win;
            const dead = history ? history[WINDOWS.indexOf(w)] == null : true;
            return (
              <button
                key={w.key}
                onClick={() => setWin(w.key)}
                aria-pressed={on}
                disabled={dead}
                title={dead ? 'Before the open' : `What today's contracts did over the last ${w.key === 'open' ? 'session' : w.key}`}
                className={`px-1.5 h-6 rounded font-mono text-t11 tnum transition-colors ${on ? 'bg-ink/[0.1] text-textPrimary' : dead ? 'text-textMuted/40 cursor-default' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'}`}
              >
                {w.key}
              </button>
            );
          })}
        </span>
        <button onClick={onClose} aria-label="Close the read" title="Close (Esc)" className="p-1 -mr-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* THE RAIL — the sections' names, the one in view lit */}
      <div className="shrink-0 flex items-center gap-1 px-2.5 h-8 border-b border-borderSubtle/50 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-read-rail>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            aria-current={current === s.id || undefined}
            className={`shrink-0 px-2 h-6 rounded font-mono text-t11 whitespace-nowrap transition-colors ${current === s.id ? 'text-silver bg-silver/[0.08]' : 'text-textMuted hover:text-textPrimary'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div ref={bodyRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-5 font-mono tnum">
        {/* THE BOOK */}
        <section data-read-section="book" className="flex flex-col gap-2">
          <Head>The book · {label} · per {unit}</Head>
          <div className="flex items-baseline gap-2">
            {/* the net in the ladder's own ramp — the total against itself, the foot's rule */}
            {greek === 'gex' ? (
              <>
                <span className="text-t17 font-semibold" style={{ color: lvReady ? rampInk(greek, -lv!.netGex, Math.max(1, Math.abs(lv!.netGex))) : MUTED }} title={lvReady ? undefined : 'Still loading the Levels card’s contracts'}>
                  {lvReady ? fmtUsd(lv!.netGex) : '…'}
                </span>
                <span className="text-t11 text-textMuted">net GEX · {lv?.scopeLabel ?? '…'} · every strike, as on the Levels card</span>
              </>
            ) : (
              <>
                <span className="text-t17 font-semibold" style={{ color: rampInk(greek, net, Math.max(1, Math.abs(net))) }}>{fmtUsd(shownGreek(greek, net))}</span>
                {/* The strikes near spot, not the whole book; the line says so. */}
                <span className="text-t11 text-textMuted">net {label} · {windowWords} · the {surface.strikes.length} strikes near spot</span>
              </>
            )}
          </div>
          <p className="font-sans text-t11 leading-relaxed text-textSecondary">{verdict.read}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-t11">
            {levelRows.map(l => {
              const i = idxOf(l.strike);
              /* GEX: the level's own figure on the Levels card's contracts (Compare's); another greek: the matrix rows' */
              /* A wall prints its own leg: the call wall its calls, the put wall its puts, the supreme its net. */
              const leg: 'call' | 'put' | 'net' = l.word === 'call wall' ? 'call' : l.word === 'put wall' ? 'put' : 'net';
              const legs = greek === 'gex' ? (lvReady ? lv!.legsAt(l.strike) : undefined) : undefined;
              const scoped = legs === undefined ? undefined : legs == null ? null : legs[leg];
              if (greek === 'gex')
                return (
                  <button key={l.word} onClick={() => onKeep?.(l.strike)} className="flex items-baseline gap-1.5 text-left hover:opacity-80 transition-opacity" title={`Keep ${fmtStrike(l.strike)} — ${leg === 'net' ? 'net GEX' : `the ${leg} leg's GEX, the leg that makes it the ${l.word}`}${legs ? ` (net ${fmtUsd(legs.net)})` : ''} on ${lv?.scopeLabel ?? 'the Levels card'}`}>
                    <span className="text-t11 uppercase tracking-wider" style={{ color: l.ink }}>{l.word}</span>
                    <span className="text-textPrimary font-semibold">{fmtStrike(l.strike)}</span>
                    {l.word !== 'flip' && (
                      <span style={{ color: scoped != null ? rampInk(greek, -scoped) : MUTED }}>
                        <span className="text-t9 uppercase tracking-wider text-textMuted mr-1">{leg === 'call' ? 'calls' : leg === 'put' ? 'puts' : 'net'}</span>
                        {scoped === undefined ? '…' : scoped == null ? '—' : `${scoped > 0 ? '+' : ''}${fmtUsd(scoped)}`}
                      </span>
                    )}
                  </button>
                );
              return (
                <button key={l.word} onClick={() => onKeep?.(l.strike)} className="flex items-baseline gap-1.5 text-left hover:opacity-80 transition-opacity" title={`Keep ${fmtStrike(l.strike)}`}>
                  <span className="text-t11 uppercase tracking-wider" style={{ color: l.ink }}>{l.word}</span>
                  <span className="text-textPrimary font-semibold">{fmtStrike(l.strike)}</span>
                  <span style={{ color: i >= 0 ? rampInk(greek, at(greek, i, 'net')) : MUTED }}>{i >= 0 ? fmtUsd(shownGreek(greek, at(greek, i, 'net'))) : '—'}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* HEAVIEST TODAY */}
        <section data-read-section="heaviest" className="flex flex-col gap-2">
          <Head>Heaviest {todayScopeLabel() === 'Today' ? 'today' : '· next session'} · {label} · over {win === 'open' ? 'the session' : win}</Head>
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 text-t11 items-baseline">
            {heaviest.map((r, i) => {
              const role = roleOf(r.strike);
              const now = r[greek].net;
              return (
                <button key={r.strike} onClick={() => onKeep?.(r.strike)} className="contents text-left" title={`Keep ${fmtStrike(r.strike)}`}>
                  <span className="text-textPrimary font-semibold"><span className="text-textMuted font-normal mr-1.5">{i + 1}</span>{fmtStrike(r.strike)}</span>
                  <span className="text-t11 uppercase tracking-wider truncate" style={{ color: role?.ink ?? MUTED }}>{role?.word ?? ''}</span>
                  <span style={{ color: rampInk(greek, now, surface.maxAbs[greek]) }}>{fmtUsd(shownGreek(greek, now))}</span>
                  <span className="text-right"><Change now={shownGreek(greek, now)} then={shownThen(thenAt(winIdx, r.strike))} /></span>
                </button>
              );
            })}
          </div>
          {!history && <p className="text-t11 text-textMuted">No minute grid yet — the changes arrive once the session has two bars.</p>}
        </section>

        {/* THE STRIKE */}
        <section data-read-section="strike" className="flex flex-col gap-2">
          <Head>
            The strike · {fmtStrike(strike)}
            <span className="ml-1.5 normal-case tracking-normal">{pointed != null ? '· under the pointer' : selectedStrike != null ? '· kept' : '· the supreme'}</span>
          </Head>
          {greek === 'gex' && (
            <div className="flex items-baseline gap-2 text-t11">
              <span className="text-t11 uppercase tracking-wider text-textMuted">net GEX · {lv?.scopeLabel ?? '…'}</span>
              {(() => {
                const v = lvReady ? lv!.netAt(strike) : undefined;
                return <span className="font-semibold" style={{ color: v != null ? rampInk(greek, -v) : MUTED }}>{v === undefined ? '…' : v == null ? '—' : fmtUsd(v)}</span>;
              })()}
            </div>
          )}
          {legs ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-t11">
              <span className="text-t11 uppercase tracking-wider text-textMuted" title="Summed over the dates the matrix draws, not the Levels card's contracts">{label} · {windowWords}</span>
              <span style={{ color: PUT_WALL }}>puts {fmtUsd(shownGreek(greek, legs.put))}</span>
              <span style={{ color: CALL_WALL }}>calls {fmtUsd(shownGreek(greek, legs.call))}</span>
              <span className="font-semibold" style={{ color: rampInk(greek, legs.net) }}>net {fmtUsd(shownGreek(greek, legs.net))}</span>
            </div>
          ) : (
            <p className="text-t11 text-textMuted">Off the book's window.</p>
          )}
          {sIdx >= 0 && (
            <div className="grid grid-cols-5 gap-x-2 text-t11">
              {GREEKS.map(g => (
                <span key={g} className="flex flex-col">
                  <span className="text-t11 uppercase tracking-wider text-textMuted cursor-help" title={GREEK_EXPLAIN[g]}>{GREEK_LABEL[g]}</span>
                  {(() => {
                    const v = at(g, sIdx, 'net');
                    /* Never a false $0: vega comes off the contract rows alone, so "…" while those rows are out and "—" once they are in. */
                    if (g === 'vex' && v === 0) {
                      const facts = peekEntry(snapshot.ticker)?.factsDates;
                      const waiting = shownIdx.some(i => { const d = surface.expiries[i]?.date; return !!d && !facts?.has(d); });
                      return <span style={{ color: MUTED }} title={waiting ? 'Vega is still loading — it is read off the contract rows' : 'No vega on these contracts at this strike'}>{waiting ? '…' : '—'}</span>;
                    }
                    return <span className={g === greek ? 'font-semibold' : ''} style={{ color: rampInk(g, v) }}>{fmtUsd(shownGreek(g, v))}</span>;
                  })()}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Head title="Open interest is set once overnight, so the contracts are the same all day; each window's figure is those contracts re-priced at that minute's price and clock (vol held)">{todayScopeLabel() === 'Today' ? "Today's contracts" : "Next session's contracts"} · {label} · re-priced over each window{todayScopeLabel() === 'Today' ? '' : ' to the close'}</Head>
            <div className="grid grid-cols-7 gap-x-1 text-t11">
              {WINDOWS.map((w, i) => (
                <span key={w.key} className="flex flex-col">
                  <span className="text-t11 text-textMuted">{w.key}</span>
                  <span>{front ? <Change now={shownGreek(greek, front[greek].net)} then={shownThen(thenAt(i, strike))} /> : <span style={{ color: MUTED }}>—</span>}</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* TO THE CLOSE */}
        <section data-read-section="close" className="flex flex-col gap-2">
          <Head>{multi && moveDate ? `By ${expirySpan([moveDate])}` : shut ? (todayScopeLabel() === 'Today' ? "Today's session" : 'Next session') : 'To the close'} · expected move</Head>
          <div className="flex items-baseline gap-2">
            <span className="text-t17 font-semibold text-textPrimary" data-read-move={w1 != null ? w1.toFixed(2) : undefined}>{w1 != null ? `±${w1.toFixed(2)}` : '…'}</span>
            <span className="text-t11 text-textMuted" data-read-move-source={scopeMove?.source}>
              one expected move · {multi && moveDate ? `by ${expirySpan([moveDate])}, the expiry the levels read` : shut ? (todayScopeLabel() === 'Today' ? "today's session" : 'the next session') : `${Math.round(minLeft)} min left`} · {multi ? moveWords : scopeMove?.source === 'vendor' || !scopeMove ? moveWords : `one session of ${moveWords}`}
            </span>
          </div>
          {/* One column: the reach lines wrapped in half the card. */}
          <div className="grid grid-cols-1 gap-y-1 text-t11">
            {w1 != null && [
              { word: 'one move up', price: surface.spot + w1, ink: CALL_WALL },
              { word: 'one move down', price: surface.spot - w1, ink: PUT_WALL },
              { word: 'two moves up', price: surface.spot + 2 * w1, ink: CALL_WALL },
              { word: 'two moves down', price: surface.spot - 2 * w1, ink: PUT_WALL },
            ].map(m => {
              const s = nearest(m.price);
              const role = roleOf(s);
              return (
                <button key={m.word} onClick={() => onKeep?.(s)} className="flex items-baseline gap-1.5 text-left hover:opacity-80 transition-opacity" title={`Keep ${fmtStrike(s)}`}>
                  <span className="text-t11 uppercase tracking-wider text-textMuted">{m.word}</span>
                  <span style={{ color: m.ink }}>{m.price.toFixed(2)}</span>
                  <span className="text-textMuted">
                    · {fmtStrike(s)}
                    {role ? <span className="ml-1" style={{ color: role.ink }}>{role.word}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* RECENT */}
        <section data-read-section="recent" className="flex flex-col gap-2">
          <Head>Recently pointed at</Head>
          {recent.length === 0 ? (
            <p className="text-t11 text-textMuted">Point at a row and it lands here.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recent.map(s => {
                const role = roleOf(s);
                return (
                  <button
                    key={s}
                    onClick={() => onKeep?.(s)}
                    className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-t11 transition-colors ${s === selectedStrike ? 'border-silver/50 text-silver' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted'}`}
                    title={`Keep ${fmtStrike(s)}`}
                  >
                    {fmtStrike(s)}
                    {role && <span className="text-t11 uppercase tracking-wider" style={{ color: role.ink }}>{role.word}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* THE FOOT */}
      <div className="shrink-0 flex items-center gap-3 px-3.5 h-7 border-t border-borderSubtle/60 font-mono text-t11 uppercase tracking-widest text-textMuted">
        {/* The strikes the grid beside it draws, not the whole book. */}
        <span>{drawnStrikes} strikes · {shownIdx.length} {shownIdx.length === 1 ? 'expiry' : 'expiries'}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${clock.phase === 'OPEN' || clock.phase === 'AUCTION' ? 'bg-select' : 'bg-textMuted'}`} aria-hidden />
          {clock.phase === 'OPEN' || clock.phase === 'AUCTION' ? 'live' : clock.label} · <span className="normal-case tracking-normal tnum" style={{ color: SILVER }}>{clock.etTime}</span>
        </span>
      </div>
    </aside>
  );
};

export default BookRead;
