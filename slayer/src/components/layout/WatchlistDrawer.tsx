/* The shell's one watchlist of names in reader-named sections (data/nameWatch.ts): mark, price, day change and the nearest level
   per row; a press makes it the terminal's name. Contract lists stay in their own rooms. Kept locally and carried by the account. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Eye, Flag, FolderPlus, MoreHorizontal, Plus, X } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { useWatch } from '../../context/WatchContext';
import { useTracker } from '../../context/TrackerContext';
import { useWatchlist } from '../../data/watchlist';
import { peekThetaPrice, thetaMove, useThetaPrices, useThetaStatus } from '../../data/thetaQuote';
import { asOfText } from '../ui/states';
import { OfflineLine, useUwOnlyRoute } from './NavQuote';
import { peekQuote, sessionPrice, useDayMoves } from '../../data/liveQuote';
import { peekEntry, useBookRev } from '../../data/uwBook';
import {
  MAX_NAMES, MAX_SECTIONS, addSection, closeWatchlist, moveName, nudgeName, removeSection, renameSection, restoreName, restoreSection, setNameFlag,
  unwatchName, useNameWatch, useWatchlistOpen, watchName, type WatchSection, type WatchedName,
} from '../../data/nameWatch';
import CompanyLogo from '../ui/CompanyLogo';
import { scopeWalls } from '../../data/book/levels';
import { levelsForName } from '../../data/levelsScope';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import TickerLookup from '../ui/TickerLookup';

/** The Map's default window is not read here. A wall is shown only when that name's live book is already in. */
const usd = (v: number) => `$${v.toFixed(2)}`;
const pctSigned = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
const fmtLevel = (v: number) => (!Number.isFinite(v) ? '—' : v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
/* a section or row grows in and folds away (height and opacity on the drawer's curve); `layout` lets neighbours glide */
const GROW_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
const grow = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' as const },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.28, ease: GROW_EASE },
};

interface NameRead {
  spot: number | null;
  change: number | null;
  /** The price is the terminal's this session; false: the last one it gave (stamped `at`) */
  live: boolean;
  at: number | null;
  /** The nearest of the call wall and the put wall on the live book, and how far in percent of price. Null until that book is in. */
  near: { word: string; at: number; pct: number } | null;
}

/** The price and the move from the last regular close off the ThetaData terminal; with the terminal down, the last
    reading it gave, stamped. A wall only when this name's book is already live (Unusual Whales). */
function readName(symbol: string, uwOnly: boolean): NameRead {
  /* a page that may not ask the terminal for prices reads the vendor's quote (data/theta.ts) */
  const q = uwOnly ? peekQuote(symbol) : null;
  const held = uwOnly ? null : peekThetaPrice(symbol);
  const spot = uwOnly ? sessionPrice(q) : held ? held.value.price : null;
  const change = uwOnly ? (q ? (q.phase === 'regular' ? q.changePct : q.extPct) : null) : thetaMove(held?.value)?.pct ?? null;
  const book = peekEntry(symbol);
  let near: NameRead['near'] = null;
  const walls = spot != null && spot > 0 && book?.status === 'live' ? scopeWalls(symbol, levelsForName(symbol)) : null;
  if (spot != null && spot > 0 && walls) {
    /* the walls Pinpoint prints for this name's levels scope (core/walls.ts, on the live chain: settled dates off) */
    const marks = [
      walls.callWall != null ? { word: 'call wall', at: walls.callWall } : null,
      walls.putWall != null ? { word: 'put wall', at: walls.putWall } : null,
    ].filter((m): m is { word: string; at: number } => !!m && m.at > 0);
    if (marks.length) {
      const n = marks.reduce((a, b) => (Math.abs(b.at - spot) < Math.abs(a.at - spot) ? b : a));
      near = { ...n, pct: ((n.at - spot) / spot) * 100 };
    }
  }
  return { spot, change: change != null && Number.isFinite(change) ? change : null, near, live: uwOnly ? !!q : !!held?.live, at: held && !held.live ? held.value.at : null };
}

const IconButton = ({ onClick, label, title, pressed, children, testId }: { onClick: () => void; label: string; title?: string; pressed?: boolean; children: ReactNode; testId?: string }) => (
  <button
    type="button"
    onClick={e => {
      e.stopPropagation();
      onClick();
    }}
    aria-label={label}
    title={title ?? label}
    aria-pressed={pressed}
    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md border border-transparent transition-colors ${pressed ? 'text-silver' : 'text-textMuted hover:text-textPrimary'} hover:border-borderSubtle hover:bg-ink/[0.04]`}
    data-watch-action={testId}
  >
    {children}
  </button>
);

/** One name's row */
const NameRow = ({
  n, section, sections, on, read, onPick, onTake, links,
}: {
  n: WatchedName;
  section: WatchSection;
  sections: WatchSection[];
  on: boolean;
  read: NameRead;
  onPick: (symbol: string) => void;
  onTake: () => void;
  links: { label: string; to: string }[];
}) => {
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  const index = section.names.indexOf(n);
  const sectionOptions: DropdownOption<string>[] = sections.map(s => ({ value: s.id, label: s.name, hint: `${s.names.length} name${s.names.length === 1 ? '' : 's'}` }));
  const { spot, change, near } = read;
  return (
    <motion.li
      layout
      initial={grow.initial}
      animate={grow.animate}
      exit={grow.exit}
      transition={grow.transition}
      style={{ overflow: 'hidden' }}
      className={`group rounded-md border ${on ? 'border-silver/50 bg-ink/[0.035]' : 'border-transparent hover:bg-ink/[0.03]'} transition-colors`}
      data-watch-name={n.symbol}
      data-on={on || undefined}
    >
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          onClick={() => onPick(n.symbol)}
          className="min-w-0 flex-1 flex items-center gap-2 pl-2 py-1.5 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-silver/60"
          aria-label={`${n.symbol}${spot != null ? ` at ${usd(spot)}` : ''}${change != null ? `, ${pctSigned(change)} today` : ''} — open it on Terrain`}
          data-watch-pick={n.symbol}
        >
          <CompanyLogo ticker={n.symbol} size={16} />
          <span className="min-w-0 flex flex-col leading-tight">
            <span className="flex items-center gap-1.5">
              <span className={`font-mono text-t12 font-bold ${on ? 'text-silver' : 'text-textPrimary'}`}>{n.symbol}</span>
              {n.flagged && <Flag className="w-3 h-3 text-silver" fill="currentColor" aria-label="flagged" />}
            </span>
            <span className="font-mono text-t9 text-textMuted truncate" data-watch-near>
              {near ? (
                <>
                  {near.word} {fmtLevel(near.at)} <span className="tnum">· {pctSigned(near.pct)}</span>
                </>
              ) : null}
            </span>
          </span>
          <span className="ml-auto flex flex-col items-end leading-tight font-mono tnum">
            <span className={`text-t11 ${read.live ? 'text-textPrimary' : 'text-textSecondary'}`} title={read.at ? `ThetaData · ${asOfText(read.at)}` : undefined}>{spot != null ? usd(spot) : '—'}</span>
            {change != null && <span className={`text-t10 ${change >= 0 ? 'text-bull' : 'text-bear'}`}>{pctSigned(change)}</span>}
          </span>
        </button>
        <span className="flex items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <IconButton onClick={() => setNameFlag(n.symbol, !n.flagged)} pressed={n.flagged} label={n.flagged ? `Take the flag off ${n.symbol}` : `Flag ${n.symbol}`} testId="flag">
            <Flag className="w-3 h-3" fill={n.flagged ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton onClick={() => setMore(v => !v)} pressed={more} label={`Move ${n.symbol} — its place and its section`} title="Move" testId="more">
            <MoreHorizontal className="w-3 h-3" />
          </IconButton>
          <IconButton onClick={onTake} label={`Take ${n.symbol} off the watchlist`} title="Take it off" testId="remove">
            <X className="w-3 h-3" />
          </IconButton>
        </span>
      </div>
      {more && (
        <div className="flex items-center gap-1 pl-8 pr-1.5 pb-1.5 font-mono text-t9 text-textMuted" data-watch-move={n.symbol}>
          <IconButton onClick={() => nudgeName(n.symbol, -1)} label={`Move ${n.symbol} up`} testId="up">
            <ArrowUp className={`w-3 h-3 ${index <= 0 ? 'opacity-30' : ''}`} />
          </IconButton>
          <IconButton onClick={() => nudgeName(n.symbol, 1)} label={`Move ${n.symbol} down`} testId="down">
            <ArrowDown className={`w-3 h-3 ${index >= section.names.length - 1 ? 'opacity-30' : ''}`} />
          </IconButton>
          {sections.length > 1 ? (
            <span className="ml-1">
              <DropdownSelect label="In" value={section.id} options={sectionOptions} onChange={id => moveName(n.symbol, id)} />
            </span>
          ) : (
            <span className="ml-1">One section so far — a new one at the foot of the list takes names too</span>
          )}
        </div>
      )}
      {links.length > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap pl-8 pr-1.5 pb-1.5 font-mono text-t9 uppercase tracking-wider">
          {links.map(l => (
            <button
              key={l.to}
              type="button"
              onClick={() => {
                if (!on) onPick(n.symbol);
                navigate(l.to);
                closeWatchlist();
              }}
              className="text-textSecondary hover:text-textPrimary underline decoration-borderMuted underline-offset-2"
              data-watch-link={l.to}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </motion.li>
  );
};

/** A section head: its name (press to rename), count, its own add door, and removal. */
const SectionHead = ({ s, removable, adding, onAdd, onRemove }: { s: WatchSection; removable: boolean; adding: boolean; onAdd: () => void; onRemove: () => void }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.name);
  return (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1" data-watch-section={s.id}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={32}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            renameSection(s.id, draft);
            setEditing(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(s.name);
              setEditing(false);
            }
          }}
          aria-label="The section's name"
          className="h-6 w-40 px-1.5 rounded border border-borderMuted bg-transparent text-t12 text-textPrimary outline-none focus:border-silver/60"
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} title="Rename the section" className="text-t12 font-semibold text-textPrimary hover:text-silver transition-colors">
          {s.name}
        </button>
      )}
      <span className="font-mono text-t10 tnum text-textSecondary">{s.names.length}</span>
      <span className="ml-auto flex items-center">
        <IconButton onClick={onAdd} pressed={adding} label={`Add a name to ${s.name}`} title={`Add a name to ${s.name}`} testId="section-add">
          <Plus className="w-3 h-3" />
        </IconButton>
        {removable && (
          <IconButton onClick={onRemove} label={`Take the section ${s.name} off`} title="Take the section off" testId="section-remove">
            <X className="w-3 h-3" />
          </IconButton>
        )}
      </span>
    </div>
  );
};

const Empty = ({ children }: { children: ReactNode }) => (
  <div className="mx-2 mt-3 rounded-md border border-dashed border-borderSubtle/70 px-4 py-5 flex flex-col items-center gap-2 text-center">
    <Eye className="w-4 h-4 text-textMuted" strokeWidth={1.5} />
    <p className="text-t11 leading-snug text-textMuted max-w-[280px]">{children}</p>
  </div>
);

/* ---- the drawer ------------------------------------------------------------------------ */

const WatchlistDrawer = () => {
  const open = useWatchlistOpen();
  const list = useNameWatch();
  const { activeTicker, changeTicker } = useTicker();
  const [only, setOnly] = useState<'all' | 'flagged'>('all');
  const [adding, setAdding] = useState(false);
  const [into, setInto] = useState<string>('');
  /** The section whose own "+" is open — its search box sits right under its head */
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [said, setSaid] = useState<{ words: string; undo?: () => void } | null>(null);
  /* a word said about the last change is for that visit to the list */
  useEffect(() => {
    if (!open) {
      setSaid(null);
      setAdding(false);
      setAddingIn(null);
    }
  }, [open]);

  /* Esc — after any layer inside it (a menu) had its say, before the takeovers behind (the alerts drawer's rule) */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeWatchlist();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const symbols = list.sections.flatMap(s => s.names.map(n => n.symbol));
  /* the names' real-time prices while the drawer is open */
  const uwOnly = useUwOnlyRoute();
  const priceRev = useThetaPrices(open && !uwOnly ? symbols : []);
  const uwMoves = useDayMoves(open && uwOnly ? symbols : []);
  const thetaNow = useThetaStatus();
  const theta = uwOnly ? 'up' : thetaNow;
  const bookRev = useBookRev();
  const reads = useMemo(
    () => (open ? new Map(symbols.map(sym => [sym, readName(sym, uwOnly)] as const)) : new Map<string, NameRead>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, uwOnly, priceRev, uwMoves, bookRev, symbols.join(',')],
  );

  /* the contract lists, by name — the row links to the ones that hold something */
  const weigher = useWatchlist();
  const { watched } = useWatch();
  const { trackedSetups } = useTracker();
  const linksFor = (symbol: string) => {
    const out: { label: string; to: string }[] = [];
    const w = weigher.filter(c => c.ticker === symbol).length;
    const b = watched.filter(x => x.ticker === symbol).length;
    const t = trackedSetups.filter(x => x.ticker === symbol).length;
    if (w) out.push({ label: `${w} in the Weigher`, to: '/weigher' });
    if (b) out.push({ label: `${b} bookmarked in Trace`, to: '/trace/watchers' });
    if (t) out.push({ label: `${t} on Compass's Tracker`, to: '/compass/tracker' });
    return out;
  };

  const reduce = useReducedMotion();
  const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
  const glideIn = { x: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.5, ease: EASE } };
  const glideOut = { x: 48, opacity: 0, transition: { duration: reduce ? 0 : 0.36, ease: EASE } };

  const total = symbols.length;
  const flagged = list.sections.reduce((n, s) => n + s.names.filter(x => x.flagged).length, 0);
  const navigate = useNavigate();
  const location = useLocation();
  const pick = (symbol: string) => {
    if (!symbol) return;
    if (symbol !== activeTicker) changeTicker(symbol);
    navigate('/terrain', { state: { chart: { ticker: symbol }, wayBack: location.pathname } });
    closeWatchlist();
  };
  const addInto = (symbol: string, sectionId: string | undefined) => {
    const sym = symbol.toUpperCase();
    const r = watchName(sym, sectionId);
    const section = list.sections.find(s => s.id === sectionId);
    setSaid({
      words:
        r === 'added' ? `${sym} is on the list${section && list.sections.length > 1 ? `, in ${section.name}` : ''}`
        : r === 'already' ? `${sym} is on the list already`
        : r === 'full' ? `The list holds ${MAX_NAMES} names`
        : 'That is not a name',
      undo: r === 'added' ? () => { unwatchName(sym); setSaid(null); } : undefined,
    });
    if (r === 'added') {
      setAdding(false);
      setAddingIn(null);
    }
  };
  const add = (symbol: string) => addInto(symbol, into || undefined);
  const take = (symbol: string) => {
    const back = unwatchName(symbol);
    if (back) setSaid({ words: `${symbol} is off the list`, undo: () => { restoreName(back); setSaid(null); } });
  };
  const takeSection = (s: WatchSection) => {
    const back = removeSection(s.id);
    if (back) setSaid({ words: `The section ${s.name} is off${s.names.length ? `, ${s.names.length} name${s.names.length === 1 ? '' : 's'} with it` : ''}`, undo: () => { restoreSection(back); setSaid(null); } });
  };
  const newSection = () => {
    if (!addSection('')) setSaid({ words: `${MAX_SECTIONS} sections is the most` });
  };

  const sectionOptions: DropdownOption<string>[] = list.sections.map(s => ({ value: s.id, label: s.name }));

  return (
    <AnimatePresence>
      {open && <div key="scrim" className="fixed inset-0 z-[87]" onClick={closeWatchlist} aria-hidden data-watchlist-scrim />}
      {open && (
        <motion.aside
          key="drawer"
          initial={{ x: 48, opacity: 0 }}
          animate={glideIn}
          exit={glideOut}
          className="fixed top-0 right-0 bottom-0 z-[88] w-[400px] max-w-[92vw] border-l border-borderMuted bg-panel/75 backdrop-blur-md backdrop-saturate-150 flex flex-col shadow-[-16px_0_48px_rgba(0,0,0,0.45)]"
          aria-label="Watchlist"
          data-watchlist-drawer
        >
          {/* THE HEAD — the house head: the icon in its 24px chip, the name, the facts */}
          <div className="h-12 shrink-0 flex items-center gap-2.5 px-3.5 border-b border-borderSubtle/70">
            <span className="w-6 h-6 rounded-md border border-borderSubtle bg-ink/[0.03] flex items-center justify-center shrink-0" aria-hidden>
              <Eye className="w-3.5 h-3.5 text-textSecondary" strokeWidth={1.75} />
            </span>
            <span className="text-t14 font-semibold text-textPrimary">Watchlist</span>
            <span className="font-mono text-t10 tnum text-textMuted" data-watchlist-facts>
              <span className="text-textSecondary">{total}</span> {total === 1 ? 'name' : 'names'} · <span className={flagged ? 'text-textSecondary' : ''}>{flagged}</span> flagged
            </span>
            <button onClick={closeWatchlist} aria-label="Close the watchlist" title="Close (Esc)" className="ml-auto shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-watchlist-close>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* what is shown, and the door to add a name */}
          <div className="shrink-0 flex items-center gap-2 px-3.5 py-2 border-b border-borderSubtle/60">
            <DropdownSelect<'all' | 'flagged'>
              label="Show"
              value={only}
              options={[
                { value: 'all', label: 'Every name' },
                { value: 'flagged', label: 'Flagged', hint: `${flagged} flagged` },
              ]}
              onChange={setOnly}
            />
            <button
              type="button"
              onClick={() => setAdding(v => !v)}
              aria-expanded={adding}
              className={`ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border font-mono text-t9 uppercase tracking-wider transition-colors ${adding ? 'border-silver/50 text-textPrimary' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted'}`}
              data-watchlist-add
            >
              <Plus className="w-3 h-3" /> Add a name
            </button>
          </div>
          {theta === 'down' && (
            <div className="shrink-0 px-3.5 py-1.5 border-b border-borderSubtle/60">
              <OfflineLine asOf={null} />
              <p className="mt-0.5 text-t10 text-textMuted">Prices are the last the terminal gave, each stamped on hover.</p>
            </div>
          )}
          {adding && (
            <div className="shrink-0 px-3.5 py-2 border-b border-borderSubtle/60 flex flex-col gap-2" data-watchlist-adding>
              {list.sections.length > 1 && <DropdownSelect label="Into" value={into || list.sections[0].id} options={sectionOptions} onChange={setInto} />}
              <div className="rounded-md border border-borderSubtle bg-panel">
                <TickerLookup onPick={add} limit={8} />
              </div>
            </div>
          )}
          {said && (
            <p className="shrink-0 flex items-center gap-2 px-3.5 py-1.5 font-mono text-t9 text-textMuted border-b border-borderSubtle/60" role="status" data-watchlist-said>
              {said.words}
              {said.undo && (
                <button type="button" onClick={said.undo} className="ml-auto uppercase tracking-wider text-textSecondary hover:text-textPrimary underline decoration-borderMuted underline-offset-2" data-watchlist-undo>
                  Put it back
                </button>
              )}
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-4" data-watchlist-body>
            {total === 0 && (
              <Empty>
                No names yet. Add one with the door above, or a section's own +. A name's row carries its price, the day's change and the nearest wall or
                flip on its book; a press makes it the terminal's name.
              </Empty>
            )}
            {/* every section is drawn, empty or not, so a new section visibly appears */}
            <AnimatePresence initial={false}>
              {list.sections.map(s => {
                const shown = only === 'flagged' ? s.names.filter(n => n.flagged) : s.names;
                return (
                  <motion.section key={s.id} aria-label={s.name} layout initial={grow.initial} animate={grow.animate} exit={grow.exit} transition={grow.transition} style={{ overflow: 'hidden' }}>
                    <SectionHead s={s} removable={list.sections.length > 1} adding={addingIn === s.id} onAdd={() => setAddingIn(v => (v === s.id ? null : s.id))} onRemove={() => takeSection(s)} />
                    {addingIn === s.id && (
                      <div className="mx-2 mb-1.5 rounded-md border border-silver/40 bg-panel" data-watch-section-adding={s.id}>
                        <TickerLookup onPick={sym => addInto(sym, s.id)} limit={8} />
                      </div>
                    )}
                    {shown.length === 0 ? (
                      only === 'flagged' ? (
                        <p className="px-2 py-1.5 font-mono text-t9 text-textMuted">Nothing flagged here</p>
                      ) : addingIn !== s.id ? (
                        <button type="button" onClick={() => setAddingIn(s.id)} className="px-2 py-1.5 font-mono text-t9 text-textMuted hover:text-textPrimary transition-colors" data-watch-section-empty={s.id}>
                          Nothing here yet — add a name
                        </button>
                      ) : null
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        <AnimatePresence initial={false}>
                        {shown.map(n => (
                          <NameRow
                            key={n.symbol}
                            n={n}
                            section={s}
                            sections={list.sections}
                            on={n.symbol === activeTicker}
                            read={reads.get(n.symbol) ?? { spot: null, change: null, near: null, live: false, at: null }}
                            onPick={pick}
                            onTake={() => take(n.symbol)}
                            links={linksFor(n.symbol)}
                          />
                        ))}
                        </AnimatePresence>
                      </ul>
                    )}
                  </motion.section>
                );
              })}
            </AnimatePresence>
            <button type="button" onClick={newSection} className="mt-3 mx-2 inline-flex items-center gap-1.5 font-mono text-t9 uppercase tracking-wider text-textMuted hover:text-textPrimary transition-colors" data-watchlist-new-section>
              <FolderPlus className="w-3.5 h-3.5" /> New section
            </button>
          </div>

          <p className="shrink-0 px-3.5 py-2 border-t border-borderSubtle/70 font-mono text-t9 leading-snug text-textMuted">
            Names, not contracts — the Weigher keeps the contracts. Kept on this machine and carried by your account.
          </p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default WatchlistDrawer;
