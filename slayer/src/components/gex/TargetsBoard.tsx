/* Targets (the Agenda): every strike in the order it matters today — the head (watch first, most likely reached, the
   nearest walls in reach, the close's lean), the sentence, the podium of three and the list. One to four panes, each
   denser beside others; a click keeps the strike and opens the row's card (reached, size, paths, OI, built, neighbours). */

import { daySigmaOfIv } from '../../data/expectedMove';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import JingleBell from '../ui/JingleBell';
import { heatLaneColor } from './heatmap';
import { ALERT, CALL_WALL, FLIP, PUT_WALL, SUPREME, THERMAL_COOL, THERMAL_WARM } from './paletteInk';
import { AGENDA_COLUMNS, AGENDA_MIN_W, CARD_H, ROW_H } from './targetsSkeletons';
import { AGENDA_ORDERS, DRIVER_WORDS, buildWords, closeLeanWords, reachWords, strikeKind, targetName, thinWords, todayWords, type Agenda, type AgendaOrder, type Target } from '../../data/agenda';
import { LONG_GAMMA, SHORT_GAMMA } from './paletteInk';
import { fmtDollars, fmtStrike, type AheadClock } from '../../data/ahead';
import { chanceLabel, holdLabel, holdShort, pathFlowWords, pathLean } from '../../data/wall';
import { GLOSSARY, kindTip } from './glossary';
import { STRIKE_WINDOWS, type StrikeWindow } from '../../data/exposure';
import { useNameUnit } from '../../data/distanceUnits';
import { cadenceWords, longDay, recordDay, aheadWord, sessionDay } from '../../data/bookWindow';
import { fmtDistance, sessionAtr } from '../../data/atr';
import { bookCandles, peekDaySigma, peekIv, useBookRev } from '../../data/uwBook';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal */
/* an armed alert wears the alert ink (palette ALERT) and the bell jingles */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const ROLE_INK: Record<string, string> = { 'call wall': CALL_WALL, 'put wall': PUT_WALL, supreme: SUPREME, flip: FLIP };
/** Breaks and trapdoors are the calendar's warm side; a wall's weight its cool side */
const WARM = THERMAL_WARM;
const COOL = THERMAL_COOL;
/* "<1%" for the tiny chances — no floor */
const pct = chanceLabel;
export const ORDER_OPTIONS: DropdownOption<AgendaOrder>[] = AGENDA_ORDERS.map(o => ({ value: o.value, label: o.label, hint: o.hint }));
export const WINDOW_OPTIONS: DropdownOption<number>[] = STRIKE_WINDOWS.map(w => ({ value: w, label: `${w} each side`, hint: w === 30 ? 'The whole book' : `${w} strikes above spot and ${w} below` }));

/* ---- small parts ------------------------------------------------------------------ */

/** What a strike is: a named level, a shelf (a wall the Map does not name), a
    trapdoor (its hedging pushes the move along), or too thin to be any of them */
type Kind = 'named' | 'shelf' | 'trapdoor' | 'thin';
/* a wall % only on a wall: only a strike that absorbs (dealers long gamma) carries a size */
/* a strike with almost no net is thin, not a trapdoor: the tag follows the strike's own net sign */
/* one classifier: data/agenda.ts strikeKind (the Board's and Compare's watch-first read it too) */
const kindOf = (t: Target): Kind => strikeKind(t);
/** What a strike that is not a wall does, in the cell's few words */
const notWallWords = (t: Target) => (t.role === 'put wall' ? 'short gamma — a break can accelerate' : 'pushes the move along');

/** The beam in miniature: the silver share is the wall's size against the top wall on the chain; a trapdoor's is warm; a thin strike's is empty */
const HoldBeam = ({ t, w = 52, h = 6 }: { t: Target; w?: number | string; h?: number }) => {
  const kind = kindOf(t);
  return (
    <span className="relative block rounded-full bg-ink/[0.06] overflow-hidden shrink-0" style={{ width: w, height: h }} aria-hidden>
      {kind === 'trapdoor' ? (
        <span className="absolute inset-0 rounded-full" style={{ background: WARM, opacity: 0.35 }} />
      ) : (
        <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${(kind === 'thin' ? 0 : t.hold) * 100}%`, background: SILVER, opacity: 0.85, transitionTimingFunction: EASE }} />
      )}
    </span>
  );
};

/* every level the strike is, in the one order: supreme · call wall · put wall, then shelf or trapdoor */
/* The kind is kept on every row but wears its ink only where it carries weight — the first three, the three heaviest,
   the named levels (LoudStrikes). */
const LoudStrikes = createContext<ReadonlySet<number> | null>(null);
/* distance from spot in the shell's Ruler unit, handed down to the rows and both cards */
const FromSpot = createContext<(t: Target) => string>(t => `${t.distancePct < 0 ? '−' : '+'}${Math.abs(t.distancePct).toFixed(2)}%`);
const Tags = ({ t, yours }: { t: Target; yours?: string }) => {
  const loudSet = useContext(LoudStrikes);
  const loud = t.roles.length > 0 || t.rank <= 3 || !!loudSet?.has(t.strike);
  return (
  <>
    {t.roles.map(r => (
      <span key={r} className="text-t8 uppercase tracking-widest whitespace-nowrap" style={{ color: ROLE_INK[r] }} title={kindTip(r)}>
        {r}
      </span>
    ))}
    {!t.roles.length && kindOf(t) !== 'thin' && (
      <span
        className={`text-t8 uppercase tracking-widest whitespace-nowrap ${loud ? '' : 'opacity-60'}`}
        style={{ color: loud ? (t.isShelf ? 'rgb(var(--text-secondary))' : WARM) : 'rgb(var(--text-muted))' }}
        title={`${kindTip(t.isShelf ? 'shelf' : 'trapdoor')}${loud ? '' : ' — a light one: it is not among the strikes that carry the most here'}`}
        data-tag-loud={loud || undefined}
      >
        {t.isShelf ? 'shelf' : 'trapdoor'}
      </span>
    )}
    {t.pin && <span className="text-t8 uppercase tracking-widest text-textMuted">pin</span>}
    {yours && (
      <span className="text-t8 uppercase tracking-widest whitespace-nowrap" style={{ color: SILVER }} title={yours} data-yours>
        you
      </span>
    )}
  </>
  );
};

/* ---- the row's card ------------------------------------------------------------- */

const CARD_W = 300;
/** Where a card was asked for: the strike, the click's x, the row's edges */
interface CardAt {
  strike: number;
  x: number;
  rowTop: number;
  rowBottom: number;
}
const fmtContracts = (n: number) => Math.round(n).toLocaleString('en-US');

const CardLine = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-t10 text-textMuted leading-[17px] whitespace-nowrap">{label}</dt>
    <dd className="min-w-0 font-mono text-t11 tnum leading-[17px] text-textPrimary whitespace-nowrap truncate">{children}</dd>
  </>
);

/** The card: under the row when it fits, above it when it does not, kept on screen */
const RowCard = ({ t, at, inSession, onClose }: { t: Target; at: CardAt; inSession: boolean; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || CARD_W;
    const h = el.offsetHeight || 220;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, at.x - w / 2));
    const below = at.rowBottom + 6;
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, at.rowTop - h - 6);
    setPos({ left, top });
  }, [at]);
  const kind = kindOf(t);
  const dir = t.distancePct >= 0 ? 'above' : 'below';
  const fromSpot = useContext(FromSpot);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${fmtStrike(t.strike)} — the strike's card`}
      className="fixed z-[120] rounded-md border border-borderSubtle px-3 py-2.5 select-text"
      style={{ width: CARD_W, left: pos?.left ?? 0, top: pos?.top ?? 0, background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', opacity: pos ? 1 : 0, transition: 'opacity 160ms ease-out' }}
      onPointerDown={e => e.stopPropagation()}
      /* a typed dark glass portalled onto the page: its words are the dark set on either theme */
      data-theme="dark"
      data-chart-glass
      data-target-card-node={t.strike}
    >
      {/* THE HEAD: the strike, what it is, where it is */}
      <div className="flex items-center gap-2 h-5">
        <span className="font-mono text-t12 font-bold tnum text-textPrimary">{fmtStrike(t.strike)}</span>
        <Tags t={t} />
        <span className={`ml-auto font-mono text-t10 tnum ${t.distancePct >= 0 ? 'text-bull' : 'text-bear'}`}>
{fromSpot(t)}
        </span>
        <span className="text-t10 text-textMuted">{dir} spot</span>
        <button type="button" onClick={onClose} className="inline-flex items-center justify-center w-5 h-5 -mr-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" title="Close (Esc)" data-card-close>
          <X className="w-3 h-3" />
        </button>
      </div>
      <dl className="mt-1.5 grid gap-x-3" style={{ gridTemplateColumns: '84px minmax(0, 1fr)' }}>
        <CardLine label={t.horizon ? 'Reached' : inSession ? 'Reached' : 'Reached next'}>
          {reachWords(t)}
          {t.horizon && !t.today && !t.atPrice && <span className="text-textMuted"> {t.horizon}</span>}
          {t.today && !t.atPrice && <span className="text-textMuted"> · {pct(t.reach)} to touch again</span>}
          {t.closes > 0 && (
            <span className="text-textMuted">
              {' '}
              · <span title="Model weight for the close at this strike: a normal on 1σ to the close, pulled by the book — not a measured chance">close weight</span> <span className="text-textPrimary">{t.closes.toFixed(0)}%</span>
            </span>
          )}
        </CardLine>
        <CardLine label="Wall size">
          {kind === 'trapdoor' ? <span style={{ color: WARM }}>{notWallWords(t)}</span> : kind === 'thin' ? <span className="text-textMuted" title={GLOSSARY.thin}>{thinWords(t)}</span> : <span style={{ color: SILVER }}>{holdLabel(t.hold)}</span>}
        </CardLine>
        <CardLine label="If it breaks">
          {t.breakTo == null ? (
            <span className="text-textMuted" title={`Nothing past it on the strikes shown is big enough to slow a move. ${GLOSSARY.shelf}`}>no shelf behind it</span>
          ) : (
            <>
              runs to {fmtStrike(t.breakTo)}
              {t.breakFlow !== 0 && (
                <span style={{ color: pathLean(t.side, t.breakFlow) === 'along' ? WARM : SILVER }} title={pathFlowWords(t.side, t.breakFlow)}>
                  {' '}
                  · {fmtDollars(Math.abs(t.breakFlow))} {t.breakFlow > 0 ? 'buying' : 'selling'} · {pathLean(t.side, t.breakFlow) === 'along' ? 'pushes it along' : 'leans against it'}
                </span>
              )}
              {t.pocket && <span className="text-textMuted"> · empty</span>}
            </>
          )}
        </CardLine>
        <CardLine label="If it holds">{t.holdTo != null ? `back to ${fmtStrike(t.holdTo)}` : '—'}</CardLine>
        <CardLine label="Open interest">
          {fmtContracts(t.oi.calls)} <span className="text-textMuted">calls</span> · {fmtContracts(t.oi.puts)} <span className="text-textMuted">puts</span>
        </CardLine>
        <CardLine label={t.buildOvernight ? 'Built' : inSession ? 'Built today' : 'Built last'}>
          <span className={t.verdict === 'steady' ? 'text-textMuted' : ''}>{buildWords(t, inSession)}</span>
        </CardLine>
        {t.beside && <CardLine label="Beside it">{t.beside}</CardLine>}
      </dl>
      <div className="mt-2 pt-1.5 border-t border-ink/[0.06] text-t10 text-textMuted whitespace-nowrap truncate" data-card-driver>
        <span className="font-mono tnum text-textPrimary">#{t.rank}</span> {DRIVER_WORDS[t.driver]} · <span className="font-mono tnum text-textPrimary">{pct(t.reach)}</span> {t.today ? 'to touch again' : 'reached'} ×{' '}
        <span className="font-mono tnum text-textPrimary">{fmtDollars(t.stake)}</span> at stake
      </div>
    </div>,
    document.body
  );
};

/** The two actions; `icons` alone where a pane is a quarter of the screen (the tight density) */
const Actions = ({ t, armed, onChart, onAlert, icons = false }: { t: Target; armed: boolean; onChart: (t: Target) => void; onAlert: (t: Target) => void; icons?: boolean }) => (
  <span className="flex items-center justify-end gap-1" onClick={ev => ev.stopPropagation()}>
    <button
      onClick={() => onChart(t)}
      title="See this strike on the Map"
      className="inline-flex items-center gap-1 px-2 py-1 rounded font-mono text-t9 font-semibold uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
    >
      {!icons && 'Chart '}
      <ArrowUpRight className="w-3 h-3" />
    </button>
    {/* the bell jingles and wears the alert ink when set — an armed alert is a watch, not a live thing */}
    <button
      onClick={() => onAlert(t)}
      aria-pressed={armed}
      title={armed ? 'Alert set at this strike — click to remove it' : 'Alert me when price crosses this strike'}
      className="inline-flex items-center gap-1 px-2 py-1 rounded font-mono text-t9 font-semibold uppercase tracking-wider whitespace-nowrap hover:bg-ink/[0.06]"
      style={{ color: armed ? ALERT : undefined, transition: `color 0.25s ease ${armed ? '0.45s' : '0s'}, background-color 0.15s` }}
      data-row-alert={armed ? 'armed' : 'quiet'}
    >
      <JingleBell count={armed ? 1 : 0} className={`w-3 h-3 ${armed ? '' : 'text-textSecondary'}`} />
      {/* one line, always */}
      {!icons && <span className={`whitespace-nowrap ${armed ? '' : 'text-textSecondary'}`}>{armed ? 'Alert set' : 'Alert'}</span>}
    </button>
  </span>
);

const breakWords = (t: Target): ReactNode =>
  t.breakTo == null ? (
    <span className="text-textMuted" title={`Nothing past it on the strikes shown is big enough to slow a move. ${GLOSSARY.shelf}`}>no shelf behind it</span>
  ) : (
    <>
      <span className="text-textSecondary">
        {t.isShelf ? 'runs to' : 'through to'} <span className="text-textPrimary">{fmtStrike(t.breakTo)}</span>
        {t.pocket ? ' · empty' : ''}
      </span>
      {t.breakFlow !== 0 && (
        <span style={{ color: pathLean(t.side, t.breakFlow) === 'along' ? WARM : SILVER }} title={pathFlowWords(t.side, t.breakFlow)}>
          {' '}
          · {fmtDollars(t.breakFlow)} {t.breakFlow > 0 ? 'buying' : 'selling'} · {pathLean(t.side, t.breakFlow) === 'along' ? 'pushes it along' : 'leans against it'}
        </span>
      )}
    </>
  );

/** The Built column's head, short: "Built Oct 22", "Built overnight", "Built today" — the long words go in its tip */
const builtHead = (agenda: Agenda, inSession: boolean): string => {
  const t = agenda.targets[0];
  if (!t?.buildOvernight) return inSession ? 'Built today' : 'Built last session';
  const day = t.buildWhen.replace(/^in /, '').replace(/'s trading$/, '');
  return day.length <= 12 ? `Built ${day}` : 'Built overnight';
};

/* ---- the three ---------------------------------------------------------------- */

/** "At stake" and its "×", in words */
const stakeTip = (stake: number, per1: number): string =>
  `At stake: the dollars of dealer hedging that come into play if price reaches this strike — the hedging parked here plus what dealers must trade on the way through. ${
    per1 > 1 ? `The × figure is that against the dollars of stock it took to move the name 1% in ${recordDay().isToday ? "today's" : `${longDay(recordDay().date)}'s`} session (${fmtDollars(per1)}): ${(stake / per1).toFixed(1)}× means the hedging here is ${(stake / per1).toFixed(1)} times what a 1% move took.` : ''
  }`;

interface CardProps {
  t: Target;
  n: number;
  pick: boolean;
  kept: boolean;
  yours?: string;
  armed: boolean;
  inSession: boolean;
  marketPer1Pct: number;
  onPick: (strike: number) => void;
  onChart: (t: Target) => void;
  onAlert: (t: Target) => void;
  /** The badge as a number alone — a card a quarter of the box wide (the compact density) */
  brief?: boolean;
}

const Card = ({ t, n, pick, kept, yours, armed, inSession, marketPer1Pct, onPick, onChart, onAlert, brief = false }: CardProps) => {
  const material = t.verdict !== 'steady';
  const fromSpot = useContext(FromSpot);
  return (
    <div
      className={`relative rounded-md border p-3 flex flex-col cursor-pointer transition-colors ${kept ? 'border-silver/60 bg-silver/[0.04]' : pick ? 'border-supreme/40 bg-panel hover:border-supreme/60' : 'border-borderSubtle bg-panel hover:border-borderMuted'}`}
      style={{ minHeight: CARD_H }}
      data-target-card={t.strike}
      onClick={() => onPick(t.strike)}
    >
      <div className="flex items-center gap-2 h-[22px] min-w-0">
        <span className={`shrink-0 inline-flex items-center h-4 px-2 rounded-full font-mono text-t9 font-bold uppercase tracking-widest ${pick ? 'text-supreme bg-supreme/10 border border-supreme/30' : 'text-textSecondary bg-ink/[0.04] border border-borderSubtle'}`}>
          {pick && !brief ? `#${n} · watch first` : `#${n}`}
        </span>
        <span className={`font-mono text-t16 leading-none font-bold tnum ${kept ? 'text-silver' : 'text-textPrimary'}`}>{fmtStrike(t.strike)}</span>
        <Tags t={t} yours={yours} />
        <span className="ml-auto font-mono text-t10 tnum text-textSecondary whitespace-nowrap">
{fromSpot(t)}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between h-[14px] font-mono text-t9 uppercase tracking-widest text-textMuted">
        <span>
          Reached <span className="normal-case tracking-normal text-t11 text-textPrimary tnum" title={t.today ? `The session has already traded through ${fmtStrike(t.strike)}${t.today.tests != null ? ` — tested ${t.today.tests}×, held ${t.today.held}, broke ${t.today.broke} (the Map's "How the levels held")` : ''}; ${pct(t.reach)} to touch it again` : undefined}>{t.atPrice ? 'at price' : t.today ? 'today' : pct(t.reach)}</span>
        </span>
        <span>
          {kindOf(t) === 'named' || kindOf(t) === 'shelf' ? (
            <>
              Wall <span className="normal-case tracking-normal text-t11 tnum" style={{ color: SILVER }}>{holdShort(t.hold)}</span>
            </>
          ) : kindOf(t) === 'trapdoor' ? (
            <span style={{ color: WARM }}>{notWallWords(t)}</span>
          ) : (
            <span title={GLOSSARY.thin}>{thinWords(t)}</span>
          )}
        </span>
      </div>
      <div className="mt-1">
        <HoldBeam t={t} w="100%" h={8} />
      </div>
      <p className="mt-2 h-[15px] font-mono text-t10 tnum truncate">
        <span className="text-textMuted">if it {t.isShelf ? 'breaks' : 'goes'} · </span>
        {breakWords(t)}
      </p>
      {/* wraps rather than cuts: three facts on one 15px line ran out of card ("$176K at stake · (") */}
      <p className="mt-1 font-mono text-t10 leading-[15px] tnum flex flex-wrap items-center gap-x-3">
        <span className={material ? 'text-textPrimary' : 'text-textMuted'}>{buildWords(t, inSession)}</span>
        {/* the session's tests on their own line-piece */}
        {t.today?.tests ? <span className="text-textSecondary whitespace-nowrap">held {t.today.held}, broke {t.today.broke} today</span> : null}
        {t.closes > 0 && <span className="text-textSecondary" title="Model weight for the close at this strike: a normal on 1σ to the close, pulled by the book — not a measured chance">close weight {t.closes.toFixed(0)}%</span>}
        <span className="text-textSecondary cursor-help" title={stakeTip(t.stake, marketPer1Pct)}>
          {fmtDollars(t.stake)} at stake{t.stake / Math.max(1, marketPer1Pct) >= 0.05 ? ` · ${(t.stake / Math.max(1, marketPer1Pct)).toFixed(1)}× the 1% move` : ''}
        </span>
      </p>
      <div className="mt-auto flex items-center justify-end h-[22px] -mr-1">
        <Actions t={t} armed={armed} onChart={onChart} onAlert={onAlert} />
      </div>
    </div>
  );
};

/* ---- the controls, the box's one line ------------------------------------------------ */

interface ControlsProps {
  order: AgendaOrder;
  onOrder: (o: AgendaOrder) => void;
  window: StrikeWindow;
  onWindow: (w: StrikeWindow) => void;
  /** The page's names door — "+ Names N", up to four panes */
  names?: ReactNode;
  /** "14:35:10" — when the numbers were last read */
  updatedAt: string;
  /** Across every pane */
  strikes: number;
  /** False when each pane carries its own Ranked by and Strikes */
  lenses?: boolean;
}

/** Ranked by · Strikes · the names door · when the numbers were read — one line for every pane */
export const TargetsControls = ({ order, onOrder, window, onWindow, names, updatedAt, strikes, lenses = true }: ControlsProps) => (
  <div className="px-5 pb-2 flex items-center gap-2 flex-wrap" data-targets-controls>
    {lenses && (
      <>
        <DropdownSelect label="Ranked by" value={order} options={ORDER_OPTIONS} onChange={onOrder} title="The order of the list" testId="targets-order" />
        <DropdownSelect label="Strikes" value={window} options={WINDOW_OPTIONS} onChange={v => onWindow(v as StrikeWindow)} title="How many strikes around spot" testId="targets-strikes" />
      </>
    )}
    {names}
    <span className="ml-auto font-mono text-t9 uppercase tracking-widest text-textMuted whitespace-nowrap" data-targets-updated>
      {strikes} strikes · updated {updatedAt} · {cadenceWords()}
    </span>
  </div>
);

/* ---- one pane --------------------------------------------------------------------------- */

/** How much room a pane has: alone it is the whole board; beside one other it keeps the figures and drops the words;
    beside two or three it keeps the strike, the odds and the actions — and the podium is the one to watch first */
export type TargetsDensity = 'full' | 'compact' | 'tight';
export const densityFor = (panes: number): TargetsDensity => (panes <= 1 ? 'full' : panes === 2 ? 'compact' : 'tight');

/** The list's columns a density: the template, its floor, the cells a row spans */
const COLS: Record<TargetsDensity, { template: string; min: number; span: string }> = {
  /* # · strike · from spot · reached · today · net gamma · if it breaks · built · at stake · why · actions */
  full: { template: AGENDA_COLUMNS, min: AGENDA_MIN_W, span: 'col-span-11' },
  /* # · strike · from spot · reached · holds · at stake · actions */
  compact: { template: '32px 160px 64px 64px 104px 120px 120px', min: 740, span: 'col-span-7' },
  /* strike · reached · holds · actions */
  tight: { template: 'minmax(92px,128px) 48px 92px minmax(52px,1fr)', min: 316, span: 'col-span-4' },
};

interface Props {
  agenda: Agenda;
  ticker: string;
  clock: AheadClock;
  /** The pane's own line: the name chip, its Expiry card, the watch menu, the door off (RankedTargets) */
  head: ReactNode;
  density: TargetsDensity;
  yours?: ReadonlyMap<number, string>;
  armedAt: (strike: number) => boolean;
  onChart: (t: Target) => void;
  onAlert: (t: Target) => void;
  focus: number | null;
  onPick: (strike: number) => void;
}

const TargetsBoard = ({ agenda, ticker, clock, head, density, yours, armedAt, onChart, onAlert, focus, onPick }: Props) => {
  const [hover, setHover] = useState<number | null>(null);
  /* THE CARD: one open at a time; a click anywhere, a scroll or Esc closes it.
     The document hears the click first (capture), so the row's own handler
     runs after and can open the next one — or leave the same one closed. */
  const [card, setCard] = useState<CardAt | null>(null);
  const cardRef = useRef<CardAt | null>(null);
  cardRef.current = card;
  useEffect(() => {
    if (!card) return;
    const onClick = (e: MouseEvent) => {
      /* A click on a row is the row's to judge (toggle or move) — React flushes
         a close from here before the row's own handler runs, so closing here
         too made the same row read "no card" and reopen itself */
      if ((e.target as Element | null)?.closest?.('[data-target-card-node],[data-target-row]')) return;
      setCard(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCard(null);
    };
    const onScroll = () => setCard(null);
    document.addEventListener('click', onClick, true);
    globalThis.addEventListener('keydown', onKey, true);
    globalThis.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      globalThis.removeEventListener('keydown', onKey, true);
      globalThis.removeEventListener('scroll', onScroll, true);
    };
  }, [card]);
  const onRowClick = (t: Target) => (e: ReactMouseEvent<HTMLDivElement>) => {
    /* Which card was open, read before the pick — the focus store flushes a render inside it */
    const was = cardRef.current;
    onPick(t.strike);
    if (was && Math.abs(was.strike - t.strike) < 1e-9) {
      setCard(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setCard({ strike: t.strike, x: e.clientX, rowTop: r.top, rowBottom: r.bottom });
  };
  const cardTarget = card ? (agenda.targets.find(t => Math.abs(t.strike - card.strike) < 1e-9) ?? null) : null;
  /* THE PODIUM: the first three, side by side — in a tight pane the one to watch first alone, the other two in the list */
  /* The podium is the chosen order's first three, the list going on from #4; a tight pane shows the watch-first alone. */
  const podium = density === 'tight' ? agenda.first.slice(0, 1) : agenda.targets.slice(0, 3);
  const podiumSet = useMemo(() => new Set(podium.map(t => t.strike)), [podium]);
  const rest = useMemo(() => agenda.targets.filter(t => !podiumSet.has(t.strike)), [agenda.targets, podiumSet]);
  const maxStake = Math.max(1, ...agenda.targets.map(t => t.stake));
  /* the strikes whose kind is said loud: the three heaviest by net gamma (the first three in the order are loud anyway) */
  const loudSet = useMemo(() => new Set([...agenda.targets].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3).map(t => t.strike)), [agenda.targets]);
  const lead = agenda.first[0];
  /* the shell's ruler (data/distanceUnits.ts) — the Building ledger's and the Board's own */
  const unit = useNameUnit(ticker);
  const rev = useBookRev();
  const fromSpot = useMemo(() => {
    const scales = { atr: sessionAtr(bookCandles(ticker) ?? []), sigma: peekDaySigma(ticker) ?? daySigmaOfIv(agenda.spot, peekIv(ticker) ?? 0) };
    return (t: Target) => fmtDistance(t.strike - agenda.spot, agenda.spot, unit, scales);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, agenda.spot, unit, rev]);
  const reachedWord = agenda.horizon ? `reached ${agenda.horizon}` : clock.inSession ? 'reached by the close' : `reached ${aheadWord()}`;
  const cols = COLS[density];
  const full = density === 'full';
  const wide = density !== 'tight';
  const pad = wide ? 'px-5' : 'px-3';
  /* every head explains itself on hover, one plain sentence each */
  const headCell = (words: ReactNode, right = false, extra = '', tip?: string) => (
    <div className={`h-[14px] text-t9 uppercase tracking-widest text-textMuted ${right ? 'text-right' : ''} ${tip ? 'cursor-help' : ''} ${extra}`} title={tip}>
      {words}
    </div>
  );

  return (
    /* FIVE ROWS OF THE HOST'S SUBGRID — the head, the sentence, the podium, the list, the foot — so panes side by side
       share every row's height (RankedTargets; the row's card is a portal and takes no row) */
    <LoudStrikes.Provider value={loudSet}>
    <FromSpot.Provider value={fromSpot}>
    <section className="relative grid grid-rows-subgrid row-span-5 min-w-0" data-targets-board data-targets-density={density}>
      {/* THE PANE'S HEAD — its line (the chip, the expiry, the watch), and the four facts */}
      <div className={`${pad} pt-3 pb-2 flex items-start gap-x-6 gap-y-2 flex-wrap`}>
        <div className="flex items-center gap-2 flex-wrap">{head}</div>
        {/* beside other panes the facts take a row of their own — the same row in every pane, whatever its line holds */}
        <dl className={`flex flex-wrap gap-x-5 gap-y-2 ${full ? 'ml-auto' : 'basis-full'}`}>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The one strike to watch first: likely to be reached, with the most at stake">Watch first</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum whitespace-nowrap" style={{ color: lead?.roles[0] ? ROLE_INK[lead.roles[0]] : lead?.role ? ROLE_INK[lead.role] : 'rgb(var(--text-primary))' }} data-watch-first>
              {/* every level the strike is, in the one order (core/walls.ts levelRoles) */}
              {lead ? fmtStrike(lead.strike) : '—'} {lead && (lead.roles.length ? <span className="text-t9 uppercase tracking-widest">{lead.roles.join(' · ')}</span> : lead.role ? <span className="text-t9 uppercase tracking-widest">{lead.role}</span> : null)}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`The strike price is most likely to touch ${agenda.horizon ?? (clock.inSession ? 'by the close' : aheadWord())}, and the chance — strikes price is already on, and strikes today's session has already traded through, are left out (they are reached, not likely)`}>Most likely reached <span className="text-textMuted/70">· {clock.inSession ? 'not yet today' : aheadWord() === 'today' ? 'today' : `next session, ${longDay(sessionDay().next)}`}</span></dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap">{agenda.mostReached ? `${fmtStrike(agenda.mostReached.strike)} · ${pct(agenda.mostReached.reach)}` : '—'}</dd>
          </div>
          {/* the nearest wall on each side, both named */}
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The nearest wall price is likely to reach (a 15% chance or more) on each side of price — a named call or put wall or a shelf — with every level it is. The table below tags the same strikes">{agenda.wallsInReach ? 'Nearest walls in reach' : 'Walls in reach'}</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum whitespace-nowrap flex items-baseline gap-2" data-nearest-wall>
              {agenda.wallAbove || agenda.wallBelow ? (
                <>
                  {agenda.wallAbove && (
                    <span style={{ color: agenda.wallAbove.roles[0] ? ROLE_INK[agenda.wallAbove.roles[0]] : SILVER }} data-wall-above>
                      ↑ {targetName(agenda.wallAbove)}
                    </span>
                  )}
                  {agenda.wallBelow && (
                    <span style={{ color: agenda.wallBelow.roles[0] ? ROLE_INK[agenda.wallBelow.roles[0]] : SILVER }} data-wall-below>
                      ↓ {targetName(agenda.wallBelow)}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: SILVER }}>none in reach</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`The strike the model weights most for the close (a normal on 1σ to the close, pulled by the book — not a measured chance) — named only when one strike reaches 15%; under that the close is spread too thin to lean anywhere${agenda.closeTop ? ` (the likeliest, ${fmtStrike(agenda.closeTop.strike)}, is ${agenda.closeTop.odds.toFixed(0)}%)` : ''}`}>{/* the label says what the figure is; after the bell it is the next session's close */}{clock.inSession || agenda.horizon ? 'Likeliest close' : aheadWord() === 'today' ? 'Likeliest close today' : 'Likeliest next close'}</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${agenda.closesNear ? 'text-textPrimary' : 'text-textMuted'}`} data-close-lean>{closeLeanWords(agenda)}</dd>
          </div>
        </dl>
      </div>

      {/* THE SENTENCE */}
      {/* items-start: on a shared row beside taller sentences the WATCH word stays at the top, where every pane's is */}
      <div className={`${wide ? 'mx-5' : 'mx-3'} px-3 py-2 border-y border-borderSubtle/60 min-h-[34px] flex items-start gap-2 flex-wrap`} data-targets-sentence>
        <span className="font-mono text-t9 font-bold uppercase tracking-widest leading-[18px]" style={{ color: SUPREME }}>
          Watch
        </span>
        <span className="text-t12 leading-[18px] text-textSecondary">{agenda.sentence.replace(/^Watch /, '')}</span>
      </div>

      {/* THE PODIUM */}
      {/* the three cards under each other on a phone; across from 1280px beside one other pane; one card in a tight pane */}
      <div className={`${pad} pt-3 pb-3 grid gap-3 ${full ? 'grid-cols-1 sm:grid-cols-3' : density === 'compact' ? 'grid-cols-1 xl:grid-cols-3' : 'grid-cols-1'}`} data-targets-three>
        {podium.map((t, i) => (
          <Card
            key={t.strike}
            t={t}
            n={density === 'tight' ? 1 : t.rank}
            pick={!!lead && Math.abs(lead.strike - t.strike) < 1e-9}
            kept={focus != null && Math.abs(focus - t.strike) < 1e-9}
            yours={yours?.get(t.strike)}
            armed={armedAt(t.strike)}
            inSession={clock.inSession}
            marketPer1Pct={agenda.marketPer1Pct}
            onPick={onPick}
            onChart={onChart}
            onAlert={onAlert}
            brief={density === 'compact'}
          />
        ))}
      </div>

      {/* THE LIST — the columns a density keeps */}
      <div className={`${pad} pb-2 overflow-x-auto`} data-targets-rows onPointerLeave={() => setHover(null)}>
        <div className="grid items-center gap-x-3 gap-y-0" style={{ gridTemplateColumns: cols.template, minWidth: cols.min }}>
          {wide && headCell('#', false, '', 'Its place in the order: how likely price gets there times how much happens if it does')}
          {headCell('Strike', false, '', 'The option strike price, with its role: call wall (the most call hedging), put wall (the most put hedging — below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling, or it can act as a magnet), supreme (the most hedging of all), shelf (dealers long gamma: their hedging slows price, above or below) or trapdoor (dealers short gamma: their hedging speeds a move through it, above or below) — the Map\'s colours')}
          {wide && headCell('From spot', true, '', 'How far the strike is from the current price, in the Ruler at the top of the page ($, %, ATR or σ)')}
          {headCell(agenda.horizon ? `Reached ${agenda.horizon}` : clock.inSession ? 'Reached' : aheadWord() === 'today' ? 'Reached today' : 'Reached next', true, 'whitespace-nowrap', agenda.horizon ? `The chance price touches this strike ${agenda.horizon} — the Levels card reads that expiry, so the odds run on the implied move into it` : clock.inSession ? 'The chance price touches this strike before the close' : `The chance price touches this strike ${aheadWord() === 'today' ? "in today's session" : 'next session'}`)}
          {full && headCell('Today', false, 'whitespace-nowrap', recordDay().isToday && !recordDay().done ? "What today's session has already done at the strike: traded through it, and how often it held or broke (the Map's \"How the levels held\" count) — a dash where the session has not reached it" : recordDay().isToday ? `Today's session has closed — these targets are the next session's (${longDay(sessionDay().next)}); how today's levels held is on the Map` : 'The session has not opened yet — nothing has been reached today')}
          {headCell('Net gamma', true, '', "The net gamma at this strike on the contracts the Levels card reads, dollars per 1% move — positive (green): dealers long gamma, their hedging slows price here; negative (red): short gamma, their hedging speeds a move through. The bar: a wall's size against the biggest wall on this ticker (100%); empty on a trapdoor or a thin strike")}
          {full && headCell('If it breaks', false, '', 'Where price runs next if it gets through, and how much stock dealers must buy or sell on the way')}
          {/* one short head */}
          {full && headCell(builtHead(agenda, clock.inSession), false, 'whitespace-nowrap truncate', agenda.targets[0]?.buildOvernight ? `How much the wall at this strike grew (+) or shrank (−) ${agenda.targets[0].buildWhen} — the overnight open-interest count, the contracts the Levels card reads, each valued at its own gamma. The same figure as Building's CHANGE column` : 'Hedging added (building) or taken off (draining) at this strike, estimated from the day’s trades until the overnight count loads')}
          {wide && headCell('At stake', false, '', stakeTip(1, 0))}
          {full && headCell('Why it ranks', false, 'whitespace-nowrap truncate', 'Why it ranks here: the two numbers behind its place — the chance it is reached times what is at stake')}
          {headCell(wide ? 'Actions' : '', true, '', 'Open the strike on the Map, or set a price alert on it')}
          {rest.map(t => {
            const kept = focus != null && Math.abs(focus - t.strike) < 1e-9;
            const wash = kept || hover === t.strike ? 'bg-silver/[0.05]' : '';
            const material = t.verdict !== 'steady';
            return (
              <div
                key={t.strike}
                className={`grid grid-cols-subgrid ${cols.span} items-center border-t border-borderSubtle/40 rounded cursor-pointer ${wash}`}
                style={full ? { minHeight: ROW_H } : { height: ROW_H }}
                data-target-row={t.strike}
                onPointerEnter={() => setHover(t.strike)}
                onClick={onRowClick(t)}
                title="Click for its card"
              >
                {wide && <div className="font-mono text-t10 tnum text-textSecondary">#{t.rank}</div>}
                {/* on a phone the tags wrap under the strike */}
                <div className={`flex items-center gap-1.5 px-2 font-mono text-t11 tnum overflow-hidden ${wide ? 'whitespace-nowrap' : 'flex-wrap gap-y-0 leading-[12px] content-center'} ${kept ? 'text-silver font-bold shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)] h-full' : 'text-textPrimary'}`}>
                  <span className={wide ? '' : 'w-full'}>{fmtStrike(t.strike)}</span>
                  <Tags t={t} yours={yours?.get(t.strike)} />
                </div>
                {wide && (
                  <div className="text-right font-mono text-t11 tnum text-textPrimary">
{fromSpot(t)}
                  </div>
                )}
                <div className="text-right font-mono text-t11 tnum text-textPrimary" title={t.atPrice ? `Price is on ${fmtStrike(t.strike)} already — ${pct(t.reach)} by the odds, left out of "Most likely reached"` : t.today ? `Today's session has already traded through ${fmtStrike(t.strike)}${t.today.tests != null ? ` — ${todayWords(t.today)}, the Map's "How the levels held" count` : ''}; ${pct(t.reach)} to touch it again by the close. Left out of "Most likely reached"` : undefined}>{t.atPrice ? 'at price' : full || !t.today ? pct(t.reach) : 'today'}</div>
                {full && (
                  <div className="font-mono text-t10 leading-[13px] tnum line-clamp-2 text-textSecondary" data-target-today>
                    {t.today ? (t.today.tests ? `held ${t.today.held} · broke ${t.today.broke}` : 'traded through') : <span className="text-textMuted">—</span>}
                  </div>
                )}
                {/* the column says something on every row: the strike's own net gamma, signed, the wall's share of the top wall as its bar */}
                <div className="flex items-center justify-end gap-1.5 whitespace-nowrap font-mono text-t11 tnum font-semibold" style={{ color: kindOf(t) === 'thin' ? 'rgb(var(--text-muted))' : t.net > 0 ? LONG_GAMMA : SHORT_GAMMA }} title={t.isShelf ? `${holdShort(t.hold)} of the top wall` : undefined} data-target-net={Math.round(t.net)}>
                  {t.net > 0 ? '+' : t.net < 0 ? '−' : ''}
                  {fmtDollars(Math.abs(t.net))}
                  {wide && <HoldBeam t={t} w={28} />}
                </div>
                {full && <div className="font-mono text-t10 leading-[13px] tnum line-clamp-2">{breakWords(t)}</div>}
                {full && <div className={`font-mono text-t10 leading-[13px] tnum line-clamp-2 ${material ? 'text-textPrimary' : 'text-textMuted'}`}>{buildWords(t, clock.inSession)}</div>}
                {wide && (
                  <div className="relative h-full flex items-center">
                    <span className="absolute inset-y-[12px] left-0 right-14 rounded-full bg-ink/[0.04]" />
                    <span
                      className="absolute inset-y-[12px] left-0 rounded-full transition-[width] duration-700"
                      style={{ width: `calc(${(t.stake / maxStake) * 100}% - ${(t.stake / maxStake) * 56}px)`, background: t.isWall ? heatLaneColor(-t.stake, maxStake, 'thermal-yellow', 0.35) : heatLaneColor(t.stake, maxStake, 'thermal-yellow', 0.35), transitionTimingFunction: EASE }}
                    />
                    <span className="absolute right-0 font-mono text-t10 tnum text-textPrimary">{fmtDollars(t.stake)}</span>
                  </div>
                )}
                {/* the whole reason, wrapped — the row grows to hold it */}
                {full && <div className="text-t10 leading-[13px] text-textMuted py-1 break-words">{t.why}</div>}
                <Actions t={t} armed={armedAt(t.strike)} onChart={onChart} onAlert={onAlert} icons={!wide} />
              </div>
            );
          })}
        </div>
      </div>
      {card && cardTarget && <RowCard t={cardTarget} at={card} inSession={clock.inSession} onClose={() => setCard(null)} />}
      <p className={`${pad} pb-4 pt-2 text-t12 leading-relaxed text-textSecondary`} data-targets-foot>
        {lead ? (lead.atPrice ? `Price is on ${fmtStrike(lead.strike)} now. ` : lead.today ? `${fmtStrike(lead.strike)} is ${todayWords(lead.today)}. ` : `${fmtStrike(lead.strike)} is ${reachedWord} ${pct(lead.reach)} of the time. `) : ''}
        {agenda.nearestWall ? `${agenda.wallsInReach === 1 ? 'The only wall in reach is' : 'The nearest wall in reach is'} ${targetName(agenda.nearestWall)}. ` : ''}
        {agenda.closesNear ? `The close leans to ${fmtStrike(agenda.closesNear.strike)} at ${agenda.closesNear.odds.toFixed(0)}%.` : agenda.closeTop ? 'The close has no clear lean — no single strike is likely enough.' : ''}
      </p>
    </section>
    </FromSpot.Provider>
    </LoudStrikes.Provider>
  );
};

export default TargetsBoard;
