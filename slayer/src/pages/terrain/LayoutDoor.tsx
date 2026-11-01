import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useHoverOpen } from '../../components/ui/useHoverOpen';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import Switch from '../../components/ui/Switch';
import { LAYOUT_COUNTS, SHAPES, glyphCells, shapesOf, type LayoutShape, type SyncCfg } from './layoutShapes';

/*
==================================================
  SLAYER TERMINAL - THE LAYOUT DOOR (terrain/LayoutDoor.tsx)

  The one door for everything about how the desk stands (ported from the partner tree's ticker-bar door, 2026-10-31),
  on OUR desk bar where the 1-2-3-4 count and the Layouts shelf used to stand side by side. Three parts in one menu:

    SPLITS  — a row a count (1 · 2 · 3 · 4 · 6), the shapes a count can take as small glyphs, the one standing lit
    SYNC    — Symbol · Interval · Crosshair · Time, each on or off
    SAVED   — the named desks (the shelf, moved here whole): recall one, name and save this one, forget one

  A portal placed by the house's anchored-menu hook, opening UP from the bar (the bar stands at the desk's foot).
==================================================
*/

export interface SavedDesk {
  name: string;
  count: number;
  shape?: string;
  names: string[];
  savedAt: number;
}

interface Props {
  shape: LayoutShape;
  onShape: (shape: LayoutShape) => void;
  sync: SyncCfg;
  onSync: (sync: SyncCfg) => void;
  saved: SavedDesk[];
  savedMax: number;
  onRecall: (name: string) => void;
  /** returns a note when the save is refused, null when it took */
  onSave: (name: string) => string | null;
  onForget: (name: string) => void;
}

/** A shape as a glyph: one outlined 20×14 rectangle and the panes as divider lines along the cells' shared edges,
    drawn on the half-pixel so they print crisp. Nothing is filled. */
export const ShapeGlyph = ({ shape, className = '' }: { shape: LayoutShape; className?: string }) => {
  const { cols, rows } = SHAPES[shape];
  const ex = (k: number) => 0.5 + (k * 19) / cols;
  const ey = (k: number) => 0.5 + (k * 13) / rows;
  return (
    <svg width={20} height={14} viewBox="0 0 20 14" fill="none" className={className} aria-hidden>
      <rect x={0.5} y={0.5} width={19} height={13} rx={2} ry={2} stroke="currentColor" strokeWidth={1} fill="none" />
      {glyphCells(shape).map((c, i) => (
        <g key={i}>
          {c.x + c.w < cols && <line x1={ex(c.x + c.w)} y1={ey(c.y)} x2={ex(c.x + c.w)} y2={ey(c.y + c.h)} stroke="currentColor" strokeWidth={1} />}
          {c.y + c.h < rows && <line x1={ex(c.x)} y1={ey(c.y + c.h)} x2={ex(c.x + c.w)} y2={ey(c.y + c.h)} stroke="currentColor" strokeWidth={1} />}
        </g>
      ))}
    </svg>
  );
};


const SYNC_ROWS: { key: keyof SyncCfg; label: string; word: string }[] = [
  { key: 'symbol', label: 'Symbol', word: 'every chart takes the name you pick on one' },
  { key: 'interval', label: 'Interval', word: 'the timeframe picked on one is every chart’s' },
  { key: 'crosshair', label: 'Crosshair', word: 'the moment under your pointer, marked on every chart' },
  { key: 'time', label: 'Time', word: 'pan or zoom one chart and the others show the same window' },
];

const MENU_W = 312;

const LayoutDoor = ({ shape, onShape, sync, onSync, saved, savedMax, onRecall, onSave, onForget }: Props) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', MENU_W, 'start');
  /* THE HOVER OPENS IT (the partner tree's 2136793: "no click is needed"); a click still toggles */
  const hover = useHoverOpen(true, setOpen, menuRef);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    /* Escape closes it from anywhere; capture, so the desk behind never closes a pane on the same key */
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, anchorRef, menuRef]);
  const count = SHAPES[shape].n;
  const save = () => {
    const n = onSave(name);
    setNote(n);
    if (!n) setName('');
  };

  return (
    <span className="relative pointer-events-auto inline-flex shrink-0" data-layout-door>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Layout — ${SHAPES[shape].word}`}
        {...hover.trigger}
        className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md border transition-colors ${
          open ? 'border-borderMuted bg-ink/[0.08] text-textPrimary' : 'border-borderSubtle text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05]'
        }`}
        data-layout-trigger={shape}
      >
        <ShapeGlyph shape={shape} />
        <ChevronDown className="w-3 h-3 text-textMuted" />
      </button>
      {open &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Layout"
            style={{ position: 'fixed', ...placed.box, width: MENU_W }}
            className="z-[120] overflow-y-auto rounded-md border border-borderMuted bg-panel/95 backdrop-blur-md shadow-xl shadow-black/50 p-2.5 animate-slide-in"
            data-layout-menu
            {...hover.menu}
          >
            {/* SPLITS */}
            <div className="font-mono text-t9 uppercase tracking-widest text-textMuted px-1 pb-1.5">Splits</div>
            {LAYOUT_COUNTS.map(n => (
              <div key={n} className={`flex items-center gap-1 h-9 px-1 ${n !== LAYOUT_COUNTS[LAYOUT_COUNTS.length - 1] ? 'border-b border-borderSubtle/50' : ''}`} data-layout-row={n}>
                <span className={`w-5 font-mono text-t11 tnum ${count === n ? 'text-textPrimary font-semibold' : 'text-textMuted'}`}>{n}</span>
                {shapesOf(n).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      onShape(s);
                      setOpen(false);
                    }}
                    aria-pressed={s === shape}
                    aria-label={SHAPES[s].word}
                    title={SHAPES[s].word}
                    className={`inline-flex items-center justify-center w-[34px] h-[26px] rounded-md border transition-colors ${
                      s === shape ? 'border-silver/60 bg-ink/[0.1] text-textPrimary' : 'border-transparent text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]'
                    }`}
                    data-layout-shape={s}
                  >
                    <ShapeGlyph shape={s} />
                  </button>
                ))}
              </div>
            ))}
            {/* SYNC */}
            <div className="mt-2.5 pt-2 border-t border-borderSubtle/60 font-mono text-t9 uppercase tracking-widest text-textMuted px-1 pb-1">Sync</div>
            {SYNC_ROWS.map(r => (
              <button
                key={r.key}
                type="button"
                onClick={() => onSync({ ...sync, [r.key]: !sync[r.key] })}
                aria-pressed={sync[r.key]}
                title={r.word}
                className="flex items-center w-full h-7 px-1 rounded hover:bg-ink/[0.04] transition-colors text-left"
                data-layout-sync={r.key}
              >
                <span className={`flex-1 text-t11 ${sync[r.key] ? 'text-textPrimary' : 'text-textSecondary'}`}>{r.label}</span>
                <Switch on={sync[r.key]} />
              </button>
            ))}
            <p className="px-1 pt-1 text-t10 leading-snug text-textMuted">{count > 1 ? 'What one chart does, the others follow.' : 'Sync has something to do once two charts stand.'}</p>
            {/* SAVED */}
            <div className="mt-2.5 pt-2 border-t border-borderSubtle/60 flex items-baseline px-1 pb-1">
              <span className="font-mono text-t9 uppercase tracking-widest text-textMuted">Saved desks</span>
              <span className="ml-auto font-mono text-t9 tnum text-textMuted">
                {saved.length}/{savedMax}
              </span>
            </div>
            {saved
              .slice()
              .sort((a, b) => b.savedAt - a.savedAt)
              .map(d => (
                <div key={d.name} className="flex items-center gap-1 group">
                  <button
                    type="button"
                    onClick={() => {
                      onRecall(d.name);
                      setOpen(false);
                    }}
                    title={`${d.count} ${d.count === 1 ? 'chart' : 'charts'} · ${d.names.join(' ')}`}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left px-1 py-1 rounded text-t11 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
                    data-layout-saved={d.name}
                  >
                    {d.shape && d.shape in SHAPES && <ShapeGlyph shape={d.shape as LayoutShape} className="shrink-0 text-textMuted" />}
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-t9 tnum text-textMuted truncate max-w-[120px]">{d.names.join(' · ')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onForget(d.name)}
                    aria-label={`Forget the desk ${d.name}`}
                    className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-textPrimary hover:bg-ink/[0.08] transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            {saved.length === 0 && <div className="px-1 py-1 text-t10 text-textMuted">Nothing saved yet — name this desk below.</div>}
            <div className="mt-1.5 flex items-center gap-1">
              <input
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  setNote(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') return;
                  e.stopPropagation();
                  if (e.key === 'Enter') save();
                }}
                placeholder="name this desk"
                aria-label="Desk name"
                className="flex-1 min-w-0 h-7 px-2 rounded-md border border-borderSubtle bg-ink/[0.03] text-t11 text-textPrimary placeholder:text-textMuted outline-none focus:border-borderMuted"
                data-layout-name
              />
              <button
                type="button"
                onClick={save}
                className="shrink-0 h-7 px-2.5 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
                data-layout-save
              >
                Save
              </button>
            </div>
            {note && <div className="px-1 pt-1 font-mono text-t9 text-warn">{note}</div>}
          </div>,
          document.body
        )}
    </span>
  );
};

export default LayoutDoor;
