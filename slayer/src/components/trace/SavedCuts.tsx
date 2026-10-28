/*
  SAVED CUTS — Save, and the chips that open a saved cut. Every Trace
  surface whose cut can be written as a query string wears this same one.

  The control owns the words and the wiring; the page owns only the two
  things that are actually its own — what its cut says as a query string, and
  what to do when one is opened.
*/

import { useEffect, useRef, useState } from 'react';
import { Check, MoreHorizontal, Save, Trash2, X } from 'lucide-react';
import type { ViewStore } from '../../data/savedViews';
import { undoable } from '../ui/undo';

const BTN =
  'slayer-chip px-2';

export interface SavedCutsProps {
  store: ViewStore;
  /** This surface's cut, as a query string without the leading '?' */
  query: string;
  /** Open a saved cut — the page decides what that means for its own state */
  onOpen: (query: string) => void;
  /** What one of these is called here: "screen", "cut", "view" */
  noun: string;
  /** A data-* prefix for probes */
  testId: string;
  /** Said back to the reader — rendered by the page, beside its sentence */
  onSay: (said: string) => void;
}

/** The three buttons. They belong on the controls line. `compact` folds them into one "⋯" menu for a line that has
    no room for three more doors (Intervals at 1440, 2026-10-22: the Columns card wrapped onto a row of its own). */
export const SavedCutsControl = ({ store, query, noun, testId, onSay, open, onToggleOpen, compact = false }: SavedCutsProps & { open: boolean; onToggleOpen: () => void; compact?: boolean }) => {
  const views = store.useViews();
  const [naming, setNaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);
  const save = () => {
    if (!name.trim()) {
      onSay('That needs a name.');
      return;
    }
    /* Echo what was SAVED, not what was typed. The store caps a name at forty characters. */
    const saved = store.saveView(name.trim(), query);
    onSay(saved ? `Saved as "${saved.name}".` : 'That needs a name.');
    setNaming(false);
  };
  const ITEM = 'w-full h-8 px-2.5 inline-flex items-center gap-2 rounded text-left text-[11px] text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05] transition-colors';
  if (compact && !naming) {
    return (
      <span ref={menuRef} className="relative inline-flex" data-cut-doors data-cut-doors-compact>
        <button type="button" onClick={() => setMenu(v => !v)} aria-haspopup="menu" aria-expanded={menu} title={`Save or open a saved ${noun}`} aria-label={`Save this ${noun}`} className={BTN} data-cuts-menu={testId}>
          <MoreHorizontal className="w-3.5 h-3.5" aria-hidden />
          {views.length > 0 && <span className="font-mono tnum">{views.length}</span>}
        </button>
        {menu && (
          <span role="menu" className="absolute left-0 top-full mt-1 z-40 w-[176px] p-1 flex flex-col rounded-md border border-borderSubtle bg-panel shadow-lg shadow-black/30">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setName(''); setNaming(true); }} className={ITEM} data-cuts-save={testId}>
              <Save className="w-3 h-3" aria-hidden /> Save as…
            </button>
            {views.length > 0 && (
              <button type="button" role="menuitem" onClick={() => { setMenu(false); onToggleOpen(); }} className={ITEM} data-cuts-open={testId}>
                <span className="w-3 text-center font-mono tnum">{views.length}</span> {open ? 'Hide saved' : 'Show saved'}
              </button>
            )}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" data-cut-doors>
      {/* AN INLINE NAME, NOT THE BROWSER'S PROMPT: Save opens a field in its place — Enter keeps the cut under that
          name, Esc or the × lets it go */}
      {naming ? (
        <span className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md border border-borderMuted bg-ink/[0.03]">
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value.slice(0, 40))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setNaming(false);
              }
            }}
            placeholder={`Name this ${noun}`}
            aria-label={`Name this ${noun}`}
            className="w-[128px] bg-transparent text-[11px] text-textPrimary placeholder:text-textMuted focus:outline-none"
            data-cuts-name={testId}
          />
          <button type="button" onClick={save} aria-label={`Save this ${noun}`} className="p-1 rounded text-textSecondary hover:text-textPrimary">
            <Check className="w-3 h-3" aria-hidden />
          </button>
          <button type="button" onClick={() => setNaming(false)} aria-label="Cancel" className="p-1 rounded text-textMuted hover:text-textPrimary">
            <X className="w-3 h-3" aria-hidden />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setName('');
            setNaming(true);
          }}
          title={`Save this ${noun} by name`}
          aria-label={`Save this ${noun}`}
          className={BTN}
          data-cuts-save={testId}
        >
          <Save className="w-3 h-3" aria-hidden /> Save
        </button>
      )}
      {views.length > 0 && (
        <button type="button" onClick={onToggleOpen} aria-expanded={open} className={BTN} data-cuts-open={testId}>
          {views.length} saved
        </button>
      )}
    </span>
  );
};

/** The chips. They belong above the page's sentence. */
export const SavedCutsList = ({ store, onOpen, noun, testId, onSay, open }: SavedCutsProps & { open: boolean }) => {
  const views = store.useViews();
  if (!open || views.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-cuts-list={testId}>
      {views.map(v => (
        <span key={v.id} className="inline-flex items-center rounded-md border border-borderSubtle overflow-hidden">
          <button
            type="button"
            onClick={() => {
              onOpen(v.query);
              onSay(`Opened "${v.name}".`);
            }}
            className="h-6 px-2 text-[11px] text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] transition-colors"
            data-cuts-view={v.name}
          >
            {v.name}
          </button>
          {/* FORGET AT ONCE, WITH AN UNDO: no "Forget?" second press — the chip goes, and the toast brings it back under
              its own name */}
          <button
            type="button"
            onClick={() => {
              store.removeView(v.id);
              undoable({ label: `Forgot "${v.name}"`, undo: () => store.saveView(v.name, v.query) });
            }}
            title={`Forget this ${noun}`}
            aria-label={`Forget the ${noun} "${v.name}"`}
            className="h-6 px-1.5 inline-flex items-center text-textMuted hover:text-bear border-l border-borderSubtle"
            data-cuts-forget={v.name}
          >
            <Trash2 className="w-2.5 h-2.5" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
};

/** The pair, with the open/closed state they share. What was said clears itself after a few seconds ("Link copied"
    must not stand for good). */
export function useSavedCuts() {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), 4000);
    return () => window.clearTimeout(t);
  }, [said]);
  return { open, toggle: () => setOpen(o => !o), said, say: setSaid };
}
